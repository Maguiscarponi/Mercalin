import { useEffect, useState } from "react";

// Devuelve `value` recién después de que pasen `delayMs` sin que cambie —
// para no disparar una consulta a la API en cada tecla tipeada. Antes cada
// buscador reimplementaba esto a mano (o directamente no lo tenía, como
// Etiquetas.tsx) con distintos tiempos de espera.
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
