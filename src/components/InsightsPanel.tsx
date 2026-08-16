import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import type { Insight } from "@/types";

// Compartido entre el Dashboard (tarjeta "Consejo del día") y el ícono de
// notificaciones del sidebar (visible desde cualquier pantalla, no solo el
// Dashboard) — una sola fuente para el estilo y el modal de detalle.

export const LEVEL_STYLE: Record<Insight["level"], string> = {
  urgente:   "border-l-4 border-red-500 bg-red-50",
  importante:"border-l-4 border-amber-400 bg-amber-50",
  consejo:   "border-l-4 border-indigo-400 bg-indigo-50",
  info:      "border-l-4 border-stone-300 bg-stone-50",
};

export const LEVEL_DOT: Record<Insight["level"], string> = {
  urgente:   "bg-red-500",
  importante:"bg-amber-400",
  consejo:   "bg-indigo-500",
  info:      "bg-stone-400",
};

export const LEVEL_LABEL: Record<Insight["level"], string> = {
  urgente:   "URGENTE",
  importante:"IMPORTANTE",
  consejo:   "CONSEJO",
  info:      "INFO",
};

// Badge compacto (para el ícono de campana) — el color sigue el nivel más
// alto presente, así de un vistazo se nota si hay algo urgente esperando.
const BADGE_CLASS: Record<Insight["level"], string> = {
  urgente:   "bg-red-100 text-red-700",
  importante:"bg-amber-100 text-amber-700",
  consejo:   "bg-indigo-100 text-indigo-700",
  info:      "bg-stone-200 text-stone-600",
};

export function highestInsightLevel(insights: Insight[]): Insight["level"] | null {
  if (insights.length === 0) return null;
  if (insights.some((i) => i.level === "urgente")) return "urgente";
  if (insights.some((i) => i.level === "importante")) return "importante";
  if (insights.some((i) => i.level === "consejo")) return "consejo";
  return "info";
}

export function insightBadgeClass(insights: Insight[]): string {
  const level = highestInsightLevel(insights);
  return level ? BADGE_CLASS[level] : BADGE_CLASS.info;
}

export function InsightRow({ ins, onNavigate }: { ins: Insight; onNavigate: (route: string) => void }) {
  return (
    <div className={clsx("rounded-lg px-3 py-2.5 flex items-start gap-3", LEVEL_STYLE[ins.level])}>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <div className={clsx("w-2 h-2 rounded-full shrink-0", LEVEL_DOT[ins.level])} />
        <span className={clsx(
          "text-[9px] font-bold tracking-widest",
          ins.level === "urgente" ? "text-red-600" :
          ins.level === "importante" ? "text-amber-600" :
          ins.level === "consejo" ? "text-indigo-600" : "text-stone-500"
        )}>
          {LEVEL_LABEL[ins.level]}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-stone-800">{ins.message}</div>
        {ins.detail && <div className="text-[10px] text-stone-500 mt-0.5">{ins.detail}</div>}
      </div>
      {ins.route && ins.action && (
        <button
          onClick={() => onNavigate(ins.route!)}
          className="flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0 mt-0.5"
        >
          {ins.action} <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function AllInsightsModal({
  insights, onClose, onNavigate,
}: {
  insights: Insight[]; onClose: () => void; onNavigate: (route: string) => void;
}) {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
          <h2 className="text-sm font-semibold text-stone-800">Consejo del día ({insights.length})</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2">
          {insights.length === 0 ? (
            <div className="text-center py-8 text-xs text-stone-400">No hay consejos activos por ahora.</div>
          ) : (
            insights.map((ins) => (
              <InsightRow key={ins.id} ins={ins} onNavigate={(route) => { onNavigate(route); onClose(); }} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
