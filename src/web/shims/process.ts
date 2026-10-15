// "Reiniciar la app" en la web es recargar la página.
export async function relaunch(): Promise<void> {
  window.location.reload();
}
export async function exit(_code?: number): Promise<void> {}
