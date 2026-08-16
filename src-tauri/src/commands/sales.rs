use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{Sale, SaleInput, SaleItem, SaleWithItems};
use crate::AppState;
use rusqlite::params;
use tauri::State;

fn row_to_sale(row: &rusqlite::Row) -> rusqlite::Result<Sale> {
    Ok(Sale {
        id: row.get("id")?,
        total_cents: row.get("total_cents")?,
        discount_cents: row.get("discount_cents")?,
        paid_cents: row.get("paid_cents")?,
        change_cents: row.get("change_cents")?,
        payment_method: row.get("payment_method")?,
        client_id: row.get("client_id")?,
        client_name: row.get("client_name").ok(),
        user_id: row.get("user_id")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
    })
}

#[tauri::command]
pub fn create_sale(input: SaleInput, state: State<AppState>) -> CmdResult<Sale> {
    if input.items.is_empty() {
        return Err("La venta no tiene ítems".to_string());
    }

    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    // Validar stock disponible antes de tocar nada, para no descontar la mitad
    // de un carrito grande si un ítem del final no tiene stock suficiente.
    // Se salta por completo si el negocio apagó el seguimiento de stock (no
    // tiene sentido bloquear una venta por un stock que nadie está cargando).
    if crate::db::stock_tracking_enabled(&tx) {
        for item in &input.items {
            if let Some(cid) = item.combo_id {
                let components: Vec<(i64, f64)> = {
                    let mut s = tx
                        .prepare("SELECT product_id, qty FROM combo_items WHERE combo_id=?1")
                        .map_err(err)?;
                    let rows: Vec<(i64, f64)> = s
                        .query_map(params![cid], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))
                        })
                        .map_err(err)?
                        .filter_map(|r| r.ok())
                        .collect();
                    rows
                };
                for (pid, component_qty) in components {
                    let needed = component_qty * item.qty;
                    let (stock, name): (f64, String) = tx
                        .query_row(
                            "SELECT stock, name FROM products WHERE id=?1",
                            params![pid],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        )
                        .map_err(err)?;
                    if stock < needed {
                        return Err(format!(
                            "No hay stock suficiente de \"{}\" (quedan {}, se necesitan {})",
                            name, stock, needed
                        ));
                    }
                }
            } else if let Some(pid) = item.product_id {
                let needed = item.qty;
                let (stock, name): (f64, String) = tx
                    .query_row(
                        "SELECT stock, name FROM products WHERE id=?1",
                        params![pid],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(err)?;
                if stock < needed {
                    return Err(format!(
                        "No hay stock suficiente de \"{}\" (quedan {}, se pidieron {})",
                        name, stock, needed
                    ));
                }
            }
        }
    }

    let subtotal_cents: i64 = input
        .items
        .iter()
        .map(|i| {
            let line = (i.unit_price_cents as f64 * i.qty).round() as i64;
            let disc = (line as f64 * i.discount_pct / 100.0).round() as i64;
            line - disc
        })
        .sum();

    let total_cents = (subtotal_cents - input.discount_cents).max(0);
    let change_cents = (input.paid_cents - total_cents).max(0);

    let actual_method = if input.payments.as_ref().map_or(false, |p| p.len() > 1) {
        "mixto".to_string()
    } else {
        input.payment_method.clone()
    };

    // Cuánto de esta venta va a cuenta corriente (fiado) — se calcula acá (antes de
    // escribir nada) para poder validar el límite de crédito del cliente y, si se
    // pasa, frenar la venta entera sin dejar nada a medio hacer.
    let cc_amount: i64 = if let Some(ref payments) = input.payments {
        payments.iter()
            .filter(|p| p.method == "fiado" || p.method == "cuenta_corriente")
            .map(|p| p.amount_cents)
            .sum()
    } else if actual_method == "fiado" || actual_method == "cuenta_corriente" {
        total_cents
    } else {
        0
    };

    if cc_amount > 0 {
        if let Some(cid) = input.client_id {
            let (credit_limit, balance): (i64, i64) = tx.query_row(
                "SELECT c.credit_limit_cents,
                        COALESCE((SELECT SUM(CASE WHEN ca.movement_type='cargo' THEN ca.amount_cents ELSE -ca.amount_cents END)
                                  FROM client_account ca WHERE ca.client_id = c.id), 0)
                 FROM clients c WHERE c.id = ?1",
                params![cid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).map_err(err)?;
            if credit_limit > 0 && balance + cc_amount > credit_limit {
                return Err(format!(
                    "Supera el límite de cuenta corriente del cliente (debe ${:.2}, límite ${:.2}, esta venta suma ${:.2})",
                    balance as f64 / 100.0, credit_limit as f64 / 100.0, cc_amount as f64 / 100.0
                ));
            }
        }
    }

    // Vincular la venta a la sesión indicada, o a la más reciente si no se especifica
    let session_id: Option<i64> = if input.session_id.is_some() {
        input.session_id
    } else {
        tx.query_row(
            "SELECT id FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        ).ok()
    };

    tx.execute(
        // created_at se guarda en UTC (datetime('now'), sin 'localtime') a propósito: todas las
        // lecturas de fecha/hora en Reportes/Dashboard/Insights aplican 'localtime' para convertir
        // a hora argentina -- si acá también se guardara ya convertido, esa conversión se aplicaría
        // dos veces, corriendo cada hora 3hs (el huso de Argentina) y pudiendo atribuir ventas de
        // la madrugada al día anterior.
        "INSERT INTO sales (total_cents, discount_cents, paid_cents, change_cents, payment_method, client_id, user_id, notes, session_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))",
        params![
            total_cents,
            input.discount_cents,
            input.paid_cents,
            change_cents,
            actual_method,
            input.client_id,
            input.user_id,
            input.notes,
            session_id,
        ],
    )
    .map_err(err)?;

    let sale_id = tx.last_insert_rowid();

    for item in &input.items {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, combo_id, barcode, name, unit_price_cents, discount_pct, qty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                sale_id,
                item.product_id,
                item.combo_id,
                item.barcode,
                item.name,
                item.unit_price_cents,
                item.discount_pct,
                item.qty,
            ],
        )
        .map_err(err)?;

        if let Some(cid) = item.combo_id {
            // Combo: descontar stock de cada componente individualmente
            let components: Vec<(i64, f64)> = {
                let mut s = tx.prepare(
                    "SELECT product_id, qty FROM combo_items WHERE combo_id=?1"
                ).map_err(err)?;
                let x: Vec<(i64, f64)> = s.query_map(params![cid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
                    .map_err(err)?
                    .filter_map(|r| r.ok())
                    .collect();
                x
            };
            for (pid, component_qty) in components {
                let total_qty = component_qty * item.qty;
                let qty_before: f64 = tx.query_row(
                    "SELECT stock FROM products WHERE id=?1", params![pid], |r| r.get(0)
                ).unwrap_or(0.0);
                tx.execute(
                    "UPDATE products SET stock=stock-?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                    params![total_qty, pid],
                ).map_err(err)?;
                let qty_after = (qty_before - total_qty).max(0.0);
                tx.execute(
                    "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
                     VALUES (?1, 'venta', ?2, ?3, ?4, ?5)",
                    params![pid, -total_qty, qty_before, qty_after, format!("Combo #{}", cid)],
                ).map_err(err)?;
                // FEFO sobre el componente
                let lots: Vec<(i64, f64)> = {
                    let mut s = tx.prepare(
                        "SELECT id, qty FROM product_lots WHERE product_id=?1 AND qty>0
                         ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC",
                    ).map_err(err)?;
                    let x: Vec<(i64, f64)> = s.query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
                        .map_err(err)?
                        .filter_map(|r| r.ok())
                        .collect();
                    x
                };
                let mut remaining = total_qty;
                for (lot_id, lot_qty) in lots {
                    if remaining <= 0.0 { break; }
                    let deduct = remaining.min(lot_qty);
                    tx.execute("UPDATE product_lots SET qty=qty-?1 WHERE id=?2", params![deduct, lot_id]).map_err(err)?;
                    remaining -= deduct;
                }
            }
        } else if let Some(pid) = item.product_id {
            let qty_before: f64 = tx
                .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| {
                    r.get(0)
                })
                .unwrap_or(0.0);

            tx.execute(
                "UPDATE products SET stock=stock-?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                params![item.qty, pid],
            )
            .map_err(err)?;

            let qty_after = (qty_before - item.qty).max(0.0);
            tx.execute(
                "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after)
                 VALUES (?1, 'venta', ?2, ?3, ?4)",
                params![pid, -item.qty, qty_before, qty_after],
            )
            .map_err(err)?;

            // FEFO: descontar de lotes ordenados por vencimiento más próximo primero
            let lots: Vec<(i64, f64)> = {
                let mut s = tx.prepare(
                    "SELECT id, qty FROM product_lots
                     WHERE product_id=?1 AND qty>0
                     ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC",
                ).map_err(err)?;
                let x = s.query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
                    .map_err(err)?
                    .filter_map(|r| r.ok())
                    .collect();
                x
            };
            let mut remaining = item.qty;
            for (lot_id, lot_qty) in lots {
                if remaining <= 0.0 { break; }
                let deduct = remaining.min(lot_qty);
                tx.execute(
                    "UPDATE product_lots SET qty = qty - ?1 WHERE id = ?2",
                    params![deduct, lot_id],
                )
                .map_err(err)?;
                remaining -= deduct;
            }
        }
    }

    // Registrar pagos combinados
    if let Some(ref payments) = input.payments {
        for p in payments {
            if p.amount_cents > 0 {
                tx.execute(
                    "INSERT INTO sale_payments (sale_id, method, amount_cents) VALUES (?1, ?2, ?3)",
                    params![sale_id, p.method, p.amount_cents],
                ).map_err(err)?;
            }
        }
    }

    // Registrar en cuenta corriente del cliente si corresponde (cc_amount ya
    // calculado y validado contra el límite de crédito más arriba)
    if let Some(cid) = input.client_id {
        if cc_amount > 0 {
            tx.execute(
                "INSERT INTO client_account (client_id, amount_cents, movement_type, concept, sale_id)
                 VALUES (?1, ?2, 'cargo', 'Venta #' || ?3, ?3)",
                params![cid, cc_amount, sale_id],
            )
            .map_err(err)?;
        }
    }

    tx.commit().map_err(err)?;

    let detail = format!("Total: {} items, método: {}", input.items.len(), input.payment_method);
    log_action(&conn, input.user_id, "venta", "venta", Some(sale_id), Some(&detail));

    let mut stmt = conn
        .prepare(
            "SELECT s.*, c.name as client_name
             FROM sales s LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.id = ?1",
        )
        .map_err(err)?;

    stmt.query_row(params![sale_id], row_to_sale).map_err(err)
}

#[tauri::command]
pub fn get_sale(id: i64, state: State<AppState>) -> CmdResult<Sale> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT s.*, c.name as client_name
             FROM sales s LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.id = ?1",
        )
        .map_err(err)?;
    stmt.query_row(params![id], row_to_sale).map_err(err)
}

#[tauri::command]
pub fn get_sale_with_items(id: i64, state: State<AppState>) -> CmdResult<SaleWithItems> {
    let conn = state.db.lock();

    let mut sale_stmt = conn
        .prepare(
            "SELECT s.*, c.name as client_name
             FROM sales s LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.id = ?1",
        )
        .map_err(err)?;
    let sale = sale_stmt
        .query_row(params![id], row_to_sale)
        .map_err(err)?;

    let mut items_stmt = conn
        .prepare("SELECT * FROM sale_items WHERE sale_id = ?1")
        .map_err(err)?;

    let items: Vec<SaleItem> = items_stmt
        .query_map(params![id], |row| {
            let qty: f64 = row.get("qty")?;
            let unit_price: i64 = row.get("unit_price_cents")?;
            let disc_pct: f64 = row.get("discount_pct")?;
            let line = (unit_price as f64 * qty).round() as i64;
            let disc = (line as f64 * disc_pct / 100.0).round() as i64;
            Ok(SaleItem {
                id: row.get("id")?,
                sale_id: row.get("sale_id")?,
                product_id: row.get("product_id")?,
                barcode: row.get("barcode")?,
                name: row.get("name")?,
                unit_price_cents: unit_price,
                discount_pct: disc_pct,
                qty,
                subtotal_cents: line - disc,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(SaleWithItems { sale, items })
}

#[tauri::command]
pub fn list_sales(
    date: String,
    limit: i64,
    state: State<AppState>,
) -> CmdResult<Vec<Sale>> {
    list_sales_range(date.clone(), date, limit, state)
}

#[tauri::command]
pub fn list_sales_range(
    from_date: String,
    to_date: String,
    limit: i64,
    state: State<AppState>,
) -> CmdResult<Vec<Sale>> {
    let conn = state.db.lock();

    let mut stmt = conn
        .prepare(
            "SELECT s.*, c.name as client_name
             FROM sales s LEFT JOIN clients c ON s.client_id = c.id
             WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
             ORDER BY s.created_at DESC
             LIMIT ?3",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![from_date, to_date, limit], row_to_sale)
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

// Ventas de un cliente puntual, sin límite de fecha ni depender de un tope global.
// Devoluciones (búsqueda "por cliente") usaba antes list_sales_range con un límite
// de 300 sobre TODAS las ventas del período y filtraba por cliente después -- en un
// local con más de 300 ventas en 90 días, las compras más viejas de un cliente
// puntual podían quedar afuera del corte antes de siquiera llegar al filtro.
#[tauri::command]
pub fn list_sales_by_client(client_id: i64, limit: i64, state: State<AppState>) -> CmdResult<Vec<Sale>> {
    let conn = state.db.lock();

    let mut stmt = conn
        .prepare(
            "SELECT s.*, c.name as client_name
             FROM sales s LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.client_id = ?1
             ORDER BY s.created_at DESC
             LIMIT ?2",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![client_id, limit], row_to_sale)
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn cancel_sale(id: i64, state: State<AppState>) -> CmdResult<()> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;

    // Revertir stock (incluye componentes de combo, que antes no se revertían)
    let items: Vec<(Option<i64>, Option<i64>, f64)> = {
        let mut stmt = tx
            .prepare("SELECT product_id, combo_id, qty FROM sale_items WHERE sale_id=?1")
            .map_err(err)?;
        let x = stmt.query_map(params![id], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, f64>(2)?))
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();
        x
    };

    for (product_id, combo_id, qty) in items {
        if let Some(cid) = combo_id {
            let components: Vec<(i64, f64)> = {
                let mut s = tx.prepare("SELECT product_id, qty FROM combo_items WHERE combo_id=?1").map_err(err)?;
                let x: Vec<(i64, f64)> = s.query_map(params![cid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
                    .map_err(err)?
                    .filter_map(|r| r.ok())
                    .collect();
                x
            };
            for (pid, component_qty) in components {
                let total_qty = component_qty * qty;
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
                     VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Anulación de venta (combo)')",
                    params![pid, total_qty, qty_before, qty_before + total_qty],
                )
                .map_err(err)?;
            }
        } else if let Some(pid) = product_id {
            let qty_before: f64 = tx
                .query_row("SELECT stock FROM products WHERE id=?1", params![pid], |r| {
                    r.get(0)
                })
                .unwrap_or(0.0);

            tx.execute(
                "UPDATE products SET stock=stock+?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                params![qty, pid],
            )
            .map_err(err)?;

            tx.execute(
                "INSERT INTO stock_movements (product_id, movement_type, qty_change, qty_before, qty_after, notes)
                 VALUES (?1, 'ajuste', ?2, ?3, ?4, 'Anulación de venta')",
                params![pid, qty, qty_before, qty_before + qty],
            )
            .map_err(err)?;
        }
    }

    // Revertir cuenta corriente si había cargo
    tx.execute(
        "DELETE FROM client_account WHERE sale_id=?1",
        params![id],
    )
    .map_err(err)?;

    // Marcar venta como cancelada (añadimos nota, no borramos para preservar historial)
    tx.execute(
        "UPDATE sales SET notes=COALESCE(notes||' ','') || '[ANULADA]' WHERE id=?1",
        params![id],
    )
    .map_err(err)?;

    tx.commit().map_err(err)?;
    log_action(&conn, None, "anular", "venta", Some(id), None);
    Ok(())
}
