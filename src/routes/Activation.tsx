import { useState } from "react";
import { api } from "@/lib/api";

// Pantalla de activación: se muestra una sola vez, antes de poder usar la app
// en esta instalación. La clave se calcula a partir del mail (ver
// src-tauri/src/commands/device.rs) — no hace falta internet para validarla.
export default function Activation({ onActivated }: { onActivated: () => void }) {
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.activateLicense(email.trim(), key.trim());
      onActivated();
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
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl">🔑</span>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">Activar Punto Simple POS</h1>
          <p className="text-stone-500 text-sm mt-1">Ingresá el mail y la clave que recibiste por tu compra</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Mail</label>
              <input
                type="email"
                autoFocus
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

            {error && (
              <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !key.trim()}
              className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40"
            >
              {loading ? "Activando…" : "Activar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">
          ¿No tenés una clave? Escribinos para comprar Punto Simple POS.
        </p>
      </div>
    </div>
  );
}
