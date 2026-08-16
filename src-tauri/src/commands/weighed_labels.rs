use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{NewWeighedLabel, WeighedLabel};
use crate::AppState;
use rusqlite::{params, Row};
use tauri::State;

fn row_to_weighed_label(row: &Row) -> rusqlite::Result<WeighedLabel> {
    Ok(WeighedLabel {
        id: row.get("id")?,
        barcode: row.get("barcode")?,
        product_id: row.get("product_id")?,
        product_name: row.get("product_name")?,
        weight_kg: row.get("weight_kg")?,
        unit_price_cents: row.get("unit_price_cents")?,
        total_price_cents: row.get("total_price_cents")?,
        created_at: row.get("created_at")?,
    })
}

// Genera un código de barras único para un paquete pesado puntual (ej. una
// bolsa de queso rallado de 560g) — al escanearlo en Caja, el sistema ya
// sabe el peso y el precio exactos sin volver a preguntar. Precio y total
// quedan "congelados" al momento de imprimir: si el precio del producto
// cambia después, esta etiqueta ya impresa sigue cobrando lo que dice el
// papel. Prefijo "90": ningún código real de producto argentino (GS1 779...)
// empieza así, así que nunca choca con un barcode de verdad.
#[tauri::command]
pub fn create_weighed_label(input: NewWeighedLabel, user_id: Option<i64>, state: State<AppState>) -> CmdResult<WeighedLabel> {
    let conn = state.db.lock();
    let total_price_cents = (input.unit_price_cents as f64 * input.weight_kg).round() as i64;

    conn.execute(
        "INSERT INTO weighed_labels (barcode, product_id, weight_kg, unit_price_cents, total_price_cents)
         VALUES ('', ?1, ?2, ?3, ?4)",
        params![input.product_id, input.weight_kg, input.unit_price_cents, total_price_cents],
    ).map_err(err)?;

    let id = conn.last_insert_rowid();
    let barcode = format!("90{:010}", id);
    conn.execute("UPDATE weighed_labels SET barcode = ?1 WHERE id = ?2", params![barcode, id]).map_err(err)?;

    log_action(&conn, user_id, "crear", "etiqueta_pesada", Some(id), Some(&format!("{:.3} kg", input.weight_kg)));

    let mut stmt = conn.prepare(
        "SELECT wl.*, p.name as product_name FROM weighed_labels wl
         JOIN products p ON p.id = wl.product_id
         WHERE wl.id = ?1",
    ).map_err(err)?;
    stmt.query_row(params![id], row_to_weighed_label).map_err(err)
}

#[tauri::command]
pub fn find_weighed_label(barcode: String, state: State<AppState>) -> CmdResult<Option<WeighedLabel>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT wl.*, p.name as product_name FROM weighed_labels wl
         JOIN products p ON p.id = wl.product_id
         WHERE wl.barcode = ?1",
    ).map_err(err)?;
    Ok(stmt.query_row(params![barcode], row_to_weighed_label).ok())
}
