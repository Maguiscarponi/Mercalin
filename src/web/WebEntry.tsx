import { useState } from "react";
import mercalinLogo from "@/assets/mercalin-logo.svg";
import type { LoginResult } from "@/types";
import RecoverPassword from "./RecoverPassword";
import { webApi } from "./webApi";

type Mode = "entrar" | "registro" | "recuperar";

// Pantalla de entrada de la versión web: entrar con mail y contraseña,
// registrarse para la prueba gratis, o recuperar la contraseña.
export default function WebEntry({ onEntered }: { onEntered: (login?: LoginResult) => void | Promise<void> }) {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<Mode>(params.get("registro") ? "registro" : "entrar");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const linkVencido = params.get("entrada") === "vencida";

  const subtitulo =
    mode === "registro"
      ? "Probá Mercalin 7 días gratis. Sin tarjeta."
      : mode === "recuperar"
        ? "Recuperá tu contraseña."
        : "Entrá a tu Mercalin.";

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={mercalinLogo} alt="Mercalin" className="h-14 mx-auto mb-4" />
          <p className="text-stone-500 text-sm mt-1">{subtitulo}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 sm:p-8">
          {linkVencido && mode === "entrar" && (
            <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-3 text-sm mb-5">
              El link para entrar ya se usó o venció. Entrá con tu mail y tu contraseña.
            </div>
          )}
          {mode === "entrar" && (
            <PasswordLogin
              initialEmail={email}
              onEntered={onEntered}
              onForgot={(mail) => {
                setEmail(mail);
                setMode("recuperar");
              }}
            />
          )}
          {mode === "registro" && (
            <Signup
              initialEmail={email}
              onCreated={onEntered}
              onExists={(mail) => {
                setEmail(mail);
                setMode("entrar");
              }}
            />
          )}
          {mode === "recuperar" && (
            <>
              <RecoverPassword
                initialEmail={email}
                onDone={onEntered}
                onNoAccount={(mail) => {
                  setEmail(mail);
                  setMode("registro");
                }}
              />
              <button
                type="button"
                className="block w-full text-center text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 mt-5"
                onClick={() => setMode("entrar")}
              >
                Volver
              </button>
            </>
          )}
        </div>

        {mode !== "recuperar" && (
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
                  Entrá
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function PasswordLogin({
  initialEmail,
  onEntered,
  onForgot,
}: {
  initialEmail: string;
  onEntered: (login?: LoginResult) => void | Promise<void>;
  onForgot: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const { json } = await webApi.login(email.trim(), password);
      if (!json.ok || !json.login) {
        setError(json.error ?? "Mail o contraseña incorrectos.");
        return;
      }
      await onEntered(json.login);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="login-email" className="block text-sm font-medium text-stone-700 mb-1.5">Mail</label>
        <input id="login-email" type="email" inputMode="email" autoComplete="email" autoFocus={!initialEmail}
          className="input w-full" placeholder="vos@tunegocio.com"
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor="login-pass" className="block text-sm font-medium text-stone-700 mb-1.5">Contraseña</label>
        <input id="login-pass" type="password" autoComplete="current-password" autoFocus={!!initialEmail}
          className="input w-full" placeholder="••••••"
          value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
      </div>
      {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <button type="submit" disabled={loading || !email.trim() || !password} className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
        {loading ? "Entrando…" : "Entrar"}
      </button>
      <button type="button" onClick={() => onForgot(email.trim())}
        className="block w-full text-center text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2">
        ¿Olvidaste tu contraseña?
      </button>
    </form>
  );
}

function Signup({
  initialEmail,
  onCreated,
  onExists,
}: {
  initialEmail: string;
  onCreated: (login?: LoginResult) => void | Promise<void>;
  onExists: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [businessName, setBusinessName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existe, setExiste] = useState(false);
  const noCoinciden = password2.length > 0 && password !== password2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !businessName.trim() || !password) return;
    if (password.length < 6) {
      setError("La contraseña tiene que tener al menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    setError(null);
    setExiste(false);
    try {
      const { json } = await webApi.signup(email.trim(), businessName.trim(), phone.trim(), password);
      if (json.exists) {
        setExiste(true);
        return;
      }
      if (!json.ok) {
        setError(json.error ?? "No se pudo crear la cuenta.");
        return;
      }
      await onCreated(json.login);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium text-stone-700 mb-1.5">Mail</label>
        <input id="signup-email" type="email" inputMode="email" autoComplete="email" autoFocus
          className="input w-full" placeholder="vos@tunegocio.com"
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor="signup-negocio" className="block text-sm font-medium text-stone-700 mb-1.5">Nombre del negocio</label>
        <input id="signup-negocio" type="text" autoComplete="organization"
          className="input w-full" placeholder="Ej: Kiosco Don Jorge"
          value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor="signup-pass" className="block text-sm font-medium text-stone-700 mb-1.5">Contraseña</label>
        <input id="signup-pass" type="password" autoComplete="new-password"
          className="input w-full" placeholder="Mínimo 6 caracteres"
          value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor="signup-pass2" className="block text-sm font-medium text-stone-700 mb-1.5">Repetí la contraseña</label>
        <input id="signup-pass2" type="password" autoComplete="new-password"
          className="input w-full"
          value={password2} onChange={(e) => setPassword2(e.target.value)} disabled={loading} />
        {noCoinciden && <p className="text-xs text-orange-600 mt-1">No coinciden.</p>}
      </div>
      <div>
        <label htmlFor="signup-tel" className="block text-sm font-medium text-stone-700 mb-1.5">
          Teléfono <span className="text-stone-400 font-normal">(opcional)</span>
        </label>
        <input id="signup-tel" type="tel" inputMode="tel" autoComplete="tel"
          className="input w-full" placeholder="Para ayudarte si lo necesitás"
          value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} />
      </div>
      {existe && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          Ya hay una cuenta con ese mail.{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onExists(email.trim())}>
            Entrá con tu contraseña
          </button>
        </div>
      )}
      {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <button type="submit" disabled={loading || !email.trim() || !businessName.trim() || !password || !password2}
        className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
        {loading ? "Preparando tu Mercalin…" : "Empezar mi prueba gratis"}
      </button>
      <p className="text-xs text-stone-400 text-center">Ya viene con más de 7.500 productos cargados.</p>
    </form>
  );
}
