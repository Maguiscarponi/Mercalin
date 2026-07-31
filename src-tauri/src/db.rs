use rusqlite::{Connection, Result};
use std::path::Path;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode         TEXT UNIQUE,
    name            TEXT NOT NULL,
    price_cents     INTEGER NOT NULL DEFAULT 0,
    cost_cents      INTEGER NOT NULL DEFAULT 0,
    stock           INTEGER NOT NULL DEFAULT 0,
    min_stock       INTEGER NOT NULL DEFAULT 0,
    category        TEXT,
    is_weighable    INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    supplier_id     INTEGER,
    expires_at      TEXT,
    image_path      TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_barcode   ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name      ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_expires   ON products(expires_at);

CREATE TABLE IF NOT EXISTS sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    total_cents     INTEGER NOT NULL,
    discount_cents  INTEGER NOT NULL DEFAULT 0,
    paid_cents      INTEGER NOT NULL,
    change_cents    INTEGER NOT NULL DEFAULT 0,
    payment_method  TEXT NOT NULL,
    client_id       INTEGER,
    user_id         INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_client     ON sales(client_id);

CREATE TABLE IF NOT EXISTS sale_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id             INTEGER NOT NULL,
    product_id          INTEGER,
    barcode             TEXT,
    name                TEXT NOT NULL,
    unit_price_cents    INTEGER NOT NULL,
    discount_pct        REAL NOT NULL DEFAULT 0,
    qty                 REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    dni             TEXT UNIQUE,
    notes           TEXT,
    credit_limit_cents INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_dni  ON clients(dni);

CREATE TABLE IF NOT EXISTS client_account (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL,
    amount_cents    INTEGER NOT NULL,
    movement_type   TEXT NOT NULL CHECK(movement_type IN ('cargo', 'pago')),
    concept         TEXT NOT NULL,
    sale_id         INTEGER,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE INDEX IF NOT EXISTS idx_client_account_client ON client_account(client_id);

CREATE TABLE IF NOT EXISTS suppliers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    contact_name    TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    cuit            TEXT,
    notes           TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id     INTEGER NOT NULL,
    total_cents     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'recibido', 'cancelado')),
    notes           TEXT,
    ordered_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_at     TEXT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id            INTEGER NOT NULL,
    product_id          INTEGER,
    name                TEXT NOT NULL,
    unit_cost_cents     INTEGER NOT NULL,
    qty                 INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    full_name       TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'cajero',
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    opened_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at       TEXT,
    opening_cents   INTEGER NOT NULL DEFAULT 0,
    closing_cents   INTEGER,
    notes           TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL,
    movement_type   TEXT NOT NULL CHECK(movement_type IN ('ingreso', 'egreso')),
    amount_cents    INTEGER NOT NULL,
    concept         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES cash_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id);

CREATE TABLE IF NOT EXISTS stock_movements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER NOT NULL,
    movement_type   TEXT NOT NULL CHECK(movement_type IN ('ajuste', 'ingreso', 'venta', 'compra')),
    qty_change      INTEGER NOT NULL,
    qty_before      INTEGER NOT NULL,
    qty_after       INTEGER NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date    ON stock_movements(created_at);

CREATE TABLE IF NOT EXISTS promotions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    promo_type      TEXT NOT NULL CHECK(promo_type IN ('pct', 'fixed', '2x1', '3x2')),
    value           REAL NOT NULL DEFAULT 0,
    applies_to      TEXT NOT NULL DEFAULT 'product' CHECK(applies_to IN ('product', 'category', 'all')),
    target_id       INTEGER,
    target_name     TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    starts_at       TEXT,
    ends_at         TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    action          TEXT NOT NULL,
    entity          TEXT NOT NULL,
    entity_id       INTEGER,
    detail          TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at);
"#;

pub fn open_and_migrate(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    // Migrations for existing databases (ignorar si la columna ya existe)
    let _ = conn.execute_batch(
        "ALTER TABLE sales ADD COLUMN session_id INTEGER REFERENCES cash_sessions(id);"
    );
    let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN price2_cents INTEGER NOT NULL DEFAULT 0;");
    let _ = conn.execute_batch("ALTER TABLE products ADD COLUMN price3_cents INTEGER NOT NULL DEFAULT 0;");
    // Pagos combinados por venta
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS sale_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            method TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
    ");
    // Presupuestos / cotizaciones
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            user_id INTEGER,
            total_cents INTEGER NOT NULL DEFAULT 0,
            discount_cents INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'borrador',
            valid_until TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS quote_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL,
            product_id INTEGER,
            name TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            discount_pct REAL NOT NULL DEFAULT 0,
            qty REAL NOT NULL,
            FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
        CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
    ");
    // IVA discriminado para clientes RI
    let _ = conn.execute_batch("ALTER TABLE clients ADD COLUMN is_ri INTEGER NOT NULL DEFAULT 0;");
    // Lotes por producto (FEFO — First Expired First Out)
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS product_lots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id      INTEGER NOT NULL,
            qty             INTEGER NOT NULL DEFAULT 0,
            cost_cents      INTEGER NOT NULL DEFAULT 0,
            expires_at      TEXT,
            order_id        INTEGER,
            notes           TEXT,
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (order_id) REFERENCES purchase_orders(id)
        );
        CREATE INDEX IF NOT EXISTS idx_product_lots_product ON product_lots(product_id);
        CREATE INDEX IF NOT EXISTS idx_product_lots_expires ON product_lots(expires_at);
    ");
    // Seed inicial: crear un lote por cada producto con stock > 0 que aún no tenga lotes
    let _ = conn.execute_batch("
        INSERT INTO product_lots (product_id, qty, cost_cents, expires_at, notes)
        SELECT id, stock, cost_cents, expires_at, 'Lote inicial (migración)'
        FROM products
        WHERE stock > 0
          AND id NOT IN (SELECT DISTINCT product_id FROM product_lots);
    ");
    // Promociones temporales: condiciones por horario, día y cantidad mínima
    let _ = conn.execute_batch("ALTER TABLE promotions ADD COLUMN days_of_week TEXT;");
    let _ = conn.execute_batch("ALTER TABLE promotions ADD COLUMN time_start TEXT;");
    let _ = conn.execute_batch("ALTER TABLE promotions ADD COLUMN time_end TEXT;");
    let _ = conn.execute_batch("ALTER TABLE promotions ADD COLUMN min_qty INTEGER;");

    // Combos y packs
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS combos (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            barcode         TEXT UNIQUE,
            price_cents     INTEGER NOT NULL DEFAULT 0,
            active          INTEGER NOT NULL DEFAULT 1,
            notes           TEXT,
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS combo_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            combo_id    INTEGER NOT NULL,
            product_id  INTEGER NOT NULL,
            qty         REAL NOT NULL DEFAULT 1,
            FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_combos_barcode ON combos(barcode);
        CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON combo_items(combo_id);
    ");

    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS returns (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id         INTEGER,
            total_cents     INTEGER NOT NULL DEFAULT 0,
            reason          TEXT NOT NULL DEFAULT '',
            notes           TEXT,
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id)
        );
        CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
        CREATE INDEX IF NOT EXISTS idx_returns_date ON returns(created_at);

        CREATE TABLE IF NOT EXISTS return_items (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            return_id           INTEGER NOT NULL,
            product_id          INTEGER,
            barcode             TEXT,
            name                TEXT NOT NULL,
            unit_price_cents    INTEGER NOT NULL DEFAULT 0,
            qty                 REAL NOT NULL DEFAULT 1,
            FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
    ");
    // ARCA / Facturación electrónica
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS arca_config (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            cuit            TEXT NOT NULL DEFAULT '',
            razon_social    TEXT,
            punto_venta     INTEGER NOT NULL DEFAULT 1,
            private_key_pem TEXT,
            certificate_pem TEXT,
            environment     TEXT NOT NULL DEFAULT 'homo',
            token           TEXT,
            sign            TEXT,
            token_expires_at TEXT,
            updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS electronic_invoices (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id         INTEGER,
            invoice_type    TEXT NOT NULL,
            cbte_tipo       INTEGER NOT NULL,
            punto_venta     INTEGER NOT NULL,
            cbte_nro        INTEGER,
            cae             TEXT,
            cae_expires_at  TEXT,
            total_cents     INTEGER NOT NULL,
            neto_cents      INTEGER NOT NULL DEFAULT 0,
            iva_cents       INTEGER NOT NULL DEFAULT 0,
            client_cuit     TEXT,
            client_name     TEXT,
            doc_tipo        INTEGER NOT NULL DEFAULT 99,
            status          TEXT NOT NULL DEFAULT 'pendiente',
            error_msg       TEXT,
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id)
        );
        CREATE INDEX IF NOT EXISTS idx_einvoices_sale   ON electronic_invoices(sale_id);
        CREATE INDEX IF NOT EXISTS idx_einvoices_status ON electronic_invoices(status);
        CREATE INDEX IF NOT EXISTS idx_einvoices_date   ON electronic_invoices(created_at);
    ");

    seed_default_config(&conn)?;
    seed_dev_data(&conn)?;
    seed_admin_user(&conn)?;
    Ok(conn)
}

fn seed_default_config(conn: &Connection) -> Result<()> {
    let configs = [
        ("business_name", "Kiosco Don Jorge"),
        ("business_address", "Av. Corrientes 1234, CABA"),
        ("business_phone", "1122334455"),
        ("business_cuit", "20-12345678-9"),
        ("ticket_footer", "Gracias por su compra! Volve pronto."),
        ("currency", "ARS"),
        ("price1_name", "Minorista"),
        ("price2_name", "Mayorista"),
        ("price3_name", "Especial"),
        ("dept_buttons", r#"[{"label":"Cigarrillo suelto","price_cents":50000},{"label":"Pan frances","price_cents":80000},{"label":"Carga SUBE","price_cents":200000},{"label":"Caramelo","price_cents":30000},{"label":"Fotocopias","price_cents":60000}]"#),
        // Fase 3 — Finanzas y fiscalidad
        ("iva_rate", "21"),
        ("fixed_costs_monthly_cents", "0"),
        ("min_margin_pct", "10"),
        ("daily_goal_cents", "0"),
        ("monthly_goal_cents", "0"),
        // Fase 4 — Backup automático
        ("auto_backup_enabled", "0"),
        ("auto_backup_freq_hours", "24"),
        ("auto_backup_keep_count", "10"),
        // Fase 4 — Comisiones por método de pago (%)
        ("commission_efectivo_pct", "0"),
        ("commission_debito_pct", "0"),
        ("commission_credito_pct", "0"),
        ("commission_qr_pct", "0"),
        ("commission_transferencia_pct", "0"),
        // Fase 4 — Combos
        ("combos_enabled", "0"),
        // Fase 4 — Modo tablet
        ("tablet_mode_enabled", "0"),
        ("tablet_port", "7979"),
    ];
    for (key, value) in configs {
        conn.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }
    Ok(())
}

// helper: inserta venta + items en un solo paso
// items: (product_id, nombre, price_cents_unitario, qty)
fn ins_sale(
    conn: &Connection,
    total: i64, discount: i64, paid: i64, change: i64,
    method: &str, client: Option<i64>, user: Option<i64>,
    day: i64, hour: u32,
    items: &[(i64, &str, i64, i64)],
) -> Result<()> {
    let ts = if day == 0 {
        format!("datetime('now','localtime','+{} hours')", hour)
    } else {
        format!("datetime('now','localtime','{} days','+{} hours')", day, hour)
    };
    conn.execute(
        &format!("INSERT INTO sales (total_cents,discount_cents,paid_cents,change_cents,payment_method,client_id,user_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,{})", ts),
        rusqlite::params![total, discount, paid, change, method, client, user],
    )?;
    let sid = conn.last_insert_rowid();
    for item in items {
        conn.execute(
            "INSERT INTO sale_items (sale_id,product_id,name,unit_price_cents,discount_pct,qty) VALUES (?1,?2,?3,?4,0.0,?5)",
            rusqlite::params![sid, item.0, item.1, item.2, item.3 as f64],
        )?;
    }
    Ok(())
}

fn seed_dev_data(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    // SHA256("admin") = 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
    // SHA256("1234")  = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
    conn.execute_batch(r#"
        INSERT INTO users (username,full_name,password_hash,role,active) VALUES
            ('admin',    'Administrador', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin',      1),
            ('jlopez',   'Juan Lopez',    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'cajero',     1),
            ('sramirez', 'Sofia Ramirez', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'supervisor', 1);
    "#)?;

    // Productos (IDs 1-25 en orden de insercion)
    // Bebidas: 1-6, Cigarrillos: 7-9, Panaderia: 10-11, Golosinas: 12-16, Snacks: 17-19, Lacteos: 20-21, Limpieza: 22-23, Kiosco: 24-25
    let products: &[(&str, &str, i64, i64, i64, i64, &str, Option<&str>)] = &[
        // Bebidas  ID 1-6
        ("7790070000001", "Coca Cola 500ml",          150000, 100000, 24,  5, "Bebidas",     None),
        ("7790070000005", "Agua Mineral Villa 500ml",  120000,  70000, 30,  5, "Bebidas",     None),
        ("7790070000008", "Sprite 500ml",              140000,  90000, 20,  5, "Bebidas",     None),
        ("7790070000009", "Fanta Naranja 500ml",       140000,  90000, 16,  5, "Bebidas",     None),
        ("7790070000011", "Coca Cola 1.5L",            290000, 200000, 12,  3, "Bebidas",     None),
        ("7790070000012", "Jugo Cepita Naranja 200ml", 180000, 120000,  3,  5, "Bebidas",     Some("2026-06-15")),
        // Cigarrillos  ID 7-9
        ("7790070000002", "Marlboro Box 20",           580000, 480000, 15,  5, "Cigarrillos", None),
        ("7790070000013", "Lucky Strike 20",           560000, 460000,  8,  5, "Cigarrillos", None),
        ("7790070000014", "Camel Rojo 20",             570000, 465000,  2,  5, "Cigarrillos", None),
        // Panaderia  ID 10-11
        ("7790070000003", "Pan Lactal Bimbo 390g",    320000, 220000,  8,  3, "Panaderia",   Some("2026-06-02")),
        ("7790070000015", "Medialunas x6",             280000, 180000,  5,  3, "Panaderia",   Some("2026-05-27")),
        // Golosinas  ID 12-16
        ("7790070000004", "Galletitas Oreo 118g",      240000, 160000, 20,  5, "Golosinas",   None),
        ("7790070000006", "Chocolate Milka 100g",      180000, 120000, 12,  5, "Golosinas",   None),
        ("7790070000010", "Chiclets Adams x12",         40000,  25000, 50, 10, "Golosinas",   None),
        ("7790070000016", "Alfajor Havanna",           380000, 260000,  7,  5, "Golosinas",   Some("2026-07-30")),
        ("7790070000017", "Caramelos Sugus x10",        60000,  35000, 35, 10, "Golosinas",   None),
        // Snacks  ID 17-19
        ("7790070000007", "Papas Lays 90g",            210000, 140000, 18,  5, "Snacks",      None),
        ("7790070000018", "Mani con chocolate 100g",   150000, 100000,  4,  5, "Snacks",      None),
        ("7790070000019", "Palitos Tia Maruca 150g",   160000, 105000, 22,  5, "Snacks",      None),
        // Lacteos  ID 20-21
        ("7790070000020", "Leche La Serenisima 1L",    280000, 210000,  6,  5, "Lacteos",     Some("2026-06-05")),
        ("7790070000021", "Yogur Ser Frutilla 190g",   180000, 130000,  3,  5, "Lacteos",     Some("2026-06-01")),
        // Limpieza  ID 22-23
        ("7790070000022", "Detergente Magistral 500ml",420000, 300000,  9,  3, "Limpieza",    None),
        ("7790070000023", "Jabon Palmolive 125g",       180000, 120000, 11,  3, "Limpieza",    None),
        // Kiosco  ID 24-25
        ("7790070000024", "Revista Gente",             150000, 110000,  4,  2, "Kiosco",      Some("2026-06-01")),
        ("7790070000025", "Diario La Nacion",           60000,  42000,  8,  2, "Kiosco",      Some("2026-05-26")),
    ];

    for (bc, name, price, cost, stock, min_stock, cat, expires) in products {
        conn.execute(
            "INSERT INTO products (barcode, name, price_cents, cost_cents, stock, min_stock, category, expires_at, active)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1)",
            rusqlite::params![bc, name, price, cost, stock, min_stock, cat, expires],
        )?;
    }

    // Proveedores
    conn.execute_batch(r#"
        INSERT INTO suppliers (name,contact_name,phone,email,cuit,notes) VALUES
            ('Distribuidora Norte SA','Carlos Mendez','1144556677','ventas@dnorte.com.ar','30-56781234-5','Bebidas y snacks. Visita los lunes.'),
            ('Cigarros del Sur SRL','Marta Lopez','1133445566','mlopez@cdsur.com','20-98765432-1','Proveedor principal de cigarrillos.'),
            ('Panaderia El Trigo','Jose Rodriguez','1155667788',NULL,'27-45678901-3','Entrega martes y viernes a las 7am.');
    "#)?;

    // Orden 1: recibida - bebidas (proveedor 1)
    // product IDs: 1=Coca Cola 500ml, 2=Agua, 3=Sprite
    conn.execute(
        "INSERT INTO purchase_orders (supplier_id,total_cents,status,notes,ordered_at,received_at) VALUES (1,3760000,'recibido','Reposicion semanal de bebidas',datetime('now','localtime','-5 days','+9 hours'),datetime('now','localtime','-4 days','+10 hours'))",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO purchase_items (order_id,product_id,name,unit_cost_cents,qty) VALUES
            (1,1,'Coca Cola 500ml',100000,12),
            (1,2,'Agua Mineral Villa 500ml',70000,24),
            (1,3,'Sprite 500ml',90000,12);
    "#)?;

    // Orden 2: recibida - cigarrillos (proveedor 2)
    // product IDs: 7=Marlboro, 8=Lucky Strike, 9=Camel Rojo
    conn.execute(
        "INSERT INTO purchase_orders (supplier_id,total_cents,status,notes,ordered_at,received_at) VALUES (2,4310000,'recibido','Stock mensual cigarrillos',datetime('now','localtime','-10 days','+11 hours'),datetime('now','localtime','-9 days','+9 hours'))",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO purchase_items (order_id,product_id,name,unit_cost_cents,qty) VALUES
            (2,7,'Marlboro Box 20',480000,5),
            (2,8,'Lucky Strike 20',460000,3),
            (2,9,'Camel Rojo 20',465000,2);
    "#)?;

    // Orden 3: pendiente - bebidas y snacks (proveedor 1)
    // product IDs: 1=Coca Cola 500ml, 5=Coca Cola 1.5L, 18=Mani con chocolate
    conn.execute(
        "INSERT INTO purchase_orders (supplier_id,total_cents,status,notes,ordered_at) VALUES (1,1600000,'pendiente','Pedido semanal - pendiente entrega',datetime('now','localtime','-1 days','+14 hours'))",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO purchase_items (order_id,product_id,name,unit_cost_cents,qty) VALUES
            (3,1,'Coca Cola 500ml',100000,6),
            (3,5,'Coca Cola 1.5L',200000,3),
            (3,18,'Mani con chocolate 100g',100000,5);
    "#)?;

    // Orden 4: pendiente - panaderia (proveedor 3)
    // product IDs: 10=Pan Lactal, 11=Medialunas
    conn.execute(
        "INSERT INTO purchase_orders (supplier_id,total_cents,status,notes,ordered_at) VALUES (3,620000,'pendiente','Pedido martes',datetime('now','localtime','+7 hours'))",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO purchase_items (order_id,product_id,name,unit_cost_cents,qty) VALUES
            (4,10,'Pan Lactal Bimbo 390g',220000,2),
            (4,11,'Medialunas x6',180000,1);
    "#)?;

    // Clientes
    conn.execute_batch(r#"
        INSERT INTO clients (name,phone,email,dni,address,credit_limit_cents,notes) VALUES
            ('Ana Garcia','1156789012','ana.garcia@mail.com','35123456','Av. Rivadavia 800',500000,'Cliente frecuente. Viene todos los dias.'),
            ('Roberto Sanchez','1167890123',NULL,'28456789','Florida 200',300000,'Compra cigarrillos y bebidas.'),
            ('Maria Fernandez','1178901234','mfernandez@mail.com','42987654',NULL,200000,'Vecina del barrio.'),
            ('Carlos Perez',NULL,NULL,'30112233',NULL,0,'Compras esporadicas.'),
            ('Laura Martinez','1189012345','lmartinez@mail.com','38765432','Corrientes 1500',1000000,'Cliente VIP. Paga en cuenta corriente.');
    "#)?;

    // Movimientos de cuenta corriente
    conn.execute_batch(r#"
        INSERT INTO client_account (client_id,amount_cents,movement_type,concept,created_at) VALUES
            (1,280000,'cargo','Venta reciente',datetime('now','localtime','-3 days','+10 hours')),
            (1,350000,'cargo','Venta reciente',datetime('now','localtime','-2 days','+15 hours')),
            (1,280000,'pago','Pago en efectivo',datetime('now','localtime','-2 days','+17 hours')),
            (5,1250000,'cargo','Venta reciente',datetime('now','localtime','-5 days','+11 hours')),
            (5,890000,'cargo','Venta reciente',datetime('now','localtime','-3 days','+16 hours')),
            (5,1000000,'pago','Transferencia bancaria',datetime('now','localtime','-2 days','+9 hours')),
            (2,580000,'cargo','Venta reciente',datetime('now','localtime','-1 days','+12 hours'));
    "#)?;

    // Sesion de caja cerrada - anteayer (usuario 2 = Juan Lopez)
    conn.execute(
        "INSERT INTO cash_sessions (opened_at,closed_at,opening_cents,closing_cents,notes,user_id) VALUES (datetime('now','localtime','-2 days','+9 hours'),datetime('now','localtime','-2 days','+20 hours'),1000000,4250000,'Cierre normal del dia',2)",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO cash_movements (session_id,movement_type,amount_cents,concept,created_at) VALUES
            (1,'egreso',500000,'Compra de mercaderia en efectivo',datetime('now','localtime','-2 days','+14 hours')),
            (1,'ingreso',200000,'Ingreso de cambio',datetime('now','localtime','-2 days','+16 hours'));
    "#)?;

    // Sesion de caja cerrada - ayer (usuario 3 = Sofia Ramirez)
    conn.execute(
        "INSERT INTO cash_sessions (opened_at,closed_at,opening_cents,closing_cents,notes,user_id) VALUES (datetime('now','localtime','-1 days','+8 hours'),datetime('now','localtime','-1 days','+21 hours'),800000,5100000,'Buen dia de ventas',3)",
        [],
    )?;
    conn.execute_batch(r#"
        INSERT INTO cash_movements (session_id,movement_type,amount_cents,concept,created_at) VALUES
            (2,'egreso',300000,'Pago de gas',datetime('now','localtime','-1 days','+10 hours')),
            (2,'egreso',150000,'Gastos varios',datetime('now','localtime','-1 days','+15 hours')),
            (2,'ingreso',100000,'Vuelto de compra',datetime('now','localtime','-1 days','+18 hours'));
    "#)?;

    // Ventas con items y user_id para que los reportes funcionen
    // Precios de referencia: Coca500=150k, Agua=120k, Sprite=140k, Fanta=140k, Coca1.5L=290k,
    //   Marlboro=580k, Lucky=560k, Camel=570k, Pan=320k, Medialunas=280k,
    //   Oreo=240k, Milka=180k, Chiclets=40k, Alfajor=380k, Sugus=60k,
    //   Papas=210k, Mani=150k, Palitos=160k, Leche=280k, Yogur=180k,
    //   Detergente=420k, Jabon=180k, Revista=150k, Diario=60k

    // Dia -6
    ins_sale(conn,270000,0,300000,30000,"efectivo",None,Some(2),-6,9,
        &[(1,"Coca Cola 500ml",150000,1),(2,"Agua Mineral Villa 500ml",120000,1)])?;
    ins_sale(conn,580000,0,580000,0,"debito",None,Some(2),-6,10,
        &[(7,"Marlboro Box 20",580000,1)])?;
    ins_sale(conn,420000,0,420000,0,"qr",None,Some(3),-6,11,
        &[(12,"Galletitas Oreo 118g",240000,1),(13,"Chocolate Milka 100g",180000,1)])?;
    ins_sale(conn,290000,0,300000,10000,"efectivo",None,Some(3),-6,14,
        &[(5,"Coca Cola 1.5L",290000,1)])?;
    ins_sale(conn,590000,0,590000,0,"transferencia",None,Some(2),-6,16,
        &[(17,"Papas Lays 90g",210000,1),(15,"Alfajor Havanna",380000,1)])?;

    // Dia -5
    ins_sale(conn,560000,0,600000,40000,"efectivo",None,Some(2),-5,9,
        &[(8,"Lucky Strike 20",560000,1)])?;
    ins_sale(conn,420000,0,420000,0,"debito",None,Some(3),-5,10,
        &[(10,"Pan Lactal Bimbo 390g",320000,1),(14,"Chiclets Adams x12",40000,1),(16,"Caramelos Sugus x10",60000,1)])?;
    ins_sale(conn,280000,0,280000,0,"qr",Some(1),Some(2),-5,11,
        &[(20,"Leche La Serenisima 1L",280000,1)])?;
    ins_sale(conn,720000,0,720000,0,"credito",None,Some(2),-5,14,
        &[(9,"Camel Rojo 20",570000,1),(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,620000,0,620000,0,"cuenta_corriente",Some(1),Some(3),-5,16,
        &[(7,"Marlboro Box 20",580000,1),(14,"Chiclets Adams x12",40000,1)])?;

    // Dia -4
    ins_sale(conn,150000,0,200000,50000,"efectivo",None,Some(3),-4,9,
        &[(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,580000,0,580000,0,"debito",None,Some(2),-4,10,
        &[(7,"Marlboro Box 20",580000,1)])?;
    ins_sale(conn,540000,0,540000,0,"efectivo",None,Some(2),-4,11,
        &[(5,"Coca Cola 1.5L",290000,1),(17,"Papas Lays 90g",210000,1),(14,"Chiclets Adams x12",40000,1)])?;
    ins_sale(conn,760000,0,760000,0,"cuenta_corriente",Some(5),Some(3),-4,14,
        &[(7,"Marlboro Box 20",580000,1),(13,"Chocolate Milka 100g",180000,1)])?;
    ins_sale(conn,240000,0,240000,0,"qr",None,Some(3),-4,15,
        &[(12,"Galletitas Oreo 118g",240000,1)])?;
    ins_sale(conn,320000,0,350000,30000,"efectivo",None,Some(2),-4,17,
        &[(10,"Pan Lactal Bimbo 390g",320000,1)])?;

    // Dia -3
    ins_sale(conn,560000,0,600000,40000,"efectivo",None,Some(2),-3,9,
        &[(8,"Lucky Strike 20",560000,1)])?;
    ins_sale(conn,440000,0,440000,0,"debito",None,Some(3),-3,10,
        &[(3,"Sprite 500ml",140000,1),(12,"Galletitas Oreo 118g",240000,1),(16,"Caramelos Sugus x10",60000,1)])?;
    ins_sale(conn,570000,0,600000,30000,"efectivo",Some(2),Some(2),-3,11,
        &[(9,"Camel Rojo 20",570000,1)])?;
    ins_sale(conn,1140000,0,1140000,0,"cuenta_corriente",Some(5),Some(3),-3,14,
        &[(7,"Marlboro Box 20",580000,1),(8,"Lucky Strike 20",560000,1)])?;
    ins_sale(conn,380000,0,400000,20000,"efectivo",None,Some(3),-3,15,
        &[(15,"Alfajor Havanna",380000,1)])?;
    ins_sale(conn,290000,0,290000,0,"transferencia",None,Some(2),-3,17,
        &[(5,"Coca Cola 1.5L",290000,1)])?;

    // Dia -2
    ins_sale(conn,290000,0,300000,10000,"efectivo",None,Some(2),-2,9,
        &[(5,"Coca Cola 1.5L",290000,1)])?;
    ins_sale(conn,580000,0,580000,0,"debito",None,Some(2),-2,10,
        &[(7,"Marlboro Box 20",580000,1)])?;
    ins_sale(conn,350000,50000,300000,0,"efectivo",Some(1),Some(3),-2,11,
        &[(17,"Papas Lays 90g",210000,1),(13,"Chocolate Milka 100g",180000,1)])?;
    ins_sale(conn,280000,0,280000,0,"cuenta_corriente",Some(1),Some(3),-2,13,
        &[(20,"Leche La Serenisima 1L",280000,1)])?;
    ins_sale(conn,140000,0,200000,60000,"efectivo",None,Some(2),-2,14,
        &[(4,"Fanta Naranja 500ml",140000,1)])?;
    ins_sale(conn,720000,0,720000,0,"credito",None,Some(2),-2,15,
        &[(9,"Camel Rojo 20",570000,1),(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,380000,0,380000,0,"cuenta_corriente",Some(5),Some(3),-2,16,
        &[(15,"Alfajor Havanna",380000,1)])?;
    ins_sale(conn,150000,0,150000,0,"qr",None,Some(2),-2,17,
        &[(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,240000,0,240000,0,"debito",None,Some(3),-2,18,
        &[(12,"Galletitas Oreo 118g",240000,1)])?;
    ins_sale(conn,180000,0,200000,20000,"efectivo",None,Some(3),-2,19,
        &[(13,"Chocolate Milka 100g",180000,1)])?;

    // Dia -1 (con una venta anulada)
    ins_sale(conn,580000,0,600000,20000,"efectivo",None,Some(2),-1,9,
        &[(7,"Marlboro Box 20",580000,1)])?;
    ins_sale(conn,320000,0,320000,0,"debito",None,Some(3),-1,10,
        &[(10,"Pan Lactal Bimbo 390g",320000,1)])?;
    ins_sale(conn,1140000,0,1140000,0,"cuenta_corriente",Some(5),Some(2),-1,11,
        &[(7,"Marlboro Box 20",580000,1),(8,"Lucky Strike 20",560000,1)])?;
    ins_sale(conn,140000,0,140000,0,"qr",None,Some(3),-1,12,
        &[(4,"Fanta Naranja 500ml",140000,1)])?;
    ins_sale(conn,560000,0,600000,40000,"transferencia",Some(2),Some(2),-1,13,
        &[(8,"Lucky Strike 20",560000,1)])?;
    ins_sale(conn,210000,0,210000,0,"efectivo",None,Some(3),-1,14,
        &[(17,"Papas Lays 90g",210000,1)])?;
    ins_sale(conn,430000,30000,400000,0,"debito",None,Some(2),-1,15,
        &[(5,"Coca Cola 1.5L",290000,1),(13,"Chocolate Milka 100g",180000,1)])?;
    ins_sale(conn,150000,0,200000,50000,"efectivo",None,Some(3),-1,16,
        &[(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,240000,0,240000,0,"credito",None,Some(2),-1,17,
        &[(12,"Galletitas Oreo 118g",240000,1)])?;
    ins_sale(conn,320000,0,320000,0,"qr",None,Some(3),-1,18,
        &[(10,"Pan Lactal Bimbo 390g",320000,1)])?;
    ins_sale(conn,180000,0,180000,0,"efectivo",None,Some(2),-1,19,
        &[(13,"Chocolate Milka 100g",180000,1)])?;
    // Venta anulada para probar filtro de reportes
    conn.execute(
        "INSERT INTO sales (total_cents,discount_cents,paid_cents,change_cents,payment_method,user_id,notes,created_at) VALUES (560000,0,560000,0,'efectivo',2,'[ANULADA] Error de cobro',datetime('now','localtime','-1 days','+20 hours'))",
        [],
    )?;

    // Dia 0 (hoy)
    ins_sale(conn,290000,0,300000,10000,"efectivo",None,Some(2),0,9,
        &[(5,"Coca Cola 1.5L",290000,1)])?;
    ins_sale(conn,580000,0,580000,0,"debito",None,Some(2),0,10,
        &[(7,"Marlboro Box 20",580000,1)])?;
    ins_sale(conn,150000,0,150000,0,"qr",None,Some(3),0,11,
        &[(1,"Coca Cola 500ml",150000,1)])?;
    ins_sale(conn,1150000,0,1150000,0,"cuenta_corriente",Some(5),Some(3),0,12,
        &[(7,"Marlboro Box 20",580000,1),(9,"Camel Rojo 20",570000,1)])?;
    ins_sale(conn,320000,20000,300000,0,"efectivo",Some(3),Some(2),0,13,
        &[(10,"Pan Lactal Bimbo 390g",320000,1)])?;
    ins_sale(conn,140000,0,140000,0,"efectivo",None,Some(3),0,14,
        &[(4,"Fanta Naranja 500ml",140000,1)])?;
    ins_sale(conn,450000,0,450000,0,"transferencia",None,Some(2),0,15,
        &[(12,"Galletitas Oreo 118g",240000,1),(17,"Papas Lays 90g",210000,1)])?;
    ins_sale(conn,560000,0,560000,0,"debito",None,Some(3),0,16,
        &[(8,"Lucky Strike 20",560000,1)])?;

    // Movimientos de stock representativos
    conn.execute_batch(r#"
        INSERT INTO stock_movements (product_id,movement_type,qty_change,qty_before,qty_after,notes,created_at) VALUES
            (1,'compra',12,12,24,'Recepcion orden 1',datetime('now','localtime','-4 days','+10 hours')),
            (2,'compra',24,6,30,'Recepcion orden 1',datetime('now','localtime','-4 days','+10 hours')),
            (3,'compra',12,8,20,'Recepcion orden 1',datetime('now','localtime','-4 days','+10 hours')),
            (7,'compra',5,10,15,'Recepcion orden 2',datetime('now','localtime','-9 days','+9 hours')),
            (8,'compra',3,5,8,'Recepcion orden 2',datetime('now','localtime','-9 days','+9 hours')),
            (9,'compra',2,0,2,'Recepcion orden 2',datetime('now','localtime','-9 days','+9 hours')),
            (7,'ajuste',-2,17,15,'Ajuste por inventario',datetime('now','localtime','-3 days','+11 hours')),
            (14,'ajuste',3,5,8,'Ajuste manual stock bajo',datetime('now','localtime','-3 days','+11 hours')),
            (1,'venta',-6,24,18,'Ventas semana',datetime('now','localtime','-1 days','+20 hours')),
            (7,'venta',-5,15,10,'Ventas semana',datetime('now','localtime','-1 days','+20 hours')),
            (9,'ajuste',-1,2,1,'Producto danado',datetime('now','localtime','+8 hours'));
    "#)?;

    // Promociones activas y vencidas
    conn.execute_batch(r#"
        INSERT INTO promotions (name,promo_type,value,applies_to,target_id,target_name,active,starts_at,ends_at) VALUES
            ('Bebidas 10% off','pct',10.0,'category',NULL,'Bebidas',1,'2026-05-01','2026-05-31'),
            ('2x1 Chiclets','2x1',0.0,'product',14,'Chiclets Adams x12',1,'2026-05-20','2026-06-20'),
            ('15% Golosinas lunes','pct',15.0,'category',NULL,'Golosinas',0,'2026-05-01','2026-06-30'),
            ('Lucky Strike precio fijo $5000','fixed',500000.0,'product',8,'Lucky Strike 20',0,'2026-04-01','2026-04-30');
    "#)?;

    // Audit log con 15 entradas representativas
    conn.execute_batch(r#"
        INSERT INTO audit_log (user_id,action,entity,entity_id,detail,created_at) VALUES
            (1,'crear','producto',1,'Producto creado: Coca Cola 500ml',datetime('now','localtime','-15 days','+9 hours')),
            (1,'crear','producto',7,'Producto creado: Marlboro Box 20',datetime('now','localtime','-15 days','+9 hours')),
            (1,'crear','producto',10,'Producto creado: Pan Lactal Bimbo 390g',datetime('now','localtime','-15 days','+10 hours')),
            (1,'crear','producto',20,'Producto creado: Leche La Serenisima 1L',datetime('now','localtime','-14 days','+9 hours')),
            (2,'venta','venta',1,'Venta $2700 - efectivo',datetime('now','localtime','-6 days','+9 hours')),
            (3,'venta','venta',5,'Venta $5900 - transferencia',datetime('now','localtime','-6 days','+16 hours')),
            (2,'editar','producto',9,'Stock actualizado: Camel Rojo 20 - stock 5 -> 2',datetime('now','localtime','-5 days','+11 hours')),
            (3,'ajuste_stock','producto',7,'Ajuste de stock: Marlboro Box 20 de 17 a 15',datetime('now','localtime','-3 days','+11 hours')),
            (2,'abrir_caja','caja',1,'Apertura de caja con $10000 iniciales',datetime('now','localtime','-2 days','+9 hours')),
            (2,'venta','venta',11,'Venta $2800 - cuenta_corriente - cliente Ana Garcia',datetime('now','localtime','-2 days','+13 hours')),
            (2,'cerrar_caja','caja',1,'Cierre de caja. Total: $42500',datetime('now','localtime','-2 days','+20 hours')),
            (3,'abrir_caja','caja',2,'Apertura de caja con $8000 iniciales',datetime('now','localtime','-1 days','+8 hours')),
            (3,'anular','venta',NULL,'Venta anulada por error de cobro',datetime('now','localtime','-1 days','+20 hours')),
            (3,'cerrar_caja','caja',2,'Cierre de caja. Total: $51000',datetime('now','localtime','-1 days','+21 hours')),
            (2,'editar','producto',11,'Precio actualizado: Medialunas x6 $2500 -> $2800',datetime('now','localtime','+8 hours'));
    "#)?;

    println!("[punto-simple] datos de prueba cargados (productos, clientes, proveedores, ventas 7 dias, caja, auditoria)");
    Ok(())
}

fn seed_admin_user(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    // SHA256("admin") = 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
    conn.execute(
        "INSERT OR IGNORE INTO users (username, full_name, password_hash, role, active) VALUES ('admin', 'Administrador', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 1)",
        [],
    )?;
    println!("[punto-simple] usuario admin creado (contrasena: admin)");
    Ok(())
}
