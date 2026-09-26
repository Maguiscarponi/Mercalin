use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{NewReturn, ReturnItem, ReturnRecord, ReturnWithItems};
use crate::AppState;
use rusqlite::{params, Transaction};
use std::collections::HashMap;
use tauri::State;

fn row_to_return(row: &rusqlite::Row) -> rusqlite::Result<ReturnRecord> {
    Ok(ReturnRecord {
        id: row.get("id")?,
        sale_id: row.get("sale_id")?,
        total_cents: row.get("total_cents")?,
        reason: row.get("reason")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
    })
}

// Misma idea de "clave" que usa el frontend (Devoluciones.tsx) para juntar
// líneas de la misma venta que corresponden al mismo producto/combo: por
// product_id si está, si no por combo_id, si no por el nombre tal cual.
fn item_key(product_id: Option<i64>, combo_id: Option<i64>, name: &str) -> String {
    if let Some(p) = product_id {
        format!("p{}", p)
    } else if let Some(c) = combo_id {
        format!("c{}", c)
    } else {
        name.to_string()
    }
}

struct SoldLine {
    product_id: Option<i64>,
    combo_id: Option<i64>,
    barcode: Option<String>,
    name: String,
    qty: f64,
    subtotal_cents: i64,
}

struct ValidatedLine {
    product_id: Option<i64>,
    combo_id: Option<i64>,
    barcode: Option<String>,
    name: String,
    qty: f64,
    amount_cents: i64,
}

// Separada del comando para poder testearla sin una Connection real: es el
// corazón de la validación (encontrado en la auditoría: antes no existía
// ninguna) -- cuánto se puede devolver de cada ítem (vendido menos ya
// devuelto) y cuánto corresponde acreditar (proporcional al subtotal ya con
// descuento aplicado, no al precio de lista).
fn validate_return_items(
    input_items: &[crate::models::NewReturnItem],
    sold: &HashMap<String, SoldLine>,
    already_returned: &HashMap<String, f64>,
) -> CmdResult<(Vec<ValidatedLine>, i64)> {
    let mut lines: Vec<ValidatedLine> = Vec::new();
    let mut total_cents: i64 = 0;

    for item in input_items {
        let key = item_key(item.product_id, item.combo_id, &item.name);
        let sold_line = sold
            .get(&key)
            .ok_or_else(|| format!("\"{}\" no pertenece a esta venta", item.name))?;
        let already = already_returned.get(&key).copied().unwrap_or(0.0);
        let available = (sold_line.qty - already).max(0.0);
        if item.qty > available + 1e-9 {
            return Err(format!(
                "No se puede devolver {} de \"{}\": ya se devolvió {} de {} vendido(s)",
                item.qty, sold_line.name, already, sold_line.qty
            ));
        }
        let amount_cents = if sold_line.qty > 0.0 {
            (sold_line.subtotal_cents as f64 * (item.qty / sold_line.qty)).round() as i64
        } else {
            0
        };
        total_cents += amount_cents;
        lines.push(ValidatedLine {
            product_id: sold_line.product_id,
            combo_id: sold_line.combo_id,
            barcode: sold_line.barcode.clone(),
            name: sold_line.name.clone(),
            qty: item.qty,
            amount_cents,
        });
    }

    Ok((lines, total_cents))
}

// Encontrado en la auditoría: create_return no validaba NADA del lado del
// servidor -- ni que la cantidad devuelta fuera <= lo vendido, ni que la
// venta existiera o no estuviera anulada, ni que no se estuviera devolviendo
// dos veces lo mismo. Una llamada directa (o un doble click) podía devolver
// más cantidad de la comprada, o la misma venta dos veces, duplicando stock
// y el monto de la nota de crédito. Además, el monto devuelto se calculaba
// con el precio SIN el descuento de la venta original (sobrefacturando la
// nota de crédito), y una devolución de un ítem vendido como combo no
// reponía stock a sus componentes.
//
// Ahora todo se recalcula acá a partir de los sale_items reales de la venta:
// la cantidad disponible por ítem (vendido menos ya devuelto) y el monto
// devuelto (proporcional al subtotal_cents ya con descuento aplicado), sin
// confiar en lo que mande el cliente salvo qué ítem y cuánta cantidad.
#[tauri::command]
pub fn create_return(input: NewReturn, state: State<AppState>) -> CmdResult<ReturnRecord> {
    if input.items.is_empty() {
        return Err("La devolución no tiene ítems".to_string());
    }
    let sale_id = input
        .sale_id
        .ok_or_else(|| "Una devolución tiene que estar vinculada a una venta".to_string())?;

    for item in &input.items {
        if !item.qty.is_finite() || item.qty <= 0.0 {
            return Err(format!("Cantidad inválida para \"{}\": {}", item.name, item.qty));
        }
    }

    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    let (sale_total_cents, sale_client_id, sale_payment_method, sale_notes): (i64, Option<i64>, String, Option<String>) = tx
        .query_row(
            "SELECT total_cents, client_id, payment_method, notes FROM sales WHERE id=?1",
            params![sale_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "No se encontró la venta original".to_string())?;

    if sale_notes.as_deref().unwrap_or("").contains("[ANULADA]") {
        return Err("Esa venta está anulada, no se puede devolver".to_string());
    }

    // Ítems realmente vendidos en esa venta, agrupados por clave
    let sold_rows: Vec<(Option<i64>, Option<i64>, Option<String>, String, i64, i64, f64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT product_id, combo_id, barcode, name, unit_price_cents, discount_pct, qty
                 FROM sale_items WHERE sale_id=?1",
            )
            .map_err(err)?;
        let rows: Vec<(Option<i64>, Option<i64>, Option<String>, String, i64, f64, f64)> = stmt
            .query_map(params![sale_id], |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, f64>(5)?,
                    r.get::<_, f64>(6)?,
                ))
            })
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        // (product_id, combo_id, barcode, name, unit_price_cents, discount_pct, qty) -> con subtotal calculado
        rows.into_iter()
            .map(|(pid, cid, bc, name, unit_price_cents, discount_pct, qty)| {
                let line = (unit_price_cents as f64 * qty).round() as i64;
                let disc = (line as f64 * discount_pct / 100.0).round() as i64;
                (pid, cid, bc, name, unit_price_cents, line - disc, qty)
            })
            .collect()
    };

    let mut sold: HashMap<String, SoldLine> = HashMap::new();
    for (pid, cid, bc, name, _unit_price_cents, subtotal, qty) in sold_rows {
        let key = item_key(pid, cid, &name);
        let entry = sold.entry(key).or_insert(SoldLine {
            product_id: pid,
            combo_id: cid,
            barcode: bc,
            name,
            qty: 0.0,
            subtotal_cents: 0,
        });
        entry.qty += qty;
        entry.subtotal_cents += subtotal;
    }

    // Ya devuelto anteriormente (de CUALQUIER devolución previa de esta venta)
    let mut already_returned: HashMap<String, f64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT ri.product_id, ri.combo_id, ri.name, ri.qty
                 FROM return_items ri JOIN returns r ON r.id = ri.return_id
                 WHERE r.sale_id = ?1",
            )
            .map_err(err)?;
        let rows: Vec<(Option<i64>, Option<i64>, String, f64)> = stmt
            .query_map(params![sale_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        for (pid, cid, name, qty) in rows {
            let key = item_key(pid, cid, &name);
            *already_returned.entry(key).or_insert(0.0) += qty;
        }
    }

    // Validar cada línea pedida contra lo realmente disponible, y calcular el
    // monto correcto (proporcional al subtotal ya con descuento).
    let (lines, total_cents) = validate_return_items(&input.items, &sold, &already_returned)?;

    tx.execute(
        "INSERT INTO returns (sale_id, total_cents, reason, notes) VALUES (?1, ?2, ?3, ?4)",
        params![sale_id, total_cents, input.reason, input.notes],
    )
    .map_err(err)?;

    let return_id = tx.last_insert_rowid();

    for line in &lines {
        let unit_price_cents = if line.qty > 0.0 {
            (line.amount_cents as f64 / line.qty).round() as i64
        } else {
            0
        };
        tx.execute(
            "INSERT INTO return_items (return_id, product_id, combo_id, barcode, name, unit_price_cents, qty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                return_id,
                line.product_id,
                line.combo_id,
                line.barcode,
                line.name,
                unit_price_cents,
                line.qty,
            ],
        )
        .map_err(err)?;

        if let Some(cid) = line.combo_id {
            // Encontrado en la auditoría: devolver un ítem de combo no reponía
            // stock a sus componentes (a diferencia de anular una venta
            // completa, que sí lo maneja). Mismo criterio que cancel_sale.
            restock_combo_components(&tx, cid, line.qty)?;
        } else if let Some(pid) = line.product_id {
            let qty_before: f64 = tx
                .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0))
                .unwrap_or(0.0);

            tx.execute(
                "UPDATE products SET stock=stock+?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                params![line.qty, pid],
            )
            .map_err(err)?;

            tx.execute(
                "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
                 VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Devolución #' || ?5)",
                params![pid, line.qty, qty_before, qty_before + line.qty, return_id],
            )
            .map_err(err)?;
        }
    }

    // Encontrado en la auditoría: devolver mercadería no revertía la cuenta
    // corriente del cliente -- si la venta se había cargado (total o
    // parcialmente) a fiado, la deuda quedaba intacta aunque el cliente ya
    // hubiera devuelto lo comprado. Se reduce proporcionalmente al monto
    // devuelto sobre el total de la venta.
    if let Some(cid) = sale_client_id {
        if sale_total_cents > 0 {
            let cargo_cents: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(amount_cents), 0) FROM client_account
                     WHERE sale_id=?1 AND movement_type='cargo'",
                    params![sale_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if cargo_cents > 0 {
                let reduction = (cargo_cents as f64 * (total_cents as f64 / sale_total_cents as f64)).round() as i64;
                if reduction > 0 {
                    tx.execute(
                        "INSERT INTO client_account (client_id, amount_cents, movement_type, concept, sale_id)
                         VALUES (?1, ?2, 'pago', ?3, ?4)",
                        params![
                            cid,
                            reduction,
                            format!("Devolución #{} de venta #{}", return_id, sale_id),
                            sale_id
                        ],
                    )
                    .map_err(err)?;
                }
            }
        }
    }

    // Encontrado en la auditoría: devolver en efectivo no generaba ningún
    // movimiento de caja -- el saldo esperado del turno no bajaba, dejando
    // una diferencia sistemática al cerrar caja. Se calcula cuánto de la
    // venta original fue efectivo (por sale_payments si fue pago mixto, o el
    // total si el método de la venta fue "efectivo") y se registra un egreso
    // proporcional en la sesión de caja actualmente abierta, si hay una.
    if sale_total_cents > 0 {
        let cash_paid_for_sale: i64 = {
            let mixed: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE sale_id=?1 AND method='efectivo'",
                    params![sale_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if mixed > 0 {
                mixed
            } else if sale_payment_method == "efectivo" {
                sale_total_cents
            } else {
                0
            }
        };
        if cash_paid_for_sale > 0 {
            let cash_refund = (cash_paid_for_sale as f64 * (total_cents as f64 / sale_total_cents as f64)).round() as i64;
            if cash_refund > 0 {
                let open_session: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
                        [],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(session_id) = open_session {
                    tx.execute(
                        "INSERT INTO cash_movements (session_id, movement_type, amount_cents, concept)
                         VALUES (?1, 'egreso', ?2, ?3)",
                        params![
                            session_id,
                            cash_refund,
                            format!("Devolución en efectivo - venta #{} (devolución #{})", sale_id, return_id)
                        ],
                    )
                    .map_err(err)?;
                }
            }
        }
    }

    tx.commit().map_err(err)?;

    let detail = format!("Devolución #{} - razón: {}", return_id, input.reason);
    log_action(&conn, None, "devolucion", "return", Some(return_id), Some(&detail));

    conn.query_row(
        "SELECT * FROM returns WHERE id=?1",
        params![return_id],
        row_to_return,
    )
    .map_err(err)
}

fn restock_combo_components(tx: &Transaction, combo_id: i64, returned_qty: f64) -> CmdResult<()> {
    let components: Vec<(i64, f64)> = {
        let mut s = tx
            .prepare("SELECT product_id, qty FROM combo_items WHERE combo_id=?1")
            .map_err(err)?;
        let x: Vec<(i64, f64)> = s
            .query_map(params![combo_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        x
    };
    for (pid, component_qty) in components {
        let total_qty = component_qty * returned_qty;
        let qty_before: f64 = tx
            .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0))
            .unwrap_or(0.0);
        tx.execute(
            "UPDATE products SET stock=stock+?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![total_qty, pid],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
             VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Devolución de combo')",
            params![pid, total_qty, qty_before, qty_before + total_qty],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_returns(limit: i64, state: State<AppState>) -> CmdResult<Vec<ReturnRecord>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT * FROM returns ORDER BY created_at DESC LIMIT ?1")
        .map_err(err)?;

    let rows = stmt.query_map(params![limit], row_to_return).map_err(err)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_return_with_items(id: i64, state: State<AppState>) -> CmdResult<ReturnWithItems> {
    let conn = state.db.lock();

    let ret = conn
        .query_row("SELECT * FROM returns WHERE id=?1", params![id], row_to_return)
        .map_err(err)?;

    let mut stmt = conn
        .prepare("SELECT * FROM return_items WHERE return_id=?1")
        .map_err(err)?;

    let items: Vec<ReturnItem> = stmt
        .query_map(params![id], |row| {
            Ok(ReturnItem {
                id: row.get("id")?,
                return_id: row.get("return_id")?,
                product_id: row.get("product_id")?,
                combo_id: row.get("combo_id")?,
                barcode: row.get("barcode")?,
                name: row.get("name")?,
                unit_price_cents: row.get("unit_price_cents")?,
                qty: row.get("qty")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ReturnWithItems { ret, items })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewReturnItem;

    fn sold_line(product_id: Option<i64>, combo_id: Option<i64>, name: &str, qty: f64, subtotal_cents: i64) -> SoldLine {
        SoldLine { product_id, combo_id, barcode: None, name: name.to_string(), qty, subtotal_cents }
    }

    fn item(product_id: Option<i64>, combo_id: Option<i64>, name: &str, qty: f64) -> NewReturnItem {
        NewReturnItem { product_id, combo_id, barcode: None, name: name.to_string(), unit_price_cents: 0, qty }
    }

    #[test]
    fn item_key_prioriza_product_id_luego_combo_id_luego_nombre() {
        assert_eq!(item_key(Some(1), Some(2), "x"), "p1");
        assert_eq!(item_key(None, Some(2), "x"), "c2");
        assert_eq!(item_key(None, None, "x"), "x");
    }

    #[test]
    fn rechaza_devolver_mas_de_lo_vendido() {
        // Este es el bug real de la auditoría: create_return no validaba esto
        // del lado del servidor -- una llamada directa podía devolver más
        // cantidad de la comprada.
        let mut sold = HashMap::new();
        sold.insert("p1".to_string(), sold_line(Some(1), None, "Coca", 2.0, 200000));
        let already = HashMap::new();
        let items = vec![item(Some(1), None, "Coca", 3.0)];
        assert!(validate_return_items(&items, &sold, &already).is_err());
    }

    #[test]
    fn rechaza_devolver_lo_que_ya_se_devolvio() {
        // Doble devolución de la misma venta: la segunda vez ya no queda nada
        // disponible aunque la cantidad pedida sea <= lo vendido originalmente.
        let mut sold = HashMap::new();
        sold.insert("p1".to_string(), sold_line(Some(1), None, "Coca", 2.0, 200000));
        let mut already = HashMap::new();
        already.insert("p1".to_string(), 2.0);
        let items = vec![item(Some(1), None, "Coca", 1.0)];
        assert!(validate_return_items(&items, &sold, &already).is_err());
    }

    #[test]
    fn rechaza_item_que_no_pertenece_a_la_venta() {
        let sold = HashMap::new();
        let already = HashMap::new();
        let items = vec![item(Some(99), None, "Fantasma", 1.0)];
        assert!(validate_return_items(&items, &sold, &already).is_err());
    }

    #[test]
    fn calcula_monto_proporcional_al_subtotal_con_descuento_no_al_precio_de_lista() {
        // Este es el bug real: la NC se emitía antes por precio de lista, sin
        // el descuento de la venta. Producto $1000 vendido con 20% off
        // ($800 subtotal real): devolver la mitad debe acreditar $400, no $500.
        let mut sold = HashMap::new();
        sold.insert("p1".to_string(), sold_line(Some(1), None, "Producto", 2.0, 160000)); // $800*2=1600 -> pero ya es subtotal total de la línea
        let already = HashMap::new();
        let items = vec![item(Some(1), None, "Producto", 1.0)];
        let (lines, total) = validate_return_items(&items, &sold, &already).unwrap();
        assert_eq!(total, 80000);
        assert_eq!(lines[0].amount_cents, 80000);
    }

    #[test]
    fn acepta_devolucion_parcial_dentro_de_lo_disponible() {
        let mut sold = HashMap::new();
        sold.insert("p1".to_string(), sold_line(Some(1), None, "Coca", 5.0, 500000));
        let mut already = HashMap::new();
        already.insert("p1".to_string(), 2.0);
        let items = vec![item(Some(1), None, "Coca", 3.0)];
        let (_, total) = validate_return_items(&items, &sold, &already).unwrap();
        assert_eq!(total, 300000);
    }
}
