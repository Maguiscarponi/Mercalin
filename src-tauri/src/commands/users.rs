use crate::commands::audit::log_action;
use crate::commands::{err, CmdResult};
use crate::models::{NewUser, User};
use crate::AppState;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tauri::State;

fn hash_password(pw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pw.as_bytes());
    hex::encode(hasher.finalize())
}

// Cuántos admins activos hay, sin contar (opcionalmente) uno en particular —
// para no permitir desactivar/degradar al último admin y dejar a alguien
// afuera de Usuarios/Configuración sin ninguna forma de arreglarlo desde la app.
fn other_active_admins(conn: &Connection, exclude_id: Option<i64>) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND id != ?1",
        params![exclude_id.unwrap_or(-1)],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn friendly_username_error<E: std::fmt::Display>(e: E) -> String {
    let s = err(e);
    if s.contains("UNIQUE constraint failed") && s.contains("username") {
        "Ya existe un usuario con ese nombre de usuario.".to_string()
    } else {
        s
    }
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
pub fn create_user(user: NewUser, actor_id: Option<i64>, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();
    let hash = hash_password(&user.password);
    conn.execute(
        "INSERT INTO users (username,full_name,password_hash,role) VALUES (?1,?2,?3,?4)",
        params![user.username, user.full_name, hash, user.role],
    )
    .map_err(friendly_username_error)?;
    let id = conn.last_insert_rowid();
    log_action(&conn, actor_id, "crear", "usuario", Some(id), Some(&format!("{} ({})", user.full_name, user.role)));
    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    stmt.query_row(params![id], row_to_user).map_err(err)
}

#[tauri::command]
pub fn update_user(user: User, actor_id: Option<i64>, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();

    // Si esta persona es admin activo hoy y el cambio la degrada o desactiva,
    // no dejar que sea el último — se quedaría sin nadie que pueda entrar a
    // Usuarios/Configuración a arreglarlo.
    let current: Option<(String, i64)> = conn
        .query_row("SELECT role, active FROM users WHERE id=?1", params![user.id], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    if let Some((current_role, current_active)) = current {
        let was_active_admin = current_role == "admin" && current_active != 0;
        let will_be_active_admin = user.role == "admin" && user.active;
        if was_active_admin && !will_be_active_admin && other_active_admins(&conn, Some(user.id)) == 0 {
            return Err("No se puede quitar el rol de admin ni desactivar a esta persona: es el único administrador activo.".to_string());
        }
    }

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
    .map_err(friendly_username_error)?;
    log_action(&conn, actor_id, "editar", "usuario", Some(user.id), Some(&format!("{} ({}, {})", user.full_name, user.role, if user.active { "activo" } else { "inactivo" })));
    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    stmt.query_row(params![user.id], row_to_user).map_err(err)
}

#[tauri::command]
pub fn change_password(
    user_id: i64,
    new_password: String,
    actor_id: Option<i64>,
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
    log_action(&conn, actor_id, "cambiar_password", "usuario", Some(user_id), None);
    Ok(())
}

#[tauri::command]
pub fn delete_user(id: i64, actor_id: Option<i64>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();

    let current_role: Option<String> = conn
        .query_row("SELECT role FROM users WHERE id=?1 AND active=1", params![id], |r| r.get(0))
        .ok();
    if current_role.as_deref() == Some("admin") && other_active_admins(&conn, Some(id)) == 0 {
        return Err("No se puede desactivar a esta persona: es el único administrador activo.".to_string());
    }

    conn.execute(
        "UPDATE users SET active=0 WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    log_action(&conn, actor_id, "desactivar", "usuario", Some(id), None);
    Ok(())
}

// Se llama una sola vez, justo después de activar la licencia (ver Activation.tsx):
// "adopta" la cuenta admin/admin que ya viene sembrada de fábrica, poniéndole el
// mail real del comprador como usuario y la contraseña que eligió. Así el login
// de todos los días es con su mail, no con credenciales genéricas que cualquiera
// que instale la app conoce de antemano.
#[tauri::command]
pub fn claim_admin_account(email: String, password: String, state: State<AppState>) -> CmdResult<User> {
    if password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let conn = state.db.lock();
    let hash = hash_password(&password);
    let normalized_email = email.trim().to_lowercase();

    let existing: Option<i64> = conn
        .query_row("SELECT id FROM users WHERE username=?1", params![normalized_email], |r| r.get(0))
        .ok();

    let user_id = if let Some(id) = existing {
        conn.execute("UPDATE users SET password_hash=?1 WHERE id=?2", params![hash, id]).map_err(err)?;
        id
    } else {
        let renamed = conn.execute(
            "UPDATE users SET username=?1, password_hash=?2 WHERE username='admin' AND role='admin'",
            params![normalized_email, hash],
        ).map_err(err)?;
        if renamed > 0 {
            conn.query_row("SELECT id FROM users WHERE username=?1", params![normalized_email], |r| r.get(0)).map_err(err)?
        } else {
            conn.execute(
                "INSERT INTO users (username,full_name,password_hash,role) VALUES (?1,?2,?3,'admin')",
                params![normalized_email, "Administrador", hash],
            ).map_err(err)?;
            conn.last_insert_rowid()
        }
    };

    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    stmt.query_row(params![user_id], row_to_user).map_err(err)
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
