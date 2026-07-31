import { useState } from "react";
import { centsToARS, formatDateTime } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import type { Sale, SaleItem } from "@/types";

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  qr: "QR / Mercado Pago",
  transferencia: "Transferencia",
  fiado: "Fiado",
  cuenta_corriente: "Cuenta Corriente",
};

type PaperSize = "58mm" | "80mm";

const PAPER_WIDTH: Record<PaperSize, { px: number; bodyPx: number; fontSize: number }> = {
  "58mm": { px: 220, bodyPx: 200, fontSize: 11 },
  "80mm": { px: 302, bodyPx: 280, fontSize: 12 },
};

interface Props {
  sale: Sale;
  items: SaleItem[];
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  ticketFooter?: string;
  paperSize?: PaperSize;
  isRi?: boolean;
  onClose: () => void;
}

function buildReceiptHtml(p: Omit<Props, "onClose"> & { paperSize: PaperSize }): string {
  const { sale, items, businessName, businessAddress, businessPhone, ticketFooter, paperSize, isRi } = p;
  const pw = PAPER_WIDTH[paperSize];

  const itemsHtml = items
    .map(
      (item) => `
      <div class="row">
        <span class="name">${escHtml(item.name)}</span>
        <span class="nowrap">${centsToARS(item.subtotal_cents)}</span>
      </div>
      <div class="small indent">
        ${item.qty} × ${centsToARS(item.unit_price_cents)}${item.discount_pct > 0 ? ` (-${item.discount_pct}%)` : ""}
      </div>`
    )
    .join("");

  const discountRow =
    sale.discount_cents > 0
      ? `<div class="row small"><span>Descuento</span><span class="nowrap">- ${centsToARS(sale.discount_cents)}</span></div>`
      : "";

  const cashRows =
    sale.payment_method === "efectivo"
      ? `<div class="row small"><span>Recibido</span><span class="nowrap">${centsToARS(sale.paid_cents)}</span></div>
         <div class="row small"><span>Vuelto</span><span class="nowrap">${centsToARS(sale.change_cents)}</span></div>`
      : "";

  const netoCents = Math.round(sale.total_cents / 1.21);
  const ivaCents = sale.total_cents - netoCents;
  const ivaRows = isRi
    ? `<div class="dashed"></div>
       <div class="row small"><span>Neto gravado</span><span class="nowrap">${centsToARS(netoCents)}</span></div>
       <div class="row small"><span>IVA 21%</span><span class="nowrap">${centsToARS(ivaCents)}</span></div>
       <div class="small center" style="font-size:9px;color:#555">Responsable Inscripto — IVA discriminado</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${paperSize}; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size:${pw.fontSize}px;
    line-height:1.3;
    padding:4px 6px 16px 6px;
    width:${paperSize};
    max-width:${paperSize};
    color:#000;
    background:#fff;
  }
  .center { text-align:center; }
  .bold { font-weight:bold; }
  .small { font-size:${pw.fontSize - 1}px; color:#333; }
  .indent { padding-left:6px; }
  .big { font-size:${pw.fontSize + 2}px; }
  .dashed { border-top:1px dashed #000; margin:5px 0; }
  .row { display:flex; justify-content:space-between; align-items:flex-start; gap:2px; }
  .name { flex:1; word-break:break-word; }
  .nowrap { white-space:nowrap; }
  @page { margin:0; size:${paperSize} auto; }
  @media print {
    html, body { width:${paperSize}; }
    @page { margin:0; size:${paperSize} auto; }
  }
</style>
</head>
<body>
  <div class="center bold" style="font-size:${pw.fontSize + 3}px;margin-bottom:2px">${escHtml(businessName)}</div>
  ${businessAddress ? `<div class="center small">${escHtml(businessAddress)}</div>` : ""}
  ${businessPhone ? `<div class="center small">Tel: ${escHtml(businessPhone)}</div>` : ""}
  <div class="dashed"></div>
  <div class="small">Ticket #${sale.id}</div>
  <div class="small">${formatDateTime(sale.created_at)}</div>
  ${sale.client_name ? `<div class="small">Cliente: ${escHtml(sale.client_name)}</div>` : ""}
  <div class="dashed"></div>
  ${itemsHtml}
  <div class="dashed"></div>
  ${discountRow}
  <div class="row bold big"><span>TOTAL</span><span>${centsToARS(sale.total_cents)}</span></div>
  <div class="small" style="margin-top:3px">
    <div class="row"><span>Medio de pago</span><span>${METHOD_LABELS[sale.payment_method] || sale.payment_method}</span></div>
    ${cashRows}
  </div>
  ${ivaRows}
  <div class="dashed"></div>
  <div class="center small">${escHtml(ticketFooter || "¡Gracias por su compra!")}</div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function TicketPrint({ sale, items, businessName, businessAddress, businessPhone, ticketFooter, paperSize: initialPaperSize = "80mm", isRi = false, onClose }: Props) {
  const [paperSize, setPaperSize] = useState<PaperSize>(initialPaperSize);

  function doPrint() {
    const html = buildReceiptHtml({ sale, items, businessName, businessAddress, businessPhone, ticketFooter, paperSize, isRi });
    // Pase lo que pase con la impresión (falle, se cancele, no haya impresora), onClose()
    // se llama igual — así la caja siempre queda lista para la próxima venta.
    printHtml(html, onClose);
  }

  // Preview receipt (simplificado para mostrar en pantalla)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl flex flex-col max-h-[90vh] w-[320px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm">Ticket de venta #{sale.id}</h3>
          <div className="flex items-center gap-2">
            <select
              className="text-xs border border-stone-200 rounded px-1.5 py-0.5 text-stone-600"
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
            >
              <option value="58mm">58 mm</option>
              <option value="80mm">80 mm</option>
            </select>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Preview visual */}
        <div className="overflow-y-auto flex-1 p-4 bg-stone-50">
          <div
            className="bg-white shadow-sm border border-stone-200 mx-auto"
            style={{ fontFamily: "monospace", fontSize: "11px", padding: "12px", width: "260px" }}
          >
            <div className="text-center font-bold text-base">{businessName}</div>
            {businessAddress && <div className="text-center text-[10px] text-stone-500">{businessAddress}</div>}
            {businessPhone && <div className="text-center text-[10px] text-stone-500">Tel: {businessPhone}</div>}
            <div className="border-t border-dashed border-stone-400 my-1.5" />
            <div className="text-[10px] text-stone-500">Ticket #{sale.id} · {formatDateTime(sale.created_at)}</div>
            {sale.client_name && <div className="text-[10px] text-stone-500">Cliente: {sale.client_name}</div>}
            <div className="border-t border-dashed border-stone-400 my-1.5" />
            {items.map((item) => (
              <div key={item.id} className="mb-1">
                <div className="flex justify-between gap-1">
                  <span className="flex-1 break-words">{item.name}</span>
                  <span>{centsToARS(item.subtotal_cents)}</span>
                </div>
                <div className="text-[10px] text-stone-400 pl-2">
                  {item.qty} × {centsToARS(item.unit_price_cents)}
                  {item.discount_pct > 0 && ` (-${item.discount_pct}%)`}
                </div>
              </div>
            ))}
            <div className="border-t border-dashed border-stone-400 my-1.5" />
            {sale.discount_cents > 0 && (
              <div className="flex justify-between text-[10px] text-stone-500">
                <span>Descuento</span><span>- {centsToARS(sale.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span><span>{centsToARS(sale.total_cents)}</span>
            </div>
            <div className="text-[10px] text-stone-500 mt-1 space-y-0.5">
              <div className="flex justify-between"><span>Pago</span><span>{METHOD_LABELS[sale.payment_method]}</span></div>
              {sale.payment_method === "efectivo" && <>
                <div className="flex justify-between"><span>Recibido</span><span>{centsToARS(sale.paid_cents)}</span></div>
                <div className="flex justify-between"><span>Vuelto</span><span>{centsToARS(sale.change_cents)}</span></div>
              </>}
            </div>
            {isRi && (() => {
              const neto = Math.round(sale.total_cents / 1.21);
              const iva = sale.total_cents - neto;
              return (
                <>
                  <div className="border-t border-dashed border-stone-400 my-1.5" />
                  <div className="text-[10px] text-stone-500 space-y-0.5">
                    <div className="flex justify-between"><span>Neto gravado</span><span>{centsToARS(neto)}</span></div>
                    <div className="flex justify-between"><span>IVA 21%</span><span>{centsToARS(iva)}</span></div>
                    <div className="text-center text-stone-400" style={{ fontSize: "9px" }}>Responsable Inscripto — IVA discriminado</div>
                  </div>
                </>
              );
            })()}
            <div className="border-t border-dashed border-stone-400 my-1.5" />
            <div className="text-center text-[10px]">{ticketFooter || "¡Gracias por su compra!"}</div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-stone-200">
          <button onClick={onClose} className="btn btn-secondary flex-1">Sin ticket</button>
          <button onClick={doPrint} className="btn btn-primary flex-1">🖨️ Imprimir</button>
        </div>
      </div>
    </div>
  );
}
