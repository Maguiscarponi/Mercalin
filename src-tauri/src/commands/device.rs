// Identidad de red de "este equipo" para multicaja: standalone / servidor / cliente.
// Vive en un archivo JSON aparte de la base SQLite (no en la tabla `config`)
// a propósito: cuando una caja se conecta como cliente, su `kiosco.db` local
// se reemplaza por completo con una copia de la base del servidor (ver
// `bootstrap_from_server`), y si el modo/IP vivieran en esa misma base se
// perderían justo en ese reemplazo.

use crate::commands::{err, CmdResult};
use crate::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::io::Read;
use std::path::Path;
use tauri::State;

type HmacSha256 = Hmac<Sha256>;

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
// Esquema offline, sin backend ni internet: la clave es un token autocontenido
// y firmado — codifica tipo ("trial"/"full") y vencimiento, y se verifica
// recalculando la firma con un secreto que solo vive en el binario compilado.
// Vos generás la clave con `node scripts/generate-license.mjs mail@cliente.com`
// (`--trial` para una de prueba de 7 días, `--minutes N` para una de prueba
// corta de testeo) — usa exactamente el mismo algoritmo — y se la mandás por
// mail/WhatsApp.
//
// Formato: base64url(payload) + "." + base64url(HMAC-SHA256(secreto, payload))
// payload = "LICPAYLOAD1|{trial|full}|{mail normalizado}|{vencimiento epoch, 0 si no vence}"
// Los 7 días de una clave de prueba se cuentan desde que se GENERA la clave
// (no desde que se activa en la PC del cliente) — así el vencimiento queda
// grabado en la clave misma, sin depender de un timestamp local en
// device_config.json que se pueda resetear borrando el archivo y reactivando.
//
// Limitación conocida y aceptada para esta v1: no hay forma de detectar que la
// misma clave completa (paga) se activó en más de una PC (no hay servidor
// central). Decisión consciente — dos negocios distintos no tienen motivo real
// para compartir una licencia (sus catálogos/stock/ventas chocarían). Si hace
// falta cerrar ese hueco, queda para cuando exista el backend de la venta
// automatizada (fase 2).
//
// El secreto DEBE coincidir exactamente con LICENSE_SECRET en
// scripts/generate-license.mjs. Cambiarlo invalida todas las claves ya entregadas.
//
// Se lee de la variable de entorno LICENSE_SECRET al COMPILAR (no en el binario
// como texto plano en el repo, que ahora es público). Hay que tenerla definida
// en el entorno antes de correr `cargo tauri dev`/`build` — ver variable de
// usuario en Windows, y el secret LICENSE_SECRET en GitHub Actions para CI.
const LICENSE_SECRET: &str = env!("LICENSE_SECRET", "Definí la variable de entorno LICENSE_SECRET antes de compilar");

struct LicenseInfo {
    kind: String,             // "trial" | "full"
    email: String,
    expires_at: Option<i64>,  // epoch segundos; None == full, no vence
}

fn build_payload(kind: &str, email: &str, expires_at: i64) -> String {
    format!("LICPAYLOAD1|{kind}|{email}|{expires_at}")
}

fn hmac_sign(payload: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(LICENSE_SECRET.as_bytes()).expect("HMAC acepta clave de cualquier largo");
    mac.update(payload);
    mac.finalize().into_bytes().to_vec()
}

fn hmac_verify(payload: &[u8], sig: &[u8]) -> Result<(), ()> {
    let mut mac = HmacSha256::new_from_slice(LICENSE_SECRET.as_bytes()).expect("HMAC acepta clave de cualquier largo");
    mac.update(payload);
    mac.verify_slice(sig).map_err(|_| ())
}

#[allow(dead_code)]
fn make_license_key(kind: &str, email: &str, expires_at: i64) -> String {
    let payload = build_payload(kind, email, expires_at);
    let sig = hmac_sign(payload.as_bytes());
    format!("{}.{}", B64.encode(payload.as_bytes()), B64.encode(sig))
}

fn parse_and_verify_license_key(raw_key: &str) -> Result<LicenseInfo, String> {
    // Quita espacios/saltos de línea que se cuelan al copiar/pegar una clave
    // larga desde un mail (algunos clientes de correo la parten en dos líneas).
    let cleaned: String = raw_key.chars().filter(|c| !c.is_whitespace()).collect();
    let (payload_b64, sig_b64) = cleaned.split_once('.').ok_or("Formato de clave inválido.")?;
    let payload_bytes = B64.decode(payload_b64).map_err(|_| "Formato de clave inválido.")?;
    let sig_bytes = B64.decode(sig_b64).map_err(|_| "Formato de clave inválido.")?;
    hmac_verify(&payload_bytes, &sig_bytes).map_err(|_| "La clave no es válida.".to_string())?;

    let payload_str = String::from_utf8(payload_bytes).map_err(|_| "Formato de clave inválido.")?;
    let parts: Vec<&str> = payload_str.split('|').collect();
    if parts.len() != 4 || parts[0] != "LICPAYLOAD1" {
        return Err("Formato de clave inválido.".to_string());
    }
    let kind = parts[1].to_string();
    if kind != "trial" && kind != "full" {
        return Err("Formato de clave inválido.".to_string());
    }
    let email = parts[2].to_string();
    let expires_at: i64 = parts[3].parse().map_err(|_| "Formato de clave inválido.")?;

    Ok(LicenseInfo { kind, email, expires_at: if expires_at > 0 { Some(expires_at) } else { None } })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub activated: bool,
    pub email: Option<String>,
    pub kind: Option<String>,      // "trial" | "full"
    pub expires_at: Option<i64>,   // epoch segundos; None si es full o no está activada
    pub expired: bool,
}

impl LicenseStatus {
    fn none() -> Self {
        LicenseStatus { activated: false, email: None, kind: None, expires_at: None, expired: false }
    }

    fn from_info(info: LicenseInfo) -> Self {
        let now = Utc::now().timestamp();
        let expired = matches!(info.expires_at, Some(exp) if now >= exp);
        LicenseStatus { activated: true, email: Some(info.email), kind: Some(info.kind), expires_at: info.expires_at, expired }
    }
}

#[tauri::command]
pub fn get_license_status(state: State<AppState>) -> CmdResult<LicenseStatus> {
    let cfg = read_device_config(&app_dir_of(&state)?);
    let key = match &cfg.license_key {
        Some(k) => k,
        None => return Ok(LicenseStatus::none()),
    };
    match parse_and_verify_license_key(key) {
        Ok(info) => Ok(LicenseStatus::from_info(info)),
        Err(_) => Ok(LicenseStatus::none()),
    }
}

// Sirve tanto para activar por primera vez como para pegar una clave completa
// nueva y desbloquear una prueba vencida (ver TrialExpired.tsx) — en ambos
// casos solo pisa email/clave en device_config.json, nunca toca SQLite.
#[tauri::command]
pub fn activate_license(email: String, key: String, state: State<AppState>) -> CmdResult<LicenseStatus> {
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() {
        return Err("Ingresá tu mail.".to_string());
    }
    let info = parse_and_verify_license_key(&key).map_err(|_| "La clave no es válida.".to_string())?;
    if info.email != normalized_email {
        return Err("La clave no es válida para ese mail. Revisá que estén bien escritos.".to_string());
    }

    let cleaned_key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let app_dir = app_dir_of(&state)?;
    let mut cfg = read_device_config(&app_dir);
    cfg.license_email = Some(normalized_email);
    cfg.license_key = Some(cleaned_key);
    write_device_config(&app_dir, &cfg)?;

    Ok(LicenseStatus::from_info(info))
}
