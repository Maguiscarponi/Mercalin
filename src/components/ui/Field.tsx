import type { ReactNode } from "react";

// Antes este componente estaba copiado y pegado, idéntico, en 6 archivos
// distintos (Clientes, Configuracion, Productos, Promociones, Proveedores,
// Usuarios) — corregirlo significaba acordarse de tocar los 6 a mano.
export default function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}
