import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import mercalinLogo from "@/assets/mercalin-logo.svg";
import type { LicenseStatus } from "@/types";

// Pantalla de activación: se muestra una sola vez, antes de poder usar la app
// en esta instalación. La clave se calcula a partir del mail (ver
// src-tauri/src/commands/device.rs) — no hace falta internet para validarla.
// Además de activar, esta pantalla "adopta" la cuenta admin/admin de fábrica
// con el mail y la contraseña del comprador (claim_admin_account), así el
// login de todos los días es con datos reales, no con credenciales genéricas
// que cualquiera que instale la app conoce de antemano — y deja logueada a la
// persona en el mismo paso, sin una segunda pantalla de login redundante.
export default function Activation({ onActivated }: { onActivated: (status: LicenseStatus) => void }) {
  const setSession = useAuthStore((s) => s.setSession);
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  // Se pide dos veces: un error de tipeo acá dejaría a la persona sin poder
  // entrar al día siguiente, con una contraseña que nunca supo cuál fue.
  const [password2, setPassword2] = useState("");
  const noCoinciden = password2.length > 0 && password !== password2;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim() || !email.trim() || !key.trim() || !password) return;
    if (password.length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las dos contraseñas no coinciden. Escribilas de nuevo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const status = await api.activateLicense(email.trim(), key.trim());
      const result = await api.claimAdminAccount(email.trim(), password);
      // El nombre del negocio se guarda después de activar/loguear a propósito: si
      // la clave resulta inválida, no queremos haber tocado nada todavía.
      await api.setConfig({ key: "business_name", value: businessName.trim() });
      setSession(result);
      onActivated(status);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-stone-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={mercalinLogo} alt="Mercalin" className="h-14 mx-auto mb-4" />
          <p className="text-stone-500 text-sm mt-1">Activá tu cuenta — se hace una sola vez. Después ingresás con este mail y contraseña.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Nombre del negocio</label>
              <input
                type="text"
                autoFocus
                className="input w-full"
                placeholder="Ej: Kiosco Don Jorge"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Mail</label>
              <input
                type="email"
                className="input w-full"
                placeholder="vos@tunegocio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Clave de activación</label>
              <input
                type="text"
                className="input w-full font-mono tracking-wider"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Elegí una contraseña</label>
              <input
                type="password"
                className="input w-full"
                placeholder="Mínimo 4 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Repetí la contraseña</label>
              <input
                type="password"
                className={`input w-full ${noCoinciden ? "border-orange-400" : ""}`}
                placeholder="La misma, para confirmar"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={loading}
                aria-invalid={noCoinciden}
              />
              {noCoinciden && <p className="text-xs text-orange-700 mt-1.5">Todavía no coinciden.</p>}
            </div>

            {error && (
              <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !businessName.trim() || !email.trim() || !key.trim() || !password || !password2}
              className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40"
            >
              {loading ? "Activando…" : "Activar y entrar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">
          ¿No tenés una clave? Escribinos para comprar Mercalin.
        </p>
      </div>
    </div>
  );
}
