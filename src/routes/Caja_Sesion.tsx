import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime } from "@/lib/format";
import type { CashSession, CashMovement } from "@/types";
import { showToast } from "@/stores/dialogs";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import clsx from "clsx";

interface Props {
  session: CashSession;
  onClose: () => void;
  onClosed: () => void;
}

export function CashSessionPanel({ session, onClose, onClosed }: Props) {
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [ventasEfectivo, setVentasEfectivo] = useState(0);
  const [ventasTotal, setVentasTotal] = useState(0);
  const [showMovement, setShowMovement] = useState(false);
  const [showClose, setShowClose] = useState(false);

  async function loadMovements() {
    try {
      const [m, ef, total] = await Promise.all([
        api.listCashMovements(session.id),
        api.getSessionSalesTotal(session.id),
        api.getSessionAllSalesTotal(session.id),
      ]);
      setMovements(m);
      setVentasEfectivo(ef);
      setVentasTotal(total);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const ingresos = movements
    .filter((m) => m.movement_type === "ingreso")
    .reduce((s, m) => s + m.amount_cents, 0);

  const egresos = movements
    .filter((m) => m.movement_type === "egreso")
    .reduce((s, m) => s + m.amount_cents, 0);

  // Saldo físico = apertura + ventas en efectivo + ingresos manuales - egresos
  const saldoEsperado = session.opening_cents + ventasEfectivo + ingresos - egresos;
  // Desactivado mientras hay un modal encima (Movimiento/Cerrar caja): si no, un solo
  // Escape cerraría los dos a la vez, sin dar chance de confirmar el de arriba.
  useEscapeToClose(onClose, !showMovement && !showClose);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="relative bg-white rounded-lg shadow-xl w-[560px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalCloseButton onClick={onClose} />
        <div className="p-5 border-b border-stone-200">
          <div className="flex items-center justify-between pr-6">
            <h2 className="text-lg font-semibold">Sesión de caja #{session.id}</h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
              Abierta
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Abierta: {formatDateTime(session.opened_at)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 border-b border-stone-200">
          <div className="bg-stone-50 rounded-md p-3">
            <div className="text-xs text-stone-500">Apertura</div>
            <div className="font-semibold tabular mt-0.5">{centsToARS(session.opening_cents)}</div>
          </div>
          <div className="bg-indigo-50 rounded-md p-3">
            <div className="text-xs text-indigo-700">Ventas (todas)</div>
            <div className="font-semibold tabular text-indigo-700 mt-0.5">{centsToARS(ventasTotal)}</div>
          </div>
          <div className="bg-emerald-50 rounded-md p-3">
            <div className="text-xs text-emerald-700">Ventas efectivo</div>
            <div className="font-semibold tabular text-emerald-700 mt-0.5">{centsToARS(ventasEfectivo)}</div>
          </div>
          <div className="col-span-1 grid grid-cols-2 gap-2">
            <div className="bg-emerald-50 rounded-md p-3">
              <div className="text-xs text-emerald-700">+ Ingresos</div>
              <div className="font-semibold tabular text-emerald-700 mt-0.5">{centsToARS(ingresos)}</div>
            </div>
            <div className="bg-red-50 rounded-md p-3">
              <div className="text-xs text-red-700">− Egresos</div>
              <div className="font-semibold tabular text-red-700 mt-0.5">{centsToARS(egresos)}</div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-stone-200 flex items-center justify-between">
          <div>
            <span className="text-sm text-stone-600">Saldo esperado en caja:</span>
            <span className="ml-2 font-semibold tabular text-lg">{centsToARS(saldoEsperado)}</span>
          </div>
          <button
            onClick={() => setShowMovement(true)}
            className="btn btn-secondary text-sm"
          >
            + Movimiento
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {movements.length === 0 ? (
            <p className="text-center text-stone-400 text-sm py-4">Sin movimientos extra</p>
          ) : (
            <ul className="space-y-1.5">
              {movements.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between text-sm py-2 border-b border-stone-100"
                >
                  <div>
                    <span
                      className={clsx(
                        "text-xs font-medium px-1.5 py-0.5 rounded mr-2",
                        m.movement_type === "ingreso"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      )}
                    >
                      {m.movement_type}
                    </span>
                    {m.concept}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={clsx("tabular font-medium", m.movement_type === "ingreso" ? "text-emerald-700" : "text-red-700")}>
                      {m.movement_type === "egreso" ? "−" : "+"}{centsToARS(m.amount_cents)}
                    </span>
                    <span className="text-xs text-stone-400">{formatDateTime(m.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5 border-t border-stone-200 flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">
            Cerrar panel
          </button>
          <button
            onClick={() => setShowClose(true)}
            className="btn flex-1 bg-red-600 text-white hover:bg-red-700"
          >
            Cerrar caja
          </button>
        </div>
      </div>

      {showMovement && (
        <MovementForm
          sessionId={session.id}
          onCancel={() => setShowMovement(false)}
          onSaved={() => {
            setShowMovement(false);
            loadMovements();
          }}
        />
      )}

      {showClose && (
        <CloseForm
          session={session}
          saldoEsperado={saldoEsperado}
          onCancel={() => setShowClose(false)}
          onClosed={onClosed}
        />
      )}
    </div>
  );
}

function MovementForm({
  sessionId,
  onCancel,
  onSaved,
}: {
  sessionId: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"ingreso" | "egreso">("ingreso");
  const [amountStr, setAmountStr] = useState("");
  const [concept, setConcept] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(onCancel);

  async function submit() {
    const amount = arsStringToCents(amountStr);
    if (amount <= 0 || !concept.trim()) return;
    setSaving(true);
    try {
      await api.addCashMovement({
        session_id: sessionId,
        movement_type: type,
        amount_cents: amount,
        concept: concept.trim(),
      });
      onSaved();
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo guardar el movimiento", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[380px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h3 className="font-semibold mb-4">Registrar movimiento</h3>

        <div className="flex gap-2 mb-4">
          {(["ingreso", "egreso"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={clsx(
                "flex-1 py-2 rounded-md text-sm font-medium border transition-colors capitalize",
                type === t
                  ? t === "ingreso"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-red-600 text-white border-red-600"
                  : "bg-stone-50 border-stone-200 hover:bg-stone-100"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="block mb-3">
          <span className="text-xs font-medium text-stone-600 block mb-1">Monto ($)</span>
          <input
            autoFocus
            className="input tabular text-right h-12 text-lg"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            inputMode="numeric"
          />
        </label>

        <label className="block mb-5">
          <span className="text-xs font-medium text-stone-600 block mb-1">Concepto</span>
          <input
            className="input"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Ej: Pago de luz, retiro de fondo..."
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving}
            className={clsx(
              "btn flex-1 text-white",
              type === "ingreso" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            )}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseForm({
  session,
  saldoEsperado,
  onCancel,
  onClosed,
}: {
  session: CashSession;
  saldoEsperado: number;
  onCancel: () => void;
  onClosed: () => void;
}) {
  // Vacío a propósito: el arqueo tiene que reflejar lo que el cajero cuenta de verdad,
  // no lo que el sistema espera — precargarlo permitiría cerrar sin contar un solo billete.
  const [closingStr, setClosingStr] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(onCancel);

  const closingCents = arsStringToCents(closingStr);
  const diff = closingCents - saldoEsperado;

  async function submit() {
    setSaving(true);
    try {
      await api.closeCashSession({
        session_id: session.id,
        closing_cents: closingCents,
        notes: notes.trim() || null,
      });
      onClosed();
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo cerrar la caja", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h3 className="font-semibold mb-1">Cerrar caja</h3>
        <p className="text-sm text-stone-500 mb-5">Ingresá el efectivo contado al cierre.</p>

        <div className="bg-stone-50 rounded-md p-3 mb-4 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-stone-600">Saldo esperado</span>
            <span className="tabular font-medium">{centsToARS(saldoEsperado)}</span>
          </div>
        </div>

        <label className="block mb-3">
          <span className="text-xs font-medium text-stone-600 block mb-1">Efectivo contado ($)</span>
          <input
            autoFocus
            className="input tabular text-right h-12 text-lg"
            value={closingStr}
            onChange={(e) => setClosingStr(e.target.value)}
            inputMode="numeric"
          />
        </label>

        {closingStr && (
          <div className={clsx(
            "text-sm text-center py-2 rounded-md mb-4 font-medium",
            diff === 0 && "bg-emerald-50 text-emerald-700",
            diff > 0 && "bg-emerald-50 text-emerald-700",
            diff < 0 && "bg-red-50 text-red-700",
          )}>
            {diff === 0 && "Caja sin diferencias"}
            {diff > 0 && `Sobrante: ${centsToARS(diff)}`}
            {diff < 0 && `Faltante: ${centsToARS(Math.abs(diff))}`}
          </div>
        )}

        <label className="block mb-5">
          <span className="text-xs font-medium text-stone-600 block mb-1">Observaciones (opcional)</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas del cierre..."
          />
        </label>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving || !closingStr.trim()}
            className="btn flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Cerrando…" : "Confirmar cierre"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OpenFormProps {
  onCancel: () => void;
  onOpened: (session: CashSession) => void;
}

export function OpenCashForm({ onCancel, onOpened }: OpenFormProps) {
  const [amountStr, setAmountStr] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(onCancel);

  async function submit() {
    setSaving(true);
    try {
      const session = await api.openCashSession({
        opening_cents: arsStringToCents(amountStr),
        user_id: null,
        notes: notes.trim() || null,
      });
      onOpened(session);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ message: msg || "No se pudo abrir la caja", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[380px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h2 className="text-lg font-semibold mb-1">Abrir caja</h2>
        <p className="text-sm text-stone-500 mb-5">Ingresá el efectivo inicial en caja.</p>

        <label className="block mb-3">
          <span className="text-xs font-medium text-stone-600 block mb-1">Efectivo en caja ($)</span>
          <input
            autoFocus
            className="input tabular text-right h-14 text-2xl"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <label className="block mb-5">
          <span className="text-xs font-medium text-stone-600 block mb-1">Observaciones (opcional)</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas de apertura..."
          />
        </label>

        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving}
            className="btn btn-primary flex-1"
          >
            {saving ? "Abriendo…" : "Abrir caja"}
          </button>
        </div>
      </div>
    </div>
  );
}
