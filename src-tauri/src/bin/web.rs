// Mercalin versión web.
//
// Es el mismo sistema que la app de escritorio, servido por internet. La
// lógica de negocio (ventas, stock, caja, ARCA, consejos, etc.) es la misma
// de src/commands: acá solo se agrega lo que la web necesita y la app de
// escritorio no:
//
//   - Cuentas: cada comercio se registra con su mail y tiene 7 días de prueba.
//   - Una base SQLite por comercio (igual que en su compu), en
//     <datos>/comercios/<id>/kiosco.db, creada desde la misma plantilla con
//     el catálogo de 7.500 productos.
//   - Entrada con mail y contraseña; si se la olvida, un código de 6 dígitos
//     al mail para elegir una nueva.
//   - /api/rpc/<comando>: el mismo canal que ya usa la app en modo multicaja.
//   - Sirve la app (el build web de React) y la página de entrada.
//
// Variables de entorno (todas opcionales para probar en local):
//   MERCALIN_DATA_DIR       carpeta de datos            (./mercalin-web-data)
//   MERCALIN_HOST           dirección donde escucha     (127.0.0.1)
//   MERCALIN_PORT           puerto                      (8787)
//   MERCALIN_STATIC_DIR     build web de la app         (../dist-web)
//   MERCALIN_TEMPLATE_DB    base plantilla              (resources/template.db)
//   MERCALIN_PUBLIC_URL     dirección pública           (http://localhost:8787)
//   MERCALIN_SIGNUP_SECRET  clave compartida con mercalinonline.com para
//                           crear cuentas desde el formulario de la web
//   MERCALIN_SECRET_KEY     64 caracteres hex: encripta las claves de ARCA.
//                           Si falta, se genera una y se guarda en la carpeta
//                           de datos (en producción, definirla y guardarla
//                           aparte: sin ella no se pueden leer esas claves).
//   RESEND_API_KEY          para mandar los códigos por mail. Sin esto, el
//                           código se muestra en la consola del servidor.
//   MERCALIN_MAIL_FROM      remitente               (Mercalin <ventas@mercalinonline.com>)
//   MERCALIN_TRIAL_DAYS     días de prueba          (7)

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path as AxPath, Query, State as AxState},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use kiosco_pos_lib::{commands, db, rpc, secret, sync_db, AppState};
use parking_lot::Mutex;
use rand::{Rng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tower_http::services::{ServeDir, ServeFile};

const COOKIE: &str = "mercalin_sesion";
const SESSION_DAYS: i64 = 90;
const CODE_MINUTES: i64 = 10;
const CODE_MAX_ATTEMPTS: i64 = 5;
const ENTRY_TOKEN_MINUTES: i64 = 15;

// ─── Configuración ──────────────────────────────────────────────────────────

struct Config {
    data_dir: PathBuf,
    host: String,
    port: u16,
    static_dir: PathBuf,
    template_db: PathBuf,
    public_url: String,
    signup_secret: Option<String>,
    resend_api_key: Option<String>,
    mail_from: String,
    trial_days: i64,
}

impl Config {
    fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Config {
            data_dir: PathBuf::from(var("MERCALIN_DATA_DIR").unwrap_or_else(|| "./mercalin-web-data".into())),
            host: var("MERCALIN_HOST").unwrap_or_else(|| "127.0.0.1".into()),
            port: var("MERCALIN_PORT").and_then(|p| p.parse().ok()).unwrap_or(8787),
            static_dir: PathBuf::from(var("MERCALIN_STATIC_DIR").unwrap_or_else(|| "../dist-web".into())),
            template_db: PathBuf::from(var("MERCALIN_TEMPLATE_DB").unwrap_or_else(|| "resources/template.db".into())),
            public_url: var("MERCALIN_PUBLIC_URL").unwrap_or_else(|| "http://localhost:8787".into()).trim_end_matches('/').to_string(),
            signup_secret: var("MERCALIN_SIGNUP_SECRET"),
            resend_api_key: var("RESEND_API_KEY"),
            mail_from: var("MERCALIN_MAIL_FROM").unwrap_or_else(|| "Mercalin <ventas@mercalinonline.com>".into()),
            trial_days: var("MERCALIN_TRIAL_DAYS").and_then(|d| d.parse().ok()).unwrap_or(7),
        }
    }

    fn secure_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn valid_email(email: &str) -> bool {
    let e = email.trim();
    if e.len() < 5 || e.len() > 200 || e.contains(' ') {
        return false;
    }
    match e.split_once('@') {
        Some((user, domain)) => !user.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.'),
        None => false,
    }
}

// ─── Cuentas (accounts.db) ──────────────────────────────────────────────────

struct Account {
    id: String,
    email: String,
    business_name: String,
    phone: Option<String>,
    created_at: i64,
    trial_ends_at: i64,
    plan: String,   // "prueba" | "mensual" | "baja"
}

impl Account {
    fn expired(&self) -> bool {
        self.plan == "baja" || (self.plan == "prueba" && now() >= self.trial_ends_at)
    }

    fn to_json(&self) -> Value {
        json!({
            "email": self.email,
            "businessName": self.business_name,
            "phone": self.phone,
            "plan": self.plan,
            "createdAt": self.created_at,
            "trialEndsAt": self.trial_ends_at,
            "expired": self.expired(),
        })
    }

    // Misma forma que LicenseStatus de la app de escritorio (ver
    // commands::device): así las pantallas que muestran "te quedan X días"
    // o bloquean al vencer funcionan sin cambios.
    fn license_status(&self) -> Value {
        let (kind, expires_at): (&str, Option<i64>) = match self.plan.as_str() {
            "prueba" => ("trial", Some(self.trial_ends_at)),
            "baja" => ("trial", Some(self.trial_ends_at.min(now()))),
            _ => ("full", None),
        };
        json!({
            "activated": true,
            "email": self.email,
            "kind": kind,
            "expiresAt": expires_at,
            "expired": self.expired(),
        })
    }
}

fn open_accounts(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS accounts (
             id TEXT PRIMARY KEY,
             email TEXT NOT NULL UNIQUE,
             business_name TEXT NOT NULL,
             phone TEXT,
             created_at INTEGER NOT NULL,
             trial_ends_at INTEGER NOT NULL,
             plan TEXT NOT NULL DEFAULT 'prueba',
             source TEXT
         );
         CREATE TABLE IF NOT EXISTS web_sessions (
             token_hash TEXT PRIMARY KEY,
             account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
             created_at INTEGER NOT NULL,
             expires_at INTEGER NOT NULL,
             owner_pending INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS login_codes (
             email TEXT PRIMARY KEY,
             code_hash TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             expires_at INTEGER NOT NULL,
             attempts INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS entry_tokens (
             token_hash TEXT PRIMARY KEY,
             account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
             expires_at INTEGER NOT NULL
         );",
    )?;
    Ok(conn)
}

fn row_to_account(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        email: r.get(1)?,
        business_name: r.get(2)?,
        phone: r.get(3)?,
        created_at: r.get(4)?,
        trial_ends_at: r.get(5)?,
        plan: r.get(6)?,
    })
}

const ACCOUNT_COLS: &str = "id, email, business_name, phone, created_at, trial_ends_at, plan";

fn account_by_email(conn: &Connection, email: &str) -> Option<Account> {
    conn.query_row(
        &format!("SELECT {} FROM accounts WHERE email=?1", ACCOUNT_COLS),
        params![email],
        row_to_account,
    )
    .optional()
    .ok()
    .flatten()
}

fn account_by_id(conn: &Connection, id: &str) -> Option<Account> {
    conn.query_row(
        &format!("SELECT {} FROM accounts WHERE id=?1", ACCOUNT_COLS),
        params![id],
        row_to_account,
    )
    .optional()
    .ok()
    .flatten()
}

// ─── Comercios (una base por comercio) ──────────────────────────────────────

struct Tenants {
    dir: PathBuf,
    template: PathBuf,
    open: Mutex<HashMap<String, Arc<AppState>>>,
}

impl Tenants {
    fn tenant_dir(&self, id: &str) -> PathBuf {
        self.dir.join(id)
    }

    fn build_state(&self, id: &str) -> Result<Arc<AppState>, String> {
        let dir = self.tenant_dir(id);
        let db_path = dir.join("kiosco.db");
        if !db_path.exists() {
            return Err("No se encontró la base de este comercio.".into());
        }
        let conn = db::open_and_migrate(&db_path).map_err(|e| e.to_string())?;
        let queue = sync_db::open_sync_queue(&dir).map_err(|e| e.to_string())?;
        Ok(Arc::new(AppState {
            db: Arc::new(Mutex::new(conn)),
            db_path,
            catalog_import_cancelled: Arc::new(AtomicBool::new(false)),
            catalog_import_running: Arc::new(AtomicBool::new(false)),
            sync_queue: Arc::new(Mutex::new(queue)),
            sync_status: Arc::new(Mutex::new("online".to_string())),
            offline_since: Arc::new(Mutex::new(None)),
            sessions: commands::session::new_session_store(),
        }))
    }

    fn get(&self, id: &str) -> Result<Arc<AppState>, String> {
        if let Some(s) = self.open.lock().get(id) {
            return Ok(Arc::clone(s));
        }
        let state = self.build_state(id)?;
        let mut map = self.open.lock();
        // Si otro pedido lo abrió mientras tanto, se usa ese (una sola
        // conexión por comercio, como en la app de escritorio).
        let entry = map.entry(id.to_string()).or_insert(state);
        Ok(Arc::clone(entry))
    }

    fn create(&self, id: &str, business_name: &str, phone: Option<&str>) -> Result<(), String> {
        let dir = self.tenant_dir(id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let db_path = dir.join("kiosco.db");
        if self.template.exists() {
            std::fs::copy(&self.template, &db_path).map_err(|e| format!("No se pudo copiar la plantilla: {}", e))?;
        }
        let state = self.build_state_or_new(id)?;
        {
            let conn = state.db.lock();
            let set = |k: &str, v: &str| {
                let _ = conn.execute(
                    "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![k, v],
                );
            };
            set("business_name", business_name);
            set("business_phone", phone.unwrap_or(""));
            // Los datos de ejemplo de la plantilla no son del comercio.
            set("business_address", "");
            set("business_cuit", "");
        }
        self.open.lock().insert(id.to_string(), state);
        Ok(())
    }

    fn build_state_or_new(&self, id: &str) -> Result<Arc<AppState>, String> {
        let db_path = self.tenant_dir(id).join("kiosco.db");
        if !db_path.exists() {
            // Sin plantilla: base vacía con la configuración de fábrica.
            let conn = db::open_and_migrate(&db_path).map_err(|e| e.to_string())?;
            drop(conn);
        }
        self.build_state(id)
    }

    // Después de restaurar un backup, la conexión quedó cerrada (ver
    // commands::backup::do_restore): en escritorio la app se reinicia; acá se
    // vuelve a abrir la base de ese comercio.
    fn reopen(&self, id: &str) -> Result<(), String> {
        let fresh = self.build_state(id)?;
        let mut map = self.open.lock();
        if let Some(existing) = map.get(id) {
            let new_conn = {
                let mut g = fresh.db.lock();
                std::mem::replace(&mut *g, Connection::open_in_memory().map_err(|e| e.to_string())?)
            };
            *existing.db.lock() = new_conn;
        } else {
            map.insert(id.to_string(), fresh);
        }
        Ok(())
    }
}

// ─── Estado del servidor ────────────────────────────────────────────────────

struct Server {
    cfg: Config,
    accounts: Mutex<Connection>,
    tenants: Tenants,
    signup_hits: Mutex<HashMap<String, Vec<i64>>>,
    login_fails: Mutex<HashMap<String, Vec<i64>>>,
}

type Shared = Arc<Server>;

fn json_error(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "ok": false, "error": msg }))).into_response()
}

fn cookie_value(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        (k == COOKIE).then(|| v.to_string())
    })
}

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "local".into())
}

impl Server {
    fn set_cookie(&self, token: &str) -> HeaderValue {
        let secure = if self.cfg.secure_cookies() { "; Secure" } else { "" };
        HeaderValue::from_str(&format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            COOKIE,
            token,
            SESSION_DAYS * 86400,
            secure
        ))
        .unwrap()
    }

    fn clear_cookie(&self) -> HeaderValue {
        HeaderValue::from_str(&format!("{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", COOKIE)).unwrap()
    }

    fn new_web_session(&self, account_id: &str, owner_pending: bool) -> String {
        let token = random_hex(32);
        let conn = self.accounts.lock();
        let _ = conn.execute(
            "INSERT INTO web_sessions (token_hash, account_id, created_at, expires_at, owner_pending) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sha256_hex(&token), account_id, now(), now() + SESSION_DAYS * 86400, owner_pending as i64],
        );
        token
    }

    /// Cuenta de la sesión web (la cookie). None si no hay o venció.
    fn session_account(&self, headers: &HeaderMap) -> Option<(Account, String)> {
        let token = cookie_value(headers)?;
        let hash = sha256_hex(&token);
        let conn = self.accounts.lock();
        let account_id: String = conn
            .query_row(
                "SELECT account_id FROM web_sessions WHERE token_hash=?1 AND expires_at>?2",
                params![hash, now()],
                |r| r.get(0),
            )
            .ok()?;
        let account = account_by_id(&conn, &account_id)?;
        Some((account, hash))
    }

    /// Crea la cuenta, la base del comercio y el usuario dueño (con el mail
    /// y la contraseña que eligió). Devuelve la cuenta y el login del dueño.
    fn create_account(&self, email: &str, business_name: &str, phone: Option<&str>, password: &str, source: &str) -> Result<(Account, Value), String> {
        let id = random_hex(12);
        let created = now();
        let trial_ends = created + self.cfg.trial_days * 86400;
        {
            let conn = self.accounts.lock();
            if account_by_email(&conn, email).is_some() {
                return Err("exists".into());
            }
            conn.execute(
                "INSERT INTO accounts (id, email, business_name, phone, created_at, trial_ends_at, plan, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'prueba', ?7)",
                params![id, email, business_name, phone, created, trial_ends, source],
            )
            .map_err(|e| e.to_string())?;
        }
        let owner = self.tenants.create(&id, business_name, phone).and_then(|_| {
            let state = self.tenants.get(&id)?;
            let result = commands::users::claim_admin_account(email.to_string(), password.to_string(), &state)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        });
        let owner = match owner {
            Ok(v) => v,
            Err(e) => {
                let conn = self.accounts.lock();
                let _ = conn.execute("DELETE FROM accounts WHERE id=?1", params![id]);
                return Err(e);
            }
        };
        println!("[mercalin-web] Comercio nuevo: {} ({}) desde {}", business_name, email, source);
        Ok((Account {
            id,
            email: email.to_string(),
            business_name: business_name.to_string(),
            phone: phone.map(|p| p.to_string()),
            created_at: created,
            trial_ends_at: trial_ends,
            plan: "prueba".into(),
        }, owner))
    }

    /// Demasiados intentos fallidos de contraseña para ese mail en 15 minutos.
    fn too_many_login_fails(&self, email: &str) -> bool {
        let mut fails = self.login_fails.lock();
        let list = fails.entry(email.to_string()).or_default();
        let since = now() - 15 * 60;
        list.retain(|t| *t > since);
        list.len() >= 8
    }

    fn record_login_fail(&self, email: &str) {
        self.login_fails.lock().entry(email.to_string()).or_default().push(now());
    }

    fn too_many_signups(&self, ip: &str) -> bool {
        let mut hits = self.signup_hits.lock();
        let list = hits.entry(ip.to_string()).or_default();
        let hour_ago = now() - 3600;
        list.retain(|t| *t > hour_ago);
        if list.len() >= 10 {
            return true;
        }
        list.push(now());
        false
    }
}

// ─── Mails ──────────────────────────────────────────────────────────────────

fn send_code_mail(cfg: &Config, to: &str, business_name: &str, code: &str) {
    let Some(key) = cfg.resend_api_key.clone() else {
        println!("[mercalin-web] (sin RESEND_API_KEY) Código para {}: {}", to, code);
        return;
    };
    let html = format!(
        "<div style=\"font-family:Arial,sans-serif;font-size:16px;color:#232120;max-width:480px\">\
         <p>Hola,</p>\
         <p>Tu código para entrar a Mercalin ({}) es:</p>\
         <p style=\"font-size:34px;font-weight:bold;letter-spacing:6px;margin:18px 0\">{}</p>\
         <p>Vence en {} minutos. Si no lo pediste vos, ignorá este mail.</p>\
         </div>",
        html_escape(business_name),
        code,
        CODE_MINUTES
    );
    let body = json!({
        "from": cfg.mail_from,
        "to": [to],
        "subject": format!("Tu código para entrar a Mercalin: {}", code),
        "html": html,
    });
    let result = ureq::post("https://api.resend.com/emails")
        .set("Authorization", &format!("Bearer {}", key))
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(15))
        .send_string(&body.to_string());
    if let Err(e) = result {
        eprintln!("[mercalin-web] No se pudo mandar el código a {}: {}", to, e);
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

// ─── Rutas: cuentas y entrada ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignupBody {
    email: String,
    business_name: String,
    #[serde(default)]
    phone: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

const MIN_PASSWORD: usize = 6;

fn check_password(password: &str) -> Result<(), &'static str> {
    if password.chars().count() < MIN_PASSWORD {
        return Err("La contraseña tiene que tener al menos 6 caracteres.");
    }
    if password.len() > 200 {
        return Err("La contraseña es muy larga.");
    }
    Ok(())
}

fn clean_signup(body: &SignupBody) -> Result<(String, String, Option<String>, String), &'static str> {
    let email = normalize_email(&body.email);
    if !valid_email(&email) {
        return Err("Revisá el mail: parece que está mal escrito.");
    }
    let business = body.business_name.trim();
    if business.is_empty() {
        return Err("Escribí el nombre de tu negocio.");
    }
    if business.chars().count() > 80 {
        return Err("El nombre del negocio es muy largo.");
    }
    let phone = body
        .phone
        .as_deref()
        .map(|p| p.trim().chars().filter(|c| c.is_ascii_digit() || *c == '+' || *c == ' ' || *c == '-').collect::<String>())
        .filter(|p| !p.is_empty())
        .map(|p| p.chars().take(30).collect());
    let password = body.password.clone().unwrap_or_default();
    check_password(&password)?;
    Ok((email, business.to_string(), phone, password))
}

// Registro desde la propia app (pantalla "Probar gratis" en app.mercalin...).
async fn signup(AxState(s): AxState<Shared>, headers: HeaderMap, Json(body): Json<SignupBody>) -> Response {
    let (email, business, phone, password) = match clean_signup(&body) {
        Ok(v) => v,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    if s.too_many_signups(&client_ip(&headers)) {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "Demasiados intentos. Probá de nuevo en un rato.");
    }
    let s2 = Arc::clone(&s);
    let result = tokio::task::spawn_blocking(move || s2.create_account(&email, &business, phone.as_deref(), &password, "app")).await;
    match result {
        Ok(Ok((account, login))) => {
            let token = s.new_web_session(&account.id, false);
            let mut res = Json(json!({ "ok": true, "account": account.to_json(), "login": login })).into_response();
            res.headers_mut().insert(header::SET_COOKIE, s.set_cookie(&token));
            res
        }
        Ok(Err(e)) if e == "exists" => (
            StatusCode::CONFLICT,
            Json(json!({ "ok": false, "exists": true, "error": "Ya hay una cuenta con ese mail. Entrá con tu mail y tu contraseña." })),
        )
            .into_response(),
        Ok(Err(e)) => {
            eprintln!("[mercalin-web] Error creando cuenta: {}", e);
            json_error(StatusCode::INTERNAL_SERVER_ERROR, "No se pudo crear la cuenta. Probá de nuevo.")
        }
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "No se pudo crear la cuenta. Probá de nuevo."),
    }
}

// Registro desde mercalinonline.com: el servidor de la web (no el navegador)
// llama acá con la clave compartida, y devuelve un link de un solo uso que
// deja a la persona adentro del sistema.
async fn signup_link(AxState(s): AxState<Shared>, headers: HeaderMap, Json(body): Json<SignupBody>) -> Response {
    let Some(secret) = s.cfg.signup_secret.as_deref() else {
        return json_error(StatusCode::NOT_FOUND, "No disponible.");
    };
    let provided = headers.get("x-mercalin-secret").and_then(|v| v.to_str().ok()).unwrap_or("");
    if sha256_hex(provided) != sha256_hex(secret) {
        return json_error(StatusCode::UNAUTHORIZED, "No autorizado.");
    }
    let (email, business, phone, password) = match clean_signup(&body) {
        Ok(v) => v,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    let s2 = Arc::clone(&s);
    let email2 = email.clone();
    let result = tokio::task::spawn_blocking(move || s2.create_account(&email2, &business, phone.as_deref(), &password, "web")).await;
    match result {
        Ok(Ok((account, _))) => {
            let token = random_hex(32);
            {
                let conn = s.accounts.lock();
                let _ = conn.execute(
                    "INSERT INTO entry_tokens (token_hash, account_id, expires_at) VALUES (?1, ?2, ?3)",
                    params![sha256_hex(&token), account.id, now() + ENTRY_TOKEN_MINUTES * 60],
                );
            }
            Json(json!({ "ok": true, "exists": false, "url": format!("{}/entrar?t={}", s.cfg.public_url, token) })).into_response()
        }
        Ok(Err(e)) if e == "exists" => Json(json!({
            "ok": true,
            "exists": true,
            "url": format!("{}/?email={}", s.cfg.public_url, urlencode(&email)),
        }))
        .into_response(),
        _ => json_error(StatusCode::INTERNAL_SERVER_ERROR, "No se pudo crear la cuenta."),
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

#[derive(Deserialize)]
struct EntrarQuery {
    t: Option<String>,
}

async fn entrar(AxState(s): AxState<Shared>, Query(q): Query<EntrarQuery>) -> Response {
    let Some(token) = q.t.filter(|t| t.len() == 64) else {
        return Redirect::to("/").into_response();
    };
    let account_id: Option<String> = {
        let conn = s.accounts.lock();
        let hash = sha256_hex(&token);
        let found = conn
            .query_row(
                "SELECT account_id FROM entry_tokens WHERE token_hash=?1 AND expires_at>?2",
                params![hash, now()],
                |r| r.get::<_, String>(0),
            )
            .ok();
        let _ = conn.execute("DELETE FROM entry_tokens WHERE token_hash=?1 OR expires_at<=?2", params![hash, now()]);
        found
    };
    match account_id {
        Some(id) => {
            let session = s.new_web_session(&id, true);
            let mut res = Redirect::to("/").into_response();
            res.headers_mut().insert(header::SET_COOKIE, s.set_cookie(&session));
            res
        }
        None => Redirect::to("/?entrada=vencida").into_response(),
    }
}

async fn me(AxState(s): AxState<Shared>, headers: HeaderMap) -> Response {
    match s.session_account(&headers) {
        Some((account, hash)) => {
            let pending: bool = {
                let conn = s.accounts.lock();
                conn.query_row("SELECT owner_pending FROM web_sessions WHERE token_hash=?1", params![hash], |r| r.get::<_, i64>(0))
                    .map(|v| v == 1)
                    .unwrap_or(false)
            };
            Json(json!({ "ok": true, "account": account.to_json(), "ownerPending": pending })).into_response()
        }
        None => json_error(StatusCode::UNAUTHORIZED, "Sin sesión."),
    }
}

#[derive(Deserialize)]
struct CodeRequestBody {
    email: String,
}

async fn code_request(AxState(s): AxState<Shared>, Json(body): Json<CodeRequestBody>) -> Response {
    let email = normalize_email(&body.email);
    if !valid_email(&email) {
        return json_error(StatusCode::BAD_REQUEST, "Revisá el mail: parece que está mal escrito.");
    }
    let (account, recent) = {
        let conn = s.accounts.lock();
        let account = account_by_email(&conn, &email);
        let recent: bool = conn
            .query_row("SELECT created_at FROM login_codes WHERE email=?1", params![email], |r| r.get::<_, i64>(0))
            .map(|t| now() - t < 45)
            .unwrap_or(false);
        (account, recent)
    };
    let Some(account) = account else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "ok": false, "noAccount": true, "error": "No hay una cuenta con ese mail. ¿Querés probar Mercalin gratis?" })),
        )
            .into_response();
    };
    if recent {
        return Json(json!({ "ok": true, "alreadySent": true })).into_response();
    }
    let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000));
    {
        let conn = s.accounts.lock();
        let _ = conn.execute(
            "INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts) VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, created_at=excluded.created_at, expires_at=excluded.expires_at, attempts=0",
            params![email, sha256_hex(&format!("{}:{}", email, code)), now(), now() + CODE_MINUTES * 60],
        );
    }
    let s2 = Arc::clone(&s);
    let business = account.business_name.clone();
    tokio::task::spawn_blocking(move || send_code_mail(&s2.cfg, &email, &business, &code));
    Json(json!({ "ok": true })).into_response()
}

#[derive(Deserialize)]
struct CodeVerifyBody {
    email: String,
    code: String,
}

async fn code_verify(AxState(s): AxState<Shared>, Json(body): Json<CodeVerifyBody>) -> Response {
    let email = normalize_email(&body.email);
    let code: String = body.code.chars().filter(|c| c.is_ascii_digit()).collect();
    let outcome: Result<String, &str> = {
        let conn = s.accounts.lock();
        let row: Option<(String, i64, i64)> = conn
            .query_row(
                "SELECT code_hash, expires_at, attempts FROM login_codes WHERE email=?1",
                params![email],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        match row {
            None => Err("Pedí un código nuevo."),
            Some((_, exp, _)) if exp <= now() => Err("El código venció. Pedí uno nuevo."),
            Some((_, _, attempts)) if attempts >= CODE_MAX_ATTEMPTS => Err("Demasiados intentos. Pedí un código nuevo."),
            Some((hash, _, _)) => {
                if hash == sha256_hex(&format!("{}:{}", email, code)) {
                    let _ = conn.execute("DELETE FROM login_codes WHERE email=?1", params![email]);
                    account_by_email(&conn, &email).map(|a| a.id).ok_or("No hay una cuenta con ese mail.")
                } else {
                    let _ = conn.execute("UPDATE login_codes SET attempts=attempts+1 WHERE email=?1", params![email]);
                    Err("El código no es correcto.")
                }
            }
        }
    };
    match outcome {
        Ok(account_id) => {
            let token = s.new_web_session(&account_id, true);
            let mut res = Json(json!({ "ok": true })).into_response();
            res.headers_mut().insert(header::SET_COOKIE, s.set_cookie(&token));
            res
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

// Entra como dueño adentro del sistema, sin contraseña: solo vale una vez
// por cada vez que se comprobó el mail (registro, link de la web o código).
// Así, si un empleado usa la compu del negocio y cierra sesión, no puede
// volver a entrar como dueño sin el mail del dueño.
async fn owner_login(AxState(s): AxState<Shared>, headers: HeaderMap) -> Response {
    let Some((account, hash)) = s.session_account(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "Sin sesión.");
    };
    let pending: bool = {
        let conn = s.accounts.lock();
        let p = conn
            .query_row("SELECT owner_pending FROM web_sessions WHERE token_hash=?1", params![hash], |r| r.get::<_, i64>(0))
            .map(|v| v == 1)
            .unwrap_or(false);
        if p {
            let _ = conn.execute("UPDATE web_sessions SET owner_pending=0 WHERE token_hash=?1", params![hash]);
        }
        p
    };
    if !pending {
        return json_error(StatusCode::FORBIDDEN, "Para entrar como dueño, pedí un código a tu mail.");
    }
    let state = match s.tenants.get(&account.id) {
        Ok(st) => st,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let email = account.email.clone();
    let result = tokio::task::spawn_blocking(move || login_as_owner(&state, &email)).await;
    match result {
        Ok(Ok(v)) => Json(json!({ "ok": true, "data": v })).into_response(),
        Ok(Err(e)) => json_error(StatusCode::BAD_REQUEST, &e),
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "Error interno."),
    }
}

fn login_as_owner(state: &AppState, email: &str) -> Result<Value, String> {
    let existing: Option<(i64, String, i64)> = {
        let conn = state.db.lock();
        conn.query_row("SELECT id, role, active FROM users WHERE username=?1", params![email], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .ok()
    };
    match existing {
        Some((_, _, 0)) => Err("Tu usuario está desactivado. Pedile a otro administrador que lo active.".into()),
        Some((id, role, _)) => {
            let user: Value = {
                let conn = state.db.lock();
                conn.query_row(
                    "SELECT id, username, full_name, role, active, created_at FROM users WHERE id=?1",
                    params![id],
                    |r| {
                        Ok(json!({
                            "id": r.get::<_, i64>(0)?,
                            "username": r.get::<_, String>(1)?,
                            "full_name": r.get::<_, String>(2)?,
                            "role": r.get::<_, String>(3)?,
                            "active": r.get::<_, i64>(4)? == 1,
                            "created_at": r.get::<_, String>(5)?,
                        }))
                    },
                )
                .map_err(|e| e.to_string())?
            };
            let token = commands::session::create_session(&state.sessions, id, &role);
            Ok(json!({ "user": user, "session_token": token }))
        }
        None => {
            // Primera vez: adopta el usuario admin de fábrica con el mail del
            // dueño (lo mismo que hace la app de escritorio al activarse), con
            // una contraseña al azar. Entra siempre con código al mail; si
            // quiere, después elige una contraseña desde Usuarios.
            let password = random_hex(16);
            let result = commands::users::claim_admin_account(email.to_string(), password, state)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
    }
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

// Entrada de todos los días: mail y contraseña del dueño. Deja este navegador
// adentro de la cuenta y además logueado en el sistema, en un solo paso.
async fn login(AxState(s): AxState<Shared>, Json(body): Json<LoginBody>) -> Response {
    let email = normalize_email(&body.email);
    if s.too_many_login_fails(&email) {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "Demasiados intentos. Esperá unos minutos o recuperá tu contraseña.");
    }
    let account = {
        let conn = s.accounts.lock();
        account_by_email(&conn, &email)
    };
    let Some(account) = account else {
        s.record_login_fail(&email);
        return json_error(StatusCode::UNAUTHORIZED, "Mail o contraseña incorrectos.");
    };
    let state = match s.tenants.get(&account.id) {
        Ok(st) => st,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let email2 = email.clone();
    let password = body.password;
    let result = tokio::task::spawn_blocking(move || commands::users::login(email2, password, &state)).await;
    match result {
        Ok(Ok(login)) => {
            let token = s.new_web_session(&account.id, false);
            let mut res = Json(json!({ "ok": true, "login": login })).into_response();
            res.headers_mut().insert(header::SET_COOKIE, s.set_cookie(&token));
            res
        }
        Ok(Err(_)) => {
            s.record_login_fail(&email);
            json_error(StatusCode::UNAUTHORIZED, "Mail o contraseña incorrectos.")
        }
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "Error interno."),
    }
}

#[derive(Deserialize)]
struct SetPasswordBody {
    password: String,
}

// "Olvidé mi contraseña": después de comprobar el mail con el código, elige
// una contraseña nueva y queda adentro.
async fn set_password(AxState(s): AxState<Shared>, headers: HeaderMap, Json(body): Json<SetPasswordBody>) -> Response {
    if let Err(e) = check_password(&body.password) {
        return json_error(StatusCode::BAD_REQUEST, e);
    }
    let Some((account, hash)) = s.session_account(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "Volvé a pedir el código.");
    };
    let pending: bool = {
        let conn = s.accounts.lock();
        let p = conn
            .query_row("SELECT owner_pending FROM web_sessions WHERE token_hash=?1", params![hash], |r| r.get::<_, i64>(0))
            .map(|v| v == 1)
            .unwrap_or(false);
        if p {
            let _ = conn.execute("UPDATE web_sessions SET owner_pending=0 WHERE token_hash=?1", params![hash]);
        }
        p
    };
    if !pending {
        return json_error(StatusCode::FORBIDDEN, "Para cambiar la contraseña, pedí un código a tu mail.");
    }
    let state = match s.tenants.get(&account.id) {
        Ok(st) => st,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let email = account.email.clone();
    let result = tokio::task::spawn_blocking(move || commands::users::claim_admin_account(email, body.password, &state)).await;
    match result {
        Ok(Ok(login)) => Json(json!({ "ok": true, "login": login })).into_response(),
        Ok(Err(e)) => json_error(StatusCode::BAD_REQUEST, &e),
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "Error interno."),
    }
}

async fn logout(AxState(s): AxState<Shared>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie_value(&headers) {
        let conn = s.accounts.lock();
        let _ = conn.execute("DELETE FROM web_sessions WHERE token_hash=?1", params![sha256_hex(&token)]);
    }
    let mut res = Json(json!({ "ok": true })).into_response();
    res.headers_mut().insert(header::SET_COOKIE, s.clear_cookie());
    res
}

// ─── Copia de la base para descargar (Configuración → Backups) ──────────────

#[derive(Deserialize)]
struct BackupQuery {
    session: String,
}

async fn backup_download(AxState(s): AxState<Shared>, headers: HeaderMap, Query(q): Query<BackupQuery>) -> Response {
    let Some((account, _)) = s.session_account(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "Sin sesión.");
    };
    let state = match s.tenants.get(&account.id) {
        Ok(st) => st,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let is_admin = commands::session::resolve_session(&state.sessions, Some(&q.session))
        .map(|info| info.role == "admin")
        .unwrap_or(false);
    if !is_admin {
        return json_error(StatusCode::FORBIDDEN, "Solo un administrador puede descargar la copia.");
    }
    let tmp = std::env::temp_dir().join(format!("mercalin_copia_{}.db", random_hex(8)));
    let tmp2 = tmp.clone();
    let st2 = Arc::clone(&state);
    let done = tokio::task::spawn_blocking(move || {
        let conn = st2.db.lock();
        conn.execute("VACUUM INTO ?1", params![tmp2.to_string_lossy()]).map_err(|e| e.to_string())
    })
    .await;
    if !matches!(done, Ok(Ok(_))) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "No se pudo generar la copia.");
    }
    let bytes = match tokio::fs::read(&tmp).await {
        Ok(b) => b,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "No se pudo generar la copia."),
    };
    let _ = tokio::fs::remove_file(&tmp).await;
    let filename = format!("mercalin_copia_{}.db", chrono::Local::now().format("%Y%m%d_%H%M"));
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename))
        .body(Body::from(bytes))
        .unwrap()
}

// ─── El canal de comandos: /api/rpc/<comando> ───────────────────────────────

// Comandos que en la web no tienen sentido o serían peligrosos: tocan rutas de
// archivos del servidor, la configuración de red/multicaja de la compu, o la
// activación por clave (en la web la cuenta la maneja el servidor).
const BLOCKED: &[&str] = &[
    "restore_backup",               // recibe una ruta de archivo
    "activate_license",
    "reset_password_with_license_key",
    "claim_admin_account",          // en la web, el dueño entra con código al mail
    "set_device_config",
    "bootstrap_from_server",
    "disconnect_client",
    "enqueue_sync_op",
    "generate_catalog_template",
];

// Claves de configuración que en la web no se pueden cambiar desde la app.
const BLOCKED_CONFIG_KEYS: &[&str] = &["backup_custom_dir"];

fn touches_blocked_config(command: &str, body: &Value) -> bool {
    let key_blocked = |entry: &Value| {
        entry
            .get("key")
            .and_then(|k| k.as_str())
            .map(|k| BLOCKED_CONFIG_KEYS.contains(&k))
            .unwrap_or(false)
    };
    match command {
        "set_config" => body.get("entry").map(key_blocked).unwrap_or(false),
        "set_multiple_config" => body
            .get("entries")
            .and_then(|e| e.as_array())
            .map(|list| list.iter().any(key_blocked))
            .unwrap_or(false),
        _ => false,
    }
}

fn run_command(s: &Server, account: &Account, state: &AppState, command: &str, body: Value) -> Result<Value, String> {
    match command {
        "get_license_status" => return Ok(account.license_status()),
        "get_sync_status" => return Ok(json!("online")),
        // La app web guarda el login de adentro en el navegador; al volver,
        // pregunta si el servidor lo sigue reconociendo.
        "web_session_valid" => {
            let token = body.get("sessionToken").and_then(|t| t.as_str());
            return Ok(json!(commands::session::resolve_session(&state.sessions, token).is_some()));
        }
        "get_network_info" => return Ok(json!({ "ip": "", "port": "", "enabled": false, "serverToken": null })),
        "get_device_config" => {
            let cfg = commands::device::get_device_config(state)?;
            return serde_json::to_value(cfg).map_err(|e| e.to_string());
        }
        "list_pending_sync_ops" => {
            let ops = kiosco_pos_lib::sync_worker::list_pending_sync_ops(state)?;
            return serde_json::to_value(ops).map_err(|e| e.to_string());
        }
        _ => {}
    }
    if BLOCKED.contains(&command) {
        return Err("Esta opción no está disponible en la versión web.".into());
    }
    if touches_blocked_config(command, &body) {
        return Err("Esta opción no está disponible en la versión web.".into());
    }
    let result = rpc::dispatch_with(state, command, body);
    if command == "restore_backup_by_name" && result.is_ok() {
        s.tenants.reopen(&account.id)?;
    }
    result
}

async fn rpc_handler(
    AxState(s): AxState<Shared>,
    headers: HeaderMap,
    AxPath(command): AxPath<String>,
    body: axum::body::Bytes,
) -> Response {
    let Some((account, _)) = s.session_account(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "Tu sesión terminó. Volvé a entrar.");
    };
    if account.expired() && command != "get_license_status" && command != "logout" {
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(json!({ "ok": false, "expired": true, "error": "Tu prueba terminó. Para seguir usando Mercalin, elegí un plan." })),
        )
            .into_response();
    }
    let parsed: Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("JSON inválido: {}", e)),
        }
    };
    let state = match s.tenants.get(&account.id) {
        Ok(st) => st,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let s2 = Arc::clone(&s);
    let result = tokio::task::spawn_blocking(move || run_command(&s2, &account, &state, &command, parsed)).await;
    match result {
        Ok(Ok(data)) => Json(json!({ "ok": true, "data": data })).into_response(),
        Ok(Err(e)) => Json(json!({ "ok": false, "error": e })).into_response(),
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "Error interno del servidor."),
    }
}

async fn health() -> &'static str {
    "ok"
}

// ─── Arranque ───────────────────────────────────────────────────────────────

fn load_secret_key(data_dir: &Path) -> [u8; 32] {
    let from_hex = |h: &str| -> Option<[u8; 32]> {
        let bytes = hex::decode(h.trim()).ok()?;
        bytes.try_into().ok()
    };
    if let Some(k) = std::env::var("MERCALIN_SECRET_KEY").ok().and_then(|v| from_hex(&v)) {
        return k;
    }
    let path = data_dir.join("clave-servidor.txt");
    if let Some(k) = std::fs::read_to_string(&path).ok().and_then(|v| from_hex(&v)) {
        return k;
    }
    let mut k = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut k);
    let _ = std::fs::write(&path, hex::encode(k));
    eprintln!(
        "[mercalin-web] Se generó una clave nueva para encriptar las claves de ARCA en {}. \
         En producción, guardala aparte y pasala en MERCALIN_SECRET_KEY.",
        path.display()
    );
    k
}

#[tokio::main]
async fn main() {
    let cfg = Config::from_env();
    std::fs::create_dir_all(cfg.data_dir.join("comercios")).expect("no se pudo crear la carpeta de datos");
    secret::set_key(load_secret_key(&cfg.data_dir));

    let accounts = open_accounts(&cfg.data_dir.join("accounts.db")).expect("no se pudo abrir accounts.db");
    if !cfg.template_db.exists() {
        eprintln!(
            "[mercalin-web] Aviso: no está la plantilla {} -- los comercios nuevos arrancan sin el catálogo de productos.",
            cfg.template_db.display()
        );
    }
    if !cfg.static_dir.join("index.html").exists() {
        eprintln!(
            "[mercalin-web] Aviso: no está el build web en {} -- corré `npm run build:web` en la carpeta del proyecto.",
            cfg.static_dir.display()
        );
    }

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let index = cfg.static_dir.join("index.html");
    let static_service = ServeDir::new(&cfg.static_dir).fallback(ServeFile::new(index));

    let server: Shared = Arc::new(Server {
        tenants: Tenants {
            dir: cfg.data_dir.join("comercios"),
            template: cfg.template_db.clone(),
            open: Mutex::new(HashMap::new()),
        },
        accounts: Mutex::new(accounts),
        signup_hits: Mutex::new(HashMap::new()),
        login_fails: Mutex::new(HashMap::new()),
        cfg,
    });

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/web/me", get(me))
        .route("/api/web/signup", post(signup))
        .route("/api/web/signup-link", post(signup_link))
        .route("/api/web/code/request", post(code_request))
        .route("/api/web/code/verify", post(code_verify))
        .route("/api/web/owner-login", post(owner_login))
        .route("/api/web/login", post(login))
        .route("/api/web/set-password", post(set_password))
        .route("/api/web/logout", post(logout))
        .route("/api/web/backup-download", get(backup_download))
        .route("/api/rpc/:command", post(rpc_handler))
        .route("/entrar", get(entrar))
        .fallback_service(static_service)
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .with_state(Arc::clone(&server));

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("no se pudo abrir el puerto");
    println!("[mercalin-web] Mercalin web andando en http://{}", addr);
    println!("[mercalin-web] Datos en {}", server.cfg.data_dir.display());
    axum::serve(listener, app).await.expect("el servidor se detuvo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_mails() {
        assert!(valid_email("duena@kiosco.com"));
        assert!(!valid_email("duena@kiosco"));
        assert!(!valid_email("sin-arroba.com"));
        assert!(!valid_email("con espacio@kiosco.com"));
    }

    #[test]
    fn bloquea_carpeta_de_backups() {
        let body = json!({ "entry": { "key": "backup_custom_dir", "value": "/etc" } });
        assert!(touches_blocked_config("set_config", &body));
        let body = json!({ "entries": [{ "key": "business_name", "value": "x" }, { "key": "backup_custom_dir", "value": "/" }] });
        assert!(touches_blocked_config("set_multiple_config", &body));
        let body = json!({ "entry": { "key": "business_name", "value": "x" } });
        assert!(!touches_blocked_config("set_config", &body));
    }

    #[test]
    fn prueba_vencida() {
        let mut a = Account {
            id: "x".into(),
            email: "a@b.com".into(),
            business_name: "X".into(),
            phone: None,
            created_at: now() - 8 * 86400,
            trial_ends_at: now() - 86400,
            plan: "prueba".into(),
        };
        assert!(a.expired());
        a.plan = "mensual".into();
        assert!(!a.expired());
    }
}
