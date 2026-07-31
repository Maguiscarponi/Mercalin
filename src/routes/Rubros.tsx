import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CategoryStat } from "@/types";
import clsx from "clsx";

export default function Rubros() {
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  async function load() {
    setLoading(true);
    try { setCategories(await api.listCategories()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleRename(oldName: string) {
    if (!newName.trim() || newName.trim() === oldName) { setRenamingName(null); return; }
    setSavingRename(true);
    try {
      await api.renameCategory(oldName, newName.trim());
      setRenamingName(null);
      setNewName("");
      load();
    } catch (e) {
      console.error(e);
      alert("Error al renombrar");
    } finally {
      setSavingRename(false);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`¿Eliminar el rubro "${name}"? Los productos quedarán sin categoría.`)) return;
    try {
      await api.deleteCategory(name);
      load();
    } catch (e) {
      console.error(e);
      alert("Error al eliminar");
    }
  }

  function startRename(name: string) {
    setRenamingName(name);
    setNewName(name);
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rubros / Categorías</h1>
        <span className="text-xs text-stone-400">
          {categories.length} {categories.length === 1 ? "rubro" : "rubros"}
        </span>
      </div>

      <div className="card flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">Cargando…</div>
        )}
        {!loading && categories.length === 0 && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            No hay rubros. Asigná categorías a los productos para que aparezcan aquí.
          </div>
        )}
        {!loading && categories.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Rubro</th>
                <th className="text-right px-4 py-2.5 font-medium">Productos</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.name} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    {renamingName === cat.name ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          className="input h-8 text-sm w-56"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(cat.name);
                            if (e.key === "Escape") setRenamingName(null);
                          }}
                        />
                        <button
                          onClick={() => handleRename(cat.name)}
                          disabled={savingRename}
                          className={clsx("btn btn-primary text-xs h-8 px-3", savingRename && "opacity-50")}
                        >
                          {savingRename ? "…" : "Guardar"}
                        </button>
                        <button onClick={() => setRenamingName(null)} className="btn btn-secondary text-xs h-8 px-3">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <span className="font-medium">{cat.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-stone-500">
                    {cat.product_count}
                  </td>
                  <td className="px-4 py-3">
                    {renamingName !== cat.name && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => startRename(cat.name)} className="btn-table-neutral">Renombrar</button>
                        <button onClick={() => handleDelete(cat.name)} className="btn-table-danger">Eliminar</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4 bg-amber-50 border-amber-200">
        <p className="text-xs text-amber-800">
          <strong>Nota:</strong> Para agregar un rubro nuevo, asigná esa categoría a un producto desde la pantalla de Productos.
          Los rubros se crean automáticamente al usar un nombre de categoría nuevo.
        </p>
      </div>
    </div>
  );
}
