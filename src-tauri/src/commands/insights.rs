use crate::commands::{err, CmdResult};
use crate::models::Insight;
use crate::AppState;
use chrono::{Datelike, Timelike};
use rusqlite::params;
use tauri::State;

fn fmt_cents(cents: i64) -> String {
    let pesos = cents as f64 / 100.0;
    if pesos >= 1_000_000.0 {
        format!("${:.1}M", pesos / 1_000_000.0)
    } else if pesos >= 10_000.0 {
        format!("${:.0}K", pesos / 1_000.0)
    } else {
        format!("${:.0}", pesos)
    }
}

fn level_priority(level: &str) -> u8 {
    match level {
        "urgente"    => 0,
        "importante" => 1,
        "consejo"    => 2,
        _            => 3,
    }
}

fn argentina_season(month: u32) -> &'static str {
    match month {
        12 | 1 | 2 => "verano",
        3 | 4 | 5  => "otoño",
        6 | 7 | 8  => "invierno",
        _           => "primavera",
    }
}

macro_rules! push {
    ($vec:expr, $id:expr, $cat:expr, $level:expr, $msg:expr, $detail:expr, $action:expr, $route:expr) => {
        $vec.push(Insight {
            id: $id.to_string(),
            category: $cat.to_string(),
            level: $level.to_string(),
            message: $msg,
            detail: $detail,
            action: $action,
            route: $route,
        });
    };
}

#[tauri::command]
pub fn get_insights(state: State<AppState>) -> CmdResult<Vec<Insight>> {
    let conn = state.db.lock();
    let mut out: Vec<Insight> = Vec::new();

    let now = chrono::Local::now();
    let current_month = now.month();
    let current_dow = now.weekday().num_days_from_monday(); // 0=Lun, 6=Dom
    let tomorrow_dow = (current_dow + 1) % 7;

    // ── 1. Stock crítico: agotamiento en < 3 días ────────────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.stock, COALESCE(SUM(si.qty), 0) / 30.0 as vel
             FROM products p
             LEFT JOIN sale_items si ON p.id = si.product_id
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE p.active = 1 AND p.stock > 0
             GROUP BY p.id, p.name, p.stock
             HAVING vel > 0.05 AND CAST(p.stock AS REAL) / vel < 3.0
             ORDER BY CAST(p.stock AS REAL) / vel ASC
             LIMIT 3",
        ).map_err(err)?;
        let rows: Vec<(i64, String, i64, f64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        for (id, name, stock, vel) in rows {
            let days = stock as f64 / vel;
            push!(out,
                format!("stock_critico_{}", id), "Stock", "urgente",
                format!("{} se agota en ~{:.1} días al ritmo actual", name, days),
                Some(format!("{} unidades · velocidad: {:.1}/día · pedí hoy", stock, vel)),
                Some("Ver Proveedores".to_string()), Some("/proveedores".to_string())
            );
        }
    }

    // ── 2. Stock muerto: listar los productos específicos ────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT p.name, p.stock, p.stock * p.cost_cents as capital
             FROM products p
             WHERE p.active = 1 AND p.stock > 0
               AND p.id NOT IN (
                   SELECT DISTINCT si.product_id FROM sale_items si
                   JOIN sales s ON si.sale_id = s.id
                   WHERE date(s.created_at,'localtime') >= date('now','localtime','-30 days')
                     AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
                     AND si.product_id IS NOT NULL)
             ORDER BY capital DESC LIMIT 5",
        ).map_err(err)?;
        let rows: Vec<(String, i64, i64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            let total_capital: i64 = rows.iter().map(|(_, _, c)| c).sum();
            let names: Vec<String> = rows.iter().take(3).map(|(n, stock, _)| format!("{} ({} un.)", n, stock)).collect();
            let extra = if rows.len() > 3 { format!(" y {} más", rows.len() - 3) } else { String::new() };
            push!(out,
                "stock_muerto", "Stock", "importante",
                format!("{} inmovilizados en productos sin vender en 30 días", fmt_cents(total_capital)),
                Some(format!("{}{}", names.join(", "), extra)),
                Some("Ver Stock sin movimiento".to_string()), Some("/productos?tab=sin_movimiento".to_string())
            );
        }
    }

    // ── 3. Vencimientos urgentes ≤ 3 días ────────────────────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT name, stock,
                    CAST(julianday(date(expires_at)) - julianday(date('now','localtime')) AS INTEGER) as days_left
             FROM products
             WHERE active=1 AND stock>0 AND expires_at IS NOT NULL
               AND date(expires_at) <= date('now','localtime','+3 days')
               AND date(expires_at) >= date('now','localtime')
             ORDER BY days_left ASC LIMIT 3",
        ).map_err(err)?;
        let rows: Vec<(String, i64, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            let names: Vec<String> = rows.iter().map(|(n, s, d)| format!("{} ({} un, {} día{})", n, s, d, if *d!=1{"s"}else{""})).collect();
            push!(out,
                "vencimientos_urgentes", "Stock", "urgente",
                format!("{} producto{} vencen en los próximos 3 días", rows.len(), if rows.len()>1{"s"}else{""}),
                Some(names.join(" · ")),
                Some("Ver Vencimientos".to_string()), Some("/vencimientos".to_string())
            );
        }
    }

    // ── 4. Patrón mañana: qué se vende más ese día de la semana ─────────────
    // Compara ventas del día de mañana vs el día actual en los últimos 90 días
    {
        let dow_names = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
        let tomorrow_name = dow_names.get(tomorrow_dow as usize).unwrap_or(&"mañana");
        // SQLite %w: 0=domingo, 1=lunes ... 6=sábado
        // chrono weekday: 0=lun...6=dom → convertir a SQLite: (dow+1)%7
        let tomorrow_sqlite = (tomorrow_dow + 1) % 7;
        let today_sqlite = (current_dow + 1) % 7;

        let mut stmt = conn.prepare(
            "SELECT si.name,
                    SUM(CASE WHEN CAST(strftime('%w',s.created_at,'localtime') AS INTEGER) = ?1 THEN si.qty ELSE 0 END) / 12.0 as manana_avg,
                    SUM(CASE WHEN CAST(strftime('%w',s.created_at,'localtime') AS INTEGER) = ?2 THEN si.qty ELSE 0 END) / 12.0 as hoy_avg
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at,'localtime') >= date('now','localtime','-90 days')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY si.product_id, si.name
             HAVING manana_avg > 0.3 AND manana_avg > hoy_avg * 1.4
             ORDER BY (manana_avg - hoy_avg) DESC
             LIMIT 4",
        ).map_err(err)?;
        let rows: Vec<(String, f64)> = stmt.query_map(params![tomorrow_sqlite, today_sqlite], |r| {
            Ok((r.get::<_,String>(0)?, r.get::<_,f64>(1)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            let names: Vec<String> = rows.iter().map(|(n, _)| n.clone()).collect();
            push!(out,
                "patron_manana", "Ventas", "consejo",
                format!("Mañana es {}. Históricamente vendés más: {}", tomorrow_name, names.join(", ")),
                Some("Basado en tus ventas de los últimos 90 días — revisá que tenés stock suficiente".to_string()),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 5. Patrón de fin de semana (si es jueves/viernes) ───────────────────
    // current_dow: 0=Lun, 3=Jue, 4=Vie
    if current_dow == 3 || current_dow == 4 {
        let mut stmt = conn.prepare(
            "SELECT si.name,
                    SUM(CASE WHEN CAST(strftime('%w',s.created_at,'localtime') AS INTEGER) IN (0,6) THEN si.qty ELSE 0 END) as finde,
                    SUM(CASE WHEN CAST(strftime('%w',s.created_at,'localtime') AS INTEGER) NOT IN (0,6) THEN si.qty ELSE 0 END) / 5.0 * 2.0 as semana_equiv
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at,'localtime') >= date('now','localtime','-60 days')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY si.product_id, si.name
             HAVING finde > semana_equiv * 1.5 AND finde > 5
             ORDER BY (finde - semana_equiv) DESC
             LIMIT 4",
        ).map_err(err)?;
        let rows: Vec<String> = stmt.query_map([], |r| r.get::<_,String>(0))
            .map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            push!(out,
                "patron_finde", "Ventas", "consejo",
                format!("Se viene el fin de semana. Tus productos de mayor demanda los fines de semana: {}", rows.join(", ")),
                Some("Preparate con stock suficiente antes de que empiece el finde".to_string()),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 6. Patrón estacional (Argentina) ─────────────────────────────────────
    // Si hay datos del mismo mes en años anteriores, usarlos. Si no, usar mes actual.
    {
        let season = argentina_season(current_month);
        let season_months: Vec<i64> = match season {
            "verano"    => vec![12, 1, 2],
            "otoño"     => vec![3, 4, 5],
            "invierno"  => vec![6, 7, 8],
            _           => vec![9, 10, 11],
        };
        // Buscar los top 3 productos de esta estación excluendo el período actual
        let months_str: Vec<String> = season_months.iter().map(|m| format!("'{:02}'", m)).collect();
        let months_in = months_str.join(",");
        let sql = format!(
            "SELECT si.name, SUM(si.qty) as total_qty
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE strftime('%m', s.created_at, 'localtime') IN ({})
               AND date(s.created_at,'localtime') < date('now','localtime','-30 days')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY si.product_id, si.name
             ORDER BY total_qty DESC
             LIMIT 3",
            months_in
        );
        let mut stmt = conn.prepare(&sql).map_err(err)?;
        let rows: Vec<String> = stmt.query_map([], |r| r.get::<_,String>(0))
            .map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            push!(out,
                "patron_estacional", "Ventas", "info",
                format!("Estamos en {}. Tus productos más vendidos en esta estación: {}", season, rows.join(", ")),
                Some("Basado en tu historial — asegurate de tener buen stock de estos productos".to_string()),
                None, None
            );
        }
    }

    // ── 7. Momentum: producto con tendencia fuerte esta semana ───────────────
    {
        let mut stmt = conn.prepare(
            "SELECT si.name,
                    SUM(CASE WHEN date(s.created_at,'localtime') >= date('now','localtime','-7 days') THEN si.qty ELSE 0 END) as esta,
                    SUM(CASE WHEN date(s.created_at,'localtime') >= date('now','localtime','-14 days')
                              AND date(s.created_at,'localtime') < date('now','localtime','-7 days') THEN si.qty ELSE 0 END) as anterior
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at,'localtime') >= date('now','localtime','-14 days')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             GROUP BY si.product_id, si.name
             HAVING anterior > 0 AND esta > anterior * 1.5
             ORDER BY (esta - anterior) DESC LIMIT 1",
        ).map_err(err)?;
        if let Some((name, esta, anterior)) = stmt.query_row([], |r| {
            Ok((r.get::<_,String>(0)?, r.get::<_,f64>(1)?, r.get::<_,f64>(2)?))
        }).ok() {
            let pct = ((esta - anterior) / anterior * 100.0) as i64;
            push!(out,
                "momentum_producto", "Ventas", "consejo",
                format!("{} está en tendencia: +{}% en ventas esta semana vs la anterior", name, pct),
                Some(format!("{:.0} unidades esta semana · {:.0} la semana pasada — asegurate de tener stock", esta, anterior)),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 8. Sugerencia de stock mínimo desactualizado ─────────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT p.name, p.min_stock,
                    CAST(COALESCE(SUM(si.qty), 0) / 30.0 AS REAL) as vel
             FROM products p
             LEFT JOIN sale_items si ON p.id = si.product_id
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE p.active = 1 AND p.min_stock > 0
             GROUP BY p.id, p.name, p.min_stock
             HAVING vel > 0.1 AND ABS(CAST(vel * 3 AS INTEGER) - p.min_stock) > p.min_stock * 0.5
               AND CAST(vel * 3 AS INTEGER) > p.min_stock
             ORDER BY (CAST(vel * 3 AS INTEGER) - p.min_stock) DESC
             LIMIT 3",
        ).map_err(err)?;
        let rows: Vec<(String, i64, f64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            let names: Vec<String> = rows.iter().map(|(n, min, vel)| {
                let sugerido = (vel * 3.0) as i64;
                format!("{} (mínimo actual: {}, sugerido: {})", n, min, sugerido)
            }).collect();
            push!(out,
                "stock_minimo_bajo", "Stock", "importante",
                format!("{} producto{} tienen stock mínimo configurado por debajo de su velocidad real de venta",
                    rows.len(), if rows.len()>1{"s"}else{""}),
                Some(names.join(" · ")),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 9. Ventas de hoy vs promedio del día ─────────────────────────────────
    {
        let today_dow_sqlite = (current_dow + 1) % 7;
        let today_total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents),0) FROM sales
             WHERE date(created_at,'localtime')=date('now','localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [], |r| r.get(0)).unwrap_or(0);
        let avg: f64 = conn.query_row(
            "SELECT COALESCE(AVG(dt),0) FROM (
                 SELECT SUM(total_cents) as dt FROM sales
                 WHERE CAST(strftime('%w',created_at,'localtime') AS INTEGER)=?1
                   AND date(created_at,'localtime') < date('now','localtime')
                   AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
                 GROUP BY date(created_at,'localtime'))",
            params![today_dow_sqlite], |r| r.get(0)).unwrap_or(0.0);
        if avg > 0.0 {
            let pct = ((today_total as f64 - avg) / avg) * 100.0;
            let dow_names = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
            let day_name = dow_names.get(current_dow as usize).unwrap_or(&"hoy");
            if pct < -15.0 {
                push!(out,
                    "ventas_bajo_promedio", "Ventas", "importante",
                    format!("Llevás {} hoy, {:.0}% menos que tu promedio del {}", fmt_cents(today_total), pct.abs(), day_name),
                    Some(format!("Tu promedio del {} es {}", day_name, fmt_cents(avg as i64))),
                    None, None
                );
            } else if pct > 15.0 {
                push!(out,
                    "ventas_sobre_promedio", "Ventas", "info",
                    format!("Llevás {} hoy, {:.0}% más que tu promedio del {}", fmt_cents(today_total), pct, day_name),
                    None, None, None
                );
            }
        }
    }

    // ── 10. Proyección mes vs mes anterior ────────────────────────────────────
    {
        let this_month: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents),0) FROM sales
             WHERE strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m','now','localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [], |r| r.get(0)).unwrap_or(0);
        let last_month: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents),0) FROM sales
             WHERE strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m',date('now','localtime','-1 month'),'localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [], |r| r.get(0)).unwrap_or(0);
        let elapsed: i64 = conn.query_row(
            "SELECT CAST(strftime('%d','now','localtime') AS INTEGER)", [], |r| r.get(0)).unwrap_or(1);
        let days_in_month: i64 = conn.query_row(
            "SELECT CAST(strftime('%d',date('now','localtime','start of month','+1 month','-1 day')) AS INTEGER)",
            [], |r| r.get(0)).unwrap_or(30);
        if last_month > 0 && elapsed > 0 {
            let projected = (this_month as f64 / elapsed as f64 * days_in_month as f64) as i64;
            let pct = ((projected - last_month) as f64 / last_month as f64) * 100.0;
            if pct.abs() > 10.0 {
                let (level, arrow) = if pct < 0.0 { ("importante","↓") } else { ("info","↑") };
                push!(out,
                    "proyeccion_mes", "Ventas", level,
                    format!("Proyección del mes: {} ({} {:.0}% vs mes pasado)", fmt_cents(projected), arrow, pct.abs()),
                    Some(format!("Mes pasado: {}", fmt_cents(last_month))),
                    Some("Ver Reportes".to_string()), Some("/reportes".to_string())
                );
            }
        }
    }

    // ── 11. CC vencidas (deuda + ausentes 30+ días) ──────────────────────────
    {
        if let Ok((count, total)) = conn.query_row::<(i64, i64), _, _>(
            "SELECT COUNT(*), COALESCE(SUM(balance_cents),0) FROM (
                 SELECT c.id,
                     COALESCE((SELECT SUM(CASE WHEN ca.movement_type='cargo'
                                              THEN ca.amount_cents ELSE -ca.amount_cents END)
                                FROM client_account ca WHERE ca.client_id=c.id), 0) as balance_cents,
                     CAST(julianday('now','localtime') - julianday(
                         COALESCE((SELECT MAX(s2.created_at) FROM sales s2 WHERE s2.client_id=c.id
                                    AND (s2.notes IS NULL OR s2.notes NOT LIKE '%[ANULADA]%')),
                                  c.created_at)) AS INTEGER) as days_absent
                 FROM clients c WHERE c.active=1
             ) WHERE balance_cents > 0 AND days_absent > 30",
            [], |r| Ok((r.get(0)?, r.get(1)?))
        ) {
            if count > 0 {
                push!(out,
                    "cc_vencidas", "Clientes", "urgente",
                    format!("{} cliente{} deben {} total sin compras en 30+ días",
                        count, if count>1{"s"}else{""}, fmt_cents(total)),
                    None,
                    Some("Ver Clientes".to_string()), Some("/clientes".to_string())
                );
            }
        }
    }

    // ── 12. Margen negativo ──────────────────────────────────────────────────
    {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM products WHERE active=1 AND cost_cents > 0 AND cost_cents >= price_cents",
            [], |r| r.get(0)).unwrap_or(0);
        if count > 0 {
            push!(out,
                "margen_negativo", "Precios", "urgente",
                format!("{} producto{} tienen precio igual o menor al costo — perdés dinero en cada venta",
                    count, if count>1{"s"}else{""}),
                None,
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 13. Desajuste costo/precio post-compra ───────────────────────────────
    {
        let count: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT p.id) FROM products p
             JOIN purchase_items pi ON p.id = pi.product_id
             JOIN purchase_orders po ON pi.order_id = po.id
             WHERE po.status='recibido' AND po.received_at >= date('now','-60 days')
               AND pi.unit_cost_cents > p.cost_cents",
            [], |r| r.get(0)).unwrap_or(0);
        if count > 0 {
            push!(out,
                "costo_desajuste", "Precios", "importante",
                format!("{} producto{} tienen el costo mayor al registrado — revisá si actualizaste el precio",
                    count, if count>1{"s"}else{""}),
                Some("El proveedor cobró más que el costo actual del sistema".to_string()),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── 14. Recomprar próximos 7 días ─────────────────────────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT p.name, p.stock, COALESCE(SUM(si.qty),0)/30.0 as vel
             FROM products p
             LEFT JOIN sale_items si ON p.id = si.product_id
             LEFT JOIN sales s ON si.sale_id = s.id
                 AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
                 AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
             WHERE p.active=1 AND p.stock>0
             GROUP BY p.id, p.name, p.stock
             HAVING vel > 0.05 AND CAST(p.stock AS REAL)/vel BETWEEN 3.0 AND 7.0
             ORDER BY CAST(p.stock AS REAL)/vel ASC LIMIT 4",
        ).map_err(err)?;
        let rows: Vec<(String, i64, f64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        if !rows.is_empty() {
            let preview: Vec<String> = rows.iter().take(3).map(|(n, s, v)| {
                let days = *s as f64 / v;
                format!("{} (~{:.0}d)", n, days)
            }).collect();
            let extra = if rows.len() > 3 { format!(" y 1 más") } else { String::new() };
            push!(out,
                "recomprar_pronto", "Compras", "importante",
                format!("Necesitás recomprar: {}{}", preview.join(", "), extra),
                Some("Estos productos se agotan en 3-7 días al ritmo actual".to_string()),
                Some("Ver Proveedores".to_string()), Some("/proveedores".to_string())
            );
        }
    }

    // ── 15. Horario pico ─────────────────────────────────────────────────────
    {
        let mut stmt = conn.prepare(
            "SELECT CAST(strftime('%H',created_at,'localtime') AS INTEGER) as hr, COUNT(*) as cnt
             FROM sales
             WHERE date(created_at,'localtime') >= date('now','localtime','-30 days')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
             GROUP BY hr ORDER BY cnt DESC LIMIT 1",
        ).map_err(err)?;
        if let Some((hr, _)) = stmt.query_row([], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,i64>(1)?)))
            .ok() {
            push!(out,
                "horario_pico", "Operaciones", "info",
                format!("Tu horario pico es {:02}:00–{:02}:00 (últimos 30 días)", hr, hr + 1),
                Some("Asegurate de tener personal y stock suficiente en ese horario".to_string()),
                None, None
            );
        }
    }

    // ── 16. Metas ─────────────────────────────────────────────────────────────
    {
        let daily_goal: i64 = conn.query_row("SELECT value FROM config WHERE key='daily_goal_cents'",
            [], |r| r.get::<_,String>(0)).ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        let today_total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents),0) FROM sales
             WHERE date(created_at,'localtime')=date('now','localtime')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            [], |r| r.get(0)).unwrap_or(0);
        if daily_goal > 0 && today_total < daily_goal {
            let pct = (today_total as f64 / daily_goal as f64 * 100.0) as i64;
            push!(out,
                "meta_diaria", "Metas", "consejo",
                format!("Vendé {} más hoy para alcanzar tu meta diaria ({:.0}% alcanzado)",
                    fmt_cents(daily_goal - today_total), pct),
                None, None, None
            );
        }

        let monthly_goal: i64 = conn.query_row("SELECT value FROM config WHERE key='monthly_goal_cents'",
            [], |r| r.get::<_,String>(0)).ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        if monthly_goal > 0 {
            let month_so_far: i64 = conn.query_row(
                "SELECT COALESCE(SUM(total_cents),0) FROM sales
                 WHERE strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m','now','localtime')
                   AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
                [], |r| r.get(0)).unwrap_or(0);
            let elapsed: i64 = conn.query_row(
                "SELECT CAST(strftime('%d','now','localtime') AS INTEGER)", [], |r| r.get(0)).unwrap_or(1);
            let total_days: i64 = conn.query_row(
                "SELECT CAST(strftime('%d',date('now','localtime','start of month','+1 month','-1 day')) AS INTEGER)",
                [], |r| r.get(0)).unwrap_or(30);
            if elapsed > 0 {
                let projected = (month_so_far as f64 / elapsed as f64 * total_days as f64) as i64;
                let pct = (projected as f64 / monthly_goal as f64 * 100.0) as i64;
                push!(out,
                    "meta_mensual", "Metas", "consejo",
                    format!("Proyección de cierre de mes: {} ({}% de tu meta)", fmt_cents(projected), pct),
                    Some(format!("Meta mensual: {}", fmt_cents(monthly_goal))),
                    None, None
                );
            }
        }
    }

    // ── 17. Vencimientos en 4-7 días ─────────────────────────────────────────
    {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM products
             WHERE active=1 AND stock>0 AND expires_at IS NOT NULL
               AND date(expires_at) > date('now','localtime','+3 days')
               AND date(expires_at) <= date('now','localtime','+7 days')",
            [], |r| r.get(0)).unwrap_or(0);
        if count > 0 {
            push!(out,
                "vencimientos_proximos", "Stock", "importante",
                format!("{} producto{} vencen entre 4 y 7 días — actuá antes que sea urgente",
                    count, if count>1{"s"}else{""}),
                None,
                Some("Ver Vencimientos".to_string()), Some("/vencimientos".to_string())
            );
        }
    }

    let current_hour = now.hour();

    // ── A. Co-ventas: producto top de hoy + compañeros con stock bajo ─────────
    // Si hoy se vende mucho X, y Y siempre acompaña a X en las compras,
    // y Y tiene stock bajo → alertar.
    {
        // Paso 1: producto más vendido hoy
        let top_today = conn.query_row(
            "SELECT si.product_id, si.name FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE date(s.created_at,'localtime') = date('now','localtime')
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
               AND si.product_id IS NOT NULL
             GROUP BY si.product_id, si.name
             ORDER BY SUM(si.qty) DESC LIMIT 1",
            [], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?))
        ).ok();

        if let Some((top_id, top_name)) = top_today {
            // Paso 2: compañeros frecuentes de ese producto con stock bajo/crítico
            let mut stmt = conn.prepare(
                "SELECT si2.name, COUNT(*) as co_count, p2.stock, p2.min_stock
                 FROM sale_items si1
                 JOIN sale_items si2 ON si1.sale_id = si2.sale_id AND si1.product_id != si2.product_id
                 JOIN products p2 ON si2.product_id = p2.id
                 JOIN sales s ON si1.sale_id = s.id
                 WHERE si1.product_id = ?1
                   AND date(s.created_at,'localtime') >= date('now','localtime','-90 days')
                   AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
                   AND p2.active = 1 AND p2.stock <= p2.min_stock
                 GROUP BY si2.product_id, si2.name, p2.stock, p2.min_stock
                 HAVING co_count >= 3
                 ORDER BY co_count DESC LIMIT 3",
            ).map_err(err)?;
            let companions: Vec<(String, i64, i64)> = stmt.query_map(params![top_id], |r| {
                Ok((r.get::<_,String>(0)?, r.get::<_,i64>(2)?, r.get::<_,i64>(3)?))
            }).map_err(err)?.filter_map(|r| r.ok()).collect();
            if !companions.is_empty() {
                let names: Vec<String> = companions.iter().map(|(n, s, _)| format!("{} ({} un.)", n, s)).collect();
                push!(out,
                    "co_ventas", "Stock", "importante",
                    format!("Hoy se está vendiendo bien {}. Sus productos complementarios tienen stock bajo: {}", top_name, names.join(", ")),
                    Some("Estos productos suelen comprarse juntos — revisá el stock antes de que empiece la demanda".to_string()),
                    Some("Ver Productos".to_string()), Some("/productos".to_string())
                );
            }
        }
    }

    // ── B. Ciclos de compra por proveedor ─────────────────────────────────────
    // Si el intervalo habitual entre pedidos al proveedor X es N días
    // y ya pasaron más de N días desde el último pedido → alertar.
    {
        let mut stmt = conn.prepare(
            "SELECT s.name, s.id,
                    MAX(po.ordered_at) as last_order,
                    CAST(julianday('now','localtime') - julianday(MAX(po.ordered_at)) AS INTEGER) as days_since,
                    CAST((julianday(MAX(po.ordered_at)) - julianday(MIN(po.ordered_at))) / NULLIF(COUNT(*) - 1, 0) AS INTEGER) as avg_interval
             FROM purchase_orders po
             JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.ordered_at >= date('now','-180 days')
               AND po.status != 'cancelado'
             GROUP BY po.supplier_id, s.name, s.id
             HAVING COUNT(*) >= 2 AND avg_interval IS NOT NULL AND avg_interval > 0
               AND days_since > avg_interval * 1.3",
        ).map_err(err)?;
        let rows: Vec<(String, i64, i64)> = stmt.query_map([], |r| {
            Ok((r.get::<_,String>(0)?, r.get::<_,i64>(3)?, r.get::<_,i64>(4)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        for (supplier, days_since, avg_interval) in rows.into_iter().take(2) {
            push!(out,
                format!("ciclo_compra_{}", supplier.replace(' ', "_").to_lowercase()), "Compras", "importante",
                format!("Debería ser hora de pedir a {}. Tu intervalo habitual es cada {} días y ya pasaron {}", supplier, avg_interval, days_since),
                Some("Basado en tu historial de pedidos — generá la orden antes de que se agote el stock".to_string()),
                Some("Ver Proveedores".to_string()), Some("/proveedores".to_string())
            );
        }
    }

    // ── C. Pre-pico horario ───────────────────────────────────────────────────
    // Si estamos a 30-60 min antes de la hora pico, mostrar los productos
    // top de esa hora para que el dueño se prepare.
    {
        // Encontrar hora pico
        let peak_hour: Option<i64> = conn.query_row(
            "SELECT CAST(strftime('%H',created_at,'localtime') AS INTEGER) as hr
             FROM sales
             WHERE date(created_at,'localtime') >= date('now','localtime','-30 days')
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
             GROUP BY hr ORDER BY COUNT(*) DESC LIMIT 1",
            [], |r| r.get(0)
        ).ok();

        if let Some(peak) = peak_hour {
            let current_h = current_hour as i64;
            // Activar si estamos en la hora anterior al pico
            if current_h == peak - 1 || (peak == 0 && current_h == 23) {
                let mut stmt = conn.prepare(
                    "SELECT si.name, SUM(si.qty) as qty
                     FROM sale_items si
                     JOIN sales s ON si.sale_id = s.id
                     WHERE CAST(strftime('%H',s.created_at,'localtime') AS INTEGER) = ?1
                       AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
                       AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
                     GROUP BY si.product_id, si.name
                     ORDER BY qty DESC LIMIT 4",
                ).map_err(err)?;
                let top: Vec<String> = stmt.query_map(params![peak], |r| r.get::<_,String>(0))
                    .map_err(err)?.filter_map(|r| r.ok()).collect();
                if !top.is_empty() {
                    push!(out,
                        "pre_pico", "Operaciones", "consejo",
                        format!("En menos de 1 hora empieza tu pico de ventas ({:02}:00). Preparate con: {}", peak, top.join(", ")),
                        Some("Estos productos concentran la mayor demanda en ese horario".to_string()),
                        None, None
                    );
                }
            }
        }
    }

    // ── D. Sugerencia de precio post-inflación de costos ──────────────────────
    // Si el proveedor cobró más que el costo registrado,
    // calcular qué precio debería tener el producto para mantener el margen actual.
    {
        let mut stmt = conn.prepare(
            "SELECT p.name, p.cost_cents, p.price_cents, MAX(pi.unit_cost_cents) as new_cost
             FROM products p
             JOIN purchase_items pi ON p.id = pi.product_id
             JOIN purchase_orders po ON pi.order_id = po.id
             WHERE po.status = 'recibido'
               AND po.received_at >= date('now','-60 days')
               AND pi.unit_cost_cents > p.cost_cents
               AND p.price_cents > 0 AND p.cost_cents > 0
             GROUP BY p.id, p.name, p.cost_cents, p.price_cents
             ORDER BY (MAX(pi.unit_cost_cents) - p.cost_cents) DESC
             LIMIT 3",
        ).map_err(err)?;
        let rows: Vec<(String, i64, i64, i64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).map_err(err)?.filter_map(|r| r.ok()).collect();
        for (name, old_cost, price, new_cost) in rows {
            // Margen actual = (precio - costo_viejo) / precio
            let current_margin = (price - old_cost) as f64 / price as f64;
            // Precio sugerido para mantener ese margen con el nuevo costo
            let suggested_price = if current_margin < 1.0 && current_margin > 0.0 {
                (new_cost as f64 / (1.0 - current_margin)).round() as i64
            } else {
                (new_cost as f64 * 1.3).round() as i64
            };
            push!(out,
                format!("precio_sugerido_{}", name.replace(' ',"_").to_lowercase().chars().take(20).collect::<String>()), "Precios", "importante",
                format!("El costo de {} subió a {}. Para mantener tu margen, el precio debería ser {} (ahora tenés {})",
                    name, fmt_cents(new_cost), fmt_cents(suggested_price), fmt_cents(price)),
                Some(format!("Margen actual calculado sobre costo anterior: {:.0}%", current_margin * 100.0)),
                Some("Ver Productos".to_string()), Some("/productos".to_string())
            );
        }
    }

    // ── E. Productos sin stock sin pedido (posibles descontinuados) ───────────
    // Producto que solía venderse bien, ahora tiene stock 0
    // y no tiene ninguna orden de compra en los últimos 60 días.
    {
        let mut stmt = conn.prepare(
            "SELECT p.name,
                    CAST(julianday('now','localtime') - julianday(MAX(s.created_at)) AS INTEGER) as days_since
             FROM products p
             JOIN sale_items si ON p.id = si.product_id
             JOIN sales s ON si.sale_id = s.id
             WHERE p.active = 1 AND p.stock = 0
               AND (s.notes IS NULL OR s.notes NOT LIKE '%[ANULADA]%')
               AND p.id NOT IN (
                   SELECT DISTINCT pi.product_id FROM purchase_items pi
                   JOIN purchase_orders po ON pi.order_id = po.id
                   WHERE po.ordered_at >= date('now','-60 days')
                     AND pi.product_id IS NOT NULL
               )
             GROUP BY p.id, p.name
             HAVING COUNT(DISTINCT s.id) >= 5 AND days_since >= 20 AND days_since <= 180
             ORDER BY days_since DESC
             LIMIT 3",
        ).map_err(err)?;
        let rows: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?.filter_map(|r| r.ok()).collect();
        for (name, days) in rows {
            push!(out,
                format!("sin_stock_sin_pedido_{}", name.replace(' ',"_").to_lowercase().chars().take(20).collect::<String>()), "Stock", "consejo",
                format!("{} lleva {} días sin stock y sin pedido — ¿lo discontinuaste o se te pasó reponer?", name, days),
                Some("Solía venderse bien. Si todavía querés venderlo, generá una orden de compra".to_string()),
                Some("Ver Proveedores".to_string()), Some("/proveedores".to_string())
            );
        }
    }

    // ── Anomalía intra-día ───────────────────────────────────────────────────────
    // Compara ventas acumuladas hasta la hora actual vs promedio histórico a esa
    // misma hora del mismo día de la semana (últimas 4 semanas, mínimo 2 datos).
    {
        let hour = current_hour;
        // Ventas acumuladas hoy hasta la hora actual
        let today_so_far: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_cents),0) FROM sales
             WHERE date(created_at,'localtime') = date('now','localtime')
               AND strftime('%H', created_at,'localtime') <= ?1
               AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')",
            params![format!("{:02}", hour)],
            |r| r.get(0),
        ).unwrap_or(0);

        // Promedio histórico acumulado a esta misma hora los mismos días de semana
        // (últimas 4 semanas, excluye hoy)
        let today_dow_sqlite = (current_dow + 1) % 7; // SQLite: 0=Dom, 1=Lun...
        struct HourAvg { avg: f64, count: i64 }
        let hist: Option<HourAvg> = conn.query_row(
            "SELECT AVG(day_total), COUNT(*) FROM (
                 SELECT date(created_at,'localtime') as day,
                        SUM(total_cents) as day_total
                 FROM sales
                 WHERE strftime('%w', created_at,'localtime') = ?1
                   AND strftime('%H', created_at,'localtime') <= ?2
                   AND date(created_at,'localtime') >= date('now','localtime','-28 days')
                   AND date(created_at,'localtime') < date('now','localtime')
                   AND (notes IS NULL OR notes NOT LIKE '%[ANULADA]%')
                 GROUP BY day
             )",
            params![today_dow_sqlite.to_string(), format!("{:02}", hour)],
            |r| Ok(HourAvg { avg: r.get::<_,f64>(0).unwrap_or(0.0), count: r.get::<_,i64>(1).unwrap_or(0) }),
        ).ok();

        if let Some(h) = hist {
            if h.count >= 2 && h.avg > 100_000.0 {
                let ratio = today_so_far as f64 / h.avg;
                if ratio < 0.55 {
                    push!(out,
                        "anomalia_baja", "Ventas", "importante",
                        format!("Son las {:02}:00 h — llevás {} ({:.0}% del promedio histórico a esta hora)",
                            hour, fmt_cents(today_so_far), ratio * 100.0),
                        Some(format!("Promedio histórico a las {:02}:00 h los {}: {}",
                            hour,
                            ["domingos","lunes","martes","miércoles","jueves","viernes","sábados"].get(current_dow as usize).unwrap_or(&"este día"),
                            fmt_cents(h.avg as i64))),
                        None, Some("/dashboard".to_string())
                    );
                } else if ratio > 1.6 {
                    push!(out,
                        "anomalia_alta", "Ventas", "info",
                        format!("Ritmo excepcional: llevás {} a las {:02}:00 h ({:.0}% sobre el promedio histórico)",
                            fmt_cents(today_so_far), hour, (ratio - 1.0) * 100.0),
                        None, None, Some("/dashboard".to_string())
                    );
                }
            }
        }
    }

    // Ordenar: urgente → importante → consejo → info
    out.sort_by_key(|i| level_priority(&i.level));
    Ok(out)
}
