import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CountAdjustment, InventoryCountItem } from "@/types";
import clsx from "clsx";
import HelpButton from "@/components/HelpModal";

type Step = "inicio" | "contando" | "revision" | "aplicado";

interface CountedItem extends InventoryCountItem {
  counted: number | "";
}

export default function Inventario() {
  const [products, setProducts] = useState<CountedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [step, setStep] = useState<Step>("inicio");
  const [result, setResult] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [search, setSearch] = useState("");

  async function startCount() {
    setLoading(true);
    try {
      const items = await api.listInventoryCount();
      setProducts(items.map((p) => ({ ...p, counted: "" })));
      setStep("contando");
    } catch (e) {
      console.error(e);
      alert("Error al cargar productos");
    } finally {
      setLoading(false);
    }
  }

  function setCount(productId: number, value: string) {
    const n = value === "" ? "" : Math.max(0, parseInt(value, 10) || 0);
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
      alert("No hay diferencias — el stock ya está correcto.");
      return;
    }

    if (!confirm(`¿Aplicar ${adjustments.length} ajuste(s) de stock? Esta acción modifica el inventario.`)) return;

    setApplying(true);
    try {
      const count = await api.applyInventoryCount(adjustments);
      setResult(count);
      setStep("aplicado");
    } catch (e) {
      console.error(e);
      alert("Error al aplicar el conteo");
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
              <button onClick={() => { setStep("inicio"); setProducts([]); }} className="btn btn-secondary text-sm">
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
                        type="number"
                        min={0}
                        className={clsx(
                          "input text-right tabular w-24 text-sm",
                          p.counted !== "" && Number(p.counted) !== p.system_stock && "border-amber-400 bg-amber-50"
                        )}
                        placeholder="—"
                        value={p.counted}
                        onChange={(e) => setCount(p.product_id, e.target.value)}
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
