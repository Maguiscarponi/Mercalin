import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "@/stores/cart";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents } from "@/lib/format";
import { playError, playSuccess } from "@/lib/sound";
import { showToast } from "@/stores/dialogs";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import type { ArcaConfig, CondicionIva, ElectronicInvoice, PaymentMethod, PaymentSplit, Sale, SaleWithItems } from "@/types";
import clsx from "clsx";
import TicketPrint from "./TicketPrint";
import { decideInvoiceType } from "@/lib/facturacion";

// Arma los datos del comprobante y lo emite contra ARCA. El tipo de factura
// depende de la condición de IVA de quien vende (condicion_iva, configurada
// en Facturación → Configuración ARCA) y de la condición real de quien
// compra (el cliente asignado al carrito, si tiene uno) -- ver
// src/lib/facturacion.ts para las reglas completas (incluye Factura A
// obligatoria a monotributistas desde la Ley 27.618).
// El neto/IVA usa la misma cuenta que ya usa el ticket (TicketPrint.tsx) --
// no discriminar en C, 21% discriminado en A/B -- para que el número en el
// papel y el que le llega a ARCA sean siempre el mismo.
async function issueInvoiceForSale(sale: Sale, clientId: number | null, sellerCondicionIva: CondicionIva): Promise<ElectronicInvoice> {
  const client = clientId != null ? await api.getClient(clientId).catch(() => null) : null;
  const { invoiceType, condicionIvaReceptorId } = decideInvoiceType(sellerCondicionIva, client?.condicion_iva);

  const netoCents = invoiceType === "C" ? sale.total_cents : Math.round(sale.total_cents / 1.21);
  const ivaCents = sale.total_cents - netoCents;

  const dni = client?.dni?.replace(/\D/g, "") ?? "";
  const docTipo = dni.length === 11 ? 80 : dni.length > 0 ? 96 : 99;

  return api.issueElectronicInvoice({
    sale_id: sale.id,
    invoice_type: invoiceType,
    total_cents: sale.total_cents,
    neto_cents: invoiceType === "C" ? sale.total_cents : netoCents,
    iva_cents: invoiceType === "C" ? 0 : ivaCents,
    client_cuit: dni.length > 0 ? dni : null,
    client_name: client?.name ?? null,
    doc_tipo: docTipo,
    doc_nro: dni.length > 0 ? dni : "0",
    condicion_iva_receptor_id: condicionIvaReceptorId,
  });
}

const SINGLE_METHODS: { id: PaymentMethod; label: string; requiresClient?: boolean }[] = [
  { id: "efectivo",         label: "Efectivo" },
  { id: "debito",           label: "Débito" },
  { id: "credito",          label: "Crédito" },
  { id: "qr",               label: "QR / MP" },
  { id: "transferencia",    label: "Transferencia" },
  { id: "cuenta_corriente", label: "Cta. Cte.", requiresClient: true },
];

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo", debito: "Débito", credito: "Crédito",
  qr: "QR / MP", transferencia: "Transferencia",
  fiado: "Fiado", cuenta_corriente: "Cta. Cte.", mixto: "Mixto",
};

interface Props {
  totalCents: number;
  sessionId: number | null;
  isRi: boolean;
  onClose: () => void;
  onConfirmed: (sale: SaleWithItems) => void;
}

export default function PaymentModal({ totalCents, sessionId, isRi, onClose, onConfirmed }: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [splitMode, setSplitMode] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [paidInput, setPaidInput] = useState("");
  const [splits, setSplits] = useState<{ method: PaymentMethod; inputStr: string }[]>([
    { method: "efectivo", inputStr: "" },
    { method: "debito",   inputStr: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleWithItems | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [businessName, setBusinessName]   = useState("Punto Simple POS");
  const [businessAddress, setBusinessAddress] = useState("");
  const [ticketFooter, setTicketFooter]   = useState("¡Gracias por su compra!");
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null>(null);
  const [arcaConfigLoaded, setArcaConfigLoaded] = useState(false);
  const [invoice, setInvoice] = useState<ElectronicInvoice | null>(null);
  const [invoiceState, setInvoiceState] = useState<"idle" | "issuing" | "ok" | "error">("idle");
  const cart = useCart();
  const navigate = useNavigate();
  // Sin Escape en la pantalla de "venta confirmada": es intencional, para no
  // descartar sin querer el ticket recién cobrado antes de imprimirlo.
  useEscapeToClose(onClose, !completedSale);

  const isEffective = method === "efectivo";
  const isFiado     = method === "cuenta_corriente";
  const paidCents   = isEffective ? arsStringToCents(paidInput) : totalCents;
  const changeCents = Math.max(0, paidCents - totalCents);

  // Split totals
  const splitTotal  = splits.reduce((s, r) => s + arsStringToCents(r.inputStr), 0);
  const splitRemain = Math.max(0, totalCents - splitTotal);
  const canConfirmSingle = isFiado
    ? cart.client_id != null
    : isEffective ? paidCents >= totalCents : true;
  const canConfirmSplit = splitTotal >= totalCents && splits.some((s) => arsStringToCents(s.inputStr) > 0);
  const canConfirm = splitMode ? canConfirmSplit : canConfirmSingle;

  const quickOptions = (() => {
    const opts = new Set<number>([totalCents]);
    [1000, 2000, 5000, 10000, 20000, 50000].forEach((p) => {
      if (p * 100 >= totalCents) opts.add(p * 100);
    });
    return [...opts].slice(0, 5);
  })();

  useEffect(() => {
    Promise.all([
      api.getConfig("business_name"),
      api.getConfig("business_address"),
      api.getConfig("ticket_footer"),
    ]).then(([name, addr, footer]) => {
      if (name)   setBusinessName(name);
      if (addr)   setBusinessAddress(addr);
      if (footer) setTicketFooter(footer);
    }).catch(console.error);
    // Si ARCA está configurada (certificado cargado), después de cobrar se
    // intenta emitir el comprobante solo -- si esto falla (sin internet, sin
    // config completa, ARCA caída), la venta ya quedó guardada igual: no se
    // bloquea el cobro por un problema de facturación electrónica.
    api.getArcaConfig().then(setArcaConfig).catch(() => setArcaConfig(null)).finally(() => setArcaConfigLoaded(true));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (completedSale && !showTicket) {
        // Pantalla de éxito: Enter = imprimir, Escape = sin ticket, F = facturar
        if (e.key === "Enter") { e.preventDefault(); setShowTicket(true); }
        if (e.key === "Escape") { e.preventDefault(); onConfirmed(completedSale); }
        if (e.key.toLowerCase() === "f" && arcaConfig?.has_certificate && invoiceState !== "issuing" && invoiceState !== "ok") {
          e.preventDefault(); issueNow();
        }
        return;
      }
      if (e.key === "Escape" && !completedSale) { e.preventDefault(); onClose(); }
      if (e.key === "Enter" && canConfirm && !submitting && !completedSale) confirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canConfirm, submitting, completedSale, showTicket, arcaConfig, invoiceState]); // eslint-disable-line

  function updateSplit(i: number, field: "method" | "inputStr", value: string) {
    setSplits((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  async function confirm() {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    try {
      let finalMethod: PaymentMethod;
      let finalPaid: number;
      let notes: string | null = null;

      if (splitMode) {
        const activeSplits = splits.filter((s) => arsStringToCents(s.inputStr) > 0);
        if (activeSplits.length === 1) {
          finalMethod = activeSplits[0].method;
          finalPaid   = totalCents;
        } else {
          finalMethod = "mixto";
          finalPaid   = totalCents;
          const breakdown: PaymentSplit[] = activeSplits.map((s) => ({
            method: s.method,
            amount_cents: arsStringToCents(s.inputStr),
          }));
          notes = JSON.stringify({ split: breakdown });
        }
      } else {
        finalMethod = method;
        finalPaid   = paidCents;
      }

      const activeSplitsForSave = splitMode
        ? splits.filter((s) => arsStringToCents(s.inputStr) > 0)
        : null;

      const sale = await api.createSale({
        items: cart.items,
        payment_method: finalMethod,
        paid_cents: finalPaid,
        discount_cents: cart.discount_cents,
        client_id: cart.client_id,
        user_id: userId,
        notes,
        payments: activeSplitsForSave && activeSplitsForSave.length > 1
          ? activeSplitsForSave.map((s) => ({ method: s.method, amount_cents: arsStringToCents(s.inputStr) }))
          : null,
        session_id: sessionId,
      });
      const sw = await api.getSaleWithItems(sale.id);
      setCompletedSale(sw);
      playSuccess();

      // Se pide de nuevo la config acá (no se confía en el `arcaConfig` del
      // estado) porque si se cobra muy rápido (Enter apenas se abre el modal)
      // el fetch inicial puede no haber terminado todavía -- confiar en el
      // estado hacía que la factura se saltara en silencio, sin avisar nada.
      const freshArcaConfig = await api.getArcaConfig().catch(() => null);
      setArcaConfig(freshArcaConfig);
      if (freshArcaConfig?.has_certificate) {
        setInvoiceState("issuing");
        try {
          const emitted = await issueInvoiceForSale(sw.sale, cart.client_id, freshArcaConfig.condicion_iva);
          setInvoice(emitted);
          setInvoiceState(emitted.status === "autorizada" ? "ok" : "error");
        } catch (invErr) {
          // No se bloquea el cobro por esto -- la venta ya está guardada.
          // Queda como pendiente/error en Facturación → Comprobantes, y
          // también se puede reintentar al toque acá mismo (botón "Facturar").
          console.error("No se pudo emitir la factura electrónica:", invErr);
          setInvoiceState("error");
        }
      }
    } catch (err) {
      console.error("Error al guardar la venta:", err);
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : "Error al guardar la venta.";
      playError();
      showToast({ message, tone: "danger" });
    } finally {
      setSubmitting(false);
    }
  }

  // Botón "Facturar" de la pantalla de éxito: emite la factura ARCA de esta
  // venta al toque, a mano -- para cuando no se emitió sola (ARCA todavía no
  // configurada en ese momento, o falló y se quiere reintentar sin ir hasta
  // Facturación → Comprobantes).
  async function issueNow() {
    if (!completedSale || invoiceState === "issuing" || invoiceState === "ok") return;
    setInvoiceState("issuing");
    try {
      const freshArcaConfig = arcaConfig?.has_certificate ? arcaConfig : await api.getArcaConfig().catch(() => null);
      if (!freshArcaConfig?.has_certificate) {
        setInvoiceState("error");
        showToast({ message: "Facturación ARCA no está configurada. Configurala en Facturación → Configuración ARCA.", tone: "danger" });
        return;
      }
      setArcaConfig(freshArcaConfig);
      const emitted = await issueInvoiceForSale(completedSale.sale, cart.client_id, freshArcaConfig.condicion_iva);
      setInvoice(emitted);
      setInvoiceState(emitted.status === "autorizada" ? "ok" : "error");
    } catch (e) {
      console.error("No se pudo emitir la factura electrónica:", e);
      setInvoiceState("error");
    }
  }

  if (completedSale && showTicket) {
    return (
      <TicketPrint
        sale={completedSale.sale}
        items={completedSale.items}
        businessName={businessName}
        businessAddress={businessAddress}
        ticketFooter={ticketFooter}
        isRi={isRi}
        invoice={invoice}
        sellerCuit={arcaConfig?.cuit}
        onClose={() => { setShowTicket(false); onConfirmed(completedSale); }}
      />
    );
  }

  if (completedSale) {
    const sw = completedSale;
    const splitData: PaymentSplit[] | null = (() => {
      try { return sw.sale.notes ? JSON.parse(sw.sale.notes).split ?? null : null; } catch { return null; }
    })();
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-[380px] p-6 text-center">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h2 className="text-lg font-semibold text-emerald-700 mb-1">Venta confirmada</h2>
          <p className="text-sm text-stone-500 mb-1">Total cobrado: <strong>{centsToARS(totalCents)}</strong></p>
          {!splitMode && isEffective && changeCents > 0 && (
            <p className="text-base font-semibold text-emerald-600 mb-1">Vuelto: {centsToARS(changeCents)}</p>
          )}
          {splitData && (
            <div className="text-xs text-stone-500 space-y-0.5 mt-2">
              {splitData.map((s, i) => (
                <div key={i} className="flex justify-between px-4">
                  <span>{METHOD_LABELS[s.method] || s.method}</span>
                  <span>{centsToARS(s.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}
          {invoiceState === "issuing" && (
            <p className="text-xs text-stone-400 mt-2">Emitiendo factura electrónica…</p>
          )}
          {invoiceState === "ok" && invoice && (
            <p className="text-xs text-emerald-600 mt-2">
              ✓ Factura {invoice.invoice_type} autorizada — CAE {invoice.cae}
            </p>
          )}
          {invoiceState === "error" && (
            <p className="text-xs text-amber-600 mt-2">
              ⚠ No se pudo emitir la factura ahora. Podés reintentar acá abajo, o más tarde desde Facturación → Comprobantes.
            </p>
          )}
          {arcaConfig?.has_certificate && invoiceState !== "ok" && (
            <button
              onClick={issueNow}
              disabled={invoiceState === "issuing"}
              className="btn btn-secondary w-full mt-3 text-sm disabled:opacity-50"
            >
              {invoiceState === "issuing" ? "Emitiendo…" : invoiceState === "error" ? "🧾 Reintentar factura ARCA (F)" : "🧾 Facturar con ARCA (F)"}
            </button>
          )}
          {arcaConfigLoaded && !arcaConfig?.has_certificate && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 flex items-center justify-between gap-2">
              <span>⚠ Facturación ARCA no configurada — esta venta no tiene factura.</span>
              <button
                onClick={() => { onConfirmed(sw); navigate("/facturacion"); }}
                className="shrink-0 underline hover:no-underline font-medium"
              >
                Configurar
              </button>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={() => onConfirmed(sw)} className="btn btn-secondary flex-1">Sin ticket (Esc)</button>
            <button onClick={() => setShowTicket(true)} className="btn btn-primary flex-1">Imprimir ticket (Enter)</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[500px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="flex items-center justify-between mb-4 pr-8">
          <h2 className="text-lg font-semibold">Cobrar venta</h2>
          <button
            onClick={() => setSplitMode((m) => !m)}
            className={clsx(
              "text-xs px-2.5 py-1 rounded-md border transition-colors",
              splitMode ? "bg-violet-100 border-violet-300 text-violet-700" : "bg-stone-50 border-stone-200 text-stone-500 hover:bg-stone-100"
            )}
          >
            {splitMode ? "✓ Pago mixto activo" : "Pago mixto"}
          </button>
        </div>

        {arcaConfigLoaded && (
          arcaConfig?.has_certificate ? (
            <p className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5 mb-3">
              🧾 Esta venta se va a facturar con ARCA automáticamente al cobrar.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-3">
              <span>⚠ Facturación ARCA no configurada — esta venta no va a tener factura electrónica.</span>
              <button
                onClick={() => { onClose(); navigate("/facturacion"); }}
                className="shrink-0 underline hover:no-underline font-medium"
              >
                Configurar
              </button>
            </div>
          )
        )}

        {!splitMode ? (
          <>
            {/* Medios de pago simples */}
            <div className="grid grid-cols-3 gap-1.5 mb-4">
              {SINGLE_METHODS.map((m) => {
                const disabled = m.requiresClient && !cart.client_id;
                return (
                  <button
                    key={m.id}
                    onClick={() => !disabled && setMethod(m.id)}
                    title={disabled ? "Asigná un cliente para usar este método" : ""}
                    className={clsx(
                      "py-2 rounded-md text-xs border transition-colors",
                      method === m.id
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : disabled
                        ? "bg-stone-50 border-stone-200 text-stone-300 cursor-not-allowed"
                        : "bg-stone-50 border-stone-200 hover:bg-stone-100"
                    )}
                  >
                    {m.label}
                    {m.requiresClient && !cart.client_id && (
                      <span className="block text-[10px] text-stone-400">necesita cliente</span>
                    )}
                  </button>
                );
              })}
            </div>

            {isEffective && (
              <>
                <input
                  type="text" autoFocus
                  className="input h-14 text-2xl text-right tabular mb-2"
                  placeholder="0"
                  value={paidInput}
                  onChange={(e) => setPaidInput(e.target.value)}
                  inputMode="numeric"
                />
                <div className="flex flex-wrap gap-1.5">
                  {quickOptions.map((c) => (
                    <button key={c} onClick={() => setPaidInput((c / 100).toString())}
                      className="px-2.5 py-1 text-xs bg-stone-100 hover:bg-stone-200 rounded tabular">
                      {centsToARS(c)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {isFiado && cart.client_name && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm text-amber-800">
                Se registrará deuda a cargo de <strong>{cart.client_name}</strong>
              </div>
            )}
          </>
        ) : (
          /* Pago mixto */
          <div className="space-y-2 mb-4">
            <p className="text-xs text-stone-500 mb-2">Distribuí el total entre los medios de pago:</p>
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={s.method}
                  onChange={(e) => updateSplit(i, "method", e.target.value)}
                  className="input text-sm flex-1"
                >
                  {SINGLE_METHODS.filter((m) => !m.requiresClient).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="input text-right tabular w-32 text-sm"
                  placeholder="$0"
                  value={s.inputStr}
                  onChange={(e) => updateSplit(i, "inputStr", e.target.value)}
                  inputMode="numeric"
                />
                {splits.length > 2 && (
                  <button onClick={() => setSplits((p) => p.filter((_, idx) => idx !== i))}
                    className="text-stone-400 hover:text-orange-600">×</button>
                )}
              </div>
            ))}
            {splits.length < 4 && (
              <button
                onClick={() => setSplits((p) => [...p, { method: "qr", inputStr: "" }])}
                className="text-xs text-emerald-600 hover:underline"
              >+ Agregar medio</button>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-stone-100">
              <span className="text-stone-500">Asignado</span>
              <span className="tabular font-medium">{centsToARS(splitTotal)}</span>
            </div>
            {splitRemain > 0 && (
              <div className="flex justify-between text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded">
                <span>Falta asignar</span>
                <span className="tabular font-medium">{centsToARS(splitRemain)}</span>
              </div>
            )}
          </div>
        )}

        {/* Resumen */}
        <div className="mt-4 space-y-1.5 text-sm border-t border-stone-100 pt-3">
          {cart.discount_cents > 0 && (
            <div className="flex justify-between text-stone-500">
              <span>Descuento</span>
              <span className="tabular text-amber-600">− {centsToARS(cart.discount_cents)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="tabular text-lg">{centsToARS(totalCents)}</span>
          </div>
          {!splitMode && isEffective && paidCents > 0 && (
            <>
              <div className="flex justify-between text-stone-500">
                <span>Recibido</span><span className="tabular">{centsToARS(paidCents)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold pt-1 border-t border-stone-200">
                <span>Vuelto</span>
                <span className="tabular text-emerald-600">{centsToARS(changeCents)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancelar (Esc)</button>
          <button
            onClick={confirm}
            disabled={!canConfirm || submitting}
            className="btn btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Guardando…" : "Confirmar (Enter)"}
          </button>
        </div>
      </div>
    </div>
  );
}
