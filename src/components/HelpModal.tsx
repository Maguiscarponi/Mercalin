import { useState } from "react";
import { helpContent } from "@/lib/helpContent";

export default function HelpButton({ module }: { module: string }) {
  const [open, setOpen] = useState(false);
  const content = helpContent[module];
  if (!content) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg transition-colors"
        title="Abrir ayuda de este módulo"
      >
        <span className="text-base leading-none">?</span>
        Ayuda
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between p-6 border-b border-stone-200">
              <div>
                <h2 className="text-xl font-bold text-stone-900">{content.title}</h2>
                <p className="text-sm text-stone-500 mt-1 leading-relaxed">{content.intro}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-4 shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100 text-stone-400 hover:text-stone-600 text-xl leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {/* Contenido scrollable */}
            <div className="overflow-y-auto flex-1 p-6 space-y-6">
              {content.sections.map((section) => (
                <div key={section.title}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-3">
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {section.items.map((item) => (
                      <div
                        key={item.label}
                        className="flex gap-3 bg-stone-50 rounded-xl p-4 border border-stone-100"
                      >
                        <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                          <span className="text-indigo-600 text-xs font-bold">→</span>
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
            <div className="p-4 border-t border-stone-200">
              <button
                onClick={() => setOpen(false)}
                className="w-full py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-sm transition-colors"
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
