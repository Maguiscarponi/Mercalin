use crate::commands::{err, CmdResult};
use crate::models::{CostInflationItem, NewPurchaseOrder, NewPurchaseOrderItem, NewSupplier, PurchaseOrder, PurchaseOrderItem, PurchaseProjection, Supplier, SupplierLeadTime, SupplierRiskScore};
use crate::AppState;
use rusqlite::{params, Row};
use tauri::State;

fn row_to_supplier(row: &Row) -> rusqlite::Result<Supplier> {
    Ok(Supplier {
        id: row.get("id")?,
        name: row.get("name")?,
        contact_name: row.get("contact_name")?,
        phone: row.get("phone")?,
        email: row.get("email")?,
        address: row.get("address")?,
        cuit: row.get("cuit")?,
        notes: row.get("notes")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn list_suppliers(state: State<AppState>) -> CmdResult<Vec<Supplier>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM suppliers WHERE active = 1 ORDER BY name")
        .map_err(err)?;

    let rows = stmt.query_map([], row_to_supplier).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_supplier(supplier: NewSupplier, state: State<AppState>) -> CmdResult<Supplier> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO suppliers (name, contact_name, phone, email, address, cuit, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            supplier.name,
            supplier.contact_name,
            supplier.phone,
            supplier.email,
            supplier.address,
            supplier.cuit,
            supplier.notes,
        ],
    )
    .map_err(err)?;

    let id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare("SELECT * FROM suppliers WHERE id = ?1")
        .map_err(err)?;
    stmt.query_row(params![id], row_to_supplier).map_err(err)
}

#[tauri::command]
pub fn update_supplier(supplier: Supplier, state: State<AppState>) -> CmdResult<Supplier> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE suppliers SET name=?1, contact_name=?2, phone=?3, email=?4,
         address=?5, cuit=?6, notes=?7, updated_at=CURRENT_TIMESTAMP
         WHERE id = ?8",
        params![
            supplier.name,
            supplier.contact_name,
            supplier.phone,
            supplier.email,
            supplier.address,
            supplier.cuit,
            supplier.notes,
            supplier.id,
        ],
    )
    .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT * FROM suppliers WHERE id = ?1")
        .map_err(err)?;
    stmt.query_row(params![supplier.id], row_to_supplier)
        .map_err(err)
}

#[tauri::command]
pub fn delete_supplier(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE suppliers SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn create_purchase_order(
    order: NewPurchaseOrder,
    state: State<AppState>,
) -> CmdResult<PurchaseOrder> {
    if order.items.is_empty() {
        return Err("La orden no tiene ítems".to_string());
    }

    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let total_cents: i64 = order
        .items
        .iter()
        .map(|i| i.unit_cost_cents * i.qty)
        .sum();

    tx.execute(
        "INSERT INTO purchase_orders (supplier_id, total_cents, notes) VALUES (?1, ?2, ?3)",
        params![order.supplier_id, total_cents, order.notes],
    )
    .map_err(err)?;

    let order_id = tx.last_insert_rowid();

    for item in &order.items {
        tx.execute(
            "INSERT INTO purchase_items (order_id, product_id, name, unit_cost_cents, qty)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![order_id, item.product_id, item.name, item.unit_cost_cents, item.qty],
        )
        .map_err(err)?;
    }

    tx.commit().map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT po.*, s.name as supplier_name
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.id = ?1",
        )
        .map_err(err)?;

    stmt.query_row(params![order_id], |row| {
        Ok(PurchaseOrder {
            id: row.get("id")?,
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
            total_cents: row.get("total_cents")?,
            status: row.get("status")?,
            notes: row.get("notes")?,
            ordered_at: row.get("ordered_at")?,
            received_at: row.get("received_at")?,
        })
    })
    .map_err(err)
}

#[tauri::command]
pub fn list_purchase_orders(
    supplier_id: Option<i64>,
    state: State<AppState>,
) -> CmdResult<Vec<PurchaseOrder>> {
    let conn = state.db.lock();

    let (sql, use_param) = if supplier_id.is_some() {
        (
            "SELECT po.*, s.name as supplier_name
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.supplier_id = ?1
             ORDER BY po.ordered_at DESC LIMIT 100",
            true,
        )
    } else {
        (
            "SELECT po.*, s.name as supplier_name
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             ORDER BY po.ordered_at DESC LIMIT 100",
            false,
        )
    };

    let mut stmt = conn.prepare(sql).map_err(err)?;

    let mapper = |row: &rusqlite::Row| {
        Ok(PurchaseOrder {
            id: row.get("id")?,
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
            total_cents: row.get("total_cents")?,
            status: row.get("status")?,
            notes: row.get("notes")?,
            ordered_at: row.get("ordered_at")?,
            received_at: row.get("received_at")?,
        })
    };

    let rows = if use_param {
        stmt.query_map(params![supplier_id.unwrap()], mapper)
            .map_err(err)?
    } else {
        stmt.query_map([], mapper).map_err(err)?
    };

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn receive_purchase_order(
    order_id: i64,
    state: State<AppState>,
) -> CmdResult<PurchaseOrder> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    tx.execute(
        "UPDATE purchase_orders SET status='recibido', received_at=CURRENT_TIMESTAMP
         WHERE id=?1 AND status='pendiente'",
        params![order_id],
    )
    .map_err(err)?;

    // Actualizar stock de los productos de la orden
    let items: Vec<(Option<i64>, i64, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT product_id, qty, unit_cost_cents FROM purchase_items WHERE order_id=?1",
            )
            .map_err(err)?;
        let x = stmt.query_map(params![order_id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();
        x
    };

    for (product_id, qty, cost) in items {
        if let Some(pid) = product_id {
            let qty_before: i64 = tx
                .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| {
                    r.get(0)
                })
                .unwrap_or(0);

            tx.execute(
                "UPDATE products SET stock=stock+?1, cost_cents=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?3",
                params![qty, cost, pid],
            )
            .map_err(err)?;

            tx.execute(
                "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
                 VALUES (?1, 'compra', ?2, ?3, ?4, 'Recepción de orden de compra')",
                params![pid, qty, qty_before, qty_before + qty],
            )
            .map_err(err)?;

            // Crear lote nuevo (sin fecha de vencimiento; el usuario la carga en Vencimientos)
            tx.execute(
                "INSERT INTO product_lots (product_id, qty, cost_cents, order_id, notes)
                 VALUES (?1, ?2, ?3, ?4, 'Recepción de orden de compra')",
                params![pid, qty, cost, order_id],
            )
            .map_err(err)?;
        }
    }

    tx.commit().map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT po.*, s.name as supplier_name
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.id = ?1",
        )
        .map_err(err)?;

    stmt.query_row(params![order_id], |row| {
        Ok(PurchaseOrder {
            id: row.get("id")?,
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
            total_cents: row.get("total_cents")?,
            status: row.get("status")?,
            notes: row.get("notes")?,
            ordered_at: row.get("ordered_at")?,
            received_at: row.get("received_at")?,
        })
    })
    .map_err(err)
}

#[tauri::command]
pub fn get_purchase_items(
    order_id: i64,
    state: State<AppState>,
) -> CmdResult<Vec<PurchaseOrderItem>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM purchase_items WHERE order_id = ?1")
        .map_err(err)?;

    let rows = stmt
        .query_map(params![order_id], |row| {
            Ok(PurchaseOrderItem {
                id: row.get("id")?,
                order_id: row.get("order_id")?,
                product_id: row.get("product_id")?,
                name: row.get("name")?,
                unit_cost_cents: row.get("unit_cost_cents")?,
                qty: row.get("qty")?,
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
pub fn cancel_purchase_order(order_id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE purchase_orders SET status='cancelado' WHERE id=?1 AND status='pendiente'",
        params![order_id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn generate_auto_orders(state: State<AppState>) -> CmdResult<Vec<PurchaseOrder>> {
    let conn = state.db.lock();

    let mut stmt = conn.prepare(
        "SELECT id, name, supplier_id, stock, min_stock, cost_cents
         FROM products
         WHERE active=1 AND supplier_id IS NOT NULL AND stock <= min_stock
         ORDER BY supplier_id, name",
    ).map_err(err)?;

    let products: Vec<(i64, String, i64, i64, i64, i64)> = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    }).map_err(err)?
    .filter_map(|r| r.ok())
    .collect();

    if products.is_empty() {
        return Ok(vec![]);
    }

    let mut by_supplier: std::collections::HashMap<i64, Vec<NewPurchaseOrderItem>> =
        std::collections::HashMap::new();

    for (pid, name, supplier_id, stock, min_stock, cost_cents) in &products {
        let reorder_qty = (min_stock * 2 - stock).max(1);
        by_supplier.entry(*supplier_id).or_default().push(NewPurchaseOrderItem {
            product_id: Some(*pid),
            name: name.clone(),
            unit_cost_cents: *cost_cents,
            qty: reorder_qty,
        });
    }

    let mut created_orders: Vec<PurchaseOrder> = Vec::new();

    for (supplier_id, items) in by_supplier {
        let total_cents: i64 = items.iter().map(|i| i.unit_cost_cents * i.qty).sum();

        conn.execute(
            "INSERT INTO purchase_orders (supplier_id, total_cents, notes) VALUES (?1, ?2, ?3)",
            params![supplier_id, total_cents, "Generado automáticamente por stock bajo"],
        ).map_err(err)?;

        let order_id = conn.last_insert_rowid();

        for item in &items {
            conn.execute(
                "INSERT INTO purchase_items (order_id, product_id, name, unit_cost_cents, qty)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![order_id, item.product_id, item.name, item.unit_cost_cents, item.qty],
            ).map_err(err)?;
        }

        let po = conn.query_row(
            "SELECT po.*, s.name as supplier_name
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.id = ?1",
            params![order_id],
            |row| Ok(PurchaseOrder {
                id: row.get("id")?,
                supplier_id: row.get("supplier_id")?,
                supplier_name: row.get("supplier_name")?,
                total_cents: row.get("total_cents")?,
                status: row.get("status")?,
                notes: row.get("notes")?,
                ordered_at: row.get("ordered_at")?,
                received_at: row.get("received_at")?,
            }),
        ).map_err(err)?;
        created_orders.push(po);
    }

    Ok(created_orders)
}

/// Lead time promedio real por proveedor (calculado de órdenes recibidas).
#[tauri::command]
pub fn get_supplier_lead_times(state: State<AppState>) -> CmdResult<Vec<SupplierLeadTime>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT s.id as supplier_id, s.name as supplier_name,
                AVG(julianday(po.received_at) - julianday(po.ordered_at)) as avg_days,
                MIN(CAST(julianday(po.received_at) - julianday(po.ordered_at) AS INTEGER)) as min_days,
                MAX(CAST(julianday(po.received_at) - julianday(po.ordered_at) AS INTEGER)) as max_days,
                COUNT(*) as order_count
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         WHERE po.status = 'recibido'
           AND po.received_at IS NOT NULL
         GROUP BY s.id, s.name
         ORDER BY avg_days ASC",
    ).map_err(err)?;

    let rows = stmt.query_map([], |row| {
        Ok(SupplierLeadTime {
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
            avg_days: row.get::<_, f64>("avg_days").unwrap_or(0.0),
            min_days: row.get::<_, i64>("min_days").unwrap_or(0),
            max_days: row.get::<_, i64>("max_days").unwrap_or(0),
            order_count: row.get("order_count")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

/// Proyección de compras: productos que se agotan en los próximos 7 días según velocidad de venta.
#[tauri::command]
pub fn get_purchase_projections(state: State<AppState>) -> CmdResult<Vec<PurchaseProjection>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.category, p.stock, p.cost_cents, p.min_stock,
                p.supplier_id, s.name as supplier_name,
                COALESCE(SUM(si.qty), 0) / 30.0 as daily_velocity
         FROM products p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN sale_items si ON p.id = si.product_id
         LEFT JOIN sales sv ON si.sale_id = sv.id
             AND date(sv.created_at,'localtime') >= date('now','localtime','-30 days')
             AND (sv.notes IS NULL OR sv.notes NOT LIKE '%[ANULADA]%')
         WHERE p.active = 1
         GROUP BY p.id
         HAVING daily_velocity > 0
            AND (p.stock / daily_velocity) <= 7
         ORDER BY (p.stock / daily_velocity) ASC
         LIMIT 50",
    ).map_err(err)?;

    let rows = stmt.query_map([], |row| {
        let stock: i64 = row.get("stock")?;
        let velocity: f64 = row.get("daily_velocity").unwrap_or(0.0);
        let days_rem = if velocity > 0.0 { stock as f64 / velocity } else { 999.0 };
        let min_stock: i64 = row.get("min_stock")?;
        let suggested = ((min_stock * 2) - stock).max(1);
        Ok(PurchaseProjection {
            product_id: row.get("id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            stock,
            daily_velocity: (velocity * 10.0).round() / 10.0,
            days_remaining: (days_rem * 10.0).round() / 10.0,
            suggested_qty: suggested,
            cost_cents: row.get("cost_cents")?,
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

/// Inflación de costos: variación del precio de costo entre la primera y la última compra por producto/proveedor.
#[tauri::command]
pub fn get_supplier_cost_inflation(state: State<AppState>) -> CmdResult<Vec<CostInflationItem>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT s.id as supplier_id, s.name as supplier_name,
                p.id as product_id, p.name as product_name,
                MIN(pi.unit_cost_cents) as first_cost,
                MAX(pi.unit_cost_cents) as last_cost,
                COUNT(DISTINCT po.id) as order_count
         FROM purchase_items pi
         JOIN purchase_orders po ON pi.order_id = po.id
         JOIN products p ON pi.product_id = p.id
         JOIN suppliers s ON po.supplier_id = s.id
         WHERE po.status = 'recibido' AND p.active = 1
         GROUP BY s.id, p.id
         HAVING order_count >= 2 AND last_cost > first_cost
         ORDER BY ((last_cost - first_cost) * 1.0 / first_cost) DESC
         LIMIT 50",
    ).map_err(err)?;

    let rows = stmt.query_map([], |row| {
        let first: i64 = row.get("first_cost")?;
        let last: i64  = row.get("last_cost")?;
        let pct = if first > 0 { ((last - first) as f64 / first as f64) * 100.0 } else { 0.0 };
        Ok(CostInflationItem {
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
            product_id: row.get("product_id")?,
            product_name: row.get("product_name")?,
            first_cost_cents: first,
            last_cost_cents: last,
            pct_change: (pct * 10.0).round() / 10.0,
            order_count: row.get("order_count")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

/// Score de riesgo por proveedor: combina variabilidad de lead time + inflacion de costos.
#[tauri::command]
pub fn get_supplier_risk_scores(state: State<AppState>) -> CmdResult<Vec<SupplierRiskScore>> {
    let conn = state.db.lock();

    // Lead time avg y varianza por proveedor
    let mut lt_stmt = conn.prepare(
        "SELECT s.id, s.name,
                COUNT(po.id) as order_count,
                AVG(julianday(po.received_at) - julianday(po.ordered_at)) as avg_days,
                AVG((julianday(po.received_at) - julianday(po.ordered_at)) *
                    (julianday(po.received_at) - julianday(po.ordered_at))) -
                AVG(julianday(po.received_at) - julianday(po.ordered_at)) *
                AVG(julianday(po.received_at) - julianday(po.ordered_at)) as variance
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         WHERE po.status = 'recibido' AND po.received_at IS NOT NULL
         GROUP BY s.id
         HAVING order_count >= 2",
    ).map_err(err)?;

    // Lead time data: id -> (name, order_count, avg_days, std)
    let lt_data: Vec<(i64, String, i64, f64, f64)> = lt_stmt.query_map([], |row| {
        let variance: f64 = row.get::<_, f64>("variance").unwrap_or(0.0).max(0.0);
        Ok((row.get("id")?, row.get("name")?,
            row.get("order_count")?,
            row.get::<_, f64>("avg_days").unwrap_or(0.0),
            variance.sqrt()))
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    // Inflacion de costos por proveedor: max % de variacion promedio
    let mut inf_stmt = conn.prepare(
        "SELECT po.supplier_id,
                AVG(CAST(pi.unit_cost_cents - first_c.min_cost AS REAL) / NULLIF(first_c.min_cost, 0) * 100) as avg_inflation
         FROM purchase_items pi
         JOIN purchase_orders po ON pi.order_id = po.id
         JOIN (
             SELECT pi2.product_id, MIN(pi2.unit_cost_cents) as min_cost
             FROM purchase_items pi2
             JOIN purchase_orders po2 ON pi2.order_id = po2.id
             WHERE po2.status = 'recibido'
             GROUP BY pi2.product_id
         ) first_c ON pi.product_id = first_c.product_id
         WHERE po.status = 'recibido'
         GROUP BY po.supplier_id",
    ).map_err(err)?;

    let inflation_map: std::collections::HashMap<i64, f64> = inf_stmt.query_map([], |row| {
        Ok((row.get::<_, i64>("supplier_id")?, row.get::<_, f64>("avg_inflation").unwrap_or(0.0)))
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    let mut out = Vec::new();
    for (sid, sname, order_count, avg_days, std) in lt_data {
        let inflation = inflation_map.get(&sid).copied().unwrap_or(0.0).max(0.0);

        // Coeficiente de variacion (0..1+) del lead time
        let cv = if avg_days > 0.0 { std / avg_days } else { 0.0 };

        // Score 0..1: 40% variabilidad + 60% inflacion (normalizada al 50% como max)
        let inflation_norm = (inflation / 50.0).min(1.0);
        let risk_score = cv.min(1.0) * 0.4 + inflation_norm * 0.6;

        let risk_level = if risk_score < 0.2 { "bajo" } else if risk_score < 0.5 { "medio" } else { "alto" };

        out.push(SupplierRiskScore {
            supplier_id: sid, supplier_name: sname,
            lead_time_avg: (avg_days * 10.0).round() / 10.0,
            lead_time_std: (std * 10.0).round() / 10.0,
            cost_inflation_pct: (inflation * 10.0).round() / 10.0,
            order_count,
            risk_score: (risk_score * 100.0).round() / 100.0,
            risk_level: risk_level.to_string(),
        });
    }

    // Ordenar por risk_score desc
    out.sort_by(|a, b| b.risk_score.partial_cmp(&a.risk_score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}
