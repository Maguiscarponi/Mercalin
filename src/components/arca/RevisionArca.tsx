import { useRef, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { showToast } from "@/stores/dialogs";
import type { ArcaCheck, ArcaConfig, ArcaDiagnosis } from "@/types";
import { GuiaAutorizacion, GuiaPuntoVenta } from "@/components/arca/GuiasArca";

// Paso 3 del asistente de ARCA. En vez de un "Probar conexión" que solo dice
// si anduvo o no, revisa tres cosas por separado y muestra los pasos del
// trámite que falta. Los dos trámites (permiso y punto de venta) se hacen en
// la página de ARCA con clave fiscal: Mercalin no los puede hacer por nadie,
// pero sí puede decir cuál falta y guiar clic por clic.

const ICONO: Record<ArcaCheck["estado"], { simbolo: string; clase: string }> = {
  ok: { simbolo: "✓", clase: "bg-emerald-500 text-white" },
  falta: { simbolo: "✕", clase: "bg-red-600 text-white" },
  duda: { simbolo: "?", clase: "bg-amber-400 text-white" },
  sin_probar: { simbolo: "–", clase: "bg-stone-200 text-stone-500" },
};

function Renglon({ titulo, check, children }: { titulo: string; check: ArcaCheck; children?: React.ReactNode }) {
  const icono = ICONO[check.estado] ?? ICONO.sin_probar;
  return (
    <div className={clsx("flex gap-3 items-start rounded-lg border p-3",
      check.estado === "ok" ? "bg-emerald-50 border-emerald-200" :
      check.estado === "falta" ? "bg-red-50 border-red-200" :
      check.estado === "duda" ? "bg-amber-50 border-amber-200" : "bg-stone-50 border-stone-200")}>
      <span className={clsx("shrink-0 w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center mt-0.5", icono.clase)}>
        {icono.simbolo}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-stone-800">{titulo}</p>
        <p className="text-sm text-stone-600 leading-relaxed">{check.detalle}</p>
        {children}
      </div>
    </div>
  );
}

function Tramite({ letra, titulo, abierto, onToggle, estado, innerRef, children }: {
  letra: string; titulo: string; abierto: boolean; onToggle: () => void;
  estado: ArcaCheck["estado"] | null; innerRef: React.RefObject<HTMLDivElement>; children: React.ReactNode;
}) {
  return (
    <div ref={innerRef} className="border border-stone-200 rounded-lg overflow-hidden scroll-mt-4">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50 text-left">
        <span className="shrink-0 w-7 h-7 rounded-full bg-stone-800 text-white text-sm font-bold flex items-center justify-center">{letra}</span>
        <span className="flex-1 font-semibold text-stone-800">{titulo}</span>
        {estado === "ok" && <span className="text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">✓ Hecho</span>}
        {estado === "falta" && <span className="text-xs font-bold text-red-700 bg-red-100 rounded-full px-2 py-0.5">Falta</span>}
        <span className="text-sm text-sky-700">{abierto ? "Ocultar los pasos ▴" : "Ver los pasos ▾"}</span>
      </button>
      {abierto && <div className="p-4 border-t border-stone-200 bg-stone-50 space-y-4">{children}</div>}
    </div>
  );
}

export default function RevisionArca({ arcaConfig, puedeEditar, onRefresh, onPuntoVentaGuardado, onIrAPaso }: {
  arcaConfig: ArcaConfig;
  puedeEditar: boolean;
  onRefresh: () => void;
  onPuntoVentaGuardado: (pv: number) => void;
  onIrAPaso: (paso: 1 | 2) => void;
}) {
  const [diag, setDiag] = useState<ArcaDiagnosis | null>(null);
  const [revisando, setRevisando] = useState(false);
  // La primera vez (todavía sin permiso de ARCA) el Trámite A va abierto: es
  // lo primero que hay que hacer. Quien ya está facturando no necesita verlo.
  const [abiertoA, setAbiertoA] = useState(!arcaConfig.token_valid);
  const [abiertoB, setAbiertoB] = useState(false);
  const [pvTexto, setPvTexto] = useState(String(arcaConfig.punto_venta));
  const [guardandoPv, setGuardandoPv] = useState(false);
  const refA = useRef<HTMLDivElement>(null);
  const refB = useRef<HTMLDivElement>(null);
  const refResultado = useRef<HTMLDivElement>(null);

  async function revisar() {
    setRevisando(true);
    try {
      const d = await api.diagnoseArca();
      setDiag(d);
      setAbiertoA(d.autorizacion.estado === "falta" && d.autorizacion.codigo === "no_autorizado");
      setAbiertoB(d.punto_venta.codigo === "ninguno" || d.punto_venta.codigo === "sin_confirmar");
      onRefresh();
      setTimeout(() => refResultado.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      showToast({ message: `No se pudo revisar: ${e}`, tone: "danger" });
    } finally {
      setRevisando(false);
    }
  }

  async function guardarPuntoVenta(pv: number) {
    if (!Number.isInteger(pv) || pv < 1) {
      showToast({ message: "Escribí el número del punto de venta (por ejemplo: 3).", tone: "danger" });
      return;
    }
    setGuardandoPv(true);
    try {
      await api.setArcaPuntoVenta(pv);
      setPvTexto(String(pv));
      onPuntoVentaGuardado(pv);
      showToast({ message: `Listo: Mercalin va a facturar con el punto de venta ${pv}`, tone: "success" });
      await revisar();
    } catch (e) {
      showToast({ message: `Error: ${e}`, tone: "danger" });
    } finally {
      setGuardandoPv(false);
    }
  }

  function mostrar(ref: React.RefObject<HTMLDivElement>, abrir: (v: boolean) => void) {
    abrir(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const todoBien = !!diag && diag.certificado.estado === "ok" && diag.autorizacion.estado === "ok" && diag.punto_venta.estado === "ok";
  const pvActual = diag?.punto_venta_configurado || arcaConfig.punto_venta;
  const otrosQueSirven = (diag?.puntos_venta_ws ?? []).filter((n) => n !== pvActual);

  return (
    <div className="space-y-6">
      <div className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded p-4 leading-relaxed">
        <strong>Ya casi.</strong> Para terminar faltan <strong>dos trámites en la página de ARCA</strong>, que se hacen
        una sola vez: darle permiso a Mercalin (Trámite A) y crearle un punto de venta (Trámite B). Abajo están los
        pasos de cada uno, clic por clic.
        <span className="block mt-1">
          <strong>¿No sabés cuál te falta?</strong> Tocá el botón rojo: Mercalin revisa todo y te lo dice. Revisar no
          hace ninguna factura ni cambia nada en ARCA.
        </span>
      </div>

      <div ref={refResultado} className="scroll-mt-4 space-y-3">
        <button onClick={revisar} disabled={revisando} className="btn btn-primary w-full text-base py-3 disabled:opacity-60">
          {revisando ? "Revisando con ARCA… (puede tardar medio minuto)" : diag ? "Revisar otra vez" : "Revisar mi configuración"}
        </button>
        <p className="text-xs text-stone-400 text-center">Necesitás tener internet.</p>

        {diag && (
          <div className="space-y-2">
            <Renglon titulo="1. Certificado" check={diag.certificado}>
              {diag.certificado.estado === "falta" && (
                <button onClick={() => onIrAPaso(diag.certificado.codigo === "sin_datos" ? 1 : 2)} className="btn btn-secondary text-sm mt-2">
                  {diag.certificado.codigo === "sin_datos" ? "Ir al paso 1" : "Ir al paso 2"}
                </button>
              )}
            </Renglon>

            <Renglon titulo="2. Permiso de ARCA para facturar (Trámite A)" check={diag.autorizacion}>
              {diag.autorizacion.codigo === "no_autorizado" && (
                <button onClick={() => mostrar(refA, setAbiertoA)} className="btn btn-secondary text-sm mt-2">
                  Mostrame los pasos del Trámite A ↓
                </button>
              )}
              {["certificado_vencido", "certificado_ajeno", "certificado_no_coincide"].includes(diag.autorizacion.codigo) && (
                <button onClick={() => onIrAPaso(2)} className="btn btn-secondary text-sm mt-2">Ir al paso 2</button>
              )}
            </Renglon>

            <Renglon titulo="3. Punto de venta para Mercalin (Trámite B)" check={diag.punto_venta}>
              {otrosQueSirven.length > 0 && diag.punto_venta.estado !== "ok" && puedeEditar && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {otrosQueSirven.map((n) => (
                    <button key={n} onClick={() => guardarPuntoVenta(n)} disabled={guardandoPv} className="btn btn-primary text-sm disabled:opacity-60">
                      Usar el punto de venta {n}
                    </button>
                  ))}
                </div>
              )}
              {(diag.punto_venta.codigo === "ninguno" || diag.punto_venta.codigo === "sin_confirmar") && (
                <button onClick={() => mostrar(refB, setAbiertoB)} className="btn btn-secondary text-sm mt-2">
                  Mostrame los pasos del Trámite B ↓
                </button>
              )}
            </Renglon>

            {todoBien && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 leading-relaxed">
                <p className="text-base font-semibold">🎉 Todo listo: ya podés facturar desde Mercalin.</p>
                <p className="mt-1">
                  Las facturas que hagas desde ahora son <strong>reales</strong> y quedan en tu ARCA. Se hacen desde la
                  pestaña "Comprobantes" con el botón "+ Nueva factura", o al cobrar una venta en Caja.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Tramite letra="A" titulo="Darle permiso a Mercalin para facturar" abierto={abiertoA} onToggle={() => setAbiertoA((v) => !v)}
          estado={diag ? diag.autorizacion.estado : null} innerRef={refA}>
          <GuiaAutorizacion />
        </Tramite>

        <Tramite letra="B" titulo="Crear un punto de venta para Mercalin" abierto={abiertoB} onToggle={() => setAbiertoB((v) => !v)}
          estado={diag ? diag.punto_venta.estado : null} innerRef={refB}>
          <GuiaPuntoVenta condicionIva={arcaConfig.condicion_iva} />
        </Tramite>

        <div className="border border-stone-200 rounded-lg bg-white p-4">
          <p className="font-semibold text-stone-800">Punto de venta que usa Mercalin</p>
          <p className="text-sm text-stone-500 mb-3">
            Es el número del punto de venta de tipo "Web Services" (el del Trámite B). Hoy Mercalin usa el{" "}
            <strong className="text-stone-800">{pvActual}</strong>.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="input text-sm tabular w-28" type="number" min="1" max="99998"
              value={pvTexto} onChange={(e) => setPvTexto(e.target.value)} disabled={!puedeEditar}
              aria-label="Número del punto de venta"
            />
            <button onClick={() => guardarPuntoVenta(Number(pvTexto))} disabled={guardandoPv || !puedeEditar || Number(pvTexto) === pvActual}
              className="btn btn-primary text-sm disabled:opacity-50">
              {guardandoPv ? "Guardando…" : "Guardar"}
            </button>
          </div>
          {!puedeEditar && <p className="text-sm text-stone-400 mt-2">Solo un supervisor o el administrador puede cambiar esto.</p>}
        </div>
      </div>
    </div>
  );
}
