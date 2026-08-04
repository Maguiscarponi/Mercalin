import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime } from "@/lib/format";
import type { Client, ClientAccountEntry, ClientRfm, ClientSegment, NewClient } from "@/types";
import clsx from "clsx";

const SEGMENT_CONFIG: Record<ClientSegment, { label: string; emoji: string; bg: string; text: string }> = {
  vip:           { label: "VIP",           emoji: "⭐", bg: "bg-yellow-100", text: "text-yellow-800" },
  habitual:      { label: "Habitual",      emoji: "✅", bg: "bg-emerald-100", text: "text-emerald-800" },
  en_riesgo:     { label: "En riesgo",     emoji: "⚠️", bg: "bg-amber-100",  text: "text-amber-800" },
  deudor_critico:{ label: "Deudor",        emoji: "🔴", bg: "bg-red-100",    text: "text-red-800" },
  nuevo:         { label: "Nuevo",         emoji: "🆕", bg: "bg-blue-100",   text: "text-blue-800" },
};

function SegmentBadge({ segment }: { segment: ClientSegment }) {
  const cfg = SEGMENT_CONFIG[segment];
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full", cfg.bg, cfg.text)}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

export default function Clientes() {
  const [clients, setClients] = useState<Client[]>([]);
  const [rfmMap, setRfmMap] = useState<Map<number, ClientRfm>>(new Map());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Client> | null>(null);
  const [viewing, setViewing] = useState<Client | null>(null);
  const [debtFilter, setDebtFilter] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<ClientSegment | "">("");

  async function load() {
    setLoading(true);
    try {
      const [cl, rfm] = await Promise.all([
        api.listClients(query),
        api.getClientsRfm(),
      ]);
      setClients(cl);
      setRfmMap(new Map(rfm.map(r => [r.client_id, r])));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line

  async function handleSave(data: Partial<Client>) {
    try {
      if (data.id) {
        await api.updateClient(data as Client);
      } else {
        await api.createClient({
          name: data.name || "",
          phone: data.phone || null,
          email: data.email || null,
          address: data.address || null,
          dni: data.dni || null,
          notes: data.notes || null,
          credit_limit_cents: data.credit_limit_cents || 0,
          is_ri: data.is_ri || false,
        });
      }
      setEditing(null);
      load();
    } catch (e) {
      console.error(e);
      alert("Error al guardar");
    }
  }

  async function handleDelete(client: Client) {
    const msg = client.balance_cents > 0
      ? `${client.name} tiene una deuda de ${centsToARS(client.balance_cents)}. Si lo eliminás, se pierde el registro de esa cuenta corriente. ¿Eliminar igual?`
      : `¿Eliminar a ${client.name}?`;
    if (!confirm(msg)) return;
    await api.deleteClient(client.id);
    load();
  }

  function exportCsv(rows: Client[]) {
    const header = "nombre;telefono;dni;email;direccion;deuda;limite_credito;notas";
    const lines = rows.map((c) =>
      [
        `"${c.name.replace(/"/g, '""')}"`,
        c.phone || "",
        c.dni || "",
        c.email || "",
        c.address || "",
        (c.balance_cents / 100).toFixed(2),
        (c.credit_limit_cents / 100).toFixed(2),
        `"${(c.notes || "").replace(/"/g, '""')}"`,
      ].join(";")
    );
    const csv = "﻿" + [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const debtors = clients.filter((c) => c.balance_cents > 0);
  const totalDebt = debtors.reduce((s, c) => s + c.balance_cents, 0);
  const atRisk = [...rfmMap.values()].filter(r => r.segment === "en_riesgo").length;

  let visibleClients = debtFilter ? debtors : clients;
  if (segmentFilter) {
    const idsInSegment = new Set([...rfmMap.values()].filter(r => r.segment === segmentFilter).map(r => r.client_id));
    visibleClients = visibleClients.filter(c => idsInSegment.has(c.id));
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Clientes</h1>
          {debtors.length > 0 && (
            <button
              onClick={() => setDebtFilter((f) => !f)}
              className={clsx(
                "px-2.5 py-1 text-xs font-medium rounded-md border transition-colors",
                debtFilter
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
              )}
            >
              {debtors.length} con deuda {debtFilter ? "· ver todos" : ""}
            </button>
          )}
          {totalDebt > 0 && (
            <span className="text-xs text-stone-500">
              Deuda total: <span className="font-semibold text-red-600">{centsToARS(totalDebt)}</span>
            </span>
          )}
          {atRisk > 0 && (
            <button
              onClick={() => setSegmentFilter(segmentFilter === "en_riesgo" ? "" : "en_riesgo")}
              className={clsx(
                "px-2.5 py-1 text-xs font-medium rounded-md border transition-colors",
                segmentFilter === "en_riesgo"
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
              )}
            >
              ⚠️ {atRisk} en riesgo {segmentFilter === "en_riesgo" ? "· ver todos" : ""}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportCsv(visibleClients)} className="btn btn-secondary text-sm" title="Exporta la lista tal como se ve, respetando los filtros activos">
            📤 Exportar CSV
          </button>
          <button onClick={() => setEditing({})} className="btn btn-primary">
            Nuevo cliente
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="input flex-1 min-w-48"
          placeholder="Buscar por nombre, teléfono o DNI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {rfmMap.size > 0 && (
          <div className="flex gap-1">
            {(Object.keys(SEGMENT_CONFIG) as ClientSegment[]).map(seg => {
              const count = [...rfmMap.values()].filter(r => r.segment === seg).length;
              if (count === 0) return null;
              const cfg = SEGMENT_CONFIG[seg];
              return (
                <button
                  key={seg}
                  onClick={() => setSegmentFilter(segmentFilter === seg ? "" : seg)}
                  className={clsx(
                    "px-2.5 py-1 text-xs font-medium rounded-md border transition-colors",
                    segmentFilter === seg
                      ? `${cfg.bg} ${cfg.text} border-current`
                      : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50"
                  )}
                >
                  {cfg.emoji} {cfg.label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="card flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-600 text-xs uppercase sticky top-0">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Nombre</th>
              <th className="text-left px-4 py-2.5 font-medium">Teléfono</th>
              <th className="text-left px-4 py-2.5 font-medium">DNI</th>
              <th className="text-right px-4 py-2.5 font-medium">Deuda</th>
              <th className="text-right px-4 py-2.5 font-medium">Límite</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-8 text-stone-400">Cargando…</td></tr>
            )}
            {!loading && clients.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-stone-400">
                Sin clientes. Tocá "Nuevo cliente" para agregar.
              </td></tr>
            )}
            {visibleClients.map((c) => {
              const rfm = rfmMap.get(c.id);
              return (
                <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-stone-900">{c.name}</div>
                    {rfm && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <SegmentBadge segment={rfm.segment as ClientSegment} />
                        {rfm.segment === "en_riesgo" && rfm.avg_frequency_days && (
                          <span className="text-[10px] text-amber-600">
                            {rfm.recency_days}d ausente · suele venir cada {rfm.avg_frequency_days}d
                          </span>
                        )}
                        {rfm.total_purchases > 0 && (
                          <span className="text-[10px] text-stone-400">
                            {rfm.total_purchases} compra{rfm.total_purchases !== 1 ? "s" : ""} · ticket prom. {centsToARS(rfm.avg_ticket_cents)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500">{c.phone || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-500">{c.dni || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {c.balance_cents > 0 ? (
                      <span className="text-red-600 font-semibold">{centsToARS(c.balance_cents)}</span>
                    ) : (
                      <span className="text-stone-400">Sin deuda</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular text-stone-500">
                    {c.credit_limit_cents > 0 ? centsToARS(c.credit_limit_cents) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewing(c)} className="btn-table-success">Ver cuenta</button>
                      <button onClick={() => setEditing(c)} className="btn-table-neutral">Editar</button>
                      <button onClick={() => handleDelete(c)} className="btn-table-danger">Borrar</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <ClientForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {viewing && (
        <ClientAccountModal
          client={viewing}
          onClose={() => { setViewing(null); load(); }}
        />
      )}
    </div>
  );
}

function ClientAccountModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const [history, setHistory] = useState<ClientAccountEntry[]>([]);
  const [payStr, setPayStr] = useState("");
  const [payConcept, setPayConcept] = useState("Pago de deuda");
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [currentClient, setCurrentClient] = useState(client);
  const [accountTab, setAccountTab] = useState<"cuenta" | "compras">("cuenta");

  async function load() {
    const [h, c] = await Promise.all([
      api.clientAccountHistory(client.id),
      api.getClient(client.id),
    ]);
    setHistory(h);
    setCurrentClient(c);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function registerPayment() {
    const amount = arsStringToCents(payStr);
    if (amount <= 0) { setPayError("Ingresá un monto mayor a $0"); return; }
    if (!payConcept.trim()) { setPayError("Ingresá un concepto para el pago"); return; }
    setPayError(null);
    setSaving(true);
    try {
      await api.registerClientPayment({
        client_id: client.id,
        amount_cents: amount,
        concept: payConcept.trim(),
      });
      setPayStr("");
      load();
    } catch (e) {
      console.error(e);
      alert("Error al registrar pago");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[580px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="font-semibold text-lg">{currentClient.name}</h2>
              <p className="text-sm text-stone-500 mt-0.5">
                {currentClient.phone && `📞 ${currentClient.phone}`}
                {currentClient.dni && ` · DNI ${currentClient.dni}`}
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-stone-500">Saldo deudor</div>
              <div className={clsx("text-2xl font-bold tabular", currentClient.balance_cents > 0 ? "text-red-600" : "text-emerald-600")}>
                {centsToARS(currentClient.balance_cents)}
              </div>
              {currentClient.credit_limit_cents > 0 && (
                <div className="text-xs text-stone-400">Límite: {centsToARS(currentClient.credit_limit_cents)}</div>
              )}
            </div>
          </div>
        </div>

        {currentClient.balance_cents > 0 && (
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Monto a pagar ($)"
                value={payStr}
                onChange={(e) => { setPayStr(e.target.value); setPayError(null); }}
                inputMode="numeric"
              />
              <input
                className="input flex-1"
                value={payConcept}
                onChange={(e) => { setPayConcept(e.target.value); setPayError(null); }}
                placeholder="Concepto"
              />
              <button
                onClick={registerPayment}
                disabled={saving}
                className="btn btn-primary whitespace-nowrap"
              >
                {saving ? "…" : "Registrar pago"}
              </button>
            </div>
            {payError && <p className="text-xs text-red-600 mt-1.5">{payError}</p>}
          </div>
        )}

        <div className="flex border-b border-stone-200 px-5">
          {(["cuenta", "compras"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setAccountTab(t)}
              className={clsx(
                "px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors -mb-px",
                accountTab === t
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-stone-400 hover:text-stone-700"
              )}
            >
              {t === "cuenta" ? "Cuenta corriente" : "Compras"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {accountTab === "cuenta" && (
            <>
              {history.length === 0 ? (
                <p className="text-stone-400 text-sm text-center py-4">Sin movimientos</p>
              ) : (
                <ul className="space-y-1.5">
                  {history.map((e) => (
                    <li key={e.id} className="flex justify-between items-center py-2 border-b border-stone-100 text-sm">
                      <div>
                        <span className={clsx(
                          "text-xs px-1.5 py-0.5 rounded font-medium mr-2",
                          e.movement_type === "cargo" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                        )}>
                          {e.movement_type === "cargo" ? "Cargo" : "Pago"}
                        </span>
                        {e.concept}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={clsx("tabular font-medium", e.movement_type === "cargo" ? "text-red-600" : "text-emerald-600")}>
                          {e.movement_type === "cargo" ? "+" : "−"}{centsToARS(e.amount_cents)}
                        </span>
                        <span className="text-xs text-stone-400">{formatDateTime(e.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {accountTab === "compras" && (() => {
            const purchases = history.filter((e) => e.movement_type === "cargo");
            if (purchases.length === 0) return (
              <p className="text-stone-400 text-sm text-center py-4">Sin compras registradas</p>
            );
            return (
              <ul className="space-y-1.5">
                {purchases.map((e) => (
                  <li key={e.id} className="flex justify-between items-center py-2.5 border-b border-stone-100 text-sm">
                    <div>
                      <div className="font-medium text-stone-800">{e.concept}</div>
                      {e.sale_id && (
                        <div className="text-xs text-stone-400 mt-0.5 font-mono">Venta #{e.sale_id}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular font-semibold text-stone-800">{centsToARS(e.amount_cents)}</span>
                      <span className="text-xs text-stone-400">{formatDateTime(e.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>

        <div className="p-4 border-t border-stone-200">
          <button onClick={onClose} className="btn btn-secondary w-full">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ClientForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: Partial<Client>;
  onCancel: () => void;
  onSave: (c: Partial<Client>) => void;
}) {
  const [form, setForm] = useState<Partial<Client>>(initial);
  const [limitStr, setLimitStr] = useState(
    initial.credit_limit_cents ? (initial.credit_limit_cents / 100).toString() : ""
  );
  const [nameError, setNameError] = useState(false);

  function f(key: keyof Client) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  function submit() {
    if (!(form.name || "").trim()) {
      setNameError(true);
      return;
    }
    onSave({ ...form, credit_limit_cents: arsStringToCents(limitStr) });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{form.id ? "Editar cliente" : "Nuevo cliente"}</h2>

        <div className="space-y-3">
          <Field label="Nombre *">
            <input
              autoFocus
              className={clsx("input", nameError && "border-red-400 focus:ring-red-500")}
              value={form.name || ""}
              onChange={(e) => { setNameError(false); f("name")(e); }}
              placeholder="Juan Pérez"
            />
            {nameError && <p className="text-xs text-red-600 mt-1">Ingresá un nombre para continuar</p>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono">
              <input className="input" value={form.phone || ""} onChange={f("phone")} placeholder="1122334455" />
            </Field>
            <Field label="DNI">
              <input className="input font-mono" value={form.dni || ""} onChange={f("dni")} placeholder="30000000" />
            </Field>
          </div>
          <Field label="Dirección">
            <input className="input" value={form.address || ""} onChange={f("address")} placeholder="Av. Corrientes 123" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email || ""} onChange={f("email")} placeholder="juan@mail.com" />
          </Field>
          <Field label="Límite de crédito ($)">
            <input className="input tabular text-right" value={limitStr} onChange={(e) => setLimitStr(e.target.value)} placeholder="0" inputMode="numeric" />
          </Field>
          <Field label="Notas">
            <textarea className="input resize-none h-16" value={form.notes || ""} onChange={f("notes")} placeholder="Observaciones del cliente…" />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded"
              checked={!!form.is_ri}
              onChange={(e) => setForm((prev) => ({ ...prev, is_ri: e.target.checked }))}
            />
            <span className="text-sm text-stone-700">Responsable Inscripto (RI) — discriminar IVA</span>
          </label>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} className="btn btn-primary flex-1">Guardar</button>
        </div>
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
