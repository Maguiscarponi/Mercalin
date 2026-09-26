import type { Update } from "@tauri-apps/plugin-updater";
import { useUpdaterStore } from "@/stores/updater";
import { Download, RefreshCw } from "lucide-react";

// Reemplaza el flujo viejo (Configuración → Sistema → botón "Actualizar",
// que después de un rato saltaba directo a la ventana del instalador de
// Windows sin avisar nada): ahora esto aparece solo al entrar si hay una
// versión nueva, con "Más tarde" / "Actualizar ahora", y el progreso de la
// descarga se ve acá mismo, en el estilo de la app -- no en otra ventana.
//
// Lo que NO se puede evitar: Windows no deja reemplazar los archivos de un
// programa mientras está corriendo, así que en el paso final el instalador
// (en modo "passive", ya configurado en tauri.conf.json -- es la opción menos
// invasiva que ofrece Tauri) tiene que abrir su propia ventana chica un
// instante para hacer el cambio y reabrir la app sola. Por eso el mensaje de
// "instalando" lo avisa de antemano, para que no se sienta como que se rompió.
export default function UpdateModal({ update, onDismiss }: { update: Update; onDismiss: () => void }) {
  const { installing, progress, error, install } = useUpdaterStore();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
            <Download size={18} className="text-red-600" />
          </div>
          <h2 className="font-semibold text-stone-800">Hay una actualización disponible</h2>
        </div>
        <p className="text-sm text-stone-500 ml-[46px] -mt-1">
          Versión <span className="font-mono">{update.version}</span>
        </p>

        {update.body && !installing && (
          <div className="mt-4 bg-stone-50 border border-stone-200 rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-stone-500 uppercase mb-1">Qué trae esta versión</p>
            <p className="text-sm text-stone-700 whitespace-pre-line">{update.body}</p>
          </div>
        )}

        {!installing && !error && (
          <div className="flex gap-2 mt-5">
            <button onClick={onDismiss} className="btn btn-secondary flex-1">Más tarde</button>
            <button onClick={() => install()} className="btn btn-primary flex-1">Actualizar ahora</button>
          </div>
        )}

        {installing && (
          <div className="mt-5">
            <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-600 rounded-full transition-all duration-300"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
            <p className="text-sm text-stone-600 mt-2.5 flex items-center gap-1.5">
              <RefreshCw size={13} className="animate-spin shrink-0" />
              {progress != null && progress < 100
                ? `Descargando… ${progress}%`
                : "Instalando y reiniciando…"}
            </p>
            <p className="text-xs text-stone-400 mt-2">
              Puede aparecer un instante una ventanita de Windows haciendo la instalación — es normal, no la cierres.
              La app se reabre sola cuando termina.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-5">
            <p className="text-sm text-orange-600">No se pudo actualizar: {error}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={onDismiss} className="btn btn-secondary flex-1">Cerrar</button>
              <button onClick={() => install()} className="btn btn-primary flex-1">Reintentar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
