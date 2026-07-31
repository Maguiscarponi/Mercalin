use crate::commands::{err, CmdResult};
use crate::models::{ExpiringLot, NewProductLot, ProductLot};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_lot(row: &rusqlite::Row) -> rusqlite::Result<ProductLot> {
    Ok(ProductLot {
        id: row.get("id")?,
        product_id: row.get("product_id")?,
        product_name: row.get("product_name")?,
        qty: row.get("qty")?,
        cost_cents: row.get("cost_cents")?,
        expires_at: row.get("expires_at")?,
        order_id: row.get("order_id")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
    })
}

#[tauri::command]
pub fn list_product_lots(product_id: i64, state: State<AppState>) -> CmdResult<Vec<ProductLot>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT pl.*, p.name as product_name
             FROM product_lots pl
             JOIN products p ON pl.product_id = p.id
             WHERE pl.product_id = ?1 AND pl.qty > 0
             ORDER BY CASE WHEN pl.expires_at IS NULL THEN 1 ELSE 0 END, pl.expires_at ASC",
        )
        .map_err(err)?;

    let rows = stmt.query_map(params![product_id], row_to_lot).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn list_expiring_lots(days: i64, state: State<AppState>) -> CmdResult<Vec<ExpiringLot>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT pl.id as lot_id, pl.product_id, p.name as product_name, p.barcode,
                    pl.qty,
                    pl.expires_at,
                    CAST(julianday(pl.expires_at) - julianday('now') AS INTEGER) as days_left
             FROM product_lots pl
             JOIN products p ON pl.product_id = p.id
             WHERE pl.qty > 0
               AND pl.expires_at IS NOT NULL
               AND julianday(pl.expires_at) <= julianday('now') + ?1
             ORDER BY pl.expires_at ASC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![days], |row| {
            Ok(ExpiringLot {
                lot_id: row.get("lot_id")?,
                product_id: row.get("product_id")?,
                product_name: row.get("product_name")?,
                barcode: row.get("barcode")?,
                qty: row.get("qty")?,
                expires_at: row.get("expires_at")?,
                days_left: row.get("days_left")?,
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
pub fn add_product_lot(input: NewProductLot, state: State<AppState>) -> CmdResult<ProductLot> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    tx.execute(
        "INSERT INTO product_lots (product_id, qty, cost_cents, expires_at, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.product_id,
            input.qty,
            input.cost_cents,
            input.expires_at,
            input.notes,
        ],
    )
    .map_err(err)?;

    let lot_id = tx.last_insert_rowid();

    tx.execute(
        "UPDATE products SET stock = stock + ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![input.qty, input.product_id],
    )
    .map_err(err)?;

    tx.execute(
        "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
         SELECT ?1, 'ingreso', ?2, stock - ?2, stock, ?3 FROM products WHERE id = ?1",
        params![input.product_id, input.qty, input.notes.as_deref().unwrap_or("Ingreso manual de lote")],
    )
    .map_err(err)?;

    tx.commit().map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT pl.*, p.name as product_name
             FROM product_lots pl
             JOIN products p ON pl.product_id = p.id
             WHERE pl.id = ?1",
        )
        .map_err(err)?;

    stmt.query_row(params![lot_id], row_to_lot).map_err(err)
}

#[tauri::command]
pub fn retire_lot(lot_id: i64, state: State<AppState>) -> CmdResult<()> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let (product_id, lot_qty): (i64, i64) = tx
        .query_row(
            "SELECT product_id, qty FROM product_lots WHERE id = ?1",
            params![lot_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Lote no encontrado".to_string())?;

    tx.execute(
        "UPDATE product_lots SET qty = 0 WHERE id = ?1",
        params![lot_id],
    )
    .map_err(err)?;

    let qty_before: i64 = tx
        .query_row("SELECT stock FROM products WHERE id = ?1", params![product_id], |r| r.get(0))
        .unwrap_or(0);

    let qty_after = (qty_before - lot_qty).max(0);

    tx.execute(
        "UPDATE products SET stock = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![qty_after, product_id],
    )
    .map_err(err)?;

    tx.execute(
        "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
         VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Lote vencido retirado')",
        params![product_id, -lot_qty, qty_before, qty_after],
    )
    .map_err(err)?;

    tx.commit().map_err(err)
}

#[tauri::command]
pub fn update_lot_expiry(
    lot_id: i64,
    expires_at: Option<String>,
    state: State<AppState>,
) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE product_lots SET expires_at = ?1 WHERE id = ?2",
        params![expires_at, lot_id],
    )
    .map_err(err)?;
    Ok(())
}
