import { useState } from "react";
import { HelpCircle } from "lucide-react";
import clsx from "clsx";
import { helpContent, helpAccent } from "@/lib/helpContent";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { useHelpEnabledStore } from "@/stores/helpEnabled";
import { confirmAction } from "@/stores/dialogs";

// Solo el modal, sin botón propio -- lo usan tanto HelpButton (abajo, para el
// caso normal) como Layout.tsx (para poner el disparador en la barra roja de
// Caja, con estilo blanco/translúcido en vez del circulito de color).
export function HelpModalContent({
  module, open, onClose,
}: { module: string; open: boolean; onClose: () => void }) {
  const enabled = useHelpEnabledStore((s) => s.enabled);
  const content = helpContent[module];
  const accent = helpAccent[module] ?? helpAccent.caja;
  useEscapeToClose(onClose, open);
  if (!content || !enabled) return null;

  async function handleDisableForever() {
    const ok = await confirmAction(
      "Vas a ocultar el botón de ayuda en todas las pantallas. Podés reactivarlo cuando quieras desde Configuración → Sistema.",
      { title: "¿Apagar los botones de ayuda?", danger: true, confirmLabel: "Apagar" }
    );
    if (!ok) return;
    await useHelpEnabledStore.getState().setEnabled(false);
    onClose();
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="flex items-start gap-3 p-6 border-b border-stone-200">
              <div className={clsx("shrink-0 w-10 h-10 rounded-full flex items-center justify-center", accent.badge)}>
                <HelpCircle size={20} strokeWidth={2.25} className={accent.badgeIcon} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-stone-900">{content.title}</h2>
                <p className="text-sm text-stone-500 mt-1 leading-relaxed">{content.intro}</p>
              </div>
              <button
                onClick={onClose}
                className="ml-2 shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-400 hover:text-stone-600 text-xl leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {/* Contenido scrollable */}
            <div className="overflow-y-auto flex-1 p-6 space-y-6">
              {content.sections.map((section) => (
                <div key={section.title}>
                  <h3 className={clsx("text-xs font-bold uppercase tracking-wider mb-3", accent.sectionTitle)}>
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <div
                        key={item.label}
                        className="flex gap-3 bg-stone-50 rounded-xl p-4 border border-stone-100"
                      >
                        <div className={clsx("shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center", accent.badge)}>
                          <span className={clsx("text-xs font-bold", accent.badgeIcon)}>→</span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-stone-800 leading-snug">
                            {item.label}
                          </div>
                          <div className="text-sm text-stone-500 mt-1 leading-relaxed">
                            {item.description}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Pie */}
            <div className="p-4 border-t border-stone-200 flex items-center justify-between gap-3">
              <button
                onClick={handleDisableForever}
                className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors"
              >
                Apagar los botones de ayuda
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-sm transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Devuelve true si a este módulo le corresponde mostrar el botón de ayuda
// ahora mismo (existe contenido escrito Y el interruptor general está
// prendido) -- lo usa Layout.tsx para decidir si dibuja su propio disparador
// en la barra de Caja.
export function useShowHelpButton(module: string): boolean {
  const enabled = useHelpEnabledStore((s) => s.enabled);
  return enabled && !!helpContent[module];
}

// Botón chico e inline (no flotante) para poner al lado del título de cada
// módulo -- así nunca tapa contenido ni botones de acción de la pantalla.
export default function HelpButton({ module }: { module: string }) {
  const [open, setOpen] = useState(false);
  const show = useShowHelpButton(module);
  const accent = helpAccent[module] ?? helpAccent.caja;
  if (!show) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={clsx(
          "inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors shrink-0",
          accent.button
        )}
        title="Ayuda de este módulo"
      >
        <HelpCircle size={16} strokeWidth={2.25} />
      </button>
      <HelpModalContent module={module} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
