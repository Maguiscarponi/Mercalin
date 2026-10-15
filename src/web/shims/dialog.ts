// Elegir carpetas o archivos de la compu no aplica en la web (los backups
// viven en el servidor). Configuración oculta esas opciones en la web.
export async function open(_options?: unknown): Promise<string | string[] | null> {
  return null;
}
export async function save(_options?: unknown): Promise<string | null> {
  return null;
}
