import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS } from "@/lib/format";
import type { ArcaConfig, ArcaConfigInput, ElectronicInvoice } from "@/types";
import clsx from "clsx";

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

function formatCbteNro(nro: number | null, pv: number): string {
  if (!nro) return "—";
  return `${String(pv).padStart(4, "0")}-${String(nro).padStart(8, "0")}`;
}

export default function Facturacion() {
  const [tab, setTab] = useState<Tab>("facturas");
  const [invoices, setInvoices] = useState<ElectronicInvoice[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [selected, setSelected] = useState<ElectronicInvoice | null>(null);

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
      if (count > 0) { alert(`✓ ${count} factura${count !== 1 ? "s" : ""} autorizada${count !== 1 ? "s" : ""}`); load(); }
      else alert("Sin facturas pendientes o sin conexión a ARCA.");
    } catch (e) { alert(`Error: ${e}`); }
    finally { setRetrying(false); }
  }

  const pendientes = invoices.filter((i) => i.status === "pendiente");
  const autorizadas = invoices.filter((i) => i.status === "autorizada");
  const errores = invoices.filter((i) => i.status === "error");
  const today = new Date().toISOString().split("T")[0];
  const hoy = invoices.filter((i) => i.created_at.startsWith(today) && i.status === "autorizada");
  const totalHoy = hoy.reduce((s, i) => s + i.total_cents, 0);

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
                tab === t.id ? "border-sky-600 text-sky-600" : "border-transparent text-stone-500 hover:text-stone-800")}>
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
                  CUIT {arcaConfig.cuit} · PV {arcaConfig.punto_venta} ·{" "}
                  <span className={arcaConfig.environment === "prod" ? "text-emerald-600" : "text-amber-600"}>
                    {arcaConfig.environment === "prod" ? "Producción" : "Testing (homo)"}
                  </span>
                </p>
              )}
              {!arcaConfig && (
                <p className="text-xs text-amber-600">
                  ARCA no configurado — andá a la pestaña "Configuración ARCA"
                </p>
              )}
              {pendientes.length > 0 && (
                <button onClick={retry} disabled={retrying} className="btn btn-primary text-sm disabled:opacity-50">
                  {retrying ? "Procesando…" : `↻ Reintentar ${pendientes.length} pendiente${pendientes.length !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Emitidas hoy", value: hoy.length, sub: centsToARS(totalHoy), color: "text-emerald-600" },
                { label: "Total autorizadas", value: autorizadas.length, sub: "históricas", color: "text-stone-800" },
                { label: "Pendientes", value: pendientes.length, sub: "sin CAE", color: pendientes.length > 0 ? "text-amber-600" : "text-stone-400" },
                { label: "Errores", value: errores.length, sub: "rechazadas", color: errores.length > 0 ? "text-red-600" : "text-stone-400" },
              ].map((k) => (
                <div key={k.label} className="card p-4">
                  <div className="text-xs text-stone-500 mb-1">{k.label}</div>
                  <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                  <div className="text-xs text-stone-400 mt-0.5">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Tabla */}
            <div className="flex-1 card overflow-hidden flex flex-col">
              <div className="overflow-y-auto flex-1">
                {invoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-400 text-sm gap-2">
                    <span className="text-3xl">🧾</span>
                    Las facturas se generan desde Caja después de cada venta.
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
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-stone-50">
                          <td className="py-2.5 px-4">
                            <span className={clsx("text-xs font-bold px-2 py-0.5 rounded", TYPE_COLOR[inv.invoice_type] || "bg-stone-100 text-stone-600")}>
                              Fact. {inv.invoice_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-stone-600">{formatCbteNro(inv.cbte_nro, inv.punto_venta)}</td>
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
                          <td className="py-2.5 px-4">
                            <button onClick={() => setSelected(inv)} className="text-xs text-stone-400 hover:text-stone-700">Ver</button>
                          </td>
                        </tr>
                      ))}
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
              onRefresh={() => api.getArcaConfig().then(setArcaConfig)}
            />
          </div>
        )}
      </div>

      {selected && <InvoiceDetail inv={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Wizard de configuración ARCA ────────────────────────────────────────────

function ArcaSetup({ arcaConfig, onRefresh }: { arcaConfig: ArcaConfig | null; onRefresh: () => void }) {
  const [form, setForm] = useState<ArcaConfigInput>({
    cuit: arcaConfig?.cuit || "",
    razon_social: arcaConfig?.razon_social || "",
    punto_venta: arcaConfig?.punto_venta || 1,
    environment: arcaConfig?.environment || "homo",
  });
  const [savingCfg, setSavingCfg] = useState(false);
  const [csr, setCsr] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [loadingCert, setLoadingCert] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);

  async function saveCfg() {
    setSavingCfg(true);
    try {
      await api.saveArcaConfig({ ...form, cuit: form.cuit.trim().replace(/-/g, "") });
      onRefresh();
    } catch (e) { alert(`Error: ${e}`); }
    finally { setSavingCfg(false); }
  }

  async function generateKey() {
    setGeneratingKey(true); setCsr(null);
    try { const csrPem = await api.generateArcaKeypair(); setCsr(csrPem); onRefresh(); }
    catch (e) { alert(`${e}`); }
    finally { setGeneratingKey(false); }
  }

  async function loadCert(file: File) {
    setLoadingCert(true);
    try { const text = await file.text(); const msg = await api.loadArcaCertificate(text); alert(msg); onRefresh(); }
    catch (e) { alert(`${e}`); }
    finally { setLoadingCert(false); }
  }

  async function testConn() {
    setTesting(true); setTestResult(null);
    try { setTestResult({ ok: true, msg: await api.testArcaConnection() }); }
    catch (e) { setTestResult({ ok: false, msg: String(e) }); }
    finally { setTesting(false); }
  }

  const step1Done = !!arcaConfig;
  const step2Done = !!arcaConfig?.has_certificate;

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-stone-500 mb-4">
        Emitís facturas A, B y C directamente — sin intermediarios ni costo por factura. Configuración única por negocio.
      </p>

      <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 flex gap-3">
        <span className="text-lg leading-none">🚧</span>
        <div>
          <p className="text-sm font-semibold text-amber-900">La generación del certificado todavía no está disponible</p>
          <p className="text-xs text-amber-700 mt-1">
            Podés cargar los datos del Paso 1 desde ahora para tenerlos listos. El Paso 2 (certificado) y el Paso 3
            (verificación) están en desarrollo — te vamos a avisar apenas se puedan completar.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Paso 1 */}
        <div className={clsx("card p-4", step1Done && "ring-1 ring-emerald-200")}>
          <div className="flex items-center gap-2 mb-3">
            <span className={clsx("w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center",
              step1Done ? "bg-emerald-500 text-white" : "bg-stone-200 text-stone-600")}>
              {step1Done ? "✓" : "1"}
            </span>
            <span className="text-sm font-semibold">Datos</span>
          </div>
          <div className="space-y-2.5">
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">CUIT (sin guiones)</span>
              <input className="input text-sm font-mono" value={form.cuit}
                onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))} placeholder="20123456789" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Razón social</span>
              <input className="input text-sm" value={form.razon_social || ""}
                onChange={(e) => setForm((f) => ({ ...f, razon_social: e.target.value }))} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-medium text-stone-600 block mb-1">Punto de venta</span>
                <input className="input text-sm tabular" type="number" min="1" max="999"
                  value={form.punto_venta} onChange={(e) => setForm((f) => ({ ...f, punto_venta: Number(e.target.value) }))} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-stone-600 block mb-1">Entorno</span>
                <select className="input text-sm" value={form.environment}
                  onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}>
                  <option value="homo">Testing</option>
                  <option value="prod">Producción</option>
                </select>
              </label>
            </div>
            <button onClick={saveCfg} disabled={savingCfg} className="btn btn-primary w-full text-sm">
              {savingCfg ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>

        {/* Paso 2 */}
        <div className={clsx("card p-4", !step1Done && "opacity-40 pointer-events-none", step2Done && "ring-1 ring-emerald-200")}>
          <div className="flex items-center gap-2 mb-3">
            <span className={clsx("w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center",
              step2Done ? "bg-emerald-500 text-white" : "bg-stone-200 text-stone-600")}>
              {step2Done ? "✓" : "2"}
            </span>
            <span className="text-sm font-semibold">Certificado</span>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-stone-500">Generá el par de claves RSA. La clave privada nunca sale de esta PC.</p>
            <button disabled title="Todavía en desarrollo" className="btn btn-secondary w-full text-sm opacity-50 cursor-not-allowed">
              Próximamente
            </button>
            {csr && (
              <div className="space-y-2">
                <div className="bg-stone-900 rounded p-2 max-h-24 overflow-y-auto">
                  <pre className="text-[10px] text-green-400 whitespace-pre-wrap break-all">{csr}</pre>
                </div>
                <button onClick={() => navigator.clipboard.writeText(csr)} className="text-xs text-sky-600 hover:underline">
                  Copiar CSR al portapapeles
                </button>
                <p className="text-xs text-stone-500 bg-amber-50 border border-amber-200 rounded p-2">
                  Ir a ARCA → Administración de Certificados → Nueva solicitud → pegar este texto → descargar el .crt
                </p>
              </div>
            )}
            <div className="pt-2 border-t border-stone-100">
              <input ref={certInputRef} type="file" accept=".crt,.pem,.cer" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadCert(f); }} />
              <button onClick={() => certInputRef.current?.click()} disabled={loadingCert} className="btn btn-secondary w-full text-sm">
                {loadingCert ? "Cargando…" : step2Done ? "Reemplazar certificado" : "Cargar .crt de ARCA"}
              </button>
            </div>
          </div>
        </div>

        {/* Paso 3 */}
        <div className={clsx("card p-4", !step2Done && "opacity-40 pointer-events-none")}>
          <div className="flex items-center gap-2 mb-3">
            <span className={clsx("w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center",
              arcaConfig?.token_valid ? "bg-emerald-500 text-white" : "bg-stone-200 text-stone-600")}>
              {arcaConfig?.token_valid ? "✓" : "3"}
            </span>
            <span className="text-sm font-semibold">Verificar</span>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-stone-500">Probá que el sistema pueda conectarse a ARCA. Necesitás internet.</p>
            <button onClick={testConn} disabled={testing} className="btn btn-primary w-full text-sm">
              {testing ? "Conectando…" : "Probar conexión"}
            </button>
            {testResult && (
              <div className={clsx("text-xs rounded p-2.5", testResult.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200")}>
                {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
              </div>
            )}
            {arcaConfig?.token_expires_at && (
              <p className="text-xs text-stone-500">
                Token válido hasta{" "}
                <span className="font-medium">{new Date(arcaConfig.token_expires_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                {" "}· se renueva solo
              </p>
            )}
            <div className="text-xs text-stone-500 bg-stone-50 rounded p-2 border border-stone-200 space-y-0.5">
              <p className="font-semibold text-stone-700">Tipos disponibles:</p>
              <p>Factura A · Factura B · Factura C</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal detalle de factura ─────────────────────────────────────────────────

function InvoiceDetail({ inv, onClose }: { inv: ElectronicInvoice; onClose: () => void }) {
  const ivaRate = inv.neto_cents > 0 ? ((inv.iva_cents / inv.neto_cents) * 100).toFixed(0) : "0";
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">Factura {inv.invoice_type}</h2>
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
        <button onClick={onClose} className="btn btn-secondary w-full mt-5">Cerrar</button>
      </div>
    </div>
  );
}
