import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/format";
import type { ExpiringLot, NewProductLot, Product } from "@/types";
import clsx from "clsx";

function daysLabel(days: number) {
  if (days < 0) return "Vencido";
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Mañana";
  return `${days} días`;
}

function urgencyClass(days: number) {
  if (days < 0) return "bg-red-100 text-red-800 border-red-200";
  if (days <= 3) return "bg-red-50 text-red-700 border-red-200";
  if (days <= 7) return "bg-amber-50 text-amber-700 border-amber-200";
  if (days <= 30) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-stone-50 text-stone-600 border-stone-200";
}

function badgeClass(days: number) {
  if (days < 0) return "bg-red-600 text-white";
  if (days <= 3) return "bg-red-500 text-white";
  if (days <= 7) return "bg-amber-500 text-white";
  if (days <= 30) return "bg-yellow-500 text-white";
  return "bg-stone-400 text-white";
}

export default function Vencimientos() {
  const [lots, setLots] = useState<ExpiringLot[]>([]);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<number | null>(null);
  const [editingLot, setEditingLot] = useState<ExpiringLot | null>(null);
  const [addingLot, setAddingLot] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.listExpiringLots(days);
      setLots(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function retireLot(lot: ExpiringLot) {
    if (!confirm(`¿Retirar este lote de "${lot.product_name}"? Se quitarán ${lot.qty} unidades del stock.`)) return;
    setRetiringId(lot.lot_id);
    try {
      await api.retireLot(lot.lot_id);
      await load();
    } finally {
      setRetiringId(null);
    }
  }

  const today = todayISO();
  const expired = lots.filter((l) => l.days_left < 0);
  const critical = lots.filter((l) => l.days_left >= 0 && l.days_left <= 3);
  const soon = lots.filter((l) => l.days_left > 3 && l.days_left <= 7);
  const upcoming = lots.filter((l) => l.days_left > 7);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Vencimientos</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Hoy: {formatDate(today + "T00:00:00")} — Cada fila es un lote separado (FEFO)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-stone-500">Mostrar hasta</span>
          <select
            className="input w-auto text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
          <button onClick={load} className="btn btn-secondary text-sm">
            Actualizar
          </button>
          <button
            onClick={() => setAddingLot(true)}
            className="btn btn-secondary text-sm"
          >
            + Agregar lote
          </button>
          <button
            onClick={async () => {
              setGenerating(true);
              setOrderMsg(null);
              try {
                const orders = await api.generateAutoOrders();
                setOrderMsg(orders.length > 0
                  ? `✓ ${orders.length} orden(es) de compra generadas`
                  : "Sin productos con stock bajo asociados a proveedores");
              } catch (e) {
                setOrderMsg(`Error: ${String(e)}`);
              } finally {
                setGenerating(false);
              }
            }}
            disabled={generating}
            className="btn btn-primary text-sm disabled:opacity-40"
          >
            {generating ? "Generando…" : "📋 Generar órdenes de compra"}
          </button>
        </div>
      </div>

      {orderMsg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm border ${orderMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"} flex items-center justify-between`}>
          <span>{orderMsg}</span>
          <button onClick={() => setOrderMsg(null)} className="ml-3 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Lotes vencidos" count={expired.length} color="text-red-700" bg="bg-red-50 border-red-200" />
        <SummaryCard label="Críticos (≤3 días)" count={critical.length} color="text-red-600" bg="bg-red-50 border-red-100" />
        <SummaryCard label="Próximos (≤7 días)" count={soon.length} color="text-amber-700" bg="bg-amber-50 border-amber-200" />
        <SummaryCard label={`Próximos ${days} días`} count={upcoming.length} color="text-stone-600" bg="bg-stone-50 border-stone-200" />
      </div>

      {loading ? (
        <p className="text-stone-400 text-sm">Cargando…</p>
      ) : lots.length === 0 ? (
        <div className="card flex-1 flex items-center justify-center text-stone-400">
          No hay lotes próximos a vencer en los próximos {days} días.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3">
          {[
            { label: "VENCIDOS", items: expired },
            { label: "CRÍTICOS — VENCEN EN 1-3 DÍAS", items: critical },
            { label: "PRÓXIMOS — VENCEN EN 4-7 DÍAS", items: soon },
            { label: `PRÓXIMOS ${days} DÍAS`, items: upcoming },
          ].map(
            ({ label, items }) =>
              items.length > 0 && (
                <section key={label}>
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
                    {label} ({items.length} lotes)
                  </h2>
                  <div className="space-y-1.5">
                    {items.map((lot) => (
                      <div
                        key={lot.lot_id}
                        className={clsx(
                          "flex items-center justify-between rounded-md border px-4 py-2.5",
                          urgencyClass(lot.days_left)
                        )}
                      >
                        <div>
                          <div className="font-medium text-sm">{lot.product_name}</div>
                          <div className="text-xs opacity-70 mt-0.5">
                            {lot.barcode ? `Cód: ${lot.barcode}` : "Sin código"} · Lote: <span className="font-semibold">{lot.qty} unidades</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingLot(lot)}
                            className="text-xs px-2 py-1 rounded border border-current opacity-60 hover:opacity-100"
                          >
                            Editar vto.
                          </button>
                          {lot.days_left < 0 && lot.qty > 0 && (
                            <button
                              onClick={() => retireLot(lot)}
                              disabled={retiringId === lot.lot_id}
                              className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                            >
                              {retiringId === lot.lot_id ? "Retirando…" : "Retirar lote"}
                            </button>
                          )}
                          <div className="text-right text-xs">
                            <div className="font-medium">{formatDate(lot.expires_at)}</div>
                          </div>
                          <span
                            className={clsx(
                              "text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap",
                              badgeClass(lot.days_left)
                            )}
                          >
                            {daysLabel(lot.days_left)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
          )}
        </div>
      )}

      {editingLot && (
        <EditExpiryModal
          lot={editingLot}
          onClose={() => setEditingLot(null)}
          onSaved={() => { setEditingLot(null); load(); }}
        />
      )}

      {addingLot && (
        <AddLotModal
          onClose={() => setAddingLot(false)}
          onSaved={() => { setAddingLot(false); load(); }}
        />
      )}
    </div>
  );
}

function EditExpiryModal({
  lot,
  onClose,
  onSaved,
}: {
  lot: ExpiringLot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(lot.expires_at.slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateLotExpiry(lot.lot_id, date || null);
      onSaved();
    } catch (e) {
      console.error(e);
      alert("Error al actualizar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-80 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-1">Editar vencimiento del lote</h2>
        <p className="text-sm text-stone-500 mb-4">{lot.product_name} · {lot.qty} unidades</p>
        <label className="block mb-5">
          <span className="text-xs font-medium text-stone-600 block mb-1">Nueva fecha</span>
          <input
            autoFocus
            type="date"
            className="input w-full"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn btn-primary flex-1">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddLotModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<number | "">("");
  const [qty, setQty] = useState(1);
  const [costCents, setCostCents] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listProducts("").then(setProducts).catch(console.error);
  }, []);

  async function save() {
    if (!productId) { alert("Seleccioná un producto"); return; }
    if (qty <= 0) { alert("La cantidad debe ser mayor a 0"); return; }
    setSaving(true);
    try {
      const input: NewProductLot = {
        product_id: productId as number,
        qty,
        cost_cents: costCents,
        expires_at: expiresAt || null,
        notes: notes || null,
      };
      await api.addProductLot(input);
      onSaved();
    } catch (e) {
      console.error(e);
      alert("Error al crear lote");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-96 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-4">Agregar lote manual</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Producto</span>
            <select
              className="input w-full"
              value={productId}
              onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">— Seleccionar —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Cantidad</span>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Costo unitario ($)</span>
            <input
              type="number"
              min={0}
              className="input w-full"
              value={costCents / 100}
              onChange={(e) => setCostCents(Math.round(Number(e.target.value) * 100))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Fecha de vencimiento (opcional)</span>
            <input
              type="date"
              className="input w-full"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Notas</span>
            <input
              type="text"
              className="input w-full"
              placeholder="Ej: Lote proveedor, remito nro..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn btn-primary flex-1">
            {saving ? "Guardando…" : "Agregar lote"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  color,
  bg,
}: {
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={clsx("card border p-4", bg)}>
      <div className={clsx("text-3xl font-bold tabular", color)}>{count}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
    </div>
  );
}
