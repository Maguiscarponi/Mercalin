use crate::commands::{audit::log_action, err, CmdResult};
use crate::models::{BulkPriceInput, BulkPricePreviewItem, CategoryStat, CsvProductRow, ExpiringProduct, ImportResult, MinStockSuggestion, NewProduct, PriceImpactItem, Product, ProductVelocity, PriceSyncAlert};
use crate::AppState;
use rusqlite::{params, Row};
use tauri::State;

fn row_to_product(row: &Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id: row.get("id")?,
        barcode: row.get("barcode")?,
        name: row.get("name")?,
        price_cents: row.get("price_cents")?,
        price2_cents: row.get("price2_cents").unwrap_or(0),
        price3_cents: row.get("price3_cents").unwrap_or(0),
        cost_cents: row.get("cost_cents")?,
        stock: row.get("stock")?,
        min_stock: row.get("min_stock")?,
        category: row.get("category")?,
        is_weighable: row.get::<_, i64>("is_weighable")? != 0,
        active: row.get::<_, i64>("active")? != 0,
        is_ghost: row.get::<_, i64>("is_ghost")? != 0,
        supplier_id: row.get("supplier_id")?,
        expires_at: row.get("expires_at")?,
        image_path: row.get("image_path")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn find_product_by_barcode(
    barcode: String,
    state: State<AppState>,
) -> CmdResult<Option<Product>> {
    let conn = state.db.lock();
    // Un fantasma (is_ghost=1) tiene que poder encontrarse escaneando su código —
    // es justo el momento en que se le carga el precio y "se activa" de verdad.
    let mut stmt = conn
        .prepare("SELECT * FROM products WHERE barcode = ?1 AND (active = 1 OR is_ghost = 1) LIMIT 1")
        .map_err(err)?;
    Ok(stmt.query_row(params![barcode], row_to_product).ok())
}

#[tauri::command]
pub fn list_products(query: String, include_ghosts: bool, state: State<AppState>) -> CmdResult<Vec<Product>> {
    let conn = state.db.lock();
    let q = query.trim().to_lowercase();
    // Catálogo real (Productos → "Todos", Caja al no pedir fantasmas): solo active=1.
    // Con include_ghosts=true (pantalla "Agregar producto", búsqueda/escaneo en Caja) también
    // aparecen los precargados sin precio — nunca un producto borrado de verdad (active=0, is_ghost=0).
    let visibility = if include_ghosts { "(active = 1 OR is_ghost = 1)" } else { "active = 1" };

    if q.is_empty() {
        let sql = format!("SELECT * FROM products WHERE {} ORDER BY name LIMIT 20000", visibility);
        let mut stmt = conn.prepare(&sql).map_err(err)?;
        let rows = stmt.query_map([], row_to_product).map_err(err)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(err)?); }
        return Ok(out);
    }

    // Multi-token: cada palabra debe aparecer en nombre o en el barcode completo
    let tokens: Vec<String> = q.split_whitespace().map(|t| format!("%{}%", t)).collect();

    // Construir condiciones dinámicas para cada token
    let conditions: Vec<String> = tokens
        .iter()
        .enumerate()
        .map(|(i, _)| format!("(lower(name) LIKE ?{i} OR barcode LIKE ?{i})", i = i + 1))
        .collect();
    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT * FROM products WHERE {} AND ({}) ORDER BY name LIMIT 20000",
        visibility, where_clause
    );

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(tokens.iter()), row_to_product)
        .map_err(err)?;

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn create_product(product: NewProduct, state: State<AppState>) -> CmdResult<Product> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO products
            (barcode, name, price_cents, price2_cents, price3_cents, cost_cents, stock, min_stock, category, is_weighable, active, is_ghost, supplier_id, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13)",
        params![
            product.barcode,
            product.name,
            product.price_cents,
            product.price2_cents,
            product.price3_cents,
            product.cost_cents,
            product.stock,
            product.min_stock,
            product.category,
            product.is_weighable as i64,
            product.active as i64,
            product.supplier_id,
            product.expires_at,
        ],
    )
    .map_err(err)?;

    let id = conn.last_insert_rowid();
    log_action(&conn, None, "crear", "producto", Some(id), Some(&product.name));
    let mut stmt = conn.prepare("SELECT * FROM products WHERE id = ?1").map_err(err)?;
    stmt.query_row(params![id], row_to_product).map_err(err)
}

#[tauri::command]
pub fn update_product(product: Product, state: State<AppState>) -> CmdResult<Product> {
    let conn = state.db.lock();
    // Un fantasma se "activa" solo con cargarle un precio de venta — no hace falta que
    // nadie marque un checkbox aparte. Una vez activado no vuelve a ser fantasma.
    let activating = product.is_ghost && product.price_cents > 0;
    let active = if activating { true } else { product.active };
    let is_ghost = if activating { false } else { product.is_ghost };
    conn.execute(
        "UPDATE products SET
            barcode=?1, name=?2, price_cents=?3, price2_cents=?4, price3_cents=?5,
            cost_cents=?6, stock=?7, min_stock=?8, category=?9, is_weighable=?10,
            active=?11, is_ghost=?12, supplier_id=?13, expires_at=?14,
            updated_at=CURRENT_TIMESTAMP
         WHERE id = ?15",
        params![
            product.barcode,
            product.name,
            product.price_cents,
            product.price2_cents,
            product.price3_cents,
            product.cost_cents,
            product.stock,
            product.min_stock,
            product.category,
            product.is_weighable as i64,
            active as i64,
            is_ghost as i64,
            product.supplier_id,
            product.expires_at,
            product.id,
        ],
    )
    .map_err(err)?;

    log_action(&conn, None, "editar", "producto", Some(product.id), Some(&product.name));
    let mut stmt = conn.prepare("SELECT * FROM products WHERE id = ?1").map_err(err)?;
    stmt.query_row(params![product.id], row_to_product).map_err(err)
}

#[tauri::command]
pub fn delete_product(id: i64, state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    log_action(&conn, None, "eliminar", "producto", Some(id), None);
    Ok(())
}

#[tauri::command]
pub fn get_product(id: i64, state: State<AppState>) -> CmdResult<Product> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare("SELECT * FROM products WHERE id = ?1").map_err(err)?;
    stmt.query_row(params![id], row_to_product).map_err(err)
}

#[tauri::command]
pub fn list_expiring_products(days: i64, state: State<AppState>) -> CmdResult<Vec<ExpiringProduct>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, barcode, name, stock, expires_at,
                    CAST(julianday(expires_at) - julianday('now') AS INTEGER) as days_left
             FROM products
             WHERE active=1 AND expires_at IS NOT NULL
               AND julianday(expires_at) - julianday('now') <= ?1
             ORDER BY expires_at ASC",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map(params![days], |row| {
            Ok(ExpiringProduct {
                id: row.get("id")?,
                barcode: row.get("barcode")?,
                name: row.get("name")?,
                stock: row.get("stock")?,
                expires_at: row.get("expires_at")?,
                days_left: row.get("days_left")?,
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
pub fn list_categories(state: State<AppState>) -> CmdResult<Vec<CategoryStat>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(category,'(sin categoria)') as name, COUNT(*) as product_count
             FROM products WHERE active=1
             GROUP BY category ORDER BY category",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CategoryStat {
                name: row.get("name")?,
                product_count: row.get("product_count")?,
            })
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

#[tauri::command]
pub fn list_product_velocities(state: State<AppState>) -> CmdResult<Vec<ProductVelocity>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT
                p.id as product_id,
                p.stock,
                COALESCE(SUM(si.qty), 0) / 30.0 as daily_velocity
             FROM products p
             LEFT JOIN sale_items si ON p.id = si.product_id
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at, 'localtime') >= date('now', 'localtime', '-30 days')
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE p.active = 1
             GROUP BY p.id, p.stock",
        )
        .map_err(err)?;

    let rows = stmt
        .query_map([], |row| {
            let stock: i64 = row.get("stock")?;
            let velocity: f64 = row.get("daily_velocity")?;
            let velocity_rounded = (velocity * 10.0).round() / 10.0;
            let days_remaining = if velocity_rounded > 0.01 {
                (stock as f64 / velocity_rounded * 10.0).round() / 10.0
            } else {
                -1.0  // -1 indica sin ventas en 30 días
            };
            Ok(ProductVelocity {
                product_id: row.get("product_id")?,
                daily_velocity: velocity_rounded,
                days_remaining,
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
pub fn get_price_desync(state: State<AppState>) -> CmdResult<Vec<PriceSyncAlert>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.category, p.cost_cents, p.price_cents,
                MAX(pi.unit_cost_cents) as last_order_cost
         FROM products p
         JOIN purchase_items pi ON p.id = pi.product_id
         JOIN purchase_orders po ON pi.order_id = po.id
         WHERE po.status = 'recibido'
           AND po.received_at >= date('now', '-60 days')
           AND pi.unit_cost_cents > p.cost_cents
         GROUP BY p.id, p.name, p.category, p.cost_cents, p.price_cents
         ORDER BY (MAX(pi.unit_cost_cents) - p.cost_cents) DESC
         LIMIT 20",
    ).map_err(err)?;

    let rows: Vec<PriceSyncAlert> = stmt.query_map([], |row| {
        let current_cost: i64 = row.get("cost_cents")?;
        let price: i64 = row.get("price_cents")?;
        let last_cost: i64 = row.get("last_order_cost")?;
        let margin = if price > 0 {
            ((price - last_cost) as f64 / price as f64) * 100.0
        } else { -100.0 };
        Ok(PriceSyncAlert {
            product_id: row.get("id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            current_cost_cents: current_cost,
            last_order_cost_cents: last_cost,
            price_cents: price,
            margin_with_new_cost_pct: margin,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}

#[tauri::command]
pub fn rename_category(old_name: String, new_name: String, state: State<AppState>) -> CmdResult<i64> {
    let conn = state.db.lock();
    let n = conn.execute(
        "UPDATE products SET category=?1, updated_at=datetime('now','localtime') WHERE category=?2",
        params![new_name, old_name],
    ).map_err(err)?;
    Ok(n as i64)
}

#[tauri::command]
pub fn delete_category(name: String, state: State<AppState>) -> CmdResult<i64> {
    let conn = state.db.lock();
    let n = conn.execute(
        "UPDATE products SET category=NULL, updated_at=datetime('now','localtime') WHERE category=?1",
        params![name],
    ).map_err(err)?;
    Ok(n as i64)
}

/// Preview de actualización masiva de precios (no aplica cambios).
#[tauri::command]
pub fn preview_bulk_update_prices(
    input: BulkPriceInput,
    state: State<AppState>,
) -> CmdResult<Vec<BulkPricePreviewItem>> {
    let conn = state.db.lock();

    let sql = match input.filter_type.as_str() {
        "category" => "SELECT id, name, category, price_cents, cost_cents FROM products WHERE active=1 AND category=?1 ORDER BY name",
        "supplier" => "SELECT id, name, category, price_cents, cost_cents FROM products WHERE active=1 AND supplier_id=?1 ORDER BY name",
        _          => "SELECT id, name, category, price_cents, cost_cents FROM products WHERE active=1 ORDER BY name",
    };

    let price_mult = 1.0 + input.price_pct / 100.0;
    let cost_mult  = 1.0 + input.cost_pct.unwrap_or(0.0) / 100.0;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<BulkPricePreviewItem> {
        let old_price: i64 = row.get("price_cents")?;
        let old_cost: i64  = row.get("cost_cents")?;
        Ok(BulkPricePreviewItem {
            id: row.get("id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            old_price_cents: old_price,
            new_price_cents: (old_price as f64 * price_mult).round() as i64,
            old_cost_cents: old_cost,
            new_cost_cents: if input.cost_pct.is_some() {
                (old_cost as f64 * cost_mult).round() as i64
            } else { old_cost },
        })
    };

    let mut stmt = conn.prepare(sql).map_err(err)?;
    let rows = if input.filter_type == "all" {
        stmt.query_map([], map_row).map_err(err)?
    } else {
        let v = input.filter_value.as_deref().unwrap_or("");
        stmt.query_map(params![v], map_row).map_err(err)?
    };

    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(err)?); }
    Ok(out)
}

/// Aplica la actualización masiva de precios.
#[tauri::command]
pub fn apply_bulk_update_prices(
    input: BulkPriceInput,
    state: State<AppState>,
) -> CmdResult<i64> {
    let conn = state.db.lock();

    // Obtener productos a actualizar
    let sql = match input.filter_type.as_str() {
        "category" => "SELECT id, price_cents, cost_cents FROM products WHERE active=1 AND category=?1",
        "supplier" => "SELECT id, price_cents, cost_cents FROM products WHERE active=1 AND supplier_id=?1",
        _          => "SELECT id, price_cents, cost_cents FROM products WHERE active=1",
    };

    let price_mult = 1.0 + input.price_pct / 100.0;
    let cost_mult  = 1.0 + input.cost_pct.unwrap_or(0.0) / 100.0;
    let update_cost = input.cost_pct.is_some();

    let mut stmt = conn.prepare(sql).map_err(err)?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<(i64, i64, i64)> {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    };
    let ids: Vec<(i64, i64, i64)> = if input.filter_type == "all" {
        stmt.query_map([], map_row).map_err(err)?
            .filter_map(|r| r.ok()).collect()
    } else {
        let v = input.filter_value.as_deref().unwrap_or("");
        stmt.query_map(params![v], map_row).map_err(err)?
            .filter_map(|r| r.ok()).collect()
    };

    let mut count = 0i64;
    for (id, old_price, old_cost) in ids {
        let new_price = (old_price as f64 * price_mult).round() as i64;
        let new_cost  = if update_cost { (old_cost as f64 * cost_mult).round() as i64 } else { old_cost };
        conn.execute(
            "UPDATE products SET price_cents=?1, cost_cents=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?3",
            params![new_price, new_cost, id],
        ).map_err(err)?;
        count += 1;
    }

    let detail = format!("Actualizacion masiva: {}% precio | filtro: {}", input.price_pct, input.filter_type);
    log_action(&conn, None, "actualizacion_masiva", "productos", None, Some(&detail));
    Ok(count)
}

/// Importa productos desde filas parseadas de CSV.
#[tauri::command]
pub fn import_products_csv(
    rows: Vec<CsvProductRow>,
    state: State<AppState>,
) -> CmdResult<ImportResult> {
    let conn = state.db.lock();
    let mut created = 0i64;
    let mut updated = 0i64;
    let mut skipped = 0i64;
    let mut errors: Vec<String> = Vec::new();

    for (i, row) in rows.iter().enumerate() {
        let line = i + 1;
        if row.name.trim().is_empty() {
            errors.push(format!("Fila {line}: nombre vacío"));
            skipped += 1;
            continue;
        }
        if row.price_cents < 0 {
            errors.push(format!("Fila {line}: precio negativo en '{}'", row.name));
            skipped += 1;
            continue;
        }

        // Si tiene código de barras, buscar existente
        let existing_id: Option<i64> = if let Some(ref bc) = row.barcode {
            conn.query_row(
                "SELECT id FROM products WHERE barcode=?1 LIMIT 1",
                params![bc],
                |r| r.get(0),
            ).ok()
        } else {
            None
        };

        let result = if let Some(id) = existing_id {
            conn.execute(
                "UPDATE products SET name=?1, price_cents=?2, cost_cents=?3, stock=?4,
                 min_stock=?5, category=?6, supplier_id=?7, expires_at=?8,
                 updated_at=CURRENT_TIMESTAMP WHERE id=?9",
                params![row.name, row.price_cents, row.cost_cents, row.stock,
                        row.min_stock, row.category, row.supplier_id, row.expires_at, id],
            )
        } else {
            conn.execute(
                "INSERT INTO products (barcode,name,price_cents,cost_cents,stock,min_stock,category,supplier_id,expires_at,active)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1)",
                params![row.barcode, row.name, row.price_cents, row.cost_cents, row.stock,
                        row.min_stock, row.category, row.supplier_id, row.expires_at],
            )
        };

        match result {
            Ok(_) => {
                if existing_id.is_some() { updated += 1; } else { created += 1; }
            }
            Err(e) => {
                errors.push(format!("Fila {line} '{}': {}", row.name, e));
                skipped += 1;
            }
        }
    }

    log_action(&conn, None, "importacion_csv", "productos", None,
        Some(&format!("Creados: {created}, actualizados: {updated}, omitidos: {skipped}")));

    Ok(ImportResult { created, updated, skipped, errors })
}

/// Sugerencias de stock mínimo dinámico basadas en velocidad de venta x lead time del proveedor.
#[tauri::command]
pub fn get_min_stock_suggestions(state: State<AppState>) -> CmdResult<Vec<MinStockSuggestion>> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT
            p.id, p.name, p.category, p.min_stock, p.supplier_id,
            s.name as supplier_name,
            COALESCE(vel.daily_velocity, 0.0) as daily_velocity,
            COALESCE(lt.avg_days, 3.0) as lead_time_days
         FROM products p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN (
             SELECT si.product_id, CAST(SUM(si.qty) AS REAL) / 30.0 as daily_velocity
             FROM sale_items si
             JOIN sales sv ON si.sale_id = sv.id
             WHERE date(sv.created_at,'localtime') >= date('now','localtime','-30 days')
               AND (sv.notes IS NULL OR sv.notes NOT LIKE '%[ANULADA]%')
               AND si.product_id IS NOT NULL
             GROUP BY si.product_id
         ) vel ON p.id = vel.product_id
         LEFT JOIN (
             SELECT po.supplier_id, AVG(julianday(po.received_at) - julianday(po.ordered_at)) as avg_days
             FROM purchase_orders po
             WHERE po.status = 'recibido' AND po.received_at IS NOT NULL
             GROUP BY po.supplier_id
         ) lt ON p.supplier_id = lt.supplier_id
         WHERE p.active = 1 AND COALESCE(vel.daily_velocity, 0) > 0.05",
    ).map_err(err)?;

    let rows = stmt.query_map([], |row| {
        let velocity: f64 = row.get("daily_velocity")?;
        let lead_time: f64 = row.get("lead_time_days")?;
        let current_min: i64 = row.get("min_stock")?;
        let suggested = ((velocity * lead_time * 1.3).ceil() as i64).max(1);
        Ok((row.get::<_, i64>("id")?, row.get::<_, String>("name")?,
            row.get::<_, Option<String>>("category")?, current_min, suggested,
            velocity, lead_time,
            row.get::<_, Option<i64>>("supplier_id")?,
            row.get::<_, Option<String>>("supplier_name")?))
    }).map_err(err)?.filter_map(|r| r.ok()).collect::<Vec<_>>();

    // Solo incluir cuando la sugerencia difiere significativamente (>20% o diferencia absoluta >2)
    let suggestions = rows.into_iter().filter_map(|(id, name, cat, cur, sug, vel, lt, sid, sname)| {
        let pct_diff = ((sug - cur).abs() as f64) / (cur.max(1) as f64);
        if pct_diff >= 0.2 || (sug - cur).abs() >= 2 {
            Some(MinStockSuggestion {
                product_id: id, name, category: cat,
                current_min_stock: cur, suggested_min_stock: sug,
                daily_velocity: (vel * 10.0).round() / 10.0,
                lead_time_days: (lt * 10.0).round() / 10.0,
                supplier_id: sid, supplier_name: sname,
            })
        } else { None }
    }).collect();

    Ok(suggestions)
}

/// Aplica las sugerencias de stock mínimo a los productos indicados.
#[tauri::command]
pub fn apply_min_stock_suggestions(
    suggestions: Vec<crate::models::MinStockSuggestion>,
    state: State<AppState>,
) -> CmdResult<i64> {
    let conn = state.db.lock();
    let mut count = 0i64;
    for s in &suggestions {
        conn.execute(
            "UPDATE products SET min_stock=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            rusqlite::params![s.suggested_min_stock, s.product_id],
        ).map_err(err)?;
        count += 1;
    }
    log_action(&conn, None, "actualizar_min_stock", "productos", None,
        Some(&format!("{count} stocks mínimos actualizados por IA")));
    Ok(count)
}

/// Proyección de impacto: cuánto ganaría el negocio si cada producto con margen bajo llegara al mínimo configurado.
#[tauri::command]
pub fn get_price_impact_projections(state: State<AppState>) -> CmdResult<Vec<PriceImpactItem>> {
    let conn = state.db.lock();

    let min_margin: f64 = conn
        .query_row("SELECT value FROM config WHERE key='min_margin_pct'", [], |r| r.get::<_, String>(0))
        .ok().and_then(|v| v.parse().ok()).unwrap_or(10.0);

    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.category, p.price_cents, p.cost_cents,
                COALESCE(CAST(SUM(si.qty) AS REAL) / 30.0, 0) as daily_velocity
         FROM products p
         LEFT JOIN sale_items si ON p.id = si.product_id
         LEFT JOIN sales s ON si.sale_id = s.id
             AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
             AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
         WHERE p.active = 1 AND p.price_cents > 0 AND p.cost_cents > 0
         GROUP BY p.id
         HAVING daily_velocity > 0.05",
    ).map_err(err)?;

    let rows: Vec<PriceImpactItem> = stmt.query_map([], |row| {
        let price: i64 = row.get("price_cents")?;
        let cost: i64  = row.get("cost_cents")?;
        let velocity: f64 = row.get("daily_velocity")?;
        let current_margin = if price > 0 { ((price - cost) as f64 / price as f64) * 100.0 } else { 0.0 };

        // Solo productos donde el margen actual está por debajo del mínimo
        if current_margin >= min_margin { return Err(rusqlite::Error::QueryReturnedNoRows); }

        // Precio sugerido: cost / (1 - min_margin/100)
        let suggested_price = (cost as f64 / (1.0 - min_margin / 100.0)).ceil() as i64;
        let monthly_gain = ((suggested_price - price) as f64 * velocity * 30.0).round() as i64;

        Ok(PriceImpactItem {
            product_id: row.get("id")?,
            name: row.get("name")?,
            category: row.get("category")?,
            current_price_cents: price,
            cost_cents: cost,
            current_margin_pct: (current_margin * 10.0).round() / 10.0,
            min_margin_pct: min_margin,
            suggested_price_cents: suggested_price,
            monthly_gain_cents: monthly_gain,
            daily_velocity: (velocity * 10.0).round() / 10.0,
        })
    }).map_err(err)?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}
