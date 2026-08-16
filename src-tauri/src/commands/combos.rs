use crate::commands::{err, CmdResult};
use crate::models::{Combo, ComboItem, ComboWithItems, NewCombo};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_combo(row: &rusqlite::Row) -> rusqlite::Result<Combo> {
    Ok(Combo {
        id: row.get("id")?,
        name: row.get("name")?,
        barcode: row.get("barcode")?,
        price_cents: row.get("price_cents")?,
        cost_cents: row.get("cost_cents").unwrap_or(0),
        active: row.get::<_, i64>("active")? != 0,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn fetch_combo_items(conn: &rusqlite::Connection, combo_id: i64) -> CmdResult<Vec<ComboItem>> {
    let mut stmt = conn
        .prepare(
            "SELECT ci.id, ci.combo_id, ci.product_id, ci.qty,
                    p.name as product_name, p.barcode as product_barcode, p.cost_cents as unit_cost_cents
             FROM combo_items ci
             JOIN products p ON p.id = ci.product_id
             WHERE ci.combo_id = ?1
             ORDER BY ci.id",
        )
        .map_err(err)?;
    let x: Vec<ComboItem> = stmt
        .query_map(params![combo_id], |row| {
            Ok(ComboItem {
                id: row.get("id")?,
                combo_id: row.get("combo_id")?,
                product_id: row.get("product_id")?,
                product_name: row.get("product_name")?,
                product_barcode: row.get("product_barcode")?,
                qty: row.get("qty")?,
                unit_cost_cents: row.get("unit_cost_cents").unwrap_or(0),
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(x)
}

fn fetch_combo_with_items(conn: &rusqlite::Connection, combo_id: i64) -> CmdResult<ComboWithItems> {
    let mut stmt = conn.prepare(
        "SELECT c.*,
                COALESCE((SELECT SUM(ci.qty * p.cost_cents)
                          FROM combo_items ci JOIN products p ON p.id=ci.product_id
                          WHERE ci.combo_id=c.id), 0) as cost_cents
         FROM combos c WHERE c.id=?1",
    ).map_err(err)?;
    let combo = stmt.query_row(params![combo_id], row_to_combo).map_err(err)?;
    let items = fetch_combo_items(conn, combo_id)?;
    Ok(ComboWithItems { combo, items })
}

#[tauri::command]
pub fn list_combos(state: State<AppState>) -> CmdResult<Vec<ComboWithItems>> {
    let conn = state.db.lock();
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM combos ORDER BY active DESC, name ASC")
            .map_err(err)?;
        let x: Vec<i64> = stmt.query_map([], |r| r.get(0))
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        x
    };
    ids.iter()
        .map(|&id| fetch_combo_with_items(&conn, id))
        .collect()
}

// Reverse-lookup: en qué combos participa un producto -- para avisar antes de
// borrarlo/desactivarlo (un combo activo con un componente inactivo sigue
// vendiéndose en Caja sin que nadie se entere) y para mostrarlo en su ficha.
#[tauri::command]
pub fn list_combos_for_product(product_id: i64, state: State<AppState>) -> CmdResult<Vec<Combo>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT c.* FROM combos c
             JOIN combo_items ci ON ci.combo_id = c.id
             WHERE ci.product_id = ?1
             ORDER BY c.active DESC, c.name ASC",
        )
        .map_err(err)?;
    let rows = stmt.query_map(params![product_id], row_to_combo).map_err(err)?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn list_active_combos(state: State<AppState>) -> CmdResult<Vec<ComboWithItems>> {
    let conn = state.db.lock();
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM combos WHERE active=1 ORDER BY name ASC")
            .map_err(err)?;
        let x: Vec<i64> = stmt.query_map([], |r| r.get(0))
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        x
    };
    ids.iter()
        .map(|&id| fetch_combo_with_items(&conn, id))
        .collect()
}

#[tauri::command]
pub fn find_combo_by_barcode(barcode: String, state: State<AppState>) -> CmdResult<Option<ComboWithItems>> {
    let conn = state.db.lock();
    let id: Option<i64> = conn
        .query_row("SELECT id FROM combos WHERE barcode=?1 AND active=1", params![barcode], |r| r.get(0))
        .ok();
    match id {
        None => Ok(None),
        Some(id) => fetch_combo_with_items(&conn, id).map(Some),
    }
}

#[tauri::command]
pub fn create_combo(input: NewCombo, state: State<AppState>) -> CmdResult<ComboWithItems> {
    if input.name.trim().is_empty() {
        return Err("El nombre del combo es obligatorio".into());
    }
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO combos (name, barcode, price_cents, notes, active, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, CURRENT_TIMESTAMP)",
        params![input.name.trim(), input.barcode, input.price_cents, input.notes],
    )
    .map_err(err)?;
    let combo_id = tx.last_insert_rowid();
    for item in &input.items {
        tx.execute(
            "INSERT INTO combo_items (combo_id, product_id, qty) VALUES (?1, ?2, ?3)",
            params![combo_id, item.product_id, item.qty],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    fetch_combo_with_items(&conn, combo_id)
}

#[tauri::command]
pub fn update_combo(id: i64, input: NewCombo, state: State<AppState>) -> CmdResult<ComboWithItems> {
    if input.name.trim().is_empty() {
        return Err("El nombre del combo es obligatorio".into());
    }
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "UPDATE combos SET name=?1, barcode=?2, price_cents=?3, notes=?4, updated_at=CURRENT_TIMESTAMP WHERE id=?5",
        params![input.name.trim(), input.barcode, input.price_cents, input.notes, id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM combo_items WHERE combo_id=?1", params![id])
        .map_err(err)?;
    for item in &input.items {
        tx.execute(
            "INSERT INTO combo_items (combo_id, product_id, qty) VALUES (?1, ?2, ?3)",
            params![id, item.product_id, item.qty],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    fetch_combo_with_items(&conn, id)
}

#[tauri::command]
pub fn toggle_combo(id: i64, state: State<AppState>) -> CmdResult<Combo> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE combos SET active=CASE WHEN active=1 THEN 0 ELSE 1 END, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    let mut stmt = conn.prepare(
        "SELECT c.*,
                COALESCE((SELECT SUM(ci.qty * p.cost_cents)
                          FROM combo_items ci JOIN products p ON p.id=ci.product_id
                          WHERE ci.combo_id=c.id), 0) as cost_cents
         FROM combos c WHERE c.id=?1",
    ).map_err(err)?;
    stmt.query_row(params![id], row_to_combo).map_err(err)
}

#[tauri::command]
pub fn delete_combo(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute("DELETE FROM combos WHERE id=?1", params![id])
        .map_err(err)?;
    Ok(())
}
