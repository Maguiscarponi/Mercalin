import { invoke } from "@tauri-apps/api/core";
import type {
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
    invoke<Product | null>("find_product_by_barcode", { barcode }),

  getProduct: (id: number) =>
    invoke<Product>("get_product", { id }),

  listProducts: (query = "") =>
    invoke<Product[]>("list_products", { query }),

  createProduct: (product: NewProduct) =>
    invoke<Product>("create_product", { product }),

  updateProduct: (product: Product) =>
    invoke<Product>("update_product", { product }),

  deleteProduct: (id: number) =>
    invoke<void>("delete_product", { id }),

  listExpiringProducts: (days = 30) =>
    invoke<ExpiringProduct[]>("list_expiring_products", { days }),

  listProductVelocities: () =>
    invoke<ProductVelocity[]>("list_product_velocities"),

  listCategories: () =>
    invoke<CategoryStat[]>("list_categories"),

  renameCategory: (oldName: string, newName: string) =>
    invoke<number>("rename_category", { oldName, newName }),

  deleteCategory: (name: string) =>
    invoke<number>("delete_category", { name }),

  // ─── Ventas ─────────────────────────────────────────────────────────
  createSale: (input: SaleInput) =>
    invoke<Sale>("create_sale", { input }),

  getSale: (id: number) =>
    invoke<Sale>("get_sale", { id }),

  getSaleWithItems: (id: number) =>
    invoke<SaleWithItems>("get_sale_with_items", { id }),

  listSales: (date: string, limit = 100) =>
    invoke<Sale[]>("list_sales", { date, limit }),

  listSalesRange: (fromDate: string, toDate: string, limit = 300) =>
    invoke<Sale[]>("list_sales_range", { fromDate, toDate, limit }),

  cancelSale: (id: number) =>
    invoke<void>("cancel_sale", { id }),

  // ─── Reportes ───────────────────────────────────────────────────────
  dailyReport: (date: string) =>
    invoke<DailyReport>("daily_report", { date }),

  rangeReport: (fromDate: string, toDate: string) =>
    invoke<DailyReport>("range_report", { fromDate, toDate }),

  topProducts: (dateFrom: string, dateTo: string, limit = 10) =>
    invoke<TopProduct[]>("top_products", { dateFrom, dateTo, limit }),

  salesByCategory: (dateFrom: string, dateTo: string) =>
    invoke<[string, number][]>("sales_by_category", { dateFrom, dateTo }),

  // ─── Stock ──────────────────────────────────────────────────────────
  adjustStock: (input: StockAdjustInput) =>
    invoke<void>("adjust_stock", { input }),

  listLowStock: () =>
    invoke<LowStockProduct[]>("list_low_stock"),

  listStockMovements: (productId: number, limit = 50) =>
    invoke<StockMovement[]>("list_stock_movements", { productId, limit }),

  // ─── Caja ───────────────────────────────────────────────────────────
  getCurrentSession: () =>
    invoke<CashSession | null>("get_current_session"),

  listOpenSessions: () =>
    invoke<CashSession[]>("list_open_sessions"),

  listCashSessions: (limit = 30) =>
    invoke<CashSession[]>("list_cash_sessions", { limit }),

  openCashSession: (input: OpenSessionInput) =>
    invoke<CashSession>("open_cash_session", { input }),

  closeCashSession: (input: CloseSessionInput) =>
    invoke<CashSession>("close_cash_session", { input }),

  addCashMovement: (input: NewCashMovement) =>
    invoke<CashMovement>("add_cash_movement", { input }),

  listCashMovements: (sessionId: number) =>
    invoke<CashMovement[]>("list_cash_movements", { sessionId }),

  getSessionSalesTotal: (sessionId: number) =>
    invoke<number>("get_session_sales_total", { sessionId }),

  getSessionAllSalesTotal: (sessionId: number) =>
    invoke<number>("get_session_all_sales_total", { sessionId }),

  // ─── Clientes ───────────────────────────────────────────────────────
  listClients: (query = "") =>
    invoke<Client[]>("list_clients", { query }),

  getClient: (id: number) =>
    invoke<Client>("get_client", { id }),

  createClient: (client: NewClient) =>
    invoke<Client>("create_client", { client }),

  updateClient: (client: Client) =>
    invoke<Client>("update_client", { client }),

  deleteClient: (id: number) =>
    invoke<void>("delete_client", { id }),

  clientAccountHistory: (clientId: number) =>
    invoke<ClientAccountEntry[]>("client_account_history", { clientId }),

  registerClientPayment: (input: ClientPaymentInput) =>
    invoke<Client>("register_client_payment", { input }),

  // ─── Proveedores ────────────────────────────────────────────────────
  listSuppliers: () =>
    invoke<Supplier[]>("list_suppliers"),

  createSupplier: (supplier: NewSupplier) =>
    invoke<Supplier>("create_supplier", { supplier }),

  updateSupplier: (supplier: Supplier) =>
    invoke<Supplier>("update_supplier", { supplier }),

  deleteSupplier: (id: number) =>
    invoke<void>("delete_supplier", { id }),

  createPurchaseOrder: (order: NewPurchaseOrder) =>
    invoke<PurchaseOrder>("create_purchase_order", { order }),

  listPurchaseOrders: (supplierId?: number) =>
    invoke<PurchaseOrder[]>("list_purchase_orders", { supplierId: supplierId ?? null }),

  receivePurchaseOrder: (orderId: number) =>
    invoke<PurchaseOrder>("receive_purchase_order", { orderId }),

  cancelPurchaseOrder: (orderId: number) =>
    invoke<void>("cancel_purchase_order", { orderId }),

  getPurchaseItems: (orderId: number) =>
    invoke<PurchaseOrderItem[]>("get_purchase_items", { orderId }),

  // ─── Configuración ──────────────────────────────────────────────────
  getConfig: (key: string) =>
    invoke<string | null>("get_config", { key }),

  setConfig: (entry: ConfigEntry) =>
    invoke<void>("set_config", { entry }),

  getAllConfig: () =>
    invoke<ConfigEntry[]>("get_all_config"),

  setMultipleConfig: (entries: ConfigEntry[]) =>
    invoke<void>("set_multiple_config", { entries }),

  // ─── Usuarios ───────────────────────────────────────────────────────────────
  listUsers: () =>
    invoke<User[]>("list_users"),

  createUser: (user: NewUser) =>
    invoke<User>("create_user", { user }),

  updateUser: (user: User) =>
    invoke<User>("update_user", { user }),

  changePassword: (userId: number, newPassword: string) =>
    invoke<void>("change_password", { userId, newPassword }),

  deleteUser: (id: number) =>
    invoke<void>("delete_user", { id }),

  // ─── Reportes adicionales ────────────────────────────────────────────────────
  salesByUser: (fromDate: string, toDate: string) =>
    invoke<SalesByUser[]>("sales_by_user", { fromDate, toDate }),

  // ─── Auditoría ──────────────────────────────────────────────────────────────
  listAuditLog: (limit = 200) =>
    invoke<AuditEntry[]>("list_audit_log", { limit }),

  // ─── Promociones ────────────────────────────────────────────────────────────
  listPromotions: () =>
    invoke<Promotion[]>("list_promotions"),

  createPromotion: (promo: NewPromotion) =>
    invoke<Promotion>("create_promotion", { promo }),

  updatePromotion: (promo: Promotion) =>
    invoke<Promotion>("update_promotion", { promo }),

  togglePromotion: (id: number) =>
    invoke<Promotion>("toggle_promotion", { id }),

  deletePromotion: (id: number) =>
    invoke<void>("delete_promotion", { id }),

  // ─── Devoluciones ───────────────────────────────────────────────────────────
  createReturn: (input: NewReturn) =>
    invoke<ReturnRecord>("create_return", { input }),

  listReturns: (limit = 100) =>
    invoke<ReturnRecord[]>("list_returns", { limit }),

  getReturnWithItems: (id: number) =>
    invoke<ReturnWithItems>("get_return_with_items", { id }),

  // ─── Márgenes ───────────────────────────────────────────────────────────────
  marginReport: (fromDate: string, toDate: string) =>
    invoke<MarginProduct[]>("margin_report", { fromDate, toDate }),

  marginByCategory: (fromDate: string, toDate: string) =>
    invoke<MarginCategory[]>("margin_by_category", { fromDate, toDate }),

  reorderBySupplier: () =>
    invoke<ReorderItem[]>("reorder_by_supplier"),

  // ─── Presupuestos ────────────────────────────────────────────────────────────
  listQuotes: () =>
    invoke<Quote[]>("list_quotes"),

  getQuoteWithItems: (id: number) =>
    invoke<QuoteWithItems>("get_quote_with_items", { id }),

  createQuote: (quote: NewQuote) =>
    invoke<Quote>("create_quote", { quote }),

  updateQuoteStatus: (id: number, status: string) =>
    invoke<Quote>("update_quote_status", { id, status }),

  deleteQuote: (id: number) =>
    invoke<void>("delete_quote", { id }),

  // ─── Proveedores (auto-orders) ───────────────────────────────────────────────
  generateAutoOrders: () =>
    invoke<PurchaseOrder[]>("generate_auto_orders"),

  // ─── Autenticación ───────────────────────────────────────────────────────────
  login: (username: string, password: string) =>
    invoke<User>("login", { username, password }),

  // ─── Backup ─────────────────────────────────────────────────────────────────
  backupDatabase: () =>
    invoke<string>("backup_database"),

  listBackups: () =>
    invoke<BackupInfo[]>("list_backups"),

  deleteBackup: (name: string) =>
    invoke<void>("delete_backup", { name }),

  autoBackupCheck: () =>
    invoke<boolean>("auto_backup_check"),

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  getDashboard: () =>
    invoke<DashboardData>("get_dashboard"),

  // ─── Insights (motor BI) ────────────────────────────────────────────────────
  getInsights: () =>
    invoke<Insight[]>("get_insights"),

  // ─── RFM de clientes ────────────────────────────────────────────────────────
  getClientsRfm: () =>
    invoke<ClientRfm[]>("get_clients_rfm"),

  // ─── Stock muerto ────────────────────────────────────────────────────────────
  getDeadStock: (days = 30) =>
    invoke<DeadStockItem[]>("get_dead_stock", { days }),

  // ─── Desajuste costo/precio ──────────────────────────────────────────────────
  getPriceDesync: () =>
    invoke<PriceSyncAlert[]>("get_price_desync"),

  // ─── Inteligencia de negocio ─────────────────────────────────────────────────
  getMinStockSuggestions: () =>
    invoke<MinStockSuggestion[]>("get_min_stock_suggestions"),

  applyMinStockSuggestions: (suggestions: MinStockSuggestion[]) =>
    invoke<number>("apply_min_stock_suggestions", { suggestions }),

  getPriceImpactProjections: () =>
    invoke<PriceImpactItem[]>("get_price_impact_projections"),

  getProductAffinity: () =>
    invoke<ProductAffinity[]>("get_product_affinity"),

  getSupplierRiskScores: () =>
    invoke<SupplierRiskScore[]>("get_supplier_risk_scores"),

  // ─── Fase 3: Precios masivos ─────────────────────────────────────────────────
  previewBulkUpdatePrices: (input: BulkPriceInput) =>
    invoke<BulkPricePreviewItem[]>("preview_bulk_update_prices", { input }),

  applyBulkUpdatePrices: (input: BulkPriceInput) =>
    invoke<number>("apply_bulk_update_prices", { input }),

  importProductsCsv: (rows: CsvProductRow[]) =>
    invoke<ImportResult>("import_products_csv", { rows }),

  // ─── Fase 3: Proveedores ──────────────────────────────────────────────────────
  getSupplierLeadTimes: () =>
    invoke<SupplierLeadTime[]>("get_supplier_lead_times"),

  getPurchaseProjections: () =>
    invoke<PurchaseProjection[]>("get_purchase_projections"),

  getSupplierCostInflation: () =>
    invoke<CostInflationItem[]>("get_supplier_cost_inflation"),

  // ─── Fase 3: Reportes ────────────────────────────────────────────────────────
  getIvaReport: (fromDate: string, toDate: string) =>
    invoke<IvaReportItem[]>("get_iva_report", { fromDate, toDate }),

  // ─── Fase 3: Inventario ───────────────────────────────────────────────────────
  listInventoryCount: () =>
    invoke<InventoryCountItem[]>("list_inventory_count"),

  applyInventoryCount: (adjustments: CountAdjustment[]) =>
    invoke<number>("apply_inventory_count", { adjustments }),

  // ─── Lotes (FEFO) ────────────────────────────────────────────────────────────
  listProductLots: (productId: number) =>
    invoke<ProductLot[]>("list_product_lots", { productId }),

  listExpiringLots: (days = 60) =>
    invoke<ExpiringLot[]>("list_expiring_lots", { days }),

  addProductLot: (input: NewProductLot) =>
    invoke<ProductLot>("add_product_lot", { input }),

  retireLot: (lotId: number) =>
    invoke<void>("retire_lot", { lotId }),

  updateLotExpiry: (lotId: number, expiresAt: string | null) =>
    invoke<void>("update_lot_expiry", { lotId, expiresAt }),

  // ─── Combos y packs ──────────────────────────────────────────────────────────
  listCombos: () =>
    invoke<ComboWithItems[]>("list_combos"),

  listActiveCombos: () =>
    invoke<ComboWithItems[]>("list_active_combos"),

  findComboByBarcode: (barcode: string) =>
    invoke<ComboWithItems | null>("find_combo_by_barcode", { barcode }),

  createCombo: (input: NewCombo) =>
    invoke<ComboWithItems>("create_combo", { input }),

  updateCombo: (id: number, input: NewCombo) =>
    invoke<ComboWithItems>("update_combo", { id, input }),

  toggleCombo: (id: number) =>
    invoke<Combo>("toggle_combo", { id }),

  deleteCombo: (id: number) =>
    invoke<void>("delete_combo", { id }),

  // ─── Fase 4: Red / Tablet ────────────────────────────────────────────────────
  getNetworkInfo: () =>
    invoke<NetworkInfo>("get_network_info"),

  // ─── ARCA / Facturación electrónica ──────────────────────────────────────────
  getArcaConfig: () =>
    invoke<ArcaConfig | null>("get_arca_config"),

  saveArcaConfig: (input: ArcaConfigInput) =>
    invoke<void>("save_arca_config", { input }),

  generateArcaKeypair: () =>
    invoke<string>("generate_arca_keypair"),

  loadArcaCertificate: (certPem: string) =>
    invoke<string>("load_arca_certificate", { certPem }),

  testArcaConnection: () =>
    invoke<string>("test_arca_connection"),

  issueElectronicInvoice: (input: InvoiceInput) =>
    invoke<ElectronicInvoice>("issue_electronic_invoice", { input }),

  listElectronicInvoices: (limit = 200) =>
    invoke<ElectronicInvoice[]>("list_electronic_invoices", { limit }),

  retryPendingInvoices: () =>
    invoke<number>("retry_pending_invoices"),

  // ─── Import de catálogo público (Open Food Facts) ──────────────────────
  // El comando solo dispara el import en un hilo aparte y vuelve al instante;
  // el progreso y el resultado final llegan por los eventos "catalog_import_progress"
  // y "catalog_import_done" (ver OffImportModal en Productos.tsx).
  importOffCatalog: () =>
    invoke<void>("import_off_catalog"),

  cancelOffCatalogImport: () =>
    invoke<void>("cancel_off_catalog_import"),
};
