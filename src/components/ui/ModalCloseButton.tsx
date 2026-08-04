import { X } from "lucide-react";

// Botón "×" consistente para la esquina de un modal — el contenedor de la
// tarjeta necesita `relative` para que se ancle a su esquina y no a la del
// viewport (ver auditoría UX: los modales solo se cerraban clickeando el fondo).
export default function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Cerrar (Esc)"
      className="absolute top-3 right-3 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-md w-7 h-7 flex items-center justify-center transition-colors"
    >
      <X size={16} />
    </button>
  );
}
