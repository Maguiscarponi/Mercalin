use crate::commands::{err, CmdResult};
use crate::models::ConfigEntry;
use crate::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn get_config(key: String, state: State<AppState>) -> CmdResult<Option<String>> {
    let conn = state.db.lock();
    Ok(conn
        .query_row(
            "SELECT value FROM config WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok())
}

#[tauri::command]
pub fn set_config(entry: ConfigEntry, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        params![entry.key, entry.value],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn get_all_config(state: State<AppState>) -> CmdResult<Vec<ConfigEntry>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare("SELECT key, value FROM config ORDER BY key").map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ConfigEntry {
                key: row.get(0)?,
                value: row.get(1)?,
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
pub fn set_multiple_config(entries: Vec<ConfigEntry>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    for entry in entries {
        conn.execute(
            "INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
            params![entry.key, entry.value],
        )
        .map_err(err)?;
    }
    Ok(())
}
