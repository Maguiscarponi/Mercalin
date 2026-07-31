import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime } from "@/lib/format";
import { useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import type { BulkPriceInput, BulkPricePreviewItem, CatalogImportProgress, CatalogImportResult, CsvProductRow, DeadStockItem, ImportResult, LowStockProduct, MinStockSuggestion, PriceImpactItem, PriceSyncAlert, Product, ProductVelocity, StockMovement, Supplier } from "@/types";
import clsx from "clsx";
import HelpButton from "@/components/HelpModal";

function VelocityBadge({ v }: { v: ProductVelocity | undefined }) {
  if (!v) return null;
  if (v.daily_velocity <= 0.01) {
    return <div className="text-[10px] text-stone-400 mt-0.5">Sin ventas (30d)</div>;
  }
  const days = v.days_remaining;
  const vel = v.daily_velocity;
  const [bg, text] =
    days < 3
      ? ["bg-red-100 text-red-700", true]
      : days < 7
      ? ["bg-amber-100 text-amber-700", false]
      : ["bg-emerald-100 text-emerald-700", false];
  return (
    <div className="mt-0.5 flex flex-col items-end gap-0.5">
      <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", bg)}>
        {days < 1 ? "<1 día" : `~${days.toFixed(days < 10 ? 1 : 0)} días`}
      </span>
      <span className={clsx("text-[9px]", text ? "text-red-500" : "text-stone-400")}>
        {vel.toFixed(vel < 1 ? 2 : 1)} un/día
      </span>
    </div>
  );
}

const PAGE_SIZE = 50;

// ── Tabs ──────────────────────────────────────────────────────────────────────
type ProductTab = "todos" | "alertas" | "sin_movimiento" | "sin_precio" | "stock_ia" | "precio_ia";

function MarginBadge({ price, cost }: { price: number; cost: number }) {
  if (cost <= 0 || price <= 0) return null;
  const pct = ((price - cost) / price) * 100;
  if (pct < 0) return (
    <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
      Precio bajo costo
    </span>
  );
  if (pct < 15) return (
    <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
      Margen bajo {pct.toFixed(0)}%
    </span>
  );
  return null;
}

export default function Productos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [velocities, setVelocities] = useState<Map<number, ProductVelocity>>(new Map());
  const [priceSyncAlerts, setPriceSyncAlerts] = useState<Set<number>>(new Set());
  const [deadStock, setDeadStock] = useState<DeadStockItem[]>([]);
  const [lowStock, setLowStock] = useState<LowStockProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [viewingMovements, setViewingMovements] = useState<Product | null>(null);
  const [tab, setTab] = useState<ProductTab>(
    searchParams.get("tab") === "sin_movimiento" ? "sin_movimiento" : "todos"
  );
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [showOffImport, setShowOffImport] = useState(false);
  const [showBulkPrice, setShowBulkPrice] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [result, low, vel, desync, dead] = await Promise.all([
        api.listProducts(query),
        api.listLowStock(),
        api.listProductVelocities(),
        api.getPriceDesync(),
        api.getDeadStock(30),
      ]);
      setProducts(result);
      setLowStock(low);
      setVelocities(new Map(vel.map((v) => [v.product_id, v])));
      setPriceSyncAlerts(new Set(desync.map((d: PriceSyncAlert) => d.product_id)));
      setDeadStock(dead);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Resetear página al cambiar filtros
  useEffect(() => { setPage(1); }, [query, categoryFilter, tab]);

  async function handleSave(p: Partial<Product>) {
    try {
      if (p.id) {
        await api.updateProduct(p as Product);
      } else {
        await api.createProduct({
          barcode: p.barcode || null,
          name: p.name || "",
          price_cents: p.price_cents || 0,
          price2_cents: p.price2_cents || 0,
          price3_cents: p.price3_cents || 0,
          cost_cents: p.cost_cents || 0,
          stock: p.stock || 0,
          min_stock: p.min_stock || 0,
          category: p.category || null,
          is_weighable: p.is_weighable || false,
          active: true,
          supplier_id: p.supplier_id || null,
          expires_at: p.expires_at || null,
        });
      }
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      alert("Error al guardar");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar este producto?")) return;
    await api.deleteProduct(id);
    load();
  }

  function exportXlsx(rows: Product[]) {
    const data = rows.map((p) => ({
      Código: p.barcode || "",
      Nombre: p.name,
      Costo: (p.cost_cents / 100).toFixed(2),
      "Precio minorista": (p.price_cents / 100).toFixed(2),
      "Precio mayorista": (p.price2_cents / 100).toFixed(2),
      "Precio especial": (p.price3_cents / 100).toFixed(2),
      Stock: p.stock,
      "Stock mínimo": p.min_stock,
      Categoría: p.category || "",
      Vencimiento: p.expires_at || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "productos.xlsx");
    setExportToast(`✓ ${rows.length} productos exportados a Excel`);
    setTimeout(() => setExportToast(null), 3500);
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Productos</h1>
          {lowStock.length > 0 && (
            <button
              onClick={() => setTab(tab === "alertas" ? "todos" : "alertas")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 rounded-md text-xs font-medium hover:bg-red-100 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              {lowStock.length} con stock bajo
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowOffImport(true)}
            className="btn btn-secondary text-sm"
            title="Trae automáticamente miles de productos ya cargados (nombre y código de barras) para no tener que tipearlos uno por uno"
          >
            🌐 Cargar productos automáticamente
          </button>
          <button onClick={() => setShowImport(true)} className="btn btn-secondary text-sm">
            📥 Importar CSV/Excel
          </button>
          <button onClick={() => exportXlsx(products)} className="btn btn-secondary text-sm">
            📤 Exportar Excel
          </button>
          <button onClick={() => setShowBulkPrice(true)} className="btn btn-secondary text-sm">
            💲 Actualizar precios
          </button>
          <button onClick={() => setEditing({})} className="btn btn-primary">
            Nuevo producto
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        {([
          { id: "todos", label: "Todos" },
          { id: "alertas", label: `Alertas (${lowStock.length})` },
          { id: "sin_movimiento", label: `Sin movimiento (${deadStock.length})` },
          { id: "sin_precio", label: `Sin precio (${products.filter((p) => p.price_cents <= 0).length})` },
          { id: "stock_ia", label: "Stock mín. IA" },
          { id: "precio_ia", label: "Impacto de precio" },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id as ProductTab);
              if (id !== "todos") setQuery("");
              setSearchParams(id === "sin_movimiento" ? { tab: "sin_movimiento" } : {});
            }}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "todos" || tab === "sin_precio") && (
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            placeholder="Buscar por nombre o código de barras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="input w-48 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {[...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {tab === "alertas" ? (
        <div className="card flex-1 overflow-y-auto">
          {lowStock.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">
              No hay productos con stock bajo
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">Mínimo</th>
                  <th className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-stone-500 bg-stone-50 sticky top-0">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100 hover:bg-red-50 transition-colors">
                    <td className="table-cell font-semibold">{p.name}</td>
                    <td className="table-cell text-stone-500">{p.category || "—"}</td>
                    <td className="table-cell text-right tabular text-red-600 font-bold text-base">{p.stock}</td>
                    <td className="table-cell text-right tabular text-stone-500">{p.min_stock}</td>
                    <td className="table-cell text-right">
                      <button
                        onClick={() => {
                          const full = products.find((pr) => pr.id === p.id);
                          if (full) setAdjusting(full);
                        }}
                        className="btn-table-success"
                      >
                        Ajustar stock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === "todos" ? (() => {
          const filtered = products.filter((p) => !categoryFilter || p.category === categoryFilter);
          const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
          const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          return (
            <div className="card flex-1 overflow-hidden flex flex-col">
              <div className="overflow-y-auto flex-1">
                <table className="w-full">
                  <thead>
                    <tr className="table-header">
                      <th>Código</th>
                      <th>Nombre</th>
                      <th className="text-right">Costo</th>
                      <th className="text-right">Precio / Margen</th>
                      <th className="text-right">Stock / Velocidad</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-stone-500 bg-stone-50 sticky top-0">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-stone-400">Cargando…</td>
                      </tr>
                    )}
                    {!loading && paginated.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10">
                          {products.length === 0 ? (
                            <div className="flex flex-col items-center gap-3">
                              <p className="text-stone-500">Todavía no cargaste ningún producto.</p>
                              <p className="text-sm text-stone-400 max-w-sm">
                                No hace falta tipear todo a mano: podés traer miles de productos argentinos
                                ya cargados (nombre y código de barras) de una sola vez.
                              </p>
                              <div className="flex gap-2 mt-1">
                                <button onClick={() => setShowOffImport(true)} className="btn btn-primary text-sm">
                                  🌐 Cargar productos automáticamente
                                </button>
                                <button onClick={() => setEditing({})} className="btn btn-secondary text-sm">
                                  Cargar uno a mano
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-stone-400">Sin resultados.</span>
                          )}
                        </td>
                      </tr>
                    )}
                    {paginated.map((p) => (
                      <tr key={p.id} className="table-row">
                        <td className="table-cell font-mono text-sm text-stone-500">{p.barcode || "—"}</td>
                        <td className="table-cell">
                          <div className="font-semibold text-stone-900">{p.name}</div>
                          {p.category && <div className="text-xs text-stone-400 uppercase tracking-wide mt-0.5">{p.category}</div>}
                        </td>
                        <td className="table-cell text-right tabular">{centsToARS(p.cost_cents)}</td>
                        <td className="table-cell text-right tabular">
                          <div className="font-semibold">{centsToARS(p.price_cents)}</div>
                          {p.cost_cents > 0 && p.price_cents > 0 && (() => {
                            const pct = Math.round((p.price_cents - p.cost_cents) / p.price_cents * 100);
                            return (
                              <div className={clsx(
                                "text-xs font-normal mt-0.5",
                                pct < 0 ? "text-red-600" : pct < 15 ? "text-amber-600" : pct >= 30 ? "text-emerald-600" : "text-amber-600"
                              )}>
                                {pct}% margen
                              </div>
                            );
                          })()}
                          <div className="mt-0.5 flex flex-col items-end gap-0.5">
                            <MarginBadge price={p.price_cents} cost={p.cost_cents} />
                            {priceSyncAlerts.has(p.id) && (
                              <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">
                                💰 Costo ↑ revisar
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell text-right tabular">
                          <span className={clsx("font-semibold text-base", p.stock <= p.min_stock ? "text-red-600" : "text-stone-800")}>
                            {p.stock}
                            {p.stock <= p.min_stock && <span className="ml-1 text-sm">⚠</span>}
                          </span>
                          <VelocityBadge v={velocities.get(p.id)} />
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setAdjusting(p)} className="btn-table-neutral">Stock</button>
                            <button onClick={() => setViewingMovements(p)} className="btn-table-neutral">Historial</button>
                            <button onClick={() => setEditing(p)} className="btn-table-success">Editar</button>
                            <button onClick={() => handleDelete(p.id)} className="btn-table-danger">Borrar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="border-t border-stone-200 px-4 py-2.5 flex items-center justify-between bg-stone-50 shrink-0">
                  <span className="text-sm text-stone-500">
                    {filtered.length} productos · página {page} de {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="btn-table-neutral disabled:opacity-40 disabled:cursor-default"
                    >«</button>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="btn-table-neutral disabled:opacity-40 disabled:cursor-default"
                    >‹ Anterior</button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="btn-table-neutral disabled:opacity-40 disabled:cursor-default"
                    >Siguiente ›</button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="btn-table-neutral disabled:opacity-40 disabled:cursor-default"
                    >»</button>
                  </div>
                </div>
              )}
            </div>
          );
        })() : tab === "sin_precio" ? (() => {
          const q = query.trim().toLowerCase();
          const filtered = products
            .filter((p) => p.price_cents <= 0)
            .filter((p) => !categoryFilter || p.category === categoryFilter)
            .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.barcode || "").includes(q));
          const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
          const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          return (
            <div className="card flex-1 overflow-hidden flex flex-col">
              {filtered.length > 0 && (
                <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 text-sm text-indigo-800 shrink-0">
                  Completá el precio de venta para poder vender estos productos en Caja.
                </div>
              )}
              <div className="overflow-y-auto flex-1">
                <table className="w-full">
                  <thead>
                    <tr className="table-header">
                      <th>Código</th>
                      <th>Nombre</th>
                      <th className="text-right">Costo</th>
                      <th className="text-right">Precio de venta</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-stone-500 bg-stone-50 sticky top-0">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-stone-400">
                          {products.length === 0 ? "No hay productos cargados todavía." : "Todos los productos tienen precio cargado."}
                        </td>
                      </tr>
                    )}
                    {paginated.map((p) => (
                      <tr key={p.id} className="table-row">
                        <td className="table-cell font-mono text-sm text-stone-500">{p.barcode || "—"}</td>
                        <td className="table-cell">
                          <div className="font-semibold text-stone-900">{p.name}</div>
                          {p.category && <div className="text-xs text-stone-400 uppercase tracking-wide mt-0.5">{p.category}</div>}
                        </td>
                        <td className="table-cell text-right tabular">{centsToARS(p.cost_cents)}</td>
                        <td className="table-cell text-right">
                          <QuickPriceInput
                            product={p}
                            onSaved={(updated) => setProducts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                          />
                        </td>
                        <td className="table-cell text-right">
                          <button onClick={() => setEditing(p)} className="btn-table-neutral">Editar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="border-t border-stone-200 px-4 py-2.5 flex items-center justify-between bg-stone-50 shrink-0">
                  <span className="text-sm text-stone-500">{filtered.length} productos · página {page} de {totalPages}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-table-neutral disabled:opacity-40 disabled:cursor-default">‹ Anterior</button>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-table-neutral disabled:opacity-40 disabled:cursor-default">Siguiente ›</button>
                  </div>
                </div>
              )}
            </div>
          );
        })() : null
      }

      {/* ── Tab: Sin movimiento ─────────────────────────────────────────── */}
      {tab === "sin_movimiento" && (
        <div className="card flex-1 overflow-y-auto">
          {deadStock.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">
              Todos los productos tuvieron al menos una venta en los últimos 30 días
            </div>
          ) : (
            <>
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
                <span className="text-sm text-amber-800 font-medium">
                  {deadStock.length} productos sin ventas en 30 días ·{" "}
                  {centsToARS(deadStock.reduce((s, d) => s + d.capital_cents, 0))} inmovilizados
                </span>
                <span className="text-xs text-amber-600">
                  Considerá ofertas o liquidación para recuperar ese capital
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="table-header">
                    <th className="text-left">Producto</th>
                    <th className="text-left">Categoría</th>
                    <th className="text-right">Stock</th>
                    <th className="text-right">Costo unit.</th>
                    <th className="text-right">Capital inmovilizado</th>
                    <th className="text-right">Días sin ventas</th>
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-stone-500 bg-stone-50 sticky top-0">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {deadStock.map((d) => (
                    <tr key={d.product_id} className="table-row">
                      <td className="table-cell font-semibold">{d.name}</td>
                      <td className="table-cell text-stone-500">{d.category || "—"}</td>
                      <td className="table-cell text-right tabular">{d.stock}</td>
                      <td className="table-cell text-right tabular text-stone-500">{centsToARS(d.cost_cents)}</td>
                      <td className="table-cell text-right tabular font-semibold text-amber-700">
                        {centsToARS(d.capital_cents)}
                      </td>
                      <td className="table-cell text-right tabular">
                        <span className="text-sm font-bold text-stone-600">{d.days_without_sales}d</span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => {
                            const full = products.find(p => p.id === d.product_id);
                            if (full) setEditing(full);
                          }}
                          className="btn-table-neutral"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Stock mín. IA ─────────────────────────────────────────── */}
      {tab === "stock_ia" && (
        <StockIaTab onProductsReload={load} />
      )}

      {/* ── Tab: Impacto de precio ─────────────────────────────────────── */}
      {tab === "precio_ia" && (
        <PrecioIaTab onProductsReload={load} />
      )}

      {editing && (
        <ProductForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {adjusting && (
        <StockAdjustForm
          product={adjusting}
          onCancel={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            load();
          }}
        />
      )}

      {viewingMovements && (
        <StockMovementsModal
          product={viewingMovements}
          onClose={() => setViewingMovements(null)}
        />
      )}

      {showOffImport && (
        <OffImportModal
          onClose={() => setShowOffImport(false)}
          onImported={load}
        />
      )}

      {showImport && (
        <ImportCsvModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}

      {showBulkPrice && (
        <BulkPriceModal
          onClose={() => setShowBulkPrice(false)}
          onSaved={() => { setShowBulkPrice(false); load(); }}
        />
      )}

      {exportToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-emerald-700 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in">
          {exportToast}
        </div>
      )}

      <HelpButton module="productos" />
    </div>
  );
}

// ── StockIaTab ────────────────────────────────────────────────────────────────
function StockIaTab({ onProductsReload }: { onProductsReload: () => void }) {
  const [suggestions, setSuggestions] = useState<MinStockSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getMinStockSuggestions()
      .then((data) => { setSuggestions(data); setSelected(new Set()); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(suggestions.map((s) => s.product_id)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleApply() {
    const toApply = suggestions.filter((s) => selected.has(s.product_id));
    if (toApply.length === 0) return;
    setApplying(true);
    try {
      const count = await api.applyMinStockSuggestions(toApply);
      setAppliedCount(count);
      onProductsReload();
      // Refresh suggestions
      const fresh = await api.getMinStockSuggestions();
      setSuggestions(fresh);
      setSelected(new Set());
    } catch (err) {
      console.error(err);
      alert("Error al aplicar sugerencias");
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="card flex-1 flex items-center justify-center text-stone-400 text-sm">
        Cargando sugerencias…
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="card flex-1 flex items-center justify-center">
        <p className="text-stone-400 text-sm">Todos los stocks mínimos están correctamente calibrados ✓</p>
      </div>
    );
  }

  return (
    <div className="card flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-3 shrink-0">
        <span className="text-sm text-indigo-800">
          Sugerencias calculadas automáticamente: velocidad de venta × lead time del proveedor × 1.3
        </span>
        {appliedCount !== null && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
            ✓ {appliedCount} stocks actualizados
          </span>
        )}
        <button
          onClick={handleApply}
          disabled={selected.size === 0 || applying}
          className="btn btn-primary text-sm shrink-0 disabled:opacity-40"
        >
          {applying ? "Aplicando…" : `Aplicar seleccionados (${selected.size})`}
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2.5 text-left">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-indigo-600"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th className="text-left">Producto</th>
              <th className="text-left">Categoría</th>
              <th className="text-right">Actual</th>
              <th className="text-right">Sugerido</th>
              <th className="text-right">Velocidad</th>
              <th className="text-right">Lead time</th>
              <th className="text-left">Proveedor</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s) => {
              const isIncrease = s.suggested_min_stock > s.current_min_stock;
              const isDecrease = s.suggested_min_stock < s.current_min_stock;
              const diffClass = isIncrease
                ? "text-amber-700 font-semibold"
                : isDecrease
                ? "text-blue-700 font-semibold"
                : "text-stone-700";
              const badgeClass = isIncrease
                ? "bg-amber-100 text-amber-700"
                : isDecrease
                ? "bg-blue-100 text-blue-700"
                : "bg-stone-100 text-stone-600";
              return (
                <tr
                  key={s.product_id}
                  className={clsx("table-row cursor-pointer", selected.has(s.product_id) && "bg-indigo-50/50")}
                  onClick={() => toggleOne(s.product_id)}
                >
                  <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-indigo-600"
                      checked={selected.has(s.product_id)}
                      onChange={() => toggleOne(s.product_id)}
                    />
                  </td>
                  <td className="table-cell font-semibold">{s.name}</td>
                  <td className="table-cell text-stone-500 text-sm">{s.category || "—"}</td>
                  <td className="table-cell text-right tabular">{s.current_min_stock}</td>
                  <td className="table-cell text-right">
                    <span className={clsx("text-sm px-2 py-0.5 rounded-full", badgeClass, diffClass)}>
                      {s.suggested_min_stock}
                      {isIncrease && <span className="ml-1 text-xs">↑</span>}
                      {isDecrease && <span className="ml-1 text-xs">↓</span>}
                    </span>
                  </td>
                  <td className="table-cell text-right tabular text-stone-500 text-sm">
                    {s.daily_velocity.toFixed(s.daily_velocity < 1 ? 2 : 1)} un/día
                  </td>
                  <td className="table-cell text-right tabular text-stone-500 text-sm">
                    {s.lead_time_days} días
                  </td>
                  <td className="table-cell text-stone-500 text-sm">{s.supplier_name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PrecioIaTab ───────────────────────────────────────────────────────────────
function PrecioIaTab({ onProductsReload }: { onProductsReload: () => void }) {
  const [items, setItems] = useState<PriceImpactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [updatedIds, setUpdatedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.getPriceImpactProjections()
      .then((data) => {
        const sorted = [...data].sort((a, b) => b.monthly_gain_cents - a.monthly_gain_cents);
        setItems(sorted);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleUpdatePrice(item: PriceImpactItem) {
    setUpdatingId(item.product_id);
    try {
      const product = await api.getProduct(item.product_id);
      await api.updateProduct({ ...product, price_cents: item.suggested_price_cents });
      setUpdatedIds((prev) => new Set([...prev, item.product_id]));
      onProductsReload();
    } catch (err) {
      console.error(err);
      alert("Error al actualizar el precio");
    } finally {
      setUpdatingId(null);
    }
  }

  const totalGainCents = items.reduce((sum, i) => sum + i.monthly_gain_cents, 0);

  if (loading) {
    return (
      <div className="card flex-1 flex items-center justify-center text-stone-400 text-sm">
        Cargando proyecciones…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card flex-1 flex items-center justify-center">
        <p className="text-stone-400 text-sm">Todos los productos tienen margen suficiente ✓</p>
      </div>
    );
  }

  return (
    <div className="card flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-4 shrink-0">
        <span className="text-sm text-emerald-800">
          Oportunidades de mejora de margen detectadas por el sistema. Ajustá precios para maximizar la rentabilidad.
        </span>
        <div className="ml-auto shrink-0 text-right">
          <div className="text-xs text-emerald-600 uppercase font-medium tracking-wide">Ganancia potencial/mes</div>
          <div className="text-lg font-bold text-emerald-700 tabular">{centsToARS(totalGainCents)}</div>
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="text-left">Producto</th>
              <th className="text-left">Categoría</th>
              <th className="text-right">Precio actual</th>
              <th className="text-right">Costo</th>
              <th className="text-right">Margen actual</th>
              <th className="text-right">Precio sugerido</th>
              <th className="text-right">Ganancia extra/mes</th>
              <th className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-stone-500 bg-stone-50 sticky top-0">Acción</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const marginClass =
                item.current_margin_pct < 5
                  ? "text-red-600 font-semibold"
                  : item.current_margin_pct < item.min_margin_pct
                  ? "text-amber-600 font-semibold"
                  : "text-stone-700";
              const isUpdating = updatingId === item.product_id;
              const isDone = updatedIds.has(item.product_id);
              return (
                <tr key={item.product_id} className={clsx("table-row", isDone && "opacity-50")}>
                  <td className="table-cell font-semibold">{item.name}</td>
                  <td className="table-cell text-stone-500 text-sm">{item.category || "—"}</td>
                  <td className="table-cell text-right tabular">{centsToARS(item.current_price_cents)}</td>
                  <td className="table-cell text-right tabular text-stone-500">{centsToARS(item.cost_cents)}</td>
                  <td className="table-cell text-right tabular">
                    <span className={marginClass}>{item.current_margin_pct.toFixed(1)}%</span>
                  </td>
                  <td className="table-cell text-right tabular font-semibold text-indigo-700">
                    {centsToARS(item.suggested_price_cents)}
                  </td>
                  <td className="table-cell text-right tabular font-semibold text-emerald-700">
                    +{centsToARS(item.monthly_gain_cents)}
                  </td>
                  <td className="table-cell text-right">
                    {isDone ? (
                      <span className="text-xs text-emerald-600 font-medium">✓ Actualizado</span>
                    ) : (
                      <button
                        onClick={() => handleUpdatePrice(item)}
                        disabled={isUpdating}
                        className="btn-table-success disabled:opacity-40"
                      >
                        {isUpdating ? "…" : "Actualizar precio"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockAdjustForm({
  product,
  onCancel,
  onSaved,
}: {
  product: Product;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [newStock, setNewStock] = useState(product.stock.toString());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const isWeighable = product.is_weighable;
  const unitLabel = isWeighable ? "kg" : "unidades";
  const parseVal = (s: string) => (isWeighable ? parseFloat(s) : parseInt(s, 10));

  const diff = parseVal(newStock) - product.stock;

  async function submit() {
    const val = parseVal(newStock);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    try {
      await api.adjustStock({
        product_id: product.id,
        new_stock: val,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      console.error(e);
      alert("Error al ajustar stock");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[380px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-1">Ajustar stock</h2>
        <p className="text-sm text-stone-500 mb-4">{product.name}</p>

        <div className="bg-stone-50 rounded-md p-3 mb-4 text-sm flex justify-between">
          <span className="text-stone-600">Stock actual</span>
          <span className="font-semibold tabular">{product.stock} {unitLabel}</span>
        </div>

        <label className="block mb-3">
          <span className="text-xs font-medium text-stone-600 block mb-1">Nuevo stock</span>
          <input
            autoFocus
            type="number"
            min={0}
            step={isWeighable ? "0.001" : "1"}
            className="input tabular text-right h-12 text-lg"
            value={newStock}
            onChange={(e) => setNewStock(e.target.value)}
          />
        </label>

        {newStock && !isNaN(parseVal(newStock)) && parseVal(newStock) !== product.stock && (
          <div className={clsx(
            "text-sm text-center py-2 rounded-md mb-4 font-medium",
            diff > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          )}>
            {diff > 0 ? `+${diff}` : diff} {unitLabel}
          </div>
        )}

        <label className="block mb-5">
          <span className="text-xs font-medium text-stone-600 block mb-1">Motivo (opcional)</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Ingreso de mercadería, corrección..."
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary flex-1">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockMovementsModal({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listStockMovements(product.id).then((m) => {
      setMovements(m);
      setLoading(false);
    }).catch(console.error);
  }, [product.id]);

  const typeLabel: Record<string, string> = {
    ajuste: "Ajuste",
    ingreso: "Ingreso",
    venta: "Venta",
    compra: "Compra",
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[540px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h2 className="font-semibold">Historial de stock</h2>
          <p className="text-sm text-stone-500 mt-0.5">{product.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-stone-400 text-sm text-center py-4">Cargando…</p>
          ) : movements.length === 0 ? (
            <p className="text-stone-400 text-sm text-center py-4">Sin movimientos registrados</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left py-2">Tipo</th>
                  <th className="text-right py-2">Cambio</th>
                  <th className="text-right py-2">Antes</th>
                  <th className="text-right py-2">Después</th>
                  <th className="text-left py-2 pl-4">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-stone-100">
                    <td className="py-2">
                      <span className={clsx(
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        m.movement_type === "venta" && "bg-stone-100 text-stone-600",
                        m.movement_type === "ajuste" && "bg-blue-50 text-blue-700",
                        m.movement_type === "ingreso" && "bg-emerald-50 text-emerald-700",
                      )}>
                        {typeLabel[m.movement_type]}
                      </span>
                    </td>
                    <td className={clsx(
                      "py-2 text-right tabular font-medium",
                      m.qty_change > 0 ? "text-emerald-700" : "text-red-600"
                    )}>
                      {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                    </td>
                    <td className="py-2 text-right tabular text-stone-500">{m.qty_before}</td>
                    <td className="py-2 text-right tabular font-medium">{m.qty_after}</td>
                    <td className="py-2 pl-4 text-xs text-stone-400">{formatDateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-stone-200">
          <button onClick={onClose} className="btn btn-secondary w-full">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ProductForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: Partial<Product>;
  onCancel: () => void;
  onSave: (p: Partial<Product>) => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(initial);
  const [priceStr, setPriceStr] = useState(
    initial.price_cents ? (initial.price_cents / 100).toString() : ""
  );
  const [price2Str, setPrice2Str] = useState(
    initial.price2_cents ? (initial.price2_cents / 100).toString() : ""
  );
  const [price3Str, setPrice3Str] = useState(
    initial.price3_cents ? (initial.price3_cents / 100).toString() : ""
  );
  const [costStr, setCostStr] = useState(
    initial.cost_cents ? (initial.cost_cents / 100).toString() : ""
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    api.listSuppliers().then(setSuppliers).catch(console.error);
    api.listCategories().then((cats) => setCategories(cats.map((c) => c.name).filter(Boolean))).catch(console.error);
  }, []);

  function submit() {
    onSave({
      ...form,
      price_cents: arsStringToCents(priceStr),
      price2_cents: arsStringToCents(price2Str),
      price3_cents: arsStringToCents(price3Str),
      cost_cents: arsStringToCents(costStr),
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[480px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-4 border-b border-stone-200">
          <h2 className="text-lg font-semibold">
            {form.id ? "Editar producto" : "Nuevo producto"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-3">
          <Field label="Código de barras">
            <input
              autoFocus
              className="input font-mono"
              value={form.barcode || ""}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="7790070123456"
            />
          </Field>

          <Field label="Nombre">
            <input
              className="input"
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Coca Cola 500ml"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Costo ($)">
              <input
                className="input tabular text-right"
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
                placeholder="1000"
              />
            </Field>
            <Field label="Precio minorista ($)">
              <input
                className="input tabular text-right"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                placeholder="1500"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Precio mayorista ($)">
              <input
                className="input tabular text-right"
                value={price2Str}
                onChange={(e) => setPrice2Str(e.target.value)}
                placeholder="0 = no aplica"
              />
            </Field>
            <Field label="Precio especial ($)">
              <input
                className="input tabular text-right"
                value={price3Str}
                onChange={(e) => setPrice3Str(e.target.value)}
                placeholder="0 = no aplica"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={form.is_weighable ? "Stock actual (kg)" : "Stock actual"}>
              <input
                type="number"
                step={form.is_weighable ? "0.001" : "1"}
                className="input tabular text-right"
                value={form.stock ?? 0}
                onChange={(e) =>
                  setForm({ ...form, stock: (form.is_weighable ? parseFloat(e.target.value) : parseInt(e.target.value)) || 0 })
                }
              />
            </Field>
            <Field label={form.is_weighable ? "Stock mínimo (kg)" : "Stock mínimo"}>
              <input
                type="number"
                step={form.is_weighable ? "0.001" : "1"}
                className="input tabular text-right"
                value={form.min_stock ?? 0}
                onChange={(e) =>
                  setForm({ ...form, min_stock: (form.is_weighable ? parseFloat(e.target.value) : parseInt(e.target.value)) || 0 })
                }
              />
            </Field>
          </div>

          <Field label="Categoría">
            <input
              className="input"
              list="product-category-options"
              value={form.category || ""}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Bebidas, golosinas, almacén…"
            />
            <datalist id="product-category-options">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>

          <Field label="Fecha de vencimiento (opcional)">
            <input
              type="date"
              className="input"
              value={form.expires_at ? form.expires_at.slice(0, 10) : ""}
              onChange={(e) =>
                setForm({ ...form, expires_at: e.target.value || null })
              }
            />
          </Field>

          {suppliers.length > 0 && (
            <Field label="Proveedor (opcional)">
              <select
                className="input"
                value={form.supplier_id ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    supplier_id: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
              >
                <option value="">— Sin proveedor —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-600"
              checked={form.is_weighable || false}
              onChange={(e) => setForm({ ...form, is_weighable: e.target.checked })}
            />
            <span className="text-sm text-stone-700">Se vende por peso (producto pesable)</span>
          </label>
        </div>

        <div className="p-6 pt-4 border-t border-stone-200 flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">
            Cancelar
          </button>
          <button onClick={submit} className="btn btn-primary flex-1">
            Guardar
          </button>
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

function QuickPriceInput({ product, onSaved }: { product: Product; onSaved: (p: Product) => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const cents = arsStringToCents(value);

  async function save() {
    if (cents <= 0 || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateProduct({ ...product, price_cents: cents });
      onSaved(updated);
    } catch (e) {
      console.error(e);
      alert("Error al guardar el precio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <input
        className="input tabular text-right w-24 h-8 text-sm"
        placeholder="$0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        inputMode="numeric"
      />
      <button
        onClick={save}
        disabled={saving || cents <= 0}
        className="btn-table-success disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? "…" : "Guardar"}
      </button>
    </div>
  );
}

function OffImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CatalogImportProgress | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<CatalogImportProgress>("catalog_import_progress", (e) => setProgress(e.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  async function start() {
    setRunning(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const res = await api.importOffCatalog();
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (e) {
      console.error(e);
      // El backend ya reintenta la primera página sola antes de rendirse, así que si llegamos
      // acá conviene mostrar el motivo real en vez de asumir que es la conexión del usuario.
      const detail = typeof e === "string" ? e : (e as { message?: string } | undefined)?.message;
      setErrorMsg(detail ? `No se pudo completar la importación: ${detail}` : "No se pudo completar la importación. Probá de nuevo en unos segundos.");
    } finally {
      setRunning(false);
    }
  }

  async function cancel() {
    try { await api.cancelOffCatalogImport(); } catch (e) { console.error(e); }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => { if (!running) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-1">Importar catálogo público</h2>

        {!running && !result && (
          <>
            <p className="text-sm text-stone-500 mb-4 leading-relaxed">
              Agrega productos nuevos (nombre y código de barras) desde una base pública de productos
              argentinos — no toca ni pisa ningún producto que ya tengas cargado. Los productos nuevos
              entran sin precio ni stock; los vas completando desde la pestaña "Sin precio" o al venderlos
              por primera vez en Caja. Necesita conexión a internet y puede tardar uno o dos minutos.
            </p>
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2 mb-4">
                {errorMsg}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={start} className="btn btn-primary flex-1">Iniciar importación</button>
            </div>
          </>
        )}

        {running && (
          <>
            <div className="bg-stone-50 rounded-md p-4 mb-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-stone-500">Página</span>
                <span className="tabular font-medium">
                  {progress ? `${progress.page} / ${progress.total_pages}` : "iniciando…"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Productos nuevos encontrados</span>
                <span className="tabular font-semibold text-emerald-700">{progress?.imported ?? 0}</span>
              </div>
              <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: `${progress ? Math.min(100, (progress.page / Math.max(1, progress.total_pages)) * 100) : 3}%` }}
                />
              </div>
            </div>
            <button onClick={cancel} className="btn btn-secondary w-full">Cancelar importación</button>
          </>
        )}

        {result && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-4 text-sm text-emerald-800">
              {result.cancelled ? "Importación cancelada. " : ""}
              Se agregaron <strong>{result.imported}</strong> productos nuevos.
              {result.skipped_existing > 0 ? ` ${result.skipped_existing} ya estaban en tu catálogo (no se tocaron).` : ""}
              {result.failed_pages > 0 ? ` ${result.failed_pages} páginas no se pudieron consultar — podés repetir la importación más tarde, no duplica nada.` : ""}
            </div>
            <button onClick={onClose} className="btn btn-primary w-full">Cerrar</button>
          </>
        )}
      </div>
    </div>
  );
}

function ImportCsvModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState<CsvProductRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function parseCsvText(text: string): CsvProductRow[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error("El CSV debe tener al menos una fila de encabezado y una fila de datos.");
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

    const idx = (candidates: string[]) => {
      for (const c of candidates) { const i = headers.indexOf(c); if (i >= 0) return i; }
      return -1;
    };
    const iName      = idx(["nombre", "name"]);
    const iPrice     = idx(["precio", "price"]);
    const iCost      = idx(["costo", "cost"]);
    const iStock     = idx(["stock"]);
    const iMinStock  = idx(["stock_minimo", "min_stock"]);
    const iBarcode   = idx(["codigo_barras", "barcode", "codigo"]);
    const iCategory  = idx(["categoria", "category"]);
    const iSupplierId = idx(["proveedor_id", "supplier_id"]);
    const iExpiresAt = idx(["vencimiento", "expires_at"]);

    if (iName < 0) throw new Error("Columna 'nombre' no encontrada. Es requerida.");

    return lines.slice(1).map((line) => {
      const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      const name = iName >= 0 ? (cols[iName] ?? "").trim() : "";
      if (!name) return null;
      const rawPrice = iPrice >= 0 ? cols[iPrice] ?? "" : "";
      const rawCost  = iCost  >= 0 ? cols[iCost]  ?? "" : "";
      const rawStock = iStock >= 0 ? cols[iStock]  ?? "" : "";
      const rawMin   = iMinStock >= 0 ? cols[iMinStock] ?? "" : "";
      const rawSupId = iSupplierId >= 0 ? cols[iSupplierId] ?? "" : "";
      const rawExp   = iExpiresAt >= 0 ? cols[iExpiresAt] ?? "" : "";
      const barcode  = iBarcode >= 0 ? (cols[iBarcode] ?? "").trim() || null : null;
      const category = iCategory >= 0 ? (cols[iCategory] ?? "").trim() || null : null;
      return {
        name,
        barcode,
        price_cents: Math.round((parseFloat(rawPrice.replace(",", ".")) || 0) * 100),
        cost_cents:  Math.round((parseFloat(rawCost.replace(",", "."))  || 0) * 100),
        stock:       parseInt(rawStock) || 0,
        min_stock:   parseInt(rawMin) || 0,
        category,
        supplier_id: rawSupId ? (parseInt(rawSupId) || null) : null,
        expires_at:  rawExp ? rawExp : null,
      } satisfies CsvProductRow;
    }).filter((r): r is CsvProductRow => r !== null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const text = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
        setCsvText(text);
        setParsedRows(null);
        setParseError(null);
        setResult(null);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCsvText(text);
        setParsedRows(null);
        setParseError(null);
        setResult(null);
      };
      reader.readAsText(file, "utf-8");
    }
  }

  function handleParse() {
    setParseError(null);
    setParsedRows(null);
    try {
      const rows = parseCsvText(csvText);
      if (rows.length === 0) { setParseError("No se encontraron filas válidas. Verificá que el archivo tenga datos y la columna 'nombre'."); return; }
      setParsedRows(rows);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Error al parsear el CSV.");
    }
  }

  async function doImport() {
    if (!parsedRows || parsedRows.length === 0) return;
    setImporting(true);
    try {
      const res = await api.importProductsCsv(parsedRows);
      setResult(res);
    } catch (err) {
      console.error(err);
      setParseError("Error al importar. Revisá la consola para más detalles.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[700px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold text-lg">Importar productos desde CSV</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Instrucciones */}
          <div className="bg-stone-50 border border-stone-200 rounded-md p-3 text-xs text-stone-600 space-y-1.5">
            <p className="font-semibold text-stone-700">Columnas reconocidas (la primera fila debe ser el encabezado):</p>
            <p className="font-mono bg-white border border-stone-200 rounded px-2 py-1.5 leading-relaxed">
              nombre (requerido), precio, costo, stock, codigo_barras, categoria, stock_minimo, proveedor_id, vencimiento
            </p>
            <p>Separadores soportados: coma (,) o punto y coma (;). También podés subir un archivo Excel (.xlsx/.xls).</p>
          </div>

          {/* Selector de archivo */}
          <div className="flex items-center gap-3">
            <label className="btn btn-secondary cursor-pointer">
              Seleccionar archivo CSV / Excel
              <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
            <span className="text-xs text-stone-400">o pegá el CSV abajo</span>
          </div>

          {/* Textarea */}
          <div>
            <label className="text-xs font-medium text-stone-600 block mb-1">Contenido CSV</label>
            <textarea
              className="input w-full font-mono text-xs"
              rows={8}
              placeholder={"nombre;precio;costo;stock\nCoca Cola 500ml;1500;900;24\nAgua mineral 1.5L;800;450;36"}
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setParsedRows(null); setResult(null); setParseError(null); }}
            />
          </div>

          {/* Errores de parseo */}
          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              {parseError}
            </div>
          )}

          {/* Previsualización */}
          {parsedRows && (
            <div>
              <p className="text-sm text-stone-700 font-medium mb-2">
                {parsedRows.length} filas detectadas — Primeras 5:
              </p>
              <div className="overflow-x-auto rounded border border-stone-200">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-stone-500 uppercase">
                    <tr>
                      {["Nombre", "Precio", "Costo", "Stock", "Categoría", "Código"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5 tabular">{centsToARS(r.price_cents)}</td>
                        <td className="px-2 py-1.5 tabular">{centsToARS(r.cost_cents)}</td>
                        <td className="px-2 py-1.5 tabular">{r.stock}</td>
                        <td className="px-2 py-1.5">{r.category || "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{r.barcode || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Resultado de importación */}
          {result && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-1 text-sm">
              <p className="font-semibold text-emerald-800">Importación completada</p>
              <p className="text-emerald-700">Creados: <strong>{result.created}</strong> · Actualizados: <strong>{result.updated}</strong> · Omitidos: <strong>{result.skipped}</strong></p>
              {result.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-700 space-y-0.5">
                  <p className="font-medium">Errores ({result.errors.length}):</p>
                  {result.errors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
                  {result.errors.length > 5 && <p>…y {result.errors.length - 5} más</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">
            {result ? "Cerrar" : "Cancelar"}
          </button>
          {!result && !parsedRows && (
            <button
              onClick={handleParse}
              disabled={!csvText.trim()}
              className="btn btn-secondary flex-1 disabled:opacity-40"
            >
              Parsear y previsualizar
            </button>
          )}
          {!result && parsedRows && (
            <button
              onClick={doImport}
              disabled={importing}
              className="btn btn-primary flex-1 disabled:opacity-40"
            >
              {importing ? "Importando…" : `Importar ${parsedRows.length} productos`}
            </button>
          )}
          {result && (
            <button onClick={onImported} className="btn btn-primary flex-1">
              Listo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BulkPriceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  // Filter state
  const [filterType, setFilterType] = useState<BulkPriceInput["filter_type"]>("all");
  const [filterValue, setFilterValue] = useState("");
  // Price % increase
  const [pricePct, setPricePct] = useState("");
  // Cost update
  const [updateCost, setUpdateCost] = useState(false);
  const [costPct, setCostPct] = useState("");
  // Preview / apply state
  const [previewItems, setPreviewItems] = useState<BulkPricePreviewItem[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildInput(): BulkPriceInput {
    return {
      filter_type: filterType,
      filter_value: filterType === "all" ? null : filterValue.trim() || null,
      price_pct: parseFloat(pricePct.replace(",", ".")) || 0,
      cost_pct: updateCost ? (parseFloat(costPct.replace(",", ".")) || null) : null,
    };
  }

  async function handlePreview() {
    const pct = parseFloat(pricePct.replace(",", "."));
    if (isNaN(pct) || pct === 0) { setError("Ingresá un porcentaje de aumento válido (ej: 15 para +15%)."); return; }
    setError(null);
    setLoadingPreview(true);
    setPreviewItems(null);
    try {
      const items = await api.previewBulkUpdatePrices(buildInput());
      setPreviewItems(items);
    } catch (err) {
      console.error(err);
      setError("Error al generar la vista previa.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    setError(null);
    try {
      const count = await api.applyBulkUpdatePrices(buildInput());
      setAppliedCount(count);
    } catch (err) {
      console.error(err);
      setError("Error al aplicar los precios. Intentá nuevamente.");
    } finally {
      setApplying(false);
    }
  }

  // Reset preview when filter/pct changes
  function resetPreview() { setPreviewItems(null); setAppliedCount(null); setError(null); }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[720px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold text-lg">Actualización masiva de precios</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          {/* Filtro */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Aplicar a</label>
              <select
                className="input w-full"
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value as BulkPriceInput["filter_type"]); setFilterValue(""); resetPreview(); }}
              >
                <option value="all">Todos los productos</option>
                <option value="category">Por rubro (categoría)</option>
                <option value="supplier">Por proveedor (ID)</option>
              </select>
            </div>

            {filterType === "category" && (
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">Nombre del rubro</label>
                <input
                  autoFocus
                  className="input w-full"
                  placeholder="Ej: Bebidas"
                  value={filterValue}
                  onChange={(e) => { setFilterValue(e.target.value); resetPreview(); }}
                />
              </div>
            )}

            {filterType === "supplier" && (
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">ID del proveedor</label>
                <input
                  autoFocus
                  type="number"
                  min={1}
                  className="input w-full tabular"
                  placeholder="Ej: 3"
                  value={filterValue}
                  onChange={(e) => { setFilterValue(e.target.value); resetPreview(); }}
                />
              </div>
            )}
          </div>

          {/* Porcentaje de precio */}
          <div>
            <label className="text-xs font-medium text-stone-600 block mb-1">
              % de aumento de precio <span className="text-stone-400">(ej: 15 para +15%, -5 para descuento)</span>
            </label>
            <input
              className="input w-full tabular"
              placeholder="15"
              value={pricePct}
              onChange={(e) => { setPricePct(e.target.value); resetPreview(); }}
            />
          </div>

          {/* Actualizar costo también */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-indigo-600"
                checked={updateCost}
                onChange={(e) => { setUpdateCost(e.target.checked); resetPreview(); }}
              />
              <span className="text-sm text-stone-700">También actualizar costo</span>
            </label>
            {updateCost && (
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">% de aumento de costo</label>
                <input
                  className="input w-full tabular"
                  placeholder="15"
                  value={costPct}
                  onChange={(e) => { setCostPct(e.target.value); resetPreview(); }}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>
          )}

          {/* Vista previa */}
          {previewItems && previewItems.length > 0 && (
            <div>
              <p className="text-sm font-medium text-stone-700 mb-2">{previewItems.length} productos afectados — Vista previa:</p>
              <div className="rounded border border-stone-200 overflow-hidden">
                <div className="overflow-y-auto max-h-[280px]">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Producto</th>
                        <th className="text-left px-3 py-2">Rubro</th>
                        <th className="text-right px-3 py-2">Precio actual</th>
                        <th className="text-right px-3 py-2">Precio nuevo</th>
                        {updateCost && <th className="text-right px-3 py-2">Costo nuevo</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {previewItems.map((item) => {
                        const priceDiff = item.new_price_cents - item.old_price_cents;
                        return (
                          <tr key={item.id} className="border-t border-stone-100 hover:bg-stone-50">
                            <td className="px-3 py-2 font-medium">{item.name}</td>
                            <td className="px-3 py-2 text-stone-400 text-xs">{item.category || "—"}</td>
                            <td className="px-3 py-2 text-right tabular text-stone-500">{centsToARS(item.old_price_cents)}</td>
                            <td className="px-3 py-2 text-right tabular font-semibold">
                              <span>{centsToARS(item.new_price_cents)}</span>
                              {priceDiff !== 0 && (
                                <span className={clsx("ml-1.5 text-xs font-normal", priceDiff > 0 ? "text-emerald-600" : "text-red-600")}>
                                  ({priceDiff > 0 ? "+" : ""}{centsToARS(priceDiff)})
                                </span>
                              )}
                            </td>
                            {updateCost && (
                              <td className="px-3 py-2 text-right tabular text-stone-600">{centsToARS(item.new_cost_cents)}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {previewItems && previewItems.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-700">
              No se encontraron productos con ese filtro.
            </div>
          )}

          {appliedCount !== null && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-4 text-sm text-emerald-800">
              <p className="font-semibold">Actualización completada</p>
              <p>{appliedCount} productos actualizados correctamente.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-secondary">
            {appliedCount !== null ? "Cerrar" : "Cancelar"}
          </button>
          {appliedCount === null && !previewItems && (
            <button
              onClick={handlePreview}
              disabled={loadingPreview || !pricePct.trim()}
              className="btn btn-secondary disabled:opacity-40"
            >
              {loadingPreview ? "Cargando…" : "Vista previa"}
            </button>
          )}
          {appliedCount === null && previewItems && previewItems.length > 0 && (
            <>
              <button onClick={resetPreview} className="btn btn-secondary">
                Volver a configurar
              </button>
              <button
                onClick={handleApply}
                disabled={applying}
                className="btn btn-primary disabled:opacity-40"
              >
                {applying ? "Aplicando…" : `Confirmar actualización (${previewItems.length} productos)`}
              </button>
            </>
          )}
          {appliedCount !== null && (
            <button onClick={onSaved} className="btn btn-primary">
              Listo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
