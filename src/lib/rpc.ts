import { invoke } from "@tauri-apps/api/core";
import { usePosModeStore } from "@/stores/posMode";

// Comandos de "piso de venta": si esta caja está en modo cliente y se quedó
// sin conexión, además de ejecutarse local se ENCOLAN para reproducirlos
// contra el servidor apenas vuelva la red (ver `enqueue_sync_op` /
// `sync_worker.rs` en el backend). Cubre justo lo que hace falta para
// "seguir vendiendo" sin wifi.
//
// El resto de los comandos (catálogo, proveedores, ARCA, etc.) también se
// ejecutan contra la base local si no hay conexión -- así las lecturas
// siguen andando -- pero si son una ESCRITURA, esa escritura queda solo en
// esta caja: no se encola ni se sincroniza sola. Es una limitación conocida
// y aceptada para esta fase: fusionar catálogo/proveedores/etc. offline es
// un problema mucho más grande que "seguir vendiendo", y no era el pedido.
//
// Debe reflejar 1:1 la lista en `src-tauri/src/sync_worker.rs` (comentario
// cruzado en ambos archivos).
const OFFLINE_QUEUEABLE_COMMANDS = new Set([
  "create_sale", "cancel_sale",
  "create_return",
  "add_cash_movement", "open_cash_session", "close_cash_session",
  "adjust_stock",
  "create_client", "update_client", "register_client_payment",
  "create_quote", "update_quote_status",
]);

async function runOffline<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await invoke<T>(command, args);
  if (OFFLINE_QUEUEABLE_COMMANDS.has(command)) {
    invoke("enqueue_sync_op", { command, payload: args }).catch(console.error);
  }
  return result;
}

// Punto único de transporte para los comandos que ya existían como `invoke`
// directo. En modo standalone/servidor no cambia nada (sigue siendo Tauri
// local). En modo cliente, manda el comando por HTTP al servidor; si no hay
// conexión, cae a ejecutarlo local + encolarlo (solo si es de los de arriba
// — si no, el error de conexión sube tal cual).
export async function rpc<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { mode, serverAddr, syncStatus, setSyncStatus } = usePosModeStore.getState();

  if (mode !== "client" || !serverAddr) {
    return invoke<T>(command, args);
  }

  if (syncStatus === "offline") {
    return runOffline<T>(command, args);
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
    // Fallo de red real (timeout, servidor caído, sin wifi) -- pasamos a
    // offline de una, no hace falta esperar al próximo chequeo del backend.
    setSyncStatus("offline");
    return runOffline<T>(command, args);
  }

  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Error en la caja servidor.");
  return json.data as T;
}
