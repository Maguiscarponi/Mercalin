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
    // La API nueva (ver fetch_page) devuelve `brands` como lista, la vieja lo devolvía
    // como string separado por comas -- este tipo ya es el de la API nueva.
    brands: Option<Vec<String>>,
    quantity: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OffResponse {
    #[serde(default)]
    page_count: i64,
    hits: Vec<OffProduct>,
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

    if let Some(brand) = p.brands.as_ref().and_then(|b| b.first()) {
        let brand = brand.trim();
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

/// Open Food Facts reemplazó su API de búsqueda vieja (ar.openfoodfacts.org/api/v2/search,
/// verificado caída/inestable -- devuelve 503 o una página HTML de "temporalmente no
/// disponible" en vez de JSON) por una nueva ("search-a-licious", search.openfoodfacts.org).
/// Esa nueva API no tiene un filtro de país confiable expuesto como parámetro (y el tag de
/// país de un producto no siempre coincide con dónde se vende igual, se probó a mano), así
/// que se busca directo por prefijo de código de barras argentino con sintaxis Lucene
/// (`code:778*`) -- que es exactamente lo que is_argentine_barcode() valida de nuevo después,
/// asi que no se pierde precisión.
fn fetch_page(prefix: &str, page: i64) -> Result<OffResponse, String> {
    let url = format!(
        "https://search.openfoodfacts.org/search?q=code:{prefix}*&page_size={PAGE_SIZE}&page={page}&fields=code,product_name,brands,quantity"
    );
    let resp = ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Error consultando Open Food Facts (código \"{prefix}*\", página {page}): {e}"))?;
    let body = resp
        .into_string()
        .map_err(|e| format!("Error leyendo la respuesta de Open Food Facts: {e}"))?;
    serde_json::from_str::<OffResponse>(&body)
        .map_err(|e| format!("Respuesta inesperada de Open Food Facts (código \"{prefix}*\", página {page}): {e}"))
}

/// La página 1 de cada prefijo es la más sensible a un hiccup pasajero de red (DNS, TLS, un
/// 429 momentáneo por haber probado la API varias veces seguidas): sin ella no sabemos ni
/// cuántas páginas hay para ese prefijo, así que vale la pena reintentar antes de saltarla.
fn fetch_page_with_retries(prefix: &str, page: i64, attempts: u32) -> Result<OffResponse, String> {
    let mut last_err = String::new();
    for attempt in 0..attempts.max(1) {
        match fetch_page(prefix, page) {
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
/// mientras esto tarda su minuto o dos. Recorre los dos prefijos de código de barras
/// argentinos (778, 779) uno detrás del otro.
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

    let mut imported: i64 = 0;
    let mut skipped_existing: i64 = 0;
    let mut skipped_invalid: i64 = 0;
    let mut failed_pages: i64 = 0;
    let mut scanned: i64 = 0;
    let mut early_stop_note: Option<String> = None;
    let mut any_page_succeeded = false;
    // Si Open Food Facts empieza a rechazar pedidos seguidos (503, timeouts), seguir
    // insistiendo página tras página solo estira la espera sin sentido — mejor cortar
    // rápido con una explicación clara. Lo ya importado queda guardado igual.
    const MAX_CONSECUTIVE_FAILURES: i64 = 6;

    // Progreso combinado entre los dos prefijos — el total se recalcula apenas se conoce
    // el de cada uno (llega junto con la página 1 de ese prefijo).
    let mut overall_page: i64 = 0;
    let mut overall_total_pages: i64 = 0;

    'prefixes: for prefix in AR_BARCODE_PREFIXES {
        if cancelled.load(Ordering::SeqCst) {
            break;
        }

        let mut page: i64 = 1;
        let mut total_pages_this_prefix: i64 = 1;
        let mut consecutive_failures: i64 = 0;

        loop {
            if cancelled.load(Ordering::SeqCst) {
                break 'prefixes;
            }

            let parsed = match fetch_page_with_retries(prefix, page, if page == 1 { 3 } else { 1 }) {
                Ok(p) => {
                    consecutive_failures = 0;
                    any_page_succeeded = true;
                    p
                }
                Err(e) => {
                    // Si ni la primera página de todo el import funcionó, la API está caída
                    // de verdad — no tiene sentido seguir insistiendo con más prefijos.
                    if !any_page_succeeded {
                        return Err(e);
                    }
                    failed_pages += 1;
                    consecutive_failures += 1;
                    overall_page += 1;
                    let _ = app.emit(
                        "catalog_import_progress",
                        CatalogImportProgress { page: overall_page, total_pages: overall_total_pages.max(overall_page), imported, scanned },
                    );
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                        early_stop_note = Some(format!(
                            "Open Food Facts empezó a rechazar los pedidos (probablemente por la cantidad de pruebas de hoy desde esta conexión). Se cortó el import en la página {page} del código \"{prefix}*\" — lo que ya se importó quedó guardado. Probá de nuevo más tarde, no se duplica nada."
                        ));
                        break 'prefixes;
                    }
                    std::thread::sleep(Duration::from_millis(PAGE_DELAY_MS));
                    page += 1;
                    if page > total_pages_this_prefix {
                        break;
                    }
                    continue;
                }
            };

            if page == 1 {
                total_pages_this_prefix = parsed.page_count.max(1);
                overall_total_pages += total_pages_this_prefix;
            }
            overall_page += 1;

            let mut new_rows: Vec<(String, String)> = Vec::new();
            for p in &parsed.hits {
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
                    // Entra como fantasma (active=0, is_ghost=1): no cuenta en alertas ni en el
                    // listado por defecto hasta que alguien lo busque/escanee y le ponga precio.
                    let res = tx.execute(
                        "INSERT OR IGNORE INTO products
                         (barcode, name, price_cents, cost_cents, stock, min_stock, category, active, is_ghost)
                         VALUES (?1, ?2, 0, 0, 0, 0, 'Importado', 0, 1)",
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
                CatalogImportProgress { page: overall_page, total_pages: overall_total_pages, imported, scanned },
            );

            if parsed.hits.is_empty() || page >= total_pages_this_prefix {
                break;
            }
            page += 1;
            std::thread::sleep(Duration::from_millis(PAGE_DELAY_MS));
        }
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
/// ya está en la base, se salta. Entran como "fantasma" (sin precio) — Caja no deja vender
/// un producto sin precio, así que no hay riesgo de venderlos gratis.
///
/// El comando en sí vuelve casi al instante: todo el trabajo corre en un hilo del sistema
/// operativo aparte, igual que ya hace el servidor del modo tablet. El progreso y el
/// resultado final viajan por eventos (`catalog_import_progress` / `catalog_import_done`),
/// nunca bloqueando la respuesta del comando — así el resto de la app queda usable mientras
/// esto corre en segundo plano.
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

/// Herramienta de uso interno (solo build de desarrollo, ver el gate en lib.rs): arma una
/// base de datos "plantilla" desde cero -- esquema limpio + catálogo completo importado de
/// Open Food Facts, sin usuarios ni datos de prueba -- pensada para copiarse a mano a
/// `src-tauri/resources/template.db` y empaquetarse con el instalador (ver setup() en
/// lib.rs), así cualquier cliente nuevo arranca con el catálogo ya cargado en vez de
/// depender de que él mismo tenga internet y espere el import el primer día.
///
/// Nunca toca la base de datos que la app tiene abierta -- crea una completamente aparte
/// en catalog_template.db, al lado de kiosco.db.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn generate_catalog_template(app: AppHandle, state: State<AppState>) -> CmdResult<String> {
    if state.catalog_import_running.swap(true, Ordering::SeqCst) {
        return Err("Ya hay una importación en curso.".into());
    }
    state.catalog_import_cancelled.store(false, Ordering::SeqCst);

    let app_dir = state
        .db_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "No se pudo determinar la carpeta de datos".to_string())?;
    let template_path = app_dir.join("catalog_template.db");
    let _ = std::fs::remove_file(&template_path);
    let _ = std::fs::remove_file(app_dir.join("catalog_template.db-wal"));
    let _ = std::fs::remove_file(app_dir.join("catalog_template.db-shm"));

    let running_flag = Arc::clone(&state.catalog_import_running);
    let cancelled_flag = Arc::clone(&state.catalog_import_cancelled);
    let app_handle = app.clone();
    let template_path_for_thread = template_path.clone();

    std::thread::spawn(move || {
        let result = (|| -> Result<CatalogImportResult, String> {
            let conn = crate::db::open_and_migrate_clean(&template_path_for_thread).map_err(|e| e.to_string())?;
            let db: Arc<Mutex<Connection>> = Arc::new(Mutex::new(conn));
            run_import(&app_handle, &db, &cancelled_flag)
        })();
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

    Ok(template_path.display().to_string())
}
