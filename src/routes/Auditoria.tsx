import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry } from "@/types";
import clsx from "clsx";

const ACTION_LABELS: Record<string, string> = {
  crear:        "Crear",
  editar:       "Editar",
  eliminar:     "Eliminar",
  venta:        "Venta",
  anular:       "Anular venta",
  ajuste_stock: "Ajuste stock",
  abrir_caja:   "Abrir caja",
  cerrar_caja:  "Cerrar caja",
};

const ENTITY_LABELS: Record<string, string> = {
  producto: "Producto",
  venta:    "Venta",
  caja:     "Caja",
};

const ACTION_COLORS: Record<string, string> = {
  crear:        "bg-emerald-50 text-emerald-700",
  editar:       "bg-blue-50 text-blue-700",
  eliminar:     "bg-red-50 text-red-700",
  venta:        "bg-stone-100 text-stone-600",
  anular:       "bg-red-50 text-red-700",
  ajuste_stock: "bg-amber-50 text-amber-700",
  abrir_caja:   "bg-emerald-50 text-emerald-700",
  cerrar_caja:  "bg-stone-100 text-stone-600",
};

type EntityFilter = "todos" | "producto" | "venta" | "caja";

export default function Auditoria() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [entity, setEntity] = useState<EntityFilter>("todos");
  const [limit, setLimit] = useState(200);
  const [search, setSearch] = useState("");

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

  const entityFiltered = entity === "todos" ? entries : entries.filter((e) => e.entity === entity);
  const filtered = search
    ? entityFiltered.filter((e) =>
        e.detail?.toLowerCase().includes(search.toLowerCase()) ||
        (ACTION_LABELS[e.action] ?? e.action).toLowerCase().includes(search.toLowerCase())
      )
    : entityFiltered;

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Auditoría</h1>
          <p className="text-sm text-stone-500 mt-0.5">Registro de acciones críticas del sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-52 text-sm"
            placeholder="Buscar en detalle o acción…"
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
          </select>
          <button onClick={load} className="btn btn-secondary text-sm">
            Actualizar
          </button>
        </div>
      </div>

      {/* Filtro por entidad */}
      <div className="flex gap-1 border-b border-stone-200">
        {(["todos", "producto", "venta", "caja"] as EntityFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => setEntity(t)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
              entity === t
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            )}
          >
            {t === "todos" ? "Todos" : ENTITY_LABELS[t] ?? t}
            <span className="ml-1.5 text-xs text-stone-400">
              ({t === "todos" ? entries.length : entries.filter((e) => e.entity === t).length})
            </span>
          </button>
        ))}
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
                <th className="text-left px-4 py-2.5 font-medium">Acción</th>
                <th className="text-left px-4 py-2.5 font-medium">Registro</th>
                <th className="text-left px-4 py-2.5 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      "text-xs px-2 py-0.5 rounded font-medium",
                      ACTION_COLORS[entry.action] ?? "bg-stone-100 text-stone-600"
                    )}>
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-stone-700">
                    <span className="capitalize">{ENTITY_LABELS[entry.entity] ?? entry.entity}</span>
                    {entry.entity_id && (
                      <span className="ml-1.5 font-mono text-xs text-stone-400">#{entry.entity_id}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500 text-xs">
                    {entry.detail || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
