import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents } from "@/lib/format";
import { confirmAction, showToast } from "@/stores/dialogs";
import type { Combo, ComboWithItems, NewCombo, NewComboItem, Product } from "@/types";
import clsx from "clsx";

export default function Combos() {
  const [combos, setCombos] = useState<ComboWithItems[]>([]);
  const [editing, setEditing] = useState<ComboWithItems | null | "new">(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  async function load() {
    try {
      const list = await api.listCombos();
      setCombos(list);
      setEnabled(true);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(id: number) {
    try {
      await api.toggleCombo(id);
      load();
    } catch (e) { console.error(e); }
  }

  async function handleDelete(id: number) {
    if (!(await confirmAction("Esta acción no se puede deshacer.", { title: "¿Eliminar este combo?", danger: true, confirmLabel: "Eliminar" }))) return;
    try {
      await api.deleteCombo(id);
      load();
      showToast({ message: "Combo eliminado" });
    } catch (e) { console.error(e); showToast({ message: "No se pudo eliminar el combo", tone: "danger" }); }
  }

  async function handleSave(input: NewCombo, id?: number) {
    try {
      if (id) {
        await api.updateCombo(id, input);
      } else {
        await api.createCombo(input);
      }
      setEditing(null);
      load();
      showToast({ message: id ? "Combo actualizado" : "Combo creado", tone: "success" });
    } catch (e) {
      showToast({ message: `Error: ${String(e)}`, tone: "danger" });
    }
  }

  if (enabled === false) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="text-4xl mb-4">🎁</div>
        <h2 className="text-lg font-semibold mb-2">Combos y packs deshabilitados</h2>
        <p className="text-stone-500 text-sm max-w-sm">
          Activá esta función en <strong>Configuración → Funciones opcionales → Combos y packs</strong> para empezar a crear combinaciones de productos.
        </p>
      </div>
    );
  }

  const active = combos.filter((c) => c.combo.active);
  const inactive = combos.filter((c) => !c.combo.active);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Combos y packs</h1>
          <p className="text-xs text-stone-500 mt-0.5">Al vender un combo, el stock se descuenta de cada componente</p>
        </div>
        <button onClick={() => setEditing("new")} className="btn btn-primary">+ Nuevo combo</button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {combos.length === 0 && (
          <div className="card p-12 text-center">
            <div className="text-3xl mb-3">🎁</div>
            <div className="text-stone-400 text-sm">Sin combos creados aún</div>
            <button onClick={() => setEditing("new")} className="btn btn-primary mt-4 text-sm">Crear primer combo</button>
          </div>
        )}

        {active.length > 0 && (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">Activos ({active.length})</h2>
            <div className="space-y-2">
              {active.map((cw) => (
                <ComboCard key={cw.combo.id} cw={cw} onToggle={() => handleToggle(cw.combo.id)} onEdit={() => setEditing(cw)} onDelete={() => handleDelete(cw.combo.id)} />
              ))}
            </div>
          </section>
        )}

        {inactive.length > 0 && (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">Inactivos ({inactive.length})</h2>
            <div className="space-y-2 opacity-60">
              {inactive.map((cw) => (
                <ComboCard key={cw.combo.id} cw={cw} onToggle={() => handleToggle(cw.combo.id)} onEdit={() => setEditing(cw)} onDelete={() => handleDelete(cw.combo.id)} />
              ))}
            </div>
          </section>
        )}
      </div>

      {editing !== null && (
        <ComboForm
          cw={editing === "new" ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ComboCard({ cw, onToggle, onEdit, onDelete }: {
  cw: ComboWithItems;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { combo, items } = cw;
  const margin_pct = combo.cost_cents > 0
    ? ((combo.price_cents - combo.cost_cents) / combo.price_cents * 100).toFixed(1)
    : null;

  return (
    <div className="card p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{combo.name}</span>
          {combo.barcode && <span className="text-[10px] font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-500">{combo.barcode}</span>}
        </div>
        <div className="text-xs text-stone-500 mb-1.5">
          Componentes: {items.map((i) => `${i.product_name} ×${i.qty}`).join(", ")}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-stone-800">{centsToARS(combo.price_cents)}</span>
          {combo.cost_cents > 0 && (
            <span className="text-stone-400">Costo: {centsToARS(combo.cost_cents)}</span>
          )}
          {margin_pct && (
            <span className={clsx("font-medium", Number(margin_pct) >= 20 ? "text-emerald-600" : Number(margin_pct) >= 10 ? "text-amber-600" : "text-red-600")}>
              {margin_pct}% margen
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onToggle}
          className={clsx("px-2.5 py-1 rounded-md text-sm font-medium border transition-colors",
            combo.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-stone-100 text-stone-600")}>
          {combo.active ? "Activo" : "Inactivo"}
        </button>
        <button onClick={onEdit} className="btn-table-neutral">Editar</button>
        <button onClick={onDelete} className="btn-table-danger">Eliminar</button>
      </div>
    </div>
  );
}

function ProductSearch({ onSelect }: { onSelect: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.listProducts(q).then((r) => { setResults(r.slice(0, 8)); setShow(r.length > 0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative" ref={ref}>
      <input className="input w-full text-sm" value={q} placeholder="Buscar producto para agregar…"
        onChange={(e) => { setQ(e.target.value); setShow(true); }}
        onBlur={() => setTimeout(() => setShow(false), 150)} />
      {show && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-stone-200 rounded-md shadow-lg mt-0.5 max-h-48 overflow-y-auto">
          {results.map((p) => (
            <div key={p.id} className="px-3 py-2 hover:bg-stone-50 cursor-pointer"
              onMouseDown={() => { onSelect(p); setQ(""); setShow(false); }}>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-stone-400">{p.category} · {centsToARS(p.price_cents)} · Stock: {p.stock}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComboForm({ cw, onSave, onCancel }: {
  cw: ComboWithItems | null;
  onSave: (input: NewCombo, id?: number) => void;
  onCancel: () => void;
}) {
  const isNew = !cw;
  const [name, setName] = useState(cw?.combo.name ?? "");
  const [barcode, setBarcode] = useState(cw?.combo.barcode ?? "");
  const [priceStr, setPriceStr] = useState(cw ? (cw.combo.price_cents / 100).toString() : "");
  const [notes, setNotes] = useState(cw?.combo.notes ?? "");
  const [items, setItems] = useState<Array<{ product_id: number; product_name: string; qty: number }>>(
    cw?.items.map((i) => ({ product_id: i.product_id, product_name: i.product_name, qty: i.qty })) ?? []
  );

  function addProduct(p: Product) {
    const existing = items.findIndex((i) => i.product_id === p.id);
    if (existing >= 0) {
      const next = [...items];
      next[existing] = { ...next[existing], qty: next[existing].qty + 1 };
      setItems(next);
    } else {
      setItems([...items, { product_id: p.id, product_name: p.name, qty: 1 }]);
    }
  }

  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)); }
  function setQty(idx: number, qty: number) {
    if (qty <= 0) { removeItem(idx); return; }
    const next = [...items];
    next[idx] = { ...next[idx], qty };
    setItems(next);
  }

  function submit() {
    if (!name.trim()) { showToast({ message: "El nombre es obligatorio", tone: "danger" }); return; }
    if (items.length === 0) { showToast({ message: "Agregá al menos un componente", tone: "danger" }); return; }
    const input: NewCombo = {
      name: name.trim(),
      barcode: barcode.trim() || null,
      price_cents: arsStringToCents(priceStr),
      notes: notes.trim() || null,
      items: items.map((i): NewComboItem => ({ product_id: i.product_id, qty: i.qty })),
    };
    onSave(input, cw?.combo.id);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-lg mb-5">{isNew ? "Nuevo combo" : "Editar combo"}</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Nombre del combo *</span>
              <input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Combo Mate + Galletitas" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-stone-600 block mb-1">Código de barras (opcional)</span>
              <input className="input font-mono text-sm" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="7790070000000" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Precio del combo *</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input className="input pl-6 tabular" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="numeric" placeholder="0" />
            </div>
          </label>

          <div>
            <span className="text-xs font-medium text-stone-600 block mb-1">Componentes *</span>
            <ProductSearch onSelect={addProduct} />
            {items.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-stone-50 rounded-md border border-stone-200">
                    <span className="flex-1 text-sm">{item.product_name}</span>
                    <span className="text-xs text-stone-400">Cantidad:</span>
                    <input type="number" min="0.1" step="0.1" className="w-16 input text-sm tabular text-center py-1"
                      value={item.qty} onChange={(e) => setQty(idx, Number(e.target.value))} />
                    <button onClick={() => removeItem(idx)} className="text-stone-400 hover:text-red-600 text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            )}
            {items.length === 0 && (
              <div className="mt-2 text-xs text-stone-400 text-center py-3 border border-dashed border-stone-200 rounded-md">
                Buscá productos arriba para agregarlos al combo
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-stone-600 block mb-1">Notas internas</span>
            <input className="input text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Solo disponible en temporada alta" />
          </label>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} className="btn btn-primary flex-1">{isNew ? "Crear combo" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
