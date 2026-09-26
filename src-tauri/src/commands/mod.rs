pub mod arca;
pub mod audit;
pub mod backup;
pub mod caja;
// Todo el archivo es una herramienta de uso interno (generar la plantilla de catálogo
// para empaquetar con el instalador, ver generate_catalog_template) — no se compila en
// builds de release, ningún cliente real la necesita.
#[cfg(debug_assertions)]
pub mod catalog_import;
pub mod combos;
pub mod dashboard;
pub mod device;
pub mod insights;
pub mod clients;
pub mod config;
pub mod lots;
pub mod products;
pub mod promotions;
pub mod quotes;
pub mod reports;
pub mod returns;
pub mod sales;
pub mod session;
pub mod stock;
pub mod suppliers;
pub mod users;
pub mod weighed_labels;

use session::SessionStore;

pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}

fn role_rank(role: &str) -> i32 {
    match role {
        "admin" => 3,
        "supervisor" => 2,
        "cajero" => 1,
        _ => 0,
    }
}

// Encontrado en la auditoría de seguridad: comandos como crear/editar/borrar
// usuarios, Promociones, Presupuestos o la config de ARCA confiaban en un
// `actor_id` que el propio llamador elegía como argumento -- cualquiera con
// acceso a la consola del navegador (o al RPC de red de Multicaja) podía
// pasar el id de un admin real y actuar como si lo fuera. Ahora se exige un
// `session_token` real, generado por el servidor recién en `login` después
// de validar la contraseña (ver session.rs) -- ya no alcanza con adivinar o
// inventar un id. Además de resolver el token, se revalida `active` contra
// la base por si a esa persona la desactivaron después de loguearse.
//
// Devuelve el user_id ya resuelto (no el que mandó el llamador) para que
// quien llama pueda usarlo con confianza en log_action.
pub fn current_actor(conn: &rusqlite::Connection, sessions: &SessionStore, session_token: Option<&str>) -> CmdResult<(i64, String)> {
    let info = session::resolve_session(sessions, session_token)
        .ok_or_else(|| "Esta acción requiere haber iniciado sesión.".to_string())?;
    let still_active: bool = conn
        .query_row("SELECT active FROM users WHERE id=?1", rusqlite::params![info.user_id], |r| r.get::<_, i64>(0))
        .map(|v| v != 0)
        .unwrap_or(false);
    if !still_active {
        return Err("Esta sesión ya no es válida.".to_string());
    }
    Ok((info.user_id, info.role))
}

pub fn require_admin(conn: &rusqlite::Connection, sessions: &SessionStore, session_token: Option<&str>) -> CmdResult<i64> {
    let (user_id, role) = current_actor(conn, sessions, session_token)?;
    if role == "admin" {
        Ok(user_id)
    } else {
        Err("Esta acción requiere permisos de administrador.".to_string())
    }
}

pub fn require_role(conn: &rusqlite::Connection, sessions: &SessionStore, session_token: Option<&str>, min_role: &str) -> CmdResult<i64> {
    let (user_id, role) = current_actor(conn, sessions, session_token)?;
    if role_rank(&role) >= role_rank(min_role) {
        Ok(user_id)
    } else {
        Err(format!("Esta acción requiere permisos de {}.", if min_role == "admin" { "administrador" } else { "supervisor o administrador" }))
    }
}

#[cfg(test)]
mod require_role_tests {
    use super::{require_role, session};
    use std::path::Path;

    fn insert_user(conn: &rusqlite::Connection, role: &str) -> i64 {
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role, active) VALUES (?1, ?1, 'x', ?2, 1)",
            rusqlite::params![format!("user_{}", role), role],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn cajero_no_alcanza_para_supervisor() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let id = insert_user(&conn, "cajero");
        let store = session::new_session_store();
        let token = session::create_session(&store, id, "cajero");
        assert!(require_role(&conn, &store, Some(&token), "supervisor").is_err());
    }

    #[test]
    fn supervisor_alcanza_para_supervisor() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let id = insert_user(&conn, "supervisor");
        let store = session::new_session_store();
        let token = session::create_session(&store, id, "supervisor");
        assert!(require_role(&conn, &store, Some(&token), "supervisor").is_ok());
    }

    #[test]
    fn admin_alcanza_para_cualquier_nivel() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let id = insert_user(&conn, "admin");
        let store = session::new_session_store();
        let token = session::create_session(&store, id, "admin");
        assert!(require_role(&conn, &store, Some(&token), "supervisor").is_ok());
        assert!(require_role(&conn, &store, Some(&token), "admin").is_ok());
    }

    #[test]
    fn supervisor_no_alcanza_para_admin() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let id = insert_user(&conn, "supervisor");
        let store = session::new_session_store();
        let token = session::create_session(&store, id, "supervisor");
        assert!(require_role(&conn, &store, Some(&token), "admin").is_err());
    }

    #[test]
    fn sin_token_no_alcanza_para_nada() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let store = session::new_session_store();
        assert!(require_role(&conn, &store, None, "supervisor").is_err());
    }

    #[test]
    fn token_inventado_no_alcanza_para_nada() {
        // Este es exactamente el hueco que esto cierra: antes bastaba con
        // mandar el id de un admin real como argumento; ahora un token que
        // el servidor nunca emitió no resuelve a ningún usuario.
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let store = session::new_session_store();
        assert!(require_role(&conn, &store, Some("token-inventado"), "cajero").is_err());
    }
}

#[cfg(test)]
mod require_admin_tests {
    use super::{require_admin, session};
    use std::path::Path;

    fn insert_user(conn: &rusqlite::Connection, role: &str, active: bool) -> i64 {
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role, active) VALUES (?1, ?1, 'x', ?2, ?3)",
            rusqlite::params![format!("user_{}_{}", role, active), role, active as i64],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn rechaza_sin_token() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let store = session::new_session_store();
        assert!(require_admin(&conn, &store, None).is_err());
    }

    #[test]
    fn rechaza_cajero() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let cajero_id = insert_user(&conn, "cajero", true);
        let store = session::new_session_store();
        let token = session::create_session(&store, cajero_id, "cajero");
        // Este es el bug real: antes de la corrección, cualquier user_id (o
        // ninguno) pasaba sin chequear el rol -- un cajero podía crear otro
        // admin, cambiarle la contraseña a cualquiera, etc.
        assert!(require_admin(&conn, &store, Some(&token)).is_err());
    }

    #[test]
    fn rechaza_admin_desactivado_despues_de_loguearse() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let admin_id = insert_user(&conn, "admin", true);
        let store = session::new_session_store();
        let token = session::create_session(&store, admin_id, "admin");
        assert!(require_admin(&conn, &store, Some(&token)).is_ok());
        conn.execute("UPDATE users SET active=0 WHERE id=?1", rusqlite::params![admin_id]).unwrap();
        // La sesión sigue "viva" en el mapa, pero se revalida activo contra
        // la base en cada chequeo -- desactivar a alguien corta el acceso
        // incluso si ya tenía un token vigente.
        assert!(require_admin(&conn, &store, Some(&token)).is_err());
    }

    #[test]
    fn rechaza_token_inexistente() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let store = session::new_session_store();
        assert!(require_admin(&conn, &store, Some("no-existe")).is_err());
    }

    #[test]
    fn acepta_admin_activo() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let admin_id = insert_user(&conn, "admin", true);
        let store = session::new_session_store();
        let token = session::create_session(&store, admin_id, "admin");
        assert!(require_admin(&conn, &store, Some(&token)).is_ok());
    }
}
