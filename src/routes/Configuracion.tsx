import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { BackupInfo, ConfigEntry, DeptButton, DeviceConfig, NetworkInfo } from "@/types";
import { arsStringToCents, centsToARS } from "@/lib/format";
import clsx from "clsx";

type Tab = "general" | "finanzas" | "backup" | "sistema";

const TABS: { id: Tab; label: string }[] = [
  { id: "general",  label: "General" },
  { id: "finanzas", label: "Finanzas" },
  { id: "backup",   label: "Respaldo" },
  { id: "sistema",  label: "Sistema" },
];

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>("general");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [deptButtons, setDeptButtons] = useState<DeptButton[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backing, setBacking] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [serverAddrInput, setServerAddrInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [connectError, setConnectError] = useState(false);

  async function load() {
    const entries = await api.getAllConfig();
    const map: Record<string, string> = {};
    entries.forEach((e) => (map[e.key] = e.value));
    setConfig(map);
    try { setDeptButtons(JSON.parse(map.dept_buttons || "[]")); } catch { setDeptButtons([]); }
    api.listBackups().then(setBackups).catch(console.error);
    api.getNetworkInfo().then(setNetworkInfo).catch(console.error);
    api.getDeviceConfig().then(setDeviceConfig).catch(console.error);
    api.autoBackupCheck().catch(console.error);
    setLoading(false);
  }

  async function setServerMode(enabled: boolean) {
    const next: DeviceConfig = { mode: enabled ? "server" : "standalone", serverAddr: null };
    await api.setDeviceConfig(next);
    setDeviceConfig(next);
  }

  async function doConnectAsClient() {
    const addr = serverAddrInput.trim();
    if (!addr) return;
    setConnecting(true);
    setConnectMsg(null);
    setConnectError(false);
    try {
      const msg = await api.bootstrapFromServer(addr);
      setConnectMsg(msg);
      setDeviceConfig({ mode: "client", serverAddr: addr });
    } catch (e) {
      setConnectError(true);
      setConnectMsg(e instanceof Error ? e.message : "No se pudo conectar.");
    } finally {
      setConnecting(false);
    }
  }

  async function doDisconnectClient() {
    await api.disconnectClient();
    setDeviceConfig({ mode: "standalone", serverAddr: null });
    setConnectMsg(null);
  }

  useEffect(() => { load(); }, []);

  function setField(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const entries: ConfigEntry[] = Object.entries(config)
        .filter(([k]) => k !== "dept_buttons")
        .map(([key, value]) => ({ key, value }));
      entries.push({ key: "dept_buttons", value: JSON.stringify(deptButtons) });
      await api.setMultipleConfig(entries);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      api.getNetworkInfo().then(setNetworkInfo).catch(console.error);
    } finally { setSaving(false); }
  }

  function addDeptBtn() { setDeptButtons([...deptButtons, { label: "", price_cents: 0 }]); }
  function updateDeptBtn(i: number, field: keyof DeptButton, val: string) {
    const next = [...deptButtons];
    if (field === "price_cents") next[i] = { ...next[i], price_cents: arsStringToCents(val) };
    else next[i] = { ...next[i], [field]: val };
    setDeptButtons(next);
  }
  function removeDeptBtn(i: number) { setDeptButtons(deptButtons.filter((_, idx) => idx !== i)); }

  async function doBackup() {
    setBacking(true); setBackupMsg(null);
    try {
      const name = await api.backupDatabase();
      setBackupMsg(`✓ Backup creado: ${name}`);
      api.listBackups().then(setBackups).catch(console.error);
    } catch (e) { setBackupMsg(`Error: ${e}`); }
    finally { setBacking(false); }
  }

  async function doDeleteBackup(name: string) {
    if (!confirm(`¿Eliminar backup "${name}"?`)) return;
    try { await api.deleteBackup(name); setBackups((p) => p.filter((b) => b.name !== name)); }
    catch (e) { alert(`Error: ${e}`); }
  }

  function formatBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  if (loading) return <div className="p-4 text-stone-400">Cargando…</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Header con tabs */}
      <div className="bg-white border-b border-stone-200 px-6 pt-5 pb-0 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-3">Configuración</h1>
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                  tab === t.id
                    ? "border-sky-600 text-sky-600"
                    : "border-transparent text-stone-500 hover:text-stone-800"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={save} disabled={saving} className="btn btn-primary mb-3 disabled:opacity-60">
          {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar cambios"}
        </button>
      </div>

      {/* Contenido del tab */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── GENERAL ─────────────────────────────────────────── */}
        {tab === "general" && (
          <div className="max-w-2xl space-y-5">
            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Datos del negocio</h2>
              <div className="space-y-3">
                <Field label="Nombre del negocio">
                  <input className="input" value={config.business_name || ""} onChange={(e) => setField("business_name", e.target.value)} placeholder="Mi Kiosco" />
                </Field>
                <Field label="Dirección">
                  <input className="input" value={config.business_address || ""} onChange={(e) => setField("business_address", e.target.value)} placeholder="Av. Corrientes 1234" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Teléfono">
                    <input className="input" value={config.business_phone || ""} onChange={(e) => setField("business_phone", e.target.value)} placeholder="1122334455" />
                  </Field>
                  <Field label="CUIT">
                    <input className="input font-mono" value={config.business_cuit || ""} onChange={(e) => setField("business_cuit", e.target.value)} placeholder="20-00000000-0" />
                  </Field>
                </div>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Ticket de venta</h2>
              <Field label="Mensaje al pie del ticket">
                <input className="input" value={config.ticket_footer || ""} onChange={(e) => setField("ticket_footer", e.target.value)} placeholder="¡Gracias por su compra!" />
              </Field>
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Listas de precios</h2>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Lista 1"><input className="input" value={config.price1_name || ""} onChange={(e) => setField("price1_name", e.target.value)} placeholder="Minorista" /></Field>
                <Field label="Lista 2"><input className="input" value={config.price2_name || ""} onChange={(e) => setField("price2_name", e.target.value)} placeholder="Mayorista" /></Field>
                <Field label="Lista 3"><input className="input" value={config.price3_name || ""} onChange={(e) => setField("price3_name", e.target.value)} placeholder="Especial" /></Field>
              </div>
            </section>

            <section className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-sm">Botones rápidos de venta</h2>
                <button onClick={addDeptBtn} className="text-sm text-sky-600 hover:underline">+ Agregar</button>
              </div>
              <p className="text-xs text-stone-500 mb-3">Aparecen en Caja para cobrar ítems sin código de barras.</p>
              <div className="space-y-2">
                {deptButtons.length === 0 && <p className="text-stone-400 text-sm text-center py-2">Sin botones configurados</p>}
                {deptButtons.map((btn, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_32px] gap-2">
                    <input className="input text-sm" placeholder="Ej: Cigarrillo suelto" value={btn.label} onChange={(e) => updateDeptBtn(i, "label", e.target.value)} />
                    <input className="input text-sm tabular text-right" placeholder="Precio ($)" value={btn.price_cents > 0 ? (btn.price_cents / 100).toString() : ""} onChange={(e) => updateDeptBtn(i, "price_cents", e.target.value)} inputMode="numeric" />
                    <button onClick={() => removeDeptBtn(i)} className="text-stone-400 hover:text-red-600 text-lg">×</button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── FINANZAS ─────────────────────────────────────────── */}
        {tab === "finanzas" && (
          <div className="max-w-2xl space-y-5">
            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Metas y objetivos</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Meta de venta diaria ($)">
                  <input className="input tabular" inputMode="numeric"
                    value={config.daily_goal_cents ? (Number(config.daily_goal_cents) / 100).toString() : ""}
                    onChange={(e) => setField("daily_goal_cents", String(arsStringToCents(e.target.value)))}
                    placeholder="50000" />
                </Field>
                <Field label="Meta de venta mensual ($)">
                  <input className="input tabular" inputMode="numeric"
                    value={config.monthly_goal_cents ? (Number(config.monthly_goal_cents) / 100).toString() : ""}
                    onChange={(e) => setField("monthly_goal_cents", String(arsStringToCents(e.target.value)))}
                    placeholder="1200000" />
                </Field>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Costos y márgenes</h2>
              <div className="space-y-3">
                <Field label="Gastos fijos mensuales ($) — alquiler, salarios, servicios">
                  <input className="input tabular" inputMode="numeric"
                    value={config.fixed_costs_monthly_cents ? (Number(config.fixed_costs_monthly_cents) / 100).toString() : ""}
                    onChange={(e) => setField("fixed_costs_monthly_cents", String(arsStringToCents(e.target.value)))}
                    placeholder="150000" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Margen mínimo aceptable (%)">
                    <input className="input tabular" type="number" min="0" max="100"
                      value={config.min_margin_pct || "10"}
                      onChange={(e) => setField("min_margin_pct", e.target.value)} />
                  </Field>
                  <Field label="Tasa de IVA (%)">
                    <input className="input tabular" type="number" min="0" max="100" step="0.5"
                      value={config.iva_rate || "21"}
                      onChange={(e) => setField("iva_rate", e.target.value)} />
                  </Field>
                </div>
                {Number(config.fixed_costs_monthly_cents || 0) > 0 && (
                  <div className="bg-stone-50 rounded-lg p-3 text-xs text-stone-600 border border-stone-200">
                    <div className="font-medium mb-1">Punto de equilibrio estimado</div>
                    <div>Diario: <span className="font-semibold">{centsToARS(Math.ceil(Number(config.fixed_costs_monthly_cents) / 30))}</span> / día</div>
                  </div>
                )}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-1">Comisiones por método de pago</h2>
              <p className="text-xs text-stone-500 mb-4">Opcional. No afecta el precio al cliente — se usa para calcular ganancia real en reportes.</p>
              <div className="space-y-2">
                {[
                  { key: "commission_efectivo_pct", label: "Efectivo" },
                  { key: "commission_debito_pct", label: "Débito" },
                  { key: "commission_credito_pct", label: "Crédito" },
                  { key: "commission_qr_pct", label: "QR / MercadoPago" },
                  { key: "commission_transferencia_pct", label: "Transferencia" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-sm text-stone-700 w-36 shrink-0">{label}</span>
                    <div className="relative">
                      <input className="input tabular pr-6 w-24" type="number" min="0" max="100" step="0.1"
                        value={config[key] || "0"} onChange={(e) => setField(key, e.target.value)} />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs">%</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── BACKUP ──────────────────────────────────────────── */}
        {tab === "backup" && (
          <div className="max-w-xl space-y-5">
            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-4">Respaldo automático</h2>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium">Activar backup automático</p>
                  <p className="text-xs text-stone-500 mt-0.5">Se ejecuta al abrir la app si pasó el tiempo configurado</p>
                </div>
                <label className="relative inline-flex cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={config.auto_backup_enabled === "1"}
                    onChange={(e) => setField("auto_backup_enabled", e.target.checked ? "1" : "0")} />
                  <div className="w-9 h-5 bg-stone-200 peer-checked:bg-sky-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
              {config.auto_backup_enabled === "1" && (
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-stone-100">
                  <Field label="Frecuencia (horas)">
                    <input className="input tabular" type="number" min="1" max="720"
                      value={config.auto_backup_freq_hours || "24"}
                      onChange={(e) => setField("auto_backup_freq_hours", e.target.value)} />
                  </Field>
                  <Field label="Conservar últimos N">
                    <input className="input tabular" type="number" min="1" max="100"
                      value={config.auto_backup_keep_count || "10"}
                      onChange={(e) => setField("auto_backup_keep_count", e.target.value)} />
                  </Field>
                </div>
              )}
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-3">Copia de seguridad manual</h2>
              <button onClick={doBackup} disabled={backing} className="btn btn-secondary w-full disabled:opacity-40">
                {backing ? "Guardando…" : "💾 Guardar copia ahora"}
              </button>
              {backupMsg && (
                <p className={`mt-2 text-xs ${backupMsg.startsWith("✓") ? "text-emerald-700" : "text-red-600"}`}>{backupMsg}</p>
              )}
            </section>

            {backups.length > 0 && (
              <section className="card p-5">
                <h2 className="font-semibold text-sm mb-3">Copias guardadas ({backups.length})</h2>
                <div className="space-y-1">
                  {backups.map((b) => (
                    <div key={b.name} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-stone-50 group">
                      <div>
                        <p className="text-xs font-medium text-stone-700">{b.display_date}</p>
                        <p className="text-[11px] text-stone-400">{formatBytes(b.size_bytes)}</p>
                      </div>
                      <button onClick={() => doDeleteBackup(b.name)}
                        className="text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">×</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── SISTEMA ─────────────────────────────────────────── */}
        {tab === "sistema" && (
          <div className="max-w-xl space-y-5">
            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-1">Modo tablet / móvil</h2>
              <p className="text-xs text-stone-500 mb-4">Cualquier tablet en la misma red WiFi puede ver ventas del día, alertas y órdenes sin instalar nada.</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Activar modo tablet</span>
                  <label className="relative inline-flex cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={config.tablet_mode_enabled === "1"}
                      onChange={(e) => setField("tablet_mode_enabled", e.target.checked ? "1" : "0")} />
                    <div className="w-9 h-5 bg-stone-200 peer-checked:bg-sky-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <Field label="Puerto (por defecto: 7979)">
                  <input className="input tabular font-mono w-32" value={config.tablet_port || "7979"}
                    onChange={(e) => setField("tablet_port", e.target.value)} />
                </Field>
                {networkInfo?.enabled && (
                  <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg">
                    <p className="text-xs font-semibold text-sky-800 mb-1">Servidor activo</p>
                    <p className="font-mono text-sm text-sky-700">http://{networkInfo.ip}:{networkInfo.port}</p>
                    <p className="text-xs text-sky-600 mt-1">Abrí esa dirección en el tablet (misma WiFi)</p>
                  </div>
                )}
                {!networkInfo?.enabled && config.tablet_mode_enabled === "1" && (
                  <p className="text-xs text-stone-400">Guardá y reiniciá la app para activar el servidor.</p>
                )}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-1">Multicaja (varias cajas en la misma red) — en desarrollo</h2>
              <p className="text-xs text-stone-500 mb-4">
                Preparación para tener varias cajas vendiendo en la misma red, compartiendo el mismo stock.
                Por ahora las dos cajas necesitan estar siempre conectadas entre sí (sin wifi, la caja
                "cliente" todavía no puede seguir vendiendo sola) — eso viene en una próxima actualización.
              </p>
              <p className="text-xs font-medium text-stone-600 mb-4">
                Modo actual de esta caja:{" "}
                <span className="font-mono">
                  {deviceConfig?.mode === "server" ? "Servidor" : deviceConfig?.mode === "client" ? "Cliente" : "Standalone (normal)"}
                </span>
              </p>

              {deviceConfig?.mode !== "client" && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Activar modo servidor</span>
                  <label className="relative inline-flex cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={deviceConfig?.mode === "server"}
                      onChange={(e) => setServerMode(e.target.checked)} />
                    <div className="w-9 h-5 bg-stone-200 peer-checked:bg-indigo-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
              )}
              {networkInfo?.enabled && deviceConfig?.mode === "server" && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg mt-3">
                  <p className="text-xs font-semibold text-indigo-800 mb-1">Servidor multicaja activo</p>
                  <p className="font-mono text-sm text-indigo-700">{networkInfo.ip}:{networkInfo.port}</p>
                  <p className="text-xs text-indigo-600 mt-1">Usá esa dirección en las cajas "cliente" para conectarlas.</p>
                </div>
              )}
              {deviceConfig?.mode === "server" && !networkInfo?.enabled && (
                <p className="text-xs text-stone-400 mt-3">Reiniciá la app para activar el servidor.</p>
              )}

              {deviceConfig?.mode !== "server" && (
                <div className="mt-4 pt-4 border-t border-stone-100">
                  <p className="text-xs text-stone-500 mb-2">O conectate como cliente a otra caja que ya sea servidor:</p>
                  {deviceConfig?.mode === "client" ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <p className="text-xs font-semibold text-emerald-800 mb-1">Conectada como cliente</p>
                      <p className="font-mono text-sm text-emerald-700">{deviceConfig.serverAddr}</p>
                      <button onClick={doDisconnectClient} className="text-xs text-emerald-700 underline mt-2">
                        Desconectar (volver a standalone)
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        className="input font-mono flex-1"
                        placeholder="192.168.1.5:7979"
                        value={serverAddrInput}
                        onChange={(e) => setServerAddrInput(e.target.value)}
                      />
                      <button onClick={doConnectAsClient} disabled={connecting || !serverAddrInput.trim()} className="btn btn-secondary shrink-0">
                        {connecting ? "Conectando…" : "Conectar"}
                      </button>
                    </div>
                  )}
                  {connectMsg && (
                    <p className={clsx("text-xs mt-2", connectError ? "text-red-600" : "text-emerald-600")}>{connectMsg}</p>
                  )}
                </div>
              )}
            </section>

            <section className="card p-5">
              <h2 className="font-semibold text-sm mb-3">Acerca del sistema</h2>
              <dl className="text-sm space-y-1.5 text-stone-600">
                <div className="flex justify-between"><dt>Versión</dt><dd className="font-mono">0.4.0</dd></div>
                <div className="flex justify-between"><dt>Sistema</dt><dd>Punto Simple POS</dd></div>
                <div className="flex justify-between"><dt>Motor de DB</dt><dd>SQLite (local)</dd></div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}
