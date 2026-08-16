mod db;
mod models;
mod commands;
mod rpc;
mod sync_db;
mod sync_worker;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub db_path: PathBuf,
    pub catalog_import_cancelled: Arc<AtomicBool>,
    pub catalog_import_running: Arc<AtomicBool>,
    pub sync_queue: Arc<Mutex<Connection>>,
    // "online" | "offline" | "syncing" -- solo relevante en modo cliente.
    pub sync_status: Arc<Mutex<String>>,
}

// ─── Servidor HTTP para modo tablet ──────────────────────────────────────────

fn get_local_ip() -> String {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok();
    if let Some(s) = socket {
        if s.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = s.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn tablet_html(ip: &str, port: u16) -> String {
    format!(r#"<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Punto Simple — Vista Tablet</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:system-ui,sans-serif;background:#f5f5f4;color:#1c1917;min-height:100vh}}
  .header{{background:#fff;border-bottom:1px solid #e7e5e4;padding:16px 20px;display:flex;align-items:center;justify-content:space-between}}
  .header h1{{font-size:18px;font-weight:700}}
  .header .sub{{font-size:12px;color:#78716c;margin-top:2px}}
  .refresh{{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;padding:20px}}
  .card{{background:#fff;border-radius:12px;border:1px solid #e7e5e4;padding:20px}}
  .card h2{{font-size:13px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}}
  .kpi{{font-size:28px;font-weight:700;color:#1c1917}}
  .kpi-sub{{font-size:13px;color:#78716c;margin-top:4px}}
  .alert-item{{padding:10px 12px;border-radius:8px;margin-bottom:8px;font-size:13px}}
  .alert-urgente{{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}}
  .alert-importante{{background:#fefce8;color:#92400e;border:1px solid #fde68a}}
  .alert-info{{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}}
  .empty{{color:#a8a29e;font-size:13px;text-align:center;padding:20px 0}}
  .ts{{font-size:11px;color:#a8a29e;margin-top:4px}}
  .order-row{{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f4;font-size:13px}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}}
  .badge-pend{{background:#fef3c7;color:#92400e}}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>Punto Simple POS</h1>
    <div class="sub">Vista tablet — {ip}:{port}</div>
  </div>
  <button class="refresh" onclick="loadAll()">↻ Actualizar</button>
</div>
<div class="grid" id="content">
  <div class="card"><div class="empty">Cargando…</div></div>
</div>
<script>
async function fetchJSON(url){{
  try{{const r=await fetch(url);return await r.json();}}catch(e){{return null;}}
}}
function fmt(cents){{
  return '$'+Math.round(cents/100).toLocaleString('es-AR');
}}
async function loadAll(){{
  const[today,alerts,orders]=await Promise.all([
    fetchJSON('/api/today'),
    fetchJSON('/api/alerts'),
    fetchJSON('/api/orders'),
  ]);
  const content=document.getElementById('content');
  let html='';
  if(today){{
    html+=`<div class="card">
      <h2>Hoy</h2>
      <div class="kpi">${{fmt(today.total_cents)}}</div>
      <div class="kpi-sub">${{today.sales_count}} ventas · Ticket promedio ${{fmt(today.avg_ticket_cents)}}</div>
      <div class="kpi-sub" style="margin-top:8px">Ganancia bruta estimada: ${{fmt(today.gross_profit_cents)}}</div>
    </div>`;
  }}
  if(alerts&&alerts.length>0){{
    const items=alerts.map(a=>`<div class="alert-item alert-${{a.level}}">${{a.message}}</div>`).join('');
    html+=`<div class="card"><h2>Alertas (${{alerts.length}})</h2>${{items}}</div>`;
  }}else{{
    html+=`<div class="card"><h2>Alertas</h2><div class="empty">Sin alertas urgentes</div></div>`;
  }}
  if(orders&&orders.length>0){{
    const rows=orders.map(o=>`<div class="order-row"><span>${{o.supplier_name}}</span><span class="badge badge-pend">Pendiente</span></div>`).join('');
    html+=`<div class="card"><h2>Órdenes pendientes (${{orders.length}})</h2>${{rows}}</div>`;
  }}
  const ts=new Date().toLocaleTimeString('es-AR',{{hour:'2-digit',minute:'2-digit'}});
  html+=`<div class="card"><h2>Sistema</h2><div class="ts">Última actualización: ${{ts}}</div><div class="ts" style="margin-top:4px">Conectado a ${{'{ip}:{port}'||''}}</div></div>`;
  content.innerHTML=html||'<div class="card"><div class="empty">Sin datos</div></div>';
}}
loadAll();
setInterval(loadAll,60000);
</script>
</body>
</html>"#, ip=ip, port=port)
}

// Levanta el servidor de red (modo tablet de solo lectura + RPC de multicaja)
// en un pool chico de hilos worker que comparten el mismo `tiny_http::Server`.
// No acelera el acceso a la base (ya serializado por `Mutex<Connection>`), pero
// evita que una caja con red lenta bloquee a las demás mientras arma el request.
// La función no bloquea: spawnea los workers y vuelve enseguida.
fn start_network_server(app: AppHandle, db: Arc<Mutex<Connection>>, port: u16) {
    let server = match tiny_http::Server::http(format!("0.0.0.0:{}", port)) {
        Ok(s) => Arc::new(s),
        Err(e) => { eprintln!("[network] Error al iniciar servidor en puerto {}: {}", port, e); return; }
    };
    let local_ip = get_local_ip();
    println!("[network] Servidor de red en http://{}:{}", local_ip, port);

    const WORKERS: usize = 4;
    for _ in 0..WORKERS {
        let server = Arc::clone(&server);
        let db = Arc::clone(&db);
        let app = app.clone();
        let local_ip = local_ip.clone();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                handle_network_request(&app, &db, &local_ip, port, request);
            }
        });
    }
}

fn handle_network_request(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    local_ip: &str,
    port: u16,
    mut request: tiny_http::Request,
) {
    let url = request.url().to_string();
    let method = request.method().as_str().to_uppercase();

    // Snapshot completo de la base, usado por una caja "cliente" nueva para
    // clonar los datos del servidor antes de arrancar en modo cliente. Se
    // maneja aparte porque la respuesta es binaria, no JSON/texto como el
    // resto de las rutas de acá abajo.
    if url == "/api/db_snapshot" && method == "GET" {
        let tmp_path = std::env::temp_dir().join(format!("kiosco_snapshot_{}.db", std::process::id()));
        let vacuum_ok = {
            let conn = db.lock();
            conn.execute("VACUUM INTO ?1", rusqlite::params![tmp_path.to_string_lossy()]).is_ok()
        };
        let bytes = if vacuum_ok { std::fs::read(&tmp_path).ok() } else { None };
        let _ = std::fs::remove_file(&tmp_path);
        let response = match bytes {
            Some(data) => tiny_http::Response::from_data(data)
                .with_status_code(200)
                .with_header(tiny_http::Header::from_bytes("Content-Type", "application/octet-stream").unwrap())
                .with_header(tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
                .boxed(),
            None => tiny_http::Response::from_string("Error generando la copia de la base")
                .with_status_code(500)
                .boxed(),
        };
        let _ = request.respond(response);
        return;
    }

    let (status, content_type, body) = if url == "/" || url.is_empty() {
            let html = tablet_html(local_ip, port);
            (200, "text/html; charset=utf-8", html)
        } else if url == "/api/health" && method == "GET" {
            (200, "application/json", r#"{"ok":true}"#.to_string())
        } else if let Some(command) = url.strip_prefix("/api/rpc/").filter(|_| method == "POST") {
            let mut content = String::new();
            let _ = request.as_reader().read_to_string(&mut content);
            let parsed_result: Result<Value, String> = if content.trim().is_empty() {
                Ok(serde_json::json!({}))
            } else {
                serde_json::from_str(&content).map_err(|e| format!("JSON inválido: {}", e))
            };
            match parsed_result {
                Ok(parsed) => {
                    let result = crate::rpc::dispatch(app, command, parsed);
                    let body = match result {
                        Ok(data) => serde_json::json!({"ok": true, "data": data}).to_string(),
                        Err(e) => serde_json::json!({"ok": false, "error": e}).to_string(),
                    };
                    (200, "application/json", body)
                }
                Err(e) => {
                    let body = serde_json::json!({"ok": false, "error": e}).to_string();
                    (400, "application/json", body)
                }
            }
        } else if url == "/api/today" && method == "GET" {
            let body = {
                let conn = db.lock();
                let total: i64 = conn.query_row(
                    "SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE date(created_at,'localtime')=date('now','localtime') AND notes NOT LIKE '%[ANULADA]%'",
                    [], |r| r.get(0)
                ).unwrap_or(0);
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sales WHERE date(created_at,'localtime')=date('now','localtime') AND notes NOT LIKE '%[ANULADA]%'",
                    [], |r| r.get(0)
                ).unwrap_or(0);
                let profit: i64 = conn.query_row(
                    "SELECT COALESCE(SUM((si.unit_price_cents - p.cost_cents) * si.qty),0)
                     FROM sale_items si
                     JOIN sales s ON s.id=si.sale_id
                     LEFT JOIN products p ON p.id=si.product_id
                     WHERE date(s.created_at,'localtime')=date('now','localtime')
                     AND s.notes NOT LIKE '%[ANULADA]%'",
                    [], |r| r.get(0)
                ).unwrap_or(0);
                let avg = if count > 0 { total / count } else { 0 };
                format!(r#"{{"total_cents":{},"sales_count":{},"avg_ticket_cents":{},"gross_profit_cents":{}}}"#,
                    total, count, avg, profit)
            };
            (200, "application/json", body)
        } else if url == "/api/alerts" && method == "GET" {
            let body = {
                let conn = db.lock();
                let mut alerts: Vec<String> = Vec::new();
                // Stock crítico (nada si el negocio apagó el seguimiento de stock)
                if crate::db::stock_tracking_enabled(&conn) {
                    let mut stmt = conn.prepare(
                        "SELECT p.name, p.stock,
                         COALESCE((SELECT CAST(SUM(si.qty) AS REAL)/30 FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=p.id AND s.created_at>=datetime('now','-30 days')),0) as vel
                         FROM products p WHERE p.active=1 AND p.stock>0 AND p.min_stock>0 AND p.stock<=p.min_stock
                         ORDER BY p.stock ASC LIMIT 5"
                    ).unwrap();
                    if let Ok(rows) = stmt.query_map([], |r| {
                        Ok((r.get::<_,String>(0)?, r.get::<_,i64>(1)?, r.get::<_,f64>(2)?))
                    }) {
                        for row in rows.filter_map(|r| r.ok()) {
                            let days = if row.2 > 0.0 { (row.1 as f64 / row.2).round() as i64 } else { 99 };
                            alerts.push(format!(r#"{{"level":"urgente","message":"Stock bajo: {} ({} ud. — ~{} días)"}}"#,
                                row.0.replace('"', "'"), row.1, days));
                        }
                    };
                }
                // Vencimientos próximos
                let mut stmt2 = conn.prepare(
                    "SELECT name, stock, julianday(expires_at)-julianday('now') as days_left
                     FROM products WHERE active=1 AND stock>0 AND expires_at IS NOT NULL
                     AND julianday(expires_at)-julianday('now') <= 3
                     ORDER BY expires_at ASC LIMIT 5"
                ).unwrap();
                if let Ok(rows) = stmt2.query_map([], |r| {
                    Ok((r.get::<_,String>(0)?, r.get::<_,i64>(1)?, r.get::<_,f64>(2)?))
                }) {
                    for row in rows.filter_map(|r| r.ok()) {
                        let d = row.2.ceil() as i64;
                        let msg = if d <= 0 { "vencido".to_string() } else { format!("{} días", d) };
                        alerts.push(format!(r#"{{"level":"importante","message":"Vencimiento: {} ({} ud., {})"}}"#,
                            row.0.replace('"', "'"), row.1, msg));
                    }
                }
                format!("[{}]", alerts.join(","))
            };
            (200, "application/json", body)
        } else if url == "/api/orders" && method == "GET" {
            let body = {
                let conn = db.lock();
                let mut stmt = conn.prepare(
                    "SELECT po.id, s.name as supplier_name, po.total_cents
                     FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
                     WHERE po.status='pendiente' ORDER BY po.ordered_at DESC LIMIT 10"
                ).unwrap();
                let rows: Vec<String> = match stmt.query_map([], |r| {
                    Ok(format!(r#"{{"id":{},"supplier_name":"{}","total_cents":{}}}"#,
                        r.get::<_,i64>(0).unwrap_or(0),
                        r.get::<_,String>(1).unwrap_or_default().replace('"', "'"),
                        r.get::<_,i64>(2).unwrap_or(0)))
                }) {
                    Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                    Err(_) => vec![],
                };
                format!("[{}]", rows.join(","))
            };
            (200, "application/json", body)
        } else {
            (404, "text/plain", "Not found".to_string())
        };

    let response = tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(tiny_http::Header::from_bytes("Content-Type", content_type).unwrap())
        .with_header(tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());

    let _ = request.respond(response);
}

#[derive(serde::Serialize)]
struct NetworkInfo {
    ip: String,
    port: String,
    enabled: bool,
}

#[tauri::command]
fn get_network_info(state: tauri::State<AppState>) -> NetworkInfo {
    let (tablet_enabled, port) = {
        let conn = state.db.lock();
        let tablet_enabled: String = conn.query_row(
            "SELECT value FROM config WHERE key='tablet_mode_enabled'", [], |r| r.get(0)
        ).unwrap_or_else(|_| "0".to_string());
        let port: String = conn.query_row(
            "SELECT value FROM config WHERE key='tablet_port'", [], |r| r.get(0)
        ).unwrap_or_else(|_| "7979".to_string());
        (tablet_enabled, port)
    };
    let device_mode = state
        .db_path
        .parent()
        .map(|dir| commands::device::read_device_config(dir).mode)
        .unwrap_or_else(|| "standalone".to_string());
    NetworkInfo {
        ip: get_local_ip(),
        port,
        enabled: tablet_enabled == "1" || device_mode == "server",
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("no se pudo obtener app_data_dir");
            std::fs::create_dir_all(&app_dir).ok();

            let db_path = app_dir.join("kiosco.db");

            // Si esta caja recién se conectó como "cliente" (ver
            // `commands::device::bootstrap_from_server`), hay una copia de la
            // base del servidor esperando en un archivo de staging. La
            // canjeamos acá, antes de abrir la conexión real, para no tener
            // que reemplazar un archivo mientras ya está en uso.
            let pending_bootstrap = app_dir.join("kiosco.db.pending-client-bootstrap");
            if pending_bootstrap.exists() {
                if db_path.exists() {
                    let backup_path = app_dir.join(format!(
                        "kiosco.db.pre-cliente-{}.bak",
                        chrono::Utc::now().format("%Y%m%d%H%M%S")
                    ));
                    if let Err(e) = std::fs::rename(&db_path, &backup_path) {
                        eprintln!("[punto-simple] No se pudo respaldar la base anterior: {}", e);
                    }
                }
                match std::fs::rename(&pending_bootstrap, &db_path) {
                    Ok(()) => println!("[punto-simple] Base reemplazada por la copia del servidor (modo cliente)."),
                    Err(e) => eprintln!("[punto-simple] No se pudo aplicar la copia del servidor: {}", e),
                }
            }

            // Instalación nueva de verdad (nunca se abrió, no viene de un bootstrap de
            // multicaja): si el instalador trae una base "plantilla" con el catálogo ya
            // cargado (ver commands::catalog_import::generate_catalog_template), arranca
            // de ahí en vez de una base vacía -- así un cliente nuevo ya tiene productos
            // para buscar/escanear desde el primer día, sin depender de tener internet y
            // esperar un import él mismo. Si no existe la plantilla (por ahora no se
            // empaquetó ninguna, o es un build de desarrollo), sigue como siempre.
            if !db_path.exists() {
                if let Ok(template) = app.path().resolve("resources/template.db", tauri::path::BaseDirectory::Resource) {
                    if template.exists() {
                        match std::fs::copy(&template, &db_path) {
                            Ok(_) => println!("[punto-simple] Base inicial cargada desde la plantilla del catálogo."),
                            Err(e) => eprintln!("[punto-simple] No se pudo copiar la base plantilla: {}", e),
                        }
                    }
                }
            }

            println!("[punto-simple] DB en: {}", db_path.display());

            let conn = db::open_and_migrate(&db_path)
                .expect("no se pudo abrir/migrar la base de datos");

            let db_arc = Arc::new(Mutex::new(conn));

            let sync_queue_conn = sync_db::open_sync_queue(&app_dir)
                .expect("no se pudo abrir la cola de sincronización");
            let sync_queue_arc = Arc::new(Mutex::new(sync_queue_conn));

            let device_config = commands::device::read_device_config(&app_dir);
            let sync_status_arc = Arc::new(Mutex::new(
                if device_config.mode == "client" { "offline".to_string() } else { "online".to_string() }
            ));

            // Iniciar servidor de red si está habilitado el modo tablet (solo lectura)
            // o el modo servidor de multicaja (lectura + escritura vía RPC)
            {
                let tablet_enabled: bool = {
                    let c = db_arc.lock();
                    c.query_row("SELECT value FROM config WHERE key='tablet_mode_enabled'", [], |r| r.get::<_, String>(0))
                        .map(|v| v == "1")
                        .unwrap_or(false)
                };
                let tablet_port: u16 = {
                    let c = db_arc.lock();
                    c.query_row("SELECT value FROM config WHERE key='tablet_port'", [], |r| r.get::<_, String>(0))
                        .ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(7979)
                };
                if tablet_enabled || device_config.mode == "server" {
                    let db_clone = Arc::clone(&db_arc);
                    let app_handle = app.handle().clone();
                    start_network_server(app_handle, db_clone, tablet_port);
                }
            }

            // En modo cliente: hilo de fondo que vigila la conexión con el
            // servidor, vacía la cola de operaciones pendientes al reconectar,
            // y refresca productos/clientes/usuarios/config desde el servidor.
            if device_config.mode == "client" {
                if let Some(server_addr) = device_config.server_addr.clone() {
                    let app_handle = app.handle().clone();
                    let db_clone = Arc::clone(&db_arc);
                    let queue_clone = Arc::clone(&sync_queue_arc);
                    let status_clone = Arc::clone(&sync_status_arc);
                    sync_worker::run_sync_worker(app_handle, db_clone, queue_clone, status_clone, server_addr);
                }
            }

            app.manage(AppState {
                db: db_arc,
                db_path,
                catalog_import_cancelled: Arc::new(AtomicBool::new(false)),
                catalog_import_running: Arc::new(AtomicBool::new(false)),
                sync_queue: sync_queue_arc,
                sync_status: sync_status_arc,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Productos
            commands::products::find_product_by_barcode,
            commands::weighed_labels::create_weighed_label,
            commands::weighed_labels::find_weighed_label,
            commands::products::get_product,
            commands::products::list_products,
            commands::products::create_product,
            commands::products::update_product,
            commands::products::delete_product,
            commands::products::list_inactive_products,
            commands::products::reactivate_product,
            commands::products::bulk_set_category,
            commands::products::bulk_set_brand,
            commands::products::bulk_set_supplier,
            commands::products::list_expiring_products,
            commands::products::list_categories,
            commands::products::list_brands,
            commands::products::create_category,
            commands::products::rename_category,
            commands::products::delete_category,
            commands::products::rename_brand,
            commands::products::delete_brand,
            commands::products::list_product_velocities,
            // Ventas
            commands::sales::create_sale,
            commands::sales::get_sale,
            commands::sales::get_sale_with_items,
            commands::sales::list_sales,
            commands::sales::list_sales_range,
            commands::sales::list_sales_by_client,
            commands::sales::cancel_sale,
            // Devoluciones
            commands::returns::create_return,
            commands::returns::list_returns,
            commands::returns::get_return_with_items,
            // Reportes
            commands::reports::daily_report,
            commands::reports::range_report,
            commands::reports::sales_by_user,
            commands::reports::margin_report,
            commands::reports::margin_by_category,
            // Auditoría
            commands::audit::list_audit_log,
            // Stock
            commands::stock::adjust_stock,
            commands::stock::list_low_stock,
            commands::stock::list_stock_movements,
            commands::stock::top_products,
            commands::stock::top_products_by_qty,
            commands::stock::sales_by_category,
            commands::stock::reorder_by_supplier,
            // Caja
            commands::caja::open_cash_session,
            commands::caja::close_cash_session,
            commands::caja::get_current_session,
            commands::caja::list_open_sessions,
            commands::caja::list_cash_sessions,
            commands::caja::add_cash_movement,
            commands::caja::list_cash_movements,
            commands::caja::get_session_sales_total,
            commands::caja::get_session_all_sales_total,
            // Clientes
            commands::clients::list_clients,
            commands::clients::get_client,
            commands::clients::create_client,
            commands::clients::update_client,
            commands::clients::delete_client,
            commands::clients::list_inactive_clients,
            commands::clients::reactivate_client,
            commands::clients::client_account_history,
            commands::clients::register_client_payment,
            // Proveedores
            commands::suppliers::list_suppliers,
            commands::suppliers::create_supplier,
            commands::suppliers::update_supplier,
            commands::suppliers::delete_supplier,
            commands::suppliers::create_purchase_order,
            commands::suppliers::list_purchase_orders,
            commands::suppliers::receive_purchase_order,
            commands::suppliers::cancel_purchase_order,
            commands::suppliers::get_purchase_items,
            commands::suppliers::generate_auto_orders,
            // Configuración
            commands::config::get_config,
            commands::config::set_config,
            commands::config::get_all_config,
            commands::config::set_multiple_config,
            // Usuarios
            commands::users::list_users,
            commands::users::create_user,
            commands::users::update_user,
            commands::users::change_password,
            commands::users::delete_user,
            commands::users::login,
            commands::users::claim_admin_account,
            // Promociones
            commands::promotions::list_promotions,
            commands::promotions::create_promotion,
            commands::promotions::update_promotion,
            commands::promotions::toggle_promotion,
            commands::promotions::delete_promotion,
            // Combos y packs
            commands::combos::list_combos,
            commands::combos::list_combos_for_product,
            commands::combos::list_active_combos,
            commands::combos::find_combo_by_barcode,
            commands::combos::create_combo,
            commands::combos::update_combo,
            commands::combos::toggle_combo,
            commands::combos::delete_combo,
            // Presupuestos
            commands::quotes::list_quotes,
            commands::quotes::get_quote_with_items,
            commands::quotes::create_quote,
            commands::quotes::update_quote,
            commands::quotes::update_quote_status,
            commands::quotes::delete_quote,
            // Backup
            commands::backup::backup_database,
            commands::backup::list_backups,
            commands::backup::delete_backup,
            commands::backup::auto_backup_check,
            // Dashboard
            commands::dashboard::get_dashboard,
            // Insights
            commands::insights::get_insights,
            // RFM
            commands::clients::get_clients_rfm,
            // Stock muerto y desajuste precio
            commands::stock::get_dead_stock,
            commands::products::get_price_desync,
            // Lotes (FEFO)
            commands::lots::list_product_lots,
            commands::lots::list_expiring_lots,
            commands::lots::add_product_lot,
            commands::lots::retire_lot,
            commands::lots::update_lot_expiry,
            // Fase 3 — Productos
            commands::products::preview_bulk_update_prices,
            commands::products::apply_bulk_update_prices,
            commands::products::import_products_csv,
            // Inteligencia de negocio
            commands::products::get_min_stock_suggestions,
            commands::products::apply_min_stock_suggestions,
            commands::products::get_price_impact_projections,
            commands::reports::get_product_affinity,
            commands::suppliers::get_supplier_risk_scores,
            // Fase 3 — Proveedores
            commands::suppliers::get_supplier_lead_times,
            commands::suppliers::get_purchase_projections,
            commands::suppliers::get_supplier_cost_inflation,
            // Fase 3 — Reportes
            commands::reports::get_iva_report,
            // Fase 3 — Stock / Inventario
            commands::stock::list_inventory_count,
            commands::stock::apply_inventory_count,
            // Fase 4 — Red
            get_network_info,
            // Multicaja — modo servidor/cliente
            commands::device::get_device_config,
            commands::device::set_device_config,
            commands::device::bootstrap_from_server,
            commands::device::disconnect_client,
            // Licencia
            commands::device::get_license_status,
            commands::device::activate_license,
            sync_worker::get_sync_status,
            sync_worker::list_pending_sync_ops,
            sync_worker::enqueue_sync_op,
            // ARCA — Facturación electrónica
            commands::arca::get_arca_config,
            commands::arca::save_arca_config,
            commands::arca::generate_arca_keypair,
            commands::arca::load_arca_certificate,
            commands::arca::test_arca_connection,
            commands::arca::issue_electronic_invoice,
            commands::arca::list_electronic_invoices,
            commands::arca::retry_pending_invoices,
            // Catálogo — plantilla desde Open Food Facts (solo desarrollo)
            #[cfg(debug_assertions)]
            commands::catalog_import::generate_catalog_template,
        ])
        .run(tauri::generate_context!())
        .expect("error al correr la app Tauri");
}
