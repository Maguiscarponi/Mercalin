import { create } from "zustand";
import { api } from "@/lib/api";

// Flag global para negocios que no quieren la complejidad de armar combos —
// oculta el link de nav, el botón de combos en Caja y muestra el aviso en
// Combos.tsx en vez de la pantalla completa.
interface CombosEnabledState {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
}

export const useCombosEnabledStore = create<CombosEnabledState>((set) => ({
  enabled: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const v = await api.getConfig("combos_enabled");
      set({ enabled: v === "1", hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setEnabled: async (v: boolean) => {
    set({ enabled: v });
    await api.setConfig({ key: "combos_enabled", value: v ? "1" : "0" });
  },
}));
