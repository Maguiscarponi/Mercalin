import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceConfig, PosMode } from "@/types";

interface PosModeState {
  mode: PosMode;
  serverAddr: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyDeviceConfig: (config: DeviceConfig) => void;
}

// Modo de ESTE equipo para multicaja (standalone/servidor/cliente). Se
// hidrata una sola vez al arrancar la app desde `device_config.json` (ver
// `src-tauri/src/commands/device.rs`) — vive fuera de la base SQLite a
// propósito, para sobrevivir al reemplazo completo de la base cuando una
// caja se conecta como cliente.
export const usePosModeStore = create<PosModeState>((set) => ({
  mode: "standalone",
  serverAddr: null,
  hydrated: false,
  hydrate: async () => {
    try {
      const config = await invoke<DeviceConfig>("get_device_config");
      set({ mode: config.mode, serverAddr: config.serverAddr, hydrated: true });
    } catch (e) {
      console.error("No se pudo leer el modo de este equipo:", e);
      set({ hydrated: true });
    }
  },
  applyDeviceConfig: (config) => set({ mode: config.mode, serverAddr: config.serverAddr }),
}));
