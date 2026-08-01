import { invoke } from "@tauri-apps/api/core";
import { usePosModeStore } from "@/stores/posMode";

// Punto único de transporte para los comandos que ya existían como `invoke`
// directo. En modo standalone/servidor no cambia nada (sigue siendo Tauri
// local). En modo cliente, manda el comando por HTTP al servidor en vez de
// ejecutarlo local — mismo nombre de comando y mismos argumentos que ya usa
// `invoke`, así que migrar cada método de `api.ts` es solo cambiar
// `invoke<T>(...)` por `rpc<T>(...)`.
//
// Nota: por ahora (Fase 2) no hay cola offline — si el servidor no responde
// en modo cliente, el error sube tal cual para que la pantalla lo muestre.
export async function rpc<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { mode, serverAddr } = usePosModeStore.getState();

  if (mode !== "client" || !serverAddr) {
    return invoke<T>(command, args);
  }

  let res: Response;
  try {
    res = await fetch(`http://${serverAddr}/api/rpc/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`Sin conexión con la caja servidor (${serverAddr}).`);
  }

  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Error en la caja servidor.");
  return json.data as T;
}
