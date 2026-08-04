import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CountAdjustment, InventoryCountItem } from "@/types";
import clsx from "clsx";
import { Barcode } from "lucide-react";
import HelpButton from "@/components/HelpModal";
import { confirmAction, showToast } from "@/stores/dialogs";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

type Step = "inicio" | "contando" | "revision" | "aplicado";

interface CountedItem extends InventoryCountItem {
  counted: number | "";
}

// Guardado incremental del conteo en progreso: si se cierra la app (o se corta la luz)
// a mitad de un conteo, al volver a "Iniciar conteo" se ofrece retomarlo en vez de perderlo.
const DRAFT_KEY = "kiosco_inventario_draft_v1";

interface DraftShape {
  savedAt: string;
  items: { product_id: number; counted: number }[];
}

function loadDraft(): DraftShape | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftShape;
  } catch {
    return null;
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export default function Inventario() {
  const [products, setProducts] = useState<CountedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [step, setStep] = useState<Step>("inicio");
  const [result, setResult] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [search, setSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);

  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Foco automático campo-a-campo: al escanear un código, se mueve el foco a la
  // celda de cantidad correspondiente en vez de obligar a buscar la fila con el mouse.
  useEffect(() => {
    if (pendingFocusId === null) return;
    const el = qtyRefs.current[pendingFocusId];
    el?.focus();
    el?.select();
    setPendingFocusId(null);
  }, [pendingFocusId]);

  // Guardado incremental: cada vez que cambian las cantidades contadas (con debounce
  // para no escribir en cada tecla), se persiste en localStorage.
  const debouncedProducts = useDebouncedValue(products, 500);
  useEffect(() => {
    if (step !== "contando") return;
    const items = debouncedProducts
      .filter((p) => p.counted !== "")
      .map((p) => ({ product_id: p.product_id, counted: Number(p.counted) }));
    if (items.length === 0) {
      clearDraft();
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), items } satisfies DraftShape));
  }, [debouncedProducts, step]);

  async function startCount() {
    setLoading(true);
    try {
      const items = await api.listInventoryCount();
      let counted: CountedItem[] = items.map((p) => ({ ...p, counted: "" }));

      const draft = loadDraft();
      if (draft && draft.items.length > 0) {
        const draftDate = new Date(draft.savedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
        const resume = await confirmAction(
          `Hay un conteo sin terminar guardado el ${draftDate} (${draft.items.length} producto${draft.items.length !== 1 ? "s" : ""} contado${draft.items.length !== 1 ? "s" : ""}).`,
          { title: "¿Retomar el conteo anterior?", confirmLabel: "Retomar" }
        );
        if (resume) {
          const byId = new Map(draft.items.map((d) => [d.product_id, d.counted]));
          counted = counted.map((p) => byId.has(p.product_id) ? { ...p, counted: byId.get(p.product_id)! } : p);
        } else {
          clearDraft();
        }
      }

      setProducts(counted);
      setStep("contando");
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudieron cargar los productos", tone: "danger" });
    } finally {
      setLoading(false);
    }
  }

  function handleScan() {
    const code = scanValue.trim();
    setScanValue("");
    if (!code) return;
    const match = products.find((p) => p.barcode === code);
    if (!match) {
      showToast({ message: `Código "${code}" no encontrado en el conteo`, tone: "danger" });
      return;
    }
    setFilterCat("");
    setSearch("");
    setPendingFocusId(match.product_id);
  }

  function setCount(productId: number, value: string) {
    // parseFloat (no parseInt): productos que se venden por peso necesitan contar en decimales (ej. 2.750 kg).
    const n = value === "" ? "" : Math.max(0, parseFloat(value) || 0);
    setProducts((prev) => prev.map((p) =>
      p.product_id === productId ? { ...p, counted: n } : p
    ));
  }

  function moveToReview() {
    setStep("revision");
  }

  async function applyCount() {
    const adjustments: CountAdjustment[] = products
      .filter((p) => p.counted !== "" && Number(p.counted) !== p.system_stock)
      .map((p) => ({ product_id: p.product_id, counted_qty: Number(p.counted) }));

    if (adjustments.length === 0) {
      showToast({ message: "No hay diferencias — el stock ya está correcto" });
      return;
    }

    const ok = await confirmAction(
      `Se van a ajustar ${adjustments.length} producto(s) al stock que contaste.`,
      { title: "¿Aplicar el conteo?", confirmLabel: "Aplicar" }
    );
    if (!ok) return;

    setApplying(true);
    try {
      const count = await api.applyInventoryCount(adjustments);
      clearDraft();
      setResult(count);
      setStep("aplicado");
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo aplicar el conteo", tone: "danger" });
    } finally {
      setApplying(false);
    }
  }

  const categories = [...new Set(products.map((p) => p.category ?? "(sin categoría)"))].sort();

  const filtered = products.filter((p) => {
    const cat = p.category ?? "(sin categoría)";
    if (filterCat && cat !== filterCat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !(p.barcode ?? "").includes(search)) return false;
    return true;
  });

  const countedCount = products.filter((p) => p.counted !== "").length;
  const diffCount = products.filter((p) => p.counted !== "" && Number(p.counted) !== p.system_stock).length;

  if (step === "inicio") {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 gap-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">📦</div>
          <h1 className="text-2xl font-bold mb-2">Conteo de inventario</h1>
          <p className="text-stone-500 text-sm">
            El sistema cargará todos los productos activos. Ingresás la cantidad contada físicamente
            para cada uno, y el sistema registra los ajustes automáticamente.
          </p>
        </div>
        <button
          onClick={startCount}
          disabled={loading}
          className="btn btn-primary text-base px-8 py-3 disabled:opacity-40"
        >
          {loading ? "Cargando…" : "Iniciar conteo"}
        </button>
        <HelpButton module="inventario" />
      </div>
    );
  }

  if (step === "aplicado") {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 gap-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold mb-2">Conteo aplicado</h1>
          <p className="text-stone-500 text-sm">
            Se ajustaron <strong>{result}</strong> producto{result !== 1 ? "s" : ""} con diferencias entre el stock del sistema y el conteo físico.
          </p>
        </div>
        <button
          onClick={() => { setStep("inicio"); setProducts([]); setResult(null); }}
          className="btn btn-secondary"
        >
          Nuevo conteo
        </button>
        <HelpButton module="inventario" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {step === "contando" ? "Conteo de inventario" : "Revisión de diferencias"}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {countedCount} / {products.length} contados · {diffCount} diferencia{diffCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {step === "contando" && (
            <>
              <button onClick={() => { clearDraft(); setStep("inicio"); setProducts([]); }} className="btn btn-secondary text-sm">
                Cancelar
              </button>
              <button
                onClick={moveToReview}
                disabled={countedCount === 0}
                className="btn btn-primary text-sm disabled:opacity-40"
              >
                Ver diferencias →
              </button>
            </>
          )}
          {step === "revision" && (
            <>
              <button onClick={() => setStep("contando")} className="btn btn-secondary text-sm">
                ← Volver a contar
              </button>
              <button
                onClick={applyCount}
                disabled={applying || diffCount === 0}
                className="btn btn-primary text-sm disabled:opacity-40"
              >
                {applying ? "Aplicando…" : `Aplicar ${diffCount} ajuste${diffCount !== 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Escaneo rápido — solo en modo contando */}
      {step === "contando" && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-indigo-200 bg-indigo-50/50 px-3 py-2">
          <Barcode className="w-5 h-5 text-indigo-500 shrink-0" />
          <input
            ref={barcodeRef}
            autoFocus
            type="text"
            className="input text-sm flex-1 bg-white"
            placeholder="Escaneá el código de barras…"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } }}
          />
          <span className="text-xs text-indigo-400 shrink-0 hidden sm:inline">
            El foco salta a la cantidad — Enter la confirma y vuelve acá
          </span>
        </div>
      )}

      {/* Filtros — solo en modo contando */}
      {step === "contando" && (
        <div className="flex items-center gap-3">
          <input
            type="text"
            className="input text-sm flex-1"
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input text-sm w-48"
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tabla */}
      <div className="flex-1 overflow-y-auto card">
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Producto</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Categoría</th>
              <th className="text-right px-4 py-2.5 font-medium">Stock sistema</th>
              {step === "revision"
                ? <th className="text-right px-4 py-2.5 font-medium">Contado</th>
                : <th className="text-right px-4 py-2.5 font-medium w-32">Cantidad contada</th>
              }
              {step === "revision" && <th className="text-right px-4 py-2.5 font-medium">Diferencia</th>}
            </tr>
          </thead>
          <tbody>
            {(step === "contando" ? filtered : products.filter((p) => p.counted !== "" && Number(p.counted) !== p.system_stock)).map((p) => {
              const diff = p.counted !== "" ? Number(p.counted) - p.system_stock : null;
              return (
                <tr
                  key={p.product_id}
                  className={clsx(
                    "border-t border-stone-100",
                    step === "revision" && diff !== null && diff !== 0 && "bg-amber-50",
                  )}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{p.name}</div>
                    {p.barcode && <div className="text-xs text-stone-400 font-mono">{p.barcode}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500 hidden md:table-cell">{p.category ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{p.system_stock}</td>
                  {step === "contando" ? (
                    <td className="px-4 py-2.5 text-right">
                      <input
                        ref={(el) => { qtyRefs.current[p.product_id] = el; }}
                        type="number"
                        min={0}
                        step="0.001"
                        className={clsx(
                          "input text-right tabular w-24 text-sm",
                          p.counted !== "" && Number(p.counted) !== p.system_stock && "border-amber-400 bg-amber-50"
                        )}
                        placeholder="—"
                        value={p.counted}
                        onChange={(e) => setCount(p.product_id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            barcodeRef.current?.focus();
                            barcodeRef.current?.select();
                          }
                        }}
                      />
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right tabular font-semibold">{p.counted}</td>
                      <td className={clsx(
                        "px-4 py-2.5 text-right tabular font-bold",
                        diff !== null && diff > 0 ? "text-emerald-600" : "text-red-600"
                      )}>
                        {diff !== null && diff > 0 ? `+${diff}` : diff}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {step === "revision" && diffCount === 0 && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            No hay diferencias — el stock físico coincide con el sistema
          </div>
        )}
      </div>

      <HelpButton module="inventario" />
    </div>
  );
}
