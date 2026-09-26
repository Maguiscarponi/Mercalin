import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, formatDateTime } from "@/lib/format";
import type { AuditEntry, CashMovement, CashSession, Product, ReturnWithItems, SaleWithItems } from "@/types";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import TicketPrint from "@/components/TicketPrint";
import clsx from "clsx";

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo", debito: "Débito", credito: "Crédito",
  qr: "QR / MP", transferencia: "Transferencia",
  fiado: "Fiado", cuenta_corriente: "Cta. Cte.", mixto: "Pago mixto",
};

// Todas las acciones que realmente registra el backend (ver `log_action(...)`
// en src-tauri/src/commands/*.rs) -- si se agrega una acción nueva ahí y no
// se agrega acá, se ve en crudo (snake_case) en vez de en español legible.
const ACTION_LABELS: Record<string, string> = {
  crear:                          "Alta",
  editar:                         "Edición",
  eliminar:                       "Baja",
  reactivar:                      "Reactivación",
  desactivar:                     "Desactivación",
  venta:                          "Venta",
  anular:                         "Anulación de venta",
  devolucion:                     "Devolución",
  ajuste_stock:                   "Ajuste de stock",
  ingreso_stock:                  "Ingreso de stock (lote)",
  retirar_lote:                   "Retiro de lote vencido",
  conteo_inventario:              "Conteo de inventario",
  actualizacion_masiva:           "Actualización masiva de precios",
  actualizacion_masiva_stock:     "Actualización masiva de stock",
  actualizacion_masiva_categoria: "Cambio masivo de categoría",
  actualizacion_masiva_marca:     "Cambio masivo de marca",
  actualizacion_masiva_proveedor: "Cambio masivo de proveedor",
  actualizar_min_stock:           "Stock mínimo sugerido por IA",
  importacion_csv:                "Importación desde CSV/Excel",
  importacion_open_food_facts:    "Importación de catálogo",
  abrir_caja:                     "Apertura de caja",
  cerrar_caja:                    "Cierre de caja",
  cambiar_password:               "Cambio de contraseña",
};

// Ídem: toda entidad que aparece como segundo argumento de `log_action`.
// "producto"/"productos" son la misma entidad para quien lee esto (singular
// en acciones puntuales, plural en las masivas) -- se agrupan igual acá y en
// el filtro de pestañas de abajo, para no filtrar por un detalle interno.
const ENTITY_LABELS: Record<string, string> = {
  producto:        "Producto",
  productos:       "Productos",
  venta:           "Venta",
  caja:            "Caja",
  usuario:         "Usuario",
  return:          "Devolución",
  stock:           "Stock",
  etiqueta_pesada: "Etiqueta pesada",
};

const ACTION_COLORS: Record<string, string> = {
  crear:                          "bg-emerald-50 text-emerald-700",
  editar:                         "bg-blue-50 text-blue-700",
  eliminar:                       "bg-orange-50 text-orange-700",
  reactivar:                      "bg-emerald-50 text-emerald-700",
  desactivar:                     "bg-orange-50 text-orange-700",
  venta:                          "bg-stone-100 text-stone-600",
  anular:                         "bg-orange-50 text-orange-700",
  devolucion:                     "bg-amber-50 text-amber-700",
  ajuste_stock:                   "bg-amber-50 text-amber-700",
  ingreso_stock:                  "bg-emerald-50 text-emerald-700",
  retirar_lote:                   "bg-orange-50 text-orange-700",
  conteo_inventario:              "bg-amber-50 text-amber-700",
  actualizacion_masiva:           "bg-violet-50 text-violet-700",
  actualizacion_masiva_stock:     "bg-violet-50 text-violet-700",
  actualizacion_masiva_categoria: "bg-violet-50 text-violet-700",
  actualizacion_masiva_marca:     "bg-violet-50 text-violet-700",
  actualizacion_masiva_proveedor: "bg-violet-50 text-violet-700",
  actualizar_min_stock:           "bg-violet-50 text-violet-700",
  importacion_csv:                "bg-sky-50 text-sky-700",
  importacion_open_food_facts:    "bg-sky-50 text-sky-700",
  abrir_caja:                     "bg-emerald-50 text-emerald-700",
  cerrar_caja:                    "bg-stone-100 text-stone-600",
  cambiar_password:               "bg-blue-50 text-blue-700",
};

// Grupos para las pestañas de filtro -- cada pestaña puede juntar más de una
// entidad cruda (ver comentario de ENTITY_LABELS más arriba).
const ENTITY_GROUPS: [id: string, label: string, entities: string[]][] = [
  ["producto",  "Productos",   ["producto", "productos"]],
  ["venta",     "Ventas",      ["venta"]],
  ["devolucion","Devoluciones",["return"]],
  ["caja",      "Caja",        ["caja"]],
  ["stock",     "Stock",       ["stock"]],
  ["usuario",   "Usuarios",    ["usuario"]],
];

function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export default function Auditoria() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityFilter, setEntityFilter] = useState("todos");
  const [limit, setLimit] = useState(200);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<AuditEntry | null>(null);

  async function load() {
    setLoading(true);
    try {
      setEntries(await api.listAuditLog(limit));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [limit]); // eslint-disable-line

  function matchesGroup(entry: AuditEntry, groupId: string): boolean {
    const group = ENTITY_GROUPS.find(([id]) => id === groupId);
    return group ? group[2].includes(entry.entity) : true;
  }

  const entityFiltered = entityFilter === "todos" ? entries : entries.filter((e) => matchesGroup(e, entityFilter));
  const q = search.trim().toLowerCase();
  const filtered = q
    ? entityFiltered.filter((e) =>
        e.detail?.toLowerCase().includes(q) ||
        actionLabel(e.action).toLowerCase().includes(q) ||
        entityLabel(e.entity).toLowerCase().includes(q) ||
        (e.user_name ?? "").toLowerCase().includes(q) ||
        String(e.entity_id ?? "").includes(q)
      )
    : entityFiltered;

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Auditoría</h1>
          <p className="text-sm text-stone-500 mt-0.5">Registro de acciones críticas del sistema — tocá una fila para ver el detalle completo</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-56 text-sm"
            placeholder="Buscar usuario, acción, detalle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input w-auto text-sm"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={100}>Últimas 100</option>
            <option value={200}>Últimas 200</option>
            <option value={500}>Últimas 500</option>
            <option value={1000}>Últimas 1000</option>
          </select>
          <button onClick={load} className="btn btn-secondary text-sm">
            Actualizar
          </button>
        </div>
      </div>

      {/* Filtro por entidad */}
      <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
        <button
          onClick={() => setEntityFilter("todos")}
          className={clsx(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
            entityFilter === "todos"
              ? "border-red-600 text-red-700"
              : "border-transparent text-stone-500 hover:text-stone-700"
          )}
        >
          Todos
          <span className="ml-1.5 text-xs text-stone-400">({entries.length})</span>
        </button>
        {ENTITY_GROUPS.map(([id, label]) => {
          const count = entries.filter((e) => matchesGroup(e, id)).length;
          if (count === 0) return null;
          return (
            <button
              key={id}
              onClick={() => setEntityFilter(id)}
              className={clsx(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                entityFilter === id
                  ? "border-red-600 text-red-700"
                  : "border-transparent text-stone-500 hover:text-stone-700"
              )}
            >
              {label}
              <span className="ml-1.5 text-xs text-stone-400">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="card flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            No hay registros de auditoría todavía.
            <br />
            Las acciones del sistema quedarán registradas aquí.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-600 text-xs uppercase sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Fecha y hora</th>
                <th className="text-left px-4 py-2.5 font-medium">Usuario</th>
                <th className="text-left px-4 py-2.5 font-medium">Acción</th>
                <th className="text-left px-4 py-2.5 font-medium">Registro</th>
                <th className="text-left px-4 py-2.5 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setViewing(entry)}
                  className="border-t border-stone-100 hover:bg-red-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-600">
                    {entry.user_name || <span className="text-stone-300">Sistema</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      "text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap",
                      ACTION_COLORS[entry.action] ?? "bg-stone-100 text-stone-600"
                    )}>
                      {actionLabel(entry.action)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-stone-700 whitespace-nowrap">
                    <span>{entityLabel(entry.entity)}</span>
                    {entry.entity_id != null && (
                      <span className="ml-1.5 font-mono text-xs text-stone-400">#{entry.entity_id}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500 text-xs max-w-[420px] truncate">
                    {entry.detail || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewing && (
        <AuditDetailModal entry={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

// Qué se puede buscar para cada entidad -- "producto" solo cuando hay
// entity_id (las acciones masivas afectan a muchos productos a la vez y no
// guardan cuáles, así que ahí no hay nada puntual para resolver).
type RelatedKind = "venta" | "producto" | "devolucion" | "caja" | null;

function relatedKindFor(entry: AuditEntry): RelatedKind {
  if (entry.entity_id == null) return null;
  if (entry.entity === "venta") return "venta";
  if (entry.entity === "producto") return "producto";
  if (entry.entity === "return") return "devolucion";
  if (entry.entity === "caja") return "caja";
  return null;
}

function AuditDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  useEscapeToClose(onClose, true);

  const kind = relatedKindFor(entry);
  const [loadingRelated, setLoadingRelated] = useState(kind !== null);
  const [relatedError, setRelatedError] = useState<string | null>(null);

  const [sale, setSale] = useState<SaleWithItems | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [ret, setRet] = useState<ReturnWithItems | null>(null);
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);

  const [showTicket, setShowTicket] = useState(false);
  const [businessInfo, setBusinessInfo] = useState({ name: "Punto Simple POS", address: "", footer: "¡Gracias por su compra!" });

  useEffect(() => {
    if (!kind || entry.entity_id == null) return;
    let cancelled = false;
    setLoadingRelated(true);
    setRelatedError(null);
    (async () => {
      try {
        if (kind === "venta") {
          const sw = await api.getSaleWithItems(entry.entity_id!);
          if (!cancelled) setSale(sw);
        } else if (kind === "producto") {
          const p = await api.getProduct(entry.entity_id!);
          if (!cancelled) setProduct(p);
        } else if (kind === "devolucion") {
          const rw = await api.getReturnWithItems(entry.entity_id!);
          if (!cancelled) setRet(rw);
        } else if (kind === "caja") {
          const [s, m, t] = await Promise.all([
            api.getCashSession(entry.entity_id!),
            api.listCashMovements(entry.entity_id!),
            api.getSessionAllSalesTotal(entry.entity_id!),
          ]);
          if (!cancelled) { setSession(s); setMovements(m); setSessionTotal(t); }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setRelatedError("No se pudo cargar el registro relacionado — puede haber sido eliminado.");
      } finally {
        if (!cancelled) setLoadingRelated(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry, kind]);

  async function openTicket() {
    try {
      const [name, addr, footer] = await Promise.all([
        api.getConfig("business_name"),
        api.getConfig("business_address"),
        api.getConfig("ticket_footer"),
      ]);
      setBusinessInfo({
        name: name || "Punto Simple POS",
        address: addr || "",
        footer: footer || "¡Gracias por su compra!",
      });
    } catch { /* usa los valores por defecto */ }
    setShowTicket(true);
  }

  if (showTicket && sale) {
    return (
      <TicketPrint
        sale={sale.sale}
        items={sale.items}
        businessName={businessInfo.name}
        businessAddress={businessInfo.address}
        ticketFooter={businessInfo.footer}
        isRi={false}
        onClose={() => setShowTicket(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="flex items-center gap-2 mb-1 pr-8">
          <span className={clsx(
            "text-xs px-2 py-0.5 rounded font-medium",
            ACTION_COLORS[entry.action] ?? "bg-stone-100 text-stone-600"
          )}>
            {actionLabel(entry.action)}
          </span>
          <span className="text-sm text-stone-500">
            {entityLabel(entry.entity)}{entry.entity_id != null && ` #${entry.entity_id}`}
          </span>
        </div>
        <h2 className="text-lg font-semibold mb-4">{formatDateTime(entry.created_at)}</h2>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-xs font-medium text-stone-500 block mb-0.5">Usuario</span>
            <span className="text-stone-800">{entry.user_name || "Sistema (sin usuario asociado)"}</span>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-500 block mb-0.5">Detalle registrado</span>
            <p className="text-stone-800 whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded-md p-3">
              {entry.detail || "Sin detalle adicional."}
            </p>
          </div>

          {/* Registro relacionado, resuelto según la entidad */}
          {kind && (
            <div>
              <span className="text-xs font-medium text-stone-500 block mb-1">
                {kind === "venta" && "Venta completa"}
                {kind === "producto" && "Producto"}
                {kind === "devolucion" && "Devolución completa"}
                {kind === "caja" && "Turno de caja"}
              </span>

              {loadingRelated ? (
                <p className="text-xs text-stone-400 py-2">Cargando…</p>
              ) : relatedError ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2.5">{relatedError}</p>
              ) : kind === "venta" && sale ? (
                <div className="border border-stone-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50 text-stone-500 uppercase">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Producto</th>
                        <th className="text-right px-2.5 py-1.5">Precio</th>
                        <th className="text-right px-2.5 py-1.5">Cant.</th>
                        <th className="text-right px-2.5 py-1.5">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sale.items.map((item) => (
                        <tr key={item.id} className="border-t border-stone-100">
                          <td className="px-2.5 py-1.5">{item.name}</td>
                          <td className="px-2.5 py-1.5 text-right tabular text-stone-500">{centsToARS(item.unit_price_cents)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular">{item.qty}</td>
                          <td className="px-2.5 py-1.5 text-right tabular font-medium">{centsToARS(item.subtotal_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2.5 bg-stone-50 border-t border-stone-200 space-y-1 text-xs">
                    <div className="flex justify-between font-semibold text-sm">
                      <span>Total</span><span className="tabular">{centsToARS(sale.sale.total_cents)}</span>
                    </div>
                    <div className="flex justify-between text-stone-500">
                      <span>Medio de pago</span>
                      <span>{METHOD_LABELS[sale.sale.payment_method] || sale.sale.payment_method}</span>
                    </div>
                    {sale.sale.client_name && (
                      <div className="flex justify-between text-stone-500"><span>Cliente</span><span>{sale.sale.client_name}</span></div>
                    )}
                    {sale.sale.notes?.includes("[ANULADA]") && (
                      <div className="text-orange-600 font-medium">Esta venta está anulada</div>
                    )}
                  </div>
                  <button onClick={openTicket} className="btn btn-secondary w-full text-xs py-2 rounded-none border-t border-stone-200">
                    🖨 Ver / reimprimir ticket
                  </button>
                </div>
              ) : kind === "producto" && product ? (
                <div className="border border-stone-200 rounded-md p-3 text-xs space-y-1">
                  <div className="font-medium text-sm text-stone-800">{product.name}</div>
                  <div className="flex justify-between text-stone-500">
                    <span>Categoría</span><span>{product.category || "—"}</span>
                  </div>
                  {product.brand && (
                    <div className="flex justify-between text-stone-500"><span>Marca</span><span>{product.brand}</span></div>
                  )}
                  <div className="flex justify-between text-stone-500">
                    <span>Stock actual</span>
                    <span className="tabular">{product.stock}{product.is_weighable && ` ${product.unit}`}</span>
                  </div>
                  <div className="flex justify-between text-stone-500">
                    <span>Precio actual</span><span className="tabular">{centsToARS(product.price_cents)}</span>
                  </div>
                  {!product.active && <div className="text-orange-600 font-medium">Este producto está desactivado</div>}
                </div>
              ) : kind === "devolucion" && ret ? (
                <div className="border border-stone-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50 text-stone-500 uppercase">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Producto</th>
                        <th className="text-right px-2.5 py-1.5">Precio</th>
                        <th className="text-right px-2.5 py-1.5">Cant.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ret.items.map((item) => (
                        <tr key={item.id} className="border-t border-stone-100">
                          <td className="px-2.5 py-1.5">{item.name}</td>
                          <td className="px-2.5 py-1.5 text-right tabular text-stone-500">{centsToARS(item.unit_price_cents)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular">{item.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2.5 bg-stone-50 border-t border-stone-200 space-y-1 text-xs">
                    <div className="flex justify-between font-semibold text-sm">
                      <span>Total devuelto</span><span className="tabular">{centsToARS(ret.ret.total_cents)}</span>
                    </div>
                    <div className="flex justify-between text-stone-500"><span>Motivo</span><span>{ret.ret.reason}</span></div>
                    {ret.ret.sale_id && (
                      <div className="flex justify-between text-stone-500"><span>Venta original</span><span>#{ret.ret.sale_id}</span></div>
                    )}
                  </div>
                </div>
              ) : kind === "caja" && session ? (
                <div className="border border-stone-200 rounded-md p-3 text-xs space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex justify-between text-stone-500"><span>Apertura</span><span className="tabular">{centsToARS(session.opening_cents)}</span></div>
                    <div className="flex justify-between text-stone-500">
                      <span>Cierre</span>
                      <span className="tabular">{session.closing_cents != null ? centsToARS(session.closing_cents) : "Turno abierto"}</span>
                    </div>
                    <div className="flex justify-between text-stone-500"><span>Total vendido</span><span className="tabular">{centsToARS(sessionTotal)}</span></div>
                    {session.closing_cents != null && (
                      <div className="flex justify-between text-stone-500">
                        <span>Diferencia</span>
                        <span className={clsx("tabular font-medium", session.closing_cents - session.opening_cents - sessionTotal !== 0 ? "text-amber-600" : "text-emerald-600")}>
                          {centsToARS(session.closing_cents - session.opening_cents - sessionTotal)}
                        </span>
                      </div>
                    )}
                  </div>
                  {movements.length > 0 && (
                    <div>
                      <span className="text-stone-500 block mb-1">Movimientos manuales de esta caja</span>
                      <div className="space-y-1">
                        {movements.map((m) => (
                          <div key={m.id} className="flex justify-between">
                            <span>{m.concept}</span>
                            <span className={clsx("tabular", m.movement_type === "ingreso" ? "text-emerald-600" : "text-orange-600")}>
                              {m.movement_type === "ingreso" ? "+" : "−"}{centsToARS(m.amount_cents)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <span className="text-xs font-medium text-stone-500 block mb-0.5">Acción (código interno)</span>
              <span className="font-mono text-xs text-stone-400">{entry.action}</span>
            </div>
            <div>
              <span className="text-xs font-medium text-stone-500 block mb-0.5">Entidad (código interno)</span>
              <span className="font-mono text-xs text-stone-400">{entry.entity}{entry.entity_id != null && ` #${entry.entity_id}`}</span>
            </div>
          </div>
        </div>

        <button onClick={onClose} className="btn btn-secondary w-full mt-5">Cerrar (Esc)</button>
      </div>
    </div>
  );
}
