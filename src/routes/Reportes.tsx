import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { centsToARS, formatDateTime, todayISO } from "@/lib/format";
import type { DailyReport, IvaReportItem, MarginCategory, MarginProduct, Product, ProductAffinity, ReorderItem, Sale, SaleWithItems, SalesByUser, TopProduct } from "@/types";
import { markReportesVisited } from "@/components/OnboardingChecklist";
import { confirmAction, showToast } from "@/stores/dialogs";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import { exportStyledExcel, CURRENCY_FMT, INT_FMT, PCT_FMT, type ExcelSheet } from "@/lib/excelExport";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  qr: "QR / MP",
  transferencia: "Transferencia",
  fiado: "Fiado",
  cuenta_corriente: "Cta. Cte.",
  mixto: "Pago mixto",
};

type Tab = "resumen" | "ventas" | "margenes" | "stock" | "reposicion" | "libro_iva" | "afinidad";

type Period = "hoy" | "ayer" | "semana" | "mes" | "personalizado";

function getRange(period: Period, customFrom: string, customTo: string): [string, string] {
  const today = todayISO();
  const d = (offset: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
  };
  switch (period) {
    case "hoy":         return [today, today];
    case "ayer":        return [d(-1), d(-1)];
    case "semana":      return [d(-6), today];
    case "mes":         return [today.slice(0, 7) + "-01", today];
    case "personalizado": return [customFrom || today, customTo || today];
  }
}

export default function Reportes() {
  useEffect(() => { markReportesVisited(); }, []);
  const [tab, setTab] = useState<Tab>("resumen");
  const [period, setPeriod] = useState<Period>("hoy");
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo]   = useState(todayISO());
  const [report, setReport]       = useState<DailyReport | null>(null);
  const [prevReport, setPrevReport] = useState<DailyReport | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [byCategory, setByCategory]   = useState<[string, number][]>([]);
  const [byUser, setByUser]           = useState<SalesByUser[]>([]);
  const [sales, setSales]   = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailSale, setDetailSale] = useState<SaleWithItems | null>(null);
  const [marginProducts, setMarginProducts] = useState<MarginProduct[]>([]);
  const [marginCategories, setMarginCategories] = useState<MarginCategory[]>([]);
  const [loadingMargins, setLoadingMargins] = useState(false);
  const [salesFilter, setSalesFilter] = useState("");
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [reorderItems, setReorderItems] = useState<ReorderItem[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [ivaItems, setIvaItems] = useState<IvaReportItem[]>([]);
  const [loadingIva, setLoadingIva] = useState(false);
  const [affinityItems, setAffinityItems] = useState<ProductAffinity[]>([]);
  const [loadingAffinity, setLoadingAffinity] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingIva, setExportingIva] = useState(false);

  const [fromDate, toDate] = getRange(period, customFrom, customTo);

  function getPrevRange(period: Period, from: string, to: string): [string, string] {
    const d = (iso: string, offset: number) => {
      const dt = new Date(iso);
      dt.setDate(dt.getDate() + offset);
      return dt.toISOString().slice(0, 10);
    };
    switch (period) {
      case "hoy":    return [d(from, -1), d(to, -1)];
      case "ayer":   return [d(from, -1), d(to, -1)];
      case "semana": return [d(from, -7), d(to, -7)];
      case "mes": {
        const [y, m] = from.split("-").map(Number);
        const prevMonth = m === 1 ? 12 : m - 1;
        const prevYear  = m === 1 ? y - 1 : y;
        const lastDay   = new Date(prevYear, prevMonth, 0).getDate();
        return [`${prevYear}-${String(prevMonth).padStart(2,"0")}-01`,
                `${prevYear}-${String(prevMonth).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`];
      }
      default: {
        const diffDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
        return [d(from, -diffDays), d(to, -diffDays)];
      }
    }
  }

  async function load() {
    setLoading(true);
    const [prevFrom, prevTo] = getPrevRange(period, fromDate, toDate);
    const [r, prev, top, cat, s, u] = await Promise.allSettled([
      api.rangeReport(fromDate, toDate),
      api.rangeReport(prevFrom, prevTo),
      api.topProducts(fromDate, toDate, 10),
      api.salesByCategory(fromDate, toDate),
      api.listSalesRange(fromDate, toDate, 500),
      api.salesByUser(fromDate, toDate),
    ]);
    if (r.status === "fulfilled") setReport(r.value);
    else { console.error("rangeReport:", r.reason); setReport(null); }
    if (prev.status === "fulfilled") setPrevReport(prev.value);
    else setPrevReport(null);
    if (top.status === "fulfilled") setTopProducts(top.value);
    else console.error("topProducts:", top.reason);
    if (cat.status === "fulfilled") setByCategory(cat.value);
    else console.error("salesByCategory:", cat.reason);
    if (s.status === "fulfilled") setSales(s.value);
    else console.error("listSalesRange:", s.reason);
    if (u.status === "fulfilled") setByUser(u.value);
    else console.error("salesByUser:", u.reason);
    setLoading(false);
  }

  useEffect(() => { load(); }, [fromDate, toDate]); // eslint-disable-line

  useEffect(() => {
    if (tab !== "margenes") return;
    setLoadingMargins(true);
    Promise.all([
      api.marginReport(fromDate, toDate),
      api.marginByCategory(fromDate, toDate),
    ]).then(([prods, cats]) => {
      setMarginProducts(prods);
      setMarginCategories(cats);
    }).catch(console.error).finally(() => setLoadingMargins(false));
  }, [tab, fromDate, toDate]); // eslint-disable-line

  useEffect(() => {
    if (tab !== "afinidad") return;
    if (affinityItems.length > 0) return;
    setLoadingAffinity(true);
    api.getProductAffinity()
      .then(setAffinityItems)
      .catch(console.error)
      .finally(() => setLoadingAffinity(false));
  }, [tab]); // eslint-disable-line

  useEffect(() => {
    if (tab !== "libro_iva") return;
    setLoadingIva(true);
    api.getIvaReport(fromDate, toDate)
      .then(setIvaItems)
      .catch(console.error)
      .finally(() => setLoadingIva(false));
  }, [tab, fromDate, toDate]); // eslint-disable-line

  useEffect(() => {
    if (tab !== "stock" && tab !== "reposicion") return;
    setLoadingStock(true);
    Promise.all([
      api.listProducts(""),
      api.reorderBySupplier(),
    ]).then(([prods, reorder]) => {
      setAllProducts(prods);
      setReorderItems(reorder);
    }).catch(console.error).finally(() => setLoadingStock(false));
  }, [tab]); // eslint-disable-line

  async function exportExcel() {
    if (!report) return;
    setExportingExcel(true);
    try {
      const sheets: ExcelSheet[] = [
        {
          name: "Ventas",
          columns: [
            { header: "#", key: "id", width: 8, numFmt: INT_FMT, align: "right" as const },
            { header: "Fecha", key: "date", width: 18 },
            { header: "Total", key: "total", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "Descuento", key: "discount", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "Medio de pago", key: "method", width: 16 },
            { header: "Cliente", key: "client", width: 22 },
            { header: "Estado", key: "status", width: 12 },
          ],
          rows: sales.map((s) => ({
            id: s.id,
            date: formatDateTime(s.created_at),
            total: s.total_cents / 100,
            discount: s.discount_cents / 100,
            method: METHOD_LABELS[s.payment_method] ?? s.payment_method,
            client: s.client_name ?? "",
            status: s.notes?.includes("[ANULADA]") ? "Anulada" : "OK",
          })),
        },
        {
          name: "Por método",
          columns: [
            { header: "Medio de pago", key: "method", width: 18 },
            { header: "Total", key: "total", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "% del total", key: "pct", width: 14, numFmt: PCT_FMT, align: "right" as const },
          ],
          rows: Object.entries(report.by_method)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([m, cents]) => ({
              method: METHOD_LABELS[m] ?? m,
              total: cents / 100,
              pct: report.total_cents > 0 ? (cents / report.total_cents) * 100 : 0,
            })),
        },
      ];

      if (topProducts.length > 0) {
        sheets.push({
          name: "Top productos",
          columns: [
            { header: "Posición", key: "pos", width: 10, numFmt: INT_FMT, align: "right" as const },
            { header: "Producto", key: "name", width: 32 },
            { header: "Unidades", key: "qty", width: 12, numFmt: INT_FMT, align: "right" as const },
            { header: "Total", key: "total", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
          ],
          rows: topProducts.map((p, i) => ({
            pos: i + 1,
            name: p.name,
            qty: p.total_qty,
            total: p.total_cents / 100,
          })),
        });
      }

      if (marginProducts.length > 0) {
        sheets.push({
          name: "Márgenes",
          columns: [
            { header: "Producto", key: "name", width: 32 },
            { header: "Categoría", key: "category", width: 18 },
            { header: "Costo", key: "cost", width: 12, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "Precio", key: "price", width: 12, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "Margen %", key: "margin", width: 12, numFmt: PCT_FMT, align: "right" as const },
            { header: "Unid. vendidas", key: "units", width: 14, numFmt: INT_FMT, align: "right" as const },
            { header: "Ingresos", key: "revenue", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
            { header: "Ganancia", key: "profit", width: 14, numFmt: CURRENCY_FMT, align: "right" as const },
          ],
          rows: marginProducts.filter((p) => p.units_sold > 0).map((p) => ({
            name: p.name,
            category: p.category ?? "",
            cost: p.cost_cents / 100,
            price: p.price_cents / 100,
            margin: p.margin_pct,
            units: p.units_sold,
            revenue: p.revenue_cents / 100,
            profit: p.profit_cents / 100,
          })),
        });
      }

      const filename = fromDate === toDate
        ? `reporte_${fromDate}.xlsx`
        : `reporte_${fromDate}_al_${toDate}.xlsx`;
      await exportStyledExcel(sheets, filename);
      showToast({ message: "Reporte exportado a Excel", tone: "success" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo exportar el reporte a Excel", tone: "danger" });
    } finally {
      setExportingExcel(false);
    }
  }

  function exportPdf() {
    window.print();
  }

  async function openDetail(id: number) {
    try { setDetailSale(await api.getSaleWithItems(id)); } catch (e) { console.error(e); }
  }

  async function handleCancel(id: number) {
    const ok = await confirmAction("Se va a revertir el stock de esta venta.", { title: `¿Anular la venta #${id}?`, danger: true, confirmLabel: "Anular" });
    if (!ok) return;
    try {
      await api.cancelSale(id);
      await load();
      setDetailSale(null);
      showToast({ message: `Venta #${id} anulada` });
    }
    catch { showToast({ message: "No se pudo anular la venta", tone: "danger" }); }
  }

  const maxCat = byCategory.length > 0 ? Math.max(...byCategory.map(([, v]) => v)) : 1;
  const maxTop = topProducts.length > 0 ? Math.max(...topProducts.map((p) => p.total_cents)) : 1;

  const PERIODS: { id: Period; label: string }[] = [
    { id: "hoy",    label: "Hoy" },
    { id: "ayer",   label: "Ayer" },
    { id: "semana", label: "7 días" },
    { id: "mes",    label: "Este mes" },
    { id: "personalizado", label: "Personalizado" },
  ];

  return (
    <>
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold">Reportes</h1>
          {/* Selector de período */}
          <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={clsx(
                  "px-3 py-1.5 whitespace-nowrap",
                  period === p.id ? "bg-indigo-600 text-white" : "bg-white hover:bg-stone-50 text-stone-600"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Tabs */}
          <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
            {(["resumen", "ventas", "margenes", "stock", "reposicion", "libro_iva", "afinidad"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "px-3 py-1.5",
                  tab === t ? "bg-indigo-600 text-white" : "bg-white hover:bg-stone-50 text-stone-600"
                )}
              >
                {t === "resumen" ? "Resumen"
                  : t === "ventas" ? `Ventas (${sales.length})`
                  : t === "margenes" ? "Márgenes"
                  : t === "stock" ? "Stock $"
                  : t === "reposicion" ? "Reposición"
                  : t === "libro_iva" ? "Libro IVA"
                  : "Afinidad"}
              </button>
            ))}
          </div>
        </div>

        {/* Botones de exportación */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={exportExcel}
            disabled={!report || exportingExcel}
            className="btn btn-secondary text-sm disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {exportingExcel ? <Loader2 size={14} className="animate-spin" /> : "📊"} {exportingExcel ? "Exportando…" : "Exportar Excel"}
          </button>
          <button
            onClick={exportPdf}
            disabled={!report}
            className="btn btn-secondary text-sm disabled:opacity-40"
          >
            🖨️ Imprimir / PDF
          </button>
        </div>
      </div>

      {/* Selector de fechas */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Fechas personalizadas */}
        {period === "personalizado" && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="input w-auto text-sm" value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-stone-400">→</span>
            <input type="date" className="input w-auto text-sm" value={customTo}
              onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        {period !== "personalizado" && (
          <span className="text-xs text-stone-400">
            {fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`}
          </span>
        )}
      </div>

      {loading && <p className="text-stone-500 text-sm">Cargando…</p>}

      {tab === "resumen" && !loading && !report && (
        <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
          Sin ventas para el período seleccionado
        </div>
      )}

      {tab === "resumen" && report && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Comparativa período anterior */}
          {prevReport && prevReport.total_cents > 0 && (
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-6 flex-wrap">
              {(() => {
                const pct = ((report.total_cents - prevReport.total_cents) / prevReport.total_cents) * 100;
                const up = pct >= 0;
                return (
                  <>
                    <div className="text-sm text-stone-500">vs período anterior ({prevReport.date})</div>
                    <div className={clsx("flex items-center gap-2 font-semibold text-sm", up ? "text-emerald-700" : "text-red-600")}>
                      <span>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>
                      <span className="font-normal text-stone-500">
                        ({up ? "+" : ""}{centsToARS(report.total_cents - prevReport.total_cents)})
                      </span>
                    </div>
                    <div className="text-xs text-stone-400">
                      Anterior: {centsToARS(prevReport.total_cents)} en {prevReport.sales_count} ventas
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Ventas" value={report.sales_count.toString()}
              sub={prevReport && prevReport.sales_count > 0
                ? `${((report.sales_count - prevReport.sales_count) / prevReport.sales_count * 100).toFixed(0)}% vs anterior`
                : undefined} />
            <Stat label="Total facturado" value={centsToARS(report.total_cents)} />
            <Stat
              label="Promedio por venta"
              value={report.sales_count > 0 ? centsToARS(Math.round(report.total_cents / report.sales_count)) : centsToARS(0)}
            />
            <Stat
              label="Descuentos"
              value={centsToARS(report.discount_cents)}
              sub={report.total_cents > 0 ? `${Math.round((report.discount_cents / (report.total_cents + report.discount_cents)) * 100)}%` : undefined}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Medios de pago */}
            <div className="card p-4">
              <h2 className="font-medium mb-3 text-sm">Por medio de pago</h2>
              {Object.values(report.by_method).every((v) => v === 0) ? (
                <p className="text-stone-400 text-sm">Sin ventas</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(report.by_method)
                    .filter(([, v]) => v > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([m, cents]) => (
                      <li key={m} className="flex justify-between items-center">
                        <span className="text-stone-600">{METHOD_LABELS[m] || m}</span>
                        <span className="tabular font-medium">{centsToARS(cents)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {/* Por categoría */}
            <div className="card p-4">
              <h2 className="font-medium mb-3 text-sm">Por categoría</h2>
              {byCategory.length === 0 ? (
                <p className="text-stone-400 text-sm">Sin ventas</p>
              ) : (
                <ul className="space-y-2">
                  {byCategory.map(([cat, cents]) => (
                    <li key={cat}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-stone-600">{cat}</span>
                        <span className="tabular font-medium">{centsToARS(cents)}</span>
                      </div>
                      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(cents / maxCat) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Top productos */}
          <div className="card p-4">
            <h2 className="font-medium mb-3 text-sm">Productos más vendidos</h2>
            {topProducts.length === 0 ? (
              <p className="text-stone-400 text-sm">Sin ventas</p>
            ) : (
              <div className="space-y-2">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-stone-400 w-5 text-right">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{p.name}</span>
                        <span className="tabular text-stone-600">
                          {centsToARS(p.total_cents)}
                          <span className="text-xs text-stone-400 ml-2">×{p.total_qty}</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(p.total_cents / maxTop) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ventas por empleado */}
          {byUser.length > 0 && (
            <div className="card p-4">
              <h2 className="font-medium mb-3 text-sm">Ventas por empleado</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 uppercase">
                  <tr>
                    <th className="text-left py-2 font-medium">Empleado</th>
                    <th className="text-right py-2 font-medium">Ventas</th>
                    <th className="text-right py-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map((u, i) => (
                    <tr key={i} className="border-t border-stone-100">
                      <td className="py-2 font-medium">{u.user_name}</td>
                      <td className="py-2 text-right tabular text-stone-500">{u.sales_count}</td>
                      <td className="py-2 text-right tabular font-medium">{centsToARS(u.total_cents)}</td>
                      <td className="py-2 text-right tabular text-stone-500">
                        {u.sales_count > 0 ? centsToARS(Math.round(u.total_cents / u.sales_count)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "ventas" && (
        <div className="flex-1 card overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50 shrink-0">
            <input
              className="input h-8 text-sm w-64"
              placeholder="Filtrar por cliente o medio de pago…"
              value={salesFilter}
              onChange={(e) => setSalesFilter(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const f = salesFilter.toLowerCase();
              const fSales = f
                ? sales.filter((s) =>
                    (s.client_name || "").toLowerCase().includes(f) ||
                    (METHOD_LABELS[s.payment_method] || s.payment_method).toLowerCase().includes(f)
                  )
                : sales;
              const activeTotal = fSales.filter((s) => !s.notes?.includes("[ANULADA]")).reduce((a, s) => a + s.total_cents, 0);
              const activeCount = fSales.filter((s) => !s.notes?.includes("[ANULADA]")).length;
              if (fSales.length === 0) return (
                <div className="h-full flex items-center justify-center text-stone-400 text-sm">
                  {sales.length === 0 ? "Sin ventas para el período seleccionado" : "Sin resultados para el filtro"}
                </div>
              );
              return (
                <table className="w-full text-sm">
                  <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">#</th>
                      <th className="text-left px-4 py-2.5 font-medium">Fecha/Hora</th>
                      <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                      <th className="text-left px-4 py-2.5 font-medium">Medio</th>
                      <th className="text-right px-4 py-2.5 font-medium">Total</th>
                      <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fSales.map((s) => {
                      const cancelled = s.notes?.includes("[ANULADA]");
                      return (
                        <tr key={s.id} className={clsx("border-t border-stone-100 hover:bg-stone-50", cancelled && "opacity-40")}>
                          <td className="px-4 py-2.5 font-mono text-xs text-stone-400">#{s.id}</td>
                          <td className="px-4 py-2.5 text-xs text-stone-500">{formatDateTime(s.created_at)}</td>
                          <td className="px-4 py-2.5 text-xs">{s.client_name || <span className="text-stone-400">—</span>}</td>
                          <td className="px-4 py-2.5 text-xs">{METHOD_LABELS[s.payment_method] || s.payment_method}</td>
                          <td className="px-4 py-2.5 text-right tabular font-medium">{centsToARS(s.total_cents)}</td>
                          <td className="px-4 py-2.5 text-center">
                            {cancelled
                              ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Anulada</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">OK</span>
                            }
                          </td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => openDetail(s.id)} className="btn-table-success">Ver</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-stone-50 border-t-2 border-stone-200 sticky bottom-0">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-stone-600">
                        {activeCount} {activeCount === 1 ? "venta válida" : "ventas válidas"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular font-bold text-stone-800">{centsToARS(activeTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "margenes" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {loadingMargins && <p className="text-stone-500 text-sm">Cargando…</p>}
          {!loadingMargins && marginProducts.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-stone-400 text-sm card min-h-40">
              Sin datos para el período seleccionado
            </div>
          )}
          {!loadingMargins && marginCategories.length > 0 && (() => {
            const totRev = marginCategories.reduce((a, c) => a + c.revenue_cents, 0);
            const totProfit = marginCategories.reduce((a, c) => a + c.profit_cents, 0);
            const totMargin = totRev > 0 ? (totProfit / totRev) * 100 : 0;
            return (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Ingresos totales" value={centsToARS(totRev)} />
                <Stat label="Ganancia estimada" value={centsToARS(totProfit)} />
                <Stat label="Margen global" value={`${totMargin.toFixed(1)}%`} sub={`${marginCategories.length} categorías`} />
              </div>
            );
          })()}
          {!loadingMargins && marginCategories.length > 0 && (
            <div className="card p-4">
              <h2 className="font-medium mb-3 text-sm">Margen por categoría</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 uppercase border-b border-stone-100">
                  <tr>
                    <th className="text-left py-2">Categoría</th>
                    <th className="text-right py-2">Costo</th>
                    <th className="text-right py-2">Ingresos</th>
                    <th className="text-right py-2">Ganancia</th>
                    <th className="text-right py-2">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {marginCategories.map((c, i) => (
                    <tr key={i} className="border-t border-stone-50">
                      <td className="py-2 font-medium">{c.category || "Sin categoría"}</td>
                      <td className="py-2 text-right tabular text-stone-500">{centsToARS(c.cost_cents)}</td>
                      <td className="py-2 text-right tabular">{centsToARS(c.revenue_cents)}</td>
                      <td className="py-2 text-right tabular text-emerald-700 font-medium">{centsToARS(c.profit_cents)}</td>
                      <td className="py-2 text-right tabular">
                        <span className={clsx(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          c.margin_pct >= 30 ? "bg-emerald-100 text-emerald-700" :
                          c.margin_pct >= 15 ? "bg-yellow-100 text-yellow-700" :
                          "bg-red-100 text-red-700"
                        )}>
                          {c.margin_pct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loadingMargins && marginProducts.length > 0 && (() => {
            // ── Pareto 80/20 ──────────────────────────────────────────────────
            const withSales = marginProducts.filter(p => p.profit_cents > 0 && p.units_sold > 0)
              .sort((a, b) => b.profit_cents - a.profit_cents);
            const totalProfit = withSales.reduce((s, p) => s + p.profit_cents, 0);
            let cum = 0;
            let paretoCount = 0;
            const paretoIds = new Set<number>();
            for (const p of withSales) {
              cum += p.profit_cents;
              paretoCount++;
              if (p.product_id) paretoIds.add(p.product_id);
              if (cum / totalProfit >= 0.8) break;
            }
            const negativoCount = marginProducts.filter(p => p.margin_pct < 0 && p.units_sold > 0).length;
            const bajoCount = marginProducts.filter(p => p.margin_pct >= 0 && p.margin_pct < 15 && p.units_sold > 0).length;
            return (
              <div className="space-y-4">
                {/* Insight Pareto */}
                {totalProfit > 0 && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
                    <span className="text-2xl">📊</span>
                    <div>
                      <div className="font-semibold text-indigo-900 text-sm">
                        {paretoCount} producto{paretoCount !== 1 ? "s" : ""} generan el 80% de tu ganancia bruta
                      </div>
                      <div className="text-xs text-indigo-700 mt-0.5">
                        Los marcados con ⭐ son tus productos Pareto — priorizá su stock y reposición.
                      </div>
                    </div>
                  </div>
                )}
                {/* Alertas de margen */}
                {(negativoCount > 0 || bajoCount > 0) && (
                  <div className="flex gap-3 flex-wrap">
                    {negativoCount > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800 font-medium">
                        🔴 {negativoCount} producto{negativoCount !== 1 ? "s" : ""} con margen negativo
                      </div>
                    )}
                    {bajoCount > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800 font-medium">
                        🟡 {bajoCount} producto{bajoCount !== 1 ? "s" : ""} con margen menor al 15%
                      </div>
                    )}
                  </div>
                )}
                <div className="card p-4">
                  <h2 className="font-medium mb-3 text-sm">Margen por producto</h2>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-stone-500 uppercase border-b border-stone-100">
                      <tr>
                        <th className="text-left py-2">Producto</th>
                        <th className="text-right py-2">Unidades</th>
                        <th className="text-right py-2">Ganancia</th>
                        <th className="text-right py-2">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marginProducts.map((p, i) => {
                        const isPareto = p.product_id ? paretoIds.has(p.product_id) : false;
                        return (
                          <tr key={i} className={clsx("border-t border-stone-50 hover:bg-stone-50", isPareto && "bg-indigo-50/30")}>
                            <td className="py-2">
                              <span className="font-medium">{p.name}</span>
                              {isPareto && <span className="ml-1.5 text-[10px]">⭐</span>}
                              {p.category && <span className="ml-2 text-[10px] text-stone-400 uppercase">{p.category}</span>}
                            </td>
                            <td className="py-2 text-right tabular text-stone-500">{p.units_sold > 0 ? p.units_sold : "—"}</td>
                            <td className="py-2 text-right tabular font-medium">
                              {p.profit_cents > 0 ? <span className="text-emerald-700">{centsToARS(p.profit_cents)}</span>
                               : p.profit_cents < 0 ? <span className="text-red-600">{centsToARS(p.profit_cents)}</span>
                               : <span className="text-stone-400">—</span>}
                            </td>
                            <td className="py-2 text-right tabular">
                              <span className={clsx(
                                "text-xs px-2 py-0.5 rounded-full font-medium",
                                p.margin_pct >= 30 ? "bg-emerald-100 text-emerald-700" :
                                p.margin_pct >= 15 ? "bg-yellow-100 text-yellow-700" :
                                "bg-red-100 text-red-700"
                              )}>
                                {p.margin_pct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {tab === "stock" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {loadingStock && <p className="text-stone-500 text-sm">Cargando…</p>}
          {!loadingStock && (() => {
            const active = allProducts.filter((p) => p.active);
            const totalValue = active.reduce((s, p) => s + p.stock * p.cost_cents, 0);
            const totalSaleValue = active.reduce((s, p) => s + p.stock * p.price_cents, 0);
            const sorted = [...active].sort((a, b) => (b.stock * b.cost_cents) - (a.stock * a.cost_cents));
            return (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Productos activos" value={active.length.toString()} />
                  <Stat label="Valor al costo" value={centsToARS(totalValue)} />
                  <Stat label="Valor al precio de venta" value={centsToARS(totalSaleValue)} />
                </div>
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">Producto</th>
                        <th className="text-left px-4 py-2.5 font-medium">Categoría</th>
                        <th className="text-right px-4 py-2.5 font-medium">Stock</th>
                        <th className="text-right px-4 py-2.5 font-medium">Costo unit.</th>
                        <th className="text-right px-4 py-2.5 font-medium">Valor costo</th>
                        <th className="text-right px-4 py-2.5 font-medium">Valor venta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p) => (
                        <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2.5 font-medium">{p.name}</td>
                          <td className="px-4 py-2.5 text-stone-500 text-xs">{p.category || "—"}</td>
                          <td className="px-4 py-2.5 text-right tabular">{p.stock}</td>
                          <td className="px-4 py-2.5 text-right tabular text-stone-500">{centsToARS(p.cost_cents)}</td>
                          <td className="px-4 py-2.5 text-right tabular font-medium">{centsToARS(p.stock * p.cost_cents)}</td>
                          <td className="px-4 py-2.5 text-right tabular text-emerald-700">{centsToARS(p.stock * p.price_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-stone-50 border-t-2 border-stone-200 sticky bottom-0">
                      <tr>
                        <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-stone-600">Total</td>
                        <td className="px-4 py-2.5 text-right tabular font-bold">{centsToARS(totalValue)}</td>
                        <td className="px-4 py-2.5 text-right tabular font-bold text-emerald-700">{centsToARS(totalSaleValue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {tab === "reposicion" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {loadingStock && <p className="text-stone-500 text-sm">Cargando…</p>}
          {!loadingStock && reorderItems.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-stone-400 text-sm card min-h-40">
              No hay productos bajo stock mínimo
            </div>
          )}
          {!loadingStock && reorderItems.length > 0 && (() => {
            const bySupplier: Record<string, ReorderItem[]> = {};
            reorderItems.forEach((item) => {
              const key = item.supplier_name || "Sin proveedor";
              if (!bySupplier[key]) bySupplier[key] = [];
              bySupplier[key].push(item);
            });
            return (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Productos a reponer" value={reorderItems.length.toString()} />
                  <Stat label="Costo estimado" value={centsToARS(reorderItems.reduce((s, i) => s + i.need_qty * i.cost_cents, 0))} />
                </div>
                {Object.entries(bySupplier).map(([supplier, items]) => (
                  <div key={supplier} className="card overflow-hidden">
                    <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100 flex justify-between items-center">
                      <span className="font-semibold text-sm">{supplier}</span>
                      <span className="text-xs text-stone-500">{items.length} producto{items.length !== 1 ? "s" : ""}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-stone-500 uppercase">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium">Producto</th>
                          <th className="text-right px-4 py-2 font-medium">Stock actual</th>
                          <th className="text-right px-4 py-2 font-medium">Mínimo</th>
                          <th className="text-right px-4 py-2 font-medium">A pedir</th>
                          <th className="text-right px-4 py-2 font-medium">Costo est.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t border-stone-100 hover:bg-stone-50">
                            <td className="px-4 py-2.5 font-medium">{item.name}</td>
                            <td className="px-4 py-2.5 text-right tabular text-red-600 font-semibold">{item.stock}</td>
                            <td className="px-4 py-2.5 text-right tabular text-stone-500">{item.min_stock}</td>
                            <td className="px-4 py-2.5 text-right tabular font-semibold text-amber-700">{item.need_qty}</td>
                            <td className="px-4 py-2.5 text-right tabular text-stone-600">{centsToARS(item.need_qty * item.cost_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {tab === "afinidad" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <p className="text-xs text-stone-500">
            Pares de productos comprados juntos en la misma venta (últimos 60 días). Útil para decisiones de ubicación en góndola y cross-selling.
          </p>
          {loadingAffinity && <p className="text-stone-500 text-sm">Cargando…</p>}
          {!loadingAffinity && affinityItems.length === 0 && (
            <div className="card flex-1 flex items-center justify-center min-h-40 text-stone-400 text-sm">
              No hay suficientes ventas con múltiples productos para calcular afinidad.
            </div>
          )}
          {!loadingAffinity && affinityItems.length > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 uppercase bg-stone-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Producto A</th>
                    <th className="text-left px-4 py-2.5 font-medium">Se compra junto con</th>
                    <th className="text-right px-4 py-2.5 font-medium">Veces juntos</th>
                    <th className="text-right px-4 py-2.5 font-medium">De ventas de A</th>
                    <th className="text-right px-4 py-2.5 font-medium">Afinidad</th>
                  </tr>
                </thead>
                <tbody>
                  {affinityItems.map((item, i) => (
                    <tr key={i} className="border-t border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-medium">{item.product_a_name}</td>
                      <td className="px-4 py-2.5 text-stone-600">{item.product_b_name}</td>
                      <td className="px-4 py-2.5 text-right tabular">{item.co_occurrences}</td>
                      <td className="px-4 py-2.5 text-right tabular text-stone-500">{item.total_a_sales}</td>
                      <td className="px-4 py-2.5 text-right tabular">
                        <span className={clsx(
                          "font-bold text-xs px-2 py-0.5 rounded-full",
                          item.affinity_pct >= 50 ? "bg-emerald-100 text-emerald-700"
                            : item.affinity_pct >= 25 ? "bg-amber-100 text-amber-700"
                            : "bg-stone-100 text-stone-600"
                        )}>
                          {item.affinity_pct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "libro_iva" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {loadingIva && <p className="text-stone-500 text-sm">Cargando…</p>}
          {!loadingIva && ivaItems.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-stone-400 text-sm card min-h-40">
              Sin ventas para el período seleccionado
            </div>
          )}
          {!loadingIva && ivaItems.length > 0 && (() => {
            const totalNeto = ivaItems.reduce((s, i) => s + i.neto_cents, 0);
            const totalIva  = ivaItems.reduce((s, i) => s + i.iva_cents, 0);
            const totalBruto = ivaItems.reduce((s, i) => s + i.total_cents, 0);
            return (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Total bruto" value={centsToARS(totalBruto)} sub={`${ivaItems.length} ventas`} />
                  <Stat label="Neto (sin IVA)" value={centsToARS(totalNeto)} />
                  <Stat label="IVA" value={centsToARS(totalIva)} sub="según tasa configurada" />
                </div>
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50 border-b border-stone-100">
                    <span className="font-semibold text-sm">Detalle de ventas con IVA</span>
                    <button
                      onClick={async () => {
                        setExportingIva(true);
                        try {
                          await exportStyledExcel([{
                            name: "Libro IVA",
                            columns: [
                              { header: "Fecha", key: "date", width: 14 },
                              { header: "#Venta", key: "saleId", width: 10, numFmt: INT_FMT, align: "right" },
                              { header: "Medio de pago", key: "method", width: 16 },
                              { header: "Cliente", key: "client", width: 22 },
                              { header: "Total", key: "total", width: 14, numFmt: CURRENCY_FMT, align: "right" },
                              { header: "Neto", key: "neto", width: 14, numFmt: CURRENCY_FMT, align: "right" },
                              { header: "IVA", key: "iva", width: 14, numFmt: CURRENCY_FMT, align: "right" },
                            ],
                            rows: ivaItems.map((i) => ({
                              date: i.date,
                              saleId: i.sale_id,
                              method: METHOD_LABELS[i.payment_method] ?? i.payment_method,
                              client: i.client_name ?? "",
                              total: i.total_cents / 100,
                              neto: i.neto_cents / 100,
                              iva: i.iva_cents / 100,
                            })),
                          }], `libro_iva_${fromDate}_${toDate}.xlsx`);
                          showToast({ message: "Libro IVA exportado a Excel", tone: "success" });
                        } catch (e) {
                          console.error(e);
                          showToast({ message: "No se pudo exportar el libro IVA", tone: "danger" });
                        } finally {
                          setExportingIva(false);
                        }
                      }}
                      disabled={exportingIva}
                      className="btn btn-secondary text-xs disabled:opacity-60 inline-flex items-center gap-1.5"
                    >
                      {exportingIva ? <Loader2 size={12} className="animate-spin" /> : "📊"} {exportingIva ? "Exportando…" : "Exportar Excel"}
                    </button>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-stone-500 uppercase bg-stone-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Fecha</th>
                        <th className="text-left px-4 py-2 font-medium">#</th>
                        <th className="text-left px-4 py-2 font-medium">Pago</th>
                        <th className="text-left px-4 py-2 font-medium">Cliente</th>
                        <th className="text-right px-4 py-2 font-medium">Total</th>
                        <th className="text-right px-4 py-2 font-medium">Neto</th>
                        <th className="text-right px-4 py-2 font-medium">IVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ivaItems.map((item) => (
                        <tr key={item.sale_id} className="border-t border-stone-100 hover:bg-stone-50">
                          <td className="px-4 py-2 tabular text-stone-500">{item.date}</td>
                          <td className="px-4 py-2 tabular text-stone-400 text-xs">#{item.sale_id}</td>
                          <td className="px-4 py-2 text-xs">{METHOD_LABELS[item.payment_method] ?? item.payment_method}</td>
                          <td className="px-4 py-2 text-xs text-stone-500">{item.client_name ?? "—"}</td>
                          <td className="px-4 py-2 text-right tabular font-medium">{centsToARS(item.total_cents)}</td>
                          <td className="px-4 py-2 text-right tabular text-stone-600">{centsToARS(item.neto_cents)}</td>
                          <td className="px-4 py-2 text-right tabular text-indigo-600">{centsToARS(item.iva_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-stone-200 font-semibold text-sm">
                      <tr>
                        <td colSpan={4} className="px-4 py-2.5">TOTAL</td>
                        <td className="px-4 py-2.5 text-right tabular">{centsToARS(totalBruto)}</td>
                        <td className="px-4 py-2.5 text-right tabular">{centsToARS(totalNeto)}</td>
                        <td className="px-4 py-2.5 text-right tabular text-indigo-600">{centsToARS(totalIva)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {detailSale && (
        <SaleDetailModal sw={detailSale} onClose={() => setDetailSale(null)} onCancel={handleCancel} />
      )}
    </div>

    {/* Portal de impresión — renderiza fuera del #root para que @media print funcione */}
    {report && createPortal(
      <div id="print-report" style={{ display: "none" }}>
        <PrintReport
          report={report}
          fromDate={fromDate}
          toDate={toDate}
          topProducts={topProducts}
          byCategory={byCategory}
          byUser={byUser}
          sales={sales}
          marginCategories={marginCategories}
        />
      </div>,
      document.body
    )}
    </>
  );
}

// ─── Informe imprimible ────────────────────────────────────────────────────────

function PrintReport({
  report, fromDate, toDate, topProducts, byCategory, byUser, sales, marginCategories,
}: {
  report: DailyReport;
  fromDate: string;
  toDate: string;
  topProducts: TopProduct[];
  byCategory: [string, number][];
  byUser: SalesByUser[];
  sales: Sale[];
  marginCategories: MarginCategory[];
}) {
  const periodLabel = fromDate === toDate ? fromDate : `${fromDate} al ${toDate}`;
  const validSales = sales.filter((s) => !s.notes?.includes("[ANULADA]"));

  const cell: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "11pt",
  };
  const th: React.CSSProperties = {
    ...cell,
    fontWeight: 700,
    background: "#EEF2FF",
    fontSize: "9pt",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#4338CA",
  };
  const sectionTitle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: "13pt",
    marginBottom: "10px",
    borderBottom: "2px solid #4F46E5",
    paddingBottom: "6px",
    color: "#1e1b4b",
  };

  return (
    <div style={{ fontFamily: "'Inter', Arial, sans-serif", color: "#111", maxWidth: "900px", margin: "0 auto" }}>
      {/* Encabezado */}
      <div style={{ borderBottom: "4px solid #4F46E5", paddingBottom: "12px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: "22pt", fontWeight: 800, lineHeight: 1, color: "#312e81" }}>Informe de Ventas</div>
          <div style={{ color: "#6b7280", fontSize: "12pt", marginTop: "4px" }}>Período: {periodLabel}</div>
        </div>
        <div style={{ textAlign: "right", color: "#9ca3af", fontSize: "10pt" }}>
          <div>Punto Simple POS</div>
          <div>Generado: {new Date().toLocaleString("es-AR")}</div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
        {[
          { label: "Total facturado", value: centsToARS(report.total_cents) },
          { label: "Cantidad de ventas", value: report.sales_count.toString() },
          { label: "Ticket promedio", value: report.sales_count > 0 ? centsToARS(Math.round(report.total_cents / report.sales_count)) : centsToARS(0) },
          { label: "Descuentos", value: centsToARS(report.discount_cents) },
        ].map((k) => (
          <div key={k.label} style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #4F46E5", borderRadius: "8px", padding: "14px", background: "#fafafe" }}>
            <div style={{ fontSize: "9pt", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
            <div style={{ fontSize: "18pt", fontWeight: 800, marginTop: "4px", color: "#312e81" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Medios de pago + Categorías */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "28px" }}>
        <div>
          <div style={sectionTitle}>Por medio de pago</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Medio</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={{ ...th, textAlign: "right" }}>%</th></tr></thead>
            <tbody>
              {Object.entries(report.by_method).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m, cents]) => (
                <tr key={m}>
                  <td style={cell}>{METHOD_LABELS[m] ?? m}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(cents)}</td>
                  <td style={{ ...cell, textAlign: "right", color: "#6b7280" }}>
                    {report.total_cents > 0 ? ((cents / report.total_cents) * 100).toFixed(1) + "%" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div style={sectionTitle}>Por categoría</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Categoría</th><th style={{ ...th, textAlign: "right" }}>Total</th></tr></thead>
            <tbody>
              {byCategory.map(([cat, cents]) => (
                <tr key={cat}>
                  <td style={cell}>{cat}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top productos */}
      {topProducts.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionTitle}>Productos más vendidos</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left", width: "32px" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Producto</th>
              <th style={{ ...th, textAlign: "right" }}>Unidades</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
            </tr></thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...cell, color: "#9ca3af" }}>{i + 1}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.total_qty}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(p.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Por empleado */}
      {byUser.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionTitle}>Ventas por empleado</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Empleado</th>
              <th style={{ ...th, textAlign: "right" }}>Ventas</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={{ ...th, textAlign: "right" }}>Ticket prom.</th>
            </tr></thead>
            <tbody>
              {byUser.map((u, i) => (
                <tr key={i}>
                  <td style={{ ...cell, fontWeight: 600 }}>{u.user_name}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{u.sales_count}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(u.total_cents)}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {u.sales_count > 0 ? centsToARS(Math.round(u.total_cents / u.sales_count)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Márgenes por categoría */}
      {marginCategories.length > 0 && (
        <div>
          <div style={sectionTitle}>Rentabilidad por categoría</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Categoría</th>
              <th style={{ ...th, textAlign: "right" }}>Ingresos</th>
              <th style={{ ...th, textAlign: "right" }}>Costo</th>
              <th style={{ ...th, textAlign: "right" }}>Ganancia</th>
              <th style={{ ...th, textAlign: "right" }}>Margen</th>
            </tr></thead>
            <tbody>
              {marginCategories.map((c) => (
                <tr key={c.category}>
                  <td style={{ ...cell, fontWeight: 600 }}>{c.category}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(c.revenue_cents)}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(c.cost_cents)}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsToARS(c.profit_cents)}</td>
                  <td style={{ ...cell, textAlign: "right", color: c.margin_pct >= 20 ? "#16a34a" : "#d97706" }}>{c.margin_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pie */}
      <div style={{ marginTop: "40px", borderTop: "1px solid #e5e7eb", paddingTop: "12px", color: "#9ca3af", fontSize: "9pt", display: "flex", justifyContent: "space-between" }}>
        <span>Punto Simple POS — {periodLabel}</span>
        <span>{validSales.length} ventas válidas · Total: {centsToARS(report.total_cents)}</span>
      </div>
    </div>
  );
}

function SaleDetailModal({ sw, onClose, onCancel }: { sw: SaleWithItems; onClose: () => void; onCancel: (id: number) => void }) {
  const { sale, items } = sw;
  const cancelled = sale.notes?.includes("[ANULADA]");
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="p-5 border-b border-stone-200 flex items-start justify-between pr-6">
          <div>
            <h2 className="font-semibold">Venta #{sale.id}</h2>
            <p className="text-xs text-stone-400 mt-0.5">{formatDateTime(sale.created_at)}</p>
          </div>
          {cancelled && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">ANULADA</span>}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm mb-4">
            <thead className="text-xs text-stone-500 uppercase border-b border-stone-100">
              <tr>
                <th className="text-left pb-2">Producto</th>
                <th className="text-right pb-2">Precio</th>
                <th className="text-right pb-2">Cant.</th>
                <th className="text-right pb-2">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-stone-50">
                  <td className="py-2">
                    <div className="font-medium">{item.name}</div>
                    {item.discount_pct > 0 && <div className="text-xs text-amber-600">-{item.discount_pct}%</div>}
                  </td>
                  <td className="py-2 text-right tabular text-stone-500">{centsToARS(item.unit_price_cents)}</td>
                  <td className="py-2 text-right tabular">{item.qty}</td>
                  <td className="py-2 text-right tabular font-medium">{centsToARS(item.subtotal_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-stone-200 pt-3 space-y-1.5 text-sm">
            {sale.discount_cents > 0 && (
              <div className="flex justify-between text-stone-500">
                <span>Descuento global</span>
                <span className="tabular text-amber-600">− {centsToARS(sale.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base">
              <span>Total</span><span className="tabular">{centsToARS(sale.total_cents)}</span>
            </div>
            <div className="flex justify-between text-stone-500">
              <span>Medio de pago</span>
              <span>{METHOD_LABELS[sale.payment_method] || sale.payment_method}</span>
            </div>
            {sale.payment_method === "efectivo" && (
              <>
                <div className="flex justify-between text-stone-500"><span>Recibido</span><span className="tabular">{centsToARS(sale.paid_cents)}</span></div>
                <div className="flex justify-between text-stone-500"><span>Vuelto</span><span className="tabular">{centsToARS(sale.change_cents)}</span></div>
              </>
            )}
            {sale.client_name && <div className="flex justify-between text-stone-500"><span>Cliente</span><span>{sale.client_name}</span></div>}
          </div>
        </div>
        <div className="p-4 border-t border-stone-200 flex gap-2">
          {!cancelled && (
            <button onClick={() => onCancel(sale.id)} className="btn text-sm text-red-600 border border-red-200 hover:bg-red-50 flex-1">
              Anular venta
            </button>
          )}
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-semibold tabular mt-1">{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}
