import { useEffect, useState } from "react";
import { centsToARS } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import { buildAfipQrDataUrl } from "@/lib/afipQr";
import { labelForCondicionIvaReceptorId, LEYENDA_FACTURA_A_MONOTRIBUTO } from "@/lib/facturacion";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import type { CondicionIva, ElectronicInvoice } from "@/types";

// Réplica del formato oficial de factura electrónica argentina, calcada
// campo por campo contra un comprobante real generado por el propio ARCA
// (ejemplo público: afip.gob.ar/fe/qr/documentos/30000000007_001_00010_00000094.pdf).
// A diferencia del ticket de mostrador (TicketPrint.tsx), este es el
// comprobante formal que se le puede dar a un cliente que necesita factura.

export interface FacturaItem {
  code?: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  bonifPct?: number;
  subtotalCents: number;
}

interface Emisor {
  razonSocial: string;
  cuit: string;
  domicilio: string | null;
  condicionIva: CondicionIva;
  ingresosBrutos: string | null;
  inicioActividades: string | null;
}

interface Props {
  invoice: ElectronicInvoice;
  emisor: Emisor;
  items?: FacturaItem[];
  qrDataUrl?: string | null;
  // Solo si `invoice` es una Nota de Crédito: la factura que anula, para
  // poder mostrar la referencia obligatoria en el papel.
  associatedInvoice?: ElectronicInvoice | null;
  onClose: () => void;
}

function condicionIvaEmisorLabel(c: CondicionIva): string {
  return c === "responsable_inscripto" ? "IVA Responsable Inscripto" : "Responsable Monotributo";
}

function docLabel(docTipo: number): string {
  if (docTipo === 80) return "CUIT";
  if (docTipo === 86) return "CUIL";
  if (docTipo === 96) return "DNI";
  return "—";
}

function formatCbteNro(nro: number | null, pv: number): string {
  return `${String(pv).padStart(4, "0")}-${String(nro ?? 0).padStart(8, "0")}`;
}

function fmtCuit(cuit: string): string {
  const d = cuit.replace(/\D/g, "");
  if (d.length !== 11) return cuit;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildFacturaHtml(p: Props): string {
  const { invoice: inv, emisor, items, qrDataUrl, associatedInvoice } = p;
  const esNC = inv.credited_invoice_id != null;
  const cod = String(inv.cbte_tipo).padStart(2, "0");
  const fecha = new Date(inv.created_at).toLocaleDateString("es-AR");
  // Solo Factura/NC A y B discriminan IVA -- C nunca, así que esas dos
  // columnas del detalle no tienen sentido en un comprobante C.
  const discriminaIva = inv.invoice_type === "A" || inv.invoice_type === "B";
  const rows = items && items.length > 0
    ? items
    : [{ code: null, name: inv.concepto || "Venta de productos/servicios", qty: 1, unitPriceCents: inv.total_cents, bonifPct: 0, subtotalCents: inv.total_cents }];

  const itemsHtml = rows.map((it) => `
    <tr>
      <td class="cell">${escHtml(it.code || "—")}</td>
      <td class="cell">${escHtml(it.name)}</td>
      <td class="cell num">${it.qty}</td>
      <td class="cell">unidades</td>
      <td class="cell num">${centsToARS(it.unitPriceCents)}</td>
      <td class="cell num">${(it.bonifPct || 0).toFixed(2)}</td>
      <td class="cell num">${centsToARS(it.subtotalCents)}</td>
      ${discriminaIva ? `<td class="cell num">21%</td><td class="cell num">${centsToARS(Math.round(it.subtotalCents * 1.21))}</td>` : ""}
    </tr>`).join("");

  // Factura/NC A discrimina IVA en el papel (con el desglose completo de
  // alícuotas, igual que hace ARCA aunque el resto den 0); B y C no lo
  // muestran (el monto ya está incluido en el total).
  const totalsHtml = inv.invoice_type === "A"
    ? `<div class="totrow"><span>Importe Neto Gravado</span><span>${centsToARS(inv.neto_cents)}</span></div>
       <div class="totrow"><span>IVA 27%</span><span>${centsToARS(0)}</span></div>
       <div class="totrow"><span>IVA 21%</span><span>${centsToARS(inv.iva_cents)}</span></div>
       <div class="totrow"><span>IVA 10.5%</span><span>${centsToARS(0)}</span></div>
       <div class="totrow"><span>IVA 5%</span><span>${centsToARS(0)}</span></div>
       <div class="totrow"><span>IVA 2.5%</span><span>${centsToARS(0)}</span></div>
       <div class="totrow"><span>IVA 0%</span><span>${centsToARS(0)}</span></div>
       <div class="totrow"><span>Importe Otros Tributos</span><span>${centsToARS(0)}</span></div>
       <div class="totrow total"><span>Importe Total</span><span>${centsToARS(inv.total_cents)}</span></div>`
    : `<div class="totrow total"><span>Importe Total</span><span>${centsToARS(inv.total_cents)}</span></div>`;

  // Ley 27.618 / RG 5003: Factura A a un receptor Monotributista (código 6)
  // lleva una leyenda obligatoria sobre el uso del crédito fiscal.
  const leyendaHtml = inv.invoice_type === "A" && inv.condicion_iva_receptor_id === 6
    ? `<div class="leyenda">${escHtml(LEYENDA_FACTURA_A_MONOTRIBUTO)}</div>`
    : "";

  const caeBlock = inv.status === "autorizada" && inv.cae
    ? `<div class="caebox">
         <div class="qrwrap">
           ${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" />` : ""}
           <div class="arcalabel">ARCA</div>
         </div>
         <div class="caeright">
           <div><strong>CAE N°:</strong> ${escHtml(inv.cae)}</div>
           <div><strong>Fecha de Vto. de CAE:</strong> ${escHtml(inv.cae_expires_at || "—")}</div>
           <div class="autorizado">Comprobante Autorizado</div>
         </div>
       </div>
       <div class="disclaimer">Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación</div>`
    : `<div class="caebox"><div class="pendiente">Comprobante ${inv.status === "error" ? "rechazado" : "pendiente de autorización"}</div></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#1a1a1a; padding:12mm; }
  @page { size:A4; margin:0; }
  .original { text-align:center; font-size:10px; font-weight:bold; border:1px solid #1a1a1a; width:110px; margin:0 auto 6px; padding:2px; }
  .headbox { border:1px solid #1a1a1a; border-radius:4px; margin-bottom:10px; }
  .headtop { display:flex; align-items:stretch; border-bottom:1px solid #1a1a1a; }
  .razon-big { flex:1; display:flex; align-items:center; padding:10px 12px; font-size:17px; font-weight:bold; }
  .docbox { text-align:center; border-left:1px solid #1a1a1a; border-right:1px solid #1a1a1a; padding:8px 14px; }
  .doctitle-block { flex:1; padding:10px 12px; }
  .doctitle { font-size:18px; font-weight:bold; margin-bottom:4px; }
  .letra { font-size:26px; font-weight:bold; }
  .cod { font-size:9px; color:#555; }
  .metabox { font-size:11px; line-height:1.6; }
  .headbottom { display:flex; }
  .headcol { flex:1; padding:8px 12px; font-size:11px; line-height:1.7; }
  .headcol.right { border-left:1px solid #1a1a1a; }
  .receptor { border:1px solid #1a1a1a; border-radius:4px; padding:8px 12px; font-size:11px; line-height:1.8; margin-bottom:10px; display:flex; flex-wrap:wrap; gap:0 24px; }
  table { width:100%; border-collapse:collapse; margin-bottom:10px; }
  thead th { text-align:left; font-size:9px; text-transform:uppercase; color:#555; border-bottom:1px solid #1a1a1a; padding:5px 4px; }
  thead th.num { text-align:right; }
  .cell { padding:5px 4px; border-bottom:1px solid #eee; font-size:11px; }
  .cell.num { text-align:right; white-space:nowrap; }
  .totals { display:flex; flex-direction:column; align-items:flex-end; gap:1px; margin-bottom:14px; }
  .totrow { display:flex; justify-content:space-between; gap:24px; width:260px; font-size:11px; }
  .totrow.total { font-weight:bold; font-size:13px; border-top:1px solid #1a1a1a; padding-top:4px; margin-top:2px; }
  .caebox { display:flex; align-items:center; gap:16px; border-top:1px solid #1a1a1a; padding-top:10px; }
  .qrwrap { text-align:center; }
  .qr { width:90px; height:90px; display:block; }
  .arcalabel { font-size:9px; font-weight:bold; letter-spacing:1px; margin-top:2px; }
  .caeright { font-size:11px; line-height:1.8; }
  .autorizado { font-weight:bold; margin-top:2px; }
  .pendiente { color:#92400e; font-weight:bold; }
  .disclaimer { font-size:8px; color:#777; margin-top:6px; }
  .leyenda { font-size:10px; color:#555; border:1px solid #ddd; border-radius:4px; padding:6px 8px; margin-bottom:10px; line-height:1.4; }
</style>
</head>
<body>
  <div class="original">ORIGINAL</div>
  <div class="headbox">
    <div class="headtop">
      <div class="razon-big">${escHtml(emisor.razonSocial)}</div>
      <div class="docbox">
        <div class="letra">${escHtml(inv.invoice_type)}</div>
        <div class="cod">COD. ${cod}</div>
      </div>
      <div class="doctitle-block">
        <div class="doctitle">${esNC ? "NOTA DE CRÉDITO" : "FACTURA"}</div>
        <div class="metabox">
          Punto de Venta: ${String(inv.punto_venta).padStart(5, "0")} &nbsp; Comp. Nro: ${String(inv.cbte_nro ?? 0).padStart(8, "0")}<br>
          Fecha de Emisión: ${fecha}
        </div>
      </div>
    </div>
    <div class="headbottom">
      <div class="headcol">
        ${emisor.domicilio ? `Domicilio Comercial: ${escHtml(emisor.domicilio)}<br>` : ""}
        Condición frente al IVA: ${escHtml(condicionIvaEmisorLabel(emisor.condicionIva))}
      </div>
      <div class="headcol right">
        CUIT: ${escHtml(fmtCuit(emisor.cuit))}<br>
        Ingresos Brutos: ${escHtml(emisor.ingresosBrutos || "—")}<br>
        Fecha de Inicio de Actividades: ${escHtml(emisor.inicioActividades || "—")}
      </div>
    </div>
  </div>
  <div class="receptor">
    <span>${docLabel(inv.doc_tipo)}${inv.doc_tipo !== 99 ? `: ${escHtml(inv.client_cuit || "—")}` : ""}</span>
    <span>Apellido y Nombre / Razón Social: ${escHtml(inv.client_name || "Consumidor Final")}</span>
    <span>Condición frente al IVA: ${escHtml(labelForCondicionIvaReceptorId(inv.condicion_iva_receptor_id))}</span>
    <span>Condición de venta: Contado</span>
  </div>
  ${esNC ? `<div class="leyenda"><strong>Comprobante que anula:</strong> Factura ${escHtml(inv.invoice_type)} ${formatCbteNro(associatedInvoice?.cbte_nro ?? null, associatedInvoice?.punto_venta ?? inv.punto_venta)}</div>` : ""}
  ${leyendaHtml}
  <table>
    <thead><tr>
      <th>Código</th><th>Producto / Servicio</th><th class="num">Cant.</th><th>U. medida</th>
      <th class="num">Precio Unit.</th><th class="num">% Bonif</th><th class="num">Subtotal</th>
      ${discriminaIva ? `<th class="num">Alíc. IVA</th><th class="num">Subtotal c/IVA</th>` : ""}
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="totals">${totalsHtml}</div>
  ${caeBlock}
</body>
</html>`;
}

export default function FacturaPrint({ invoice, emisor, items, qrDataUrl: qrOverride, associatedInvoice, onClose }: Props) {
  const [printing, setPrinting] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(qrOverride ?? null);
  useEscapeToClose(onClose);

  useEffect(() => {
    if (qrOverride) { setQrDataUrl(qrOverride); return; }
    if (invoice.status === "autorizada" && invoice.cae) {
      buildAfipQrDataUrl(invoice, emisor.cuit).then(setQrDataUrl).catch(() => setQrDataUrl(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id, invoice.cae]);

  const html = buildFacturaHtml({ invoice, emisor, items, qrDataUrl, associatedInvoice, onClose });
  const esNC = invoice.credited_invoice_id != null;

  function doPrint() {
    setPrinting(true);
    printHtml(html, () => setPrinting(false));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl flex flex-col max-h-[92vh] w-[560px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{esNC ? "Nota de Crédito" : "Factura"} {invoice.invoice_type} · {formatCbteNro(invoice.cbte_nro, invoice.punto_venta)}</h3>
          <ModalCloseButton onClick={onClose} />
        </div>
        <div className="overflow-y-auto flex-1 bg-stone-100 p-4 flex justify-center">
          <div style={{ width: 520, height: 735, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.15)" }}>
            <iframe
              title="Vista previa de factura"
              srcDoc={html}
              style={{ width: 794, height: 1123, border: "none", transform: "scale(0.6549)", transformOrigin: "top left" }}
            />
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-stone-200">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cerrar</button>
          <button onClick={doPrint} disabled={printing} className="btn btn-primary flex-1 disabled:opacity-50">
            {printing ? "Imprimiendo…" : "🖨️ Imprimir / Guardar PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
