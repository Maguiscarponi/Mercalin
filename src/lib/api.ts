import { invoke } from "@tauri-apps/api/core";
import { rpc } from "@/lib/rpc";
import type {
  DeviceConfig, PendingSyncOp,
  ArcaConfig, ArcaConfigInput, ElectronicInvoice, InvoiceInput,
  AuditEntry,
  BackupInfo,
  BulkPriceInput, BulkPricePreviewItem,
  CatalogImportResult,
  Combo, ComboWithItems, NewCombo,
  MinStockSuggestion, PriceImpactItem, ProductAffinity, SupplierRiskScore,
  CashMovement, CashSession, CloseSessionInput, NewCashMovement, OpenSessionInput,
  Client, NewClient, ClientAccountEntry, ClientPaymentInput, ClientRfm,
  CategoryStat, ReorderItem, DeadStockItem,
  ConfigEntry,
  CostInflationItem, CountAdjustment, CsvProductRow,
  DailyReport, DashboardData,
  ExpiringProduct, ExpiringLot, LowStockProduct, StockAdjustInput, StockMovement,
  ImportResult, Insight, InventoryCountItem, IvaReportItem,
  NetworkInfo,
  NewProduct, Product, ProductLot, NewProductLot, ProductVelocity, PriceSyncAlert,
  Promotion, NewPromotion,
  PurchaseOrder, PurchaseOrderItem, NewPurchaseOrder, PurchaseProjection,
  Quote, QuoteWithItems, NewQuote,
  Sale, SaleInput, SaleWithItems, SalesByUser, SupplierLeadTime, TopProduct,
  Supplier, NewSupplier,
  User, NewUser,
  NewReturn, ReturnRecord, ReturnWithItems,
  MarginProduct, MarginCategory,
} from "@/types";

export const api = {
  // ─── Productos ──────────────────────────────────────────────────────
  findProductByBarcode: (barcode: string) =>
    rpc<Product | null>("find_product_by_barcode", { barcode }),

  getProduct: (id: number) =>
    rpc<Product>("get_product", { id }),

  // includeGhosts: true trae también los precargados sin precio (para activarlos buscando/
  // escaneando en Caja o en "Agregar producto"). El resto del sistema (catálogo real, combos,
  // promociones, reportes, etc.) usa el default false a propósito.
  listProducts: (query = "", includeGhosts = false) =>
    rpc<Product[]>("list_products", { query, includeGhosts }),

  createProduct: (product: NewProduct) =>
    rpc<Product>("create_product", { product }),

  updateProduct: (product: Product) =>
    rpc<Product>("update_product", { product }),

  deleteProduct: (id: number) =>
    rpc<void>("delete_product", { id }),

  listExpiringProducts: (days = 30) =>
    rpc<ExpiringProduct[]>("list_expiring_products", { days }),

  listProductVelocities: () =>
    rpc<ProductVelocity[]>("list_product_velocities"),

  listCategories: () =>
    rpc<CategoryStat[]>("list_categories"),

  createCategory: (name: string) =>
    rpc<void>("create_category", { name }),

  renameCategory: (oldName: string, newName: string) =>
    rpc<number>("rename_category", { oldName, newName }),

  deleteCategory: (name: string) =>
    rpc<number>("delete_category", { name }),

  // ─── Ventas ─────────────────────────────────────────────────────────
  createSale: (input: SaleInput) =>
    rpc<Sale>("create_sale", { input }),

  getSale: (id: number) =>
    rpc<Sale>("get_sale", { id }),

  getSaleWithItems: (id: number) =>
    rpc<SaleWithItems>("get_sale_with_items", { id }),

  listSales: (date: string, limit = 100) =>
    rpc<Sale[]>("list_sales", { date, limit }),

  listSalesRange: (fromDate: string, toDate: string, limit = 300) =>
    rpc<Sale[]>("list_sales_range", { fromDate, toDate, limit }),

  cancelSale: (id: number) =>
    rpc<void>("cancel_sale", { id }),

  // ─── Reportes ───────────────────────────────────────────────────────
  dailyReport: (date: string) =>
    rpc<DailyReport>("daily_report", { date }),

  rangeReport: (fromDate: string, toDate: string) =>
    rpc<DailyReport>("range_report", { fromDate, toDate }),

  topProducts: (dateFrom: string, dateTo: string, limit = 10) =>
    rpc<TopProduct[]>("top_products", { dateFrom, dateTo, limit }),

  topProductsByQty: (dateFrom: string, dateTo: string, limit = 10) =>
    rpc<TopProduct[]>("top_products_by_qty", { dateFrom, dateTo, limit }),

  salesByCategory: (dateFrom: string, dateTo: string) =>
    rpc<[string, number][]>("sales_by_category", { dateFrom, dateTo }),

  // ─── Stock ──────────────────────────────────────────────────────────
  adjustStock: (input: StockAdjustInput) =>
    rpc<void>("adjust_stock", { input }),

  listLowStock: () =>
    rpc<LowStockProduct[]>("list_low_stock"),

  listStockMovements: (productId: number, limit = 50) =>
    rpc<StockMovement[]>("list_stock_movements", { productId, limit }),

  // ─── Caja ───────────────────────────────────────────────────────────
  getCurrentSession: () =>
    rpc<CashSession | null>("get_current_session"),

  listOpenSessions: () =>
    rpc<CashSession[]>("list_open_sessions"),

  listCashSessions: (limit = 30) =>
    rpc<CashSession[]>("list_cash_sessions", { limit }),

  openCashSession: (input: OpenSessionInput) =>
    rpc<CashSession>("open_cash_session", { input }),

  closeCashSession: (input: CloseSessionInput) =>
    rpc<CashSession>("close_cash_session", { input }),

  addCashMovement: (input: NewCashMovement) =>
    rpc<CashMovement>("add_cash_movement", { input }),

  listCashMovements: (sessionId: number) =>
    rpc<CashMovement[]>("list_cash_movements", { sessionId }),

  getSessionSalesTotal: (sessionId: number) =>
    rpc<number>("get_session_sales_total", { sessionId }),

  getSessionAllSalesTotal: (sessionId: number) =>
    rpc<number>("get_session_all_sales_total", { sessionId }),

  // ─── Clientes ───────────────────────────────────────────────────────
  listClients: (query = "") =>
    rpc<Client[]>("list_clients", { query }),

  getClient: (id: number) =>
    rpc<Client>("get_client", { id }),

  createClient: (client: NewClient) =>
    rpc<Client>("create_client", { client }),

  updateClient: (client: Client) =>
    rpc<Client>("update_client", { client }),

  deleteClient: (id: number) =>
    rpc<void>("delete_client", { id }),

  clientAccountHistory: (clientId: number) =>
    rpc<ClientAccountEntry[]>("client_account_history", { clientId }),

  registerClientPayment: (input: ClientPaymentInput) =>
    rpc<Client>("register_client_payment", { input }),

  // ─── Proveedores ────────────────────────────────────────────────────
  listSuppliers: () =>
    rpc<Supplier[]>("list_suppliers"),

  createSupplier: (supplier: NewSupplier) =>
    rpc<Supplier>("create_supplier", { supplier }),

  updateSupplier: (supplier: Supplier) =>
    rpc<Supplier>("update_supplier", { supplier }),

  deleteSupplier: (id: number) =>
    rpc<void>("delete_supplier", { id }),

  createPurchaseOrder: (order: NewPurchaseOrder) =>
    rpc<PurchaseOrder>("create_purchase_order", { order }),

  listPurchaseOrders: (supplierId?: number) =>
    rpc<PurchaseOrder[]>("list_purchase_orders", { supplierId: supplierId ?? null }),

  receivePurchaseOrder: (orderId: number) =>
    rpc<PurchaseOrder>("receive_purchase_order", { orderId }),

  cancelPurchaseOrder: (orderId: number) =>
    rpc<void>("cancel_purchase_order", { orderId }),

  getPurchaseItems: (orderId: number) =>
    rpc<PurchaseOrderItem[]>("get_purchase_items", { orderId }),

  // ─── Configuración ──────────────────────────────────────────────────
  getConfig: (key: string) =>
    rpc<string | null>("get_config", { key }),

  setConfig: (entry: ConfigEntry) =>
    rpc<void>("set_config", { entry }),

  getAllConfig: () =>
    rpc<ConfigEntry[]>("get_all_config"),

  setMultipleConfig: (entries: ConfigEntry[]) =>
    rpc<void>("set_multiple_config", { entries }),

  // ─── Usuarios ───────────────────────────────────────────────────────────────
  listUsers: () =>
    rpc<User[]>("list_users"),

  createUser: (user: NewUser) =>
    rpc<User>("create_user", { user }),

  updateUser: (user: User) =>
    rpc<User>("update_user", { user }),

  changePassword: (userId: number, newPassword: string) =>
    rpc<void>("change_password", { userId, newPassword }),

  deleteUser: (id: number) =>
    rpc<void>("delete_user", { id }),

  // ─── Reportes adicionales ────────────────────────────────────────────────────
  salesByUser: (fromDate: string, toDate: string) =>
    rpc<SalesByUser[]>("sales_by_user", { fromDate, toDate }),

  // ─── Auditoría ──────────────────────────────────────────────────────────────
  listAuditLog: (limit = 200) =>
    rpc<AuditEntry[]>("list_audit_log", { limit }),

  // ─── Promociones ────────────────────────────────────────────────────────────
  listPromotions: () =>
    rpc<Promotion[]>("list_promotions"),

  createPromotion: (promo: NewPromotion) =>
    rpc<Promotion>("create_promotion", { promo }),

  updatePromotion: (promo: Promotion) =>
    rpc<Promotion>("update_promotion", { promo }),

  togglePromotion: (id: number) =>
    rpc<Promotion>("toggle_promotion", { id }),

  deletePromotion: (id: number) =>
    rpc<void>("delete_promotion", { id }),

  // ─── Devoluciones ───────────────────────────────────────────────────────────
  createReturn: (input: NewReturn) =>
    rpc<ReturnRecord>("create_return", { input }),

  listReturns: (limit = 100) =>
    rpc<ReturnRecord[]>("list_returns", { limit }),

  getReturnWithItems: (id: number) =>
    rpc<ReturnWithItems>("get_return_with_items", { id }),

  // ─── Márgenes ───────────────────────────────────────────────────────────────
  marginReport: (fromDate: string, toDate: string) =>
    rpc<MarginProduct[]>("margin_report", { fromDate, toDate }),

  marginByCategory: (fromDate: string, toDate: string) =>
    rpc<MarginCategory[]>("margin_by_category", { fromDate, toDate }),

  reorderBySupplier: () =>
    rpc<ReorderItem[]>("reorder_by_supplier"),

  // ─── Presupuestos ────────────────────────────────────────────────────────────
  listQuotes: () =>
    rpc<Quote[]>("list_quotes"),

  getQuoteWithItems: (id: number) =>
    rpc<QuoteWithItems>("get_quote_with_items", { id }),

  createQuote: (quote: NewQuote) =>
    rpc<Quote>("create_quote", { quote }),

  updateQuoteStatus: (id: number, status: string) =>
    rpc<Quote>("update_quote_status", { id, status }),

  deleteQuote: (id: number) =>
    rpc<void>("delete_quote", { id }),

  // ─── Proveedores (auto-orders) ───────────────────────────────────────────────
  generateAutoOrders: () =>
    rpc<PurchaseOrder[]>("generate_auto_orders"),

  // ─── Autenticación ───────────────────────────────────────────────────────────
  login: (username: string, password: string) =>
    rpc<User>("login", { username, password }),

  // ─── Backup ─────────────────────────────────────────────────────────────────
  backupDatabase: () =>
    rpc<string>("backup_database"),

  listBackups: () =>
    rpc<BackupInfo[]>("list_backups"),

  deleteBackup: (name: string) =>
    rpc<void>("delete_backup", { name }),

  autoBackupCheck: () =>
    rpc<boolean>("auto_backup_check"),

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  getDashboard: () =>
    rpc<DashboardData>("get_dashboard"),

  // ─── Insights (motor BI) ────────────────────────────────────────────────────
  getInsights: () =>
    rpc<Insight[]>("get_insights"),

  // ─── RFM de clientes ────────────────────────────────────────────────────────
  getClientsRfm: () =>
    rpc<ClientRfm[]>("get_clients_rfm"),

  // ─── Stock muerto ────────────────────────────────────────────────────────────
  getDeadStock: (days = 30) =>
    rpc<DeadStockItem[]>("get_dead_stock", { days }),

  // ─── Desajuste costo/precio ──────────────────────────────────────────────────
  getPriceDesync: () =>
    rpc<PriceSyncAlert[]>("get_price_desync"),

  // ─── Inteligencia de negocio ─────────────────────────────────────────────────
  getMinStockSuggestions: () =>
    rpc<MinStockSuggestion[]>("get_min_stock_suggestions"),

  applyMinStockSuggestions: (suggestions: MinStockSuggestion[]) =>
    rpc<number>("apply_min_stock_suggestions", { suggestions }),

  getPriceImpactProjections: () =>
    rpc<PriceImpactItem[]>("get_price_impact_projections"),

  getProductAffinity: () =>
    rpc<ProductAffinity[]>("get_product_affinity"),

  getSupplierRiskScores: () =>
    rpc<SupplierRiskScore[]>("get_supplier_risk_scores"),

  // ─── Fase 3: Precios masivos ─────────────────────────────────────────────────
  previewBulkUpdatePrices: (input: BulkPriceInput) =>
    rpc<BulkPricePreviewItem[]>("preview_bulk_update_prices", { input }),

  applyBulkUpdatePrices: (input: BulkPriceInput) =>
    rpc<number>("apply_bulk_update_prices", { input }),

  importProductsCsv: (rows: CsvProductRow[]) =>
    rpc<ImportResult>("import_products_csv", { rows }),

  // ─── Fase 3: Proveedores ──────────────────────────────────────────────────────
  getSupplierLeadTimes: () =>
    rpc<SupplierLeadTime[]>("get_supplier_lead_times"),

  getPurchaseProjections: () =>
    rpc<PurchaseProjection[]>("get_purchase_projections"),

  getSupplierCostInflation: () =>
    rpc<CostInflationItem[]>("get_supplier_cost_inflation"),

  // ─── Fase 3: Reportes ────────────────────────────────────────────────────────
  getIvaReport: (fromDate: string, toDate: string) =>
    rpc<IvaReportItem[]>("get_iva_report", { fromDate, toDate }),

  // ─── Fase 3: Inventario ───────────────────────────────────────────────────────
  listInventoryCount: () =>
    rpc<InventoryCountItem[]>("list_inventory_count"),

  applyInventoryCount: (adjustments: CountAdjustment[]) =>
    rpc<number>("apply_inventory_count", { adjustments }),

  // ─── Lotes (FEFO) ────────────────────────────────────────────────────────────
  listProductLots: (productId: number) =>
    rpc<ProductLot[]>("list_product_lots", { productId }),

  listExpiringLots: (days = 60) =>
    rpc<ExpiringLot[]>("list_expiring_lots", { days }),

  addProductLot: (input: NewProductLot) =>
    rpc<ProductLot>("add_product_lot", { input }),

  retireLot: (lotId: number) =>
    rpc<void>("retire_lot", { lotId }),

  updateLotExpiry: (lotId: number, expiresAt: string | null) =>
    rpc<void>("update_lot_expiry", { lotId, expiresAt }),

  // ─── Combos y packs ──────────────────────────────────────────────────────────
  listCombos: () =>
    rpc<ComboWithItems[]>("list_combos"),

  listActiveCombos: () =>
    rpc<ComboWithItems[]>("list_active_combos"),

  findComboByBarcode: (barcode: string) =>
    rpc<ComboWithItems | null>("find_combo_by_barcode", { barcode }),

  createCombo: (input: NewCombo) =>
    rpc<ComboWithItems>("create_combo", { input }),

  updateCombo: (id: number, input: NewCombo) =>
    rpc<ComboWithItems>("update_combo", { id, input }),

  toggleCombo: (id: number) =>
    rpc<Combo>("toggle_combo", { id }),

  deleteCombo: (id: number) =>
    rpc<void>("delete_combo", { id }),

  // ─── Fase 4: Red / Tablet ────────────────────────────────────────────────────
  getNetworkInfo: () =>
    invoke<NetworkInfo>("get_network_info"),

  // ─── Multicaja: modo de este equipo ─────────────────────────────────────────
  // Siempre local (invoke directo) — describen a ESTE equipo, nunca tiene
  // sentido pedírselos a otra caja por red.
  getDeviceConfig: () =>
    invoke<DeviceConfig>("get_device_config"),

  setDeviceConfig: (config: DeviceConfig) =>
    invoke<void>("set_device_config", { config }),

  bootstrapFromServer: (serverAddr: string) =>
    invoke<string>("bootstrap_from_server", { serverAddr }),

  disconnectClient: () =>
    invoke<void>("disconnect_client"),

  getSyncStatus: () =>
    invoke<"online" | "offline" | "syncing">("get_sync_status"),

  listPendingSyncOps: () =>
    invoke<PendingSyncOp[]>("list_pending_sync_ops"),

  // ─── ARCA / Facturación electrónica ──────────────────────────────────────────
  getArcaConfig: () =>
    rpc<ArcaConfig | null>("get_arca_config"),

  saveArcaConfig: (input: ArcaConfigInput) =>
    rpc<void>("save_arca_config", { input }),

  generateArcaKeypair: () =>
    rpc<string>("generate_arca_keypair"),

  loadArcaCertificate: (certPem: string) =>
    rpc<string>("load_arca_certificate", { certPem }),

  testArcaConnection: () =>
    rpc<string>("test_arca_connection"),

  issueElectronicInvoice: (input: InvoiceInput) =>
    rpc<ElectronicInvoice>("issue_electronic_invoice", { input }),

  listElectronicInvoices: (limit = 200) =>
    rpc<ElectronicInvoice[]>("list_electronic_invoices", { limit }),

  retryPendingInvoices: () =>
    rpc<number>("retry_pending_invoices"),

  // ─── Import de catálogo público (Open Food Facts) ──────────────────────
  // El comando solo dispara el import en un hilo aparte y vuelve al instante;
  // el progreso y el resultado final llegan por los eventos "catalog_import_progress"
  // y "catalog_import_done" (ver OffImportModal en Productos.tsx).
  importOffCatalog: () =>
    invoke<void>("import_off_catalog"),

  cancelOffCatalogImport: () =>
    invoke<void>("cancel_off_catalog_import"),
};
