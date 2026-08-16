import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime, todayISO } from "@/lib/format";
import { confirmAction, showToast } from "@/stores/dialogs";
import { printHtml } from "@/lib/printHtml";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import { useCart } from "@/stores/cart";
import type { CartItem, Client, NewQuote, NewQuoteItem, Product, Quote, QuoteWithItems, QuoteStatus } from "@/types";
import clsx from "clsx";

// Un presupuesto vencido nunca se marca solo en la base (no hay cron) — esto
// calcula "¿venció?" al vuelo a partir de la fecha, para mostrarlo aunque el
// estado guardado siga diciendo "borrador"/"enviado". No pisa un estado que ya
// se resolvió a mano (aprobado/rechazado/vencido).
function displayStatus(q: Pick<Quote, "status" | "valid_until">): QuoteStatus {
  const s = q.status as QuoteStatus;
  if ((s === "borrador" || s === "enviado") && q.valid_until && q.valid_until < todayISO()) {
    return "vencido";
  }
  return s;
}

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
  const [editingQuote, setEditingQuote] = useState<QuoteWithItems | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "">("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  const visible = quotes.filter((q) => {
    if (statusFilter && displayStatus(q) !== statusFilter) return false;
    if (search.trim() && !(q.client_name || "").toLowerCase().includes(search.trim().toLowerCase())) return false;
    const day = q.created_at.slice(0, 10);
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Presupuestos</h1>
          <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
            <button
              onClick={() => setStatusFilter("")}
              className={clsx("px-3 py-1.5", statusFilter === "" ? "bg-indigo-600 text-white" : "bg-white hover:bg-stone-50 text-stone-600")}
            >
              Todos ({quotes.length})
            </button>
            {(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((s) => {
              const count = quotes.filter((q) => displayStatus(q) === s).length;
              if (count === 0 && statusFilter !== s) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={clsx("px-3 py-1.5", statusFilter === s ? "bg-indigo-600 text-white" : "bg-white hover:bg-stone-50 text-stone-600")}
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

      <div className="flex gap-2 items-center">
        <input
          className="input flex-1 max-w-xs"
          placeholder="Buscar por cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-stone-400">Creado entre</span>
        <input type="date" className="input w-40 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="text-xs text-stone-400">y</span>
        <input type="date" className="input w-40 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        {(search || fromDate || toDate) && (
          <button
            onClick={() => { setSearch(""); setFromDate(""); setToDate(""); }}
            className="text-xs text-stone-400 hover:text-red-600"
          >
            Limpiar
          </button>
        )}
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
                    <span className={clsx("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_COLORS[displayStatus(q)])}>
                      {STATUS_LABELS[displayStatus(q)]}
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
          onEdit={(qw) => { setEditingQuote(qw); setDetail(null); }}
        />
      )}

      {(creating || editingQuote) && (
        <QuoteForm
          initial={editingQuote ?? undefined}
          onCancel={() => { setCreating(false); setEditingQuote(null); }}
          onSaved={() => { setCreating(false); setEditingQuote(null); load(); }}
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
  onEdit,
}: {
  qw: QuoteWithItems;
  onClose: () => void;
  onChangeStatus: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onEdit: (qw: QuoteWithItems) => void;
}) {
  const { quote, items } = qw;
  useEscapeToClose(onClose);
  const cart = useCart();
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);

  // Reutiliza el carrito global de Caja: cargar los ítems del presupuesto ahí
  // evita reimplementar el "armado de venta" — se navega directo a cobrar.
  // Los precios quedan congelados tal como se los presupuestó (no se
  // re-cotizan contra el catálogo actual).
  async function handleConvert() {
    if (cart.items.length > 0) {
      const ok = await confirmAction(
        "El carrito de Caja ya tiene productos cargados. Se van a reemplazar por los de este presupuesto.",
        { title: "¿Reemplazar carrito actual?", confirmLabel: "Reemplazar" }
      );
      if (!ok) return;
    }
    setConverting(true);
    try {
      let isRi = false;
      if (quote.client_id) {
        try { isRi = (await api.getClient(quote.client_id)).is_ri; } catch { /* sigue sin RI */ }
      }
      const cartItems: CartItem[] = items.map((i) => ({
        product_id: i.product_id,
        barcode: null,
        name: i.name,
        unit_price_cents: i.unit_price_cents,
        discount_pct: i.discount_pct,
        qty: i.qty,
      }));
      cart.loadItems(cartItems, quote.discount_cents, quote.client_id, quote.client_name, isRi);
      if (quote.status !== "aprobado") onChangeStatus(quote.id, "aprobado");
      onClose();
      navigate("/caja");
    } finally {
      setConverting(false);
    }
  }

  function printQuote() {
    const html = `<html><head><title>Presupuesto #${quote.id}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:'Segoe UI',Arial,sans-serif;padding:32px;max-width:640px;margin:auto;color:#1c1917}
        .header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #4F46E5;padding-bottom:14px;margin-bottom:22px}
        .header h1{margin:0;font-size:22px;color:#312e81}
        .header .meta{text-align:right;color:#78716c;font-size:11px}
        .info{display:flex;gap:24px;margin-bottom:18px;font-size:13px}
        .info div{background:#EEF2FF;border-radius:8px;padding:8px 14px}
        .info b{color:#312e81}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        td,th{padding:8px 10px;border-bottom:1px solid #e7e5e4}
        th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#4338CA;background:#EEF2FF}
        tbody tr:nth-child(even){background:#fafaf9}
        .right{text-align:right}
        .discount{color:#dc2626}
        .totalbox{margin-top:18px;display:flex;justify-content:flex-end}
        .totalbox div{background:#4F46E5;color:#fff;border-radius:8px;padding:12px 20px;font-size:18px;font-weight:700}
        .footer{margin-top:32px;padding-top:12px;border-top:1px solid #e7e5e4;color:#a8a29e;font-size:10px;text-align:center}
      </style>
      </head><body>
      <div class="header">
        <h1>Presupuesto #${quote.id}</h1>
        <div class="meta">
          <div>Punto Simple POS</div>
          <div>${new Date().toLocaleDateString("es-AR")}</div>
        </div>
      </div>
      <div class="info">
        ${quote.client_name ? `<div>Cliente: <b>${quote.client_name}</b></div>` : ""}
        ${quote.valid_until ? `<div>Válido hasta: <b>${quote.valid_until}</b></div>` : ""}
      </div>
      ${quote.notes ? `<p style="color:#57534e;font-size:13px">${quote.notes}</p>` : ""}
      <table>
        <thead><tr><th>Producto</th><th class="right">Precio</th><th class="right">Cant.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${i.name}${i.discount_pct > 0 ? ` <span class="discount">(-${i.discount_pct}%)</span>` : ""}</td><td class="right">$${(i.unit_price_cents / 100).toFixed(2)}</td><td class="right">${i.qty}</td><td class="right">$${(i.subtotal_cents / 100).toFixed(2)}</td></tr>`).join("")}
        </tbody>
      </table>
      ${quote.discount_cents > 0 ? `<p class="right discount">Descuento: -$${(quote.discount_cents / 100).toFixed(2)}</p>` : ""}
      <div class="totalbox"><div>TOTAL: $${(quote.total_cents / 100).toFixed(2)}</div></div>
      <div class="footer">Presupuesto generado por Punto Simple POS</div>
      </body></html>`;
    printHtml(html);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="p-5 border-b border-stone-200 flex justify-between items-start pr-6">
          <div>
            <h2 className="font-semibold text-lg">Presupuesto #{quote.id}</h2>
            {quote.client_name && <p className="text-sm text-stone-500">{quote.client_name}</p>}
            <p className="text-xs text-stone-400 mt-0.5">{formatDateTime(quote.created_at)}</p>
          </div>
          <div className="text-right space-y-2">
            <div>
              <span className={clsx("text-xs px-2 py-1 rounded-full font-medium", STATUS_COLORS[displayStatus(quote)])}>
                {STATUS_LABELS[displayStatus(quote)]}
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

        <div className="p-4 border-t border-stone-200 space-y-2">
          <button onClick={handleConvert} disabled={converting} className="btn btn-primary w-full disabled:opacity-40">
            {converting ? "Convirtiendo…" : "Convertir en venta"}
          </button>
          <div className="flex gap-2">
            <button onClick={() => onEdit(qw)} className="btn btn-secondary flex-1 text-sm">Editar</button>
            <button onClick={printQuote} className="btn btn-secondary flex-1 text-sm">Imprimir</button>
            <button onClick={onClose} className="btn btn-secondary flex-1 text-sm">Cerrar</button>
          </div>
          <button onClick={() => onDelete(quote.id)} className="w-full text-xs text-red-600 hover:underline">Eliminar presupuesto</button>
        </div>
      </div>
    </div>
  );
}

function QuoteForm({ initial, onCancel, onSaved }: { initial?: QuoteWithItems; onCancel: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clientId, setClientId] = useState<number | null>(initial?.quote.client_id ?? null);
  const [validUntil, setValidUntil] = useState(initial?.quote.valid_until ?? "");
  const [notes, setNotes] = useState(initial?.quote.notes ?? "");
  const [discountStr, setDiscountStr] = useState(
    initial && initial.quote.discount_cents > 0 ? (initial.quote.discount_cents / 100).toFixed(2) : ""
  );
  const [items, setItems] = useState<{ product_id: number | null; name: string; unit_price_cents: number; discount_pct: number; qty: number; priceStr: string }[]>(
    initial && initial.items.length > 0
      ? initial.items.map((i) => ({
          product_id: i.product_id,
          name: i.name,
          unit_price_cents: i.unit_price_cents,
          discount_pct: i.discount_pct,
          qty: i.qty,
          priceStr: (i.unit_price_cents / 100).toFixed(2),
        }))
      : [{ product_id: null, name: "", unit_price_cents: 0, discount_pct: 0, qty: 1, priceStr: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  useEscapeToClose(onCancel);

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
      if (initial) {
        await api.updateQuote(initial.quote.id, q);
        showToast({ message: "Presupuesto actualizado", tone: "success" });
      } else {
        await api.createQuote(q);
        showToast({ message: "Presupuesto creado", tone: "success" });
      }
      onSaved();
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo guardar el presupuesto", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[680px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <div className="p-5 border-b border-stone-200 pr-10">
          <h2 className="font-semibold text-lg">{initial ? `Editar presupuesto #${initial.quote.id}` : "Nuevo presupuesto"}</h2>
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
            {saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear presupuesto"}
          </button>
        </div>
      </div>
    </div>
  );
}
