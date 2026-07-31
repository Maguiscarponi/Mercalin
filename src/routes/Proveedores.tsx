import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime } from "@/lib/format";
import type { NewSupplier, Product, PurchaseOrder, PurchaseOrderItem, Supplier, PurchaseProjection, SupplierLeadTime, CostInflationItem, SupplierRiskScore } from "@/types";

export default function Proveedores() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [tab, setTab] = useState<"proveedores" | "ordenes" | "proyeccion" | "leadtimes" | "inflacion" | "riesgo">("proveedores");
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [newOrder, setNewOrder] = useState<Supplier | null>(null);
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [orderItems, setOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [viewingProducts, setViewingProducts] = useState<Supplier | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<number | null>(null);

  // Analysis tabs — lazy loaded
  const [projections, setProjections] = useState<PurchaseProjection[] | null>(null);
  const [projectionsLoading, setProjectionsLoading] = useState(false);
  const [leadTimes, setLeadTimes] = useState<SupplierLeadTime[] | null>(null);
  const [leadTimesLoading, setLeadTimesLoading] = useState(false);
  const [inflation, setInflation] = useState<CostInflationItem[] | null>(null);
  const [inflationLoading, setInflationLoading] = useState(false);
  const [riskScores, setRiskScores] = useState<SupplierRiskScore[] | null>(null);
  const [riskScoresLoading, setRiskScoresLoading] = useState(false);
  const [generatingOrders, setGeneratingOrders] = useState(false);

  async function load() {
    const [s, o] = await Promise.all([api.listSuppliers(), api.listPurchaseOrders()]);
    setSuppliers(s);
    setOrders(o);
  }

  useEffect(() => { load(); }, []);

  async function handleSave(data: Partial<Supplier>) {
    try {
      if (data.id) {
        await api.updateSupplier(data as Supplier);
      } else {
        await api.createSupplier({
          name: data.name || "",
          contact_name: data.contact_name || null,
          phone: data.phone || null,
          email: data.email || null,
          address: data.address || null,
          cuit: data.cuit || null,
          notes: data.notes || null,
        });
      }
      setEditing(null);
      load();
    } catch (e) {
      console.error(e);
      alert("Error al guardar");
    }
  }

  async function viewOrder(o: PurchaseOrder) {
    setViewingOrder(o);
    const items = await api.getPurchaseItems(o.id);
    setOrderItems(items);
  }

  async function receiveOrder(id: number) {
    if (!confirm("¿Confirmar recepción de mercadería? Esto actualizará el stock automáticamente.")) return;
    try {
      await api.receivePurchaseOrder(id);
      load();
      setViewingOrder(null);
    } catch (e) {
      console.error(e);
      alert("Error al recibir la orden");
    }
  }

  async function cancelOrder(id: number) {
    if (!confirm("¿Cancelar esta orden? Esta acción no se puede deshacer.")) return;
    try {
      await api.cancelPurchaseOrder(id);
      load();
      setViewingOrder(null);
    } catch (e) {
      console.error(e);
      alert("Error al cancelar la orden");
    }
  }

  async function handleTabChange(t: typeof tab) {
    setTab(t);
    if (t === "proyeccion" && projections === null && !projectionsLoading) {
      setProjectionsLoading(true);
      try { setProjections(await api.getPurchaseProjections()); } catch { setProjections([]); } finally { setProjectionsLoading(false); }
    }
    if (t === "leadtimes" && leadTimes === null && !leadTimesLoading) {
      setLeadTimesLoading(true);
      try { setLeadTimes(await api.getSupplierLeadTimes()); } catch { setLeadTimes([]); } finally { setLeadTimesLoading(false); }
    }
    if (t === "inflacion" && inflation === null && !inflationLoading) {
      setInflationLoading(true);
      try { setInflation(await api.getSupplierCostInflation()); } catch { setInflation([]); } finally { setInflationLoading(false); }
    }
    if (t === "riesgo" && riskScores === null && !riskScoresLoading) {
      setRiskScoresLoading(true);
      try { setRiskScores(await api.getSupplierRiskScores()); } catch { setRiskScores([]); } finally { setRiskScoresLoading(false); }
    }
  }

  async function handleGenerateAutoOrders() {
    if (!confirm("¿Generar órdenes de compra automáticas agrupadas por proveedor?")) return;
    setGeneratingOrders(true);
    try {
      await api.generateAutoOrders();
      await load();
      setTab("ordenes");
    } catch (e) {
      console.error(e);
      alert("Error al generar órdenes automáticas");
    } finally {
      setGeneratingOrders(false);
    }
  }

  const pending = orders.filter((o) => o.status === "pendiente");

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Proveedores</h1>
          {pending.length > 0 && (
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-md border border-amber-200">
              {pending.length} órdenes pendientes
            </span>
          )}
        </div>
        {tab === "proveedores" && (
          <button onClick={() => setEditing({})} className="btn btn-primary">
            Nuevo proveedor
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {([
          { key: "proveedores", label: "Proveedores" },
          { key: "ordenes", label: `Órdenes de compra${pending.length > 0 ? ` (${pending.length})` : ""}` },
          { key: "proyeccion", label: "Proyección 7 días" },
          { key: "leadtimes", label: "Lead times" },
          { key: "inflacion", label: "Inflación de costos" },
          { key: "riesgo", label: "Score de Riesgo" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "proveedores" && (
        <div className="card flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-600 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Nombre</th>
                <th className="text-left px-4 py-2.5 font-medium">Contacto</th>
                <th className="text-left px-4 py-2.5 font-medium">Teléfono</th>
                <th className="text-left px-4 py-2.5 font-medium">CUIT</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-stone-400">
                  Sin proveedores registrados
                </td></tr>
              )}
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-stone-500">{s.contact_name || "—"}</td>
                  <td className="px-4 py-2.5 text-stone-500">{s.phone || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-500">{s.cuit || "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewingProducts(s)} className="btn-table-primary">Ver catálogo</button>
                      <button onClick={() => setNewOrder(s)} className="btn-table-success">Nueva orden</button>
                      <button onClick={() => setEditing(s)} className="btn-table-neutral">Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "ordenes" && (
        <div className="flex flex-col flex-1 gap-2 min-h-0">
          <div className="flex items-center gap-2">
            <select
              className="input w-52 text-sm"
              value={supplierFilter ?? ""}
              onChange={(e) => setSupplierFilter(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Todos los proveedores</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {supplierFilter && (
              <button onClick={() => setSupplierFilter(null)} className="text-xs text-stone-400 hover:text-stone-600">× Limpiar</button>
            )}
          </div>
          <div className="card flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-600 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">#</th>
                <th className="text-left px-4 py-2.5 font-medium">Proveedor</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {orders.filter((o) => !supplierFilter || o.supplier_id === supplierFilter).length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-stone-400">Sin órdenes</td></tr>
              )}
              {orders.filter((o) => !supplierFilter || o.supplier_id === supplierFilter).map((o) => (
                <tr key={o.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-400">#{o.id}</td>
                  <td className="px-4 py-2.5 font-medium">{o.supplier_name}</td>
                  <td className="px-4 py-2.5 text-right tabular">{centsToARS(o.total_cents)}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{formatDateTime(o.ordered_at)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      o.status === "pendiente" ? "bg-amber-100 text-amber-700" :
                      o.status === "recibido" ? "bg-emerald-100 text-emerald-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => viewOrder(o)} className="btn-table-success">Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === "proyeccion" && (
        <div className="flex flex-col flex-1 gap-3 min-h-0">
          {projectionsLoading ? (
            <div className="flex items-center justify-center flex-1 text-stone-400 text-sm">Calculando proyecciones…</div>
          ) : projections && projections.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-stone-400 text-sm">No hay productos con ventas registradas aún.</div>
          ) : projections && (
            <>
              <div className="card flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0">
                    <tr>
                      <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Producto</th>
                      <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Categoría</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Stock actual</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Días restantes</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Velocidad (un/día)</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Cant. sugerida</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Costo estimado</th>
                      <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((p) => (
                      <tr key={p.product_id} className="border-t border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-stone-500">{p.category || "—"}</td>
                        <td className="px-3 py-2 text-right tabular">{p.stock}</td>
                        <td className={`px-3 py-2 text-right tabular font-medium ${p.days_remaining <= 2 ? "text-red-600" : p.days_remaining <= 5 ? "text-amber-600" : ""}`}>
                          {p.days_remaining}
                        </td>
                        <td className="px-3 py-2 text-right tabular text-stone-500">{p.daily_velocity.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular">{p.suggested_qty}</td>
                        <td className="px-3 py-2 text-right tabular">{centsToARS(p.cost_cents)}</td>
                        <td className="px-3 py-2 text-stone-500">{p.supplier_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-stone-600">Costo total estimado: </span>
                  <span className="font-bold tabular">{centsToARS(projections.reduce((s, p) => s + p.cost_cents, 0))}</span>
                </div>
                <button
                  onClick={handleGenerateAutoOrders}
                  disabled={generatingOrders}
                  className="btn btn-primary"
                >
                  {generatingOrders ? "Generando…" : "Generar orden de compra"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "leadtimes" && (
        <div className="card flex-1 overflow-y-auto">
          {leadTimesLoading ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">Cargando…</div>
          ) : leadTimes && leadTimes.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">
              Aún no hay órdenes recibidas para calcular tiempos.
            </div>
          ) : leadTimes && (
            <table className="w-full text-sm">
              <thead className="bg-stone-50 sticky top-0">
                <tr>
                  <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Proveedor</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Promedio días</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Mínimo</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Máximo</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Órdenes</th>
                </tr>
              </thead>
              <tbody>
                {leadTimes.map((lt) => (
                  <tr key={lt.supplier_id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2 font-medium">{lt.supplier_name}</td>
                    <td className="px-3 py-2 text-right tabular">{lt.avg_days.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular text-stone-500">{lt.min_days}</td>
                    <td className="px-3 py-2 text-right tabular text-stone-500">{lt.max_days}</td>
                    <td className="px-3 py-2 text-right tabular text-stone-400">{lt.order_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "inflacion" && (
        <div className="card flex-1 overflow-y-auto">
          {inflationLoading ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">Cargando…</div>
          ) : inflation && inflation.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">
              No hay datos de variación de costos aún.
            </div>
          ) : inflation && (
            <table className="w-full text-sm">
              <thead className="bg-stone-50 sticky top-0">
                <tr>
                  <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Proveedor</th>
                  <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Producto</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Costo inicial</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Costo actual</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Variación %</th>
                  <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Órdenes</th>
                </tr>
              </thead>
              <tbody>
                {inflation.map((item) => (
                  <tr key={`${item.supplier_id}-${item.product_id}`} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2 text-stone-500">{item.supplier_name}</td>
                    <td className="px-3 py-2 font-medium">{item.product_name}</td>
                    <td className="px-3 py-2 text-right tabular text-stone-500">{centsToARS(item.first_cost_cents)}</td>
                    <td className="px-3 py-2 text-right tabular">{centsToARS(item.last_cost_cents)}</td>
                    <td className={`px-3 py-2 text-right tabular font-medium ${
                      item.pct_change > 20 ? "text-red-600" :
                      item.pct_change > 10 ? "text-amber-600" :
                      item.pct_change > 0 ? "text-yellow-600" : "text-stone-500"
                    }`}>
                      {item.pct_change > 0 ? "+" : ""}{item.pct_change.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular text-stone-400">{item.order_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "riesgo" && (
        <div className="flex flex-col flex-1 gap-3 min-h-0">
          {riskScoresLoading ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">Cargando…</div>
          ) : riskScores && riskScores.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-stone-400 text-sm text-center px-8">
              Necesitás al menos 2 órdenes recibidas por proveedor para calcular el score · Los datos se acumulan con el tiempo.
            </div>
          ) : riskScores && (
            <>
              <div className="flex items-center gap-3">
                {(() => {
                  const alto = riskScores.filter((r) => r.risk_level === "alto").length;
                  const medio = riskScores.filter((r) => r.risk_level === "medio").length;
                  const bajo = riskScores.filter((r) => r.risk_level === "bajo").length;
                  return (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="px-2.5 py-1 rounded-md bg-red-50 text-red-700 border border-red-200 font-medium">{alto} alto</span>
                      <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">{medio} medio</span>
                      <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">{bajo} bajo</span>
                    </div>
                  );
                })()}
              </div>
              <div className="card flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0">
                    <tr>
                      <th className="text-left text-xs text-stone-500 font-medium px-3 py-2">Proveedor</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Lead time prom.</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Variabilidad</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Inflación costos</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Score</th>
                      <th className="text-center text-xs text-stone-500 font-medium px-3 py-2">Nivel de riesgo</th>
                      <th className="text-right text-xs text-stone-500 font-medium px-3 py-2">Órdenes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskScores.map((r) => (
                      <tr key={r.supplier_id} className="border-t border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 font-medium">{r.supplier_name}</td>
                        <td className="px-3 py-2 text-right tabular text-stone-600">{r.lead_time_avg.toFixed(1)} días</td>
                        <td className="px-3 py-2 text-right tabular text-stone-500">±{r.lead_time_std.toFixed(1)} días</td>
                        <td className={`px-3 py-2 text-right tabular font-medium ${
                          r.cost_inflation_pct > 20 ? "text-red-600" :
                          r.cost_inflation_pct > 10 ? "text-amber-600" :
                          r.cost_inflation_pct > 0 ? "text-yellow-600" : "text-stone-500"
                        }`}>
                          +{r.cost_inflation_pct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 bg-stone-100 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-2 rounded-full ${
                                  r.risk_level === "alto" ? "bg-red-500" :
                                  r.risk_level === "medio" ? "bg-amber-400" :
                                  "bg-emerald-500"
                                }`}
                                style={{ width: `${r.risk_score}%` }}
                              />
                            </div>
                            <span className="tabular text-stone-600 w-7 text-right">{r.risk_score}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.risk_level === "alto" ? "bg-red-100 text-red-700" :
                            r.risk_level === "medio" ? "bg-amber-100 text-amber-700" :
                            "bg-emerald-100 text-emerald-700"
                          }`}>
                            {r.risk_level.charAt(0).toUpperCase() + r.risk_level.slice(1)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular text-stone-400">{r.order_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-stone-400 px-1">
                El score combina variabilidad de entrega (40%) e inflación de costos (60%). Proveedores con score alto requieren más stock de seguridad.
              </p>
            </>
          )}
        </div>
      )}

      {editing && (
        <SupplierForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {newOrder && (
        <NewOrderForm
          supplier={newOrder}
          onCancel={() => setNewOrder(null)}
          onSaved={() => { setNewOrder(null); setTab("ordenes"); load(); }}
        />
      )}

      {viewingOrder && (
        <OrderDetailModal
          order={viewingOrder}
          items={orderItems}
          onClose={() => { setViewingOrder(null); setOrderItems([]); }}
          onReceive={receiveOrder}
          onCancel={cancelOrder}
        />
      )}

      {viewingProducts && (
        <SupplierProductsModal
          supplier={viewingProducts}
          onClose={() => setViewingProducts(null)}
          onNewOrder={() => { setViewingProducts(null); setNewOrder(viewingProducts); }}
        />
      )}
    </div>
  );
}

function OrderDetailModal({
  order, items, onClose, onReceive, onCancel,
}: {
  order: PurchaseOrder;
  items: PurchaseOrderItem[];
  onClose: () => void;
  onReceive: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h2 className="font-semibold">Orden #{order.id} — {order.supplier_name}</h2>
          <p className="text-xs text-stone-400 mt-0.5">{formatDateTime(order.ordered_at)}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 uppercase">
              <tr>
                <th className="text-left py-2">Producto</th>
                <th className="text-right py-2">Cantidad</th>
                <th className="text-right py-2">Costo unit.</th>
                <th className="text-right py-2">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-stone-100">
                  <td className="py-2">{i.name}</td>
                  <td className="py-2 text-right tabular">{i.qty}</td>
                  <td className="py-2 text-right tabular">{centsToARS(i.unit_cost_cents)}</td>
                  <td className="py-2 text-right tabular font-medium">{centsToARS(i.unit_cost_cents * i.qty)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-stone-200 font-semibold">
                <td colSpan={3} className="py-2 text-right">Total</td>
                <td className="py-2 text-right tabular">{centsToARS(order.total_cents)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
          {order.status === "pendiente" && (
            <button
              onClick={() => onCancel(order.id)}
              className="btn flex-1 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            >
              Cancelar orden
            </button>
          )}
          {order.status === "pendiente" && (
            <button
              onClick={() => onReceive(order.id)}
              className="btn flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Confirmar recepción
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type OrderItem = { name: string; unit_cost: string; qty: string; product_id: number | null };

function OrderItemRow({
  item, index, onChange, onRemove,
}: {
  item: OrderItem;
  index: number;
  onChange: (i: number, patch: Partial<OrderItem>) => void;
  onRemove: (i: number) => void;
}) {
  const [results, setResults] = useState<Product[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!item.name.trim() || item.product_id) { setResults([]); return; }
    const t = setTimeout(() => {
      api.listProducts(item.name).then((r) => { setResults(r.slice(0, 6)); setShowDrop(r.length > 0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [item.name, item.product_id]);

  return (
    <div className="grid grid-cols-[1fr_120px_80px_32px] gap-2">
      <div className="relative" ref={dropRef}>
        <input
          className="input text-sm w-full"
          placeholder="Buscar o escribir nombre…"
          value={item.name}
          onChange={(e) => onChange(index, { name: e.target.value, product_id: null })}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        />
        {showDrop && results.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 bg-white border border-stone-200 rounded-md shadow-lg mt-0.5 max-h-40 overflow-y-auto">
            {results.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 hover:bg-stone-50 cursor-pointer"
                onMouseDown={() => {
                  onChange(index, { name: p.name, unit_cost: (p.cost_cents / 100).toString(), product_id: p.id });
                  setShowDrop(false);
                }}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-stone-400">{p.barcode} · Costo: {centsToARS(p.cost_cents)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <input
        className="input text-sm tabular text-right"
        placeholder="Costo ($)"
        value={item.unit_cost}
        onChange={(e) => onChange(index, { unit_cost: e.target.value })}
        inputMode="numeric"
      />
      <input
        type="number"
        min={1}
        className="input text-sm tabular text-right"
        placeholder="Qty"
        value={item.qty}
        onChange={(e) => onChange(index, { qty: e.target.value })}
      />
      <button onClick={() => onRemove(index)} className="text-stone-400 hover:text-red-600 text-lg">×</button>
    </div>
  );
}

function NewOrderForm({
  supplier, onCancel, onSaved,
}: {
  supplier: Supplier;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<OrderItem[]>([{ name: "", unit_cost: "", qty: "1", product_id: null }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function addItem() {
    setItems([...items, { name: "", unit_cost: "", qty: "1", product_id: null }]);
  }

  function removeItem(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  function changeItem(i: number, patch: Partial<OrderItem>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }

  async function submit() {
    if (items.some((i) => !i.name.trim() || !i.unit_cost)) {
      alert("Completá todos los ítems");
      return;
    }
    setSaving(true);
    try {
      await api.createPurchaseOrder({
        supplier_id: supplier.id,
        notes: notes.trim() || null,
        items: items.map((i) => ({
          product_id: i.product_id,
          name: i.name.trim(),
          unit_cost_cents: arsStringToCents(i.unit_cost),
          qty: parseInt(i.qty) || 1,
        })),
      });
      onSaved();
    } catch (e) {
      console.error(e);
      alert("Error al crear la orden");
    } finally {
      setSaving(false);
    }
  }

  const total = items.reduce((s, i) => s + arsStringToCents(i.unit_cost) * (parseInt(i.qty) || 1), 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[620px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h2 className="font-semibold">Nueva orden — {supplier.name}</h2>
          <p className="text-xs text-stone-400 mt-0.5">Buscá un producto del catálogo o escribí el nombre manualmente</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {items.map((item, i) => (
            <OrderItemRow key={i} item={item} index={i} onChange={changeItem} onRemove={removeItem} />
          ))}

          <button onClick={addItem} className="text-sm text-emerald-600 hover:underline mt-1">
            + Agregar ítem
          </button>

          <div className="mt-3">
            <label className="text-xs font-medium text-stone-600 block mb-1">Notas</label>
            <input
              className="input text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones de la orden…"
            />
          </div>
        </div>

        <div className="p-5 border-t border-stone-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-stone-600">Total estimado</span>
            <span className="font-bold text-lg tabular">{centsToARS(total)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
            <button onClick={submit} disabled={saving} className="btn btn-primary flex-1">
              {saving ? "Creando…" : "Crear orden"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplierForm({
  initial, onCancel, onSave,
}: {
  initial: Partial<Supplier>;
  onCancel: () => void;
  onSave: (s: Partial<Supplier>) => void;
}) {
  const [form, setForm] = useState<Partial<Supplier>>(initial);

  function f(key: keyof Supplier) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{form.id ? "Editar proveedor" : "Nuevo proveedor"}</h2>

        <div className="space-y-3">
          <Field label="Nombre *">
            <input autoFocus className="input" value={form.name || ""} onChange={f("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Persona de contacto">
              <input className="input" value={form.contact_name || ""} onChange={f("contact_name")} />
            </Field>
            <Field label="Teléfono">
              <input className="input" value={form.phone || ""} onChange={f("phone")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CUIT">
              <input className="input font-mono" value={form.cuit || ""} onChange={f("cuit")} placeholder="20-00000000-0" />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={form.email || ""} onChange={f("email")} />
            </Field>
          </div>
          <Field label="Dirección">
            <input className="input" value={form.address || ""} onChange={f("address")} />
          </Field>
          <Field label="Notas">
            <textarea className="input resize-none h-16" value={form.notes || ""} onChange={f("notes")} />
          </Field>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={() => onSave(form)} className="btn btn-primary flex-1">Guardar</button>
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

function SupplierProductsModal({
  supplier, onClose, onNewOrder,
}: {
  supplier: Supplier;
  onClose: () => void;
  onNewOrder: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listProducts("").then((all) => {
      setProducts(all.filter((p) => p.supplier_id === supplier.id));
    }).catch(console.error).finally(() => setLoading(false));
  }, [supplier.id]);

  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const lowStockCount = products.filter((p) => p.stock <= p.min_stock).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[680px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-lg">{supplier.name}</h2>
            <div className="flex gap-4 mt-1 text-xs text-stone-500">
              {supplier.contact_name && <span>Contacto: {supplier.contact_name}</span>}
              {supplier.phone && <span>Tel: {supplier.phone}</span>}
              {supplier.email && <span>{supplier.email}</span>}
              {supplier.cuit && <span>CUIT: {supplier.cuit}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl ml-4">×</button>
        </div>

        {!loading && products.length > 0 && (
          <div className="px-5 py-3 border-b border-stone-100 grid grid-cols-3 gap-3">
            <div className="bg-stone-50 rounded-md px-3 py-2 text-center">
              <div className="text-xl font-bold tabular">{products.length}</div>
              <div className="text-xs text-stone-500">productos</div>
            </div>
            <div className="bg-stone-50 rounded-md px-3 py-2 text-center">
              <div className="text-xl font-bold tabular">{totalStock}</div>
              <div className="text-xs text-stone-500">unidades en stock</div>
            </div>
            <div className={`rounded-md px-3 py-2 text-center ${lowStockCount > 0 ? "bg-red-50" : "bg-stone-50"}`}>
              <div className={`text-xl font-bold tabular ${lowStockCount > 0 ? "text-red-600" : ""}`}>{lowStockCount}</div>
              <div className="text-xs text-stone-500">con stock bajo</div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-stone-400 text-sm">Cargando…</div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-stone-400 gap-2">
              <p className="text-sm">No hay productos asignados a este proveedor.</p>
              <p className="text-xs">Podés asignar un proveedor al editar cada producto.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5">Producto</th>
                  <th className="text-left px-4 py-2.5">Categoría</th>
                  <th className="text-right px-4 py-2.5">Costo</th>
                  <th className="text-right px-4 py-2.5">Precio</th>
                  <th className="text-right px-4 py-2.5">Stock</th>
                  <th className="text-right px-4 py-2.5">Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className={`border-t border-stone-100 ${p.stock <= p.min_stock ? "bg-red-50" : "hover:bg-stone-50"}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{p.name}</div>
                      {p.barcode && <div className="text-[10px] text-stone-400 font-mono">{p.barcode}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs">{p.category || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-stone-500">{centsToARS(p.cost_cents)}</td>
                    <td className="px-4 py-2.5 text-right tabular font-medium">{centsToARS(p.price_cents)}</td>
                    <td className={`px-4 py-2.5 text-right tabular font-bold ${p.stock <= p.min_stock ? "text-red-600" : ""}`}>
                      {p.stock}
                      {p.stock <= p.min_stock && <span className="ml-1 text-xs">⚠</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-stone-400">{p.min_stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button onClick={onNewOrder} className="btn btn-primary flex-1">+ Nueva orden de compra</button>
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
