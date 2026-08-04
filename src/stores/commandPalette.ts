import { create } from "zustand";

// Estado global de la paleta de comandos (Ctrl+K) — separado en su propio store
// para que tanto el listener de teclado global como el botón "Buscar" del
// sidebar puedan abrirla, sin acoplar CommandPalette.tsx a Layout.tsx.
interface CommandPaletteState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
