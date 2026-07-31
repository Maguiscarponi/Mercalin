use crate::commands::{err, CmdResult};
use crate::models::{NewUser, User};
use crate::AppState;
use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::State;

fn hash_password(pw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pw.as_bytes());
    hex::encode(hasher.finalize())
}

fn row_to_user(row: &rusqlite::Row) -> rusqlite::Result<User> {
    Ok(User {
        id: row.get("id")?,
        username: row.get("username")?,
        full_name: row.get("full_name")?,
        role: row.get("role")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
    })
}

#[tauri::command]
pub fn list_users(state: State<AppState>) -> CmdResult<Vec<User>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users ORDER BY full_name")
        .map_err(err)?;
    let rows = stmt.query_map([], row_to_user).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_user(user: NewUser, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();
    let hash = hash_password(&user.password);
    conn.execute(
        "INSERT INTO users (username,full_name,password_hash,role) VALUES (?1,?2,?3,?4)",
        params![user.username, user.full_name, hash, user.role],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    stmt.query_row(params![id], row_to_user).map_err(err)
}

#[tauri::command]
pub fn update_user(user: User, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE users SET username=?1,full_name=?2,role=?3,active=?4 WHERE id=?5",
        params![
            user.username,
            user.full_name,
            user.role,
            user.active as i64,
            user.id
        ],
    )
    .map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    stmt.query_row(params![user.id], row_to_user).map_err(err)
}

#[tauri::command]
pub fn change_password(
    user_id: i64,
    new_password: String,
    state: State<AppState>,
) -> CmdResult<()> {
    if new_password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let conn = state.db.lock();
    let hash = hash_password(&new_password);
    conn.execute(
        "UPDATE users SET password_hash=?1 WHERE id=?2",
        params![hash, user_id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_user(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE users SET active=0 WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn login(username: String, password: String, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();
    let hash = hash_password(&password);
    conn.query_row(
        "SELECT id,username,full_name,role,active,created_at FROM users WHERE username=?1 AND password_hash=?2 AND active=1",
        params![username, hash],
        row_to_user,
    )
    .map_err(|_| "Usuario o contraseña incorrectos".to_string())
}
