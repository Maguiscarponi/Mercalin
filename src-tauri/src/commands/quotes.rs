use crate::commands::{err, CmdResult};
use crate::models::{NewQuote, Quote, QuoteItem, QuoteWithItems};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_quote(row: &rusqlite::Row) -> rusqlite::Result<Quote> {
    Ok(Quote {
        id: row.get("id")?,
        client_id: row.get("client_id")?,
        client_name: row.get("client_name").ok(),
        user_id: row.get("user_id")?,
        total_cents: row.get("total_cents")?,
        discount_cents: row.get("discount_cents")?,
        notes: row.get("notes")?,
        status: row.get("status")?,
        valid_until: row.get("valid_until")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn list_quotes(state: State<AppState>) -> CmdResult<Vec<Quote>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT q.*, c.name as client_name
         FROM quotes q LEFT JOIN clients c ON q.client_id = c.id
         ORDER BY q.created_at DESC LIMIT 200",
    ).map_err(err)?;
    let rows = stmt.query_map([], row_to_quote).map_err(err)?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn get_quote_with_items(id: i64, state: State<AppState>) -> CmdResult<QuoteWithItems> {
    let conn = state.db.lock();
    let sql = "SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id = c.id WHERE q.id = ?1";
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let quote = stmt.query_row(params![id], row_to_quote).map_err(err)?;

    let mut stmt2 = conn.prepare(
        "SELECT *, ROUND(unit_price_cents * qty * (1 - discount_pct/100.0)) as subtotal_cents
         FROM quote_items WHERE quote_id = ?1 ORDER BY id",
    ).map_err(err)?;
    let rows = stmt2.query_map(params![id], |row| {
        Ok(QuoteItem {
            id: row.get("id")?,
            quote_id: row.get("quote_id")?,
            product_id: row.get("product_id")?,
            name: row.get("name")?,
            unit_price_cents: row.get("unit_price_cents")?,
            discount_pct: row.get("discount_pct")?,
            qty: row.get("qty")?,
            subtotal_cents: row.get("subtotal_cents")?,
        })
    }).map_err(err)?;
    let mut items = Vec::new();
    for r in rows { items.push(r.map_err(err)?); }
    Ok(QuoteWithItems { quote, items })
}

#[tauri::command]
pub fn create_quote(quote: NewQuote, state: State<AppState>) -> CmdResult<Quote> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let subtotal: i64 = quote.items.iter().map(|i| {
        let line = (i.unit_price_cents as f64 * i.qty).round() as i64;
        let disc = (line as f64 * i.discount_pct / 100.0).round() as i64;
        line - disc
    }).sum();
    let total = (subtotal - quote.discount_cents).max(0);

    tx.execute(
        "INSERT INTO quotes (client_id,user_id,total_cents,discount_cents,notes,status,valid_until)
         VALUES (?1,?2,?3,?4,?5,'borrador',?6)",
        params![quote.client_id, quote.user_id, total, quote.discount_cents, quote.notes, quote.valid_until],
    ).map_err(err)?;
    let qid = tx.last_insert_rowid();

    for item in &quote.items {
        tx.execute(
            "INSERT INTO quote_items (quote_id,product_id,name,unit_price_cents,discount_pct,qty)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![qid, item.product_id, item.name, item.unit_price_cents, item.discount_pct, item.qty],
        ).map_err(err)?;
    }
    tx.commit().map_err(err)?;

    let conn2 = state.db.lock();
    let sql = "SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id = c.id WHERE q.id = ?1";
    let mut stmt = conn2.prepare(sql).map_err(err)?;
    stmt.query_row(params![qid], row_to_quote).map_err(err)
}

#[tauri::command]
pub fn update_quote_status(id: i64, status: String, state: State<AppState>) -> CmdResult<Quote> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE quotes SET status=?1, updated_at=datetime('now','localtime') WHERE id=?2",
        params![status, id],
    ).map_err(err)?;
    let sql = "SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id = c.id WHERE q.id = ?1";
    let mut stmt = conn.prepare(sql).map_err(err)?;
    stmt.query_row(params![id], row_to_quote).map_err(err)
}

#[tauri::command]
pub fn delete_quote(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute("DELETE FROM quotes WHERE id=?1", params![id]).map_err(err)?;
    Ok(())
}
