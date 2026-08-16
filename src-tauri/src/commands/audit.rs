use crate::commands::{err, CmdResult};
use crate::models::AuditEntry;
use crate::AppState;
use rusqlite::params;
use tauri::State;

pub fn log_action(
    conn: &rusqlite::Connection,
    user_id: Option<i64>,
    action: &str,
    entity: &str,
    entity_id: Option<i64>,
    detail: Option<&str>,
) {
    let _ = conn.execute(
        "INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user_id, action, entity, entity_id, detail],
    );
}

#[tauri::command]
pub fn list_audit_log(limit: i64, state: State<AppState>) -> CmdResult<Vec<AuditEntry>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.user_id, u.full_name as user_name, a.action, a.entity, a.entity_id, a.detail, a.created_at
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC
             LIMIT ?1",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                user_name: row.get("user_name")?,
                action: row.get("action")?,
                entity: row.get("entity")?,
                entity_id: row.get("entity_id")?,
                detail: row.get("detail")?,
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
