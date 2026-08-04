import { create } from "zustand";

// Reemplaza confirm()/alert() nativos del navegador (bloqueantes, sin marca,
// sin poder mostrar contexto) por un diálogo propio y por toasts con acción
// de deshacer — ver Hallazgo 01 de la auditoría UX. confirmAction() tiene la
// misma forma que confirm() (devuelve si el usuario aceptó) para que migrar
// cada call site sea mecánico: `if (!confirm(msg))` → `if (!(await confirmAction(msg)))`.

export interface ConfirmRequest {
  id: number;
  message: string;
  title?: string;
  danger?: boolean;
  confirmLabel?: string;
  resolve: (v: boolean) => void;
}

export interface ToastItem {
  id: number;
  message: string;
  tone?: "default" | "success" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}

interface DialogsState {
  confirmQueue: ConfirmRequest[];
  toasts: ToastItem[];
  pushConfirm: (req: Omit<ConfirmRequest, "id">) => void;
  resolveConfirm: (id: number, v: boolean) => void;
  pushToast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: number) => void;
}

let counter = 0;

export const useDialogsStore = create<DialogsState>((set, get) => ({
  confirmQueue: [],
  toasts: [],
  pushConfirm: (req) => set((s) => ({ confirmQueue: [...s.confirmQueue, { ...req, id: ++counter }] })),
  resolveConfirm: (id, v) => {
    get().confirmQueue.find((c) => c.id === id)?.resolve(v);
    set((s) => ({ confirmQueue: s.confirmQueue.filter((c) => c.id !== id) }));
  },
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++counter }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Reemplazo de window.confirm(): resuelve `true`/`false` según lo que elija el usuario. */
export function confirmAction(
  message: string,
  opts?: { title?: string; danger?: boolean; confirmLabel?: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogsStore.getState().pushConfirm({ message, resolve, ...opts });
  });
}

/** Reemplazo de alert() para avisos de éxito/error breves, con acción opcional (ej. "Deshacer"). */
export function showToast(t: {
  message: string;
  tone?: ToastItem["tone"];
  actionLabel?: string;
  onAction?: () => void;
}) {
  useDialogsStore.getState().pushToast(t);
}
