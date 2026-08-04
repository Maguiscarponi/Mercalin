import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Search } from "lucide-react";
import { NAV_GROUPS, hasAccess } from "@/lib/navigation";
import { useAuthStore } from "@/stores/auth";
import { usePosModeStore } from "@/stores/posMode";
import { useCommandPaletteStore } from "@/stores/commandPalette";
import type { UserRole } from "@/types";

// Paleta de comandos tipo Linear/Notion (Ctrl+K o Cmd+K): reusa NAV_GROUPS, la misma
// fuente de verdad que ya filtra el sidebar por rol y por modo cliente, para no
// mostrar ni permitir ir a una pantalla a la que el usuario no tiene acceso.
export default function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useAuthStore((s) => s.user);
  const userRole = (user?.role as UserRole) ?? "cajero";
  const posModeMode = usePosModeStore((s) => s.mode);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    return NAV_GROUPS.flatMap((g) =>
      g.links
        .filter((l) => hasAccess(userRole, l.minRole) && (!l.serverOnly || posModeMode !== "client"))
        .map((l) => ({ to: l.to, label: l.label, group: g.label, icon: l.icon, key: l.key }))
    );
  }, [userRole, posModeMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => { setIndex(0); }, [filtered.length]);

  function go(i: number) {
    const item = filtered[i];
    if (!item) return;
    navigate(item.to);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[60vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-stone-100">
          <Search size={15} className="text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(index); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
            }}
            placeholder="Ir a…"
            className="flex-1 py-3 text-sm outline-none"
          />
        </div>
        <div className="overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-stone-400">Sin resultados</div>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.to}
                  onClick={() => go(i)}
                  onMouseEnter={() => setIndex(i)}
                  className={clsx(
                    "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors",
                    i === index ? "bg-indigo-50 text-indigo-700" : "text-stone-700"
                  )}
                >
                  <Icon size={15} className={i === index ? "text-indigo-600" : "text-stone-400"} />
                  <span className="font-medium">{item.label}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {item.key && (
                      <span className="text-[10px] font-mono text-stone-300 border border-stone-200 rounded px-1 py-0.5">{item.key}</span>
                    )}
                    <span className="text-[10px] text-stone-400 uppercase tracking-wide">{item.group}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-stone-100 px-4 py-2 text-[10px] text-stone-400 flex items-center gap-3">
          <span>↑↓ navegar</span><span>Enter ir</span><span>Esc cerrar</span>
        </div>
      </div>
    </div>
  );
}
