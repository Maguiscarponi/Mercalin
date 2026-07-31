import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { CatalogImportProgress, CatalogImportResult } from "@/types";

// Estado del import de catálogo público, separado del modal que lo muestra:
// así el import sigue corriendo (y el usuario lo sigue viendo si vuelve a abrir
// el modal) sin importar a qué pantalla navegue mientras tanto.
interface CatalogImportState {
  running: boolean;
  progress: CatalogImportProgress | null;
  result: CatalogImportResult | null;
  errorMsg: string | null;
  startedAt: number | null;
  start: () => void;
  setProgress: (p: CatalogImportProgress) => void;
  finish: (r: CatalogImportResult) => void;
  fail: (msg: string) => void;
  dismissResult: () => void;
}

export const useCatalogImport = create<CatalogImportState>((set) => ({
  running: false,
  progress: null,
  result: null,
  errorMsg: null,
  startedAt: null,

  start: () => set({ running: true, progress: null, result: null, errorMsg: null, startedAt: Date.now() }),
  setProgress: (progress) => set({ progress }),
  finish: (result) => set({ running: false, result }),
  fail: (errorMsg) => set({ running: false, errorMsg }),
  dismissResult: () => set({ result: null, errorMsg: null }),
}));

let listenersReady = false;

/// Se llama una sola vez (desde Layout, que vive mientras haya sesión iniciada) para
/// que los eventos del import lleguen sin importar en qué pantalla esté el usuario.
export function ensureCatalogImportListeners() {
  if (listenersReady) return;
  listenersReady = true;

  listen<CatalogImportProgress>("catalog_import_progress", (e) => {
    useCatalogImport.getState().setProgress(e.payload);
  });

  // El backend puede terminar con "error" de dos formas bien distintas: no arrancó
  // nada (imported=0) o se cortó a mitad de camino con lo ya importado guardado
  // (imported>0). El modal decide cómo mostrarlo según el caso — acá solo guardamos
  // el resultado completo tal cual llega.
  listen<CatalogImportResult>("catalog_import_done", (e) => {
    useCatalogImport.getState().finish(e.payload);
  });
}
