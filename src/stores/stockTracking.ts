import { create } from "zustand";
import { api } from "@/lib/api";

// Flag global: negocios que no quieren cargar/contar stock pueden apagarlo acá
// y todo el sistema (alertas, dashboard, etiquetas, caja, proveedores) deja de
// avisar o bloquear por stock. El backend ya hace lo mismo del lado de las
// consultas (list_low_stock, create_sale, etc. via stock_tracking_enabled en
// db.rs) — este store es solo para que el frontend sepa si ocultar sus propios
// highlights/warnings inline, que no pasan por esas consultas.
interface StockTrackingState {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
}

export const useStockTrackingStore = create<StockTrackingState>((set) => ({
  enabled: true,
  hydrated: false,

  hydrate: async () => {
    try {
      const v = await api.getConfig("stock_tracking_enabled");
      set({ enabled: v !== "0", hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setEnabled: async (v: boolean) => {
    set({ enabled: v });
    await api.setConfig({ key: "stock_tracking_enabled", value: v ? "1" : "0" });
  },
}));
