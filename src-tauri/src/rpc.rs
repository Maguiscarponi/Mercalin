// Dispatcher RPC para multicaja: expone los mismos comandos que ya usa el
// frontend local (vía Tauri `invoke`) por HTTP, para que una caja "cliente"
// pueda hablarle a la caja "servidor" en la red. Reusa la lógica de negocio
// real (las mismas funciones de `commands::*`), no la duplica.
//
// Comandos deliberadamente fuera de este dispatcher:
// - `import_off_catalog` / `cancel_off_catalog_import`: usan `AppHandle` y
//   emiten eventos de progreso en vez de devolver un resultado directo; son
//   una operación de mantenimiento pesada, no tiene sentido dispararla remota.
// - `get_network_info`: siempre responde con la IP/puerto de *este* equipo,
//   nunca tiene sentido pedírsela a otro.
//
// Si se agrega un comando Tauri nuevo en `commands/mod.rs` y tiene sentido
// que una caja cliente lo pueda llamar, agregarlo acá también (una línea).

use crate::AppState;
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub type RpcResult = Result<Value, String>;

macro_rules! rpc_dispatch {
    ( $app:expr, $command:expr, $body:expr, { $( $name:literal => $path:path [ $($arg:ident : $ty:ty),* $(,)? ] ),* $(,)? } ) => {
        match $command {
            $(
                $name => {
                    #[derive(serde::Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    struct Args { $($arg: $ty,)* }
                    let args: Args = serde_json::from_value($body)
                        .map_err(|e| format!("Argumentos inválidos para \"{}\": {}", $name, e))?;
                    let state = $app.state::<AppState>();
                    let result = $path($(args.$arg,)* state)?;
                    serde_json::to_value(result).map_err(|e| e.to_string())
                }
            )*
            other => Err(format!("Comando RPC desconocido: \"{}\"", other)),
        }
    };
}

pub fn dispatch(app: &AppHandle, command: &str, body: Value) -> RpcResult {
    rpc_dispatch!(app, command, body, {
        // Productos
        "find_product_by_barcode" => crate::commands::products::find_product_by_barcode[barcode: String],
        "list_products" => crate::commands::products::list_products[query: String, include_ghosts: bool],
        "create_product" => crate::commands::products::create_product[product: crate::models::NewProduct],
        "update_product" => crate::commands::products::update_product[product: crate::models::Product],
        "delete_product" => crate::commands::products::delete_product[id: i64],
        "get_product" => crate::commands::products::get_product[id: i64],
        "list_expiring_products" => crate::commands::products::list_expiring_products[days: i64],
        "list_categories" => crate::commands::products::list_categories[],
        "create_category" => crate::commands::products::create_category[name: String],
        "list_product_velocities" => crate::commands::products::list_product_velocities[],
        "get_price_desync" => crate::commands::products::get_price_desync[],
        "rename_category" => crate::commands::products::rename_category[old_name: String, new_name: String],
        "delete_category" => crate::commands::products::delete_category[name: String],
        "preview_bulk_update_prices" => crate::commands::products::preview_bulk_update_prices[input: crate::models::BulkPriceInput],
        "apply_bulk_update_prices" => crate::commands::products::apply_bulk_update_prices[input: crate::models::BulkPriceInput],
        "import_products_csv" => crate::commands::products::import_products_csv[rows: Vec<crate::models::CsvProductRow>],
        "get_min_stock_suggestions" => crate::commands::products::get_min_stock_suggestions[],
        "apply_min_stock_suggestions" => crate::commands::products::apply_min_stock_suggestions[suggestions: Vec<crate::models::MinStockSuggestion>],
        "get_price_impact_projections" => crate::commands::products::get_price_impact_projections[],

        // Ventas
        "create_sale" => crate::commands::sales::create_sale[input: crate::models::SaleInput],
        "get_sale" => crate::commands::sales::get_sale[id: i64],
        "get_sale_with_items" => crate::commands::sales::get_sale_with_items[id: i64],
        "list_sales" => crate::commands::sales::list_sales[date: String, limit: i64],
        "list_sales_range" => crate::commands::sales::list_sales_range[from_date: String, to_date: String, limit: i64],
        "list_sales_by_client" => crate::commands::sales::list_sales_by_client[client_id: i64, limit: i64],
        "cancel_sale" => crate::commands::sales::cancel_sale[id: i64],

        // Caja / sesiones
        "open_cash_session" => crate::commands::caja::open_cash_session[input: crate::models::OpenSessionInput],
        "close_cash_session" => crate::commands::caja::close_cash_session[input: crate::models::CloseSessionInput],
        "get_current_session" => crate::commands::caja::get_current_session[],
        "list_open_sessions" => crate::commands::caja::list_open_sessions[],
        "list_cash_sessions" => crate::commands::caja::list_cash_sessions[limit: i64],
        "add_cash_movement" => crate::commands::caja::add_cash_movement[input: crate::models::NewCashMovement],
        "get_session_sales_total" => crate::commands::caja::get_session_sales_total[session_id: i64],
        "get_session_all_sales_total" => crate::commands::caja::get_session_all_sales_total[session_id: i64],
        "list_cash_movements" => crate::commands::caja::list_cash_movements[session_id: i64],

        // Stock
        "adjust_stock" => crate::commands::stock::adjust_stock[input: crate::models::StockAdjustInput],
        "list_low_stock" => crate::commands::stock::list_low_stock[],
        "list_stock_movements" => crate::commands::stock::list_stock_movements[product_id: i64, limit: i64],
        "top_products" => crate::commands::stock::top_products[date_from: String, date_to: String, limit: i64],
        "top_products_by_qty" => crate::commands::stock::top_products_by_qty[date_from: String, date_to: String, limit: i64],
        "sales_by_category" => crate::commands::stock::sales_by_category[date_from: String, date_to: String],
        "reorder_by_supplier" => crate::commands::stock::reorder_by_supplier[],
        "get_dead_stock" => crate::commands::stock::get_dead_stock[days: i64],
        "list_inventory_count" => crate::commands::stock::list_inventory_count[],
        "apply_inventory_count" => crate::commands::stock::apply_inventory_count[adjustments: Vec<crate::models::CountAdjustment>],

        // Lotes / vencimientos
        "list_product_lots" => crate::commands::lots::list_product_lots[product_id: i64],
        "list_expiring_lots" => crate::commands::lots::list_expiring_lots[days: i64],
        "add_product_lot" => crate::commands::lots::add_product_lot[input: crate::models::NewProductLot],
        "retire_lot" => crate::commands::lots::retire_lot[lot_id: i64],
        "update_lot_expiry" => crate::commands::lots::update_lot_expiry[lot_id: i64, expires_at: Option<String>],

        // Combos
        "list_combos" => crate::commands::combos::list_combos[],
        "list_active_combos" => crate::commands::combos::list_active_combos[],
        "find_combo_by_barcode" => crate::commands::combos::find_combo_by_barcode[barcode: String],
        "create_combo" => crate::commands::combos::create_combo[input: crate::models::NewCombo],
        "update_combo" => crate::commands::combos::update_combo[id: i64, input: crate::models::NewCombo],
        "toggle_combo" => crate::commands::combos::toggle_combo[id: i64],
        "delete_combo" => crate::commands::combos::delete_combo[id: i64],

        // Promociones
        "list_promotions" => crate::commands::promotions::list_promotions[],
        "create_promotion" => crate::commands::promotions::create_promotion[promo: crate::models::NewPromotion],
        "update_promotion" => crate::commands::promotions::update_promotion[promo: crate::models::Promotion],
        "toggle_promotion" => crate::commands::promotions::toggle_promotion[id: i64],
        "delete_promotion" => crate::commands::promotions::delete_promotion[id: i64],

        // Presupuestos
        "list_quotes" => crate::commands::quotes::list_quotes[],
        "get_quote_with_items" => crate::commands::quotes::get_quote_with_items[id: i64],
        "create_quote" => crate::commands::quotes::create_quote[quote: crate::models::NewQuote],
        "update_quote_status" => crate::commands::quotes::update_quote_status[id: i64, status: String],
        "delete_quote" => crate::commands::quotes::delete_quote[id: i64],

        // Devoluciones
        "create_return" => crate::commands::returns::create_return[input: crate::models::NewReturn],
        "list_returns" => crate::commands::returns::list_returns[limit: i64],
        "get_return_with_items" => crate::commands::returns::get_return_with_items[id: i64],

        // Clientes
        "list_clients" => crate::commands::clients::list_clients[query: String],
        "get_client" => crate::commands::clients::get_client[id: i64],
        "create_client" => crate::commands::clients::create_client[client: crate::models::NewClient],
        "update_client" => crate::commands::clients::update_client[client: crate::models::Client],
        "delete_client" => crate::commands::clients::delete_client[id: i64],
        "client_account_history" => crate::commands::clients::client_account_history[client_id: i64],
        "register_client_payment" => crate::commands::clients::register_client_payment[input: crate::models::ClientPaymentInput],
        "get_clients_rfm" => crate::commands::clients::get_clients_rfm[],

        // Proveedores
        "list_suppliers" => crate::commands::suppliers::list_suppliers[],
        "create_supplier" => crate::commands::suppliers::create_supplier[supplier: crate::models::NewSupplier],
        "update_supplier" => crate::commands::suppliers::update_supplier[supplier: crate::models::Supplier],
        "delete_supplier" => crate::commands::suppliers::delete_supplier[id: i64],
        "create_purchase_order" => crate::commands::suppliers::create_purchase_order[order: crate::models::NewPurchaseOrder],
        "list_purchase_orders" => crate::commands::suppliers::list_purchase_orders[supplier_id: Option<i64>],
        "receive_purchase_order" => crate::commands::suppliers::receive_purchase_order[order_id: i64],
        "get_purchase_items" => crate::commands::suppliers::get_purchase_items[order_id: i64],
        "cancel_purchase_order" => crate::commands::suppliers::cancel_purchase_order[order_id: i64],
        "generate_auto_orders" => crate::commands::suppliers::generate_auto_orders[],
        "get_supplier_lead_times" => crate::commands::suppliers::get_supplier_lead_times[],
        "get_purchase_projections" => crate::commands::suppliers::get_purchase_projections[],
        "get_supplier_cost_inflation" => crate::commands::suppliers::get_supplier_cost_inflation[],
        "get_supplier_risk_scores" => crate::commands::suppliers::get_supplier_risk_scores[],

        // Usuarios
        "list_users" => crate::commands::users::list_users[],
        "create_user" => crate::commands::users::create_user[user: crate::models::NewUser],
        "update_user" => crate::commands::users::update_user[user: crate::models::User],
        "change_password" => crate::commands::users::change_password[user_id: i64, new_password: String],
        "delete_user" => crate::commands::users::delete_user[id: i64],
        "login" => crate::commands::users::login[username: String, password: String],

        // Config
        "get_config" => crate::commands::config::get_config[key: String],
        "set_config" => crate::commands::config::set_config[entry: crate::models::ConfigEntry],
        "get_all_config" => crate::commands::config::get_all_config[],
        "set_multiple_config" => crate::commands::config::set_multiple_config[entries: Vec<crate::models::ConfigEntry>],

        // Reportes / dashboard / insights
        "get_dashboard" => crate::commands::dashboard::get_dashboard[],
        "get_insights" => crate::commands::insights::get_insights[],
        "daily_report" => crate::commands::reports::daily_report[date: String],
        "range_report" => crate::commands::reports::range_report[from_date: String, to_date: String],
        "sales_by_user" => crate::commands::reports::sales_by_user[from_date: String, to_date: String],
        "margin_report" => crate::commands::reports::margin_report[from_date: String, to_date: String],
        "margin_by_category" => crate::commands::reports::margin_by_category[from_date: String, to_date: String],
        "get_iva_report" => crate::commands::reports::get_iva_report[from_date: String, to_date: String],
        "get_product_affinity" => crate::commands::reports::get_product_affinity[],

        // Auditoría / backup
        "list_audit_log" => crate::commands::audit::list_audit_log[limit: i64],
        "backup_database" => crate::commands::backup::backup_database[],
        "list_backups" => crate::commands::backup::list_backups[],
        "delete_backup" => crate::commands::backup::delete_backup[name: String],
        "auto_backup_check" => crate::commands::backup::auto_backup_check[],

        // ARCA / facturación electrónica
        "get_arca_config" => crate::commands::arca::get_arca_config[],
        "save_arca_config" => crate::commands::arca::save_arca_config[input: crate::models::ArcaConfigInput],
        "generate_arca_keypair" => crate::commands::arca::generate_arca_keypair[],
        "load_arca_certificate" => crate::commands::arca::load_arca_certificate[cert_pem: String],
        "test_arca_connection" => crate::commands::arca::test_arca_connection[],
        "issue_electronic_invoice" => crate::commands::arca::issue_electronic_invoice[input: crate::models::InvoiceInput],
        "list_electronic_invoices" => crate::commands::arca::list_electronic_invoices[limit: i64],
        "retry_pending_invoices" => crate::commands::arca::retry_pending_invoices[],
    })
}
