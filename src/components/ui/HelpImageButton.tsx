import { useState } from "react";
import { useEscapeToClose } from "@/lib/useEscapeToClose";

// Botón chico que abre una captura de referencia en grande (modal), en vez de
// incrustar la imagen directo en medio del texto de ayuda -- así no ensucia
// la pantalla para quien no la necesita, pero está ahí para quien sí.
export default function HelpImageButton({ src, alt, label = "Ver imagen" }: { src: string; alt: string; label?: string }) {
  const [open, setOpen] = useState(false);
  useEscapeToClose(() => setOpen(false), open);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded px-2 py-1"
      >
        🖼️ {label}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-6" onClick={() => setOpen(false)}>
          <div className="relative max-w-5xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 bg-white rounded-full w-8 h-8 shadow-lg text-lg leading-none hover:bg-stone-50"
            >
              ×
            </button>
            <img src={src} alt={alt} className="max-w-full max-h-[90vh] rounded-lg shadow-2xl border-4 border-white" />
          </div>
        </div>
      )}
    </>
  );
}
