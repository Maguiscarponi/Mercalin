use crate::commands::audit::log_action;
use crate::commands::session::{create_session, invalidate_session};
use crate::commands::{current_actor, err, require_admin, CmdResult};
use crate::models::{LoginResult, NewUser, User};
use crate::AppState;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tauri::State;

type HmacSha256 = Hmac<Sha256>;

// Esquema viejo (sin sal) -- se conserva SOLO para poder seguir verificando
// contraseñas de instalaciones de antes de este cambio. Nunca se usa para
// generar un hash nuevo.
fn hash_password_legacy(pw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pw.as_bytes());
    hex::encode(hasher.finalize())
}

fn generate_salt() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

// HMAC-SHA256 con una sal random por usuario -- mismo tipo de construcción
// (Hmac<Sha256>) que ya usa este proyecto para el token de red en device.rs,
// sin sumar una dependencia nueva. Devuelve (hash, sal); la sal se guarda
// junto al hash en password_salt.
fn hash_password_new(pw: &str) -> (String, String) {
    let salt = generate_salt();
    let hash = hmac_hash(pw, &salt);
    (hash, salt)
}

fn hmac_hash(pw: &str, salt: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(salt.as_bytes()).expect("HMAC acepta cualquier tamaño de clave");
    mac.update(pw.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

// Verifica una contraseña contra lo guardado, sin importar si es un hash
// viejo (sin sal) o uno nuevo (con sal) -- así una instalación existente no
// se queda afuera de golpe al actualizar.
fn verify_password(pw: &str, stored_hash: &str, salt: Option<&str>) -> bool {
    match salt {
        Some(s) if !s.is_empty() => hmac_hash(pw, s) == stored_hash,
        _ => hash_password_legacy(pw) == stored_hash,
    }
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
pub fn create_user(user: NewUser, session_token: Option<String>, state: State<AppState>) -> CmdResult<User> {
    // Encontrado en la auditoría: change_password sí exigía un mínimo de
    // caracteres, pero crear un usuario nuevo no -- se podía dar de alta con
    // una contraseña de un solo carácter.
    if user.password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let conn = state.db.lock();
    let actor_id = Some(require_admin(&conn, &state.sessions, session_token.as_deref())?);
    let (hash, salt) = hash_password_new(&user.password);
    conn.execute(
        "INSERT INTO users (username,full_name,password_hash,password_salt,role) VALUES (?1,?2,?3,?4,?5)",
        params![user.username, user.full_name, hash, salt, user.role],
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
pub fn update_user(user: User, session_token: Option<String>, state: State<AppState>) -> CmdResult<User> {
    let conn = state.db.lock();
    let actor_id = Some(require_admin(&conn, &state.sessions, session_token.as_deref())?);

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
    session_token: Option<String>,
    state: State<AppState>,
) -> CmdResult<()> {
    if new_password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let conn = state.db.lock();
    // Encontrado en la auditoría: no había ningún chequeo acá -- cualquiera
    // podía cambiarle la contraseña a CUALQUIER usuario (incluido un admin)
    // con solo pasar otro user_id, tomando control total de la cuenta. Se
    // permite cambiar la propia sin ser admin (caso normal de todos los días).
    // Ahora "la propia" se decide por el token de sesión real, no por un
    // user_id que el propio llamador podía elegir.
    let (actor_id, _role) = current_actor(&conn, &state.sessions, session_token.as_deref())?;
    if actor_id != user_id {
        require_admin(&conn, &state.sessions, session_token.as_deref())?;
    }
    let (hash, salt) = hash_password_new(&new_password);
    conn.execute(
        "UPDATE users SET password_hash=?1, password_salt=?2 WHERE id=?3",
        params![hash, salt, user_id],
    )
    .map_err(err)?;
    log_action(&conn, Some(actor_id), "cambiar_password", "usuario", Some(user_id), None);
    Ok(())
}

#[tauri::command]
pub fn delete_user(id: i64, session_token: Option<String>, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    let actor_id = Some(require_admin(&conn, &state.sessions, session_token.as_deref())?);

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
pub fn claim_admin_account(email: String, password: String, state: State<AppState>) -> CmdResult<LoginResult> {
    if password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let conn = state.db.lock();
    let (hash, salt) = hash_password_new(&password);
    let normalized_email = email.trim().to_lowercase();

    let existing: Option<i64> = conn
        .query_row("SELECT id FROM users WHERE username=?1", params![normalized_email], |r| r.get(0))
        .ok();

    let user_id = if let Some(id) = existing {
        conn.execute("UPDATE users SET password_hash=?1, password_salt=?2 WHERE id=?3", params![hash, salt, id]).map_err(err)?;
        id
    } else {
        let renamed = conn.execute(
            "UPDATE users SET username=?1, password_hash=?2, password_salt=?3 WHERE username='admin' AND role='admin'",
            params![normalized_email, hash, salt],
        ).map_err(err)?;
        if renamed > 0 {
            conn.query_row("SELECT id FROM users WHERE username=?1", params![normalized_email], |r| r.get(0)).map_err(err)?
        } else {
            conn.execute(
                "INSERT INTO users (username,full_name,password_hash,password_salt,role) VALUES (?1,?2,?3,?4,'admin')",
                params![normalized_email, "Administrador", hash, salt],
            ).map_err(err)?;
            conn.last_insert_rowid()
        }
    };

    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    let user = stmt.query_row(params![user_id], row_to_user).map_err(err)?;
    let session_token = create_session(&state.sessions, user.id, &user.role);
    Ok(LoginResult { user, session_token })
}

// "Olvidé mi contraseña", sin internet ni soporte: la clave de activación
// (la que llegó por mail al pedir la prueba o al comprar) prueba que quien la
// tiene es el dueño de esta instalación, así que alcanza para elegir una
// contraseña nueva para su cuenta. Tiene que ser una clave firmada, del mismo
// mail con el que está activado este Mercalin -- no sirve la de otro negocio.
// No importa si la clave es de una prueba ya vencida: acá solo se usa como
// prueba de identidad, no para activar nada. Devuelve el id del usuario.
pub(crate) fn reset_password_with_license(
    conn: &Connection,
    licensed_email: Option<&str>,
    email: &str,
    key: &str,
    new_password: &str,
) -> CmdResult<i64> {
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Err("Ingresá tu mail.".to_string());
    }
    if new_password.len() < 4 {
        return Err("La contraseña debe tener al menos 4 caracteres".to_string());
    }
    let info = crate::commands::device::parse_and_verify_license_key(key)
        .map_err(|_| "La clave de activación no es válida. Copiala entera, tal como llegó en el mail.".to_string())?;
    if info.email != normalized_email {
        return Err("Esa clave no corresponde a ese mail. Revisá que estén bien escritos.".to_string());
    }
    if licensed_email.map(|e| e.trim().to_lowercase()) != Some(normalized_email.clone()) {
        return Err("Este Mercalin está activado con otro mail.".to_string());
    }
    let user_id: i64 = conn
        .query_row("SELECT id FROM users WHERE username=?1", params![normalized_email], |r| r.get(0))
        .map_err(|_| "No hay una cuenta con ese mail en este Mercalin.".to_string())?;
    let (hash, salt) = hash_password_new(new_password);
    conn.execute(
        "UPDATE users SET password_hash=?1, password_salt=?2 WHERE id=?3",
        params![hash, salt, user_id],
    )
    .map_err(err)?;
    Ok(user_id)
}

#[tauri::command]
pub fn reset_password_with_license_key(email: String, key: String, new_password: String, state: State<AppState>) -> CmdResult<()> {
    let app_dir = crate::commands::device::app_dir_of(&state)?;
    let cfg = crate::commands::device::read_device_config(&app_dir);
    let conn = state.db.lock();
    let user_id = reset_password_with_license(&conn, cfg.license_email.as_deref(), &email, &key, &new_password)?;
    log_action(&conn, Some(user_id), "restablecer_password", "usuario", Some(user_id), Some("con la clave de activación"));
    Ok(())
}

#[tauri::command]
pub fn login(username: String, password: String, state: State<AppState>) -> CmdResult<LoginResult> {
    let conn = state.db.lock();
    // No se puede comparar el hash directo en el WHERE como antes: con sal
    // por usuario, el hash esperado depende de la fila, así que primero se
    // trae la fila por username y se verifica en Rust.
    let row: Option<(i64, String, Option<String>)> = conn
        .query_row(
            "SELECT id, password_hash, password_salt FROM users WHERE username=?1 AND active=1",
            params![username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();

    let (id, stored_hash, salt) = row.ok_or_else(|| "Usuario o contraseña incorrectos".to_string())?;
    if !verify_password(&password, &stored_hash, salt.as_deref()) {
        return Err("Usuario o contraseña incorrectos".to_string());
    }

    // Migración transparente: si esta cuenta todavía tenía el hash viejo sin
    // sal, se la pasa a uno nuevo con sal en este mismo login (ya se tiene
    // la contraseña en texto plano en este momento, es la única oportunidad
    // de hacerlo sin pedirle a nadie que la cambie a mano).
    if salt.as_deref().map(|s| s.is_empty()).unwrap_or(true) {
        let (new_hash, new_salt) = hash_password_new(&password);
        let _ = conn.execute(
            "UPDATE users SET password_hash=?1, password_salt=?2 WHERE id=?3",
            params![new_hash, new_salt, id],
        );
    }

    let mut stmt = conn
        .prepare("SELECT id,username,full_name,role,active,created_at FROM users WHERE id=?1")
        .map_err(err)?;
    let user = stmt.query_row(params![id], row_to_user).map_err(err)?;
    let session_token = create_session(&state.sessions, user.id, &user.role);
    Ok(LoginResult { user, session_token })
}

#[tauri::command]
pub fn logout(session_token: String, state: State<AppState>) -> CmdResult<()> {
    invalidate_session(&state.sessions, &session_token);
    Ok(())
}

#[cfg(test)]
mod reset_password_tests {
    use super::*;
    use crate::commands::device::make_license_key;

    const MAIL: &str = "duena@kiosco.com";

    fn db_con_admin() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, password_hash TEXT, password_salt TEXT, role TEXT, active INTEGER DEFAULT 1);",
        )
        .unwrap();
        let (hash, salt) = hash_password_new("vieja");
        conn.execute(
            "INSERT INTO users (username,full_name,password_hash,password_salt,role) VALUES (?1,'Administrador',?2,?3,'admin')",
            params![MAIL, hash, salt],
        )
        .unwrap();
        conn
    }

    fn entra_con(conn: &Connection, pw: &str) -> bool {
        let (hash, salt): (String, Option<String>) = conn
            .query_row("SELECT password_hash, password_salt FROM users WHERE username=?1", params![MAIL], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        verify_password(pw, &hash, salt.as_deref())
    }

    #[test]
    fn con_la_clave_de_compra_cambia_la_contrasena() {
        let conn = db_con_admin();
        let key = make_license_key("full", MAIL, 0);
        reset_password_with_license(&conn, Some(MAIL), "  Duena@Kiosco.com ", &key, "nueva123").unwrap();
        assert!(entra_con(&conn, "nueva123"));
        assert!(!entra_con(&conn, "vieja"));
    }

    #[test]
    fn sirve_tambien_una_clave_de_prueba_ya_vencida() {
        // Solo prueba identidad: una prueba vencida sigue siendo la clave que
        // le llegó a esa persona.
        let conn = db_con_admin();
        let key = make_license_key("trial", MAIL, 1_000);
        reset_password_with_license(&conn, Some(MAIL), MAIL, &key, "nueva123").unwrap();
        assert!(entra_con(&conn, "nueva123"));
    }

    #[test]
    fn rechaza_una_clave_inventada_o_de_otro_mail() {
        let conn = db_con_admin();
        assert!(reset_password_with_license(&conn, Some(MAIL), MAIL, "cualquier.cosa", "nueva123").is_err());
        let de_otro = make_license_key("full", "otro@negocio.com", 0);
        assert!(reset_password_with_license(&conn, Some(MAIL), MAIL, &de_otro, "nueva123").is_err());
        assert!(entra_con(&conn, "vieja"));
    }

    #[test]
    fn rechaza_si_este_mercalin_esta_activado_con_otro_mail() {
        // Una clave válida de otro negocio no puede tomar una cuenta de acá,
        // aunque en esta base exista un usuario con ese mail.
        let conn = db_con_admin();
        let key = make_license_key("full", MAIL, 0);
        assert!(reset_password_with_license(&conn, Some("otro@negocio.com"), MAIL, &key, "nueva123").is_err());
        assert!(reset_password_with_license(&conn, None, MAIL, &key, "nueva123").is_err());
        assert!(entra_con(&conn, "vieja"));
    }

    #[test]
    fn rechaza_contrasena_muy_corta() {
        let conn = db_con_admin();
        let key = make_license_key("full", MAIL, 0);
        assert!(reset_password_with_license(&conn, Some(MAIL), MAIL, &key, "123").is_err());
        assert!(entra_con(&conn, "vieja"));
    }
}

#[cfg(test)]
mod password_tests {
    use super::*;

    #[test]
    fn hash_nuevo_incluye_sal_y_verifica_ok() {
        let (hash, salt) = hash_password_new("1234");
        assert!(!salt.is_empty());
        assert!(verify_password("1234", &hash, Some(&salt)));
        assert!(!verify_password("otra", &hash, Some(&salt)));
    }

    #[test]
    fn dos_hashes_de_la_misma_contrasena_no_son_iguales() {
        // Cada usuario tiene su propia sal random -- dos cuentas con la misma
        // contraseña no deben terminar con el mismo hash guardado.
        let (hash_a, salt_a) = hash_password_new("1234");
        let (hash_b, salt_b) = hash_password_new("1234");
        assert_ne!(salt_a, salt_b);
        assert_ne!(hash_a, hash_b);
    }

    #[test]
    fn sigue_verificando_el_hash_viejo_sin_sal() {
        // Este es el caso real de una instalación de antes de este cambio:
        // password_salt es NULL, y el hash guardado es SHA-256 simple.
        let legacy_hash = hash_password_legacy("admin");
        assert!(verify_password("admin", &legacy_hash, None));
        assert!(!verify_password("otra", &legacy_hash, None));
    }
}
