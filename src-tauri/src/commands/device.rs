// Identidad de red de "este equipo" para multicaja: standalone / servidor / cliente.
// Vive en un archivo JSON aparte de la base SQLite (no en la tabla `config`)
// a propósito: cuando una caja se conecta como cliente, su `kiosco.db` local
// se reemplaza por completo con una copia de la base del servidor (ver
// `bootstrap_from_server`), y si el modo/IP vivieran en esa misma base se
// perderían justo en ese reemplazo.

use crate::commands::{err, CmdResult};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    pub mode: String, // "standalone" | "server" | "client"
    pub server_addr: Option<String>, // "ip:puerto", solo si mode == "client"
}

impl Default for DeviceConfig {
    fn default() -> Self {
        DeviceConfig { mode: "standalone".to_string(), server_addr: None }
    }
}

fn config_path(app_dir: &Path) -> std::path::PathBuf {
    app_dir.join("device_config.json")
}

pub fn read_device_config(app_dir: &Path) -> DeviceConfig {
    std::fs::read_to_string(config_path(app_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_device_config(app_dir: &Path, cfg: &DeviceConfig) -> CmdResult<()> {
    let json = serde_json::to_string_pretty(cfg).map_err(err)?;
    std::fs::write(config_path(app_dir), json).map_err(err)
}

fn app_dir_of(state: &State<AppState>) -> CmdResult<std::path::PathBuf> {
    state
        .db_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "No se pudo determinar la carpeta de datos".to_string())
}

#[tauri::command]
pub fn get_device_config(state: State<AppState>) -> CmdResult<DeviceConfig> {
    Ok(read_device_config(&app_dir_of(&state)?))
}

#[tauri::command]
pub fn set_device_config(config: DeviceConfig, state: State<AppState>) -> CmdResult<()> {
    write_device_config(&app_dir_of(&state)?, &config)
}

// Descarga una copia completa de la base del servidor y la deja lista para
// que el próximo arranque de la app la use (ver el chequeo al inicio de
// `setup()` en lib.rs). No toca la base actualmente abierta -- reemplazarla
// en caliente mientras hay una conexión activa es innecesariamente riesgoso;
// pedirle a la dueña que reinicie es el mismo patrón que ya usa "modo tablet".
#[tauri::command]
pub fn bootstrap_from_server(server_addr: String, state: State<AppState>) -> CmdResult<String> {
    let url = format!("http://{}/api/db_snapshot", server_addr);
    let response = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| format!("No se pudo conectar con el servidor ({}): {}", server_addr, e))?;

    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Error descargando los datos del servidor: {}", e))?;

    if bytes.is_empty() {
        return Err("El servidor devolvió una base vacía. Probá de nuevo.".to_string());
    }

    let app_dir = app_dir_of(&state)?;
    let staging_path = app_dir.join("kiosco.db.pending-client-bootstrap");
    std::fs::write(&staging_path, &bytes).map_err(err)?;

    write_device_config(
        &app_dir,
        &DeviceConfig { mode: "client".to_string(), server_addr: Some(server_addr) },
    )?;

    Ok("Descarga completa. Reiniciá Punto Simple para terminar de conectar esta caja.".to_string())
}

// Vuelve esta caja a modo standalone (no toca la base local -- solo deja de
// tratarla como copia de la del servidor).
#[tauri::command]
pub fn disconnect_client(state: State<AppState>) -> CmdResult<()> {
    write_device_config(&app_dir_of(&state)?, &DeviceConfig::default())
}
