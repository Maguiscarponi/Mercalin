// La versión web se actualiza sola (es la misma para todos): no hay nada que
// descargar ni instalar.
export interface Update {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall: (cb?: (event: unknown) => void) => Promise<void>;
}
export async function check(): Promise<Update | null> {
  return null;
}
