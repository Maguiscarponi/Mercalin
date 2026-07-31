use serde::{Deserialize, Serialize};

// ─── Productos ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub barcode: Option<String>,
    pub name: String,
    pub price_cents: i64,
    pub price2_cents: i64,
    pub price3_cents: i64,
    pub cost_cents: i64,
    pub stock: i64,
    pub min_stock: i64,
    pub category: Option<String>,
    pub is_weighable: bool,
    pub active: bool,
    pub supplier_id: Option<i64>,
    pub expires_at: Option<String>,
    pub image_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewProduct {
    pub barcode: Option<String>,
    pub name: String,
    pub price_cents: i64,
    pub price2_cents: i64,
    pub price3_cents: i64,
    pub cost_cents: i64,
    pub stock: i64,
    pub min_stock: i64,
    pub category: Option<String>,
    pub is_weighable: bool,
    pub active: bool,
    pub supplier_id: Option<i64>,
    pub expires_at: Option<String>,
}

// ─── Carrito y Ventas ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartItem {
    pub product_id: Option<i64>,
    pub barcode: Option<String>,
    pub name: String,
    pub unit_price_cents: i64,
    pub discount_pct: f64,
    pub qty: f64,
    #[serde(default)]
    pub combo_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleInput {
    pub items: Vec<CartItem>,
    pub payment_method: String,
    pub paid_cents: i64,
    pub discount_cents: i64,
    pub client_id: Option<i64>,
    pub user_id: Option<i64>,
    pub notes: Option<String>,
    pub payments: Option<Vec<SalePaymentInput>>,
    pub session_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sale {
    pub id: i64,
    pub total_cents: i64,
    pub discount_cents: i64,
    pub paid_cents: i64,
    pub change_cents: i64,
    pub payment_method: String,
    pub client_id: Option<i64>,
    pub client_name: Option<String>,
    pub user_id: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleItem {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: Option<i64>,
    pub barcode: Option<String>,
    pub name: String,
    pub unit_price_cents: i64,
    pub discount_pct: f64,
    pub qty: f64,
    pub subtotal_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleWithItems {
    pub sale: Sale,
    pub items: Vec<SaleItem>,
}

// ─── Reportes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyReport {
    pub date: String,
    pub sales_count: i64,
    pub total_cents: i64,
    pub discount_cents: i64,
    pub by_method: std::collections::HashMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopProduct {
    pub product_id: Option<i64>,
    pub name: String,
    pub total_qty: f64,
    pub total_cents: i64,
}

// ─── Sesiones de Caja ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashSession {
    pub id: i64,
    pub user_id: Option<i64>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub opening_cents: i64,
    pub closing_cents: Option<i64>,
    pub notes: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSessionInput {
    pub opening_cents: i64,
    pub user_id: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseSessionInput {
    pub session_id: i64,
    pub closing_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashMovement {
    pub id: i64,
    pub session_id: i64,
    pub movement_type: String,
    pub amount_cents: i64,
    pub concept: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewCashMovement {
    pub session_id: i64,
    pub movement_type: String,
    pub amount_cents: i64,
    pub concept: String,
}

// ─── Stock ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockMovement {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub movement_type: String,
    pub qty_change: i64,
    pub qty_before: i64,
    pub qty_after: i64,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockAdjustInput {
    pub product_id: i64,
    pub new_stock: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LowStockProduct {
    pub id: i64,
    pub barcode: Option<String>,
    pub name: String,
    pub stock: i64,
    pub min_stock: i64,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpiringProduct {
    pub id: i64,
    pub barcode: Option<String>,
    pub name: String,
    pub stock: i64,
    pub expires_at: String,
    pub days_left: i64,
}

// ─── Lotes de productos ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductLot {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub qty: i64,
    pub cost_cents: i64,
    pub expires_at: Option<String>,
    pub order_id: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewProductLot {
    pub product_id: i64,
    pub qty: i64,
    pub cost_cents: i64,
    pub expires_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpiringLot {
    pub lot_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub barcode: Option<String>,
    pub qty: i64,
    pub expires_at: String,
    pub days_left: i64,
}

// ─── Clientes ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Client {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub dni: Option<String>,
    pub notes: Option<String>,
    pub credit_limit_cents: i64,
    pub balance_cents: i64,
    pub is_ri: bool,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewClient {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub dni: Option<String>,
    pub notes: Option<String>,
    pub credit_limit_cents: i64,
    pub is_ri: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAccountEntry {
    pub id: i64,
    pub client_id: i64,
    pub amount_cents: i64,
    pub movement_type: String,
    pub concept: String,
    pub sale_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientPaymentInput {
    pub client_id: i64,
    pub amount_cents: i64,
    pub concept: String,
}

// ─── Proveedores ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Supplier {
    pub id: i64,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub cuit: Option<String>,
    pub notes: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSupplier {
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub cuit: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrder {
    pub id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub total_cents: i64,
    pub status: String,
    pub notes: Option<String>,
    pub ordered_at: String,
    pub received_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderItem {
    pub id: i64,
    pub order_id: i64,
    pub product_id: Option<i64>,
    pub name: String,
    pub unit_cost_cents: i64,
    pub qty: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPurchaseOrder {
    pub supplier_id: i64,
    pub items: Vec<NewPurchaseOrderItem>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPurchaseOrderItem {
    pub product_id: Option<i64>,
    pub name: String,
    pub unit_cost_cents: i64,
    pub qty: i64,
}

// ─── Configuración ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
}

// ─── Promociones ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Promotion {
    pub id: i64,
    pub name: String,
    pub promo_type: String,
    pub value: f64,
    pub applies_to: String,
    pub target_id: Option<i64>,
    pub target_name: Option<String>,
    pub active: bool,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub days_of_week: Option<String>,  // JSON array "[0,1,2,3,4,5,6]" — 0=Dom
    pub time_start: Option<String>,    // "HH:MM"
    pub time_end: Option<String>,      // "HH:MM"
    pub min_qty: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPromotion {
    pub name: String,
    pub promo_type: String,
    pub value: f64,
    pub applies_to: String,
    pub target_id: Option<i64>,
    pub target_name: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    #[serde(default)]
    pub days_of_week: Option<String>,
    #[serde(default)]
    pub time_start: Option<String>,
    #[serde(default)]
    pub time_end: Option<String>,
    #[serde(default)]
    pub min_qty: Option<i64>,
}

// ─── Combos y Packs ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Combo {
    pub id: i64,
    pub name: String,
    pub barcode: Option<String>,
    pub price_cents: i64,
    pub cost_cents: i64,   // calculado de los componentes
    pub active: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComboItem {
    pub id: i64,
    pub combo_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub product_barcode: Option<String>,
    pub qty: f64,
    pub unit_cost_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComboWithItems {
    pub combo: Combo,
    pub items: Vec<ComboItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewComboItem {
    pub product_id: i64,
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewCombo {
    pub name: String,
    pub barcode: Option<String>,
    pub price_cents: i64,
    pub notes: Option<String>,
    pub items: Vec<NewComboItem>,
}

// ─── Usuarios ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewUser {
    pub username: String,
    pub full_name: String,
    pub password: String,
    pub role: String,
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: i64,
    pub user_id: Option<i64>,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<i64>,
    pub detail: Option<String>,
    pub created_at: String,
}

// ─── Reportes por usuario ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesByUser {
    pub user_id: Option<i64>,
    pub user_name: String,
    pub sales_count: i64,
    pub total_cents: i64,
}

// ─── Devoluciones ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReturnRecord {
    pub id: i64,
    pub sale_id: Option<i64>,
    pub total_cents: i64,
    pub reason: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReturnItem {
    pub id: i64,
    pub return_id: i64,
    pub product_id: Option<i64>,
    pub barcode: Option<String>,
    pub name: String,
    pub unit_price_cents: i64,
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReturnWithItems {
    pub ret: ReturnRecord,
    pub items: Vec<ReturnItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewReturnItem {
    pub product_id: Option<i64>,
    pub barcode: Option<String>,
    pub name: String,
    pub unit_price_cents: i64,
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewReturn {
    pub sale_id: Option<i64>,
    pub items: Vec<NewReturnItem>,
    pub reason: String,
    pub notes: Option<String>,
}

// ─── Pagos combinados ─────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalePaymentInput {
    pub method: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalePayment {
    pub id: i64,
    pub sale_id: i64,
    pub method: String,
    pub amount_cents: i64,
}

// ─── Presupuestos ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub id: i64,
    pub client_id: Option<i64>,
    pub client_name: Option<String>,
    pub user_id: Option<i64>,
    pub total_cents: i64,
    pub discount_cents: i64,
    pub notes: Option<String>,
    pub status: String,
    pub valid_until: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteItem {
    pub id: i64,
    pub quote_id: i64,
    pub product_id: Option<i64>,
    pub name: String,
    pub unit_price_cents: i64,
    pub discount_pct: f64,
    pub qty: f64,
    pub subtotal_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteWithItems {
    pub quote: Quote,
    pub items: Vec<QuoteItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewQuoteItem {
    pub product_id: Option<i64>,
    pub name: String,
    pub unit_price_cents: i64,
    pub discount_pct: f64,
    pub qty: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewQuote {
    pub client_id: Option<i64>,
    pub user_id: Option<i64>,
    pub items: Vec<NewQuoteItem>,
    pub discount_cents: i64,
    pub notes: Option<String>,
    pub valid_until: Option<String>,
}

// ─── Rubros (categorías) ──────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryStat {
    pub name: String,
    pub product_count: i64,
}

// ─── Insights (motor BI) ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Insight {
    pub id: String,
    pub category: String,
    pub level: String,           // "urgente" | "importante" | "consejo" | "info"
    pub message: String,
    pub detail: Option<String>,
    pub action: Option<String>,
    pub route: Option<String>,
}

// ─── RFM de Clientes ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRfm {
    pub client_id: i64,
    pub name: String,
    pub total_purchases: i64,
    pub recency_days: i64,
    pub avg_frequency_days: Option<i64>,
    pub avg_ticket_cents: i64,
    pub total_spent_cents: i64,
    pub balance_cents: i64,
    pub segment: String,         // "vip" | "habitual" | "en_riesgo" | "deudor_critico" | "nuevo"
    pub last_purchase_date: Option<String>,
}

// ─── Stock muerto ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadStockItem {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub stock: i64,
    pub cost_cents: i64,
    pub capital_cents: i64,
    pub days_without_sales: i64,
}

// ─── Desajuste costo/precio ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSyncAlert {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub current_cost_cents: i64,
    pub last_order_cost_cents: i64,
    pub price_cents: i64,
    pub margin_with_new_cost_pct: f64,
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardData {
    pub today_total_cents: i64,
    pub today_sales_count: i64,
    pub today_avg_ticket_cents: i64,
    pub today_gross_profit_cents: i64,
    pub last_week_same_day_cents: i64,
    pub vs_last_week_pct: f64,
    pub critical_stock: Vec<CriticalStockItem>,
    pub expiring_soon: Vec<ExpiringAlertItem>,
    pub overdue_accounts: Vec<OverdueAccountItem>,
    pub week_trend: Vec<DayTrend>,
    pub top_today: Vec<TopProductToday>,
    pub dominant_payment: String,
    pub dominant_payment_pct: f64,
    pub daily_goal_cents: i64,
    pub monthly_goal_cents: i64,
    pub month_so_far_cents: i64,
    pub month_projection_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalStockItem {
    pub product_id: i64,
    pub name: String,
    pub stock: i64,
    pub daily_velocity: f64,
    pub days_remaining: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpiringAlertItem {
    pub product_id: i64,
    pub name: String,
    pub stock: i64,
    pub expires_at: String,
    pub days_left: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverdueAccountItem {
    pub client_id: i64,
    pub name: String,
    pub balance_cents: i64,
    pub days_absent: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayTrend {
    pub date: String,
    pub total_cents: i64,
    pub sales_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopProductToday {
    pub product_id: Option<i64>,
    pub name: String,
    pub qty: f64,
    pub total_cents: i64,
}

// ─── Reposición por proveedor ─────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderItem {
    pub id: i64,
    pub barcode: Option<String>,
    pub name: String,
    pub stock: i64,
    pub min_stock: i64,
    pub need_qty: i64,
    pub category: Option<String>,
    pub cost_cents: i64,
    pub supplier_id: Option<i64>,
    pub supplier_name: Option<String>,
}

// ─── Velocidad de venta ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductVelocity {
    pub product_id: i64,
    pub daily_velocity: f64,
    pub days_remaining: f64,
}

// ─── Fase 3: Precios masivos ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkPriceInput {
    /// "all" | "category" | "supplier"
    pub filter_type: String,
    pub filter_value: Option<String>,
    /// Porcentaje de aumento sobre precio (ej: 15.0 = +15%)
    pub price_pct: f64,
    /// Si Some, también actualiza costos
    pub cost_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkPricePreviewItem {
    pub id: i64,
    pub name: String,
    pub category: Option<String>,
    pub old_price_cents: i64,
    pub new_price_cents: i64,
    pub old_cost_cents: i64,
    pub new_cost_cents: i64,
}

// ─── Fase 3: Importación CSV ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvProductRow {
    pub barcode: Option<String>,
    pub name: String,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub stock: i64,
    pub min_stock: i64,
    pub category: Option<String>,
    pub supplier_id: Option<i64>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub created: i64,
    pub updated: i64,
    pub skipped: i64,
    pub errors: Vec<String>,
}

// ─── Fase 3: Proyección de compras ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseProjection {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub stock: i64,
    pub daily_velocity: f64,
    pub days_remaining: f64,
    pub suggested_qty: i64,
    pub cost_cents: i64,
    pub supplier_id: Option<i64>,
    pub supplier_name: Option<String>,
}

// ─── Fase 3: Lead time por proveedor ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierLeadTime {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub avg_days: f64,
    pub min_days: i64,
    pub max_days: i64,
    pub order_count: i64,
}

// ─── Fase 3: Inflación de costos por proveedor ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostInflationItem {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub product_id: i64,
    pub product_name: String,
    pub first_cost_cents: i64,
    pub last_cost_cents: i64,
    pub pct_change: f64,
    pub order_count: i64,
}

// ─── Fase 3: Libro IVA ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IvaReportItem {
    pub date: String,
    pub sale_id: i64,
    pub payment_method: String,
    pub total_cents: i64,
    pub neto_cents: i64,
    pub iva_cents: i64,
    pub client_name: Option<String>,
}

// ─── Fase 3: Conteo de inventario ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryCountItem {
    pub product_id: i64,
    pub name: String,
    pub barcode: Option<String>,
    pub category: Option<String>,
    pub system_stock: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountAdjustment {
    pub product_id: i64,
    pub counted_qty: i64,
}

// ─── Margen / Rentabilidad ────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginProduct {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub margin_pct: f64,
    pub units_sold: f64,
    pub revenue_cents: i64,
    pub profit_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginCategory {
    pub category: String,
    pub revenue_cents: i64,
    pub cost_cents: i64,
    pub profit_cents: i64,
    pub margin_pct: f64,
}

// ─── Inteligencia: Stock mínimo dinámico ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinStockSuggestion {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub current_min_stock: i64,
    pub suggested_min_stock: i64,
    pub daily_velocity: f64,
    pub lead_time_days: f64,
    pub supplier_id: Option<i64>,
    pub supplier_name: Option<String>,
}

// ─── Inteligencia: Impacto de precio ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceImpactItem {
    pub product_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub current_price_cents: i64,
    pub cost_cents: i64,
    pub current_margin_pct: f64,
    pub min_margin_pct: f64,
    pub suggested_price_cents: i64,
    pub monthly_gain_cents: i64,
    pub daily_velocity: f64,
}

// ─── Inteligencia: Afinidad entre productos ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductAffinity {
    pub product_a_id: i64,
    pub product_a_name: String,
    pub product_b_id: i64,
    pub product_b_name: String,
    pub co_occurrences: i64,
    pub total_a_sales: i64,
    pub affinity_pct: f64,
}

// ─── Inteligencia: Score de riesgo por proveedor ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierRiskScore {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub lead_time_avg: f64,
    pub lead_time_std: f64,
    pub cost_inflation_pct: f64,
    pub order_count: i64,
    pub risk_score: f64,
    pub risk_level: String,
}

// ─── ARCA / Facturación electrónica ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaConfig {
    pub cuit: String,
    pub razon_social: Option<String>,
    pub punto_venta: i64,
    pub has_certificate: bool,
    pub environment: String,        // "homo" | "prod"
    pub token_valid: bool,
    pub token_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaConfigInput {
    pub cuit: String,
    pub razon_social: Option<String>,
    pub punto_venta: i64,
    pub environment: String,
}

/// Tipos de comprobante ARCA
/// 1=Factura A, 2=Nota Débito A, 3=Nota Crédito A
/// 6=Factura B, 7=Nota Débito B, 8=Nota Crédito B
/// 11=Factura C, 12=Nota Débito C, 13=Nota Crédito C
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceInput {
    pub sale_id: Option<i64>,
    pub invoice_type: String,       // "A" | "B" | "C"
    pub total_cents: i64,
    pub neto_cents: i64,
    pub iva_cents: i64,
    pub client_cuit: Option<String>,
    pub client_name: Option<String>,
    pub doc_tipo: i64,              // 80=CUIT, 86=CUIL, 96=DNI, 99=ConsumidorFinal
    pub doc_nro: String,            // Número de documento
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElectronicInvoice {
    pub id: i64,
    pub sale_id: Option<i64>,
    pub invoice_type: String,
    pub cbte_tipo: i64,
    pub punto_venta: i64,
    pub cbte_nro: Option<i64>,
    pub cae: Option<String>,
    pub cae_expires_at: Option<String>,
    pub total_cents: i64,
    pub neto_cents: i64,
    pub iva_cents: i64,
    pub client_cuit: Option<String>,
    pub client_name: Option<String>,
    pub doc_tipo: i64,
    pub status: String,             // "pendiente" | "autorizada" | "error"
    pub error_msg: Option<String>,
    pub created_at: String,
}

