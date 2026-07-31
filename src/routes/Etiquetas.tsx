import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { api } from "@/lib/api";
import { centsToARS } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import type { Product } from "@/types";

// ─── Tipos de plantilla ──────────────────────────────────────────────────────
type Template = "gondola" | "precio" | "completa" | "barcode";
type PaperSize = "a4" | "carta" | "termica58";

interface TemplateConfig {
  label: string;
  w: string;
  h: string;
  description: string;
}

const TEMPLATES: Record<Template, TemplateConfig> = {
  gondola:  { label: "Góndola",         w: "246px", h: "100px", description: "6.5×2.6 cm — nombre, precio grande y barcode" },
  precio:   { label: "Precio",          w: "170px", h:  "85px", description: "4.5×2.2 cm — precio destacado" },
  completa: { label: "Completa",        w: "246px", h: "130px", description: "6.5×3.4 cm — toda la información" },
  barcode:  { label: "Código de barras", w: "160px", h: "110px", description: "4.2×2.9 cm — hoja de códigos de barra" },
};

const PAPER_SIZES: Record<PaperSize, string> = {
  a4:       "A4",
  carta:    "Carta (Letter)",
  termica58: "Térmica 58mm",
};

interface LabelEntry { product: Product; qty: number }

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

// ─── HTML de una etiqueta para impresión ─────────────────────────────────────
function buildLabelHtml(p: Product, template: Template, storeName: string, showExpiry: boolean, price: "price1" | "price2" | "price3"): string {
  const priceValue = price === "price2" ? p.price2_cents : price === "price3" ? p.price3_cents : p.price_cents;
  const priceStr = centsToARS(priceValue);
  const barcodeSvg = p.barcode ? buildBarcodeSVG(p.barcode, 26, false) : "";
  const meta = [
    p.category || "",
    showExpiry && p.expires_at ? `Vto: ${p.expires_at.slice(0, 10)}` : "",
  ].filter(Boolean).join(" · ");

  const base = `box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;overflow:hidden;border:1px dashed #aaa;background:white;page-break-inside:avoid;display:flex;flex-direction:column;`;

  switch (template) {
    // ── Góndola: nombre arriba, precio grande centro, barcode abajo ──────────
    case "gondola":
      return `<div style="${base}width:246px;height:100px;padding:6px 8px;justify-content:space-between">
        <div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.3px">
          ${p.name}
        </div>
        <div style="font-size:27px;font-weight:bold;color:#000;text-align:center;line-height:1;letter-spacing:-0.5px">
          ${priceStr}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:4px">
          <div style="flex:1;overflow:hidden;max-width:170px">${barcodeSvg}</div>
          <div style="font-size:7px;color:#555;text-align:right;white-space:nowrap;padding-bottom:2px;line-height:1.4">
            ${meta}${meta && storeName ? "<br>" : ""}${storeName ? `<span style="opacity:0.6">${storeName}</span>` : ""}
          </div>
        </div>
      </div>`;

    // ── Precio: nombre + precio prominente ───────────────────────────────────
    case "precio":
      return `<div style="${base}width:170px;height:85px;padding:6px 8px;justify-content:space-between">
        <div style="font-size:8px;font-weight:bold;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${p.name}
        </div>
        <div style="font-size:26px;font-weight:bold;color:#000;text-align:center;line-height:1">
          ${priceStr}
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between">
          <div style="flex:1;overflow:hidden">${barcodeSvg}</div>
          ${meta ? `<div style="font-size:7px;color:#666;text-align:right;padding-bottom:2px">${meta}</div>` : ""}
        </div>
      </div>`;

    // ── Completa: toda la info ───────────────────────────────────────────────
    case "completa":
      return `<div style="${base}width:246px;height:130px;padding:6px 8px;justify-content:space-between">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
          <div style="flex:1;overflow:hidden">
            <div style="font-size:9px;font-weight:bold;text-transform:uppercase;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${p.name}</div>
            ${p.category ? `<div style="font-size:7px;color:#666;text-transform:uppercase;margin-top:1px">${p.category}</div>` : ""}
            ${storeName ? `<div style="font-size:7px;color:#aaa">${storeName}</div>` : ""}
          </div>
          <div style="text-align:right;white-space:nowrap">
            <div style="font-size:22px;font-weight:bold;color:#000;line-height:1">${priceStr}</div>
            ${p.cost_cents > 0 ? `<div style="font-size:7.5px;color:#888">Costo: ${centsToARS(p.cost_cents)}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:4px">
          <div style="flex:1;overflow:hidden">${barcodeSvg}</div>
          <div style="font-size:7px;color:#666;text-align:right;line-height:1.5">
            ${p.barcode ? `<div style="font-family:monospace">${p.barcode}</div>` : ""}
            ${showExpiry && p.expires_at ? `<div>Vto: ${p.expires_at.slice(0, 10)}</div>` : ""}
            <div>Stock: ${p.stock}</div>
          </div>
        </div>
      </div>`;

    // ── Solo barcode: hoja de códigos ─────────────────────────────────────────
    case "barcode":
    default:
      return `<div style="${base}width:160px;height:110px;padding:8px;align-items:center;justify-content:center;gap:4px;border:1px solid #ccc;border-style:solid">
        <div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%">
          ${p.name}
        </div>
        <div style="width:100%;display:flex;justify-content:center">
          ${p.barcode ? buildBarcodeSVG(p.barcode, 40, false) : "<div style='font-size:10px;color:#ccc'>sin código</div>"}
        </div>
        <div style="font-size:9px;font-family:monospace;color:#333;text-align:center;letter-spacing:1px">
          ${p.barcode || ""}
        </div>
      </div>`;
  }
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function Etiquetas() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Map<number, LabelEntry>>(new Map());
  const [template, setTemplate] = useState<Template>("gondola");
  const [paperSize, setPaperSize] = useState<PaperSize>("a4");
  const [showExpiry, setShowExpiry] = useState(true);
  const [priceList, setPriceList] = useState<"price1" | "price2" | "price3">("price1");
  const [storeName, setStoreName] = useState("");
  const [bulkQty, setBulkQty] = useState("");

  useEffect(() => {
    api.listProducts(query).then(setProducts).catch(console.error);
  }, [query]);

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

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort();
  const visibleProducts = products.filter((p) =>
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

  function print() {
    if (selected.size === 0) return;
    const entries: LabelEntry[] = [];
    selected.forEach((e) => { for (let i = 0; i < e.qty; i++) entries.push(e); });

    const labelsHtml = entries
      .map(({ product }) => buildLabelHtml(product, template, storeName, showExpiry, priceList))
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
  }

  const tplCfg = TEMPLATES[template];

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Etiquetas para góndola</h1>
        <div className="flex gap-2">
          <button
            onClick={addLowStock}
            className="btn btn-secondary text-sm"
          >
            ⚠ Bajo stock
          </button>
          <button
            onClick={print}
            disabled={selected.size === 0}
            className="btn btn-primary disabled:opacity-40 flex items-center gap-2"
          >
            🖨️ Imprimir {totalLabels > 0 ? `(${totalLabels})` : ""}
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Panel izquierdo: configuración */}
        <div className="flex flex-col gap-3 w-72 shrink-0">
          {/* Plantilla */}
          <div className="card p-4 space-y-3">
            <h2 className="font-medium text-sm">Plantilla</h2>
            <div className="space-y-1.5">
              {(Object.entries(TEMPLATES) as [Template, TemplateConfig][]).map(([id, c]) => (
                <label key={id} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" checked={template === id} onChange={() => setTemplate(id)} className="mt-0.5" />
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
          </div>

          {/* Seleccionados */}
          {selected.size > 0 && (
            <div className="card p-4 flex-1 overflow-y-auto min-h-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium text-sm">Seleccionados ({selected.size})</h2>
                <button onClick={() => setSelected(new Map())} className="text-xs text-red-500 hover:text-red-700">Limpiar</button>
              </div>
              <div className="flex gap-1 mb-2">
                <input
                  type="number"
                  min={1}
                  className="input text-xs h-7 text-center w-16"
                  placeholder="Cant."
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyBulkQty()}
                />
                <button onClick={applyBulkQty} className="btn btn-secondary text-xs h-7 px-2">Aplicar a todos</button>
              </div>
              <div className="space-y-2">
                {[...selected.values()].map(({ product: p, qty }) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex-1 truncate text-xs">{p.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(p.id, qty - 1)} className="w-5 h-5 border rounded text-xs hover:bg-stone-100">−</button>
                      <span className="w-6 text-center text-xs">{qty}</span>
                      <button onClick={() => setQty(p.id, qty + 1)} className="w-5 h-5 border rounded text-xs hover:bg-stone-100">+</button>
                    </div>
                    <button onClick={() => toggle(p)} className="text-stone-400 hover:text-red-600 text-xs">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                        <div className="font-medium">{p.name}</div>
                        {p.barcode && <div className="text-[10px] text-stone-400 font-mono">{p.barcode}</div>}
                      </td>
                      <td className="px-3 py-2 text-stone-500 text-xs">{p.category || "—"}</td>
                      <td className="px-3 py-2 text-right tabular font-medium">{centsToARS(displayPrice)}</td>
                      <td className={`px-3 py-2 text-right tabular ${p.stock <= p.min_stock ? "text-red-600 font-medium" : ""}`}>
                        {p.stock}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel derecho: preview */}
        {selected.size > 0 && (
          <div className="w-80 shrink-0 card p-4 overflow-y-auto">
            <h2 className="font-medium text-sm mb-3">
              Preview <span className="text-xs text-stone-400 font-normal">(primeras {Math.min(selected.size, 4)})</span>
            </h2>
            <div className="flex flex-wrap gap-3">
              {[...selected.values()].slice(0, 4).map(({ product: p }) => {
                const displayPrice = priceList === "price2" ? p.price2_cents : priceList === "price3" ? p.price3_cents : p.price_cents;
                const meta = [p.category || "", showExpiry && p.expires_at ? `Vto: ${p.expires_at.slice(0, 10)}` : ""].filter(Boolean).join(" · ");
                return (
                  <div
                    key={p.id}
                    style={{ width: tplCfg.w, height: tplCfg.h, border: "1px dashed #aaa" }}
                    className="bg-white overflow-hidden flex flex-col justify-between p-1.5 font-sans"
                  >
                    {template === "gondola" && (
                      <>
                        <div className="text-[8px] font-bold uppercase truncate tracking-tight">{p.name}</div>
                        <div className="text-[22px] font-bold text-center text-black leading-tight">{centsToARS(displayPrice)}</div>
                        <div className="flex items-end justify-between gap-1">
                          <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={18} />}</div>
                          <div className="text-[6.5px] text-stone-400 text-right leading-tight shrink-0">{meta}</div>
                        </div>
                      </>
                    )}
                    {template === "precio" && (
                      <>
                        <div className="text-[8px] font-bold uppercase truncate">{p.name}</div>
                        <div className="text-[20px] font-bold text-center text-black leading-tight">{centsToARS(displayPrice)}</div>
                        <div className="flex items-end justify-between gap-1">
                          <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={14} />}</div>
                          {meta && <div className="text-[6.5px] text-stone-400 text-right shrink-0">{meta}</div>}
                        </div>
                      </>
                    )}
                    {template === "completa" && (
                      <>
                        <div className="flex justify-between items-start gap-1">
                          <div className="flex-1 overflow-hidden">
                            <div className="text-[8px] font-bold uppercase truncate">{p.name}</div>
                            {p.category && <div className="text-[7px] text-stone-400 uppercase">{p.category}</div>}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[16px] font-bold text-black leading-tight">{centsToARS(displayPrice)}</div>
                            {p.cost_cents > 0 && <div className="text-[7px] text-stone-400">C: {centsToARS(p.cost_cents)}</div>}
                          </div>
                        </div>
                        <div className="flex items-end gap-1">
                          <div className="flex-1 overflow-hidden">{p.barcode && <BarcodeDisplay value={p.barcode} height={18} />}</div>
                          <div className="text-[6.5px] text-stone-400 text-right leading-tight">
                            {showExpiry && p.expires_at && <div>{p.expires_at.slice(0, 10)}</div>}
                            <div>Stock: {p.stock}</div>
                          </div>
                        </div>
                      </>
                    )}
                    {template === "barcode" && (
                      <div className="flex flex-col items-center justify-between h-full py-1" style={{ border: "1px solid #ccc", borderStyle: "solid", margin: "-6px" }}>
                        <div className="text-[8px] font-bold uppercase text-center truncate w-full px-1">{p.name}</div>
                        <div className="w-full px-2">{p.barcode && <BarcodeDisplay value={p.barcode} height={30} />}</div>
                        <div className="text-[8px] font-mono text-center">{p.barcode}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {selected.size > 4 && (
                <div className="text-xs text-stone-400 self-center">+{selected.size - 4} más…</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
