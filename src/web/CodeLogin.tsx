import { useEffect, useRef, useState } from "react";
import { webApi } from "./webApi";

// Entrar con un código de 6 dígitos que llega al mail. Lo usan la pantalla de
// entrada de la web y el "Soy el dueño" del login de adentro de la app.
export default function CodeLogin({
  initialEmail = "",
  lockEmail = false,
  onVerified,
  onNoAccount,
}: {
  initialEmail?: string;
  lockEmail?: boolean;
  onVerified: () => void | Promise<void>;
  onNoAccount?: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function pedirCodigo(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      const { json } = await webApi.requestCode(email.trim());
      if (json.noAccount) {
        if (onNoAccount) onNoAccount(email.trim());
        else setError(json.error ?? "No hay una cuenta con ese mail.");
        return;
      }
      if (!json.ok) {
        setError(json.error ?? "No se pudo mandar el código.");
        return;
      }
      setStep("code");
      setAviso(json.alreadySent ? "Ya te mandamos un código hace un momento. Revisá tu mail." : `Te mandamos un código a ${email.trim()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = code.replace(/\D/g, "");
    if (limpio.length !== 6) {
      setError("El código tiene 6 números.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { json } = await webApi.verifyCode(email.trim(), limpio);
      if (!json.ok) {
        setError(json.error ?? "El código no es correcto.");
        return;
      }
      await onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={pedirCodigo} className="space-y-5">
        <div>
          <label htmlFor="web-email" className="block text-sm font-medium text-stone-700 mb-1.5">Tu mail</label>
          <input
            id="web-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus={!lockEmail}
            className="input w-full"
            placeholder="vos@tunegocio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || lockEmail}
          />
        </div>
        {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
        <button type="submit" disabled={loading || !email.trim()} className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
          {loading ? "Mandando…" : "Mandame un código"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verificar} className="space-y-5">
      {aviso && <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg px-4 py-3 text-sm" role="status">{aviso}</div>}
      <div>
        <label htmlFor="web-code" className="block text-sm font-medium text-stone-700 mb-1.5">Código de 6 números</label>
        <input
          id="web-code"
          ref={codeRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          className="input w-full text-center text-2xl tracking-[0.4em] font-semibold"
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
          disabled={loading}
        />
      </div>
      {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <button type="submit" disabled={loading || code.length < 6} className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
        {loading ? "Entrando…" : "Entrar"}
      </button>
      <div className="flex justify-between text-sm">
        {!lockEmail ? (
          <button type="button" className="text-stone-500 hover:text-stone-800 underline underline-offset-2" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
            Cambiar mail
          </button>
        ) : <span />}
        <button type="button" className="text-stone-500 hover:text-stone-800 underline underline-offset-2" onClick={() => pedirCodigo()} disabled={loading}>
          Mandar otro código
        </button>
      </div>
    </form>
  );
}
