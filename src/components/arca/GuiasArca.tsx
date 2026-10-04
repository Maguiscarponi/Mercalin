import { useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import type { CondicionIva } from "@/types";
import imgNuevaRelacion from "@/assets/ayuda-arca/relaciones-nueva-relacion.png";
import imgElegirArca from "@/assets/ayuda-arca/relaciones-elegir-arca.png";
import imgBuscarRepresentante from "@/assets/ayuda-arca/relaciones-buscar-representante.png";
import imgConfirmar from "@/assets/ayuda-arca/relaciones-confirmar.png";
import imgPaginaFinal from "@/assets/ayuda-arca/relaciones-pagina-final.png";
import imgCertificadoAlias from "@/assets/ayuda-arca/certificado-alias.png";
import imgPuntosVentaLista from "@/assets/ayuda-arca/puntos-venta-lista.png";
import imgPuntosVentaAlta from "@/assets/ayuda-arca/puntos-venta-alta.png";

// Guías de los trámites que hay que hacer en la página de ARCA. Están
// escritas para alguien que nunca usó ARCA y que casi no usa la computadora:
// cada paso es UNA sola acción, dice dónde mirar y qué vas a ver después.
// Salieron de configurar ARCA de verdad con un CUIT real (octubre 2026) --
// los nombres de botones y pantallas son los que mostró ARCA ese día. Las
// capturas son reales, con los datos personales reemplazados por inventados.

export const ARCA_PORTAL_URL = "https://auth.afip.gob.ar";

// Nombre exacto del "Sistema" que hay que elegir al crear el punto de venta.
export function sistemaPuntoVenta(condicionIva: CondicionIva | string | undefined): string {
  return condicionIva === "responsable_inscripto"
    ? "RECE para aplicativo y web services"
    : "Factura Electronica - Monotributo - Web Services";
}

// Captura a la vista (no escondida detrás de un botón): quien no sabe usar la
// compu no va a tocar "Ver imagen". Se agranda con un clic.
export function ImagenAyuda({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  useEscapeToClose(() => setOpen(false), open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block mt-3 text-left group" title="Hacé clic para verla más grande">
        <img src={src} alt={alt} className="max-h-60 max-w-full rounded border border-stone-300 group-hover:border-sky-400" />
        <span className="text-xs text-sky-700 mt-1 block">🔍 Hacé clic en la imagen para verla más grande. Lo marcado en rojo es donde tenés que tocar.</span>
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-6" onClick={() => setOpen(false)}>
          <div className="relative max-w-6xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 bg-white rounded-full w-8 h-8 shadow-lg text-lg leading-none hover:bg-stone-50"
            >
              ×
            </button>
            <img src={src} alt={alt} className="max-w-full max-h-[90vh] rounded-lg shadow-2xl border-4 border-white bg-white" />
          </div>
        </div>
      )}
    </>
  );
}

export function PasoGuia({ n, children, img, imgAlt }: { n: number; children: ReactNode; img?: string; imgAlt?: string }) {
  return (
    <div className="flex gap-3 items-start bg-white rounded-lg p-3 border border-amber-100">
      <span className="shrink-0 w-7 h-7 rounded-full bg-amber-200 text-amber-900 text-sm font-bold flex items-center justify-center mt-0.5">{n}</span>
      <div className="text-sm leading-relaxed text-stone-700 min-w-0">
        {children}
        {img && <ImagenAyuda src={img} alt={imgAlt || ""} />}
      </div>
    </div>
  );
}

// Texto que hay que escribir tal cual: se ve como una etiqueta y se copia con un clic.
function Escribir({ children }: { children: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(children); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
      title="Clic para copiar"
      className="inline-flex items-center gap-1 font-semibold text-stone-900 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-100"
    >
      {children} <span className="text-xs font-normal text-amber-700">{copiado ? "✓ copiado" : "📋"}</span>
    </button>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return <div className="text-sm text-stone-600 bg-sky-50 border border-sky-200 rounded p-3 leading-relaxed">{children}</div>;
}

function BotonAbrirArca() {
  return (
    <div>
      <button
        onClick={() => openUrl(ARCA_PORTAL_URL)}
        className="w-full text-left bg-white border border-amber-300 rounded px-3 py-2.5 text-amber-800 font-medium hover:bg-amber-100"
      >
        🔗 Abrir la página de ARCA
      </button>
      <div className="text-xs text-stone-400 mt-1">
        Si el botón no abre nada: abrí tu navegador de internet, escribí esta dirección arriba de todo y apretá la tecla Enter:{" "}
        <code className="select-all bg-white border border-stone-200 rounded px-1.5 py-0.5">{ARCA_PORTAL_URL}</code>
      </div>
    </div>
  );
}

// Los dos primeros pasos son iguales en los tres trámites.
function PasosParaEntrar({ servicio }: { servicio: string }) {
  return (
    <>
      <PasoGuia n={1}>
        Tocá el botón amarillo de arriba, <strong>"Abrir la página de ARCA"</strong>. Se abre en tu navegador de internet
        (el programa con el que entrás a las páginas: Chrome, Edge o parecido). <strong>No cierres Mercalin</strong>:
        queda abierto atrás y después volvés.
      </PasoGuia>
      <PasoGuia n={2}>
        La página te pide tu <strong>CUIT</strong>: escribilo sin guiones y tocá <strong>"Siguiente"</strong>. Después te
        pide tu <strong>Clave Fiscal</strong> (la contraseña con la que entrás siempre a ARCA): escribila y tocá{" "}
        <strong>"Ingresar"</strong>.
        <span className="block text-stone-500 mt-1">
          Si no tenés Clave Fiscal o no te la acordás, eso se arregla con ARCA (o con tu contador), no desde Mercalin.
        </span>
      </PasoGuia>
      <PasoGuia n={3}>
        Ya adentro, arriba de todo hay un renglón para escribir que tiene el dibujo de una lupa: es el buscador. Hacé un
        clic ahí y escribí <Escribir>{servicio}</Escribir>. Abajo aparece el nombre completo: hacele un clic. Se abre
        en una <strong>pestaña nueva</strong> del navegador (es normal).
      </PasoGuia>
    </>
  );
}

// Cuando el servicio no aparece en el buscador hay que sumarlo una vez.
function SiNoAparece({ servicio }: { servicio: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-sky-700 hover:underline">
        {open ? "▾" : "▸"} Lo escribí en el buscador y no me aparece
      </button>
      {open && (
        <div className="mt-2 bg-white border border-stone-200 rounded p-3 space-y-1.5 text-stone-600 leading-relaxed">
          <p>Quiere decir que todavía no lo tenés sumado a tu Clave Fiscal. Se suma una sola vez, así:</p>
          <p>1. En el buscador escribí <Escribir>Administrador de Relaciones de Clave Fiscal</Escribir> y entrá.</p>
          <p>2. Tocá el botón azul <strong>"ADHERIR SERVICIO"</strong> (el primero de los tres).</p>
          <p>3. Aparece una lista de botones grises con logos. Bajá hasta el que dice <strong>"ARCA"</strong> y hacele clic.</p>
          <p>4. Debajo se abren opciones. Tocá <strong>"Servicios Interactivos"</strong>.</p>
          <p>5. En la lista (está en orden alfabético) buscá <strong>"{servicio}"</strong> y hacele clic.</p>
          <p>6. Tocá <strong>"Confirmar"</strong>.</p>
          <p>7. Salí de ARCA (arriba a la derecha, "Salir") y volvé a entrar con tu CUIT y tu clave. Ahora sí aparece en el buscador.</p>
        </div>
      )}
    </div>
  );
}

function AvisoImagenes() {
  return (
    <p className="text-xs text-stone-500">
      Los nombres y números que se ven en las imágenes son de ejemplo. En tu pantalla vas a ver los tuyos.
    </p>
  );
}

// ── Paso 2: pedir el certificado ────────────────────────────────────────────

export function GuiaCertificado() {
  const servicio = "Administración de Certificados Digitales";
  return (
    <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <BotonAbrirArca />
      <PasosParaEntrar servicio={servicio} />
      <SiNoAparece servicio={servicio} />
      <PasoGuia n={4}>
        Si te muestra tu nombre (o una lista con tu nombre), hacé un clic sobre <strong>tu nombre</strong>. Si pasa
        directo a la pantalla siguiente, mejor: seguí.
      </PasoGuia>
      <PasoGuia n={5}>
        Tocá el botón <strong>"Agregar alias"</strong>. Un "alias" es solo un nombre para reconocer este permiso
        después.
      </PasoGuia>
      <PasoGuia n={6} img={imgCertificadoAlias} imgAlt="Pantalla de ARCA para agregar el alias y subir el archivo">
        Aparece una pantalla como la de la imagen. En el renglón <strong>"Alias"</strong> escribí{" "}
        <Escribir>mercalin</Escribir> — todo junto, en minúsculas, sin espacios ni acentos.{" "}
        <strong>Anotate ese nombre</strong>: lo vas a necesitar en el paso que sigue de Mercalin.
      </PasoGuia>
      <PasoGuia n={7}>
        Tocá el botón gris <strong>"Elegir archivo"</strong>. Se abre una ventana de Windows para buscar archivos. A la
        izquierda de esa ventana hacé clic en <strong>"Descargas"</strong>. Buscá el archivo que se llama{" "}
        <strong>mercalin.csr</strong> (puede verse solo como "mercalin"), hacele un clic y después tocá el botón{" "}
        <strong>"Abrir"</strong>.
        <span className="block text-stone-500 mt-1">
          Ese archivo es el que descargaste recién, en el punto 1 de esta pantalla. Si no lo encontrás, volvé a
          Mercalin y tocá otra vez "Descargar el archivo mercalin.csr".
        </span>
      </PasoGuia>
      <PasoGuia n={8}>
        Al lado de "Elegir archivo" ahora dice <strong>mercalin.csr</strong>. Tocá el botón azul{" "}
        <strong>"Agregar alias"</strong>.
      </PasoGuia>
      <PasoGuia n={9}>
        Vuelve a una lista donde ahora figura <strong>mercalin</strong>. En ese renglón, a la derecha, tocá{" "}
        <strong>"Ver"</strong>.
      </PasoGuia>
      <PasoGuia n={10}>
        Aparece un cuadro con los datos del certificado. A la derecha hay un botón o un dibujito para{" "}
        <strong>descargar</strong> (una flecha que apunta hacia abajo). Hacele clic. Se guarda un archivo en tu carpeta{" "}
        <strong>Descargas</strong>: su nombre termina en <strong>.crt</strong>. Ese archivo es tu certificado.
      </PasoGuia>
      <PasoGuia n={11}>
        Volvé a Mercalin: en la barra de abajo de la pantalla, hacé clic en el ícono rojo de Mercalin. Seguí con el
        punto <strong>3</strong>, acá abajo.
      </PasoGuia>
      <Aviso>
        <strong>Importante:</strong> después de descargar el archivo mercalin.csr, <strong>no vuelvas a tocar "Generar
        de nuevo"</strong>. Si lo tocás, el certificado que te da ARCA deja de servir y hay que empezar este paso otra vez.
      </Aviso>
      <AvisoImagenes />
    </div>
  );
}

// ── Trámite A: darle permiso a Mercalin para facturar ───────────────────────

export function GuiaAutorizacion() {
  return (
    <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <Aviso>
        <strong>¿Qué es esto?</strong> El certificado del paso 2 le dice a ARCA <em>quién</em> es Mercalin. Ahora falta
        decirle <em>para qué</em> lo puede usar: para hacer facturas a tu nombre. Se hace una sola vez.
        <span className="block mt-1">
          <strong>Para tu tranquilidad:</strong> esto solo <em>agrega</em> un permiso. No cambia nada de lo que ya hacés
          en ARCA. Si hoy facturás desde la página de ARCA, eso sigue exactamente igual.
        </span>
      </Aviso>
      <BotonAbrirArca />
      <PasosParaEntrar servicio="Administrador de Relaciones de Clave Fiscal" />
      <PasoGuia n={4} img={imgNuevaRelacion} imgAlt="Pantalla Administrador de Relaciones con el botón Nueva Relación marcado">
        Aparece una pantalla con <strong>tres botones azules</strong>, uno debajo del otro. Tocá el del medio:{" "}
        <strong>"Nueva Relación"</strong>.
        <span className="block text-stone-500 mt-1">
          Si antes te pregunta a quién representás, hacé clic en tu nombre.
        </span>
      </PasoGuia>
      <PasoGuia n={5}>
        Aparece un cuadro que dice <strong>"Incorporar nueva Relación"</strong>, con dos botones azules que dicen{" "}
        <strong>"BUSCAR"</strong>. Tocá <strong>el de arriba</strong>, el que está en el renglón "Servicio".
      </PasoGuia>
      <PasoGuia n={6} img={imgElegirArca} imgAlt="Lista de organismos con el botón ARCA marcado al final">
        Aparece una lista de botones grises con logos (ANAC, ANSES y otros). <strong>Bajá con la ruedita del mouse</strong>{" "}
        hasta encontrar el que dice <strong>"ARCA"</strong> y hacele clic.
      </PasoGuia>
      <PasoGuia n={7}>
        Debajo del botón ARCA se abren dos o tres opciones. Tocá la que dice <strong>"WebServices"</strong>.
      </PasoGuia>
      <PasoGuia n={8}>
        Se abre una lista larga, en orden alfabético. Buscá <strong>"Facturación Electrónica"</strong> y hacele clic.
        <span className="block mt-1">
          <strong>Truco para encontrarla rápido:</strong> mantené apretada la tecla <strong>Ctrl</strong> y tocá la
          letra <strong>F</strong>. Aparece un renglón chiquito para escribir: escribí <Escribir>Facturaci</Escribir> y
          el navegador te la pinta de color.
        </span>
        <span className="block mt-1 text-orange-700">
          Ojo: tiene que decir "Facturación Electrónica" a secas. No elijas las que dicen "Exportación", "Bonos
          Fiscales" u otras parecidas.
        </span>
      </PasoGuia>
      <PasoGuia n={9} img={imgBuscarRepresentante} imgAlt="Formulario con el servicio Facturación Electrónica ya elegido y el segundo botón Buscar marcado">
        Vuelve al cuadro de antes, y ahora en "Servicio" dice <strong>Facturación Electrónica</strong>. Tocá el otro
        botón <strong>"BUSCAR"</strong>: <strong>el de abajo</strong>, el del renglón "Representante".
      </PasoGuia>
      <PasoGuia n={10}>
        Aparece una ventanita que dice <strong>"Computador Fiscal"</strong>, con un renglón que tiene una flechita a la
        derecha. Hacé clic en la flechita y elegí el <strong>alias</strong> que creaste en el paso 2 (si seguiste esta
        guía, se llama <strong>mercalin</strong>). Si en esa ventanita hay un botón <strong>"Confirmar"</strong>, tocalo.
        <span className="block mt-1 text-orange-700">
          Si la lista está vacía, o en vez de una lista te pide escribir un CUIT, es que el certificado del paso 2 no
          quedó creado en ARCA. Volvé al paso 2 de Mercalin y hacelo de nuevo.
        </span>
      </PasoGuia>
      <PasoGuia n={11} img={imgConfirmar} imgAlt="Formulario completo con el botón Confirmar marcado">
        El cuadro tiene que quedar como el de la imagen: en "Servicio", <strong>Facturación Electrónica</strong>; en
        "Representante", <strong>Computador Fiscal identificado como mercalin</strong> (o el alias que hayas puesto). Si
        está así, tocá el botón azul <strong>"CONFIRMAR"</strong>.
      </PasoGuia>
      <PasoGuia n={12} img={imgPaginaFinal} imgAlt="Página casi en blanco que aparece después de confirmar">
        Aparece una página casi vacía, con unas letras como las de la imagen. <strong>Es normal y quiere decir que
        salió bien.</strong> No hace falta imprimir ni guardar nada: cerrá esa pestaña.
      </PasoGuia>
      <PasoGuia n={13}>
        <strong>Esperá 3 minutos</strong> (ARCA tarda un poco en tomar el permiso). Después volvé a Mercalin y tocá el
        botón rojo <strong>"Revisar mi configuración"</strong>.
      </PasoGuia>
      <AvisoImagenes />
    </div>
  );
}

// ── Trámite B: crear el punto de venta para Mercalin ────────────────────────

export function GuiaPuntoVenta({ condicionIva }: { condicionIva: CondicionIva | string | undefined }) {
  const servicio = "Administración de puntos de venta y domicilios";
  const sistema = sistemaPuntoVenta(condicionIva);
  return (
    <div className="text-sm text-stone-600 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <Aviso>
        <strong>¿Qué es un punto de venta?</strong> Es el número que va adelante en cada factura. Por ejemplo, en la
        factura <strong>0003</strong>-00000001 el punto de venta es el 3.
        <span className="block mt-1">
          ARCA pide que las facturas hechas desde un programa como Mercalin tengan <strong>un punto de venta propio</strong>,
          distinto del que se usa para facturar desde la página de ARCA. <strong>Ese no sirve</strong>, aunque ya lo tengas.
        </span>
        <span className="block mt-1">
          <strong>Para tu tranquilidad:</strong> crear uno nuevo no toca los que ya tenés. Siguen funcionando igual, con
          su propia numeración.
        </span>
      </Aviso>
      <BotonAbrirArca />
      <PasosParaEntrar servicio={servicio} />
      <SiNoAparece servicio={servicio} />
      <PasoGuia n={4}>
        Si te muestra tu nombre, hacé un clic sobre <strong>tu nombre</strong>.
      </PasoGuia>
      <PasoGuia n={5}>
        Tocá la opción <strong>"A/B/M de puntos de venta"</strong>.
      </PasoGuia>
      <PasoGuia n={6} img={imgPuntosVentaLista} imgAlt="Lista de puntos de venta con la columna Sistema marcada">
        Aparece una lista con los puntos de venta que ya tenés (puede estar vacía). Mirá la columna{" "}
        <strong>"Sistema"</strong> de cada renglón:
        <span className="block mt-1">
          • Si alguno dice <strong>"Web Services"</strong>: ya lo tenés. Anotá el número de la columna "Número" de ese
          renglón y <strong>saltá al paso 11</strong>.
        </span>
        <span className="block mt-1">
          • Si dicen otra cosa ("Factura en Línea", "Remito Electrónico", "Controlador Fiscal"…), <strong>no sirven
          para Mercalin</strong>. Seguí con el paso 7.
        </span>
      </PasoGuia>
      <PasoGuia n={7}>
        Fijate cuál es el número más alto de la columna <strong>"Número"</strong>. El punto de venta nuevo va a ser{" "}
        <strong>el número que le sigue</strong>. Ejemplo: si tenés el 1 y el 2, el nuevo es el 3. Si la lista está
        vacía, el nuevo es el 1.
      </PasoGuia>
      <PasoGuia n={8}>
        Debajo de la lista hay un botón que dice <strong>"Agregar..."</strong>. Bajá con la ruedita del mouse si no lo
        ves, y hacele clic.
      </PasoGuia>
      <PasoGuia n={9} img={imgPuntosVentaAlta} imgAlt="Formulario de alta de punto de venta con el campo Sistema marcado">
        Se abre un cuadro para completar. Llenalo así, de arriba para abajo:
        <span className="block mt-1">• <strong>Número:</strong> el que calculaste en el paso 7.</span>
        <span className="block mt-1">• <strong>Nombre Fantasía:</strong> escribí <Escribir>Mercalin</Escribir>.</span>
        <span className="block mt-1">• <strong>Dominio Asociado:</strong> dejalo vacío, no escribas nada.</span>
        <span className="block mt-1">
          • <strong>Sistema:</strong> hacé clic en la flechita y elegí exactamente <strong>"{sistema}"</strong>. Este es
          el renglón más importante.
        </span>
        <span className="block mt-1">• <strong>Nuevo domicilio:</strong> hacé clic en la flechita y elegí tu domicilio.</span>
        <span className="block mt-1">• <strong>Actividad:</strong> si aparece, elegí la tuya.</span>
        <span className="block mt-1 text-orange-700">
          Ojo con "Sistema": no elijas los que dicen "CAEA", "Contingencias" ni "Factura en Línea". Con esos Mercalin no
          puede facturar.
        </span>
      </PasoGuia>
      <PasoGuia n={10}>
        Tocá <strong>"Aceptar"</strong>. Si te pide confirmar, tocá <strong>"Sí"</strong> o{" "}
        <strong>"Aceptar"</strong>. En la lista tiene que aparecer un renglón nuevo con tu número.
      </PasoGuia>
      <PasoGuia n={11}>
        Volvé a Mercalin (clic en el ícono rojo de Mercalin, en la barra de abajo de la pantalla). Acá abajo, donde dice{" "}
        <strong>"Punto de venta que usa Mercalin"</strong>, poné ese número y tocá <strong>"Guardar"</strong>.
      </PasoGuia>
      <PasoGuia n={12}>
        <strong>Esperá 5 minutos</strong> (ARCA tarda en tomar un punto de venta recién creado) y tocá el botón rojo{" "}
        <strong>"Revisar mi configuración"</strong>.
      </PasoGuia>
      <AvisoImagenes />
    </div>
  );
}
