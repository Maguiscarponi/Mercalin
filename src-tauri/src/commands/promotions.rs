use crate::commands::{err, CmdResult};
use crate::models::{NewPromotion, Promotion};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_promo(row: &rusqlite::Row) -> rusqlite::Result<Promotion> {
    Ok(Promotion {
        id: row.get("id")?,
        name: row.get("name")?,
        promo_type: row.get("promo_type")?,
        value: row.get("value")?,
        applies_to: row.get("applies_to")?,
        target_id: row.get("target_id")?,
        target_name: row.get("target_name")?,
        active: row.get::<_, i64>("active")? != 0,
        starts_at: row.get("starts_at")?,
        ends_at: row.get("ends_at")?,
        days_of_week: row.get("days_of_week").unwrap_or(None),
        time_start: row.get("time_start").unwrap_or(None),
        time_end: row.get("time_end").unwrap_or(None),
        min_qty: row.get("min_qty").unwrap_or(None),
        created_at: row.get("created_at")?,
    })
}

#[tauri::command]
pub fn list_promotions(state: State<AppState>) -> CmdResult<Vec<Promotion>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM promotions ORDER BY active DESC, created_at DESC")
        .map_err(err)?;
    let rows = stmt.query_map([], row_to_promo).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_promotion(promo: NewPromotion, state: State<AppState>) -> CmdResult<Promotion> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO promotions (name,promo_type,value,applies_to,target_id,target_name,active,
                                  starts_at,ends_at,days_of_week,time_start,time_end,min_qty)
         VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,?9,?10,?11,?12)",
        params![
            promo.name,
            promo.promo_type,
            promo.value,
            promo.applies_to,
            promo.target_id,
            promo.target_name,
            promo.starts_at,
            promo.ends_at,
            promo.days_of_week,
            promo.time_start,
            promo.time_end,
            promo.min_qty,
        ],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare("SELECT * FROM promotions WHERE id=?1").map_err(err)?;
    stmt.query_row(params![id], row_to_promo).map_err(err)
}

#[tauri::command]
pub fn update_promotion(promo: Promotion, state: State<AppState>) -> CmdResult<Promotion> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE promotions SET name=?1,promo_type=?2,value=?3,applies_to=?4,
         target_id=?5,target_name=?6,active=?7,starts_at=?8,ends_at=?9,
         days_of_week=?10,time_start=?11,time_end=?12,min_qty=?13
         WHERE id=?14",
        params![
            promo.name,
            promo.promo_type,
            promo.value,
            promo.applies_to,
            promo.target_id,
            promo.target_name,
            promo.active as i64,
            promo.starts_at,
            promo.ends_at,
            promo.days_of_week,
            promo.time_start,
            promo.time_end,
            promo.min_qty,
            promo.id,
        ],
    )
    .map_err(err)?;
    let mut stmt = conn.prepare("SELECT * FROM promotions WHERE id=?1").map_err(err)?;
    stmt.query_row(params![promo.id], row_to_promo).map_err(err)
}

#[tauri::command]
pub fn toggle_promotion(id: i64, state: State<AppState>) -> CmdResult<Promotion> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE promotions SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    let mut stmt = conn.prepare("SELECT * FROM promotions WHERE id=?1").map_err(err)?;
    stmt.query_row(params![id], row_to_promo).map_err(err)
}

#[tauri::command]
pub fn delete_promotion(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute("DELETE FROM promotions WHERE id=?1", params![id])
        .map_err(err)?;
    Ok(())
}
