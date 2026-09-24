import type { CondicionIva, CondicionIvaCliente, InvoiceType } from "@/types";

// Reglas reales de ARCA para decidir qué factura corresponde emitir, según
// investigación de la normativa vigente (no es un criterio que inventamos):
//
// - Monotributista (vendedor) -> SIEMPRE Factura C, sea quien sea el
//   comprador. No discrimina IVA nunca.
// - Responsable Inscripto (vendedor) que le vende a un Responsable Inscripto
//   O a un Monotributista -> Factura A con IVA discriminado. Esto cambió en
//   julio de 2021 (Ley 27.618 / RG AFIP 5003/2021): antes se facturaba B a
//   los monotributistas, ahora es A. Si el receptor es monotributista, la
//   factura A además tiene que llevar una leyenda obligatoria.
// - Responsable Inscripto que le vende a Consumidor Final o Exento ->
//   Factura B (no se discrimina IVA en el papel, aunque ARCA sí recibe el
//   desglose).
//
// El campo CondicionIVAReceptorId es obligatorio desde la RG 5616/2024 y
// tiene una tabla fija de valores por tipo de comprobante (fuente: manual
// del desarrollador de ARCA / documentación pública de la RG):
//   Factura A: 1=Responsable Inscripto, 6=Responsable Monotributo
//   Factura B/C: 4=Exento, 5=Consumidor Final
export const CONDICION_IVA_RECEPTOR_ID: Record<CondicionIvaCliente, number> = {
  responsable_inscripto: 1,
  monotributo: 6,
  exento: 4,
  consumidor_final: 5,
};

export const LEYENDA_FACTURA_A_MONOTRIBUTO =
  "El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.";

export interface InvoiceDecision {
  invoiceType: InvoiceType;
  condicionIvaReceptorId: number;
  legend: string | null;
}

export function decideInvoiceType(sellerCondicionIva: CondicionIva, buyerCondicionIva: CondicionIvaCliente | null | undefined): InvoiceDecision {
  const buyer: CondicionIvaCliente = buyerCondicionIva || "consumidor_final";
  const condicionIvaReceptorId = CONDICION_IVA_RECEPTOR_ID[buyer];

  if (sellerCondicionIva === "monotributo") {
    return { invoiceType: "C", condicionIvaReceptorId, legend: null };
  }
  if (buyer === "responsable_inscripto" || buyer === "monotributo") {
    return { invoiceType: "A", condicionIvaReceptorId, legend: buyer === "monotributo" ? LEYENDA_FACTURA_A_MONOTRIBUTO : null };
  }
  return { invoiceType: "B", condicionIvaReceptorId, legend: null };
}

const CONDICION_IVA_RECEPTOR_LABEL: Record<number, string> = {
  1: "IVA Responsable Inscripto",
  6: "Responsable Monotributo",
  4: "IVA Sujeto Exento",
  5: "Consumidor Final",
};

export function labelForCondicionIvaReceptorId(id: number): string {
  return CONDICION_IVA_RECEPTOR_LABEL[id] || "Consumidor Final";
}

export function condicionIvaClienteLabel(c: CondicionIvaCliente): string {
  switch (c) {
    case "responsable_inscripto": return "Responsable Inscripto";
    case "monotributo": return "Monotributista";
    case "exento": return "Exento";
    default: return "Consumidor Final";
  }
}
