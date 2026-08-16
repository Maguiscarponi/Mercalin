import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Sun, Moon, Sunset, RefreshCw, ShoppingCart, TrendingUp, TrendingDown, Minus,
  Trophy, Target, CalendarDays, CalendarRange, AlertTriangle, Clock, CreditCard,
  CheckCircle2, Sparkles, Package, Wallet, ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { centsToARS, dateToLocalISO } from "@/lib/format";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { AllInsightsModal, InsightRow, LEVEL_LABEL } from "@/components/InsightsPanel";
import { useInsightsStore } from "@/stores/insights";
import type { DashboardData, Insight, CriticalStockItem, ExpiringAlertItem, OverdueAccountItem } from "@/types";

type AlertEntry =
  | { kind: "stock"; item: CriticalStockItem }
  | { kind: "exp"; item: ExpiringAlertItem }
  | { kind: "cc"; item: OverdueAccountItem };

function alertRoute(entry: AlertEntry): string {
  return entry.kind === "stock" ? "/proveedores" : entry.kind === "exp" ? "/vencimientos" : "/clientes";
}

function alertKey(entry: AlertEntry): string {
  return entry.kind === "stock" ? `stock-${entry.item.product_id}`
       : entry.kind === "exp" ? `exp-${entry.item.product_id}`
       : `cc-${entry.item.client_id}`;
}

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
  if (isoDate === dateToLocalISO(today)) return "Hoy";
  if (isoDate === dateToLocalISO(yesterday)) return "Ayer";
  return DAY_NAMES[d.getDay()];
}

// Área + línea SVG hecha a mano (sin librería de gráficos) — viewBox fijo estirado
// al 100% del ancho del contenedor vía preserveAspectRatio="none". Los labels de
// día van en HTML aparte (no en el SVG) para que nunca se deformen con el estirado.
function TrendChart({ days, trendMax }: { days: Array<{ date: string; total_cents: number }>; trendMax: number }) {
  const W = 700, H = 130, padX = 14, padY = 14;
  const n = days.length;
  const stepX = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const points = days.map((d, i) => ({
    x: padX + i * stepX,
    y: H - padY - (trendMax > 0 ? (d.total_cents / trendMax) * (H - padY * 2) : 0),
    d,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - padY} L${points[0].x.toFixed(1)},${H - padY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-28">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#trendFill)" />
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => {
        const isToday = i === n - 1;
        return (
          <circle key={p.d.date} cx={p.x} cy={p.y} r={isToday ? 5 : 3.2} fill={isToday ? "#4f46e5" : "#fff"} stroke="#6366f1" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>{dayLabel(p.d.date)}: {centsToARS(p.d.total_cents)}</title>
          </circle>
        );
      })}
    </svg>
  );
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

function GreetingIcon({ className }: { className?: string }) {
  const h = new Date().getHours();
  if (h < 13) return <Sun className={className} />;
  if (h < 20) return <Sunset className={className} />;
  return <Moon className={className} />;
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

function AlertRow({ entry, onClick }: { entry: AlertEntry; onClick: () => void }) {
  const { kind, item } = entry;
  const Icon = kind === "stock" ? Package : kind === "exp" ? Clock : CreditCard;
  const iconColor = kind === "stock" ? "text-red-500" : kind === "exp" ? "text-amber-500" : "text-stone-500";
  const label = kind === "stock" ? "Stock crítico" : kind === "exp" ? "Vencimiento" : "CC vencida";
  const labelColor = kind === "stock" ? "text-red-600" : kind === "exp" ? "text-amber-600" : "text-stone-500";
  const detail =
    kind === "stock" ? `${item.stock} un · ${item.days_remaining.toFixed(1)} días restantes` :
    kind === "exp" ? `${item.stock} un · ${item.days_left} día${item.days_left !== 1 ? "s" : ""}` :
    `${centsToARS(item.balance_cents)} · ${item.days_absent} días ausente`;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 hover:bg-stone-100 transition-colors flex gap-2"
    >
      <Icon className={clsx("w-3.5 h-3.5 shrink-0 mt-0.5", iconColor)} />
      <div className="min-w-0">
        <div className={clsx("text-[10px] font-bold uppercase tracking-wide", labelColor)}>{label}</div>
        <div className="text-xs font-semibold text-stone-800 mt-0.5 truncate">{item.name}</div>
        <div className="text-[10px] text-stone-500 mt-0.5">{detail}</div>
      </div>
    </button>
  );
}

function AllAlertsModal({
  entries, totalAlerts, onClose, onNavigate,
}: {
  entries: AlertEntry[]; totalAlerts: number; onClose: () => void; onNavigate: (route: string) => void;
}) {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
          <h2 className="text-sm font-semibold text-stone-800">Todas las alertas ({totalAlerts})</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-1.5">
          {entries.map((entry) => (
            <AlertRow
              key={alertKey(entry)}
              entry={entry}
              onClick={() => { onNavigate(alertRoute(entry)); onClose(); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const insights = useInsightsStore((s) => s.insights);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [hasProducts, setHasProducts] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, , products] = await Promise.all([
        api.getDashboard(),
        useInsightsStore.getState().refresh(),
        api.listProducts(""),
      ]);
      setData(d);
      setHasProducts(products.length > 0);
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

  // Con pocas alertas se muestran todas igual; el resumen/expandir solo entra en
  // juego cuando hay demasiadas para que el Dashboard siga siendo un vistazo rápido.
  const ALERTS_PREVIEW = 3;
  const allAlertEntries: AlertEntry[] = [
    ...data.critical_stock.map((item) => ({ kind: "stock" as const, item })),
    ...data.expiring_soon.map((item) => ({ kind: "exp" as const, item })),
    ...data.overdue_accounts.map((item) => ({ kind: "cc" as const, item })),
  ];
  const alertsPreview = allAlertEntries.slice(0, ALERTS_PREVIEW);

  const INSIGHTS_PREVIEW = 5;
  const insightsPreview = activeInsights.slice(0, INSIGHTS_PREVIEW);
  const insightLevelCounts = activeInsights.reduce((acc, i) => {
    acc[i.level] = (acc[i.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const dailyGoalPct =
    data.daily_goal_cents > 0
      ? Math.min((data.today_total_cents / data.daily_goal_cents) * 100, 100)
      : 0;

  const weeklyGoalPct =
    data.weekly_goal_cents > 0
      ? Math.min((data.week_so_far_cents / data.weekly_goal_cents) * 100, 100)
      : 0;

  const monthlyGoalPct =
    data.monthly_goal_cents > 0
      ? Math.min((data.month_so_far_cents / data.monthly_goal_cents) * 100, 100)
      : 0;

  const yearlyGoalPct =
    data.yearly_goal_cents > 0
      ? Math.min((data.year_so_far_cents / data.yearly_goal_cents) * 100, 100)
      : 0;

  const anyGoalConfigured =
    data.daily_goal_cents > 0 || data.weekly_goal_cents > 0 ||
    data.monthly_goal_cents > 0 || data.yearly_goal_cents > 0;

  const goalRows: Array<{ key: string; icon: typeof Sun; label: string; pct: number; current: number; goal: number }> = [
    { key: "daily", icon: Sun, label: "Meta diaria", pct: dailyGoalPct, current: data.today_total_cents, goal: data.daily_goal_cents },
    { key: "weekly", icon: CalendarRange, label: "Meta semanal", pct: weeklyGoalPct, current: data.week_so_far_cents, goal: data.weekly_goal_cents },
    { key: "monthly", icon: CalendarDays, label: "Meta mensual", pct: monthlyGoalPct, current: data.month_so_far_cents, goal: data.monthly_goal_cents },
    { key: "yearly", icon: Trophy, label: "Meta anual", pct: yearlyGoalPct, current: data.year_so_far_cents, goal: data.yearly_goal_cents },
  ].filter((g) => g.goal > 0);

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
        <div className="flex items-center gap-2.5">
          <GreetingIcon className="w-4 h-4 text-stone-400" />
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
        </div>
        <div className="flex items-center gap-2">
          {totalAlerts > 0 && (
            <span className="flex items-center gap-1 bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" />
              {totalAlerts} alerta{totalAlerts !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-indigo-600 bg-stone-100 hover:bg-indigo-50 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button
            onClick={() => navigate("/caja")}
            className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            Ir a Caja
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <OnboardingChecklist
          hasProducts={hasProducts}
          hasSales={data.today_sales_count > 0 || data.month_so_far_cents > 0}
        />

        {/* ── Fila 1: métricas del día ─────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          {/* Ventas hoy */}
          <div className="bg-white rounded-xl border border-stone-200 p-4 col-span-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-2">
              <Wallet className="w-3.5 h-3.5 text-stone-400" />
              Ventas hoy
            </div>
            <div className="text-3xl font-extrabold text-stone-900 leading-none">
              {centsToARS(data.today_total_cents)}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {data.last_week_same_day_cents > 0 && (
                <span className={clsx("flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full", pctBg(data.vs_last_week_pct))}>
                  {data.vs_last_week_pct > 0 ? <TrendingUp className="w-3 h-3" /> : data.vs_last_week_pct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
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
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-3">
              <Package className="w-3.5 h-3.5 text-stone-400" />
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
                <div className="flex items-center gap-1 text-[10px] text-stone-400 uppercase tracking-wide">
                  <CreditCard className="w-3 h-3" />
                  Pago dominante
                </div>
                <div className="text-xs font-semibold text-stone-700 mt-0.5">
                  {METHOD_LABELS[data.dominant_payment] ?? data.dominant_payment}{" "}
                  <span className="text-stone-400 font-normal">
                    ({data.dominant_payment_pct.toFixed(0)}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Metas */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-3">
              <Target className="w-3.5 h-3.5 text-stone-400" />
              Metas
            </div>
            {anyGoalConfigured ? (
              <div className="space-y-2.5">
                {goalRows.map((g) => {
                  const Icon = g.icon;
                  return (
                    <div key={g.key}>
                      <div className="flex justify-between items-center text-[10px] text-stone-500 mb-1">
                        <span className="flex items-center gap-1"><Icon className="w-3 h-3 text-stone-400" />{g.label}</span>
                        <span className="font-semibold">{g.pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            "h-full rounded-full transition-all",
                            g.pct >= 100 ? "bg-emerald-500" : "bg-indigo-500"
                          )}
                          style={{ width: `${g.pct}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-stone-400 mt-0.5">
                        {centsToARS(g.current)} / {centsToARS(g.goal)}
                      </div>
                    </div>
                  );
                })}
                {data.month_projection_cents > 0 && data.monthly_goal_cents > 0 && (
                  <div className="pt-1.5 border-t border-stone-100">
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
                  onClick={() => navigate("/configuracion", { state: { tab: "finanzas" } })}
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
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-stone-400" />
              Tendencia últimos 7 días
            </div>
            {data.week_trend.length === 0 ? (
              <div className="text-sm text-stone-400 text-center py-6">Sin datos suficientes</div>
            ) : (
              (() => {
                const today = new Date();
                const days: Array<{ date: string; total_cents: number; sales_count: number }> = [];
                for (let i = 6; i >= 0; i--) {
                  const d = new Date(today);
                  d.setDate(today.getDate() - i);
                  const iso = dateToLocalISO(d);
                  const found = data.week_trend.find((t) => t.date === iso);
                  days.push(found ?? { date: iso, total_cents: 0, sales_count: 0 });
                }
                return (
                  <div>
                    <TrendChart days={days} trendMax={trendMax} />
                    <div className="flex justify-between mt-1 px-1">
                      {days.map((day, idx) => (
                        <span
                          key={day.date}
                          className={clsx("text-[10px]", idx === 6 ? "text-indigo-600 font-bold" : "text-stone-400")}
                        >
                          {dayLabel(day.date)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* Alertas urgentes */}
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
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
                <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-1" />
                <div className="text-xs text-stone-500">Todo en orden</div>
              </div>
            ) : (
              <div className="space-y-2">
                {alertsPreview.map((entry) => (
                  <AlertRow key={alertKey(entry)} entry={entry} onClick={() => navigate(alertRoute(entry))} />
                ))}
                {totalAlerts > ALERTS_PREVIEW && (
                  <button
                    onClick={() => setShowAllAlerts(true)}
                    className="w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 py-1.5"
                  >
                    Ver todas ({totalAlerts}) <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Consejo del Día (insights de Rust) ───────────────────────────── */}
        {activeInsights.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                <Sparkles className="w-3.5 h-3.5 text-stone-400" />
                Consejo del día
              </div>
              <div className="flex items-center gap-1.5">
                {(["urgente", "importante", "consejo", "info"] as const).map((lvl) =>
                  insightLevelCounts[lvl] ? (
                    <span
                      key={lvl}
                      className={clsx(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        lvl === "urgente" ? "bg-red-100 text-red-600" :
                        lvl === "importante" ? "bg-amber-100 text-amber-600" :
                        lvl === "consejo" ? "bg-indigo-100 text-indigo-600" : "bg-stone-100 text-stone-500"
                      )}
                    >
                      {insightLevelCounts[lvl]} {LEVEL_LABEL[lvl].toLowerCase()}
                    </span>
                  ) : null
                )}
              </div>
            </div>
            <div className="space-y-2 p-4">
              {insightsPreview.map((ins) => (
                <InsightRow key={ins.id} ins={ins} onNavigate={navigate} />
              ))}
              {activeInsights.length > INSIGHTS_PREVIEW && (
                <button
                  onClick={() => setShowAllInsights(true)}
                  className="w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 py-1.5"
                >
                  Ver los {activeInsights.length} consejos <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showAllAlerts && (
        <AllAlertsModal
          entries={allAlertEntries}
          totalAlerts={totalAlerts}
          onClose={() => setShowAllAlerts(false)}
          onNavigate={navigate}
        />
      )}
      {showAllInsights && (
        <AllInsightsModal
          insights={activeInsights}
          onClose={() => setShowAllInsights(false)}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
