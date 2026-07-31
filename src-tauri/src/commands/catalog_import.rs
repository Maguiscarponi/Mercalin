use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{CatalogImportProgress, CatalogImportResult};
use crate::AppState;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const USER_AGENT: &str = "PuntoSimplePOS-KioscoLocal/1.0";
const PAGE_SIZE: i64 = 100;
const PAGE_DELAY_MS: u64 = 350;
const AR_BARCODE_PREFIXES: [&str; 2] = ["778", "779"];

#[derive(Debug, Deserialize)]
struct OffProduct {
    code: Option<String>,
    product_name: Option<String>,
    brands: Option<String>,
    quantity: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OffResponse {
    count: i64,
    products: Vec<OffProduct>,
}

fn is_argentine_barcode(code: &str) -> bool {
    code.len() >= 8
        && code.chars().all(|c| c.is_ascii_digit())
        && AR_BARCODE_PREFIXES.iter().any(|p| code.starts_with(p))
}

/// Arma un nombre legible combinando nombre + marca + cantidad, evitando repetir
/// información que Open Food Facts ya incluye duplicada entre esos tres campos.
fn clean_name(p: &OffProduct) -> Option<String> {
    let base = p.product_name.as_deref()?.trim();
    if base.is_empty() {
        return None;
    }
    let mut name = base.to_string();
    let base_lower = base.to_lowercase();

    if let Some(brands) = p.brands.as_deref() {
        let brand = brands.split(',').next().unwrap_or("").trim();
        if !brand.is_empty() && !base_lower.contains(&brand.to_lowercase()) {
            name = format!("{} {}", name, brand);
        }
    }
    if let Some(qty) = p.quantity.as_deref() {
        let qty = qty.trim();
        if !qty.is_empty() && !base_lower.contains(&qty.to_lowercase()) {
            name = format!("{} ({})", name, qty);
        }
    }
    Some(name)
}

fn fetch_page(page: i64) -> Result<OffResponse, String> {
    let url = format!(
        "https://ar.openfoodfacts.org/api/v2/search?countries_tags=en:argentina&fields=code,product_name,brands,quantity&page_size={}&page={}",
        PAGE_SIZE, page
    );
    let resp = ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Error consultando Open Food Facts (página {}): {}", page, e))?;
    let body = resp
        .into_string()
        .map_err(|e| format!("Error leyendo la respuesta de Open Food Facts: {}", e))?;
    serde_json::from_str::<OffResponse>(&body)
        .map_err(|e| format!("Respuesta inesperada de Open Food Facts (página {}): {}", page, e))
}

/// La página 1 es la más sensible a un hiccup pasajero de red (DNS, TLS, un 429 momentáneo
/// por haber probado la API varias veces seguidas): sin ella no sabemos ni cuántas páginas hay,
/// así que vale la pena reintentar antes de abortar todo el import.
fn fetch_page_with_retries(page: i64, attempts: u32) -> Result<OffResponse, String> {
    let mut last_err = String::new();
    for attempt in 0..attempts.max(1) {
        match fetch_page(page) {
            Ok(p) => return Ok(p),
            Err(e) => {
                last_err = e;
                if attempt + 1 < attempts {
                    std::thread::sleep(Duration::from_millis(800 * (attempt as u64 + 1)));
                }
            }
        }
    }
    Err(last_err)
}

/// El trabajo real del import, pensado para correr en su propio hilo del sistema operativo
/// (ver `import_off_catalog` más abajo) — nunca en el hilo que atiende los comandos de Tauri,
/// para que el resto de la app (incluido cualquier click del usuario) siga respondiendo
/// mientras esto tarda su minuto o dos.
fn run_import(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    cancelled: &Arc<AtomicBool>,
) -> Result<CatalogImportResult, String> {
    let mut known_barcodes: HashSet<String> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare("SELECT barcode FROM products WHERE barcode IS NOT NULL")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut page: i64 = 1;
    let mut total_pages: i64 = 1;
    let mut imported: i64 = 0;
    let mut skipped_existing: i64 = 0;
    let mut skipped_invalid: i64 = 0;
    let mut failed_pages: i64 = 0;
    let mut scanned: i64 = 0;
    let mut total_count: i64 = i64::MAX;
    let mut consecutive_failures: i64 = 0;
    let mut early_stop_note: Option<String> = None;
    // Si Open Food Facts empieza a rechazar pedidos seguidos (503, timeouts), seguir
    // insistiendo página tras página solo estira la espera sin sentido — mejor cortar
    // rápido con una explicación clara. Lo ya importado queda guardado igual.
    const MAX_CONSECUTIVE_FAILURES: i64 = 6;

    loop {
        if cancelled.load(Ordering::SeqCst) {
            break;
        }

        let parsed = match fetch_page_with_retries(page, if page == 1 { 3 } else { 1 }) {
            Ok(p) => { consecutive_failures = 0; p }
            Err(e) => {
                if page == 1 {
                    return Err(e);
                }
                failed_pages += 1;
                consecutive_failures += 1;
                let _ = app.emit(
                    "catalog_import_progress",
                    CatalogImportProgress { page, total_pages, imported, scanned },
                );
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    early_stop_note = Some(format!(
                        "Open Food Facts empezó a rechazar los pedidos (probablemente por la cantidad de pruebas de hoy desde esta conexión). Se cortó el import en la página {page} de {total_pages} — lo que ya se importó quedó guardado. Probá de nuevo más tarde, no se duplica nada."
                    ));
                    break;
                }
                std::thread::sleep(Duration::from_millis(PAGE_DELAY_MS));
                page += 1;
                if page > total_pages {
                    break;
                }
                continue;
            }
        };

        if page == 1 {
            total_count = parsed.count;
            total_pages = ((parsed.count as f64) / (PAGE_SIZE as f64)).ceil().max(1.0) as i64;
        }

        let mut new_rows: Vec<(String, String)> = Vec::new();
        for p in &parsed.products {
            scanned += 1;
            let code = match p.code.as_deref() {
                Some(c) if is_argentine_barcode(c) => c.to_string(),
                _ => {
                    skipped_invalid += 1;
                    continue;
                }
            };
            if known_barcodes.contains(&code) {
                skipped_existing += 1;
                continue;
            }
            let name = match clean_name(p) {
                Some(n) => n,
                None => {
                    skipped_invalid += 1;
                    continue;
                }
            };
            known_barcodes.insert(code.clone());
            new_rows.push((code, name));
        }

        if !new_rows.is_empty() {
            let mut conn = db.lock();
            let tx = conn.transaction().map_err(err)?;
            for (barcode, name) in &new_rows {
                let res = tx.execute(
                    "INSERT OR IGNORE INTO products
                     (barcode, name, price_cents, cost_cents, stock, min_stock, category, active)
                     VALUES (?1, ?2, 0, 0, 0, 0, 'Importado', 1)",
                    params![barcode, name],
                );
                if let Ok(n) = res {
                    if n > 0 {
                        imported += 1;
                    }
                }
            }
            tx.commit().map_err(err)?;
        }

        let _ = app.emit(
            "catalog_import_progress",
            CatalogImportProgress { page, total_pages, imported, scanned },
        );

        if page * PAGE_SIZE >= total_count || parsed.products.is_empty() {
            break;
        }
        page += 1;
        std::thread::sleep(Duration::from_millis(PAGE_DELAY_MS));
    }

    let was_cancelled = cancelled.load(Ordering::SeqCst);
    {
        let conn = db.lock();
        log_action(
            &conn,
            None,
            "importacion_open_food_facts",
            "productos",
            None,
            Some(&format!(
                "Nuevos: {imported}, ya existentes: {skipped_existing}, inválidos: {skipped_invalid}, páginas fallidas: {failed_pages}, cancelado: {was_cancelled}"
            )),
        );
    }

    Ok(CatalogImportResult {
        imported,
        skipped_existing,
        skipped_invalid,
        failed_pages,
        scanned,
        cancelled: was_cancelled,
        error: early_stop_note,
    })
}

/// Importa productos nuevos (por código de barras argentino real) desde el catálogo
/// público de Open Food Facts. Nunca modifica productos que ya existen: si el barcode
/// ya está en la base, se salta. Quedan activos, con precio y costo en $0 — Caja no
/// deja vender un producto sin precio, así que no hay riesgo de venderlos gratis.
///
/// El comando en sí vuelve casi al instante: todo el trabajo (las ~150 páginas, con pausas
/// entre cada una) corre en un hilo del sistema operativo aparte, igual que ya hace el
/// servidor del modo tablet. El progreso y el resultado final viajan por eventos
/// (`catalog_import_progress` / `catalog_import_done`), nunca bloqueando la respuesta
/// del comando — así el resto de la app queda usable mientras esto corre en segundo plano.
#[tauri::command]
pub fn import_off_catalog(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    if state.catalog_import_running.swap(true, Ordering::SeqCst) {
        return Err("Ya hay una importación en curso.".into());
    }
    state.catalog_import_cancelled.store(false, Ordering::SeqCst);

    let db = Arc::clone(&state.db);
    let running_flag = Arc::clone(&state.catalog_import_running);
    let cancelled_flag = Arc::clone(&state.catalog_import_cancelled);
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let result = run_import(&app_handle, &db, &cancelled_flag);
        running_flag.store(false, Ordering::SeqCst);
        let payload = result.unwrap_or_else(|e| CatalogImportResult {
            imported: 0,
            skipped_existing: 0,
            skipped_invalid: 0,
            failed_pages: 0,
            scanned: 0,
            cancelled: false,
            error: Some(e),
        });
        let _ = app_handle.emit("catalog_import_done", payload);
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_off_catalog_import(state: State<AppState>) -> CmdResult<()> {
    state.catalog_import_cancelled.store(true, Ordering::SeqCst);
    Ok(())
}
