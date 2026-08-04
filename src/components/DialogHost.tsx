import { useEffect } from "react";
import clsx from "clsx";
import { useDialogsStore } from "@/stores/dialogs";

// Se monta una sola vez (en Layout) y renderiza cualquier confirmación o
// toast pedido desde cualquier pantalla vía confirmAction()/showToast() —
// ver src/stores/dialogs.ts.
export default function DialogHost() {
  const confirmQueue = useDialogsStore((s) => s.confirmQueue);
  const toasts = useDialogsStore((s) => s.toasts);
  const resolveConfirm = useDialogsStore((s) => s.resolveConfirm);
  const dismissToast = useDialogsStore((s) => s.dismissToast);
  const current = confirmQueue[0];

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismissToast]);

  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resolveConfirm(current!.id, false);
      if (e.key === "Enter") resolveConfirm(current!.id, true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, resolveConfirm]);

  return (
    <>
      {current && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] motion-safe:animate-fade-in"
          onClick={() => resolveConfirm(current.id, false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-[420px] p-6 motion-safe:animate-pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-stone-900 mb-2">{current.title ?? "¿Confirmás esta acción?"}</h3>
            <p className="text-sm text-stone-600 mb-6">{current.message}</p>
            <div className="flex gap-2">
              <button className="btn btn-secondary flex-1" onClick={() => resolveConfirm(current.id, false)}>
                Cancelar
              </button>
              <button
                autoFocus
                className={clsx("btn flex-1", current.danger ? "btn-danger" : "btn-primary")}
                onClick={() => resolveConfirm(current.id, true)}
              >
                {current.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto rounded-lg shadow-lg px-4 py-3 text-sm flex items-center gap-4 min-w-[260px] max-w-sm motion-safe:animate-fade-in",
              t.tone === "danger" ? "bg-red-600 text-white" : t.tone === "success" ? "bg-emerald-600 text-white" : "bg-stone-900 text-white"
            )}
          >
            <span className="flex-1">{t.message}</span>
            {t.actionLabel && (
              <button
                className="font-semibold underline underline-offset-2 shrink-0 hover:opacity-80"
                onClick={() => { t.onAction?.(); dismissToast(t.id); }}
              >
                {t.actionLabel}
              </button>
            )}
            <button
              className="shrink-0 opacity-60 hover:opacity-100 text-lg leading-none"
              onClick={() => dismissToast(t.id)}
              title="Cerrar"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
