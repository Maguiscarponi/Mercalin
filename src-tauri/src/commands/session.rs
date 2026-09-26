// Sesiones reales con token, en memoria del proceso (se pierden al reiniciar
// la app -- hay que volver a loguearse, igual que la mayoría de los sistemas
// reales; no vive en la base para no complicar backup/restore con datos de
// sesión que de todos modos no tiene sentido conservar entre reinicios).
//
// Encontrado en la auditoría de seguridad: hasta acá, las acciones de admin
// (crear/editar/borrar usuarios, Promociones, Presupuestos, config de ARCA)
// confiaban en un `actor_id` que el propio LLAMADOR elegía como argumento --
// cualquiera con acceso a la consola del navegador (o al RPC de red de
// Multicaja) podía pasar el id de un admin real y actuar como si lo fuera.
// Ahora `login` devuelve un token random que solo el servidor generó después
// de validar la contraseña real; ese token es lo único que despues autoriza
// una acción de admin/supervisor -- ya no alcanza con adivinar o inventar un id.
//
// En modo Multicaja (servidor + cajas cliente), este mapa vive en el proceso
// SERVIDOR: tanto sus propias acciones locales como las de cualquier caja
// cliente (que le llegan acá vía rpc.rs) se resuelven contra el mismo mapa,
// así que el mecanismo es uniforme sin importar qué terminal hizo el pedido.

use parking_lot::Mutex;
use rand::RngCore;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub user_id: i64,
    pub role: String,
}

pub type SessionStore = Arc<Mutex<HashMap<String, SessionInfo>>>;

pub fn new_session_store() -> SessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn create_session(store: &SessionStore, user_id: i64, role: &str) -> String {
    let token = generate_token();
    store.lock().insert(token.clone(), SessionInfo { user_id, role: role.to_string() });
    token
}

pub fn resolve_session(store: &SessionStore, token: Option<&str>) -> Option<SessionInfo> {
    let t = token?;
    if t.is_empty() { return None; }
    store.lock().get(t).cloned()
}

pub fn invalidate_session(store: &SessionStore, token: &str) {
    store.lock().remove(token);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crea_y_resuelve_una_sesion() {
        let store = new_session_store();
        let token = create_session(&store, 7, "admin");
        let info = resolve_session(&store, Some(&token)).unwrap();
        assert_eq!(info.user_id, 7);
        assert_eq!(info.role, "admin");
    }

    #[test]
    fn token_invalido_no_resuelve_nada() {
        let store = new_session_store();
        create_session(&store, 7, "admin");
        assert!(resolve_session(&store, Some("token-inventado")).is_none());
        assert!(resolve_session(&store, None).is_none());
    }

    #[test]
    fn dos_sesiones_generan_tokens_distintos() {
        let store = new_session_store();
        let a = create_session(&store, 1, "cajero");
        let b = create_session(&store, 2, "cajero");
        assert_ne!(a, b);
    }

    #[test]
    fn invalidar_saca_la_sesion() {
        let store = new_session_store();
        let token = create_session(&store, 1, "admin");
        invalidate_session(&store, &token);
        assert!(resolve_session(&store, Some(&token)).is_none());
    }
}
