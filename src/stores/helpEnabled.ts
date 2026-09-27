import { create } from "zustand";
import { api } from "@/lib/api";

// Interruptor global de los botones de ayuda por módulo -- un comercio con
// años de uso los puede apagar de una desde el propio modal de ayuda, y
// reactivarlos cuando quiera desde Configuración.
interface HelpEnabledState {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
}

export const useHelpEnabledStore = create<HelpEnabledState>((set) => ({
  enabled: true,
  hydrated: false,

  hydrate: async () => {
    try {
      const v = await api.getConfig("help_buttons_enabled");
      set({ enabled: v !== "0", hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setEnabled: async (v: boolean) => {
    set({ enabled: v });
    await api.setConfig({ key: "help_buttons_enabled", value: v ? "1" : "0" });
  },
}));
