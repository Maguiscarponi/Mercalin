import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api } from "@/lib/api";
import { centsToARS } from "@/lib/format";
import type { DashboardData, Insight } from "@/types";

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  qr: "QR / MP",
  transferencia: "Transferencia",
  fiado: "Fiado",
  cuenta_corriente: "Cta. Cte.",
  mixto: "Mixto",
};

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAY_NAMES_FULL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function dayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isoDate === today.toISOString().slice(0, 10)) return "Hoy";
  if (isoDate === yesterday.toISOString().slice(0, 10)) return "Ayer";
  return DAY_NAMES[d.getDay()];
}

function todayDayName(): string {
  return DAY_NAMES_FULL[new Date().getDay()];
}

function greetingTime(): string {
  const h = new Date().getHours();
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function pctColor(pct: number): string {
  if (pct > 5) return "text-emerald-600";
  if (pct < -5) return "text-red-600";
  return "text-stone-500";
}

function pctBg(pct: number): string {
  if (pct > 5) return "bg-emerald-50 text-emerald-700";
  if (pct < -5) return "bg-red-50 text-red-700";
  return "bg-stone-100 text-stone-600";
}

function pctArrow(pct: number): string {
  if (pct > 0) return "▲";
  if (pct < 0) return "▼";
  return "—";
}

// ─── Fallback de insights (mientras carga Rust) ────────────────────────────────

function buildInsights(d: DashboardData): Insight[] {
  const mk = (id: string, level: Insight["level"], message: string, detail?: string, action?: string, route?: string): Insight =>
    ({ id, category: "", level, message, detail: detail ?? null, action: action ?? null, route: route ?? null });

  const list: Insight[] = [];

  for (const item of d.critical_stock.slice(0, 2)) {
    list.push(mk(`cs_${item.product_id}`, "urgente",
      `${item.name} se agota en ~${item.days_remaining.toFixed(1)} días`,
      `${item.stock} unidades · velocidad: ${item.daily_velocity.toFixed(1)}/día`,
      "Ir a Proveedores", "/proveedores"));
  }
  for (const exp of d.expiring_soon.slice(0, 1)) {
    list.push(mk(`exp_${exp.product_id}`, exp.days_left <= 2 ? "urgente" : "importante",
      `${exp.name}: ${exp.stock} unidades vencen en ${exp.days_left} día${exp.days_left !== 1 ? "s" : ""}`,
      undefined, "Ver Vencimientos", "/vencimientos"));
  }
  for (const acc of d.overdue_accounts.slice(0, 1)) {
    list.push(mk(`cc_${acc.client_id}`, "importante",
      `${acc.name} debe ${centsToARS(acc.balance_cents)} hace ${acc.days_absent} días sin compras`,
      undefined, "Ver Clientes", "/clientes"));
  }
  if (d.last_week_same_day_cents > 0) {
    const pct = d.vs_last_week_pct;
    if (pct < -10)
      list.push(mk("ventas_bajo", "importante",
        `Llevás ${centsToARS(d.today_total_cents)} hoy, ${Math.abs(pct).toFixed(0)}% menos que el ${todayDayName()} pasado`));
    else if (pct > 10)
      list.push(mk("ventas_sobre", "info",
        `Llevás ${centsToARS(d.today_total_cents)} hoy, ${pct.toFixed(0)}% más que el ${todayDayName()} pasado`));
  }
  if (d.daily_goal_cents > 0 && d.today_total_cents < d.daily_goal_cents)
    list.push(mk("meta_dia", "consejo",
      `Vendé ${centsToARS(d.daily_goal_cents - d.today_total_cents)} más hoy para alcanzar tu meta diaria`));
  if (d.monthly_goal_cents > 0 && d.month_projection_cents > 0)
    list.push(mk("meta_mes", "info",
      `Proyección de cierre de mes: ${centsToARS(d.month_projection_cents)} (${((d.month_projection_cents / d.monthly_goal_cents) * 100).toFixed(0)}% de tu meta)`));

  return list.slice(0, 5);
}

const LEVEL_STYLE: Record<Insight["level"], string> = {
  urgente:   "border-l-4 border-red-500 bg-red-50",
  importante:"border-l-4 border-amber-400 bg-amber-50",
  consejo:   "border-l-4 border-indigo-400 bg-indigo-50",
  info:      "border-l-4 border-stone-300 bg-stone-50",
};

const LEVEL_DOT: Record<Insight["level"], string> = {
  urgente:   "bg-red-500",
  importante:"bg-amber-400",
  consejo:   "bg-indigo-500",
  info:      "bg-stone-400",
};

const LEVEL_LABEL: Record<Insight["level"], string> = {
  urgente:   "URGENTE",
  importante:"IMPORTANTE",
  consejo:   "CONSEJO",
  info:      "INFO",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, ins] = await Promise.all([
        api.getDashboard(),
        api.getInsights(),
      ]);
      setData(d);
      setInsights(ins);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("dashboard:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 text-sm">
        Cargando dashboard…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-red-500 text-sm">
        Error al cargar el dashboard.
      </div>
    );
  }

  // Insights vienen de Rust — fallback a los del frontend si aún no cargaron
  const activeInsights = insights.length > 0 ? insights : buildInsights(data);
  const totalAlerts =
    data.critical_stock.length + data.expiring_soon.length + data.overdue_accounts.length;

  const dailyGoalPct =
    data.daily_goal_cents > 0
      ? Math.min((data.today_total_cents / data.daily_goal_cents) * 100, 100)
      : 0;

  const monthlyGoalPct =
    data.monthly_goal_cents > 0
      ? Math.min((data.month_so_far_cents / data.monthly_goal_cents) * 100, 100)
      : 0;

  const trendMax = Math.max(...data.week_trend.map((t) => t.total_cents), 1);

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-stone-100">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <div className="text-sm font-semibold text-stone-800">
            {greetingTime()} · <span className="capitalize">{dateStr}</span>
          </div>
          {lastUpdate && (
            <div className="text-[11px] text-stone-400 mt-0.5">
              Actualizado{" "}
              {lastUpdate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalAlerts > 0 && (
            <span className="bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
              {totalAlerts} alerta{totalAlerts !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-stone-500 hover:text-indigo-600 bg-stone-100 hover:bg-indigo-50 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? "Actualizando…" : "↻ Actualizar"}
          </button>
          <button
            onClick={() => navigate("/caja")}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            Ir a Caja →
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ── Fila 1: métricas del día ─────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          {/* Ventas hoy */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-2">
              Ventas hoy
            </div>
            <div className="text-3xl font-extrabold text-stone-900 leading-none">
              {centsToARS(data.today_total_cents)}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {data.last_week_same_day_cents > 0 && (
                <span className={clsx("text-xs font-semibold px-2 py-0.5 rounded-full", pctBg(data.vs_last_week_pct))}>
                  {pctArrow(data.vs_last_week_pct)}{" "}
                  {Math.abs(data.vs_last_week_pct).toFixed(0)}% vs {todayDayName()} pasado
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-stone-100">
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">Transacciones</div>
                <div className="text-lg font-bold text-stone-800 mt-0.5">{data.today_sales_count}</div>
              </div>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">Ticket promedio</div>
                <div className="text-lg font-bold text-stone-800 mt-0.5">{centsToARS(data.today_avg_ticket_cents)}</div>
              </div>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">Ganancia bruta</div>
                <div className={clsx("text-lg font-bold mt-0.5", data.today_gross_profit_cents >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {centsToARS(data.today_gross_profit_cents)}
                </div>
              </div>
            </div>
          </div>

          {/* Top productos hoy */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-3">
              Top hoy
            </div>
            {data.top_today.length === 0 ? (
              <div className="text-sm text-stone-400 mt-6 text-center">Sin ventas aún</div>
            ) : (
              <div className="space-y-2.5">
                {data.top_today.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-stone-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-stone-800 truncate">{p.name}</div>
                      <div className="text-[10px] text-stone-400">
                        {p.qty % 1 === 0 ? p.qty.toFixed(0) : p.qty.toFixed(2)} un · {centsToARS(p.total_cents)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.dominant_payment && (
              <div className="mt-3 pt-3 border-t border-stone-100">
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">Pago dominante</div>
                <div className="text-xs font-semibold text-stone-700 mt-0.5">
                  {METHOD_LABELS[data.dominant_payment] ?? data.dominant_payment}{" "}
                  <span className="text-stone-400 font-normal">
                    ({data.dominant_payment_pct.toFixed(0)}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Meta del día */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-3">
              Metas
            </div>
            {data.daily_goal_cents > 0 ? (
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[10px] text-stone-500 mb-1">
                    <span>Meta diaria</span>
                    <span className="font-semibold">{dailyGoalPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all",
                        dailyGoalPct >= 100 ? "bg-emerald-500" : "bg-indigo-500"
                      )}
                      style={{ width: `${dailyGoalPct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-stone-400 mt-1">
                    {centsToARS(data.today_total_cents)} / {centsToARS(data.daily_goal_cents)}
                  </div>
                </div>
                {data.monthly_goal_cents > 0 && (
                  <div>
                    <div className="flex justify-between text-[10px] text-stone-500 mb-1">
                      <span>Meta mensual</span>
                      <span className="font-semibold">{monthlyGoalPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          "h-full rounded-full transition-all",
                          monthlyGoalPct >= 100 ? "bg-emerald-500" : "bg-indigo-400"
                        )}
                        style={{ width: `${monthlyGoalPct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-stone-400 mt-1">
                      {centsToARS(data.month_so_far_cents)} / {centsToARS(data.monthly_goal_cents)}
                    </div>
                  </div>
                )}
                {data.month_projection_cents > 0 && (
                  <div className="pt-1 border-t border-stone-100">
                    <div className="text-[10px] text-stone-400">Proyección de mes</div>
                    <div className="text-sm font-bold text-stone-800 mt-0.5">
                      {centsToARS(data.month_projection_cents)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center mt-4">
                <div className="text-xs text-stone-400">No hay metas configuradas</div>
                <button
                  onClick={() => navigate("/configuracion")}
                  className="mt-2 text-[11px] text-indigo-600 hover:underline"
                >
                  Configurar →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Fila 2: tendencia + alertas ──────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Tendencia 7 días */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-4">
              Tendencia últimos 7 días
            </div>
            {data.week_trend.length === 0 ? (
              <div className="text-sm text-stone-400 text-center py-6">Sin datos suficientes</div>
            ) : (
              <div className="flex items-end gap-2 h-24">
                {/* Rellenar días sin datos */}
                {(() => {
                  const today = new Date();
                  const days: Array<{ date: string; total_cents: number; sales_count: number }> = [];
                  for (let i = 6; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - i);
                    const iso = d.toISOString().slice(0, 10);
                    const found = data.week_trend.find((t) => t.date === iso);
                    days.push(found ?? { date: iso, total_cents: 0, sales_count: 0 });
                  }
                  return days.map((day, idx) => {
                    const heightPct = trendMax > 0 ? (day.total_cents / trendMax) * 100 : 0;
                    const isToday = idx === 6;
                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="relative w-full flex flex-col justify-end" style={{ height: "80px" }}>
                          <div
                            className={clsx(
                              "w-full rounded-t-sm transition-all",
                              isToday ? "bg-indigo-500" : "bg-stone-200 group-hover:bg-stone-300"
                            )}
                            style={{ height: `${Math.max(heightPct, day.total_cents > 0 ? 4 : 2)}%` }}
                          />
                          {day.total_cents > 0 && (
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-stone-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-white border border-stone-200 rounded px-1 shadow-sm">
                              {centsToARS(day.total_cents)}
                            </div>
                          )}
                        </div>
                        <div className={clsx("text-[10px]", isToday ? "text-indigo-600 font-bold" : "text-stone-400")}>
                          {dayLabel(day.date)}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Alertas urgentes */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Alertas
              </div>
              {totalAlerts > 0 && (
                <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {totalAlerts}
                </span>
              )}
            </div>

            {totalAlerts === 0 ? (
              <div className="text-center py-4">
                <div className="text-xl mb-1">✅</div>
                <div className="text-xs text-stone-500">Todo en orden</div>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.critical_stock.map((item) => (
                  <button
                    key={item.product_id}
                    onClick={() => navigate("/proveedores")}
                    className="w-full text-left rounded-lg bg-red-50 border border-red-100 px-3 py-2 hover:bg-red-100 transition-colors"
                  >
                    <div className="text-[10px] font-bold text-red-600 uppercase tracking-wide">
                      Stock crítico
                    </div>
                    <div className="text-xs font-semibold text-red-900 mt-0.5 truncate">{item.name}</div>
                    <div className="text-[10px] text-red-500 mt-0.5">
                      {item.stock} un · {item.days_remaining.toFixed(1)} días restantes
                    </div>
                  </button>
                ))}
                {data.expiring_soon.map((item) => (
                  <button
                    key={item.product_id}
                    onClick={() => navigate("/vencimientos")}
                    className="w-full text-left rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 hover:bg-amber-100 transition-colors"
                  >
                    <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">
                      Vencimiento
                    </div>
                    <div className="text-xs font-semibold text-amber-900 mt-0.5 truncate">{item.name}</div>
                    <div className="text-[10px] text-amber-500 mt-0.5">
                      {item.stock} un · {item.days_left} día{item.days_left !== 1 ? "s" : ""}
                    </div>
                  </button>
                ))}
                {data.overdue_accounts.map((acc) => (
                  <button
                    key={acc.client_id}
                    onClick={() => navigate("/clientes")}
                    className="w-full text-left rounded-lg bg-orange-50 border border-orange-100 px-3 py-2 hover:bg-orange-100 transition-colors"
                  >
                    <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">
                      CC vencida
                    </div>
                    <div className="text-xs font-semibold text-orange-900 mt-0.5 truncate">{acc.name}</div>
                    <div className="text-[10px] text-orange-500 mt-0.5">
                      {centsToARS(acc.balance_cents)} · {acc.days_absent} días ausente
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Consejo del Día (insights de Rust) ───────────────────────────── */}
        {activeInsights.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                ☀️ Consejo del día
              </div>
              <span className="text-[10px] text-stone-400">{activeInsights.length} alertas activas</span>
            </div>
            <div className="space-y-2">
              {activeInsights.slice(0, 8).map((ins) => {
                const msg = ins.message;
                const det = ins.detail;
                const act = ins.action;
                const route = ins.route;
                return (
                  <div
                    key={ins.id}
                    className={clsx("rounded-lg px-3 py-2.5 flex items-start gap-3", LEVEL_STYLE[ins.level as keyof typeof LEVEL_STYLE])}
                  >
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <div className={clsx("w-2 h-2 rounded-full shrink-0", LEVEL_DOT[ins.level as keyof typeof LEVEL_DOT])} />
                      <span className={clsx(
                        "text-[9px] font-bold tracking-widest",
                        ins.level === "urgente" ? "text-red-600" :
                        ins.level === "importante" ? "text-amber-600" :
                        ins.level === "consejo" ? "text-indigo-600" : "text-stone-500"
                      )}>
                        {LEVEL_LABEL[ins.level as keyof typeof LEVEL_LABEL]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-stone-800">{msg}</div>
                      {det && <div className="text-[10px] text-stone-500 mt-0.5">{det}</div>}
                    </div>
                    {route && act && (
                      <button
                        onClick={() => navigate(route)}
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0 mt-0.5"
                      >
                        {act} →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
