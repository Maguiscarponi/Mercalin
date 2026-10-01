import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import type { Product, Promotion } from "@/types";
import clsx from "clsx";

// Cartel de una promoción para pegar en la góndola o en la vidriera, armado
// directo desde Promociones: así la promo no queda solo guardada en el sistema,
// el cliente la ve en el local. Blanco y negro nada más, igual que Etiquetas:
// los fondos de color casi nunca salen en la impresora.

type Formato = "hoja" | "media" | "gondola";

const FORMATOS: Record<Formato, { label: string; sub: string; wMm: number; hMm: number }> = {
  hoja:    { label: "Hoja entera", sub: "1 por hoja A4", wMm: 190, hMm: 275 },
  media:   { label: "Media hoja",  sub: "2 por hoja A4", wMm: 190, hMm: 134 },
  gondola: { label: "Etiqueta",    sub: "70×32 mm, para el estante", wMm: 70, hMm: 32 },
};

const DIAS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function listaConY(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

interface Contenido {
  titulo: string;           // "2×1", "20%", "$500"
  bajada: string;           // "LLEVÁ 2, PAGÁ 1", "DE DESCUENTO"
  etiquetaObjetivo: string | null; // "EN TODA LA CATEGORÍA"
  objetivo: string;         // nombre del producto / categoría / "EN TODO EL LOCAL"
  precio: { prefijo: string; antes: string | null; ahora: string } | null;
  condiciones: string | null;
  vigencia: string | null;
}

// Mismas cuentas que hace Caja al cobrar (ver promoDiscountPct en Caja.tsx):
// el % y el monto fijo son por unidad, y 2×1 / 3×2 regalan una de cada 2 / 3.
function armarContenido(promo: Promotion, product: Product | null): Contenido {
  const titulo =
    promo.promo_type === "pct" ? `${promo.value}%` :
    promo.promo_type === "fixed" ? centsToARS(promo.value) :
    promo.promo_type === "2x1" ? "2×1" : "3×2";
  const bajada =
    promo.promo_type === "2x1" ? "LLEVÁ 2, PAGÁ 1" :
    promo.promo_type === "3x2" ? "LLEVÁ 3, PAGÁ 2" : "DE DESCUENTO";

  let etiquetaObjetivo: string | null = null;
  let objetivo: string;
  if (promo.applies_to === "all") objetivo = "EN TODO EL LOCAL";
  else if (promo.applies_to === "category") { etiquetaObjetivo = "EN TODA LA CATEGORÍA"; objetivo = promo.target_name || ""; }
  else objetivo = product?.name || promo.target_name || "";

  let precio: Contenido["precio"] = null;
  const p = promo.applies_to === "product" ? product?.price_cents ?? 0 : 0;
  if (p > 0 && product) {
    const unidad = product.is_weighable ? `/${product.unit || "kg"}` : "";
    if (promo.promo_type === "pct") {
      const pct = Math.min(100, Math.max(0, promo.value));
      precio = { prefijo: "AHORA", antes: centsToARS(p) + unidad, ahora: centsToARS(Math.round((p * (100 - pct)) / 100)) + unidad };
    } else if (promo.promo_type === "fixed") {
      precio = { prefijo: "AHORA", antes: centsToARS(p) + unidad, ahora: centsToARS(Math.max(0, p - promo.value)) + unidad };
    } else if (!product.is_weighable) {
      const lleva = promo.promo_type === "2x1" ? 2 : 3;
      precio = { prefijo: `LLEVÁS ${lleva} POR`, antes: centsToARS(p * lleva), ahora: centsToARS(p * (lleva - 1)) };
    }
  }

  const partes: string[] = [];
  const minimoPropio = promo.promo_type === "2x1" ? 2 : promo.promo_type === "3x2" ? 3 : 1;
  if (promo.min_qty && promo.min_qty > minimoPropio) partes.push(`Llevando ${promo.min_qty} o más`);
  if (promo.days_of_week) {
    try {
      const dias: number[] = JSON.parse(promo.days_of_week);
      if (dias.length > 0 && dias.length < 7) partes.push(`Solo los ${listaConY([...dias].sort().map((d) => DIAS[d]))}`);
    } catch { /* condición mal guardada: no se muestra */ }
  }
  if (promo.time_start && promo.time_end) partes.push(`de ${promo.time_start} a ${promo.time_end} h`);
  else if (promo.time_start) partes.push(`desde las ${promo.time_start} h`);
  else if (promo.time_end) partes.push(`hasta las ${promo.time_end} h`);

  const vigencia =
    promo.starts_at && promo.ends_at ? `Del ${fechaCorta(promo.starts_at)} al ${fechaCorta(promo.ends_at)}` :
    promo.ends_at ? `Válido hasta el ${fechaCorta(promo.ends_at)}` :
    promo.starts_at ? `Desde el ${fechaCorta(promo.starts_at)}` : null;

  return { titulo, bajada, etiquetaObjetivo, objetivo, precio, condiciones: partes.length ? partes.join(" · ") : null, vigencia };
}

// Tamaño de letra (en mm) para que un texto de una línea entre en `anchoMm`
// sin pasarse de `maxMm`. 0.72 es lo que ocupa en promedio cada carácter
// de Arial Black en negrita, medido sobre números y signos.
function letraQueEntra(texto: string, anchoMm: number, maxMm: number): number {
  return Math.min(maxMm, anchoMm / (Math.max(1, texto.length) * 0.72));
}

export function buildCartelHtml(c: Contenido, formato: Formato, comercio: string): string {
  const { wMm, hMm } = FORMATOS[formato];
  const caja = `box-sizing:border-box;width:${wMm}mm;height:${hMm}mm;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;overflow:hidden;break-inside:avoid;page-break-inside:avoid;`;
  const negra = "font-family:'Arial Black',Arial,Helvetica,sans-serif;font-weight:900;";

  if (formato === "gondola") {
    const tituloMm = letraQueEntra(c.titulo, 22, 11);
    const ahoraMm = letraQueEntra(c.precio?.ahora ?? "", 40, 5.6);
    const pie = [c.condiciones, c.vigencia].filter(Boolean).join(" · ");
    return `<div style="${caja}border:0.5mm solid #000;padding:1.4mm 1.8mm;display:flex;align-items:center;gap:1.8mm">
      <div style="flex:0 0 24mm;text-align:center">
        <div style="${negra}font-size:${tituloMm}mm;line-height:1">${esc(c.titulo)}</div>
        <div style="font-weight:800;font-size:1.9mm;line-height:1.15;margin-top:0.6mm">${esc(c.bajada)}</div>
      </div>
      <div style="flex:1;min-width:0;align-self:stretch;border-left:0.35mm solid #000;padding-left:1.8mm;display:flex;flex-direction:column;justify-content:center;gap:0.5mm">
        ${c.etiquetaObjetivo ? `<div style="font-size:1.8mm;font-weight:700">${esc(c.etiquetaObjetivo)}</div>` : ""}
        <div style="font-size:2.7mm;font-weight:700;text-transform:uppercase;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word">${esc(c.objetivo)}</div>
        ${c.precio ? `<div style="line-height:1.05">
          ${c.precio.antes && c.precio.prefijo === "AHORA" ? `<span style="font-size:2.2mm;text-decoration:line-through">${esc(c.precio.antes)}</span> ` : ""}
          <span style="font-size:2mm;font-weight:700">${esc(c.precio.prefijo)}</span>
          <div style="${negra}font-size:${ahoraMm}mm">${esc(c.precio.ahora)}</div>
        </div>` : ""}
        ${pie ? `<div style="font-size:1.8mm;line-height:1.2">${esc(pie)}</div>` : ""}
      </div>
    </div>`;
  }

  // Hoja entera y media hoja: el mismo cartel, achicado a la mitad.
  const k = formato === "hoja" ? 1 : 0.5;
  const pad = 12 * k;
  const util = wMm - 2 * pad - 4 * k;
  const mm = (n: number) => `${+(n * k).toFixed(2)}mm`;
  const tituloMm = letraQueEntra(c.titulo, util, 62 * k);
  const ahoraMm = c.precio ? letraQueEntra(c.precio.ahora, util, 34 * k) : 0;
  return `<div style="${caja}border:${mm(2)} solid #000;padding:${pad}mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center">
    <div style="width:100%">
      <div style="${negra}font-size:${tituloMm}mm;line-height:1;letter-spacing:-0.02em;white-space:nowrap">${esc(c.titulo)}</div>
      <div style="font-weight:800;font-size:${mm(11)};letter-spacing:0.04em;margin-top:${mm(3)}">${esc(c.bajada)}</div>
    </div>
    <div style="width:100%;border-top:${mm(0.8)} solid #000;padding-top:${mm(6)}">
      ${c.etiquetaObjetivo ? `<div style="font-size:${mm(7)};font-weight:700;letter-spacing:0.05em">${esc(c.etiquetaObjetivo)}</div>` : ""}
      <div style="font-size:${mm(c.precio ? 15 : 24)};font-weight:700;text-transform:uppercase;line-height:1.12;display:-webkit-box;-webkit-line-clamp:${k === 1 ? 3 : 2};-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word">${esc(c.objetivo)}</div>
      ${c.precio ? `<div style="margin-top:${mm(6)}">
        ${c.precio.antes ? `<div style="font-size:${mm(10)}">Antes <span style="text-decoration:line-through">${esc(c.precio.antes)}</span></div>` : ""}
        <div style="font-size:${mm(10)};font-weight:700;margin-top:${mm(2)}">${esc(c.precio.prefijo)}</div>
        <div style="${negra}font-size:${ahoraMm}mm;line-height:1.05;white-space:nowrap">${esc(c.precio.ahora)}</div>
      </div>` : ""}
    </div>
    <div style="width:100%">
      ${c.condiciones ? `<div style="font-size:${mm(6.5)};font-weight:700">${esc(c.condiciones)}</div>` : ""}
      ${c.vigencia ? `<div style="font-size:${mm(6)};margin-top:${mm(1.5)}">${esc(c.vigencia)}</div>` : ""}
      ${comercio ? `<div style="font-size:${mm(5)};margin-top:${mm(4)};letter-spacing:0.06em;text-transform:uppercase">${esc(comercio)}</div>` : ""}
    </div>
  </div>`;
}

function hojaParaImprimir(pieza: string, formato: Formato, copias: number): string {
  const separacion = formato === "gondola" ? "2mm" : "5mm";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 10mm; }
  body { margin:0; background:white; }
  .grid { display:flex; flex-wrap:wrap; gap:${separacion}; }
</style></head><body>
<div class="grid">${Array.from({ length: copias }, () => pieza).join("")}</div>
</body></html>`;
}

const MM_A_PX = 96 / 25.4;

export default function CartelPromoModal({ promo, onClose }: { promo: Promotion; onClose: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [comercio, setComercio] = useState("");
  const [mostrarComercio, setMostrarComercio] = useState(true);
  const [formato, setFormato] = useState<Formato>("hoja");
  const [copias, setCopias] = useState(1);
  useEscapeToClose(onClose);

  useEffect(() => {
    if (promo.applies_to === "product" && promo.target_id) {
      api.getProduct(promo.target_id).then(setProduct).catch(() => setProduct(null));
    }
    api.getConfig("business_name").then((n) => { if (n) setComercio(n); }).catch(() => {});
  }, [promo.applies_to, promo.target_id]);

  const contenido = armarContenido(promo, product);
  const pieza = buildCartelHtml(contenido, formato, mostrarComercio ? comercio : "");

  function imprimir() {
    printHtml(hojaParaImprimir(pieza, formato, Math.max(1, Math.min(100, copias || 1))));
  }

  // Enter imprime, como en el resto de los modales de impresión.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); imprimir(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { wMm, hMm } = FORMATOS[formato];
  const escala = Math.min(330 / (wMm * MM_A_PX), 400 / (hMm * MM_A_PX), 2.2);
  const hoy = new Date().toISOString().slice(0, 10);
  const noVigente = !promo.active || (!!promo.ends_at && promo.ends_at < hoy);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[820px] max-w-[95vw] max-h-[92vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <h2 className="font-semibold text-lg">Cartel para la góndola</h2>
        <p className="text-sm text-stone-500 mb-5">{promo.name}</p>

        <div className="flex gap-6">
          <div className="w-[300px] shrink-0 space-y-4">
            <div>
              <span className="text-sm font-medium text-stone-600 block mb-1.5">Tamaño</span>
              <div className="space-y-1.5">
                {(Object.keys(FORMATOS) as Formato[]).map((f) => (
                  <button key={f} onClick={() => { setFormato(f); setCopias(f === "gondola" ? 4 : 1); }}
                    className={clsx("w-full text-left rounded-lg border-2 px-3 py-2 transition-colors",
                      formato === f ? "border-red-600 bg-red-50" : "border-stone-200 hover:border-stone-300")}>
                    <span className="text-sm font-semibold text-stone-800">{FORMATOS[f].label}</span>
                    <span className="text-xs text-stone-500 block">{FORMATOS[f].sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-stone-600 block mb-1">Cantidad</span>
              <input type="number" min="1" max="100" className="input tabular w-24" value={copias}
                onChange={(e) => setCopias(Number(e.target.value))} />
            </label>
            {comercio && (
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={mostrarComercio} onChange={(e) => setMostrarComercio(e.target.checked)} />
                Poner el nombre del comercio
              </label>
            )}
            {noVigente && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
                Ojo: esta promoción no está activa ahora, así que en Caja no se va a aplicar.
              </p>
            )}
          </div>

          <div className="flex-1 bg-stone-100 rounded-lg flex items-center justify-center p-4 min-h-[300px]">
            <div style={{ width: wMm * MM_A_PX * escala, height: hMm * MM_A_PX * escala }} className="relative shadow-md">
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{ transform: `scale(${escala})` }}
                dangerouslySetInnerHTML={{ __html: pieza }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar (Esc)</button>
          <button onClick={imprimir} className="btn btn-primary flex-1">🖨️ Imprimir (Enter)</button>
        </div>
      </div>
    </div>
  );
}
