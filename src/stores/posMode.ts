import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeviceConfig, PosMode } from "@/types";

export type SyncStatus = "online" | "offline" | "syncing";

interface PosModeState {
  mode: PosMode;
  serverAddr: string | null;
  syncStatus: SyncStatus;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyDeviceConfig: (config: DeviceConfig) => void;
  setSyncStatus: (s: SyncStatus) => void;
}

// Modo de ESTE equipo para multicaja (standalone/servidor/cliente). Se
// hidrata una sola vez al arrancar la app desde `device_config.json` (ver
// `src-tauri/src/commands/device.rs`) — vive fuera de la base SQLite a
// propósito, para sobrevivir al reemplazo completo de la base cuando una
// caja se conecta como cliente. `syncStatus` solo importa en modo cliente:
// lo actualiza el hilo de fondo del backend (`sync_worker.rs`) vía el evento
// "sync_status_changed", y `rpc.ts` también lo puede pasar a "offline" al
// toque si un fetch falla, sin esperar al próximo chequeo del backend.
export const usePosModeStore = create<PosModeState>((set) => ({
  mode: "standalone",
  serverAddr: null,
  syncStatus: "online",
  hydrated: false,
  hydrate: async () => {
    try {
      const config = await invoke<DeviceConfig>("get_device_config");
      const syncStatus = config.mode === "client"
        ? await invoke<SyncStatus>("get_sync_status").catch(() => "offline" as SyncStatus)
        : "online";
      set({ mode: config.mode, serverAddr: config.serverAddr, syncStatus, hydrated: true });
    } catch (e) {
      console.error("No se pudo leer el modo de este equipo:", e);
      set({ hydrated: true });
    }
  },
  applyDeviceConfig: (config) => set({ mode: config.mode, serverAddr: config.serverAddr }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}));

let listenerReady = false;

// Se llama una sola vez (desde Layout, que vive mientras haya sesión
// iniciada) para que los cambios de estado de sincronización lleguen sin
// importar en qué pantalla esté el usuario.
export function ensureSyncStatusListener() {
  if (listenerReady) return;
  listenerReady = true;

  listen<SyncStatus>("sync_status_changed", (e) => {
    usePosModeStore.getState().setSyncStatus(e.payload);
  });
}
