import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { centsToARS, formatDateTime, todayISO } from "@/lib/format";
import type { CashSession, CashMovement } from "@/types";
import { CashSessionPanel, OpenCashForm } from "./Caja_Sesion";
import clsx from "clsx";

export default function CajaGestion() {
  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);
  const [sessionMovements, setSessionMovements] = useState<CashMovement[]>([]);
  const [sessionSalesTotal, setSessionSalesTotal] = useState(0);
  const [sessionByMethod, setSessionByMethod] = useState<Record<string, number>>({});

  async function load() {
    const [cur, hist] = await Promise.all([
      api.getCurrentSession(),
      api.listCashSessions(20),
    ]);
    setSession(cur);
    setSessions(hist);
  }

  useEffect(() => { load(); }, []);

  async function viewSession(s: CashSession) {
    setSelectedSession(s);
    setSessionSalesTotal(0);
    setSessionByMethod({});
    const fromDate = s.opened_at.split("T")[0];
    const toDate = s.closed_at ? s.closed_at.split("T")[0] : todayStr;
    const [m, salesTotal, report] = await Promise.all([
      api.listCashMovements(s.id),
      api.getSessionAllSalesTotal(s.id),
      api.rangeReport(fromDate, toDate),
    ]);
    setSessionMovements(m);
    setSessionSalesTotal(salesTotal);
    setSessionByMethod(report.by_method);
  }

  // Calcular totales de una sesión cerrada
  function sessionStats(s: CashSession, movements: CashMovement[]) {
    const ingresos = movements.filter((m) => m.movement_type === "ingreso").reduce((a, m) => a + m.amount_cents, 0);
    const egresos = movements.filter((m) => m.movement_type === "egreso").reduce((a, m) => a + m.amount_cents, 0);
    const expected = s.opening_cents + ingresos - egresos;
    const diff = s.closing_cents != null ? s.closing_cents - expected : null;
    return { ingresos, egresos, expected, diff };
  }

  const todayStr = todayISO();

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Gestión de Caja</h1>
        {session === undefined ? null : session ? (
          <button onClick={() => setShowPanel(true)} className="btn btn-primary">
            Ver caja abierta
          </button>
        ) : (
          <button onClick={() => setShowOpen(true)} className="btn btn-primary">
            Abrir caja
          </button>
        )}
      </div>

      {/* Estado actual */}
      {session && (
        <div className="card p-4 border-emerald-200 bg-emerald-50">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-medium text-emerald-800">Caja abierta desde {formatDateTime(session.opened_at)}</span>
              </div>
              <div className="text-sm text-emerald-700 mt-1">
                Apertura: {centsToARS(session.opening_cents)}
              </div>
            </div>
            <button
              onClick={() => setShowPanel(true)}
              className="btn text-sm bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Administrar
            </button>
          </div>
        </div>
      )}

      {session === null && (
        <div className="card p-4 border-stone-200 bg-stone-50 text-center">
          <p className="text-stone-600 text-sm">No hay caja abierta.</p>
          <button onClick={() => setShowOpen(true)} className="btn btn-primary mt-2 mx-auto">
            Abrir caja ahora
          </button>
        </div>
      )}

      {/* Historial de sesiones */}
      <div className="card flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
          <h2 className="font-medium text-sm">Historial de sesiones</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-500 uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Sesión</th>
              <th className="text-left px-4 py-2.5 font-medium">Apertura</th>
              <th className="text-left px-4 py-2.5 font-medium">Cierre</th>
              <th className="text-right px-4 py-2.5 font-medium">Fondo inicial</th>
              <th className="text-right px-4 py-2.5 font-medium">Cierre</th>
              <th className="text-center px-4 py-2.5 font-medium">Estado</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-stone-400">Sin sesiones registradas</td></tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-4 py-2.5 font-mono text-xs text-stone-400">#{s.id}</td>
                <td className="px-4 py-2.5 text-xs">{formatDateTime(s.opened_at)}</td>
                <td className="px-4 py-2.5 text-xs text-stone-500">
                  {s.closed_at ? formatDateTime(s.closed_at) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular">{centsToARS(s.opening_cents)}</td>
                <td className="px-4 py-2.5 text-right tabular">
                  {s.closing_cents != null ? centsToARS(s.closing_cents) : "—"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={clsx(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    s.status === "open"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-stone-100 text-stone-600"
                  )}>
                    {s.status === "open" ? "Abierta" : "Cerrada"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <button onClick={() => viewSession(s)} className="btn-table-success">Ver</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPanel && session && (
        <CashSessionPanel
          session={session}
          onClose={() => setShowPanel(false)}
          onClosed={() => { setShowPanel(false); load(); }}
        />
      )}

      {showOpen && (
        <OpenCashForm
          onCancel={() => setShowOpen(false)}
          onOpened={(s) => { setSession(s); setShowOpen(false); load(); }}
        />
      )}

      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          movements={sessionMovements}
          salesTotal={sessionSalesTotal}
          byMethod={sessionByMethod}
          onClose={() => { setSelectedSession(null); setSessionMovements([]); setSessionSalesTotal(0); setSessionByMethod({}); }}
        />
      )}
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo", debito: "Débito", credito: "Crédito",
  qr: "QR / MP", transferencia: "Transferencia",
  cuenta_corriente: "Cta. Cte.", mixto: "Mixto", fiado: "Fiado",
};

function SessionDetailModal({
  session, movements, salesTotal, byMethod, onClose,
}: {
  session: CashSession;
  movements: CashMovement[];
  salesTotal: number;
  byMethod: Record<string, number>;
  onClose: () => void;
}) {
  const ingresos = movements.filter((m) => m.movement_type === "ingreso").reduce((a, m) => a + m.amount_cents, 0);
  const egresos = movements.filter((m) => m.movement_type === "egreso").reduce((a, m) => a + m.amount_cents, 0);
  const efectivoVentas = byMethod["efectivo"] ?? 0;
  const expected = session.opening_cents + efectivoVentas + ingresos - egresos;
  const diff = session.closing_cents != null ? session.closing_cents - expected : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[540px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200">
          <h2 className="font-semibold">Sesión #{session.id}</h2>
          <p className="text-xs text-stone-400 mt-0.5">
            {formatDateTime(session.opened_at)}
            {session.closed_at && ` → ${formatDateTime(session.closed_at)}`}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3 p-5 border-b border-stone-200">
          <MiniStat label="Apertura" value={centsToARS(session.opening_cents)} />
          <MiniStat label="Ventas totales" value={centsToARS(salesTotal)} color="text-indigo-700" />
          <MiniStat label="Ingresos man." value={centsToARS(ingresos)} color="text-emerald-700" />
          <MiniStat label="Egresos man." value={centsToARS(egresos)} color="text-red-700" />
        </div>

        {Object.keys(byMethod).length > 0 && (
          <div className="px-5 py-3 border-b border-stone-200">
            <div className="text-xs uppercase font-semibold text-stone-500 mb-2">Ventas por método</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byMethod).map(([k, v]) => (
                <div key={k} className="bg-stone-50 rounded px-2.5 py-1.5 text-xs">
                  <span className="text-stone-500">{METHOD_LABEL[k] || k}</span>
                  <span className="ml-1.5 font-semibold tabular">{centsToARS(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {session.closing_cents != null && diff != null && (
          <div className={clsx(
            "mx-5 mt-4 py-2 px-3 rounded-md text-sm text-center font-medium",
            diff === 0 && "bg-emerald-50 text-emerald-700",
            diff > 0 && "bg-emerald-50 text-emerald-700",
            diff < 0 && "bg-red-50 text-red-700",
          )}>
            Cierre: {centsToARS(session.closing_cents)} ·{" "}
            {diff === 0 && "Sin diferencia"}
            {diff > 0 && `Sobrante: ${centsToARS(diff)}`}
            {diff < 0 && `Faltante: ${centsToARS(Math.abs(diff))}`}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="text-xs uppercase font-semibold text-stone-500 mb-2">Movimientos extra</h3>
          {movements.length === 0 ? (
            <p className="text-stone-400 text-sm text-center py-2">Sin movimientos extra</p>
          ) : (
            <ul className="space-y-1.5">
              {movements.map((m) => (
                <li key={m.id} className="flex justify-between text-sm py-1.5 border-b border-stone-100">
                  <div>
                    <span className={clsx(
                      "text-xs px-1.5 py-0.5 rounded mr-2 font-medium",
                      m.movement_type === "ingreso" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    )}>
                      {m.movement_type}
                    </span>
                    {m.concept}
                  </div>
                  <div className="flex gap-3 items-center">
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

        <div className="p-4 border-t border-stone-200">
          <button onClick={onClose} className="btn btn-secondary w-full">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = "" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-stone-50 rounded-md p-3">
      <div className="text-xs text-stone-500 mb-0.5">{label}</div>
      <div className={clsx("font-semibold tabular text-sm", color)}>{value}</div>
    </div>
  );
}
