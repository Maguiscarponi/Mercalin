import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, todayISO } from "@/lib/format";
import { confirmAction, showToast } from "@/stores/dialogs";
import Field from "@/components/ui/Field";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import type { NewPromotion, Product, Promotion, PromoAppliesTo, PromoType } from "@/types";
import clsx from "clsx";

const TYPE_LABELS: Record<PromoType, string> = {
  pct: "% Descuento",
  fixed: "$ Fijo",
  "2x1": "2×1",
  "3x2": "3×2",
};

const TYPE_COLORS: Record<PromoType, string> = {
  pct: "bg-blue-100 text-blue-700",
  fixed: "bg-emerald-100 text-emerald-700",
  "2x1": "bg-purple-100 text-purple-700",
  "3x2": "bg-orange-100 text-orange-700",
};

function promoSummary(p: Promotion): string {
  switch (p.promo_type) {
    case "pct": return `${p.value}% de descuento`;
    case "fixed": return `${centsToARS(p.value)} de descuento`;
    case "2x1": return "Llevá 2, pagá 1";
    case "3x2": return "Llevá 3, pagá 2";
  }
}

function targetLabel(p: Promotion): string {
  if (p.applies_to === "all") return "Todo el comercio";
  if (p.applies_to === "category") return `Categoría: ${p.target_name || "—"}`;
  return `Producto: ${p.target_name || "—"}`;
}

export default function Promociones() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [editing, setEditing] = useState<Partial<Promotion> | null>(null);

  async function load() {
    try {
      setPromos(await api.listPromotions());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(id: number) {
    try {
      const updated = await api.togglePromotion(id);
      setPromos((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo cambiar el estado de la promoción", tone: "danger" });
    }
  }

  async function handleDelete(id: number) {
    if (!(await confirmAction("Esta acción no se puede deshacer.", { title: "¿Eliminar esta promoción?", danger: true, confirmLabel: "Eliminar" }))) return;
    try {
      await api.deletePromotion(id);
      load();
      showToast({ message: "Promoción eliminada" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo eliminar la promoción", tone: "danger" });
    }
  }

  async function handleSave(promo: Partial<Promotion>) {
    try {
      if (promo.id) {
        await api.updatePromotion(promo as Promotion);
      } else {
        await api.createPromotion(promo as NewPromotion);
      }
      setEditing(null);
      load();
      showToast({ message: "Promoción guardada", tone: "success" });
    } catch (err) {
      console.error(err);
      showToast({ message: "No se pudo guardar la promoción", tone: "danger" });
    }
  }

  const today = todayISO();
  const active = promos.filter((p) => p.active && (!p.ends_at || p.ends_at >= today));
  const expired = promos.filter((p) => p.active && p.ends_at && p.ends_at < today);
  const inactive = promos.filter((p) => !p.active);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Promociones y Descuentos</h1>
        <button
          onClick={() =>
            setEditing({ promo_type: "pct", applies_to: "all", value: 0, active: true })
          }
          className="btn btn-primary"
        >
          + Nueva promoción
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Activas */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
            Activas ({active.length})
          </h2>
          {active.length === 0 ? (
            <div className="card p-6 text-center text-stone-400 text-sm">
              No hay promociones activas
            </div>
          ) : (
            <div className="space-y-2">
              {active.map((p) => (
                <PromoCard
                  key={p.id}
                  promo={p}
                  today={today}
                  onToggle={() => handleToggle(p.id)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Expiradas */}
        {expired.length > 0 && (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-2">
              Expiradas ({expired.length}) — fecha de fin pasada
            </h2>
            <div className="space-y-2 opacity-70">
              {expired.map((p) => (
                <PromoCard
                  key={p.id}
                  promo={p}
                  today={today}
                  onToggle={() => handleToggle(p.id)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Inactivas */}
        {inactive.length > 0 && (
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">
              Inactivas ({inactive.length})
            </h2>
            <div className="space-y-2 opacity-60">
              {inactive.map((p) => (
                <PromoCard
                  key={p.id}
                  promo={p}
                  today={today}
                  onToggle={() => handleToggle(p.id)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {editing !== null && (
        <PromoForm
          promo={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function promoConditionsSummary(p: Promotion): string | null {
  const parts: string[] = [];
  if (p.days_of_week) {
    try {
      const days: number[] = JSON.parse(p.days_of_week);
      if (days.length > 0 && days.length < 7) {
        parts.push(days.map((d) => DAY_LABELS[d]).join(", "));
      }
    } catch { /* ignore */ }
  }
  if (p.time_start && p.time_end) parts.push(`${p.time_start}–${p.time_end}`);
  else if (p.time_start) parts.push(`desde ${p.time_start}`);
  if (p.min_qty && p.min_qty > 1) parts.push(`mín. ${p.min_qty} ud.`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function PromoCard({
  promo,
  today,
  onToggle,
  onEdit,
  onDelete,
}: {
  promo: Promotion;
  today: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const expired = promo.ends_at && promo.ends_at < today;
  const conditions = promoConditionsSummary(promo);

  return (
    <div className="card p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className={clsx("text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap", TYPE_COLORS[promo.promo_type])}>
          {TYPE_LABELS[promo.promo_type]}
        </span>
        <div>
          <div className="font-medium text-sm">{promo.name}</div>
          <div className="text-xs text-stone-500 mt-0.5">
            {promoSummary(promo)} · {targetLabel(promo)}
          </div>
          {conditions && (
            <div className="text-xs text-indigo-600 mt-0.5">⏰ {conditions}</div>
          )}
          {(promo.starts_at || promo.ends_at) && (
            <div className="text-xs text-stone-400 mt-1">
              {promo.starts_at && `Desde ${promo.starts_at}`}
              {promo.starts_at && promo.ends_at && " — "}
              {promo.ends_at && `Hasta ${promo.ends_at}`}
              {expired && <span className="ml-2 text-red-500 font-medium">Expirada</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onToggle}
          className={clsx(
            "px-2.5 py-1 rounded-md text-sm font-medium border transition-colors",
            promo.active
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-stone-200 bg-stone-100 text-stone-600 hover:bg-stone-200"
          )}
        >
          {promo.active ? "Activa" : "Inactiva"}
        </button>
        <button onClick={onEdit} className="btn-table-neutral">Editar</button>
        <button onClick={onDelete} className="btn-table-danger">Eliminar</button>
      </div>
    </div>
  );
}

function ProductPicker({
  value,
  hasSelection,
  onChangeText,
  onSelect,
}: {
  value: string;
  hasSelection: boolean;
  onChangeText: (name: string) => void;
  onSelect: (p: Product) => void;
}) {
  const [results, setResults] = useState<Product[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.listProducts(value).then((r) => { setResults(r.slice(0, 8)); setShowDrop(r.length > 0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="relative" ref={ref}>
      <input
        className="input w-full"
        value={value}
        onChange={(e) => { onChangeText(e.target.value); setShowDrop(true); }}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder="Buscar producto del catálogo…"
      />
      {!hasSelection && value.trim() && (
        <p className="text-xs text-amber-600 mt-1">Elegí un producto de la lista de abajo — si solo escribís el nombre, la promoción no se va a aplicar.</p>
      )}
      {showDrop && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-stone-200 rounded-md shadow-lg mt-0.5 max-h-48 overflow-y-auto">
          {results.map((p) => (
            <div
              key={p.id}
              className="px-3 py-2 hover:bg-stone-50 cursor-pointer"
              onMouseDown={() => { onSelect(p); setShowDrop(false); }}
            >
              <div className="text-sm font-medium">{p.name}</div>
              {p.category && <div className="text-xs text-stone-400">{p.category}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromoForm({
  promo,
  onSave,
  onCancel,
}: {
  promo: Partial<Promotion>;
  onSave: (p: Partial<Promotion>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Promotion>>({
    days_of_week: null, time_start: null, time_end: null, min_qty: null,
    ...promo,
  });
  const [valueStr, setValueStr] = useState(
    promo.value ? (promo.promo_type === "fixed" ? String(promo.value / 100) : String(promo.value)) : ""
  );
  const [showConditions, setShowConditions] = useState(
    !!(promo.days_of_week || promo.time_start || promo.time_end || promo.min_qty)
  );
  const [categories, setCategories] = useState<string[]>([]);
  const isNew = !promo.id;
  useEscapeToClose(onCancel);
  const needsValue = form.promo_type === "pct" || form.promo_type === "fixed";

  useEffect(() => {
    api.listCategories().then((cats) => setCategories(cats.map((c) => c.name).filter(Boolean))).catch(() => {});
  }, []);

  function set<K extends keyof Promotion>(k: K, v: Promotion[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleDay(day: number) {
    const current: number[] = form.days_of_week ? JSON.parse(form.days_of_week) : [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    set("days_of_week", next.length > 0 ? JSON.stringify(next) : null as unknown as string);
  }

  function submit() {
    if (!form.name?.trim()) { showToast({ message: "El nombre es obligatorio", tone: "danger" }); return; }
    if (form.applies_to === "product" && !form.target_id) {
      showToast({ message: "Elegí el producto de la lista de sugerencias — si solo escribís el nombre, la promoción no se va a aplicar en la caja.", tone: "danger" });
      return;
    }
    if (form.applies_to === "category" && !form.target_name?.trim()) {
      showToast({ message: "Elegí una categoría", tone: "danger" });
      return;
    }
    const value = form.promo_type === "fixed" ? arsStringToCents(valueStr) : parseFloat(valueStr) || 0;
    onSave({ ...form, value });
  }

  const selectedDays: number[] = form.days_of_week ? (() => { try { return JSON.parse(form.days_of_week); } catch { return []; } })() : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h2 className="font-semibold text-lg mb-5">{isNew ? "Nueva promoción" : "Editar promoción"}</h2>

        <div className="space-y-3">
          <Field label="Nombre de la promoción">
            <input autoFocus className="input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Ej: 2x1 en Chiclets, Bebidas -10%" />
          </Field>

          <Field label="Tipo de promoción">
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(TYPE_LABELS) as PromoType[]).map((t) => (
                <button key={t} onClick={() => set("promo_type", t)}
                  className={clsx("py-2 rounded-md text-xs border transition-colors",
                    form.promo_type === t ? "bg-emerald-600 text-white border-emerald-600" : "bg-stone-50 border-stone-200 hover:bg-stone-100")}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>

          {needsValue && (
            <Field label={form.promo_type === "pct" ? "Porcentaje (%)" : "Monto fijo ($)"}>
              <input className="input tabular" value={valueStr} onChange={(e) => setValueStr(e.target.value)}
                placeholder={form.promo_type === "pct" ? "10" : "500"} inputMode="numeric" />
            </Field>
          )}

          <Field label="Aplica a">
            <select className="input" value={form.applies_to || "all"} onChange={(e) => set("applies_to", e.target.value as PromoAppliesTo)}>
              <option value="all">Todo el comercio</option>
              <option value="category">Una categoría</option>
              <option value="product">Un producto específico</option>
            </select>
          </Field>

          {form.applies_to === "category" && (
            <Field label="Categoría">
              <select className="input" value={form.target_name || ""} onChange={(e) => set("target_name", e.target.value)}>
                <option value="">Elegí una categoría…</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}
          {form.applies_to === "product" && (
            <Field label="Producto">
              <ProductPicker
                value={form.target_name || ""}
                hasSelection={!!form.target_id}
                onChangeText={(name) => { set("target_name", name); set("target_id", null as unknown as number); }}
                onSelect={(p) => { set("target_name", p.name); set("target_id", p.id); }}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Válida desde">
              <input type="date" className="input" value={form.starts_at || ""} onChange={(e) => set("starts_at", e.target.value || null as unknown as string)} />
            </Field>
            <Field label="Válida hasta">
              <input type="date" className="input" value={form.ends_at || ""} onChange={(e) => set("ends_at", e.target.value || null as unknown as string)} />
            </Field>
          </div>

          {/* Condiciones temporales opcionales */}
          <div className="border-t border-stone-100 pt-3">
            <button type="button" onClick={() => setShowConditions((s) => !s)}
              className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              {showConditions ? "▾" : "▸"} Condiciones avanzadas (horario, días, cantidad)
            </button>

            {showConditions && (
              <div className="mt-3 space-y-3 bg-stone-50 rounded-lg p-3 border border-stone-200">
                <div>
                  <label className="text-xs font-medium text-stone-600 block mb-1.5">Días de la semana (dejar vacío = todos)</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAY_LABELS.map((label, i) => (
                      <button key={i} type="button" onClick={() => toggleDay(i)}
                        className={clsx("px-2.5 py-1 rounded-md text-xs border transition-colors font-medium",
                          selectedDays.includes(i) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-stone-200 text-stone-600 hover:bg-stone-100")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Válida desde (hora)">
                    <input type="time" className="input text-sm" value={form.time_start || ""}
                      onChange={(e) => set("time_start", e.target.value || null as unknown as string)} />
                  </Field>
                  <Field label="Válida hasta (hora)">
                    <input type="time" className="input text-sm" value={form.time_end || ""}
                      onChange={(e) => set("time_end", e.target.value || null as unknown as string)} />
                  </Field>
                </div>

                <Field label="Cantidad mínima en carrito (ej: 3 para descuento a partir de 3 unidades)">
                  <input type="number" className="input tabular text-sm" min="1" placeholder="Sin mínimo"
                    value={form.min_qty ?? ""} onChange={(e) => set("min_qty", e.target.value ? Number(e.target.value) : null as unknown as number)} />
                </Field>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} className="btn btn-primary flex-1">{isNew ? "Crear" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

