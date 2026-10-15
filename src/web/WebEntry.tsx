import { useState } from "react";
import mercalinLogo from "@/assets/mercalin-logo.svg";
import CodeLogin from "./CodeLogin";
import { webApi } from "./webApi";

// Pantalla de entrada de la versión web: entrar con un código al mail, o
// registrarse para la prueba gratis (mail, negocio y teléfono opcional).
export default function WebEntry({ onEntered }: { onEntered: () => void | Promise<void> }) {
  const params = new URLSearchParams(window.location.search);
  const emailParam = params.get("email") ?? "";
  const [mode, setMode] = useState<"entrar" | "registro">(params.get("registro") ? "registro" : "entrar");
  const [prefill, setPrefill] = useState(emailParam);
  const linkVencido = params.get("entrada") === "vencida";

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={mercalinLogo} alt="Mercalin" className="h-14 mx-auto mb-4" />
          <p className="text-stone-500 text-sm mt-1">
            {mode === "entrar" ? "Entrá con tu mail. Te mandamos un código, sin contraseñas." : "Probá Mercalin 7 días gratis. Sin tarjeta."}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 sm:p-8">
          {linkVencido && mode === "entrar" && (
            <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-3 text-sm mb-5">
              El link para entrar ya se usó o venció. Pedí un código a tu mail y entrás igual.
            </div>
          )}
          {mode === "entrar" ? (
            <CodeLogin
              key={prefill}
              initialEmail={prefill}
              onVerified={onEntered}
              onNoAccount={(email) => {
                setPrefill(email);
                setMode("registro");
              }}
            />
          ) : (
            <Signup
              initialEmail={prefill}
              onCreated={onEntered}
              onExists={(email) => {
                setPrefill(email);
                setMode("entrar");
              }}
            />
          )}
        </div>

        <p className="text-center text-sm text-stone-500 mt-6">
          {mode === "entrar" ? (
            <>
              ¿Primera vez?{" "}
              <button type="button" className="font-medium text-stone-800 underline underline-offset-2" onClick={() => setMode("registro")}>
                Probá gratis 7 días
              </button>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta?{" "}
              <button type="button" className="font-medium text-stone-800 underline underline-offset-2" onClick={() => setMode("entrar")}>
                Entrá con tu mail
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Signup({
  initialEmail,
  onCreated,
  onExists,
}: {
  initialEmail: string;
  onCreated: () => void | Promise<void>;
  onExists: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existe, setExiste] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !businessName.trim()) return;
    setLoading(true);
    setError(null);
    setExiste(false);
    try {
      const { json } = await webApi.signup(email.trim(), businessName.trim(), phone.trim());
      if (json.exists) {
        setExiste(true);
        return;
      }
      if (!json.ok) {
        setError(json.error ?? "No se pudo crear la cuenta.");
        return;
      }
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium text-stone-700 mb-1.5">Tu mail</label>
        <input
          id="signup-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          className="input w-full"
          placeholder="vos@tunegocio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="signup-negocio" className="block text-sm font-medium text-stone-700 mb-1.5">Nombre del negocio</label>
        <input
          id="signup-negocio"
          type="text"
          autoComplete="organization"
          className="input w-full"
          placeholder="Ej: Kiosco Don Jorge"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="signup-tel" className="block text-sm font-medium text-stone-700 mb-1.5">
          Teléfono <span className="text-stone-400 font-normal">(opcional)</span>
        </label>
        <input
          id="signup-tel"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="input w-full"
          placeholder="Para ayudarte si lo necesitás"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={loading}
        />
      </div>
      {existe && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          Ya hay una cuenta con ese mail.{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onExists(email.trim())}>
            Entrá con un código
          </button>
        </div>
      )}
      {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <button type="submit" disabled={loading || !email.trim() || !businessName.trim()} className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
        {loading ? "Preparando tu Mercalin…" : "Empezar mi prueba gratis"}
      </button>
      <p className="text-xs text-stone-400 text-center">Ya viene con más de 7.500 productos cargados.</p>
    </form>
  );
}
