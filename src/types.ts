// Sincronizado con src-tauri/src/models/mod.rs
// Precios siempre en centavos (enteros) para evitar errores de redondeo.

export type Id = number;
export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'qr' | 'transferencia' | 'fiado' | 'cuenta_corriente' | 'mixto';

export interface PaymentSplit {
  method: PaymentMethod;
  amount_cents: number;
}

// ─── Productos ──────────────────────────────────────────────────────────────
export interface Product {
  id: Id;
  barcode: string | null;
  name: string;
  price_cents: number;
  price2_cents: number;
  price3_cents: number;
  cost_cents: number;
  stock: number;
  min_stock: number;
  category: string | null;
  is_weighable: boolean;
  active: boolean;
  // Precargado (ej. import de catálogo público) pero sin precio todavía: no cuenta como
  // parte real del catálogo, pero se puede encontrar buscándolo o escaneándolo. Se activa
  // solo con cargarle un precio de venta.
  is_ghost: boolean;
  supplier_id: Id | null;
  expires_at: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewProduct {
  barcode: string | null;
  name: string;
  price_cents: number;
  price2_cents: number;
  price3_cents: number;
  cost_cents: number;
  stock: number;
  min_stock: number;
  category: string | null;
  is_weighable: boolean;
  active: boolean;
  supplier_id: Id | null;
  expires_at: string | null;
}

export interface ExpiringProduct {
  id: Id;
  barcode: string | null;
  name: string;
  stock: number;
  expires_at: string;
  days_left: number;
}

export interface ProductLot {
  id: Id;
  product_id: Id;
  product_name: string;
  qty: number;
  cost_cents: number;
  expires_at: string | null;
  order_id: Id | null;
  notes: string | null;
  created_at: string;
}

export interface NewProductLot {
  product_id: Id;
  qty: number;
  cost_cents: number;
  expires_at: string | null;
  notes: string | null;
}

export interface ExpiringLot {
  lot_id: Id;
  product_id: Id;
  product_name: string;
  barcode: string | null;
  qty: number;
  expires_at: string;
  days_left: number;
}

export interface LowStockProduct {
  id: Id;
  barcode: string | null;
  name: string;
  stock: number;
  min_stock: number;
  category: string | null;
}

export interface StockAdjustInput {
  product_id: Id;
  new_stock: number;
  notes: string | null;
}

export interface StockMovement {
  id: Id;
  product_id: Id;
  product_name: string;
  movement_type: 'ajuste' | 'ingreso' | 'venta' | 'compra';
  qty_change: number;
  qty_before: number;
  qty_after: number;
  notes: string | null;
  created_at: string;
}

// ─── Carrito y Ventas ───────────────────────────────────────────────────────
export interface CartItem {
  product_id: Id | null;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  discount_pct: number;
  qty: number;
  combo_id?: Id | null;
}

export interface SaleInput {
  items: CartItem[];
  payment_method: PaymentMethod;
  paid_cents: number;
  discount_cents: number;
  client_id: Id | null;
  user_id: Id | null;
  notes: string | null;
  payments?: PaymentSplit[] | null;
  session_id?: Id | null;
}

export interface Sale {
  id: Id;
  total_cents: number;
  discount_cents: number;
  paid_cents: number;
  change_cents: number;
  payment_method: PaymentMethod;
  client_id: Id | null;
  client_name: string | null;
  user_id: Id | null;
  notes: string | null;
  created_at: string;
}

export interface SaleItem {
  id: Id;
  sale_id: Id;
  product_id: Id | null;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  discount_pct: number;
  qty: number;
  subtotal_cents: number;
}

export interface SaleWithItems {
  sale: Sale;
  items: SaleItem[];
}

// ─── Reportes ───────────────────────────────────────────────────────────────
export interface DailyReport {
  date: string;
  sales_count: number;
  total_cents: number;
  discount_cents: number;
  by_method: Record<string, number>;
}

export interface TopProduct {
  product_id: Id | null;
  name: string;
  total_qty: number;
  total_cents: number;
}

// ─── Caja ───────────────────────────────────────────────────────────────────
export interface CashSession {
  id: Id;
  user_id: Id | null;
  opened_at: string;
  closed_at: string | null;
  opening_cents: number;
  closing_cents: number | null;
  notes: string | null;
  status: 'open' | 'closed';
}

export interface OpenSessionInput {
  opening_cents: number;
  user_id: Id | null;
  notes: string | null;
}

export interface CloseSessionInput {
  session_id: Id;
  closing_cents: number;
  notes: string | null;
}

export interface CashMovement {
  id: Id;
  session_id: Id;
  movement_type: 'ingreso' | 'egreso';
  amount_cents: number;
  concept: string;
  created_at: string;
}

export interface NewCashMovement {
  session_id: Id;
  movement_type: 'ingreso' | 'egreso';
  amount_cents: number;
  concept: string;
}

// ─── Clientes ───────────────────────────────────────────────────────────────
export interface Client {
  id: Id;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  dni: string | null;
  notes: string | null;
  credit_limit_cents: number;
  balance_cents: number;
  is_ri: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewClient {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  dni: string | null;
  notes: string | null;
  credit_limit_cents: number;
  is_ri: boolean;
}

export interface ClientAccountEntry {
  id: Id;
  client_id: Id;
  amount_cents: number;
  movement_type: 'cargo' | 'pago';
  concept: string;
  sale_id: Id | null;
  created_at: string;
}

export interface ClientPaymentInput {
  client_id: Id;
  amount_cents: number;
  concept: string;
}

// ─── Proveedores ────────────────────────────────────────────────────────────
export interface Supplier {
  id: Id;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  cuit: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewSupplier {
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  cuit: string | null;
  notes: string | null;
}

export interface PurchaseOrder {
  id: Id;
  supplier_id: Id;
  supplier_name: string;
  total_cents: number;
  status: 'pendiente' | 'recibido' | 'cancelado';
  notes: string | null;
  ordered_at: string;
  received_at: string | null;
}

export interface PurchaseOrderItem {
  id: Id;
  order_id: Id;
  product_id: Id | null;
  name: string;
  unit_cost_cents: number;
  qty: number;
}

export interface NewPurchaseOrder {
  supplier_id: Id;
  items: NewPurchaseOrderItem[];
  notes: string | null;
}

export interface NewPurchaseOrderItem {
  product_id: Id | null;
  name: string;
  unit_cost_cents: number;
  qty: number;
}

// ─── Configuración ──────────────────────────────────────────────────────────
export interface ConfigEntry {
  key: string;
  value: string;
}

export interface DeptButton {
  label: string;
  price_cents: number;
}

// ─── Usuarios ───────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'cajero' | 'supervisor';

export interface User {
  id: Id;
  username: string;
  full_name: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface NewUser {
  username: string;
  full_name: string;
  password: string;
  role: UserRole;
}

// ─── Promociones ────────────────────────────────────────────────────────────
export type PromoType = 'pct' | 'fixed' | '2x1' | '3x2';
export type PromoAppliesTo = 'product' | 'category' | 'all';

export interface Promotion {
  id: Id;
  name: string;
  promo_type: PromoType;
  value: number;
  applies_to: PromoAppliesTo;
  target_id: Id | null;
  target_name: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  days_of_week: string | null;  // JSON array "[0,1,2,3,4,5,6]"
  time_start: string | null;    // "HH:MM"
  time_end: string | null;      // "HH:MM"
  min_qty: number | null;
  created_at: string;
}

export interface NewPromotion {
  name: string;
  promo_type: PromoType;
  value: number;
  applies_to: PromoAppliesTo;
  target_id: Id | null;
  target_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  days_of_week: string | null;
  time_start: string | null;
  time_end: string | null;
  min_qty: number | null;
}

// ─── Combos y packs ──────────────────────────────────────────────────────────
export interface Combo {
  id: Id;
  name: string;
  barcode: string | null;
  price_cents: number;
  cost_cents: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComboItem {
  id: Id;
  combo_id: Id;
  product_id: Id;
  product_name: string;
  product_barcode: string | null;
  qty: number;
  unit_cost_cents: number;
}

export interface ComboWithItems {
  combo: Combo;
  items: ComboItem[];
}

export interface NewComboItem {
  product_id: Id;
  qty: number;
}

export interface NewCombo {
  name: string;
  barcode: string | null;
  price_cents: number;
  notes: string | null;
  items: NewComboItem[];
}

// ─── ARCA / Facturación electrónica ──────────────────────────────────────────
export interface ArcaConfig {
  cuit: string;
  razon_social: string | null;
  punto_venta: number;
  has_certificate: boolean;
  environment: 'homo' | 'prod';
  token_valid: boolean;
  token_expires_at: string | null;
}

export interface ArcaConfigInput {
  cuit: string;
  razon_social: string | null;
  punto_venta: number;
  environment: string;
}

export type InvoiceType = 'A' | 'B' | 'C';

export interface InvoiceInput {
  sale_id: Id | null;
  invoice_type: InvoiceType;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  client_cuit: string | null;
  client_name: string | null;
  doc_tipo: number;   // 80=CUIT, 86=CUIL, 96=DNI, 99=CF sin doc
  doc_nro: string;
}

export interface ElectronicInvoice {
  id: Id;
  sale_id: Id | null;
  invoice_type: InvoiceType;
  cbte_tipo: number;
  punto_venta: number;
  cbte_nro: number | null;
  cae: string | null;
  cae_expires_at: string | null;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  client_cuit: string | null;
  client_name: string | null;
  doc_tipo: number;
  status: 'pendiente' | 'autorizada' | 'error';
  error_msg: string | null;
  created_at: string;
}

// ─── Backup ─────────────────────────────────────────────────────────────────
export interface BackupInfo {
  name: string;
  size_bytes: number;
  display_date: string;
}

// ─── Red / Tablet ────────────────────────────────────────────────────────────
export interface NetworkInfo {
  ip: string;
  port: string;
  enabled: boolean;
}

// ─── Auditoría ───────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: Id;
  user_id: Id | null;
  action: string;
  entity: string;
  entity_id: Id | null;
  detail: string | null;
  created_at: string;
}

// ─── Reportes por usuario ────────────────────────────────────────────────────
export interface SalesByUser {
  user_id: Id | null;
  user_name: string;
  sales_count: number;
  total_cents: number;
}

// ─── Devoluciones ───────────────────────────────────────────────────────────
export interface ReturnRecord {
  id: Id;
  sale_id: Id | null;
  total_cents: number;
  reason: string;
  notes: string | null;
  created_at: string;
}

export interface ReturnItem {
  id: Id;
  return_id: Id;
  product_id: Id | null;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  qty: number;
}

export interface ReturnWithItems {
  ret: ReturnRecord;
  items: ReturnItem[];
}

export interface NewReturnItem {
  product_id: Id | null;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  qty: number;
}

export interface NewReturn {
  sale_id: Id | null;
  items: NewReturnItem[];
  reason: string;
  notes: string | null;
}

// ─── Márgenes ───────────────────────────────────────────────────────────────
export interface MarginProduct {
  product_id: Id;
  name: string;
  category: string | null;
  price_cents: number;
  cost_cents: number;
  margin_pct: number;
  units_sold: number;
  revenue_cents: number;
  profit_cents: number;
}

export interface MarginCategory {
  category: string;
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
  margin_pct: number;
}

// ─── Rubros ──────────────────────────────────────────────────────────────────
export interface CategoryStat {
  name: string;
  product_count: number;
}

// ─── Reposición ──────────────────────────────────────────────────────────────
export interface ReorderItem {
  id: Id;
  barcode: string | null;
  name: string;
  stock: number;
  min_stock: number;
  need_qty: number;
  category: string | null;
  cost_cents: number;
  supplier_id: Id | null;
  supplier_name: string | null;
}

// ─── Insights (motor BI) ─────────────────────────────────────────────────────
export interface Insight {
  id: string;
  category: string;
  level: 'urgente' | 'importante' | 'consejo' | 'info';
  message: string;
  detail: string | null;
  action: string | null;
  route: string | null;
}

// ─── RFM de Clientes ──────────────────────────────────────────────────────────
export type ClientSegment = 'vip' | 'habitual' | 'en_riesgo' | 'deudor_critico' | 'nuevo';
export interface ClientRfm {
  client_id: Id;
  name: string;
  total_purchases: number;
  recency_days: number;
  avg_frequency_days: number | null;
  avg_ticket_cents: number;
  total_spent_cents: number;
  balance_cents: number;
  segment: ClientSegment;
  last_purchase_date: string | null;
}

// ─── Stock muerto ─────────────────────────────────────────────────────────────
export interface DeadStockItem {
  product_id: Id;
  name: string;
  category: string | null;
  stock: number;
  cost_cents: number;
  capital_cents: number;
  days_without_sales: number;
}

// ─── Desajuste costo/precio ───────────────────────────────────────────────────
export interface PriceSyncAlert {
  product_id: Id;
  name: string;
  category: string | null;
  current_cost_cents: number;
  last_order_cost_cents: number;
  price_cents: number;
  margin_with_new_cost_pct: number;
}

// ─── Velocidad de venta ───────────────────────────────────────────────────────
export interface ProductVelocity {
  product_id: Id;
  daily_velocity: number;
  days_remaining: number;  // -1 = sin ventas en 30 días
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface CriticalStockItem {
  product_id: Id;
  name: string;
  stock: number;
  daily_velocity: number;
  days_remaining: number;
}

export interface ExpiringAlertItem {
  product_id: Id;
  name: string;
  stock: number;
  expires_at: string;
  days_left: number;
}

export interface OverdueAccountItem {
  client_id: Id;
  name: string;
  balance_cents: number;
  days_absent: number;
}

export interface DayTrend {
  date: string;
  total_cents: number;
  sales_count: number;
}

export interface TopProductToday {
  product_id: Id | null;
  name: string;
  qty: number;
  total_cents: number;
}

export interface DashboardData {
  today_total_cents: number;
  today_sales_count: number;
  today_avg_ticket_cents: number;
  today_gross_profit_cents: number;
  last_week_same_day_cents: number;
  vs_last_week_pct: number;
  critical_stock: CriticalStockItem[];
  expiring_soon: ExpiringAlertItem[];
  overdue_accounts: OverdueAccountItem[];
  week_trend: DayTrend[];
  top_today: TopProductToday[];
  dominant_payment: string;
  dominant_payment_pct: number;
  daily_goal_cents: number;
  monthly_goal_cents: number;
  month_so_far_cents: number;
  month_projection_cents: number;
}

// ─── Presupuestos ────────────────────────────────────────────────────────────
export type QuoteStatus = 'borrador' | 'enviado' | 'aprobado' | 'rechazado' | 'vencido';

export interface Quote {
  id: Id;
  client_id: Id | null;
  client_name: string | null;
  user_id: Id | null;
  total_cents: number;
  discount_cents: number;
  notes: string | null;
  status: QuoteStatus;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: Id;
  quote_id: Id;
  product_id: Id | null;
  name: string;
  unit_price_cents: number;
  discount_pct: number;
  qty: number;
  subtotal_cents: number;
}

export interface QuoteWithItems {
  quote: Quote;
  items: QuoteItem[];
}

export interface NewQuoteItem {
  product_id: Id | null;
  name: string;
  unit_price_cents: number;
  discount_pct: number;
  qty: number;
}

export interface NewQuote {
  client_id: Id | null;
  user_id: Id | null;
  items: NewQuoteItem[];
  discount_cents: number;
  notes: string | null;
  valid_until: string | null;
}

// ─── Fase 3: Precios masivos ──────────────────────────────────────────────────
export interface BulkPriceInput {
  filter_type: 'all' | 'category' | 'supplier';
  filter_value: string | null;
  price_pct: number;
  cost_pct: number | null;
}

export interface BulkPricePreviewItem {
  id: Id;
  name: string;
  category: string | null;
  old_price_cents: number;
  new_price_cents: number;
  old_cost_cents: number;
  new_cost_cents: number;
}

// ─── Fase 3: Importación CSV ─────────────────────────────────────────────────
export interface CsvProductRow {
  barcode: string | null;
  name: string;
  price_cents: number;
  cost_cents: number;
  stock: number;
  min_stock: number;
  category: string | null;
  supplier_id: Id | null;
  expires_at: string | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ─── Fase 3: Proyección de compras ───────────────────────────────────────────
export interface PurchaseProjection {
  product_id: Id;
  name: string;
  category: string | null;
  stock: number;
  daily_velocity: number;
  days_remaining: number;
  suggested_qty: number;
  cost_cents: number;
  supplier_id: Id | null;
  supplier_name: string | null;
}

// ─── Fase 3: Lead time por proveedor ─────────────────────────────────────────
export interface SupplierLeadTime {
  supplier_id: Id;
  supplier_name: string;
  avg_days: number;
  min_days: number;
  max_days: number;
  order_count: number;
}

// ─── Fase 3: Inflación de costos ─────────────────────────────────────────────
export interface CostInflationItem {
  supplier_id: Id;
  supplier_name: string;
  product_id: Id;
  product_name: string;
  first_cost_cents: number;
  last_cost_cents: number;
  pct_change: number;
  order_count: number;
}

// ─── Fase 3: Libro IVA ────────────────────────────────────────────────────────
export interface IvaReportItem {
  date: string;
  sale_id: Id;
  payment_method: string;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  client_name: string | null;
}

// ─── Fase 3: Conteo de inventario ────────────────────────────────────────────
export interface InventoryCountItem {
  product_id: Id;
  name: string;
  barcode: string | null;
  category: string | null;
  system_stock: number;
}

export interface CountAdjustment {
  product_id: Id;
  counted_qty: number;
}

// ─── Inteligencia: Stock mínimo dinámico ─────────────────────────────────────
export interface MinStockSuggestion {
  product_id: Id;
  name: string;
  category: string | null;
  current_min_stock: number;
  suggested_min_stock: number;
  daily_velocity: number;
  lead_time_days: number;
  supplier_id: Id | null;
  supplier_name: string | null;
}

// ─── Inteligencia: Impacto de precio ────────────────────────────────────────
export interface PriceImpactItem {
  product_id: Id;
  name: string;
  category: string | null;
  current_price_cents: number;
  cost_cents: number;
  current_margin_pct: number;
  min_margin_pct: number;
  suggested_price_cents: number;
  monthly_gain_cents: number;
  daily_velocity: number;
}

// ─── Inteligencia: Afinidad entre productos ──────────────────────────────────
export interface ProductAffinity {
  product_a_id: Id;
  product_a_name: string;
  product_b_id: Id;
  product_b_name: string;
  co_occurrences: number;
  total_a_sales: number;
  affinity_pct: number;
}

// ─── Import de catálogo público (Open Food Facts) ─────────────────────────────
export interface CatalogImportProgress {
  page: number;
  total_pages: number;
  imported: number;
  scanned: number;
}

export interface CatalogImportResult {
  imported: number;
  skipped_existing: number;
  skipped_invalid: number;
  failed_pages: number;
  scanned: number;
  cancelled: boolean;
  error: string | null;
}

// ─── Inteligencia: Score de riesgo por proveedor ─────────────────────────────
export interface SupplierRiskScore {
  supplier_id: Id;
  supplier_name: string;
  lead_time_avg: number;
  lead_time_std: number;
  cost_inflation_pct: number;
  order_count: number;
  risk_score: number;
  risk_level: 'bajo' | 'medio' | 'alto';
}
