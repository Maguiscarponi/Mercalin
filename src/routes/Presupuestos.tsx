import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime, todayISO } from "@/lib/format";
import { confirmAction, showToast } from "@/stores/dialogs";
import type { Client, NewQuote, NewQuoteItem, Product, Quote, QuoteWithItems, QuoteStatus } from "@/types";
import clsx from "clsx";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  vencido: "Vencido",
};

const STATUS_COLORS: Record<QuoteStatus, string> = {
  borrador: "bg-stone-100 text-stone-700",
  enviado: "bg-blue-100 text-blue-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
  vencido: "bg-amber-100 text-amber-700",
};

export default function Presupuestos() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<QuoteWithItems | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "">("");

  async function load() {
    setLoading(true);
    try { setQuotes(await api.listQuotes()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function openDetail(id: number) {
    try { setDetail(await api.getQuoteWithItems(id)); } catch (e) { console.error(e); }
  }

  async function handleChangeStatus(id: number, status: string) {
    try {
      const updated = await api.updateQuoteStatus(id, status);
      setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
      if (detail?.quote.id === id) setDetail((d) => d ? { ...d, quote: updated } : d);
    } catch (e) { console.error(e); showToast({ message: "No se pudo cambiar el estado", tone: "danger" }); }
  }

  async function handleDelete(id: number) {
    if (!(await confirmAction("Esta acción no se puede deshacer.", { title: "¿Eliminar este presupuesto?", danger: true, confirmLabel: "Eliminar" }))) return;
    try { await api.deleteQuote(id); load(); setDetail(null); showToast({ message: "Presupuesto eliminado" }); }
    catch { showToast({ message: "No se pudo eliminar el presupuesto", tone: "danger" }); }
  }

  const visible = statusFilter ? quotes.filter((q) => q.status === statusFilter) : quotes;

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Presupuestos</h1>
          <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
            <button
              onClick={() => setStatusFilter("")}
              className={clsx("px-3 py-1.5", statusFilter === "" ? "bg-stone-700 text-white" : "bg-white hover:bg-stone-50 text-stone-600")}
            >
              Todos ({quotes.length})
            </button>
            {(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((s) => {
              const count = quotes.filter((q) => q.status === s).length;
              if (count === 0 && statusFilter !== s) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={clsx("px-3 py-1.5", statusFilter === s ? "bg-stone-700 text-white" : "bg-white hover:bg-stone-50 text-stone-600")}
                >
                  {STATUS_LABELS[s]} ({count})
                </button>
              );
            })}
          </div>
        </div>
        <button onClick={() => setCreating(true)} className="btn btn-primary">
          Nuevo presupuesto
        </button>
      </div>

      <div className="card flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-12 text-stone-400 text-sm">Cargando…</div>}
        {!loading && visible.length === 0 && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            No hay presupuestos. Creá uno con el botón de arriba.
          </div>
        )}
        {!loading && visible.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">#</th>
                <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                <th className="text-left px-4 py-2.5 font-medium">Válido hasta</th>
                <th className="text-left px-4 py-2.5 font-medium">Creado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q) => (
                <tr key={q.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-400">#{q.id}</td>
                  <td className="px-4 py-2.5 font-medium">{q.client_name || <span className="text-stone-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular font-semibold">{centsToARS(q.total_cents)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={clsx("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[q.status as QuoteStatus])}>
                      {STATUS_LABELS[q.status as QuoteStatus] || q.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{q.valid_until || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-400">{formatDateTime(q.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openDetail(q.id)} className="btn-table-success">Ver</button>
                      <button onClick={() => handleDelete(q.id)} className="btn-table-danger">Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <QuoteDetailModal
          qw={detail}
          onClose={() => setDetail(null)}
          onChangeStatus={handleChangeStatus}
          onDelete={handleDelete}
        />
      )}

      {creating && (
        <QuoteForm
          onCancel={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function QuoteDetailModal({
  qw,
  onClose,
  onChangeStatus,
  onDelete,
}: {
  qw: QuoteWithItems;
  onClose: () => void;
  onChangeStatus: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const { quote, items } = qw;

  function printQuote() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>Presupuesto #${quote.id}</title>
      <style>body{font-family:sans-serif;padding:20px;max-width:600px;margin:auto}
      table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #eee}
      th{text-align:left;font-size:11px;text-transform:uppercase;color:#666}
      .right{text-align:right}.total{font-weight:bold;font-size:1.2em}</style>
      </head><body>
      <h2>Presupuesto #${quote.id}</h2>
      ${quote.client_name ? `<p>Cliente: <strong>${quote.client_name}</strong></p>` : ""}
      ${quote.valid_until ? `<p>Válido hasta: ${quote.valid_until}</p>` : ""}
      ${quote.notes ? `<p>Notas: ${quote.notes}</p>` : ""}
      <table>
        <thead><tr><th>Producto</th><th class="right">Precio</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${i.name}${i.discount_pct > 0 ? ` (-${i.discount_pct}%)` : ""}</td><td class="right">$${(i.unit_price_cents / 100).toFixed(2)}</td><td class="right">${i.qty}</td><td class="right">$${(i.subtotal_cents / 100).toFixed(2)}</td></tr>`).join("")}
        </tbody>
      </table>
      ${quote.discount_cents > 0 ? `<p class="right">Descuento: -$${(quote.discount_cents / 100).toFixed(2)}</p>` : ""}
      <p class="right total">TOTAL: $${(quote.total_cents / 100).toFixed(2)}</p>
      <script>window.print();window.close();</script>
      </body></html>`);
    win.document.close();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex justify-between items-start">
          <div>
            <h2 className="font-semibold text-lg">Presupuesto #{quote.id}</h2>
            {quote.client_name && <p className="text-sm text-stone-500">{quote.client_name}</p>}
            <p className="text-xs text-stone-400 mt-0.5">{formatDateTime(quote.created_at)}</p>
          </div>
          <div className="text-right space-y-2">
            <div>
              <span className={clsx("text-xs px-2 py-1 rounded-full font-medium", STATUS_COLORS[quote.status as QuoteStatus])}>
                {STATUS_LABELS[quote.status as QuoteStatus] || quote.status}
              </span>
            </div>
            <select
              value={quote.status}
              onChange={(e) => onChangeStatus(quote.id, e.target.value)}
              className="input text-xs h-7 w-36"
            >
              {(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
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
            {quote.discount_cents > 0 && (
              <div className="flex justify-between text-stone-500">
                <span>Descuento global</span>
                <span className="tabular text-amber-600">− {centsToARS(quote.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base">
              <span>Total</span><span className="tabular">{centsToARS(quote.total_cents)}</span>
            </div>
            {quote.valid_until && (
              <div className="flex justify-between text-stone-500 text-xs">
                <span>Válido hasta</span><span>{quote.valid_until}</span>
              </div>
            )}
            {quote.notes && (
              <div className="text-xs text-stone-500 bg-stone-50 rounded px-3 py-2">{quote.notes}</div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button onClick={() => onDelete(quote.id)} className="btn text-sm text-red-600 border border-red-200 hover:bg-red-50">Eliminar</button>
          <button onClick={printQuote} className="btn btn-secondary flex-1">Imprimir</button>
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function QuoteForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [discountStr, setDiscountStr] = useState("");
  const [items, setItems] = useState<{ product_id: number | null; name: string; unit_price_cents: number; discount_pct: number; qty: number; priceStr: string }[]>([
    { product_id: null, name: "", unit_price_cents: 0, discount_pct: 0, qty: 1, priceStr: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [productQuery, setProductQuery] = useState("");

  useEffect(() => {
    Promise.all([api.listClients(""), api.listProducts("")]).then(([c, p]) => {
      setClients(c);
      setProducts(p);
    }).catch(console.error);
  }, []);

  const filteredProducts = productQuery
    ? products.filter((p) => p.name.toLowerCase().includes(productQuery.toLowerCase()) || (p.barcode || "").includes(productQuery))
    : products.slice(0, 20);

  function updateItem(i: number, field: string, value: unknown) {
    setItems((prev) => prev.map((item, idx) =>
      idx !== i ? item : { ...item, [field]: value }
    ));
  }

  function selectProduct(idx: number, product: Product) {
    setItems((prev) => prev.map((item, i) =>
      i !== idx ? item : {
        ...item,
        product_id: product.id,
        name: product.name,
        unit_price_cents: product.price_cents,
        priceStr: (product.price_cents / 100).toFixed(2),
      }
    ));
    setProductQuery("");
  }

  function addItem() {
    setItems((prev) => [...prev, { product_id: null, name: "", unit_price_cents: 0, discount_pct: 0, qty: 1, priceStr: "" }]);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const discountCents = arsStringToCents(discountStr);
  const subtotal = items.reduce((s, i) => {
    const line = (i.unit_price_cents * i.qty);
    const disc = Math.round(line * i.discount_pct / 100);
    return s + line - disc;
  }, 0);
  const total = Math.max(0, subtotal - discountCents);

  async function handleSave() {
    if (items.every((i) => !i.name.trim())) { showToast({ message: "Agregá al menos un ítem", tone: "danger" }); return; }
    setSaving(true);
    try {
      const newItems: NewQuoteItem[] = items
        .filter((i) => i.name.trim())
        .map((i) => ({
          product_id: i.product_id,
          name: i.name,
          unit_price_cents: i.unit_price_cents,
          discount_pct: i.discount_pct,
          qty: i.qty,
        }));
      const q: NewQuote = {
        client_id: clientId,
        user_id: null,
        items: newItems,
        discount_cents: discountCents,
        notes: notes.trim() || null,
        valid_until: validUntil || null,
      };
      await api.createQuote(q);
      onSaved();
      showToast({ message: "Presupuesto creado", tone: "success" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo guardar el presupuesto", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[680px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h2 className="font-semibold text-lg">Nuevo presupuesto</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Cliente (opcional)</span>
              <select
                className="input"
                value={clientId ?? ""}
                onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sin cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Válido hasta</span>
              <input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} min={todayISO()} />
            </label>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-stone-600">Ítems</span>
              <div className="flex gap-2 items-center">
                <input
                  className="input h-7 text-xs w-48"
                  placeholder="Buscar producto…"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
              </div>
            </div>
            {productQuery && (
              <div className="border border-stone-200 rounded-md mb-2 max-h-32 overflow-y-auto bg-white shadow-sm">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProduct(items.length - 1, p)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-stone-400">{centsToARS(p.price_cents)}</span>
                  </button>
                ))}
                {filteredProducts.length === 0 && <div className="px-3 py-2 text-xs text-stone-400">Sin resultados</div>}
              </div>
            )}
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_70px_70px_30px] gap-2 items-center">
                  <input
                    className="input text-sm"
                    placeholder="Descripción"
                    value={item.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                  />
                  <input
                    className="input text-sm text-right tabular"
                    placeholder="Precio"
                    value={item.priceStr}
                    onChange={(e) => {
                      updateItem(i, "priceStr", e.target.value);
                      updateItem(i, "unit_price_cents", arsStringToCents(e.target.value));
                    }}
                    inputMode="numeric"
                  />
                  <input
                    className="input text-sm text-right tabular"
                    placeholder="Cant."
                    type="number"
                    min="0.001"
                    step="1"
                    value={item.qty}
                    onChange={(e) => updateItem(i, "qty", Number(e.target.value))}
                  />
                  <input
                    className="input text-sm text-right tabular"
                    placeholder="Desc%"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={item.discount_pct}
                    onChange={(e) => updateItem(i, "discount_pct", Number(e.target.value))}
                  />
                  <button onClick={() => removeItem(i)} className="text-stone-400 hover:text-red-600 text-sm font-bold">×</button>
                </div>
              ))}
            </div>
            <button onClick={addItem} className="text-xs text-emerald-600 hover:underline mt-2">+ Agregar ítem</button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Descuento global ($)</span>
              <input className="input text-right tabular" value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} placeholder="0" inputMode="numeric" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Notas</span>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condiciones, aclaraciones…" />
            </label>
          </div>

          <div className="bg-stone-50 rounded-lg px-4 py-3 space-y-1 text-sm">
            {discountCents > 0 && (
              <div className="flex justify-between text-stone-500">
                <span>Subtotal</span><span className="tabular">{centsToARS(subtotal)}</span>
              </div>
            )}
            {discountCents > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Descuento</span><span className="tabular">− {centsToARS(discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-stone-200 pt-1">
              <span>Total</span><span className="tabular">{centsToARS(total)}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary flex-1 disabled:opacity-40">
            {saving ? "Guardando…" : "Crear presupuesto"}
          </button>
        </div>
      </div>
    </div>
  );
}
