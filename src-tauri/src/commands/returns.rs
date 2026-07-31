use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{NewReturn, ReturnItem, ReturnRecord, ReturnWithItems};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_return(row: &rusqlite::Row) -> rusqlite::Result<ReturnRecord> {
    Ok(ReturnRecord {
        id: row.get("id")?,
        sale_id: row.get("sale_id")?,
        total_cents: row.get("total_cents")?,
        reason: row.get("reason")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
    })
}

#[tauri::command]
pub fn create_return(input: NewReturn, state: State<AppState>) -> CmdResult<ReturnRecord> {
    if input.items.is_empty() {
        return Err("La devolución no tiene ítems".to_string());
    }

    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let total_cents: i64 = input
        .items
        .iter()
        .map(|i| (i.unit_price_cents as f64 * i.qty).round() as i64)
        .sum();

    tx.execute(
        "INSERT INTO returns (sale_id, total_cents, reason, notes) VALUES (?1, ?2, ?3, ?4)",
        params![input.sale_id, total_cents, input.reason, input.notes],
    )
    .map_err(err)?;

    let return_id = tx.last_insert_rowid();

    for item in &input.items {
        tx.execute(
            "INSERT INTO return_items (return_id, product_id, barcode, name, unit_price_cents, qty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                return_id,
                item.product_id,
                item.barcode,
                item.name,
                item.unit_price_cents,
                item.qty,
            ],
        )
        .map_err(err)?;

        if let Some(pid) = item.product_id {
            let qty_before: i64 = tx
                .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0))
                .unwrap_or(0);

            tx.execute(
                "UPDATE products SET stock=stock+?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                params![item.qty as i64, pid],
            )
            .map_err(err)?;

            tx.execute(
                "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
                 VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Devolución #' || ?5)",
                params![
                    pid,
                    item.qty as i64,
                    qty_before,
                    qty_before + item.qty as i64,
                    return_id,
                ],
            )
            .map_err(err)?;
        }
    }

    tx.commit().map_err(err)?;

    let detail = format!("Devolución #{} - razón: {}", return_id, input.reason);
    log_action(&conn, None, "devolucion", "return", Some(return_id), Some(&detail));

    conn.query_row(
        "SELECT * FROM returns WHERE id=?1",
        params![return_id],
        row_to_return,
    )
    .map_err(err)
}

#[tauri::command]
pub fn list_returns(limit: i64, state: State<AppState>) -> CmdResult<Vec<ReturnRecord>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM returns ORDER BY created_at DESC LIMIT ?1")
        .map_err(err)?;

    let rows = stmt.query_map(params![limit], row_to_return).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_return_with_items(id: i64, state: State<AppState>) -> CmdResult<ReturnWithItems> {
    let conn = state.db.lock();

    let ret = conn
        .query_row("SELECT * FROM returns WHERE id=?1", params![id], row_to_return)
        .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT * FROM return_items WHERE return_id=?1")
        .map_err(err)?;

    let items: Vec<ReturnItem> = stmt
        .query_map(params![id], |row| {
            Ok(ReturnItem {
                id: row.get("id")?,
                return_id: row.get("return_id")?,
                product_id: row.get("product_id")?,
                barcode: row.get("barcode")?,
                name: row.get("name")?,
                unit_price_cents: row.get("unit_price_cents")?,
                qty: row.get("qty")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ReturnWithItems { ret, items })
}
