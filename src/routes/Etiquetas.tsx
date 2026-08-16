import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Maximize2 } from "lucide-react";
import { api } from "@/lib/api";
import { centsToARS } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import { useStockTrackingStore } from "@/stores/stockTracking";
import { useCombosEnabledStore } from "@/stores/combosEnabled";
import type { ComboWithItems, Product } from "@/types";

// Los combos no son productos, pero para reusar toda la lógica de plantillas/impresión
// (que ya está hecha y probada para Product) se los "disfraza" de producto con un id
// negativo — nunca choca con un id real de producto (que arranca en 1) — así el resto
// del módulo (selección, cantidad, preview, impresión) los trata exactamente igual.
function comboToLabelProduct(cw: ComboWithItems): Product {
  return {
    id: -cw.combo.id,
    barcode: cw.combo.barcode,
    name: cw.combo.name,
    price_cents: cw.combo.price_cents,
    price2_cents: cw.combo.price_cents,
    price3_cents: cw.combo.price_cents,
    cost_cents: cw.combo.cost_cents,
    stock: 1,
    min_stock: 0,
    category: "Combo",
    brand: null,
    is_weighable: false,
    active: cw.combo.active,
    is_ghost: false,
    supplier_id: null,
    expires_at: null,
    image_path: null,
    created_at: cw.combo.created_at,
    updated_at: cw.combo.updated_at,
  };
}

// ─── Tipos de plantilla ──────────────────────────────────────────────────────
type Template = "gondola" | "precio" | "completa" | "barcode";
type PaperSize = "a4" | "carta" | "termica58";
type FontScale = "chico" | "normal" | "grande";

interface TemplateConfig {
  label: string;
  wMm: number;
  hMm: number;
  description: string;
}

const TEMPLATES: Record<Template, TemplateConfig> = {
  gondola:  { label: "Góndola",          wMm: 65,  hMm: 26,  description: "Nombre, precio grande y barcode" },
  precio:   { label: "Precio",           wMm: 45,  hMm: 22,  description: "Precio destacado" },
  completa: { label: "Completa",         wMm: 65,  hMm: 34,  description: "Toda la información" },
  barcode:  { label: "Código de barras", wMm: 42,  hMm: 29,  description: "Hoja de códigos de barra" },
};

// Tamaños típicos de rollos de impresoras térmicas de etiquetas, para no tener
// que adivinar los milímetros exactos si no se conoce de memoria.
const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "30×20mm",  w: 30,  h: 20 },
  { label: "40×30mm",  w: 40,  h: 30 },
  { label: "50×25mm",  w: 50,  h: 25 },
  { label: "60×40mm",  w: 60,  h: 40 },
  { label: "65×26mm",  w: 65,  h: 26 },
  { label: "100×50mm", w: 100, h: 50 },
];

const FONT_SCALES: Record<FontScale, number> = { chico: 0.8, normal: 1, grande: 1.25 };

const PAPER_SIZES: Record<PaperSize, string> = {
  a4:       "A4",
  carta:    "Carta (Letter)",
  termica58: "Térmica 58mm",
};

// `weightKg` solo aplica a productos pesables: sin cargar, la etiqueta
// muestra el precio por kilo (cartel de góndola); cargado, muestra el peso
// de ESE paquete puntual (ej. una bolsa de pan de 560g) y el total calculado
// para ese peso — el mismo precio_cents de siempre, sin un campo nuevo en la
// base, porque para pesables ya representa "precio por kilo" por convención
// (ver WeighModal en Caja.tsx, que usa el mismo supuesto al cobrar).
interface LabelEntry { product: Product; qty: number; weightKg?: number }

// Único punto donde se decide cómo se ve el precio de un pesable: sin peso
// cargado es el cartel "$/kg" de góndola; con peso cargado es la etiqueta de
// un paquete ya pesado, con el total calculado y el precio por kilo como
// referencia chica. Se usa tanto en el preview React como en el HTML de
// impresión, para que nunca queden desincronizados.
function weighableDisplay(p: Product, priceCents: number, weightKg?: number) {
  if (!p.is_weighable) {
    return { priceStr: centsToARS(priceCents), weightStr: null as string | null, perKgStr: null as string | null };
  }
  if (weightKg && weightKg > 0) {
    const totalCents = Math.round(priceCents * weightKg);
    const grams = Math.round(weightKg * 1000);
    return {
      priceStr: centsToARS(totalCents),
      weightStr: grams < 1000 ? `${grams} g` : `${weightKg.toFixed(3)} kg`,
      perKgStr: `${centsToARS(priceCents)}/kg`,
    };
  }
  return { priceStr: `${centsToARS(priceCents)}/kg`, weightStr: null as string | null, perKgStr: null as string | null };
}

// ─── Generación de SVG con barcode ──────────────────────────────────────────
function buildBarcodeSVG(value: string, height = 28, showText = false): string {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, value, {
      format: "CODE128",
      width: 1,
      height,
      margin: 0,
      fontSize: showText ? 8 : 0,
      displayValue: showText,
      textMargin: showText ? 2 : 0,
      lineColor: "#000",
      background: "transparent",
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return "";
  }
}

// ─── Componente barcode React ────────────────────────────────────────────────
function BarcodeDisplay({ value, height = 28, showText = false }: { value: string; height?: number; showText?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width: 1,
        height,
        margin: 0,
        fontSize: showText ? 8 : 0,
        displayValue: showText,
        textMargin: showText ? 2 : 0,
        lineColor: "#000",
        background: "transparent",
      });
    } catch {}
  }, [value, height, showText]);
  return <svg ref={ref} style={{ maxWidth: "100%", display: "block" }} />;
}

// 1mm ≈ 3.7795px a 96dpi — el navegador ya convierte `mm` solo, esto es
// nada más para calcular cuánto hay que escalar la vista para que entre.
const MM_TO_PX = 3.7795;

// ─── Preview de una etiqueta (se reusa en el panel chico y en el modal grande) ─
function LabelPreviewCard({
  p, template, priceList, showExpiry, showCategory, showStoreName, storeName, extraText, fontScale, widthMm, heightMm, targetPx, extraBig, weightKg,
}: {
  p: Product; template: Template; priceList: "price1" | "price2" | "price3"; showExpiry: boolean;
  showCategory: boolean; showStoreName: boolean; storeName: string; extraText: string; fontScale: FontScale;
  widthMm: number; heightMm: number; targetPx: number; extraBig: boolean; weightKg?: number;
}) {
  const displayPrice = priceList === "price2" ? p.price2_cents : priceList === "price3" ? p.price3_cents : p.price_cents;
  const wd = weighableDisplay(p, displayPrice, weightKg);
  const category = showCategory ? (p.category || "") : "";
  const effectiveStoreName = showStoreName ? storeName : "";
  const meta = [category, showExpiry && p.expires_at ? `Vto: ${p.expires_at.slice(0, 10)}` : ""].filter(Boolean).join(" · ");
  const scale = FONT_SCALES[fontScale];
  const fs = (px: number) => ({ fontSize: `${(px * scale).toFixed(2)}px` });
  // Escala la etiqueta entera para que quepa en `targetPx` de ancho, sin importar
  // el tamaño en mm elegido — así una etiqueta de 30mm y una de 100mm se ven
  // igual de "grandes" en el preview, en vez de una gigante y otra minúscula.
  const naturalPx = widthMm * MM_TO_PX;
  const zoom = Math.min(targetPx / naturalPx, 4);
  const badge = extraText.trim() && !extraBig && (
    <div
      className="absolute top-px right-px border border-black text-black font-bold text-right bg-white"
      style={{ ...fs(7), maxWidth: "75%", overflowWrap: "break-word", padding: "0 3px", lineHeight: 1.3 }}
    >
      {extraText.trim()}
    </div>
  );
  const banner = extraText.trim() && extraBig && (
    <div
      className="text-black font-bold text-center uppercase tracking-wide whitespace-nowrap"
      style={{ ...fs(15), lineHeight: 1.3 }}
    >
      {extraText.trim()}
    </div>
  );

  return (
    <div style={{ zoom }}>
      <div
        style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, border: "1px dashed #aaa" }}
        className="relative bg-white overflow-hidden flex flex-col justify-between p-1.5 font-sans"
      >
        {badge}
        {banner}
        {template === "gondola" && (
          <>
            <div className="font-bold uppercase line-clamp-2 leading-tight tracking-tight" style={fs(8.5)}>{p.name}</div>
            <div className="font-bold text-center text-black leading-tight" style={fs(wd.weightStr ? 20 : 27)}>
              {wd.priceStr}
              {wd.weightStr && (
                <div className="font-semibold text-stone-500" style={fs(7.5)}>{wd.weightStr} · {wd.perKgStr}</div>
              )}
            </div>
            <div className="flex items-end justify-between gap-1">
              <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={18 * scale} />}</div>
              <div className="text-stone-400 text-right leading-tight shrink-0" style={fs(7)}>
                {meta}
                {meta && effectiveStoreName && <br />}
                {effectiveStoreName && <span className="opacity-60">{effectiveStoreName}</span>}
              </div>
            </div>
          </>
        )}
        {template === "precio" && (
          <>
            <div className="font-bold uppercase line-clamp-2 leading-tight" style={fs(8)}>{p.name}</div>
            <div className="font-bold text-center text-black leading-tight" style={fs(wd.weightStr ? 19 : 26)}>
              {wd.priceStr}
              {wd.weightStr && (
                <div className="font-semibold text-stone-500" style={fs(7)}>{wd.weightStr} · {wd.perKgStr}</div>
              )}
            </div>
            <div className="flex items-end justify-between gap-1">
              <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={18 * scale} />}</div>
              {meta && <div className="text-stone-400 text-right shrink-0" style={fs(7)}>{meta}</div>}
            </div>
          </>
        )}
        {template === "completa" && (
          <>
            <div className="flex justify-between items-start gap-1">
              <div className="flex-1 overflow-hidden">
                <div className="font-bold uppercase line-clamp-2 leading-tight" style={fs(9)}>{p.name}</div>
                {category && <div className="text-stone-400 uppercase" style={fs(7)}>{category}</div>}
                {effectiveStoreName && <div className="text-stone-300" style={fs(7)}>{effectiveStoreName}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-black leading-tight" style={fs(wd.weightStr ? 18 : 22)}>{wd.priceStr}</div>
                {wd.weightStr && <div className="text-stone-500 font-semibold" style={fs(7)}>{wd.weightStr} · {wd.perKgStr}</div>}
                {p.cost_cents > 0 && <div className="text-stone-400" style={fs(7.5)}>C: {centsToARS(p.cost_cents)}</div>}
              </div>
            </div>
            <div className="flex items-end gap-1">
              <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={18 * scale} />}</div>
              <div className="text-stone-400 text-right leading-tight" style={fs(7)}>
                {showExpiry && p.expires_at && <div>{p.expires_at.slice(0, 10)}</div>}
                {p.id > 0 && <div>Stock: {p.stock}</div>}
              </div>
            </div>
          </>
        )}
        {template === "barcode" && (
          <div className="flex flex-col items-center justify-between h-full py-1" style={{ border: "1px solid #ccc", borderStyle: "solid", margin: "-6px" }}>
            <div className="font-bold uppercase text-center line-clamp-2 leading-tight w-full px-1" style={fs(8.5)}>{p.name}</div>
            <div className="w-full px-2">{p.barcode && <BarcodeDisplay value={p.barcode} height={40 * scale} />}</div>
            <div className="font-mono text-center" style={fs(9)}>{p.barcode}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grilla de varias etiquetas (se reusa en el panel chico y en el modal) ───
type PreviewDisplayProps = Omit<Parameters<typeof LabelPreviewCard>[0], "p" | "targetPx">;

function LabelGrid({
  items, targetPx, onQtyChange, onRemove, onWeightChange, ...display
}: PreviewDisplayProps & {
  items: LabelEntry[];
  targetPx: number;
  onQtyChange: (id: number, qty: number) => void;
  onRemove: (p: Product) => void;
  onWeightChange: (id: number, weightKg: number | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4 content-start justify-center">
      {items.map(({ product: p, qty, weightKg }) => (
        <div key={p.id} className="flex flex-col items-center gap-1.5">
          <LabelPreviewCard p={p} targetPx={targetPx} weightKg={weightKg} {...display} />
          <p className="text-xs text-stone-400 truncate text-center" style={{ maxWidth: targetPx }}>{p.name}</p>
          {p.is_weighable && (
            <label className="flex items-center gap-1 text-[11px] text-stone-500" title="Al imprimir se genera un código de barras único para este peso — escanearlo en Caja carga el precio solo, sin volver a pesar.">
              Peso (kg):
              <input
                type="number"
                min={0}
                step="0.001"
                placeholder="0.000"
                className="input h-6 w-16 text-xs px-1"
                value={weightKg ?? ""}
                onChange={(e) => onWeightChange(p.id, e.target.value ? Number(e.target.value) : undefined)}
              />
            </label>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => onQtyChange(p.id, qty - 1)} className="w-6 h-6 border rounded text-sm hover:bg-stone-100">−</button>
            <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
            <button onClick={() => onQtyChange(p.id, qty + 1)} className="w-6 h-6 border rounded text-sm hover:bg-stone-100">+</button>
            <button onClick={() => onRemove(p)} title="Quitar de la selección" className="text-stone-400 hover:text-red-600 text-xs ml-1">×</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Modal de vista previa gigante, una etiqueta a la vez con carrusel ───────
function LabelGalleryModal({
  items, targetPx, onQtyChange, onRemove, onWeightChange, onClose, ...display
}: PreviewDisplayProps & {
  items: LabelEntry[];
  targetPx: number;
  onQtyChange: (id: number, qty: number) => void;
  onRemove: (p: Product) => void;
  onWeightChange: (id: number, weightKg: number | undefined) => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, items.length - 1);
  const { product: p, qty, weightKg } = items[i];
  const prev = () => setIdx((n) => (n - 1 + items.length) % items.length);
  const next = () => setIdx((n) => (n + 1) % items.length);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl p-8 max-w-4xl w-full flex flex-col items-center gap-5" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <h2 className="font-semibold">{p.name}</h2>
        <div className="flex items-center gap-6">
          {items.length > 1 && (
            <button onClick={prev} className="w-10 h-10 border rounded-full text-lg hover:bg-stone-100 shrink-0">‹</button>
          )}
          <LabelPreviewCard p={p} targetPx={targetPx} weightKg={weightKg} {...display} />
          {items.length > 1 && (
            <button onClick={next} className="w-10 h-10 border rounded-full text-lg hover:bg-stone-100 shrink-0">›</button>
          )}
        </div>
        {items.length > 1 && (
          <span className="text-sm text-stone-500 tabular-nums">{i + 1} / {items.length}</span>
        )}
        {p.is_weighable && (
          <div className="flex flex-col items-center gap-1">
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Peso de este paquete (kg):
              <input
                type="number"
                min={0}
                step="0.001"
                placeholder="0.000"
                className="input h-8 w-24 text-sm px-2"
                value={weightKg ?? ""}
                onChange={(e) => onWeightChange(p.id, e.target.value ? Number(e.target.value) : undefined)}
              />
            </label>
            {weightKg && weightKg > 0 && (
              <p className="text-[11px] text-stone-400">
                Al imprimir se genera un código único para este peso — escanearlo en Caja carga el precio solo.
              </p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-stone-100 pt-4 w-full justify-center">
          <span className="text-sm text-stone-500">Copias:</span>
          <button onClick={() => onQtyChange(p.id, qty - 1)} className="w-7 h-7 border rounded hover:bg-stone-100">−</button>
          <span className="w-7 text-center tabular-nums">{qty}</span>
          <button onClick={() => onQtyChange(p.id, qty + 1)} className="w-7 h-7 border rounded hover:bg-stone-100">+</button>
          <button
            onClick={() => { onRemove(p); if (items.length <= 1) onClose(); else setIdx((n) => Math.min(n, items.length - 2)); }}
            className="text-stone-400 hover:text-red-600 text-sm ml-3"
          >
            Quitar de la selección
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── HTML de una etiqueta para impresión ─────────────────────────────────────
function buildLabelHtml(
  p: Product,
  template: Template,
  storeName: string,
  showExpiry: boolean,
  price: "price1" | "price2" | "price3",
  widthMm: number,
  heightMm: number,
  extraText: string,
  fontScale: number,
  showCategory: boolean,
  showStoreName: boolean,
  extraBig: boolean,
  weightKg?: number,
  barcodeOverride?: string,
): string {
  const priceValue = price === "price2" ? p.price2_cents : price === "price3" ? p.price3_cents : p.price_cents;
  const wd = weighableDisplay(p, priceValue, weightKg);
  const priceStr = wd.priceStr;
  const f = (px: number) => `${+(px * fontScale).toFixed(2)}px`;
  // Con un peso puntual cargado, el código impreso es el de la etiqueta de
  // paquete pesado (único, con el peso/precio congelados) — no el del
  // producto base, que es el mismo para todas las bolsas de ese producto.
  const effectiveBarcode = barcodeOverride ?? p.barcode;
  const barcodeSvg = effectiveBarcode ? buildBarcodeSVG(effectiveBarcode, Math.round(18 * fontScale), false) : "";
  const category = showCategory ? (p.category || "") : "";
  const effectiveStoreName = showStoreName ? storeName : "";
  const meta = [
    category,
    showExpiry && p.expires_at ? `Vto: ${p.expires_at.slice(0, 10)}` : "",
  ].filter(Boolean).join(" · ");

  const base = `box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;overflow:hidden;border:1px dashed #aaa;background:white;page-break-inside:avoid;display:flex;flex-direction:column;position:relative;width:${widthMm}mm;height:${heightMm}mm;`;

  // Blanco y negro nada más: un fondo de color casi nunca sale en la impresora
  // (los navegadores no imprimen fondos salvo que actives "gráficos de fondo" a
  // mano), así que todo lo que tiene que verse sí o sí es borde + texto negro.
  // "Chica": cintita discreta en la esquina. "Grande": banner protagonista arriba de
  // todo — para "OFERTA", "COMBO OFERTA" o lo que haga falta destacar de verdad.
  const extraBadge = extraText.trim() && !extraBig
    ? `<div style="position:absolute;top:1px;right:1px;border:1px solid #000;color:#000;font-weight:bold;font-size:${f(7)};padding:0px 3px;letter-spacing:0.3px;max-width:75%;overflow-wrap:break-word;text-align:right;line-height:1.3;background:white">${extraText.trim()}</div>`
    : "";
  const extraBanner = extraText.trim() && extraBig
    ? `<div style="color:#000;font-weight:700;text-align:center;text-transform:uppercase;letter-spacing:0.5px;font-size:${f(15)};line-height:1.3;white-space:nowrap;overflow:visible;text-overflow:clip">${extraText.trim()}</div>`
    : "";
  const extraMarkup = extraBadge + extraBanner;

  switch (template) {
    // ── Góndola: nombre arriba, precio grande centro, barcode abajo ──────────
    case "gondola":
      return `<div style="${base}padding:6px 8px;justify-content:space-between">
        ${extraMarkup}
        <div style="font-size:${f(8.5)};font-weight:bold;text-transform:uppercase;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;line-height:1.15;letter-spacing:0.3px">
          ${p.name}
        </div>
        <div style="font-size:${f(wd.weightStr ? 20 : 27)};font-weight:bold;color:#000;text-align:center;line-height:1;letter-spacing:-0.5px">
          ${priceStr}
          ${wd.weightStr ? `<div style="font-size:${f(7.5)}">${wd.weightStr} · ${wd.perKgStr}</div>` : ""}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:4px">
          <div style="flex:1;overflow:hidden;max-width:70%">${barcodeSvg}</div>
          <div style="font-size:${f(7)};color:#555;text-align:right;white-space:nowrap;padding-bottom:2px;line-height:1.4">
            ${meta}${meta && effectiveStoreName ? "<br>" : ""}${effectiveStoreName ? `<span style="opacity:0.6">${effectiveStoreName}</span>` : ""}
          </div>
        </div>
      </div>`;

    // ── Precio: nombre + precio prominente ───────────────────────────────────
    case "precio":
      return `<div style="${base}padding:6px 8px;justify-content:space-between">
        ${extraMarkup}
        <div style="font-size:${f(8)};font-weight:bold;text-transform:uppercase;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;line-height:1.15">
          ${p.name}
        </div>
        <div style="font-size:${f(wd.weightStr ? 19 : 26)};font-weight:bold;color:#000;text-align:center;line-height:1">
          ${priceStr}
          ${wd.weightStr ? `<div style="font-size:${f(7)}">${wd.weightStr} · ${wd.perKgStr}</div>` : ""}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between">
          <div style="flex:1;overflow:hidden">${barcodeSvg}</div>
          ${meta ? `<div style="font-size:${f(7)};color:#666;text-align:right;padding-bottom:2px">${meta}</div>` : ""}
        </div>
      </div>`;

    // ── Completa: toda la info ───────────────────────────────────────────────
    case "completa":
      return `<div style="${base}padding:6px 8px;justify-content:space-between">
        ${extraMarkup}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
          <div style="flex:1;overflow:hidden">
            <div style="font-size:${f(9)};font-weight:bold;text-transform:uppercase;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;line-height:1.15">${p.name}</div>
            ${category ? `<div style="font-size:${f(7)};color:#666;text-transform:uppercase;margin-top:1px">${category}</div>` : ""}
            ${effectiveStoreName ? `<div style="font-size:${f(7)};color:#aaa">${effectiveStoreName}</div>` : ""}
          </div>
          <div style="text-align:right;white-space:nowrap">
            <div style="font-size:${f(wd.weightStr ? 18 : 22)};font-weight:bold;color:#000;line-height:1">${priceStr}</div>
            ${wd.weightStr ? `<div style="font-size:${f(7)};color:#555;font-weight:600">${wd.weightStr} · ${wd.perKgStr}</div>` : ""}
            ${p.cost_cents > 0 ? `<div style="font-size:${f(7.5)};color:#888">Costo: ${centsToARS(p.cost_cents)}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:4px">
          <div style="flex:1;overflow:hidden">${barcodeSvg}</div>
          <div style="font-size:${f(7)};color:#666;text-align:right;line-height:1.5">
            ${effectiveBarcode ? `<div style="font-family:monospace">${effectiveBarcode}</div>` : ""}
            ${showExpiry && p.expires_at ? `<div>Vto: ${p.expires_at.slice(0, 10)}</div>` : ""}
            ${p.id > 0 ? `<div>Stock: ${p.stock}</div>` : ""}
          </div>
        </div>
      </div>`;

    // ── Solo barcode: hoja de códigos ─────────────────────────────────────────
    case "barcode":
    default:
      return `<div style="${base}padding:8px;align-items:center;justify-content:center;gap:4px;border:1px solid #ccc;border-style:solid">
        ${extraMarkup}
        <div style="font-size:${f(8.5)};font-weight:bold;text-transform:uppercase;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;line-height:1.15;width:100%">
          ${p.name}
        </div>
        <div style="width:100%;display:flex;justify-content:center">
          ${effectiveBarcode ? buildBarcodeSVG(effectiveBarcode, Math.round(40 * fontScale), false) : `<div style='font-size:${f(10)};color:#ccc'>sin código</div>`}
        </div>
        <div style="font-size:${f(9)};font-family:monospace;color:#333;text-align:center;letter-spacing:1px">
          ${effectiveBarcode || ""}
        </div>
      </div>`;
  }
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function Etiquetas() {
  const stockTrackingEnabled = useStockTrackingStore((s) => s.enabled);
  const combosEnabled = useCombosEnabledStore((s) => s.enabled);
  const [products, setProducts] = useState<Product[]>([]);
  const [combos, setCombos] = useState<ComboWithItems[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Map<number, LabelEntry>>(new Map());
  const [template, setTemplate] = useState<Template>("gondola");
  const [paperSize, setPaperSize] = useState<PaperSize>("a4");
  const [showExpiry, setShowExpiry] = useState(true);
  const [priceList, setPriceList] = useState<"price1" | "price2" | "price3">("price1");
  const [storeName, setStoreName] = useState("");
  const [bulkQty, setBulkQty] = useState("");
  const [widthMm, setWidthMm] = useState(TEMPLATES.gondola.wMm);
  const [heightMm, setHeightMm] = useState(TEMPLATES.gondola.hMm);
  const [extraText, setExtraText] = useState("");
  const [extraBig, setExtraBig] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>("normal");
  const [showCategory, setShowCategory] = useState(true);
  const [showStoreName, setShowStoreName] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);

  // Al cambiar de plantilla, arrancamos con su tamaño típico — pero el ancho/alto
  // quedan editables después por si la impresora del cliente usa otra medida.
  function changeTemplate(t: Template) {
    setTemplate(t);
    setWidthMm(TEMPLATES[t].wMm);
    setHeightMm(TEMPLATES[t].hMm);
  }

  const debouncedQuery = useDebouncedValue(query, 200);
  useEffect(() => {
    api.listProducts(debouncedQuery).then(setProducts).catch(console.error);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!combosEnabled) { setCombos([]); return; }
    api.listActiveCombos().then(setCombos).catch(console.error);
  }, [combosEnabled]);

  useEffect(() => {
    api.getConfig("business_name").then((n) => { if (n) setStoreName(n); }).catch(() => {});
  }, []);

  function toggle(product: Product) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, { product, qty: 1 });
      return next;
    });
  }

  function setQty(id: number, qty: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(id);
      if (entry) next.set(id, { ...entry, qty: Math.max(1, qty) });
      return next;
    });
  }

  function setWeight(id: number, weightKg: number | undefined) {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(id);
      if (entry) next.set(id, { ...entry, weightKg });
      return next;
    });
  }

  const comboProducts = combos
    .filter((cw) => cw.combo.active)
    .filter((cw) => !debouncedQuery || cw.combo.name.toLowerCase().includes(debouncedQuery.toLowerCase()))
    .map(comboToLabelProduct);
  const allProducts = [...products, ...comboProducts];
  const categories = [...new Set(allProducts.map((p) => p.category).filter(Boolean) as string[])].sort();
  const visibleProducts = allProducts.filter((p) =>
    (!categoryFilter || p.category === categoryFilter)
  );

  function selectAll() {
    const next = new Map<number, LabelEntry>(selected);
    visibleProducts.forEach((p) => next.set(p.id, { product: p, qty: 1 }));
    setSelected(next);
  }

  function clearFilter() {
    setSelected(new Map());
    setCategoryFilter("");
  }

  async function addLowStock() {
    const lowIds = (await api.listLowStock()).map((p) => p.id);
    const all = await api.listProducts("");
    const lowProducts = all.filter((p) => lowIds.includes(p.id));
    setSelected((prev) => {
      const next = new Map(prev);
      lowProducts.forEach((p) => { if (!next.has(p.id)) next.set(p.id, { product: p, qty: 1 }); });
      return next;
    });
  }

  function applyBulkQty() {
    const qty = parseInt(bulkQty);
    if (!qty || qty < 1) return;
    setSelected((prev) => {
      const next = new Map(prev);
      next.forEach((v, k) => next.set(k, { ...v, qty }));
      return next;
    });
    setBulkQty("");
  }

  const totalLabels = [...selected.values()].reduce((s, e) => s + e.qty, 0);

  const pageCss: Record<PaperSize, string> = {
    a4:       "@page { size: A4; margin: 10mm; }",
    carta:    "@page { size: letter; margin: 10mm; }",
    termica58: "@page { size: 58mm auto; margin: 3mm; }",
  };

  const [printing, setPrinting] = useState(false);

  async function print() {
    if (selected.size === 0) return;
    setPrinting(true);
    try {
      // Un código único por entrada seleccionada (no por copia) — si pedís 3
      // etiquetas de la misma bolsa de 560g, las 3 comparten el mismo código
      // porque es el mismo peso; escanear cualquiera de las 3 da el mismo resultado.
      const barcodeOverrides = new Map<number, string>();
      for (const { product, weightKg } of selected.values()) {
        if (!product.is_weighable || !weightKg || weightKg <= 0 || product.id <= 0) continue;
        const priceValue = priceList === "price2" ? product.price2_cents : priceList === "price3" ? product.price3_cents : product.price_cents;
        try {
          const label = await api.createWeighedLabel({ product_id: product.id, weight_kg: weightKg, unit_price_cents: priceValue });
          barcodeOverrides.set(product.id, label.barcode);
        } catch (e) {
          console.error("No se pudo generar el código de la etiqueta de peso:", e);
        }
      }

      const entries: LabelEntry[] = [];
      selected.forEach((e) => { for (let i = 0; i < e.qty; i++) entries.push(e); });

      const scale = FONT_SCALES[fontScale];
      const labelsHtml = entries
        .map(({ product, weightKg }) =>
          buildLabelHtml(product, template, storeName, showExpiry, priceList, widthMm, heightMm, extraText, scale, showCategory, showStoreName, extraBig, weightKg, barcodeOverrides.get(product.id))
        )
        .join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin:0; font-family:Arial,sans-serif; background:white; }
  .grid { display:flex; flex-wrap:wrap; gap:4px; padding:4px; }
  ${pageCss[paperSize]}
  @media print { body { background:white; } }
</style></head><body>
<div class="grid">${labelsHtml}</div>
</body></html>`;

      printHtml(html);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Etiquetas para góndola</h1>
        <div className="flex gap-2">
          {stockTrackingEnabled && (
            <button
              onClick={addLowStock}
              className="btn btn-secondary text-sm"
            >
              ⚠ Bajo stock
            </button>
          )}
          <button
            onClick={print}
            disabled={selected.size === 0 || printing}
            className="btn btn-primary disabled:opacity-40 flex items-center gap-2"
          >
            {printing ? "Generando…" : `🖨️ Imprimir ${totalLabels > 0 ? `(${totalLabels})` : ""}`}
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Panel izquierdo: configuración */}
        <div className="flex flex-col gap-3 w-72 shrink-0 overflow-y-auto min-h-0 pr-1">
          {/* Plantilla */}
          <div className="card p-4 space-y-3">
            <h2 className="font-medium text-sm">Plantilla</h2>
            <div className="space-y-1.5">
              {(Object.entries(TEMPLATES) as [Template, TemplateConfig][]).map(([id, c]) => (
                <label key={id} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" checked={template === id} onChange={() => changeTemplate(id)} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-xs text-stone-400">{c.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Opciones */}
          <div className="card p-4 space-y-3">
            <h2 className="font-medium text-sm">Opciones</h2>

            <div>
              <label className="text-xs text-stone-500 block mb-1">Lista de precios</label>
              <select className="input w-full text-sm" value={priceList} onChange={(e) => setPriceList(e.target.value as typeof priceList)}>
                <option value="price1">Precio minorista</option>
                <option value="price2">Precio mayorista</option>
                <option value="price3">Precio especial</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-stone-500 block mb-1">Papel</label>
              <select className="input w-full text-sm" value={paperSize} onChange={(e) => setPaperSize(e.target.value as PaperSize)}>
                {(Object.entries(PAPER_SIZES) as [PaperSize, string][]).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={showExpiry} onChange={(e) => setShowExpiry(e.target.checked)} />
              Mostrar fecha de vencimiento
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={showCategory} onChange={(e) => setShowCategory(e.target.checked)} />
              Mostrar categoría
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={showStoreName} onChange={(e) => setShowStoreName(e.target.checked)} />
              Mostrar nombre del negocio
            </label>
          </div>

          {/* Tamaño de etiqueta */}
          <div className="card p-4 space-y-3">
            <h2 className="font-medium text-sm">Tamaño de etiqueta</h2>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-stone-500 block mb-1">Ancho (mm)</label>
                <input
                  type="number" min={10} max={200}
                  className="input w-full text-sm"
                  value={widthMm}
                  onChange={(e) => setWidthMm(Math.max(10, Number(e.target.value) || 0))}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-stone-500 block mb-1">Alto (mm)</label>
                <input
                  type="number" min={10} max={200}
                  className="input w-full text-sm"
                  value={heightMm}
                  onChange={(e) => setHeightMm(Math.max(10, Number(e.target.value) || 0))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Tamaños de impresoras térmicas comunes</label>
              <div className="flex flex-wrap gap-1.5">
                {SIZE_PRESETS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => { setWidthMm(s.w); setHeightMm(s.h); }}
                    className={`text-xs px-2 py-1 rounded border ${widthMm === s.w && heightMm === s.h ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-stone-200 hover:bg-stone-50"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Tamaño de letra</label>
              <div className="flex gap-1.5">
                {(["chico", "normal", "grande"] as FontScale[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFontScale(s)}
                    className={`flex-1 text-xs px-2 py-1.5 rounded border capitalize ${fontScale === s ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-stone-200 hover:bg-stone-50"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Texto extra */}
          <div className="card p-4 space-y-2">
            <h2 className="font-medium text-sm">Texto extra</h2>
            <p className="text-xs text-stone-400">Se imprime en todas las etiquetas de esta tanda — ej: "OFERTA", "COMBO OFERTA", "2x1", "Llevando 2, 50% off".</p>
            <input
              className="input w-full text-sm"
              placeholder='Ej: "OFERTA" o "Llevando 2, 50% off"'
              maxLength={32}
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => setExtraBig(false)}
                className={`flex-1 text-xs px-2 py-1.5 rounded border ${!extraBig ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-stone-200 hover:bg-stone-50"}`}
              >
                Cintita chica
              </button>
              <button
                onClick={() => setExtraBig(true)}
                className={`flex-1 text-xs px-2 py-1.5 rounded border ${extraBig ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-stone-200 hover:bg-stone-50"}`}
              >
                Banner grande
              </button>
            </div>
          </div>

        </div>

        {/* Panel central: lista de productos */}
        <div className="card flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b border-stone-200 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Buscar producto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="input w-40 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas las cat.</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={selectAll} className="btn btn-secondary text-xs whitespace-nowrap">
              {categoryFilter ? `Sel. ${categoryFilter}` : "Sel. todos"}
            </button>
          </div>
          {selected.size > 0 && (
            <div className="px-3 py-2 border-b border-stone-200 flex items-center gap-3 text-xs bg-stone-50">
              <span className="text-stone-600 font-medium">
                {selected.size} producto{selected.size !== 1 ? "s" : ""} seleccionado{selected.size !== 1 ? "s" : ""}
                <span className="text-stone-400 font-normal"> · {totalLabels} etiqueta{totalLabels !== 1 ? "s" : ""} en total</span>
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-stone-400">Cantidad para todos:</span>
                <input
                  type="number"
                  min={1}
                  className="input text-xs h-7 text-center w-14"
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyBulkQty()}
                />
                <button onClick={applyBulkQty} className="btn btn-secondary text-xs h-7 px-2">Aplicar</button>
              </div>
              <button onClick={() => setSelected(new Map())} className="text-red-500 hover:text-red-700">Limpiar</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 uppercase bg-stone-50 sticky top-0">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="text-left px-3 py-2">Producto</th>
                  <th className="text-left px-3 py-2">Categoría</th>
                  <th className="text-right px-3 py-2">Precio</th>
                  <th className="text-right px-3 py-2">Stock</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((p) => {
                  const isSelected = selected.has(p.id);
                  const displayPrice = priceList === "price2" ? p.price2_cents : priceList === "price3" ? p.price3_cents : p.price_cents;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => toggle(p)}
                      className={`border-t border-stone-100 cursor-pointer transition-colors ${isSelected ? "bg-emerald-50" : "hover:bg-stone-50"}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" readOnly checked={isSelected} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {p.name}
                          {p.is_weighable && <span className="ml-1.5 text-[10px] font-normal text-indigo-500">(x kg)</span>}
                        </div>
                        {p.barcode && <div className="text-[10px] text-stone-400 font-mono">{p.barcode}</div>}
                      </td>
                      <td className="px-3 py-2 text-stone-500 text-xs">{p.category || "—"}</td>
                      <td className="px-3 py-2 text-right tabular font-medium">
                        {centsToARS(displayPrice)}{p.is_weighable && <span className="text-stone-400 font-normal">/kg</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular ${p.id > 0 && stockTrackingEnabled && p.stock <= p.min_stock ? "text-red-600 font-medium" : ""}`}>
                        {p.id > 0 ? p.stock : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel derecho: preview (varias etiquetas, con scroll) */}
        {selected.size > 0 && (() => {
          const items = [...selected.values()];
          const display = { template, priceList, showExpiry, showCategory, showStoreName, storeName, extraText, fontScale, widthMm, heightMm, extraBig };
          return (
            <div className="w-80 shrink-0 card p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium text-sm">Vista previa</h2>
                <button onClick={() => setZoomOpen(true)} title="Ver más grande" className="text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded w-6 h-6 flex items-center justify-center">
                  <Maximize2 size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <LabelGrid items={items} targetPx={130} onQtyChange={setQty} onRemove={toggle} onWeightChange={setWeight} {...display} />
              </div>
              {zoomOpen && <LabelGalleryModal items={items} targetPx={600} onQtyChange={setQty} onRemove={toggle} onWeightChange={setWeight} {...display} onClose={() => setZoomOpen(false)} />}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
