use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{
    CashMovement, CashSession, CloseSessionInput, NewCashMovement, OpenSessionInput,
};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<CashSession> {
    let closed_at: Option<String> = row.get("closed_at")?;
    let status = if closed_at.is_some() {
        "closed".to_string()
    } else {
        "open".to_string()
    };
    Ok(CashSession {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        opened_at: row.get("opened_at")?,
        closed_at,
        opening_cents: row.get("opening_cents")?,
        closing_cents: row.get("closing_cents")?,
        notes: row.get("notes")?,
        status,
    })
}

#[tauri::command]
pub fn open_cash_session(
    input: OpenSessionInput,
    state: State<AppState>,
) -> CmdResult<CashSession> {
    let conn = state.db.lock();

    conn.execute(
        "INSERT INTO cash_sessions (user_id, opening_cents, notes, opened_at) VALUES (?1, ?2, ?3, datetime('now'))",
        params![input.user_id, input.opening_cents, input.notes],
    )
    .map_err(err)?;

    let id = conn.last_insert_rowid();
    let detail = format!("Apertura con ${:.2}", input.opening_cents as f64 / 100.0);
    log_action(&conn, input.user_id, "abrir_caja", "caja", Some(id), Some(&detail));
    let mut stmt = conn
        .prepare("SELECT * FROM cash_sessions WHERE id = ?1")
        .map_err(err)?;
    stmt.query_row(params![id], row_to_session).map_err(err)
}

#[tauri::command]
pub fn close_cash_session(
    input: CloseSessionInput,
    state: State<AppState>,
) -> CmdResult<CashSession> {
    let conn = state.db.lock();

    conn.execute(
        "UPDATE cash_sessions SET closed_at = CURRENT_TIMESTAMP, closing_cents = ?1, notes = COALESCE(?2, notes)
         WHERE id = ?3 AND closed_at IS NULL",
        params![input.closing_cents, input.notes, input.session_id],
    )
    .map_err(err)?;

    let detail = format!("Cierre con ${:.2}", input.closing_cents as f64 / 100.0);
    log_action(&conn, None, "cerrar_caja", "caja", Some(input.session_id), Some(&detail));

    let mut stmt = conn
        .prepare("SELECT * FROM cash_sessions WHERE id = ?1")
        .map_err(err)?;
    stmt.query_row(params![input.session_id], row_to_session)
        .map_err(err)
}

#[tauri::command]
pub fn get_current_session(state: State<AppState>) -> CmdResult<Option<CashSession>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1")
        .map_err(err)?;

    Ok(stmt.query_row([], row_to_session).ok())
}

#[tauri::command]
pub fn list_open_sessions(state: State<AppState>) -> CmdResult<Vec<CashSession>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC")
        .map_err(err)?;
    let rows = stmt.query_map([], row_to_session).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn list_cash_sessions(limit: i64, state: State<AppState>) -> CmdResult<Vec<CashSession>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT ?1")
        .map_err(err)?;

    let rows = stmt.query_map(params![limit], row_to_session).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn add_cash_movement(
    input: NewCashMovement,
    state: State<AppState>,
) -> CmdResult<CashMovement> {
    let conn = state.db.lock();

    // Verificar que la sesión está abierta
    let is_open: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE id = ?1 AND closed_at IS NULL",
            params![input.session_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)?
        > 0;

    if !is_open {
        return Err("La sesión de caja no está abierta".to_string());
    }

    conn.execute(
        "INSERT INTO cash_movements (session_id, movement_type, amount_cents, concept)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            input.session_id,
            input.movement_type,
            input.amount_cents,
            input.concept
        ],
    )
    .map_err(err)?;

    let id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare("SELECT * FROM cash_movements WHERE id = ?1")
        .map_err(err)?;

    stmt.query_row(params![id], |row| {
        Ok(CashMovement {
            id: row.get("id")?,
            session_id: row.get("session_id")?,
            movement_type: row.get("movement_type")?,
            amount_cents: row.get("amount_cents")?,
            concept: row.get("concept")?,
            created_at: row.get("created_at")?,
        })
    })
    .map_err(err)
}

#[tauri::command]
pub fn get_session_sales_total(
    session_id: i64,
    state: State<AppState>,
) -> CmdResult<i64> {
    let conn = state.db.lock();
    // Solo ventas en efectivo suman al saldo físico de caja
    let efectivo: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE session_id = ?1 AND payment_method = 'efectivo'",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    // Todas las ventas (para info)
    let todas: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    // Devolvemos efectivo + todas como JSON simplificado
    // En realidad devolvemos solo efectivo — la UI puede hacer llamadas separadas si necesita más
    let _ = todas; // evitar warning
    Ok(efectivo)
}

#[tauri::command]
pub fn get_session_all_sales_total(
    session_id: i64,
    state: State<AppState>,
) -> CmdResult<i64> {
    let conn = state.db.lock();
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(total)
}

#[tauri::command]
pub fn list_cash_movements(
    session_id: i64,
    state: State<AppState>,
) -> CmdResult<Vec<CashMovement>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT * FROM cash_movements WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![session_id], |row| {
            Ok(CashMovement {
                id: row.get("id")?,
                session_id: row.get("session_id")?,
                movement_type: row.get("movement_type")?,
                amount_cents: row.get("amount_cents")?,
                concept: row.get("concept")?,
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
