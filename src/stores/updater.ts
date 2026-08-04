import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Chequeo de actualizaciones: consulta el "latest.json" que se publica junto con
// cada release en GitHub (ver .github/workflows/release.yml). No hay servidor propio
// ni backend nuevo -- es el mecanismo oficial de Tauri, firmado con una clave propia
// para que la app nunca instale algo que no vino realmente de esta cuenta.
interface UpdaterState {
  checking: boolean;
  update: Update | null;
  installing: boolean;
  progress: number | null; // 0-100, null mientras no se sabe el total
  error: string | null;
  lastCheckedAt: number | null;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  checking: false,
  update: null,
  installing: false,
  progress: null,
  error: null,
  lastCheckedAt: null,

  checkNow: async () => {
    set({ checking: true, error: null });
    try {
      const update = await check();
      set({ update: update?.available ? update : null, checking: false, lastCheckedAt: Date.now() });
    } catch (e) {
      set({ checking: false, error: e instanceof Error ? e.message : String(e), lastCheckedAt: Date.now() });
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ installing: true, progress: 0, error: null });
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          set({ progress: total > 0 ? Math.round((downloaded / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (e) {
      set({ installing: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
