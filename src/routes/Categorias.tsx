import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { CategoryStat } from "@/types";
import { confirmAction, showToast } from "@/stores/dialogs";
import clsx from "clsx";

type Tab = "categorias" | "marcas";

export default function Categorias() {
  const [tab, setTab] = useState<Tab>("categorias");

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h1 className="text-xl font-semibold">Categorías y marcas</h1>

      <div className="flex gap-1 border-b border-stone-200">
        {([
          { id: "categorias", label: "Categorías" },
          { id: "marcas", label: "Marcas" },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-stone-500 hover:text-stone-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "categorias" ? <CategoriasTab /> : <MarcasTab />}
    </div>
  );
}

// ─── Categorías ─────────────────────────────────────────────────────────────
function CategoriasTab() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { setCategories(await api.listCategories()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) { setCreating(false); return; }
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showToast({ message: `Ya existe la categoría "${name}"`, tone: "danger" });
      return;
    }
    setSaving(true);
    try {
      await api.createCategory(name);
      setCreating(false);
      setCreateName("");
      load();
      showToast({ message: `Categoría "${name}" creada`, tone: "success" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo crear la categoría", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

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
      showToast({ message: "No se pudo renombrar la categoría", tone: "danger" });
    } finally {
      setSavingRename(false);
    }
  }

  async function handleDelete(name: string) {
    const ok = await confirmAction("Los productos de esta categoría quedarán sin categoría.", { title: `¿Eliminar la categoría "${name}"?`, danger: true, confirmLabel: "Eliminar" });
    if (!ok) return;
    try {
      await api.deleteCategory(name);
      load();
      showToast({ message: `Categoría "${name}" eliminada` });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo eliminar la categoría", tone: "danger" });
    }
  }

  function startRename(name: string) {
    setRenamingName(name);
    setNewName(name);
  }

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-stone-400">
          {categories.length} {categories.length === 1 ? "categoría" : "categorías"}
        </span>
        <button
          onClick={() => { setCreating(true); setCreateName(""); }}
          className="btn btn-primary text-sm"
        >
          + Nueva categoría
        </button>
      </div>

      <div className="card flex-1 overflow-y-auto">
        {creating && (
          <div className="flex gap-2 items-center px-4 py-3 border-b border-stone-100 bg-indigo-50/40">
            <input
              autoFocus
              className="input h-8 text-sm w-56"
              placeholder="Nombre de la categoría"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <button
              onClick={handleCreate}
              disabled={saving}
              className={clsx("btn btn-primary text-xs h-8 px-3", saving && "opacity-50")}
            >
              {saving ? "…" : "Crear"}
            </button>
            <button onClick={() => setCreating(false)} className="btn btn-secondary text-xs h-8 px-3">
              Cancelar
            </button>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">Cargando…</div>
        )}
        {!loading && categories.length === 0 && !creating && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            No hay categorías. Creá una con el botón de arriba, o asignala a un producto desde Productos.
          </div>
        )}
        {!loading && categories.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Categoría</th>
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
                    ) : cat.name === "(sin categoria)" ? (
                      <span className="font-medium text-stone-500">{cat.name}</span>
                    ) : (
                      <button
                        onClick={() => navigate(`/productos?category=${encodeURIComponent(cat.name)}`)}
                        className="font-medium text-stone-800 hover:text-indigo-600 hover:underline text-left"
                        title="Ver productos de esta categoría"
                      >
                        {cat.name}
                        {cat.product_count === 0 && (
                          <span className="ml-2 text-[10px] text-stone-400 font-normal">vacía</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-stone-500">
                    {cat.product_count}
                  </td>
                  <td className="px-4 py-3">
                    {renamingName !== cat.name && cat.name !== "(sin categoria)" && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => navigate(`/productos?category=${encodeURIComponent(cat.name)}`)} className="btn-table-neutral">Ver productos</button>
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
    </div>
  );
}

// ─── Marcas ─────────────────────────────────────────────────────────────────
// A diferencia de categorías, marca no tiene tabla propia (no se puede "precrear"
// una marca vacía) -- solo existen las que ya están en uso, y acá se pueden
// renombrar/consolidar duplicados (ej. "coca cola" vs "Coca-Cola").
function MarcasTab() {
  const navigate = useNavigate();
  const [brands, setBrands] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  async function load() {
    setLoading(true);
    try { setBrands(await api.listBrands()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleRename(oldName: string) {
    if (!newName.trim() || newName.trim() === oldName) { setRenamingName(null); return; }
    setSavingRename(true);
    try {
      await api.renameBrand(oldName, newName.trim());
      setRenamingName(null);
      setNewName("");
      load();
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo renombrar la marca", tone: "danger" });
    } finally {
      setSavingRename(false);
    }
  }

  async function handleDelete(name: string) {
    const ok = await confirmAction("Los productos de esta marca quedarán sin marca.", { title: `¿Eliminar la marca "${name}"?`, danger: true, confirmLabel: "Eliminar" });
    if (!ok) return;
    try {
      await api.deleteBrand(name);
      load();
      showToast({ message: `Marca "${name}" eliminada` });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo eliminar la marca", tone: "danger" });
    }
  }

  function startRename(name: string) {
    setRenamingName(name);
    setNewName(name);
  }

  return (
    <div className="flex-1 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-end">
        <span className="text-xs text-stone-400">
          {brands.length} {brands.length === 1 ? "marca" : "marcas"}
        </span>
      </div>

      <div className="card flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">Cargando…</div>
        )}
        {!loading && brands.length === 0 && (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            No hay marcas todavía. Se crean solas al escribir una nueva marca en un producto.
          </div>
        )}
        {!loading && brands.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Marca</th>
                <th className="text-right px-4 py-2.5 font-medium">Productos</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.name} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    {renamingName === b.name ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          className="input h-8 text-sm w-56"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(b.name);
                            if (e.key === "Escape") setRenamingName(null);
                          }}
                        />
                        <button
                          onClick={() => handleRename(b.name)}
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
                      <button
                        onClick={() => navigate(`/productos?brand=${encodeURIComponent(b.name)}`)}
                        className="font-medium text-stone-800 hover:text-indigo-600 hover:underline text-left"
                        title="Ver productos de esta marca"
                      >
                        {b.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-stone-500">
                    {b.product_count}
                  </td>
                  <td className="px-4 py-3">
                    {renamingName !== b.name && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => navigate(`/productos?brand=${encodeURIComponent(b.name)}`)} className="btn-table-neutral">Ver productos</button>
                        <button onClick={() => startRename(b.name)} className="btn-table-neutral">Renombrar</button>
                        <button onClick={() => handleDelete(b.name)} className="btn-table-danger">Eliminar</button>
                      </div>
                    )}
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
