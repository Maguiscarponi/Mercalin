// En el navegador no se puede frenar el cierre de la pestaña con un diálogo
// propio, así que el aviso de "te quedó la caja abierta" no aplica.
type CloseEvent = { preventDefault: () => void };
export function getCurrentWindow() {
  return {
    async onCloseRequested(_handler: (event: CloseEvent) => void | Promise<void>): Promise<() => void> {
      return () => {};
    },
    async destroy(): Promise<void> {},
    async close(): Promise<void> {},
  };
}
