use crate::commands::{err, CmdResult};
use crate::models::{DailyReport, IvaReportItem, MarginCategory, MarginProduct, ProductAffinity, SalesByUser};
use crate::AppState;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn daily_report(date: String, state: State<AppState>) -> CmdResult<DailyReport> {
    range_report(date.clone(), date, state)
}

#[tauri::command]
pub fn range_report(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<DailyReport> {
    let conn = state.db.lock();

    let mut stmt = conn
        .prepare(
            "SELECT payment_method, COUNT(*) as cnt, COALESCE(SUM(total_cents), 0) as total
             FROM sales
             WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
             GROUP BY payment_method",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![from_date, to_date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(err)?;

    let mut sales_count = 0i64;
    let mut total_cents = 0i64;
    let mut by_method: HashMap<String, i64> = HashMap::new();

    for m in ["efectivo", "debito", "credito", "qr", "transferencia", "cuenta_corriente", "mixto"] {
        by_method.insert(m.to_string(), 0);
    }

    for r in rows {
        let (method, cnt, total) = r.map_err(err)?;
        sales_count += cnt;
        total_cents += total;
        *by_method.entry(method).or_insert(0) += total;
    }

    let discount_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(discount_cents), 0) FROM sales
             WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            params![from_date, to_date],
            |r| r.get(0),
        )
        .map_err(err)?;

    Ok(DailyReport {
        date: if from_date == to_date {
            from_date
        } else {
            format!("{} al {}", from_date, to_date)
        },
        sales_count,
        total_cents,
        discount_cents,
        by_method,
    })
}

#[tauri::command]
pub fn sales_by_user(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<Vec<SalesByUser>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT s.user_id,
                    COALESCE(u.full_name, 'Sin usuario asignado') as user_name,
                    COUNT(*) as sales_count,
                    COALESCE(SUM(s.total_cents), 0) as total_cents
             FROM sales s
             LEFT JOIN users u ON s.user_id = u.id
             WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY s.user_id, user_name
             ORDER BY total_cents DESC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![from_date, to_date], |row| {
            Ok(SalesByUser {
                user_id: row.get("user_id")?,
                user_name: row.get("user_name")?,
                sales_count: row.get("sales_count")?,
                total_cents: row.get("total_cents")?,
            })
        })
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn margin_report(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<Vec<MarginProduct>> {
    let conn = state.db.lock();

    let mut stmt = conn.prepare(
        "SELECT
            p.id as product_id,
            p.name,
            p.category,
            p.price_cents,
            p.cost_cents,
            COALESCE(SUM(si.qty), 0) as units_sold,
            COALESCE(SUM(si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0)), 0) as revenue_cents
         FROM products p
         LEFT JOIN sale_items si ON p.id = si.product_id
         LEFT JOIN sales s ON si.sale_id = s.id
             AND date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
             AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         WHERE p.active = 1
         GROUP BY p.id, p.name, p.category, p.price_cents, p.cost_cents
         ORDER BY revenue_cents DESC
         LIMIT 500",
    ).map_err(err)?;

    let rows = stmt.query_map(params![from_date, to_date], |row| {
        let price: i64 = row.get("price_cents")?;
        let cost: i64 = row.get("cost_cents")?;
        let revenue: f64 = row.get::<_, f64>("revenue_cents")?;
        let units: f64 = row.get("units_sold")?;
        let margin_pct = if price > 0 {
            ((price - cost) as f64 / price as f64) * 100.0
        } else {
            0.0
        };
        let revenue_cents = revenue.round() as i64;
        let profit_cents = if units > 0.0 {
            ((units * (price - cost) as f64).round()) as i64
        } else {
            0
        };
        Ok(MarginProduct {
            product_id: row.get("product_id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            price_cents: price,
            cost_cents: cost,
            margin_pct,
            units_sold: units,
            revenue_cents,
            profit_cents,
        })
    }).map_err(err)?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn margin_by_category(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<Vec<MarginCategory>> {
    let conn = state.db.lock();

    let mut stmt = conn.prepare(
        "SELECT
            COALESCE(p.category, 'Sin categoría') as category,
            COALESCE(SUM(si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0)), 0) as revenue_cents,
            COALESCE(SUM(si.qty * p.cost_cents), 0) as cost_cents
         FROM products p
         JOIN sale_items si ON p.id = si.product_id
         JOIN sales s ON si.sale_id = s.id
         WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
           AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         GROUP BY category
         ORDER BY revenue_cents DESC",
    ).map_err(err)?;

    let rows = stmt.query_map(params![from_date, to_date], |row| {
        let revenue: f64 = row.get::<_, f64>("revenue_cents")?;
        let cost: f64 = row.get::<_, f64>("cost_cents")?;
        let revenue_cents = revenue.round() as i64;
        let cost_cents = cost.round() as i64;
        let profit_cents = revenue_cents - cost_cents;
        let margin_pct = if revenue_cents > 0 {
            (profit_cents as f64 / revenue_cents as f64) * 100.0
        } else {
            0.0
        };
        Ok(MarginCategory {
            category: row.get("category")?,
            revenue_cents,
            cost_cents,
            profit_cents,
            margin_pct,
        })
    }).map_err(err)?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

/// Libro IVA ventas: desglose neto + IVA para el período dado.
/// La tasa de IVA se lee de la tabla config (clave "iva_rate"), default 21.
#[tauri::command]
pub fn get_iva_report(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<Vec<IvaReportItem>> {
    let conn = state.db.lock();

    let iva_rate: f64 = conn
        .query_row("SELECT value FROM config WHERE key='iva_rate'", [], |r| {
            r.get::<_, String>(0)
        })
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(21.0);

    let divisor = 1.0 + iva_rate / 100.0;

    let mut stmt = conn.prepare(
        "SELECT s.id, date(s.created_at,'localtime') as date, s.payment_method,
                s.total_cents, c.name as client_name
         FROM sales s
         LEFT JOIN clients c ON s.client_id = c.id
         WHERE date(s.created_at,'localtime') BETWEEN ?1 AND ?2
           AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         ORDER BY s.created_at ASC",
    ).map_err(err)?;

    let rows = stmt.query_map(params![from_date, to_date], |row| {
        let total: i64 = row.get("total_cents")?;
        let neto = (total as f64 / divisor).round() as i64;
        let iva  = total - neto;
        Ok(IvaReportItem {
            date: row.get("date")?,
            sale_id: row.get("id")?,
            payment_method: row.get("payment_method")?,
            total_cents: total,
            neto_cents: neto,
            iva_cents: iva,
            client_name: row.get("client_name")?,
        })
    }).map_err(err)?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

/// Co-ocurrencia de productos en la misma venta (últimos 60 días).
#[tauri::command]
pub fn get_product_affinity(state: State<AppState>) -> CmdResult<Vec<ProductAffinity>> {
    let conn = state.db.lock();

    // Pares que aparecen juntos en la misma venta
    let mut stmt = conn.prepare(
        "SELECT
            a.product_id as a_id, pa.name as a_name,
            b.product_id as b_id, pb.name as b_name,
            COUNT(*) as together
         FROM sale_items a
         JOIN sale_items b ON a.sale_id = b.sale_id AND a.product_id < b.product_id
         JOIN products pa ON a.product_id = pa.id
         JOIN products pb ON b.product_id = pb.id
         JOIN sales s ON a.sale_id = s.id
         WHERE date(s.created_at,'localtime') >= date('now','localtime','-60 days')
           AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
           AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
         GROUP BY a.product_id, b.product_id
         HAVING together >= 2
         ORDER BY together DESC
         LIMIT 40",
    ).map_err(err)?;

    let pairs: Vec<(i64, String, i64, String, i64)> = stmt.query_map([], |row| {
        Ok((row.get("a_id")?, row.get("a_name")?, row.get("b_id")?, row.get("b_name")?, row.get("together")?))
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    // Para cada par, obtener total de ventas del producto A
    let mut out = Vec::new();
    for (a_id, a_name, b_id, b_name, together) in pairs {
        let total_a: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT sale_id) FROM sale_items WHERE product_id=?1",
            rusqlite::params![a_id], |r| r.get(0),
        ).unwrap_or(1).max(1);

        let affinity_pct = (together as f64 / total_a as f64) * 100.0;
        out.push(ProductAffinity {
            product_a_id: a_id, product_a_name: a_name,
            product_b_id: b_id, product_b_name: b_name,
            co_occurrences: together, total_a_sales: total_a,
            affinity_pct: (affinity_pct * 10.0).round() / 10.0,
        });
    }
    Ok(out)
}
