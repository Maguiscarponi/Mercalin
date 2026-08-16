import { create } from "zustand";
import { api } from "@/lib/api";
import type { Insight } from "@/types";

// Una sola fuente para los "consejos del día" (insights.rs) — la usan tanto
// la tarjeta del Dashboard como el ícono de notificaciones del sidebar, que
// necesita saber si hay consejos activos sin depender de que la dueña haya
// entrado al Dashboard esa sesión.
interface InsightsState {
  insights: Insight[];
  hydrated: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useInsightsStore = create<InsightsState>((set, get) => ({
  insights: [],
  hydrated: false,
  loading: false,

  hydrate: async () => {
    if (get().hydrated) return;
    await get().refresh();
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const insights = await api.getInsights();
      set({ insights, hydrated: true, loading: false });
    } catch (e) {
      console.error("insights:", e);
      set({ hydrated: true, loading: false });
    }
  },
}));
