use crate::commands::{err, CmdResult};
use crate::models::{
    CriticalStockItem, DashboardData, DayTrend, ExpiringAlertItem, OverdueAccountItem,
    TopProductToday,
};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_dashboard(state: State<AppState>) -> CmdResult<DashboardData> {
    let conn = state.db.lock();

    // ── Hoy: ventas totales y cantidad ────────────────────────────────────────
    let (today_sales_count, today_total_cents): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(total_cents), 0)
             FROM sales
             WHERE date(created_at, 'localtime') = date('now', 'localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    // ── Ganancia bruta estimada hoy (desde sale_items) ─────────────────────
    let today_gross_profit_cents: i64 = conn
        .query_row(
            "SELECT CAST(COALESCE(SUM(
                 si.qty * (si.unit_price_cents * (1.0 - si.discount_pct / 100.0)
                           - COALESCE(p.cost_cents, 0.0))
             ), 0) AS INTEGER)
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             LEFT JOIN products p ON si.product_id = p.id
             WHERE date(s.created_at, 'localtime') = date('now', 'localtime')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let today_avg_ticket_cents = if today_sales_count > 0 {
        today_total_cents / today_sales_count
    } else {
        0
    };

    // ── Mismo día semana pasada ───────────────────────────────────────────────
    let last_week_same_day_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sales
             WHERE date(created_at, 'localtime') = date('now', 'localtime', '-7 days')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let vs_last_week_pct = if last_week_same_day_cents > 0 {
        ((today_total_cents - last_week_same_day_cents) as f64
            / last_week_same_day_cents as f64)
            * 100.0
    } else {
        0.0
    };

    // ── Tendencia últimos 7 días ──────────────────────────────────────────────
    let mut trend_stmt = conn
        .prepare(
            "SELECT date(created_at, 'localtime') as day,
                    COUNT(*) as cnt,
                    COALESCE(SUM(total_cents), 0) as total
             FROM sales
             WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
             GROUP BY day
             ORDER BY day",
        )
        .map_err(err)?;

    let week_trend: Vec<DayTrend> = trend_stmt
        .query_map([], |row| {
            Ok(DayTrend {
                date: row.get("day")?,
                sales_count: row.get("cnt")?,
                total_cents: row.get("total")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    // ── Top 3 productos hoy ───────────────────────────────────────────────────
    let mut top_stmt = conn
        .prepare(
            "SELECT si.product_id, si.name,
                    SUM(si.qty) as total_qty,
                    CAST(SUM(si.qty * si.unit_price_cents * (1.0 - si.discount_pct / 100.0)) AS INTEGER) as total_cents
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at, 'localtime') = date('now', 'localtime')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY si.product_id, si.name
             ORDER BY total_qty DESC
             LIMIT 3",
        )
        .map_err(err)?;

    let top_today: Vec<TopProductToday> = top_stmt
        .query_map([], |row| {
            Ok(TopProductToday {
                product_id: row.get("product_id")?,
                name: row.get("name")?,
                qty: row.get("total_qty")?,
                total_cents: row.get("total_cents")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    // ── Método de pago dominante hoy ──────────────────────────────────────────
    let (dominant_payment, dominant_payment_pct) = {
        let result = conn.query_row(
            "SELECT payment_method, SUM(total_cents) as total
             FROM sales
             WHERE date(created_at, 'localtime') = date('now', 'localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
             GROUP BY payment_method
             ORDER BY total DESC
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>("payment_method")?,
                    row.get::<_, i64>("total")?,
                ))
            },
        );
        match result {
            Ok((method, amount)) => {
                let pct = if today_total_cents > 0 {
                    (amount as f64 / today_total_cents as f64) * 100.0
                } else {
                    0.0
                };
                (method, pct)
            }
            Err(_) => (String::new(), 0.0),
        }
    };

    // ── Stock crítico: productos que se agotan en menos de 3 días ─────────────
    // Velocidad = unidades vendidas en últimos 30 días / 30
    // Se salta si el negocio apagó el seguimiento de stock — con stock sin
    // cargar/desactualizado este cálculo no dice nada real.
    let critical_stock: Vec<CriticalStockItem> = if !crate::db::stock_tracking_enabled(&conn) {
        Vec::new()
    } else {
        let mut critical_stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.stock,
                        COALESCE(SUM(si.qty), 0) / 30.0 as daily_velocity
                 FROM products p
                 LEFT JOIN sale_items si ON p.id = si.product_id
                 LEFT JOIN sales s ON si.sale_id = s.id
                     AND date(s.created_at, 'localtime') >= date('now', 'localtime', '-30 days')
                     AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
                 WHERE p.active = 1 AND p.stock > 0
                 GROUP BY p.id, p.name, p.stock
                 HAVING daily_velocity > 0.01
                    AND CAST(p.stock AS REAL) / daily_velocity < 3.0
                 ORDER BY CAST(p.stock AS REAL) / daily_velocity ASC
                 LIMIT 8",
            )
            .map_err(err)?;

        let items = critical_stmt
            .query_map([], |row| {
                let stock: f64 = row.get("stock")?;
                let velocity: f64 = row.get("daily_velocity")?;
                Ok(CriticalStockItem {
                    product_id: row.get("id")?,
                    name: row.get("name")?,
                    stock,
                    daily_velocity: (velocity * 10.0).round() / 10.0,
                    days_remaining: if velocity > 0.0 {
                        (stock / velocity * 10.0).round() / 10.0
                    } else {
                        0.0
                    },
                })
            })
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect();
        items
    };

    // ── Vencimientos próximos (≤ 7 días) ──────────────────────────────────────
    let mut exp_stmt = conn
        .prepare(
            "SELECT id, name, stock, expires_at,
                    CAST(julianday(date(expires_at)) - julianday(date('now', 'localtime')) AS INTEGER) as days_left
             FROM products
             WHERE active = 1 AND stock > 0 AND expires_at IS NOT NULL
               AND date(expires_at) <= date('now', 'localtime', '+7 days')
               AND date(expires_at) >= date('now', 'localtime')
             ORDER BY expires_at ASC
             LIMIT 5",
        )
        .map_err(err)?;

    let expiring_soon: Vec<ExpiringAlertItem> = exp_stmt
        .query_map([], |row| {
            Ok(ExpiringAlertItem {
                product_id: row.get("id")?,
                name: row.get("name")?,
                stock: row.get("stock")?,
                expires_at: row.get("expires_at")?,
                days_left: row.get("days_left")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    // ── Cuentas corrientes con deuda y sin compras en más de 20 días ──────────
    let mut oc_stmt = conn
        .prepare(
            "SELECT id, name, balance_cents, days_absent FROM (
                 SELECT c.id, c.name,
                        COALESCE(
                            (SELECT SUM(CASE WHEN ca.movement_type = 'cargo'
                                             THEN ca.amount_cents
                                             ELSE -ca.amount_cents END)
                             FROM client_account ca WHERE ca.client_id = c.id),
                            0
                        ) as balance_cents,
                        CAST(julianday('now', 'localtime') - julianday(
                            COALESCE(
                                (SELECT MAX(s2.created_at) FROM sales s2
                                 WHERE s2.client_id = c.id
                                   AND (s2.notes IS NULL OR s2.notes NOT LIKE '%[ANULADA]%')),
                                c.created_at
                            )
                        ) AS INTEGER) as days_absent
                 FROM clients c
                 WHERE c.active = 1
             ) t
             WHERE balance_cents > 0 AND days_absent > 20
             ORDER BY balance_cents DESC
             LIMIT 5",
        )
        .map_err(err)?;

    let overdue_accounts: Vec<OverdueAccountItem> = oc_stmt
        .query_map([], |row| {
            Ok(OverdueAccountItem {
                client_id: row.get("id")?,
                name: row.get("name")?,
                balance_cents: row.get("balance_cents")?,
                days_absent: row.get("days_absent")?,
            })
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .collect();

    // ── Metas configuradas ────────────────────────────────────────────────────
    let daily_goal_cents: i64 = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'daily_goal_cents'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let monthly_goal_cents: i64 = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'monthly_goal_cents'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let weekly_goal_cents: i64 = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'weekly_goal_cents'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let yearly_goal_cents: i64 = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'yearly_goal_cents'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // ── Ventas de la semana en curso (lunes a hoy) ────────────────────────────
    // SQLite no tiene modifier 'start of week' -- "-6 days" seguido de
    // "weekday 1" da el lunes de la semana actual sin importar qué día es hoy.
    let week_so_far_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sales
             WHERE date(created_at, 'localtime') >= date('now', 'localtime', '-6 days', 'weekday 1')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    // ── Ventas del año en curso ────────────────────────────────────────────────
    let year_so_far_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sales
             WHERE date(created_at, 'localtime') >= date('now', 'localtime', 'start of year')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    // ── Ventas del mes en curso ───────────────────────────────────────────────
    let month_so_far_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sales
             WHERE strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    // ── Proyección de cierre de mes ───────────────────────────────────────────
    let (elapsed_days, total_days_in_month): (i64, i64) = conn
        .query_row(
            "SELECT
                CAST(strftime('%d', 'now', 'localtime') AS INTEGER),
                CAST(strftime('%d', date('now', 'localtime', 'start of month', '+1 month', '-1 day')) AS INTEGER)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    let month_projection_cents = if elapsed_days > 0 {
        (month_so_far_cents as f64 / elapsed_days as f64 * total_days_in_month as f64).round()
            as i64
    } else {
        0
    };

    Ok(DashboardData {
        today_total_cents,
        today_sales_count,
        today_avg_ticket_cents,
        today_gross_profit_cents,
        last_week_same_day_cents,
        vs_last_week_pct,
        critical_stock,
        expiring_soon,
        overdue_accounts,
        week_trend,
        top_today,
        dominant_payment,
        dominant_payment_pct,
        daily_goal_cents,
        monthly_goal_cents,
        month_so_far_cents,
        month_projection_cents,
        weekly_goal_cents,
        week_so_far_cents,
        yearly_goal_cents,
        year_so_far_cents,
    })
}
