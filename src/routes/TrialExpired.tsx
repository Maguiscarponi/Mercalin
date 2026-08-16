import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/api";
import mercalinLogo from "@/assets/mercalin-logo.svg";
import type { LicenseStatus } from "@/types";

const STORE_URL = "https://mercalinonline.com";

// Pantalla de bloqueo cuando venció el período de prueba. No borra ni toca
// nada de la base local -- solo bloquea el acceso hasta pegar una clave
// completa (no vencida). Reusa activate_license tal cual (ver Activation.tsx):
// esa función solo pisa email/clave en device_config.json.
export default function TrialExpired({
  status,
  onUnlocked,
}: {
  status: LicenseStatus;
  onUnlocked: (status: LicenseStatus) => void;
}) {
  const [email, setEmail] = useState(status.email ?? "");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy() {
    try {
      await openUrl(STORE_URL);
    } catch {
      setError(`No se pudo abrir el navegador. Visitá ${STORE_URL} manualmente.`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const newStatus = await api.activateLicense(email.trim(), key.trim());
      if (newStatus.expired) {
        setError("Esa clave también está vencida. Necesitás una clave completa, no de prueba.");
        return;
      }
      onUnlocked(newStatus);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const expiredDate = status.expiresAt ? new Date(status.expiresAt * 1000).toLocaleDateString("es-AR") : null;

  return (
    <div className="h-screen flex items-center justify-center bg-stone-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={mercalinLogo} alt="Mercalin" className="h-14 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-stone-800">Tu prueba gratuita venció</h1>
          <p className="text-stone-500 text-sm mt-1">
            {expiredDate ? `Venció el ${expiredDate}. ` : ""}
            Tus datos siguen guardados acá — comprá para seguir usando Mercalin sin límites.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 space-y-6">
          <button type="button" onClick={handleBuy} className="btn btn-primary w-full py-2.5 text-base">
            Comprar ahora
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-stone-400">o si ya comprás</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Mail</label>
              <input
                type="email"
                className="input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Clave completa</label>
              <input
                type="text"
                className="input w-full font-mono text-xs break-all"
                placeholder="Pegá acá la clave que te mandamos"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !key.trim()}
              className="btn btn-secondary w-full py-2.5 disabled:opacity-40"
            >
              {loading ? "Activando…" : "Activar clave"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
