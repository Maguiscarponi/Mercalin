import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents } from "@/lib/format";
import type { ArcaConfig, ArcaConfigInput, Client, CondicionIvaCliente, ElectronicInvoice } from "@/types";
import { showToast, confirmAction } from "@/stores/dialogs";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import FacturaPrint, { type FacturaItem } from "@/components/FacturaPrint";
import { decideInvoiceType, condicionIvaClienteLabel } from "@/lib/facturacion";
import { openSupportWhatsapp } from "@/lib/support";
import { openUrl } from "@tauri-apps/plugin-opener";
import HelpImageButton from "@/components/ui/HelpImageButton";
import imgCrearDn from "@/assets/ayuda-arca/wsass-crear-dn.png";
import imgListaServicios from "@/assets/ayuda-arca/wsass-lista-servicios.png";
import imgAutorizacion from "@/assets/ayuda-arca/wsass-autorizacion.png";
import clsx from "clsx";

// El wizard conecta siempre contra ARCA Producción -- no se le muestra la
// opción de Testing a quien usa la app (decisión de producto: simplificar
// la conexión real, que es lo único que le importa al comerciante). El
// soporte para Testing/WSASS se deja funcionando en el código a propósito
// (helper, constante, capturas, instrucciones) por si hace falta reactivarlo
// más adelante -- alcanza con volver a mostrar el <select> de Entorno.
const WSASS_HOMO_URL = "https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx";
const ARCA_PORTAL_URL = "https://auth.afip.gob.ar";

type Tab = "facturas" | "configuracion";

const STATUS_LABEL: Record<string, string> = { pendiente: "Pendiente", autorizada: "Autorizada", error: "Error" };
const STATUS_COLOR: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  autorizada: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
};
const TYPE_COLOR: Record<string, string> = {
  A: "bg-blue-100 text-blue-700",
  B: "bg-purple-100 text-purple-700",
  C: "bg-orange-100 text-orange-700",
};

// Un paso numerado dentro de una guía -- separado en su propia tarjetita en
// vez de un <li> apretado, para que una lista larga no se lea como un solo
// bloque de texto.
function NumberedStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3 items-start bg-white rounded-lg p-3 border border-amber-100">
      <span className="shrink-0 w-6 h-6 rounded-full bg-amber-200 text-amber-900 text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function formatCbteNro(nro: number | null, pv: number): string {
  if (!nro) return "—";
  return `${String(pv).padStart(4, "0")}-${String(nro).padStart(8, "0")}`;
}

// El input <type="date"> guarda YYYY-MM-DD; el papel de la factura va en
// dd/mm/yyyy como cualquier fecha argentina.
function fmtFechaArg(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

// Según la guía oficial de ARCA, el CSR a veces se pega como texto y a veces
// se sube como archivo -- por eso hace falta poder bajarlo también como
// .csr, no solo copiarlo.
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Facturacion() {
  const [tab, setTab] = useState<Tab>("facturas");
  const [invoices, setInvoices] = useState<ElectronicInvoice[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [selected, setSelected] = useState<ElectronicInvoice | null>(null);
  const [showNueva, setShowNueva] = useState(false);
  const [printing, setPrinting] = useState<ElectronicInvoice | null>(null);
  const [annullingId, setAnnullingId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "pendiente" | "autorizada" | "error">("all");
  const [filterType, setFilterType] = useState<"all" | "A" | "B" | "C" | "NC">("all");
  const [filterRange, setFilterRange] = useState<"all" | "today" | "week" | "month">("all");
  const [filterQuery, setFilterQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [invs, cfg] = await Promise.all([
        api.listElectronicInvoices(300),
        api.getArcaConfig(),
      ]);
      setInvoices(invs);
      setArcaConfig(cfg);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function retry() {
    setRetrying(true);
    try {
      const count = await api.retryPendingInvoices();
      if (count > 0) { showToast({ message: `${count} factura${count !== 1 ? "s" : ""} autorizada${count !== 1 ? "s" : ""}`, tone: "success" }); load(); }
      else showToast({ message: "Sin facturas pendientes o sin conexión a ARCA" });
    } catch (e) { showToast({ message: `Error: ${e}`, tone: "danger" }); }
    finally { setRetrying(false); }
  }

  const pendientes = invoices.filter((i) => i.status === "pendiente");
  const autorizadas = invoices.filter((i) => i.status === "autorizada");
  const errores = invoices.filter((i) => i.status === "error");
  const today = new Date().toISOString().split("T")[0];
  const hoy = invoices.filter((i) => i.created_at.startsWith(today) && i.status === "autorizada");
  const totalHoy = hoy.reduce((s, i) => s + i.total_cents, 0);

  // Facturas que ya tienen una Nota de Crédito emitida (autorizada o en
  // camino) -- no se puede anular dos veces la misma factura.
  const creditedIds = new Set(
    invoices.filter((i) => i.credited_invoice_id != null && i.status !== "error").map((i) => i.credited_invoice_id)
  );

  // Filtros de la tabla -- necesarios apenas se acumulan más de un puñado de
  // comprobantes, si no se hace imposible encontrar uno puntual.
  const rangeStart = (() => {
    const now = new Date();
    if (filterRange === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filterRange === "week") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    if (filterRange === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    return null;
  })();
  const hasActiveFilters = filterStatus !== "all" || filterType !== "all" || filterRange !== "all" || filterQuery.trim().length > 0;
  function clearFilters() {
    setFilterStatus("all"); setFilterType("all"); setFilterRange("all"); setFilterQuery("");
  }
  const filteredInvoices = invoices.filter((inv) => {
    if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    const esNC = inv.credited_invoice_id != null;
    if (filterType === "NC" && !esNC) return false;
    if (filterType !== "all" && filterType !== "NC" && (esNC || inv.invoice_type !== filterType)) return false;
    if (rangeStart && new Date(inv.created_at) < rangeStart) return false;
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      const haystack = `${inv.client_name || ""} ${inv.client_cuit || ""} ${formatCbteNro(inv.cbte_nro, inv.punto_venta)}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  async function annul(inv: ElectronicInvoice) {
    const ok = await confirmAction(
      `Se va a emitir una Nota de Crédito ${inv.invoice_type} por ${centsToARS(inv.total_cents)} que anula la Factura ${inv.invoice_type} ${formatCbteNro(inv.cbte_nro, inv.punto_venta)}. Esto es real e irreversible ante ARCA.`,
      { title: "¿Anular esta factura?", danger: true, confirmLabel: "Emitir Nota de Crédito" }
    );
    if (!ok) return;
    setAnnullingId(inv.id);
    try {
      const nc = await api.issueCreditNote(inv.id);
      if (nc.status === "error") { showToast({ message: nc.error_msg || "ARCA rechazó la nota de crédito.", tone: "danger" }); }
      else { showToast({ message: "Nota de crédito emitida", tone: "success" }); }
      load();
    } catch (e) {
      showToast({ message: `Error: ${e}`, tone: "danger" });
    } finally {
      setAnnullingId(null);
    }
  }

  if (loading) return <div className="p-4 text-stone-400">Cargando…</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Header con tabs */}
      <div className="bg-white border-b border-stone-200 px-6 pt-5 pb-0">
        <h1 className="text-xl font-semibold mb-3">Facturación Electrónica</h1>
        <div className="flex gap-1">
          {([
            { id: "facturas" as Tab, label: "Comprobantes" },
            { id: "configuracion" as Tab, label: "Configuración ARCA" },
          ]).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx("px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === t.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-stone-500 hover:text-stone-800")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── TAB: FACTURAS ────────────────────────────────── */}
        {tab === "facturas" && (
          <div className="p-5 flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
              {arcaConfig && (
                <p className="text-xs text-stone-500">
                  CUIT {arcaConfig.cuit} · PV {arcaConfig.punto_venta}
                </p>
              )}
              {!arcaConfig && (
                <p className="text-xs text-amber-600">
                  ARCA no configurado — andá a la pestaña "Configuración ARCA"
                </p>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {pendientes.length > 0 && (
                  <button onClick={retry} disabled={retrying} className="btn btn-secondary text-sm disabled:opacity-50">
                    {retrying ? "Procesando…" : `↻ Reintentar ${pendientes.length} pendiente${pendientes.length !== 1 ? "s" : ""}`}
                  </button>
                )}
                <button
                  onClick={() => setShowNueva(true)}
                  disabled={!arcaConfig?.has_certificate}
                  className="btn btn-primary text-sm disabled:opacity-50"
                  title={!arcaConfig?.has_certificate ? "Completá la Configuración ARCA primero" : undefined}
                >
                  + Nueva factura
                </button>
              </div>
            </div>

            {/* KPIs -- también son filtros rápidos: clic para filtrar la tabla */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Emitidas hoy", value: hoy.length, sub: centsToARS(totalHoy), color: "text-emerald-600", title: undefined, active: filterRange === "today", onClick: () => setFilterRange(filterRange === "today" ? "all" : "today") },
                { label: "Total autorizadas", value: autorizadas.length, sub: "históricas", color: "text-stone-800", title: "Ya tienen CAE de ARCA: están firmadas y ya figuran en tu cuenta real (si estás en Producción).", active: filterStatus === "autorizada", onClick: () => setFilterStatus(filterStatus === "autorizada" ? "all" : "autorizada") },
                { label: "Pendientes", value: pendientes.length, sub: "sin CAE", color: pendientes.length > 0 ? "text-amber-600" : "text-stone-400", title: "Todavía no se mandaron a ARCA (sin internet en ese momento). Usá \"Reintentar\" cuando tengas conexión.", active: filterStatus === "pendiente", onClick: () => setFilterStatus(filterStatus === "pendiente" ? "all" : "pendiente") },
                { label: "Errores", value: errores.length, sub: "rechazadas", color: errores.length > 0 ? "text-red-600" : "text-stone-400", title: "ARCA las rechazó por algún dato mal cargado. Mirá el detalle de cada una para ver el motivo.", active: filterStatus === "error", onClick: () => setFilterStatus(filterStatus === "error" ? "all" : "error") },
              ].map((k) => (
                <button key={k.label} onClick={k.onClick} title={k.title}
                  className={clsx("card p-4 text-left transition-shadow", k.active && "ring-2 ring-indigo-400")}>
                  <div className="text-xs text-stone-500 mb-1">{k.label}</div>
                  <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                  <div className="text-xs text-stone-400 mt-0.5">{k.sub}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-400 -mt-2">
              Ni bien ARCA responde, la factura queda <strong>Autorizada</strong> al instante (no hay espera de por medio) —
              o <strong>Error</strong> si algo estaba mal. Solo queda <strong>Pendiente</strong> si no había conexión para mandarla.
            </p>

            {/* Filtros */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="input text-sm max-w-[220px]"
                placeholder="Buscar cliente, CUIT o N°…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
              <select className="input text-sm w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)}>
                <option value="all">Todos los tipos</option>
                <option value="A">Factura A</option>
                <option value="B">Factura B</option>
                <option value="C">Factura C</option>
                <option value="NC">Notas de Crédito</option>
              </select>
              <select className="input text-sm w-auto" value={filterRange} onChange={(e) => setFilterRange(e.target.value as typeof filterRange)}>
                <option value="all">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="week">Esta semana</option>
                <option value="month">Este mes</option>
              </select>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-stone-400 hover:text-stone-700 underline">
                  Limpiar filtros
                </button>
              )}
              <span className="text-xs text-stone-400 ml-auto">
                {filteredInvoices.length} de {invoices.length} comprobante{invoices.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Tabla */}
            <div className="flex-1 card overflow-hidden flex flex-col">
              <div className="overflow-y-auto flex-1">
                {invoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-400 text-sm gap-2">
                    <span className="text-3xl">🧾</span>
                    Las facturas se generan solas después de cada venta, o hacé clic en "+ Nueva factura" para emitir una suelta.
                  </div>
                ) : filteredInvoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-400 text-sm gap-2">
                    <span className="text-3xl">🔍</span>
                    Ningún comprobante coincide con los filtros.
                    <button onClick={clearFilters} className="text-xs text-indigo-500 hover:text-indigo-700 underline">Limpiar filtros</button>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-stone-100 bg-stone-50 sticky top-0">
                      <tr>
                        {["Tipo", "N° Comprobante", "Cliente", "Total", "Estado", "Fecha", ""].map((h) => (
                          <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {filteredInvoices.map((inv) => {
                        const esNC = inv.credited_invoice_id != null;
                        const original = esNC ? invoices.find((o) => o.id === inv.credited_invoice_id) : undefined;
                        const puedeAnular = !esNC && inv.status === "autorizada" && !creditedIds.has(inv.id);
                        return (
                        <tr key={inv.id} className="hover:bg-stone-50">
                          <td className="py-2.5 px-4">
                            <span className={clsx("text-xs font-bold px-2 py-0.5 rounded", esNC ? "bg-stone-200 text-stone-700" : TYPE_COLOR[inv.invoice_type] || "bg-stone-100 text-stone-600")}>
                              {esNC ? `NC ${inv.invoice_type}` : `Fact. ${inv.invoice_type}`}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-stone-600">
                            {formatCbteNro(inv.cbte_nro, inv.punto_venta)}
                            {esNC && (
                              <div className="text-stone-400">
                                anula {original ? formatCbteNro(original.cbte_nro, original.punto_venta) : `#${inv.credited_invoice_id}`}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-stone-600 max-w-[180px] truncate">
                            {inv.client_name || (inv.doc_tipo === 99 ? "Consumidor Final" : inv.client_cuit || "—")}
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium tabular-nums">{centsToARS(inv.total_cents)}</td>
                          <td className="py-2.5 px-4">
                            <span className={clsx("text-xs font-medium px-2 py-0.5 rounded", STATUS_COLOR[inv.status])}>
                              {STATUS_LABEL[inv.status]}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-xs text-stone-400">{new Date(inv.created_at).toLocaleDateString("es-AR")}</td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <button onClick={() => setSelected(inv)} className="text-xs text-stone-400 hover:text-stone-700 mr-2">Ver</button>
                            {inv.status === "autorizada" && (
                              <button onClick={() => setPrinting(inv)} className="text-xs text-indigo-500 hover:text-indigo-700 mr-2">🖨️</button>
                            )}
                            {puedeAnular && (
                              <button
                                onClick={() => annul(inv)}
                                disabled={annullingId === inv.id}
                                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                              >
                                {annullingId === inv.id ? "Anulando…" : "Anular"}
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: CONFIGURACIÓN ARCA ───────────────────────── */}
        {tab === "configuracion" && (
          <div className="p-5">
            <ArcaSetup
              arcaConfig={arcaConfig || null}
              onRefresh={load}
            />
          </div>
        )}
      </div>

      {selected && (
        <InvoiceDetail
          inv={selected}
          onClose={() => setSelected(null)}
          onPrint={selected.status === "autorizada" ? () => { setPrinting(selected); setSelected(null); } : undefined}
        />
      )}

      {showNueva && arcaConfig && (
        <NuevaFacturaModal
          arcaConfig={arcaConfig}
          onClose={() => setShowNueva(false)}
          onIssued={(inv) => { setShowNueva(false); load(); if (inv.status === "autorizada") setPrinting(inv); }}
        />
      )}

      {printing && arcaConfig && (
        <FacturaViewerLoader inv={printing} arcaConfig={arcaConfig} invoices={invoices} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}

// ── Ver / imprimir una factura ya emitida ───────────────────────────────────

function FacturaViewerLoader({ inv, arcaConfig, invoices, onClose }: { inv: ElectronicInvoice; arcaConfig: ArcaConfig; invoices: ElectronicInvoice[]; onClose: () => void }) {
  const [items, setItems] = useState<FacturaItem[] | undefined>(undefined);
  const [loading, setLoading] = useState(!!inv.sale_id);

  useEffect(() => {
    if (!inv.sale_id) { setLoading(false); return; }
    Promise.all([api.getSaleWithItems(inv.sale_id), api.listProducts().catch(() => [])])
      .then(([sw, products]) => {
        const unitById = new Map(products.map((p) => [p.id, p.is_weighable ? (p.unit || "kg") : "unidades"]));
        setItems(sw.items.map((it) => ({
          code: it.barcode, name: it.name, qty: it.qty,
          unit: (it.product_id != null ? unitById.get(it.product_id) : null) || "unidades",
          unitPriceCents: it.unit_price_cents,
          bonifPct: it.discount_pct, subtotalCents: it.subtotal_cents,
        })));
      })
      .catch(() => setItems(undefined))
      .finally(() => setLoading(false));
  }, [inv.sale_id]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg px-4 py-3 text-sm text-stone-500">Cargando…</div>
      </div>
    );
  }

  return (
    <FacturaPrint
      invoice={inv}
      emisor={{
        razonSocial: arcaConfig.razon_social || arcaConfig.cuit,
        cuit: arcaConfig.cuit,
        domicilio: arcaConfig.domicilio,
        condicionIva: arcaConfig.condicion_iva,
        ingresosBrutos: arcaConfig.ingresos_brutos,
        inicioActividades: arcaConfig.inicio_actividades ? fmtFechaArg(arcaConfig.inicio_actividades) : null,
      }}
      items={items}
      associatedInvoice={inv.credited_invoice_id != null ? invoices.find((o) => o.id === inv.credited_invoice_id) : undefined}
      onClose={onClose}
    />
  );
}

// ── Crear una factura suelta (sin venta de Caja detrás) ─────────────────────

function NuevaFacturaModal({ arcaConfig, onClose, onIssued }: { arcaConfig: ArcaConfig; onClose: () => void; onIssued: (inv: ElectronicInvoice) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [consumidorFinal, setConsumidorFinal] = useState(true);
  const [manualName, setManualName] = useState("");
  const [manualDoc, setManualDoc] = useState("");
  const [manualCondicionIva, setManualCondicionIva] = useState<CondicionIvaCliente>("consumidor_final");
  const [concepto, setConcepto] = useState("Venta de productos/servicios");
  const [montoStr, setMontoStr] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeToClose(onClose);

  useEffect(() => {
    if (consumidorFinal || query.trim().length === 0) { setResults([]); return; }
    api.listClients(query).then(setResults).catch(() => setResults([]));
  }, [query, consumidorFinal]);

  const buyerCondicionIva: CondicionIvaCliente = consumidorFinal ? "consumidor_final" : (client?.condicion_iva ?? manualCondicionIva);
  const { invoiceType, condicionIvaReceptorId, legend } = decideInvoiceType(arcaConfig.condicion_iva, buyerCondicionIva);

  const totalCents = arsStringToCents(montoStr);
  const netoCents = Math.round(totalCents / 1.21);
  const ivaCents = totalCents - netoCents;

  const dni = consumidorFinal ? "" : (client?.dni?.replace(/\D/g, "") || manualDoc.replace(/\D/g, ""));
  const docTipo = dni.length === 11 ? 80 : dni.length > 0 ? 96 : 99;
  const clientName = consumidorFinal ? null : (client?.name || manualName.trim() || null);

  async function submit() {
    if (totalCents <= 0) { setError("Ingresá un monto válido."); return; }
    setIssuing(true); setError(null);
    try {
      const inv = await api.issueElectronicInvoice({
        sale_id: null,
        invoice_type: invoiceType,
        total_cents: totalCents,
        neto_cents: invoiceType === "C" ? totalCents : netoCents,
        iva_cents: invoiceType === "C" ? 0 : ivaCents,
        client_cuit: dni.length > 0 ? dni : null,
        client_name: clientName,
        doc_tipo: docTipo,
        doc_nro: dni.length > 0 ? dni : "0",
        concepto: concepto.trim() || null,
        condicion_iva_receptor_id: condicionIvaReceptorId,
      });
      if (inv.status === "error") { setError(inv.error_msg || "ARCA rechazó la factura."); return; }
      onIssued(inv);
    } catch (e) {
      setError(String(e));
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-2xl w-[480px] p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <h2 className="font-semibold text-lg mb-4">Nueva factura</h2>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={consumidorFinal} onChange={(e) => { setConsumidorFinal(e.target.checked); setClient(null); }} />
            Consumidor Final (sin datos de cliente)
          </label>

          {!consumidorFinal && (
            <div className="space-y-2">
              {client ? (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{client.name}</div>
                    <div className="text-xs text-stone-500">
                      {client.dni ? `Doc. ${client.dni}` : "sin documento"} · {condicionIvaClienteLabel(client.condicion_iva)}
                    </div>
                  </div>
                  <button onClick={() => setClient(null)} className="text-xs text-stone-400 hover:text-stone-700">Cambiar</button>
                </div>
              ) : (
                <>
                  <input className="input text-sm" placeholder="Buscar cliente por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  {results.length > 0 && (
                    <ul className="border border-stone-200 rounded max-h-32 overflow-y-auto divide-y divide-stone-100">
                      {results.map((c) => (
                        <li key={c.id}>
                          <button onClick={() => { setClient(c); setResults([]); setQuery(""); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50">
                            {c.name} {c.dni && <span className="text-xs text-stone-400">· {c.dni}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-stone-400">¿No está en tu lista de clientes? Completá a mano:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input text-sm" placeholder="Nombre / Razón social" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                    <input className="input text-sm font-mono" placeholder="CUIT o DNI" value={manualDoc} onChange={(e) => setManualDoc(e.target.value)} />
                  </div>
                  <select
                    className="input text-sm"
                    value={manualCondicionIva}
                    onChange={(e) => setManualCondicionIva(e.target.value as CondicionIvaCliente)}
                  >
                    <option value="consumidor_final">Consumidor Final</option>
                    <option value="responsable_inscripto">Responsable Inscripto</option>
                    <option value="monotributo">Monotributista</option>
                    <option value="exento">Exento</option>
                  </select>
                </>
              )}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Concepto</span>
            <input className="input text-sm" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Venta de mercadería" />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Monto total</span>
            <input className="input text-sm" placeholder="$ 0,00" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} />
          </label>

          <div className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded px-3 py-2 text-sm">
            <span className="text-stone-500">Se va a emitir:</span>
            <span className={clsx("text-xs font-bold px-2 py-0.5 rounded", TYPE_COLOR[invoiceType])}>Factura {invoiceType}</span>
          </div>
          {legend && (
            <p className="text-[11px] text-stone-400 bg-stone-50 border border-stone-200 rounded p-2">
              Esta factura va a llevar la leyenda obligatoria de la Ley 27.618 (venta a Monotributista).
            </p>
          )}

          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

          <button onClick={submit} disabled={issuing} className="btn btn-primary w-full disabled:opacity-50">
            {issuing ? "Emitiendo…" : "Emitir factura"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Wizard de configuración ARCA ────────────────────────────────────────────

function ArcaSetup({ arcaConfig, onRefresh }: { arcaConfig: ArcaConfig | null; onRefresh: () => void }) {
  const [form, setForm] = useState<ArcaConfigInput>({
    cuit: arcaConfig?.cuit || "",
    razon_social: arcaConfig?.razon_social || "",
    punto_venta: arcaConfig?.punto_venta || 1,
    // Fijo en "prod" -- no se le muestra el selector de entorno al
    // comerciante (ver comentario de WSASS_HOMO_URL más arriba).
    environment: "prod",
    condicion_iva: arcaConfig?.condicion_iva || "monotributo",
    domicilio: arcaConfig?.domicilio || "",
    ingresos_brutos: arcaConfig?.ingresos_brutos || "",
    inicio_actividades: arcaConfig?.inicio_actividades || "",
  });
  const [savingCfg, setSavingCfg] = useState(false);
  const [csr, setCsr] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [loadingCert, setLoadingCert] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);

  async function saveCfg() {
    setSavingCfg(true);
    try {
      await api.saveArcaConfig({ ...form, cuit: form.cuit.trim().replace(/-/g, "") });
      onRefresh();
      showToast({ message: "Datos guardados", tone: "success" });
    } catch (e) { showToast({ message: `Error: ${e}`, tone: "danger" }); }
    finally { setSavingCfg(false); }
  }

  async function generateKey() {
    setGeneratingKey(true); setCsr(null);
    try { const csrPem = await api.generateArcaKeypair(); setCsr(csrPem); onRefresh(); }
    catch (e) { showToast({ message: String(e), tone: "danger" }); }
    finally { setGeneratingKey(false); }
  }

  async function loadCert(file: File) {
    setLoadingCert(true);
    try { const text = await file.text(); const msg = await api.loadArcaCertificate(text); showToast({ message: msg, tone: "success" }); onRefresh(); }
    catch (e) { showToast({ message: String(e), tone: "danger" }); }
    finally { setLoadingCert(false); }
  }

  async function testConn() {
    setTesting(true); setTestResult(null);
    try { setTestResult({ ok: true, msg: await api.testArcaConnection() }); }
    catch (e) { setTestResult({ ok: false, msg: String(e) }); }
    finally { setTesting(false); }
  }

  async function resetAll() {
    const ok = await confirmAction(
      "Se van a borrar el CUIT, el certificado y TODAS las facturas y notas de crédito emitidas hasta ahora (incluidas las autorizadas). Esto no afecta nada de tu ARCA real -- es solo lo guardado localmente. Vas a tener que configurar todo de nuevo desde el Paso 1.",
      { title: "¿Borrar toda la configuración de ARCA?", danger: true, confirmLabel: "Borrar todo" }
    );
    if (!ok) return;
    setResetting(true);
    try {
      await api.resetArcaData();
      setActiveStep(1);
      onRefresh();
      showToast({ message: "Configuración de ARCA borrada", tone: "success" });
    } catch (e) { showToast({ message: `Error: ${e}`, tone: "danger" }); }
    finally { setResetting(false); }
  }

  const step1Done = !!arcaConfig;
  const step2Done = !!arcaConfig?.has_certificate;
  const tokenValid = !!arcaConfig?.token_valid;

  // Un solo estado en criollo, arriba de todo -- para que quien no entiende
  // nada de ARCA sepa de un vistazo qué le falta, sin tener que leer los 3
  // pasos de abajo para armarse el panorama solo.
  const status: { text: string; sub: string; ok: boolean } = !step1Done
    ? { text: "Falta completar tus datos", sub: "Cargá tu CUIT y guardá el Paso 1 para arrancar.", ok: false }
    : !step2Done
    ? { text: "Falta cargar el certificado", sub: "Generá la clave y subí el archivo que te da ARCA en el Paso 2.", ok: false }
    : !tokenValid
    ? { text: "Falta probar la conexión", sub: "Con el certificado cargado, probá la conexión en el Paso 3 para terminar.", ok: false }
    : { text: "Todo listo — ya podés facturar", sub: "La Facturación Electrónica está activa y funcionando.", ok: true };

  // Wizard guiado: se muestra un paso por vez en vez de los 3 juntos, así no
  // abruma a quien nunca vio esto. Avanza solo cuando se completa un paso,
  // pero nunca fuerza para atrás -- y siempre se puede volver a pasos ya
  // hechos para corregir algo.
  const recommendedStep: 1 | 2 | 3 = !step1Done ? 1 : !step2Done ? 2 : 3;
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(recommendedStep);
  useEffect(() => {
    setActiveStep((prev) => (recommendedStep > prev ? recommendedStep : prev));
  }, [recommendedStep]);
  const maxReachable = Math.max(recommendedStep, activeStep) as 1 | 2 | 3;

  return (
    <div className="max-w-5xl">
      <div className={clsx("flex items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 border",
        status.ok ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
        <div className="flex items-center gap-3">
          <span className={clsx("w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0",
            status.ok ? "bg-emerald-500 text-white" : "bg-amber-400 text-white")}>
            {status.ok ? "✓" : "!"}
          </span>
          <div>
            <div className={clsx("text-sm font-semibold", status.ok ? "text-emerald-800" : "text-amber-800")}>{status.text}</div>
            <div className="text-xs text-stone-500">{status.sub}</div>
          </div>
        </div>
        <button
          onClick={() => openSupportWhatsapp("Hola! Necesito ayuda para configurar la Facturación Electrónica con ARCA en Mercalin.")}
          className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5"
        >
          💬 ¿Necesitás ayuda?
        </button>
      </div>

      <p className="text-sm text-stone-500 mb-4">
        Emitís facturas A, B y C directamente — sin intermediarios ni costo por factura. Configuración única por negocio.
      </p>

      {/* Indicador de pasos -- clic para volver a un paso ya hecho */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { n: 1 as const, label: "Datos", done: step1Done },
          { n: 2 as const, label: "Certificado", done: step2Done },
          { n: 3 as const, label: "Verificar", done: tokenValid },
        ]).map((s, i) => (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => s.n <= maxReachable && setActiveStep(s.n)}
              disabled={s.n > maxReachable}
              className={clsx(
                "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors w-full justify-center",
                activeStep === s.n ? "bg-indigo-600 text-white" :
                s.done ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" :
                s.n <= maxReachable ? "bg-stone-100 text-stone-600 hover:bg-stone-200" : "bg-stone-50 text-stone-300 cursor-not-allowed"
              )}
            >
              <span className={clsx("w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0",
                activeStep === s.n ? "bg-white text-indigo-600" : s.done ? "bg-emerald-500 text-white" : "bg-white text-stone-400")}>
                {s.done ? "✓" : s.n}
              </span>
              {s.label}
            </button>
            {i < 2 && <div className={clsx("h-0.5 flex-1 rounded", s.done ? "bg-emerald-300" : "bg-stone-200")} />}
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto">
        {/* Paso 1 */}
        {activeStep === 1 && (
        <div className="card p-6">
          <div className="space-y-4">
            <div className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded p-4 leading-relaxed">
              Estos son los datos que van a aparecer impresos en cada factura que emitas. Los mismos que tenés en tu
              constancia de inscripción de ARCA/AFIP (la podés descargar entrando a ARCA con tu Clave Fiscal → "Constancia de Inscripción").
            </div>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">CUIT (sin guiones)</span>
              <input className="input text-sm font-mono" value={form.cuit}
                onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))} placeholder="20123456789" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">Razón social</span>
              <input className="input text-sm" value={form.razon_social || ""}
                onChange={(e) => setForm((f) => ({ ...f, razon_social: e.target.value }))}
                placeholder="Tu nombre y apellido (o el de tu empresa)" />
              <span className="text-sm text-stone-400 block mt-1">Como figura en tu constancia de ARCA/AFIP.</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">Domicilio comercial</span>
              <input className="input text-sm" value={form.domicilio || ""}
                onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))}
                placeholder="Av. Corrientes 1234, CABA" />
              <span className="text-sm text-stone-400 block mt-1">Aparece impreso en la factura.</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">Tu condición frente al IVA</span>
              <select className="input text-sm" value={form.condicion_iva}
                onChange={(e) => setForm((f) => ({ ...f, condicion_iva: e.target.value as ArcaConfigInput["condicion_iva"] }))}>
                <option value="monotributo">Monotributista</option>
                <option value="responsable_inscripto">Responsable Inscripto</option>
              </select>
              <span className="text-sm text-stone-400 block mt-1">
                {form.condicion_iva === "monotributo"
                  ? "Solo vas a poder emitir Factura C."
                  : "Vas a poder emitir Factura A (a clientes RI) y B (al resto)."}
                {" "}¿No sabés cuál sos? Fijate en tu constancia de inscripción — la mayoría de los kioscos y comercios chicos son Monotributistas.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-sm font-medium text-stone-600 block mb-1">Ingresos Brutos</span>
                <input className="input text-sm" value={form.ingresos_brutos || ""}
                  onChange={(e) => setForm((f) => ({ ...f, ingresos_brutos: e.target.value }))}
                  placeholder="N° de inscripción o 'Exento'" />
                <span className="text-sm text-stone-400 block mt-1">Va impreso en la factura. Si no estás inscripta, poné "Exento".</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-stone-600 block mb-1">Inicio de actividades</span>
                <input className="input text-sm" type="date" value={form.inicio_actividades || ""}
                  onChange={(e) => setForm((f) => ({ ...f, inicio_actividades: e.target.value }))} />
                <span className="text-sm text-stone-400 block mt-1">Fecha que figura en tu constancia de ARCA.</span>
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">Punto de venta</span>
              <input className="input text-sm tabular" type="number" min="1" max="999"
                value={form.punto_venta} onChange={(e) => setForm((f) => ({ ...f, punto_venta: Number(e.target.value) }))} />
              <span className="text-sm text-stone-400 block mt-1">El número que ARCA te asignó (casi siempre es el 1).</span>
            </label>
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              ⚠ Esta conexión es real: las facturas que emitas van a quedar en tu cuenta de ARCA de verdad.
            </div>
            <div className="flex gap-2">
              <button onClick={saveCfg} disabled={savingCfg} className="btn btn-primary flex-1 text-sm">
                {savingCfg ? "Guardando…" : "Guardar"}
              </button>
              {step1Done && (
                <button onClick={() => setActiveStep(2)} className="btn btn-secondary text-sm">
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Paso 2 */}
        {activeStep === 2 && (
        <div className="card p-6">
          <div className="space-y-6">
            <div className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded p-4 leading-relaxed">
              <strong>¿Para qué es esto?</strong> Es como una firma digital que le prueba a ARCA que las facturas salen
              realmente de tu sistema y no de otro lado. Se pide una sola vez. La clave privada se genera y se queda
              en esta computadora — nunca se manda a ningún lado, ni siquiera a ARCA.
            </div>

            {/* Sub-paso 1: generar clave */}
            <div>
              <p className="text-base font-semibold text-stone-700 mb-2">1. Generá tu clave (acá, en esta app)</p>
              <button onClick={generateKey} disabled={generatingKey} className="btn btn-secondary w-full text-sm disabled:opacity-50">
                {generatingKey ? "Generando…" : csr || step2Done ? "Generar de nuevo" : "Generar clave y CSR"}
              </button>
              {csr && (
                <div className="mt-3 space-y-2">
                  <div className="bg-stone-900 rounded p-2 max-h-20 overflow-y-auto">
                    <pre className="text-sm text-green-400 whitespace-pre-wrap break-all">{csr}</pre>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => navigator.clipboard.writeText(csr)} className="text-sm text-sky-600 hover:underline">
                      📋 Copiar este texto
                    </button>
                    <button onClick={() => downloadTextFile("mercalin.csr", csr)} className="text-sm text-sky-600 hover:underline">
                      💾 Descargar como archivo (.csr)
                    </button>
                  </div>
                  <p className="text-sm text-stone-400">Lo vas a necesitar en el Paso 2 — algunas pantallas de ARCA piden pegar el texto, otras piden subir el archivo.</p>
                </div>
              )}
            </div>

            {/* Sub-paso 2: pedirlo en ARCA -- SIEMPRE visible, no depende de haber generado la clave recién.
                Testing y Producción son trámites DISTINTOS en ARCA (nombres de menú distintos), no la misma
                pantalla con otra URL -- por eso las instrucciones cambian según el entorno elegido. */}
            <div>
              <p className="text-base font-semibold text-stone-700 mb-2">2. Pedí el certificado en la web de ARCA</p>
              {form.environment === "prod" ? (
                <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded p-2.5 font-medium">
                    ⚠ Estás en Producción: el certificado que generes acá va a poder emitir facturas reales.
                  </div>
                  <button
                    onClick={() => openUrl(ARCA_PORTAL_URL)}
                    className="w-full text-left bg-white border border-amber-300 rounded px-3 py-2.5 text-amber-800 font-medium hover:bg-amber-100"
                  >
                    🔗 Abrir el portal de ARCA
                  </button>
                  <div className="text-sm text-stone-400">
                    Si el botón no abre nada, copiá y pegá esta dirección en el navegador:<br />
                    <code className="select-all bg-white border border-stone-200 rounded px-1.5 py-0.5 inline-block mt-1 break-all">{ARCA_PORTAL_URL}</code>
                  </div>
                  <div className="space-y-2.5">
                    <NumberedStep n={1}>Ingresá con tu <strong>Clave Fiscal</strong> (nivel 3 o superior).</NumberedStep>
                    <NumberedStep n={2}>En el buscador de servicios de ARCA, escribí y abrí <strong>"Administración de Certificados Digitales"</strong>. Si no te aparece en la lista, primero hay que sumarlo desde "Administrador de Relaciones de Clave Fiscal" → buscarlo y adherirlo.</NumberedStep>
                    <NumberedStep n={3}>Si tenés más de una empresa/CUIT a tu nombre, seleccioná la que corresponde.</NumberedStep>
                    <NumberedStep n={4}>Tocá <strong>"Agregar alias"</strong>.</NumberedStep>
                    <NumberedStep n={5}>Completá el campo <strong>"Alias"</strong> con un nombre para reconocerlo (por ejemplo el nombre de tu negocio, solo letras y números).</NumberedStep>
                    <NumberedStep n={6}>Te va a pedir el archivo del CSR — usá el que descargaste en el Paso 1 ("mercalin.csr"). Si en cambio te pide pegar el texto, usá el botón "Copiar" de arriba.</NumberedStep>
                    <NumberedStep n={7}>Confirmá con <strong>"Agregar Alias"</strong>. En la lista que aparece, tocá <strong>"Ver"</strong> y después <strong>"Descargar"</strong> — ese archivo es tu certificado.</NumberedStep>
                  </div>
                  <p className="text-sm text-stone-500 pt-2 border-t border-amber-200">
                    Estos nombres de menú pueden variar un poco según cómo esté organizado tu ARCA. Si te trabás, tocá "¿Necesitás ayuda?" arriba de todo y escribinos.
                  </p>
                </div>
              ) : (
                <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
                  <button
                    onClick={() => openUrl(WSASS_HOMO_URL)}
                    className="w-full text-left bg-white border border-amber-300 rounded px-3 py-2.5 text-amber-800 font-medium hover:bg-amber-100"
                  >
                    🔗 Abrir WSASS (Testing)
                  </button>
                  <div className="text-sm text-stone-400">
                    Si el botón no abre nada, copiá y pegá esta dirección en el navegador:<br />
                    <code className="select-all bg-white border border-stone-200 rounded px-1.5 py-0.5 inline-block mt-1 break-all">{WSASS_HOMO_URL}</code>
                  </div>
                  <div className="space-y-2.5">
                    <NumberedStep n={1}>Te va a pedir tu <strong>Clave Fiscal</strong> (la misma con la que entrás a ARCA/AFIP normalmente) — ingresala.</NumberedStep>
                    <NumberedStep n={2}>Del lado izquierdo de la pantalla hay una lista de opciones. Buscá la que dice <strong>"Nuevo Certificado"</strong> y tocala — te va a abrir una página que dice <strong>"Crear DN y certificado"</strong>.<br /><HelpImageButton src={imgCrearDn} alt="Formulario Crear DN y certificado en WSASS" /></NumberedStep>
                    <NumberedStep n={3}>Va a aparecer un cuadro de texto grande (dice "Solicitud de certificado"). Pegá ahí el texto que copiaste en el Paso 1 (Ctrl+V, o mantené apretado y elegí "Pegar").</NumberedStep>
                    <NumberedStep n={4}>Más arriba te va a pedir un <strong>alias</strong> ("Nombre simbólico del DN"): es solo un nombre para reconocerlo después, podés poner el que quieras — por ejemplo el nombre de tu negocio.<br /><span className="text-amber-700">Importante: solo letras y números, sin guiones ni espacios (ej. "mikiosco", no "mi-kiosco").</span></NumberedStep>
                    <NumberedStep n={5}>Tocá el botón <strong>"Crear DN y obtener certificado"</strong>. Más abajo va a aparecer un resultado y la posibilidad de <strong>descargar un archivo</strong> — descargalo, es tu certificado.</NumberedStep>
                  </div>
                  <p className="text-sm text-stone-500 pt-2 border-t border-amber-200">
                    ¿No encontrás "Nuevo Certificado" en el menú? Arriba de la página de ARCA suele haber una lupa o buscador — escribí "certificado" ahí.
                    Si igual te trabás, tocá "¿Necesitás ayuda?" arriba de todo y escribinos.
                  </p>
                </div>
              )}
            </div>

            {/* Sub-paso 3: subir el archivo */}
            <div>
              <p className="text-base font-semibold text-stone-700 mb-2">3. Subí ese archivo acá</p>
              <input ref={certInputRef} type="file" accept=".crt,.pem,.cer" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadCert(f); }} />
              <button onClick={() => certInputRef.current?.click()} disabled={loadingCert} className="btn btn-secondary w-full text-sm">
                {loadingCert ? "Cargando…" : step2Done ? "✓ Cargado — reemplazar" : "Cargar el archivo que descargaste"}
              </button>
              <span className="text-sm text-stone-400 block mt-1">Es el archivo que bajaste en el Paso 2, adentro de ARCA.</span>
            </div>

            <div className="flex gap-2 pt-1 border-t border-stone-100">
              <button onClick={() => setActiveStep(1)} className="text-sm text-stone-400 hover:text-stone-700">← Volver</button>
              {step2Done && (
                <button onClick={() => setActiveStep(3)} className="btn btn-secondary text-sm ml-auto">
                  Continuar →
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Paso 3 */}
        {activeStep === 3 && (
        <div className="card p-6">
          <div className="space-y-6">
            <div className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded p-4 leading-relaxed">
              <strong>Un paso más antes de probar:</strong> tenés que decirle a ARCA que ese certificado puede usarse
              específicamente para facturar (no alcanza con haberlo creado).
            </div>
            {form.environment === "prod" ? (
              <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
                <button
                  onClick={() => openUrl(ARCA_PORTAL_URL)}
                  className="w-full text-left bg-white border border-amber-300 rounded px-3 py-2.5 text-amber-800 font-medium hover:bg-amber-100"
                >
                  🔗 Abrir el portal de ARCA
                </button>
                <div className="text-sm text-stone-400">
                  Si el botón no abre nada, copiá y pegá esta dirección en el navegador:<br />
                  <code className="select-all bg-white border border-stone-200 rounded px-1.5 py-0.5 inline-block mt-1 break-all">{ARCA_PORTAL_URL}</code>
                </div>
                <div className="space-y-2.5">
                  <NumberedStep n={1}>Ingresá con tu Clave Fiscal (si te la pide de nuevo).</NumberedStep>
                  <NumberedStep n={2}>En el buscador de servicios, escribí y abrí <strong>"Administrador de Relaciones de Clave Fiscal"</strong>.</NumberedStep>
                  <NumberedStep n={3}>Si administrás más de un CUIT, seleccioná el que corresponde.</NumberedStep>
                  <NumberedStep n={4}>Tocá <strong>"Nueva Relación"</strong>.</NumberedStep>
                  <NumberedStep n={5}>En "Representado" va a aparecer tu propio CUIT por defecto — dejalo así.</NumberedStep>
                  <NumberedStep n={6}>Tocá el primer botón <strong>"Buscar"</strong>, abrí "ARCA {'>'} Web Services" y elegí <strong>"Facturación Electrónica"</strong>.</NumberedStep>
                  <NumberedStep n={7}>Tocá el segundo botón <strong>"Buscar"</strong> y elegí el certificado (el alias) que creaste en el Paso 2.</NumberedStep>
                  <NumberedStep n={8}>Tocá <strong>"Confirmar"</strong>, y confirmá otra vez cuando te lo vuelva a pedir. Con eso queda autorizado.</NumberedStep>
                </div>
                <p className="text-sm text-stone-500 pt-2 border-t border-amber-200">
                  ¿Te trabaste en algún punto? Tocá "¿Necesitás ayuda?" arriba de todo y escribinos por WhatsApp.
                </p>
              </div>
            ) : (
              <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
                <button
                  onClick={() => openUrl(WSASS_HOMO_URL)}
                  className="w-full text-left bg-white border border-amber-300 rounded px-3 py-2.5 text-amber-800 font-medium hover:bg-amber-100"
                >
                  🔗 Abrir WSASS de nuevo
                </button>
                <div className="text-sm text-stone-400">
                  Si el botón no abre nada, copiá y pegá esta dirección en el navegador:<br />
                  <code className="select-all bg-white border border-stone-200 rounded px-1.5 py-0.5 inline-block mt-1 break-all">{WSASS_HOMO_URL}</code>
                </div>
                <div className="space-y-2.5">
                  <NumberedStep n={1}>Ingresá con tu Clave Fiscal (si te la pide de nuevo).</NumberedStep>
                  <NumberedStep n={2}>Del lado izquierdo, buscá <strong>"Crear autorización a servicio"</strong> y tocala.</NumberedStep>
                  <NumberedStep n={3}>En "Nombre simbólico del DN a autorizar", elegí el alias que creaste en el Paso 2 (el nombre que le hayas puesto).</NumberedStep>
                  <NumberedStep n={4}>En "CUIT representado", va a aparecer tu propio CUIT — dejalo así.</NumberedStep>
                  <NumberedStep n={5}>En "Servicio al que desea acceder" va a aparecer una lista larga. Buscá el que dice <strong>wsfe - Facturacion Electronica</strong> — si no lo encontrás a simple vista, apretá Ctrl+F en el teclado, escribí "wsfe" y Enter para que el navegador lo resalte.<br /><HelpImageButton src={imgListaServicios} alt="Lista de servicios en WSASS" label="Ver cómo es la lista" /></NumberedStep>
                  <NumberedStep n={6}>Elegilo y tocá <strong>"Crear autorización de acceso"</strong>. Con eso queda autorizado.<br /><HelpImageButton src={imgAutorizacion} alt="Formulario de autorización completo" label="Ver ejemplo completo" /></NumberedStep>
                </div>
                <p className="text-sm text-stone-500 pt-2 border-t border-amber-200">
                  ¿Te trabaste en algún punto? Tocá "¿Necesitás ayuda?" arriba de todo y escribinos por WhatsApp.
                </p>
              </div>
            )}
            <p className="text-sm text-stone-500">
              Recién ahora tiene sentido probar. Necesitás conexión a internet.
            </p>
            <button onClick={testConn} disabled={testing} className="btn btn-primary w-full text-sm">
              {testing ? "Conectando…" : "Probar conexión"}
            </button>
            {testResult && (
              <div className={clsx("text-sm rounded p-3", testResult.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200")}>
                {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
              </div>
            )}
            {arcaConfig?.token_expires_at && (
              <p className="text-sm text-stone-500">
                Token válido hasta{" "}
                <span className="font-medium">{new Date(arcaConfig.token_expires_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                {" "}· se renueva solo
              </p>
            )}
            <div className="text-sm text-stone-500 bg-stone-50 rounded p-2 border border-stone-200 space-y-0.5">
              <p className="font-semibold text-stone-700">Tipos disponibles:</p>
              <p>{arcaConfig?.condicion_iva === "responsable_inscripto" ? "Factura A · Factura B" : "Factura C"}</p>
            </div>
            <button onClick={() => setActiveStep(2)} className="text-sm text-stone-400 hover:text-stone-700">← Volver</button>
          </div>
        </div>
        )}
      </div>

      {arcaConfig && (
        <div className="mt-8 border-t border-stone-200 pt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Zona de peligro</p>
          <p className="text-sm text-stone-500 mb-2">
            Borra el CUIT, el certificado y todo el historial de facturas/notas de crédito guardado en esta compu.
            No toca nada de tu ARCA real. Útil para descartar pruebas antes de pasar a Producción.
          </p>
          <button onClick={resetAll} disabled={resetting} className="btn text-sm bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50">
            {resetting ? "Borrando…" : "🗑️ Borrar configuración y facturas de ARCA"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Modal detalle de factura ─────────────────────────────────────────────────

function InvoiceDetail({ inv, onClose, onPrint }: { inv: ElectronicInvoice; onClose: () => void; onPrint?: () => void }) {
  const ivaRate = inv.neto_cents > 0 ? ((inv.iva_cents / inv.neto_cents) * 100).toFixed(0) : "0";
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-xl shadow-2xl w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="flex items-start justify-between mb-4 pr-6">
          <div>
            <h2 className="font-semibold text-lg">{inv.credited_invoice_id != null ? `Nota de Crédito ${inv.invoice_type}` : `Factura ${inv.invoice_type}`}</h2>
            <p className="text-sm text-stone-500 font-mono mt-0.5">{formatCbteNro(inv.cbte_nro, inv.punto_venta)}</p>
          </div>
          <span className={clsx("text-xs font-bold px-2.5 py-1 rounded-full", STATUS_COLOR[inv.status])}>
            {STATUS_LABEL[inv.status]}
          </span>
        </div>
        <dl className="space-y-2 text-sm">
          {inv.client_name && <div className="flex justify-between"><dt className="text-stone-500">Cliente</dt><dd className="font-medium">{inv.client_name}</dd></div>}
          {inv.client_cuit && <div className="flex justify-between"><dt className="text-stone-500">CUIT cliente</dt><dd className="font-mono text-xs">{inv.client_cuit}</dd></div>}
          <div className="flex justify-between border-t border-stone-100 pt-2"><dt className="text-stone-500">Neto gravado</dt><dd>{centsToARS(inv.neto_cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-stone-500">IVA ({ivaRate}%)</dt><dd>{centsToARS(inv.iva_cents)}</dd></div>
          <div className="flex justify-between font-semibold text-base border-t border-stone-100 pt-2"><dt>Total</dt><dd>{centsToARS(inv.total_cents)}</dd></div>
          {inv.cae && <>
            <div className="flex justify-between border-t border-stone-100 pt-2"><dt className="text-stone-500">CAE</dt><dd className="font-mono text-xs">{inv.cae}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Vto. CAE</dt><dd className="text-xs">{inv.cae_expires_at}</dd></div>
          </>}
          {inv.error_msg && <div className="mt-2 p-3 bg-red-50 text-red-700 text-xs rounded border border-red-200">{inv.error_msg}</div>}
          <div className="flex justify-between text-xs text-stone-400 border-t border-stone-100 pt-2">
            <dt>Emitida</dt><dd>{new Date(inv.created_at).toLocaleString("es-AR")}</dd>
          </div>
        </dl>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
          {onPrint && <button onClick={onPrint} className="btn btn-primary flex-1">🖨️ Ver factura</button>}
        </div>
      </div>
    </div>
  );
}
