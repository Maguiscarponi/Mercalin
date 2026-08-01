// Hilo de fondo para una caja en modo "cliente": vigila si hay conexión con
// el servidor, y cuando se reconecta después de haber estado offline, vacía
// la cola de operaciones pendientes (ver `sync_db.rs`) y refresca una copia
// local liviana de los datos que más importan para seguir vendiendo bien en
// la próxima ventana sin conexión.
//
// Nota sobre `users`: a propósito NO se resincroniza acá. `list_users` no
// devuelve el hash de contraseña (correcto, por seguridad), así que no hay
// forma de mantener el login local al día con este mecanismo liviano — la
// única vía es un "Resincronizar todo" completo (clonado de la base, que sí
// trae el hash porque es una copia cruda del archivo).

use crate::AppState;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

fn set_status(app: &AppHandle, status_arc: &Arc<Mutex<String>>, status: &str) {
    let changed = {
        let mut s = status_arc.lock();
        if *s == status {
            false
        } else {
            *s = status.to_string();
            true
        }
    };
    if changed {
        let _ = app.emit("sync_status_changed", status);
    }
}

fn is_server_healthy(server_addr: &str) -> bool {
    let url = format!("http://{}/api/health", server_addr);
    ureq::get(&url).timeout(HEALTH_TIMEOUT).call().is_ok()
}

fn call_rpc(server_addr: &str, command: &str, body_json: &str) -> Result<Value, String> {
    let url = format!("http://{}/api/rpc/{}", server_addr, command);
    let response = ureq::post(&url)
        .set("Content-Type", "application/json")
        .timeout(HTTP_TIMEOUT)
        .send_string(body_json)
        .map_err(|e| format!("{}", e))?;
    let text = response.into_string().map_err(|e| format!("{}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("respuesta inválida: {}", e))
}

/// Reproduce contra el servidor las operaciones que se hicieron localmente
/// mientras esta caja estuvo sin conexión. Se detiene apenas hay un error de
/// red (deja el resto en 'pending' para el próximo ciclo) pero sigue de
/// largo si el servidor RECHAZA una operación puntual (queda 'failed', con
/// el motivo, para que la dueña la revise — no bloquea a las demás).
fn drain_queue(queue: &Arc<Mutex<Connection>>, server_addr: &str) {
    let rows: Vec<(i64, String, String)> = {
        let conn = queue.lock();
        let mut stmt = match conn.prepare(
            "SELECT id, command, payload_json FROM pending_sync_ops WHERE status='pending' ORDER BY id ASC",
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let mapped = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        });
        match mapped {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(_) => return,
        }
    };

    for (id, command, payload_json) in rows {
        match call_rpc(server_addr, &command, &payload_json) {
            Ok(json) => {
                let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                let conn = queue.lock();
                if ok {
                    let _ = conn.execute(
                        "UPDATE pending_sync_ops SET status='synced', synced_at=datetime('now','localtime') WHERE id=?1",
                        params![id],
                    );
                } else {
                    let error = json.get("error").and_then(|v| v.as_str()).unwrap_or("Error desconocido");
                    let _ = conn.execute(
                        "UPDATE pending_sync_ops SET status='failed', last_error=?2, attempts=attempts+1 WHERE id=?1",
                        params![id, error],
                    );
                }
            }
            Err(_) => {
                // Sin conexión a mitad de la cola: cortamos acá, se reintenta en el próximo ciclo.
                break;
            }
        }
    }
}

fn upsert_products(db: &Arc<Mutex<Connection>>, data: &Value) {
    let Some(items) = data.as_array() else { return };
    let conn = db.lock();
    for p in items {
        let _ = conn.execute(
            "INSERT INTO products (id, barcode, name, price_cents, price2_cents, price3_cents, cost_cents, stock, min_stock, category, is_weighable, active, is_ghost, supplier_id, expires_at, image_path, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
             ON CONFLICT(id) DO UPDATE SET
                barcode=excluded.barcode, name=excluded.name, price_cents=excluded.price_cents,
                price2_cents=excluded.price2_cents, price3_cents=excluded.price3_cents, cost_cents=excluded.cost_cents,
                stock=excluded.stock, min_stock=excluded.min_stock, category=excluded.category,
                is_weighable=excluded.is_weighable, active=excluded.active, is_ghost=excluded.is_ghost,
                supplier_id=excluded.supplier_id, expires_at=excluded.expires_at, image_path=excluded.image_path,
                updated_at=excluded.updated_at",
            params![
                p.get("id").and_then(|v| v.as_i64()),
                p.get("barcode").and_then(|v| v.as_str()),
                p.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                p.get("price_cents").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("price2_cents").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("price3_cents").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("cost_cents").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("stock").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("min_stock").and_then(|v| v.as_i64()).unwrap_or(0),
                p.get("category").and_then(|v| v.as_str()),
                p.get("is_weighable").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
                p.get("active").and_then(|v| v.as_bool()).unwrap_or(true) as i64,
                p.get("is_ghost").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
                p.get("supplier_id").and_then(|v| v.as_i64()),
                p.get("expires_at").and_then(|v| v.as_str()),
                p.get("image_path").and_then(|v| v.as_str()),
                p.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
                p.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""),
            ],
        );
    }
}

// Nota: `balance_cents` de `Client` NO es una columna real -- `list_clients`
// lo calcula al vuelo con una subquery sobre `client_account` (ver
// `commands/clients.rs`). No hay nada que sincronizar ahí: el saldo se
// recalcula solo en cuanto la tabla `client_account` local esté al día
// (lo que sí viaja es cada pago/cargo, vía la cola de ventas/pagos).
fn upsert_clients(db: &Arc<Mutex<Connection>>, data: &Value) {
    let Some(items) = data.as_array() else { return };
    let conn = db.lock();
    for c in items {
        let _ = conn.execute(
            "INSERT INTO clients (id, name, phone, email, address, dni, notes, credit_limit_cents, is_ri, active, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, phone=excluded.phone, email=excluded.email, address=excluded.address,
                dni=excluded.dni, notes=excluded.notes, credit_limit_cents=excluded.credit_limit_cents,
                is_ri=excluded.is_ri, active=excluded.active, updated_at=excluded.updated_at",
            params![
                c.get("id").and_then(|v| v.as_i64()),
                c.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                c.get("phone").and_then(|v| v.as_str()),
                c.get("email").and_then(|v| v.as_str()),
                c.get("address").and_then(|v| v.as_str()),
                c.get("dni").and_then(|v| v.as_str()),
                c.get("notes").and_then(|v| v.as_str()),
                c.get("credit_limit_cents").and_then(|v| v.as_i64()).unwrap_or(0),
                c.get("is_ri").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
                c.get("active").and_then(|v| v.as_bool()).unwrap_or(true) as i64,
                c.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
                c.get("updated_at").and_then(|v| v.as_str()).unwrap_or(""),
            ],
        );
    }
}

fn upsert_config(db: &Arc<Mutex<Connection>>, data: &Value) {
    let Some(items) = data.as_array() else { return };
    let conn = db.lock();
    for e in items {
        let (Some(key), Some(value)) = (e.get("key").and_then(|v| v.as_str()), e.get("value").and_then(|v| v.as_str())) else { continue };
        let _ = conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        );
    }
}

fn resync_light(db: &Arc<Mutex<Connection>>, server_addr: &str) {
    if let Ok(json) = call_rpc(server_addr, "list_products", r#"{"query":"","includeGhosts":true}"#) {
        if let Some(data) = json.get("data") {
            upsert_products(db, data);
        }
    }
    if let Ok(json) = call_rpc(server_addr, "list_clients", r#"{"query":""}"#) {
        if let Some(data) = json.get("data") {
            upsert_clients(db, data);
        }
    }
    if let Ok(json) = call_rpc(server_addr, "get_all_config", "{}") {
        if let Some(data) = json.get("data") {
            upsert_config(db, data);
        }
    }
}

/// No bloquea: spawnea el hilo de polling y vuelve enseguida.
pub fn run_sync_worker(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    queue: Arc<Mutex<Connection>>,
    status: Arc<Mutex<String>>,
    server_addr: String,
) {
    std::thread::spawn(move || loop {
        let was_offline = { status.lock().clone() } == "offline";
        let healthy = is_server_healthy(&server_addr);

        if healthy {
            if was_offline {
                set_status(&app, &status, "syncing");
                drain_queue(&queue, &server_addr);
                resync_light(&db, &server_addr);
            }
            set_status(&app, &status, "online");
        } else {
            set_status(&app, &status, "offline");
        }

        std::thread::sleep(POLL_INTERVAL);
    });
}

#[tauri::command]
pub fn get_sync_status(state: tauri::State<AppState>) -> String {
    state.sync_status.lock().clone()
}

#[tauri::command]
pub fn list_pending_sync_ops(state: tauri::State<AppState>) -> crate::commands::CmdResult<Vec<crate::models::PendingSyncOp>> {
    let conn = state.sync_queue.lock();
    let mut stmt = conn
        .prepare("SELECT id, created_at, command, payload_json, status, attempts, last_error, synced_at FROM pending_sync_ops ORDER BY id DESC LIMIT 200")
        .map_err(crate::commands::err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(crate::models::PendingSyncOp {
                id: r.get(0)?,
                created_at: r.get(1)?,
                command: r.get(2)?,
                payload_json: r.get(3)?,
                status: r.get(4)?,
                attempts: r.get(5)?,
                last_error: r.get(6)?,
                synced_at: r.get(7)?,
            })
        })
        .map_err(crate::commands::err)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn enqueue_sync_op(command: String, payload: Value, state: tauri::State<AppState>) -> crate::commands::CmdResult<()> {
    let conn = state.sync_queue.lock();
    let payload_json = serde_json::to_string(&payload).map_err(crate::commands::err)?;
    conn.execute(
        "INSERT INTO pending_sync_ops (command, payload_json) VALUES (?1, ?2)",
        params![command, payload_json],
    )
    .map_err(crate::commands::err)?;
    Ok(())
}
