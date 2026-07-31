use crate::commands::{err, CmdResult};
use crate::models::{Client, ClientAccountEntry, ClientPaymentInput, ClientRfm, NewClient};
use crate::AppState;
use rusqlite::{params, Row};
use tauri::State;

fn row_to_client(row: &Row) -> rusqlite::Result<Client> {
    Ok(Client {
        id: row.get("id")?,
        name: row.get("name")?,
        phone: row.get("phone")?,
        email: row.get("email")?,
        address: row.get("address")?,
        dni: row.get("dni")?,
        notes: row.get("notes")?,
        credit_limit_cents: row.get("credit_limit_cents")?,
        balance_cents: row.get("balance_cents")?,
        is_ri: row.get::<_, i64>("is_ri").unwrap_or(0) != 0,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const CLIENT_SELECT: &str = "
    SELECT c.*,
           COALESCE(
               (SELECT SUM(CASE WHEN ca.movement_type = 'cargo' THEN ca.amount_cents
                                ELSE -ca.amount_cents END)
                FROM client_account ca
                WHERE ca.client_id = c.id),
               0
           ) as balance_cents
    FROM clients c";

#[tauri::command]
pub fn list_clients(query: String, state: State<AppState>) -> CmdResult<Vec<Client>> {
    let conn = state.db.lock();
    let q = query.trim().to_string();

    let sql = if q.is_empty() {
        format!("{} WHERE c.active = 1 ORDER BY c.name LIMIT 200", CLIENT_SELECT)
    } else {
        format!(
            "{} WHERE c.active = 1 AND (c.name LIKE ?1 OR c.phone LIKE ?1 OR c.dni LIKE ?1) ORDER BY c.name LIMIT 50",
            CLIENT_SELECT
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(err)?;

    let rows = if q.is_empty() {
        stmt.query_map([], row_to_client).map_err(err)?
    } else {
        let pattern = format!("%{}%", q);
        stmt.query_map(params![pattern], row_to_client).map_err(err)?
    };

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_client(id: i64, state: State<AppState>) -> CmdResult<Client> {
    let conn = state.db.lock();
    let sql = format!("{} WHERE c.id = ?1", CLIENT_SELECT);
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    stmt.query_row(params![id], row_to_client).map_err(err)
}

#[tauri::command]
pub fn create_client(client: NewClient, state: State<AppState>) -> CmdResult<Client> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO clients (name, phone, email, address, dni, notes, credit_limit_cents, is_ri)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            client.name,
            client.phone,
            client.email,
            client.address,
            client.dni,
            client.notes,
            client.credit_limit_cents,
            client.is_ri as i64,
        ],
    )
    .map_err(err)?;

    let id = conn.last_insert_rowid();
    let sql = format!("{} WHERE c.id = ?1", CLIENT_SELECT);
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    stmt.query_row(params![id], row_to_client).map_err(err)
}

#[tauri::command]
pub fn update_client(client: Client, state: State<AppState>) -> CmdResult<Client> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE clients SET name=?1, phone=?2, email=?3, address=?4, dni=?5,
         notes=?6, credit_limit_cents=?7, is_ri=?8, updated_at=CURRENT_TIMESTAMP
         WHERE id = ?9",
        params![
            client.name,
            client.phone,
            client.email,
            client.address,
            client.dni,
            client.notes,
            client.credit_limit_cents,
            client.is_ri as i64,
            client.id,
        ],
    )
    .map_err(err)?;

    let sql = format!("{} WHERE c.id = ?1", CLIENT_SELECT);
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    stmt.query_row(params![client.id], row_to_client).map_err(err)
}

#[tauri::command]
pub fn delete_client(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE clients SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn client_account_history(
    client_id: i64,
    state: State<AppState>,
) -> CmdResult<Vec<ClientAccountEntry>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT * FROM client_account WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![client_id], |row| {
            Ok(ClientAccountEntry {
                id: row.get("id")?,
                client_id: row.get("client_id")?,
                amount_cents: row.get("amount_cents")?,
                movement_type: row.get("movement_type")?,
                concept: row.get("concept")?,
                sale_id: row.get("sale_id")?,
                created_at: row.get("created_at")?,
            })
        })
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn register_client_payment(
    input: ClientPaymentInput,
    state: State<AppState>,
) -> CmdResult<Client> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO client_account (client_id, amount_cents, movement_type, concept)
         VALUES (?1, ?2, 'pago', ?3)",
        params![input.client_id, input.amount_cents, input.concept],
    )
    .map_err(err)?;

    let sql = format!("{} WHERE c.id = ?1", CLIENT_SELECT);
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    stmt.query_row(params![input.client_id], row_to_client)
        .map_err(err)
}

fn classify_rfm_segment(
    total_purchases: i64,
    recency_days: i64,
    avg_frequency_days: Option<i64>,
    balance_cents: i64,
) -> String {
    if balance_cents > 50_000 && recency_days > 20 {
        return "deudor_critico".to_string();
    }
    if total_purchases < 3 {
        return "nuevo".to_string();
    }
    if let Some(freq) = avg_frequency_days {
        if recency_days > freq * 2 {
            return "en_riesgo".to_string();
        }
        if recency_days <= 7 && total_purchases >= 8 {
            return "vip".to_string();
        }
    } else if recency_days <= 7 && total_purchases >= 10 {
        return "vip".to_string();
    }
    "habitual".to_string()
}

#[tauri::command]
pub fn get_clients_rfm(state: State<AppState>) -> CmdResult<Vec<ClientRfm>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name,
                COUNT(DISTINCT s.id) as total_purchases,
                CAST(julianday('now','localtime') - julianday(MAX(s.created_at)) AS INTEGER) as recency_days,
                CASE WHEN COUNT(DISTINCT s.id) > 1 THEN
                    CAST((julianday(MAX(s.created_at)) - julianday(MIN(s.created_at)))
                         / (COUNT(DISTINCT s.id) - 1) AS INTEGER)
                ELSE NULL END as avg_frequency_days,
                CAST(COALESCE(SUM(s.total_cents), 0) AS INTEGER) as total_spent_cents,
                MAX(s.created_at) as last_purchase_date,
                COALESCE(
                    (SELECT SUM(CASE WHEN ca.movement_type='cargo' THEN ca.amount_cents ELSE -ca.amount_cents END)
                     FROM client_account ca WHERE ca.client_id=c.id),
                    0
                ) as balance_cents
         FROM clients c
         JOIN sales s ON c.id = s.client_id
            AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         WHERE c.active=1
         GROUP BY c.id, c.name
         ORDER BY total_spent_cents DESC",
    ).map_err(err)?;

    let rows: Vec<ClientRfm> = stmt.query_map([], |row| {
        let total_purchases: i64 = row.get("total_purchases")?;
        let recency_days: i64 = row.get("recency_days")?;
        let avg_frequency_days: Option<i64> = row.get("avg_frequency_days")?;
        let total_spent_cents: i64 = row.get("total_spent_cents")?;
        let balance_cents: i64 = row.get("balance_cents")?;
        let avg_ticket_cents = if total_purchases > 0 {
            total_spent_cents / total_purchases
        } else { 0 };
        let segment = classify_rfm_segment(total_purchases, recency_days, avg_frequency_days, balance_cents);
        Ok(ClientRfm {
            client_id: row.get("id")?,
            name: row.get("name")?,
            total_purchases,
            recency_days,
            avg_frequency_days,
            avg_ticket_cents,
            total_spent_cents,
            balance_cents,
            segment,
            last_purchase_date: row.get("last_purchase_date")?,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}
