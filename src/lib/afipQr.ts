import QRCode from "qrcode";
import type { ElectronicInvoice } from "@/types";

// El QR es obligatorio en cualquier comprobante con CAE (RG 4892/2020) --
// especificación en https://www.afip.gob.ar/fe/qr/especificaciones.asp.
// Es una URL con los datos del comprobante codificados en base64 adentro;
// cualquiera puede escanearlo y verificar el comprobante en el sitio de ARCA.
export async function buildAfipQrDataUrl(invoice: ElectronicInvoice, sellerCuit: string): Promise<string> {
  const payload = {
    ver: 1,
    fecha: invoice.created_at.slice(0, 10),
    cuit: Number(sellerCuit),
    ptoVta: invoice.punto_venta,
    tipoCmp: invoice.cbte_tipo,
    nroCmp: invoice.cbte_nro ?? 0,
    importe: invoice.total_cents / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: invoice.doc_tipo,
    nroDocRec: Number(invoice.client_cuit) || 0,
    tipoCodAut: "E",
    codAut: Number(invoice.cae) || 0,
  };
  const b64 = btoa(JSON.stringify(payload));
  const url = `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
  return QRCode.toDataURL(url, { margin: 0, width: 160 });
}
