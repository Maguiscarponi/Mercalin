use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::ConfigEntry;
use crate::AppState;
use rusqlite::params;
use tauri::State;

// Valores que vale la pena poder auditar (quién cambió el CUIT/razón social
// del negocio y cuándo, por ejemplo) sin llenar Auditoría de ruido por cada
// toggle de sonido o cada tilde de "combos habilitados". No es un control de
// acceso (eso sigue siendo <RequireRole> en el router de React) -- Activation.tsx
// y algunos stores (stockTracking, combosEnabled) llaman a set_config sin un
// usuario logueado todavía o desde pantallas que no son de admin, así que
// exigir un rol acá rompería esos flujos legítimos. Ver Sistema en la auditoría.
const SENSITIVE_CONFIG_KEYS: &[&str] = &[
    "business_name", "business_address", "business_phone", "business_cuit",
    "max_discount_pct_no_pin", "min_margin_pct",
];

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
pub fn set_config(entry: ConfigEntry, actor_id: Option<i64>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        params![entry.key, entry.value],
    )
    .map_err(err)?;
    if SENSITIVE_CONFIG_KEYS.contains(&entry.key.as_str()) {
        log_action(&conn, actor_id, "editar", "configuracion", None, Some(&format!("{} = {}", entry.key, entry.value)));
    }
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
pub fn set_multiple_config(entries: Vec<ConfigEntry>, actor_id: Option<i64>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    let mut changed_sensitive: Vec<String> = Vec::new();
    for entry in entries {
        conn.execute(
            "INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
            params![entry.key, entry.value],
        )
        .map_err(err)?;
        if SENSITIVE_CONFIG_KEYS.contains(&entry.key.as_str()) {
            changed_sensitive.push(format!("{}={}", entry.key, entry.value));
        }
    }
    if !changed_sensitive.is_empty() {
        log_action(&conn, actor_id, "editar", "configuracion", None, Some(&changed_sensitive.join(", ")));
    }
    Ok(())
}
