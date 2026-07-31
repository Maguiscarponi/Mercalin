import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";

type StepId = "producto" | "venta" | "reporte";

const STEPS: { id: StepId; title: string; desc: string; icon: string; to: string; cta: string }[] = [
  { id: "producto", title: "Crear tu primer producto", desc: "Agregá algo a tu catálogo", icon: "📦", to: "/productos", cta: "Ir a Productos" },
  { id: "venta", title: "Hacer tu primera venta", desc: "Usá la Caja para cobrar", icon: "🛒", to: "/caja", cta: "Ir a Caja" },
  { id: "reporte", title: "Ver tu primer reporte", desc: "Revisá cómo te fue", icon: "📊", to: "/reportes", cta: "Ir a Reportes" },
];

const DISMISS_KEY = "onboarding_dismissed";
const VISITED_REPORTES_KEY = "onboarding_visited_reportes";

export default function OnboardingChecklist({ hasProducts, hasSales }: { hasProducts: boolean; hasSales: boolean }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "true");
  const [collapsed, setCollapsed] = useState(false);
  const [visitedReportes, setVisitedReportes] = useState(() => localStorage.getItem(VISITED_REPORTES_KEY) === "true");

  // Por si el usuario visita Reportes en otra pestaña/ventana mientras el dashboard sigue abierto.
  useEffect(() => {
    const onFocus = () => setVisitedReportes(localStorage.getItem(VISITED_REPORTES_KEY) === "true");
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const done: Record<StepId, boolean> = { producto: hasProducts, venta: hasSales, reporte: visitedReportes };
  const doneCount = STEPS.filter((s) => done[s.id]).length;
  const allDone = doneCount === STEPS.length;
  const nextIdx = STEPS.findIndex((s) => !done[s.id]);
  const pct = Math.round((doneCount / STEPS.length) * 100);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(dismiss, 3000);
    return () => clearTimeout(t);
  }, [allDone]);

  if (dismissed) return null;

  return (
    <div className="card overflow-hidden animate-fade-in border-indigo-100">
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{allDone ? "🎉" : "🚀"}</span>
          <div>
            <div className="text-sm font-semibold text-stone-800">
              {allDone ? "¡Listo! Ya diste los primeros pasos" : "Primeros pasos"}
            </div>
            <div className="text-xs text-stone-500">{doneCount} de {STEPS.length} completados</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-indigo-600 tabular w-9 text-right">{pct}%</span>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-stone-400 hover:text-stone-600 w-7 h-7 flex items-center justify-center rounded-md hover:bg-white transition-colors"
            title={collapsed ? "Expandir" : "Colapsar"}
          >
            {collapsed ? "▾" : "▴"}
          </button>
          <button
            onClick={dismiss}
            className="text-stone-400 hover:text-red-500 w-7 h-7 flex items-center justify-center rounded-md hover:bg-white transition-colors"
            title="Ocultar"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="divide-y divide-stone-100">
          {STEPS.map((step, i) => {
            const isDone = done[step.id];
            const isNext = i === nextIdx;
            return (
              <div
                key={step.id}
                className={clsx(
                  "flex items-center justify-between gap-3 px-5 py-3 transition-colors",
                  isNext && "bg-indigo-50/60"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0 w-8 h-8">
                    {isNext && !isDone && (
                      <span className="absolute inset-0 rounded-full bg-indigo-400 motion-safe:animate-ping opacity-40" />
                    )}
                    <div
                      className={clsx(
                        "relative w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-300",
                        isDone
                          ? "bg-emerald-100 text-emerald-600 animate-pop-in"
                          : isNext
                          ? "bg-indigo-100 text-indigo-600 motion-safe:animate-heartbeat"
                          : "bg-stone-100 text-stone-400"
                      )}
                    >
                      {isDone ? "✓" : step.icon}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className={clsx("text-sm font-medium truncate", isDone ? "text-stone-400 line-through" : "text-stone-800")}>
                      {step.title}
                    </div>
                    <div className="text-xs text-stone-400 truncate">{step.desc}</div>
                  </div>
                </div>
                {!isDone && isNext && (
                  <button
                    onClick={() => navigate(step.to)}
                    className="btn btn-primary text-xs px-3 py-1.5 shrink-0"
                  >
                    {step.cta} →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="h-1 bg-stone-100">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function markReportesVisited() {
  localStorage.setItem(VISITED_REPORTES_KEY, "true");
}
