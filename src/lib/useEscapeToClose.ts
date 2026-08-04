import { useEffect } from "react";

// Cierra un modal con Escape. Antes la única forma de cerrar la mayoría de los
// modales era clickear el fondo oscuro — sin atajo de teclado ni botón visible,
// algo que un usuario nuevo (o alguien acostumbrado a otros sistemas) no
// descubre solo. `active` evita que un modal ya cerrado (o detrás de otro que
// se abrió encima) siga escuchando Escape.
export function useEscapeToClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose]);
}
