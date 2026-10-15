// Versión web de `invoke` (@tauri-apps/api/core). En la app de escritorio,
// invoke llama a Rust adentro de la misma compu; acá manda el mismo comando
// al servidor, que corre exactamente la misma lógica (ver src-tauri/src/bin/web.rs).
// Igual que invoke, devuelve el resultado o rechaza con el mensaje de error.

export const SESSION_LOST_EVENT = "mercalin:sesion-terminada";
export const TRIAL_EXPIRED_EVENT = "mercalin:prueba-vencida";

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${command}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args ?? {}),
    });
  } catch {
    throw "No hay conexión a internet. Revisá la conexión y probá de nuevo.";
  }
  let json: { ok?: boolean; data?: T; error?: string; expired?: boolean } = {};
  try {
    json = await res.json();
  } catch {
    throw "El servidor no respondió bien. Probá de nuevo en un momento.";
  }
  if (res.status === 401) {
    window.dispatchEvent(new Event(SESSION_LOST_EVENT));
  }
  if (res.status === 402 || json.expired) {
    window.dispatchEvent(new Event(TRIAL_EXPIRED_EVENT));
  }
  if (!json.ok) throw json.error ?? "Error desconocido";
  return json.data as T;
}
