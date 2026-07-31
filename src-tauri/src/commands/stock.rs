use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{CountAdjustment, DeadStockItem, InventoryCountItem, LowStockProduct, ReorderItem, StockAdjustInput, StockMovement, TopProduct};
use crate::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn adjust_stock(input: StockAdjustInput, state: State<AppState>) -> CmdResult<()> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let qty_before: i64 = tx
        .query_row(
            "SELECT stock FROM products WHERE id = ?1 AND active = 1",
            params![input.product_id],
            |r| r.get(0),
        )
        .map_err(|_| "Producto no encontrado".to_string())?;

    let qty_change = input.new_stock - qty_before;

    tx.execute(
        "UPDATE products SET stock = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![input.new_stock, input.product_id],
    )
    .map_err(err)?;

    tx.execute(
        "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
         VALUES (?1, 'ajuste', ?2, ?3, ?4, ?5)",
        params![
            input.product_id,
            qty_change,
            qty_before,
            input.new_stock,
            input.notes
        ],
    )
    .map_err(err)?;

    if input.new_stock == 0 {
        // Zerear todos los lotes del producto para mantener consistencia
        tx.execute(
            "UPDATE product_lots SET qty = 0 WHERE product_id = ?1",
            params![input.product_id],
        )
        .map_err(err)?;
    }

    tx.commit().map_err(err)?;

    let detail = format!("Stock: {} → {}", qty_before, input.new_stock);
    log_action(&conn, None, "ajuste_stock", "producto", Some(input.product_id), Some(&detail));

    Ok(())
}

#[tauri::command]
pub fn list_low_stock(state: State<AppState>) -> CmdResult<Vec<LowStockProduct>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, barcode, name, stock, min_stock, category
             FROM products
             WHERE active = 1 AND stock <= min_stock
             ORDER BY (stock - min_stock) ASC, name ASC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LowStockProduct {
                id: row.get("id")?,
                barcode: row.get("barcode")?,
                name: row.get("name")?,
                stock: row.get("stock")?,
                min_stock: row.get("min_stock")?,
                category: row.get("category")?,
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
pub fn list_stock_movements(
    product_id: i64,
    limit: i64,
    state: State<AppState>,
) -> CmdResult<Vec<StockMovement>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT sm.id, sm.product_id, p.name as product_name,
                    sm.movement_type, sm.qty_change, sm.qty_before, sm.qty_after,
                    sm.notes, sm.created_at
             FROM stock_movements sm
             JOIN products p ON sm.product_id = p.id
             WHERE sm.product_id = ?1
             ORDER BY sm.created_at DESC
             LIMIT ?2",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![product_id, limit], |row| {
            Ok(StockMovement {
                id: row.get("id")?,
                product_id: row.get("product_id")?,
                product_name: row.get("product_name")?,
                movement_type: row.get("movement_type")?,
                qty_change: row.get("qty_change")?,
                qty_before: row.get("qty_before")?,
                qty_after: row.get("qty_after")?,
                notes: row.get("notes")?,
                created_at: row.get("created_at")?,
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
pub fn top_products(
    date_from: String,
    date_to: String,
    limit: i64,
    state: State<AppState>,
) -> CmdResult<Vec<TopProduct>> {
    let conn = state.db.lock();
    let to = format!("{}T23:59:59", date_to);

    let mut stmt = conn
        .prepare(
            "SELECT si.product_id, si.name,
                    SUM(si.qty) as total_qty,
                    SUM(si.qty * si.unit_price_cents) as total_cents
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE datetime(s.created_at, 'localtime') >= ?1 AND datetime(s.created_at, 'localtime') <= ?2
             GROUP BY si.product_id, si.name
             ORDER BY total_cents DESC
             LIMIT ?3",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![date_from, to, limit], |row| {
            Ok(TopProduct {
                product_id: row.get("product_id")?,
                name: row.get("name")?,
                total_qty: row.get("total_qty")?,
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
pub fn sales_by_category(
    date_from: String,
    date_to: String,
    state: State<AppState>,
) -> CmdResult<Vec<(String, i64)>> {
    let conn = state.db.lock();
    let to = format!("{}T23:59:59", date_to);

    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(p.category, 'Sin categoría') as cat,
                    SUM(si.qty * si.unit_price_cents) as total_cents
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             LEFT JOIN products p ON si.product_id = p.id
             WHERE datetime(s.created_at, 'localtime') >= ?1 AND datetime(s.created_at, 'localtime') <= ?2
             GROUP BY cat
             ORDER BY total_cents DESC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![date_from, to], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn reorder_by_supplier(state: State<AppState>) -> CmdResult<Vec<ReorderItem>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.barcode, p.name, p.stock, p.min_stock,
                (p.min_stock - p.stock + 1) as need_qty,
                p.category, p.cost_cents,
                s.id as supplier_id, s.name as supplier_name
         FROM products p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         WHERE p.active=1 AND p.stock <= p.min_stock
         ORDER BY s.name NULLS LAST, p.name",
    ).map_err(err)?;
    let rows = stmt.query_map([], |row| {
        Ok(ReorderItem {
            id: row.get("id")?,
            barcode: row.get("barcode")?,
            name: row.get("name")?,
            stock: row.get("stock")?,
            min_stock: row.get("min_stock")?,
            need_qty: row.get::<_, i64>("need_qty").unwrap_or(1).max(1),
            category: row.get("category")?,
            cost_cents: row.get("cost_cents")?,
            supplier_id: row.get("supplier_id")?,
            supplier_name: row.get("supplier_name")?,
        })
    }).map_err(err)?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn get_dead_stock(days: i64, state: State<AppState>) -> CmdResult<Vec<DeadStockItem>> {
    let conn = state.db.lock();
    let days_str = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.category, p.stock, p.cost_cents,
                p.stock * p.cost_cents as capital_cents,
                CAST(julianday('now','localtime') - julianday(
                    COALESCE(
                        (SELECT MAX(s2.created_at) FROM sales s2
                         JOIN sale_items si2 ON si2.sale_id = s2.id
                         WHERE si2.product_id = p.id
                           AND (s2.notes IS NULL OR s2.notes NOT LIKE '%[ANULADA]%')),
                        p.created_at
                    )
                ) AS INTEGER) as days_without_sales
         FROM products p
         WHERE p.active = 1 AND p.stock > 0
           AND p.id NOT IN (
               SELECT DISTINCT si.product_id FROM sale_items si
               JOIN sales s ON si.sale_id = s.id
               WHERE date(s.created_at,'localtime') >= date('now','localtime', ?1)
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
                 AND si.product_id IS NOT NULL)
         ORDER BY capital_cents DESC
         LIMIT 50",
    ).map_err(err)?;

    let rows: Vec<DeadStockItem> = stmt.query_map(params![days_str], |row| {
        Ok(DeadStockItem {
            product_id: row.get("id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            stock: row.get("stock")?,
            cost_cents: row.get("cost_cents")?,
            capital_cents: row.get("capital_cents")?,
            days_without_sales: row.get("days_without_sales")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

/// Lista todos los productos activos para el flujo de conteo de inventario.
#[tauri::command]
pub fn list_inventory_count(state: State<AppState>) -> CmdResult<Vec<InventoryCountItem>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, name, barcode, category, stock FROM products WHERE active=1 ORDER BY category, name",
    ).map_err(err)?;

    let rows = stmt.query_map([], |row| {
        Ok(InventoryCountItem {
            product_id: row.get("id")?,
            name: row.get("name")?,
            barcode: row.get("barcode")?,
            category: row.get("category")?,
            system_stock: row.get("stock")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

/// Aplica ajustes masivos de stock resultantes del conteo de inventario.
#[tauri::command]
pub fn apply_inventory_count(
    adjustments: Vec<CountAdjustment>,
    state: State<AppState>,
) -> CmdResult<i64> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;
    let mut count = 0i64;

    for adj in &adjustments {
        let qty_before: i64 = tx
            .query_row("SELECT stock FROM products WHERE id=?1", params![adj.product_id], |r| r.get(0))
            .unwrap_or(0);

        if qty_before == adj.counted_qty { continue; }

        tx.execute(
            "UPDATE products SET stock=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![adj.counted_qty, adj.product_id],
        ).map_err(err)?;

        let qty_change = adj.counted_qty - qty_before;
        tx.execute(
            "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
             VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Conteo de inventario')",
            params![adj.product_id, qty_change, qty_before, adj.counted_qty],
        ).map_err(err)?;

        // Sincronizar lotes: si el nuevo stock es 0, zerear lotes
        if adj.counted_qty == 0 {
            tx.execute(
                "UPDATE product_lots SET qty=0 WHERE product_id=?1",
                params![adj.product_id],
            ).map_err(err)?;
        }

        count += 1;
    }

    tx.commit().map_err(err)?;
    log_action(&conn, None, "conteo_inventario", "stock", None,
        Some(&format!("{count} productos ajustados")));
    Ok(count)
}
