// Identidad de red de "este equipo" para multicaja: standalone / servidor / cliente.
// Vive en un archivo JSON aparte de la base SQLite (no en la tabla `config`)
// a propósito: cuando una caja se conecta como cliente, su `kiosco.db` local
// se reemplaza por completo con una copia de la base del servidor (ver
// `bootstrap_from_server`), y si el modo/IP vivieran en esa misma base se
// perderían justo en ese reemplazo.

use crate::commands::{err, CmdResult};
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    pub mode: String, // "standalone" | "server" | "client"
    pub server_addr: Option<String>, // "ip:puerto", solo si mode == "client"
    // Licencia de esta instalación (ver commands::license). Vive acá y no en la
    // tabla `config` de SQLite por el mismo motivo que mode/server_addr: no debe
    // perderse cuando esta caja se conecta como cliente y su base se reemplaza.
    pub license_email: Option<String>,
    pub license_key: Option<String>,
}

impl Default for DeviceConfig {
    fn default() -> Self {
        DeviceConfig { mode: "standalone".to_string(), server_addr: None, license_email: None, license_key: None }
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

    // Se parte de la config ya guardada (no de un DeviceConfig::default() nuevo)
    // para no perder la licencia de esta instalación al pasar a modo cliente.
    let mut cfg = read_device_config(&app_dir);
    cfg.mode = "client".to_string();
    cfg.server_addr = Some(server_addr);
    write_device_config(&app_dir, &cfg)?;

    Ok("Descarga completa. Reiniciá Punto Simple para terminar de conectar esta caja.".to_string())
}

// Vuelve esta caja a modo standalone (no toca la base local -- solo deja de
// tratarla como copia de la del servidor). Igual que en bootstrap_from_server,
// se preserva la licencia -- desconectar de multicaja no debe desactivar la app.
#[tauri::command]
pub fn disconnect_client(state: State<AppState>) -> CmdResult<()> {
    let app_dir = app_dir_of(&state)?;
    let mut cfg = read_device_config(&app_dir);
    cfg.mode = "standalone".to_string();
    cfg.server_addr = None;
    write_device_config(&app_dir, &cfg)
}

// ─── Licencia de esta instalación ────────────────────────────────────────────
// Esquema offline, sin backend ni internet: la clave es un hash del mail del
// comprador firmado con un secreto que solo vive en el binario compilado. Vos
// generás la clave con `node scripts/generate-license.mjs mail@cliente.com`
// (usa exactamente el mismo algoritmo) y se la mandás por mail/WhatsApp.
//
// Limitación conocida y aceptada para esta v1: no hay forma de detectar que la
// misma clave se instaló en más de una PC (no hay servidor central). Eso queda
// para cuando exista el backend de la venta automatizada (fase 2).
//
// El secreto DEBE coincidir exactamente con LICENSE_SECRET en
// scripts/generate-license.mjs. Cambiarlo invalida todas las claves ya entregadas.
const LICENSE_SECRET: &str = "1a111bf2ce775a006aaeadbb1cfeeda87b1f92592ea2a86425bec8530f3dce47";

fn compute_license_key(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let input = format!("{LICENSE_SECRET}:{normalized}");
    let hash = Sha256::digest(input.as_bytes());
    let hex_str = hex::encode(hash).to_uppercase();
    let code = &hex_str[0..16];
    format!("{}-{}-{}-{}", &code[0..4], &code[4..8], &code[8..12], &code[12..16])
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub activated: bool,
    pub email: Option<String>,
}

#[tauri::command]
pub fn get_license_status(state: State<AppState>) -> CmdResult<LicenseStatus> {
    let cfg = read_device_config(&app_dir_of(&state)?);
    let activated = match (&cfg.license_email, &cfg.license_key) {
        (Some(email), Some(key)) => compute_license_key(email) == *key,
        _ => false,
    };
    Ok(LicenseStatus {
        activated,
        email: if activated { cfg.license_email } else { None },
    })
}

#[tauri::command]
pub fn activate_license(email: String, key: String, state: State<AppState>) -> CmdResult<LicenseStatus> {
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Err("Ingresá tu mail.".to_string());
    }
    let normalized_key = key.trim().to_uppercase();
    let expected = compute_license_key(&normalized_email);
    if expected != normalized_key {
        return Err("La clave no es válida para ese mail. Revisá que estén bien escritos.".to_string());
    }

    let app_dir = app_dir_of(&state)?;
    let mut cfg = read_device_config(&app_dir);
    cfg.license_email = Some(normalized_email.clone());
    cfg.license_key = Some(normalized_key);
    write_device_config(&app_dir, &cfg)?;

    Ok(LicenseStatus { activated: true, email: Some(normalized_email) })
}
