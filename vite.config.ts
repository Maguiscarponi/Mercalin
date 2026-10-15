import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

// Tauri expone TAURI_DEV_HOST en mobile dev. Lo respetamos.
const host = process.env.TAURI_DEV_HOST;

// Versión web (`npm run dev:web` / `npm run build:web`): el mismo código de la
// app, pero cada módulo de Tauri se reemplaza por su equivalente de navegador
// (src/web/shims). La app de escritorio no cambia en nada.
const WEB_SHIMS: Record<string, string> = {
  "@tauri-apps/api/core": "core.ts",
  "@tauri-apps/api/event": "event.ts",
  "@tauri-apps/api/app": "app.ts",
  "@tauri-apps/api/window": "window.ts",
  "@tauri-apps/plugin-opener": "opener.ts",
  "@tauri-apps/plugin-process": "process.ts",
  "@tauri-apps/plugin-updater": "updater.ts",
  "@tauri-apps/plugin-dialog": "dialog.ts",
};

const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, "src-tauri/tauri.conf.json"), "utf8")).version;

// Servidor web local (cargo run ... --bin mercalin-web).
const WEB_API = process.env.MERCALIN_WEB_API || "http://127.0.0.1:8787";

export default defineConfig(async ({ mode }) => {
  const web = mode === "web";
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        ...(web
          ? Object.fromEntries(
              Object.entries(WEB_SHIMS).map(([mod, file]) => [mod, path.resolve(__dirname, "src/web/shims", file)]),
            )
          : {}),
      },
    },
    define: web ? { __APP_VERSION__: JSON.stringify(appVersion) } : {},
    build: web ? { outDir: "dist-web" } : {},
    clearScreen: false,
    server: web
      ? {
          port: 1430,
          strictPort: true,
          proxy: {
            "/api": { target: WEB_API, changeOrigin: false },
            "/entrar": { target: WEB_API, changeOrigin: false },
          },
        }
      : {
          port: 1420,
          strictPort: true,
          host: host || false,
          hmr: host
            ? {
                protocol: "ws",
                host,
                port: 1421,
              }
            : undefined,
          watch: {
            ignored: ["**/src-tauri/**"],
          },
        },
  };
});
