// En la web no hay eventos de Rust hacia la pantalla (sincronización de
// cajas, importador del catálogo): listen no hace nada.
export type UnlistenFn = () => void;
export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}
export async function listen<T>(_event: string, _handler: (e: Event<T>) => void): Promise<UnlistenFn> {
  return () => {};
}
export async function emit(_event: string, _payload?: unknown): Promise<void> {}
