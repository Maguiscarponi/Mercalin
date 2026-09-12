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
pub mod stock;
pub mod suppliers;
pub mod users;
pub mod weighed_labels;

pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}

// Encontrado en la auditoría de seguridad: comandos como crear/editar/borrar
// usuarios o cambiar una contraseña ajena no verificaban en ningún lado que
// quien los llama sea realmente admin -- eso solo se ocultaba en el frontend
// (no se mostraba el botón). Cualquier llamada directa (consola del navegador,
// o el RPC de red) podía crear un admin nuevo sin ser admin. Esto NO es una
// autenticación real (no hay token de sesión: `actor_id` sigue siendo un
// argumento que el llamador elige) -- cierra el caso más simple de explotar
// (alguien sin sesión de admin abriendo devtools), no el de alguien que ya
// conoce o adivina el id de un admin real. Una solución completa necesitaría
// sesiones con token, que es un cambio de arquitectura más grande.
pub fn require_admin(conn: &rusqlite::Connection, actor_id: Option<i64>) -> CmdResult<()> {
    let role: Option<String> = actor_id.and_then(|id| {
        conn.query_row(
            "SELECT role FROM users WHERE id=?1 AND active=1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .ok()
    });
    if role.as_deref() == Some("admin") {
        Ok(())
    } else {
        Err("Esta acción requiere permisos de administrador.".to_string())
    }
}

#[cfg(test)]
mod require_admin_tests {
    use super::require_admin;
    use std::path::Path;

    fn insert_user(conn: &rusqlite::Connection, role: &str, active: bool) -> i64 {
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role, active) VALUES (?1, ?1, 'x', ?2, ?3)",
            rusqlite::params![format!("user_{}_{}", role, active), role, active as i64],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn rechaza_sin_actor_id() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        assert!(require_admin(&conn, None).is_err());
    }

    #[test]
    fn rechaza_cajero() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let cajero_id = insert_user(&conn, "cajero", true);
        // Este es el bug real: antes de la corrección, cualquier user_id (o
        // ninguno) pasaba sin chequear el rol -- un cajero podía crear otro
        // admin, cambiarle la contraseña a cualquiera, etc.
        assert!(require_admin(&conn, Some(cajero_id)).is_err());
    }

    #[test]
    fn rechaza_admin_inactivo() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let admin_id = insert_user(&conn, "admin", false);
        assert!(require_admin(&conn, Some(admin_id)).is_err());
    }

    #[test]
    fn rechaza_id_inexistente() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        assert!(require_admin(&conn, Some(999999)).is_err());
    }

    #[test]
    fn acepta_admin_activo() {
        let conn = crate::db::open_and_migrate(Path::new(":memory:")).unwrap();
        let admin_id = insert_user(&conn, "admin", true);
        assert!(require_admin(&conn, Some(admin_id)).is_ok());
    }
}
