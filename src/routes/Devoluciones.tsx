import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, formatDateTime } from "@/lib/format";
import type { Client, NewReturnItem, ReturnRecord, Sale, SaleWithItems } from "@/types";
import clsx from "clsx";

type Tab = "nueva" | "historial";
type SearchMode = "numero" | "cliente";

const REASONS = [
  "Producto defectuoso",
  "Error de cobro",
  "Cambio por otro producto",
  "Producto vencido",
  "No era lo que quería",
  "Otro",
];

interface ReturnLine {
  product_id: number | null;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  qty: number;
  maxQty: number;
  alreadyReturned: number;
}

export default function Devoluciones() {
  const [tab, setTab] = useState<Tab>("nueva");
  const [searchMode, setSearchMode] = useState<SearchMode>("numero");

  // Búsqueda por número
  const [saleIdInput, setSaleIdInput] = useState("");

  // Búsqueda por cliente
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSales, setClientSales] = useState<Sale[]>([]);
  const [loadingClientSales, setLoadingClientSales] = useState(false);

  const [saleData, setSaleData] = useState<SaleWithItems | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Historial
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (tab === "historial") loadHistory();
  }, [tab]);

  useEffect(() => {
    if (clientQuery.trim().length < 2) { setClientResults([]); return; }
    const t = setTimeout(() => {
      api.listClients(clientQuery).then(setClientResults).catch(console.error);
    }, 200);
    return () => clearTimeout(t);
  }, [clientQuery]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      setReturns(await api.listReturns(100));
    } catch (e) { console.error(e); }
    finally { setLoadingHistory(false); }
  }

  async function loadClientSales(client: Client) {
    setSelectedClient(client);
    setClientResults([]);
    setClientQuery(client.name);
    setLoadingClientSales(true);
    setClientSales([]);
    try {
      // Últimos 90 días
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 90);
      const toStr = to.toISOString().split("T")[0];
      const fromStr = from.toISOString().split("T")[0];
      const all = await api.listSalesRange(fromStr, toStr, 300);
      setClientSales(all.filter((s) => s.client_id === client.id));
    } catch (e) { console.error(e); }
    finally { setLoadingClientSales(false); }
  }

  async function loadSale(id: number) {
    setLoadingSearch(true);
    setError(null);
    setSaleData(null);
    setLines([]);
    try {
      const [sw, allReturns] = await Promise.all([
        api.getSaleWithItems(id),
        api.listReturns(500),
      ]);
      if (sw.sale.notes?.includes("[ANULADA]")) {
        setError("Esta venta está anulada");
        return;
      }

      // Calcular qué ya fue devuelto de esta venta
      const saleReturns = allReturns.filter((r) => r.sale_id === id);
      const returnedQty: Record<string, number> = {};
      for (const ret of saleReturns) {
        const rw = await api.getReturnWithItems(ret.id);
        for (const item of rw.items) {
          const key = item.product_id != null ? `p${item.product_id}` : item.name;
          returnedQty[key] = (returnedQty[key] || 0) + item.qty;
        }
      }

      setSaleData(sw);
      setLines(sw.items.map((item) => {
        const key = item.product_id != null ? `p${item.product_id}` : item.name;
        const alreadyReturned = returnedQty[key] || 0;
        return {
          product_id: item.product_id,
          barcode: item.barcode,
          name: item.name,
          unit_price_cents: item.unit_price_cents,
          qty: 0,
          maxQty: Math.max(0, item.qty - alreadyReturned),
          alreadyReturned,
        };
      }));
    } catch {
      setError("No se encontró la venta");
    } finally {
      setLoadingSearch(false);
    }
  }

  async function searchSale() {
    const id = parseInt(saleIdInput.trim());
    if (!id) return;
    await loadSale(id);
  }

  function setLineQty(idx: number, qty: number) {
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, qty: Math.min(Math.max(0, qty), l.maxQty) } : l
      )
    );
  }

  function selectAll() {
    setLines((prev) => prev.map((l) => ({ ...l, qty: l.maxQty })));
  }

  const selectedLines = lines.filter((l) => l.qty > 0);
  const totalReturn = selectedLines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0);

  async function handleSubmit() {
    if (selectedLines.length === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const items: NewReturnItem[] = selectedLines.map((l) => ({
        product_id: l.product_id,
        barcode: l.barcode,
        name: l.name,
        unit_price_cents: l.unit_price_cents,
        qty: l.qty,
      }));
      const ret = await api.createReturn({
        sale_id: saleData?.sale.id ?? null,
        items,
        reason,
        notes: notes.trim() || null,
      });
      setSuccess(`Devolución #${ret.id} registrada. Se devolvieron ${items.length} ítem(s) al stock.`);
      setSaleData(null);
      setLines([]);
      setSaleIdInput("");
      setNotes("");
      setSelectedClient(null);
      setClientQuery("");
      setClientSales([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setSaleData(null);
    setLines([]);
    setSaleIdInput("");
    setNotes("");
    setError(null);
    setSuccess(null);
    setSelectedClient(null);
    setClientQuery("");
    setClientSales([]);
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Devoluciones</h1>
        <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
          {(["nueva", "historial"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "px-4 py-1.5",
                tab === t ? "bg-stone-700 text-white" : "bg-white hover:bg-stone-50 text-stone-600"
              )}
            >
              {t === "nueva" ? "Nueva devolución" : "Historial"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab nueva ──────────────────────────────────────────────────────── */}
      {tab === "nueva" && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {success && (
            <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
              <span>{success}</span>
              <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700 ml-3">×</button>
            </div>
          )}
          {error && (
            <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">×</button>
            </div>
          )}

          {/* Buscar venta */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-sm">Buscar venta original</h2>
              <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
                {(["numero", "cliente"] as SearchMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSearchMode(m); reset(); }}
                    className={clsx(
                      "px-3 py-1.5",
                      searchMode === m ? "bg-stone-700 text-white" : "bg-white hover:bg-stone-50 text-stone-600"
                    )}
                  >
                    {m === "numero" ? "Por número" : "Por cliente"}
                  </button>
                ))}
              </div>
            </div>

            {searchMode === "numero" && (
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Número de venta (ej: 42)"
                  value={saleIdInput}
                  onChange={(e) => setSaleIdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchSale()}
                />
                <button
                  onClick={searchSale}
                  disabled={!saleIdInput.trim() || loadingSearch}
                  className="btn btn-secondary disabled:opacity-40"
                >
                  {loadingSearch ? "Buscando…" : "Buscar"}
                </button>
              </div>
            )}

            {searchMode === "cliente" && (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    className="input w-full"
                    placeholder="Nombre del cliente…"
                    value={clientQuery}
                    onChange={(e) => { setClientQuery(e.target.value); setSelectedClient(null); setClientSales([]); }}
                  />
                  {clientResults.length > 0 && (
                    <ul className="absolute z-10 bg-white border border-stone-200 rounded-lg shadow-lg w-full mt-1 max-h-40 overflow-y-auto">
                      {clientResults.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => loadClientSales(c)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                          >
                            <div className="font-medium">{c.name}</div>
                            {c.phone && <div className="text-xs text-stone-400">{c.phone}</div>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {loadingClientSales && (
                  <p className="text-sm text-stone-400">Cargando ventas…</p>
                )}

                {selectedClient && !loadingClientSales && clientSales.length === 0 && (
                  <p className="text-sm text-stone-400">Sin ventas en los últimos 90 días.</p>
                )}

                {clientSales.length > 0 && !saleData && (
                  <div>
                    <p className="text-xs text-stone-500 mb-2">Seleccioná la venta a devolver:</p>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {clientSales.map((s) => (
                        <li key={s.id}>
                          <button
                            onClick={() => loadSale(s.id)}
                            disabled={loadingSearch}
                            className="w-full text-left px-3 py-2.5 bg-stone-50 hover:bg-indigo-50 border border-stone-200 hover:border-indigo-200 rounded-lg text-sm transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-mono text-xs text-stone-400">Venta #{s.id}</span>
                              <span className="font-semibold tabular">{centsToARS(s.total_cents)}</span>
                            </div>
                            <div className="text-xs text-stone-500 mt-0.5">{formatDateTime(s.created_at)}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {saleData && (
              <div className="mt-3 text-sm text-stone-600 bg-stone-50 rounded px-3 py-2 flex items-center justify-between">
                <span>
                  Venta #{saleData.sale.id} — {formatDateTime(saleData.sale.created_at)} — {centsToARS(saleData.sale.total_cents)}
                  {saleData.sale.client_name && <span className="ml-2 text-stone-400">({saleData.sale.client_name})</span>}
                </span>
                <button onClick={reset} className="text-stone-400 hover:text-red-600 text-xs ml-2">Cambiar</button>
              </div>
            )}
          </div>

          {/* Ítems de la venta */}
          {saleData && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium text-sm">Seleccioná los ítems a devolver</h2>
                <button onClick={selectAll} className="text-xs text-emerald-600 hover:underline">
                  Seleccionar todos
                </button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className={clsx(
                    "flex items-center gap-4 p-3 rounded-md border",
                    line.maxQty === 0
                      ? "border-stone-100 bg-stone-50 opacity-50"
                      : line.qty > 0 ? "border-emerald-200 bg-emerald-50" : "border-stone-100 bg-stone-50"
                  )}>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{line.name}</div>
                      <div className="text-xs text-stone-500">
                        {centsToARS(line.unit_price_cents)} × {line.maxQty + line.alreadyReturned}
                        {line.alreadyReturned > 0 && (
                          <span className="ml-1.5 text-amber-600">({line.alreadyReturned} ya devuelto{line.alreadyReturned > 1 ? "s" : ""})</span>
                        )}
                      </div>
                    </div>
                    {line.maxQty > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-400">Devolver:</span>
                        <button
                          onClick={() => setLineQty(idx, line.qty - 1)}
                          className="w-7 h-7 border rounded text-sm hover:bg-stone-100 disabled:opacity-30"
                          disabled={line.qty === 0}
                        >−</button>
                        <input
                          type="number"
                          min={0}
                          max={line.maxQty}
                          value={line.qty}
                          onChange={(e) => setLineQty(idx, Number(e.target.value))}
                          className="input w-14 text-center text-sm"
                        />
                        <button
                          onClick={() => setLineQty(idx, line.qty + 1)}
                          className="w-7 h-7 border rounded text-sm hover:bg-stone-100 disabled:opacity-30"
                          disabled={line.qty >= line.maxQty}
                        >+</button>
                        <span className="text-xs text-stone-400">/ {line.maxQty}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400 italic">Ya devuelto</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Razón y notas */}
          {saleData && (
            <div className="card p-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-1.5">Motivo de devolución</label>
                <select className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-1.5">Notas (opcional)</label>
                <textarea
                  className="input w-full h-20 resize-none"
                  placeholder="Descripción adicional…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {selectedLines.length > 0 && (
                <div className="bg-stone-50 rounded-md p-3 text-sm">
                  <div className="flex justify-between font-medium">
                    <span>{selectedLines.length} ítem(s) a devolver</span>
                    <span className="text-emerald-700">{centsToARS(totalReturn)}</span>
                  </div>
                  <div className="text-xs text-stone-500 mt-1">El stock se restituirá automáticamente</div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={selectedLines.length === 0 || saving}
                  className="btn btn-primary flex-1 disabled:opacity-40"
                >
                  {saving ? "Registrando…" : `Confirmar devolución${selectedLines.length > 0 ? ` (${centsToARS(totalReturn)})` : ""}`}
                </button>
                <button onClick={reset} className="btn btn-secondary">Cancelar</button>
              </div>
            </div>
          )}

          {!saleData && !error && !success && (
            <div className="card flex-1 flex items-center justify-center text-stone-400 text-sm min-h-40">
              {searchMode === "numero"
                ? "Buscá una venta por su número para iniciar una devolución"
                : "Buscá un cliente para ver sus compras recientes"}
            </div>
          )}
        </div>
      )}

      {/* ── Tab historial ─────────────────────────────────────────────────── */}
      {tab === "historial" && (
        <div className="flex-1 card overflow-hidden flex flex-col">
          {loadingHistory ? (
            <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">Cargando…</div>
          ) : returns.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">
              No hay devoluciones registradas
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5">#</th>
                    <th className="text-left px-4 py-2.5">Fecha</th>
                    <th className="text-left px-4 py-2.5">Venta orig.</th>
                    <th className="text-left px-4 py-2.5">Motivo</th>
                    <th className="text-right px-4 py-2.5">Total devuelto</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-400">#{r.id}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.sale_id ? <span className="font-mono text-indigo-600">Venta #{r.sale_id}</span> : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{r.reason}</td>
                      <td className="px-4 py-2.5 text-right tabular font-medium text-emerald-700">{centsToARS(r.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
