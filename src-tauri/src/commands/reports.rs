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

// Separada para poder testearla sin una Connection real. Encontrado en la
// auditoría: antes se calculaba profit_cents = units * (precio_actual -
// costo_actual), aplicando el costo de HOY a ventas de cualquier fecha.
// Ahora revenue_cents/cost_basis_cents ya vienen calculados con el costo
// histórico (cost_cents_at_sale) desde la consulta SQL -- acá solo se
// deriva la ganancia y el % de margen a partir de esos dos números.
fn compute_margin_row(price_cents: i64, cost_cents: i64, revenue_cents: i64, cost_basis_cents: i64) -> (i64, f64) {
    let profit_cents = revenue_cents - cost_basis_cents;
    // % de margen: si hubo ventas en el período, el margen REAL de esas
    // ventas (ganancia/facturado); si no, el margen de referencia del
    // catálogo actual (precio vs. costo de hoy), para no mostrar 0% en un
    // producto sin ventas que en realidad tiene buen margen de lista.
    let margin_pct = if revenue_cents > 0 {
        (profit_cents as f64 / revenue_cents as f64) * 100.0
    } else if price_cents > 0 {
        ((price_cents - cost_cents) as f64 / price_cents as f64) * 100.0
    } else {
        0.0
    };
    (profit_cents, margin_pct)
}

#[tauri::command]
pub fn margin_report(
    from_date: String,
    to_date: String,
    state: State<AppState>,
) -> CmdResult<Vec<MarginProduct>> {
    let conn = state.db.lock();

    // Union con combos: un combo vendido se guarda en sale_items con product_id=NULL
    // y combo_id=<id> (no dos líneas separadas), así que sin este bloque su facturación
    // quedaba invisible acá aunque sí contara en el Resumen — su "costo" es la suma de
    // los costos de sus componentes.
    //
    // Encontrado en la auditoría: antes esto aplicaba p.cost_cents (el costo
    // ACTUAL del catálogo) a toda unidad vendida en el período, aunque haya
    // cambiado desde entonces -- con la inflación actualizando costos seguido,
    // la ganancia de cualquier período que no fuera "Hoy" quedaba sistemáticamente
    // desviada. Ahora la ganancia usa cost_cents_at_sale (el costo vigente al
    // momento de CADA venta, ver sales.rs), con el costo actual como respaldo
    // solo para ventas de antes de que existiera esa columna.
    let mut stmt = conn.prepare(
        "SELECT * FROM (
            SELECT
                p.id as product_id,
                p.name,
                p.category,
                p.price_cents,
                p.cost_cents,
                COALESCE(SUM(si.qty), 0) as units_sold,
                COALESCE(SUM(si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0)), 0) as revenue_cents,
                COALESCE(SUM(COALESCE(si.cost_cents_at_sale, p.cost_cents) * si.qty), 0) as cost_basis_cents
             FROM products p
             LEFT JOIN sale_items si ON p.id = si.product_id AND si.combo_id IS NULL
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE p.active = 1
             GROUP BY p.id, p.name, p.category, p.price_cents, p.cost_cents

             UNION ALL

             SELECT
                -c.id as product_id,
                c.name,
                'Combos' as category,
                c.price_cents,
                COALESCE((SELECT SUM(ci.qty * pr.cost_cents) FROM combo_items ci
                          JOIN products pr ON ci.product_id = pr.id WHERE ci.combo_id = c.id), 0) as cost_cents,
                COALESCE(SUM(si.qty), 0) as units_sold,
                COALESCE(SUM(si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0)), 0) as revenue_cents,
                COALESCE(SUM(COALESCE(si.cost_cents_at_sale,
                    (SELECT SUM(ci.qty * pr.cost_cents) FROM combo_items ci
                     JOIN products pr ON ci.product_id = pr.id WHERE ci.combo_id = c.id)
                ) * si.qty), 0) as cost_basis_cents
             FROM combos c
             LEFT JOIN sale_items si ON c.id = si.combo_id
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE c.active = 1
             GROUP BY c.id, c.name, c.price_cents
         )
         ORDER BY revenue_cents DESC
         LIMIT 500",
    ).map_err(err)?;

    let rows = stmt.query_map(params![from_date, to_date], |row| {
        let price: i64 = row.get("price_cents")?;
        let cost: i64 = row.get("cost_cents")?;
        let revenue: f64 = row.get::<_, f64>("revenue_cents")?;
        let cost_basis: f64 = row.get::<_, f64>("cost_basis_cents")?;
        let units: f64 = row.get("units_sold")?;
        let revenue_cents = revenue.round() as i64;
        let (profit_cents, margin_pct) = compute_margin_row(price, cost, revenue_cents, cost_basis.round() as i64);
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

    // Mismo criterio que margin_report: usa el costo vigente al momento de la
    // venta (cost_cents_at_sale), no el costo actual del catálogo.
    let mut stmt = conn.prepare(
        "SELECT category, SUM(revenue_cents) as revenue_cents, SUM(cost_cents) as cost_cents FROM (
            SELECT
                COALESCE(p.category, 'Sin categoría') as category,
                si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0) as revenue_cents,
                si.qty * COALESCE(si.cost_cents_at_sale, p.cost_cents) as cost_cents
             FROM sale_items si
             JOIN products p ON si.product_id = p.id AND si.combo_id IS NULL
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')

             UNION ALL

             SELECT
                'Combos' as category,
                si.qty * si.unit_price_cents * (1 - si.discount_pct/100.0) as revenue_cents,
                si.qty * COALESCE(si.cost_cents_at_sale,
                    (SELECT SUM(ci.qty * pr.cost_cents) FROM combo_items ci
                     JOIN products pr ON ci.product_id = pr.id WHERE ci.combo_id = si.combo_id), 0) as cost_cents
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE si.combo_id IS NOT NULL
               AND date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         )
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

    // Si la venta tiene una factura electrónica autorizada por AFIP, su neto/iva real
    // (validado por ARCA, con la alícuota correcta ítem por ítem) reemplaza la estimación
    // pareja de dividir por (1+tasa) — mucho más preciso para las ventas que sí se facturan.
    let mut stmt = conn.prepare(
        "SELECT s.id, date(s.created_at,'localtime') as date, s.payment_method,
                s.total_cents, c.name as client_name,
                ei.neto_cents as inv_neto, ei.iva_cents as inv_iva
         FROM sales s
         LEFT JOIN clients c ON s.client_id = c.id
         LEFT JOIN electronic_invoices ei ON ei.sale_id = s.id AND ei.status = 'autorizada'
         WHERE date(s.created_at,'localtime') BETWEEN ?1 AND ?2
           AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         ORDER BY s.created_at ASC",
    ).map_err(err)?;

    let rows = stmt.query_map(params![from_date, to_date], |row| {
        let total: i64 = row.get("total_cents")?;
        let inv_neto: Option<i64> = row.get("inv_neto")?;
        let inv_iva: Option<i64> = row.get("inv_iva")?;
        let (neto, iva, is_invoiced) = match (inv_neto, inv_iva) {
            (Some(n), Some(i)) => (n, i, true),
            _ => {
                let neto = (total as f64 / divisor).round() as i64;
                (neto, total - neto, false)
            }
        };
        Ok(IvaReportItem {
            date: row.get("date")?,
            sale_id: row.get("id")?,
            payment_method: row.get("payment_method")?,
            total_cents: total,
            neto_cents: neto,
            iva_cents: iva,
            client_name: row.get("client_name")?,
            is_invoiced,
        })
    }).map_err(err)?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }

    // Encontrado en la auditoría: una Nota de Crédito autorizada por ARCA
    // seguía sin descontarse acá -- issue_credit_note guarda esas filas con
    // sale_id=NULL, así que el JOIN de arriba (por sale_id) nunca las
    // encontraba. Una factura completamente revertida seguía sumando su
    // neto/IVA entero en el Libro IVA del mes, aunque ARCA ya hubiera
    // autorizado la nota de crédito correspondiente. Se agregan como líneas
    // NEGATIVAS (con sale_id negativo para no chocar con una venta real).
    let mut nc_stmt = conn.prepare(
        "SELECT nc.id, date(nc.created_at,'localtime') as date, nc.neto_cents, nc.iva_cents, nc.total_cents,
                nc.client_name, orig.id as orig_sale_id
         FROM electronic_invoices nc
         LEFT JOIN electronic_invoices orig ON orig.id = nc.credited_invoice_id
         WHERE nc.credited_invoice_id IS NOT NULL
           AND nc.status = 'autorizada'
           AND date(nc.created_at,'localtime') BETWEEN ?1 AND ?2",
    ).map_err(err)?;
    let nc_rows = nc_stmt.query_map(params![from_date, to_date], |row| {
        let nc_id: i64 = row.get("id")?;
        let orig_sale_id: Option<i64> = row.get("orig_sale_id")?;
        Ok(IvaReportItem {
            date: row.get("date")?,
            sale_id: -nc_id,
            payment_method: "nota_de_credito".to_string(),
            total_cents: -row.get::<_, i64>("total_cents")?,
            neto_cents: -row.get::<_, i64>("neto_cents")?,
            iva_cents: -row.get::<_, i64>("iva_cents")?,
            client_name: Some(format!(
                "NC — anula venta {}",
                orig_sale_id.map(|s| format!("#{}", s)).unwrap_or_else(|| "manual".to_string())
            )),
            is_invoiced: true,
        })
    }).map_err(err)?;
    for r in nc_rows { out.push(r.map_err(err)?); }

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

#[cfg(test)]
mod tests {
    use super::compute_margin_row;

    #[test]
    fn usa_costo_historico_no_el_actual_para_la_ganancia() {
        // Este es el bug real: un producto que costaba $100 cuando se vendió
        // (y se facturó a $150, ganancia real $50) no debe mostrar ganancia
        // $0 o negativa solo porque HOY, con inflación, cuesta $160.
        // revenue_cents/cost_basis_cents ya reflejan el costo de cuando se
        // vendió (150 y 100), no el costo actual (160) que solo se usa acá
        // para price_cents/cost_cents de referencia.
        let (profit, margin_pct) = compute_margin_row(160, 160, 150, 100);
        assert_eq!(profit, 50);
        assert!((margin_pct - 33.33).abs() < 0.1);
    }

    #[test]
    fn sin_ventas_en_el_periodo_usa_el_margen_de_catalogo_como_referencia() {
        let (profit, margin_pct) = compute_margin_row(200, 100, 0, 0);
        assert_eq!(profit, 0);
        assert_eq!(margin_pct, 50.0);
    }

    #[test]
    fn con_ventas_el_margen_es_el_real_del_periodo_no_el_de_catalogo() {
        // Precio/costo actuales darían 50% de margen, pero la venta real de
        // este período fue con descuento: ganancia real menor a la de catálogo.
        let (profit, margin_pct) = compute_margin_row(200, 100, 120, 100);
        assert_eq!(profit, 20);
        assert!((margin_pct - 16.66).abs() < 0.1);
    }
}
