import { useState } from "react";
import type { LoginResult } from "@/types";
import CodeLogin from "./CodeLogin";
import { webApi } from "./webApi";

// "¿Olvidaste tu contraseña?": código de 6 números al mail y después una
// contraseña nueva. Termina con la persona adentro.
export default function RecoverPassword({
  initialEmail = "",
  lockEmail = false,
  onDone,
  onNoAccount,
}: {
  initialEmail?: string;
  lockEmail?: boolean;
  onDone: (login: LoginResult) => void | Promise<void>;
  onNoAccount?: (email: string) => void;
}) {
  const [step, setStep] = useState<"codigo" | "nueva">("codigo");

  if (step === "codigo") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-stone-500">Te mandamos un código a tu mail para que elijas una contraseña nueva.</p>
        <CodeLogin initialEmail={initialEmail} lockEmail={lockEmail} onVerified={() => setStep("nueva")} onNoAccount={onNoAccount} />
      </div>
    );
  }
  return <NewPassword onDone={onDone} />;
}

function NewPassword({ onDone }: { onDone: (login: LoginResult) => void | Promise<void> }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noCoinciden = password2.length > 0 && password !== password2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    try {
      const { json } = await webApi.setPassword(password);
      if (!json.ok || !json.login) {
        setError(json.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      await onDone(json.login);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="nueva-pass" className="block text-sm font-medium text-stone-700 mb-1.5">Contraseña nueva</label>
        <input id="nueva-pass" type="password" autoComplete="new-password" autoFocus className="input w-full" placeholder="Mínimo 6 caracteres"
          value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor="nueva-pass2" className="block text-sm font-medium text-stone-700 mb-1.5">Repetí la contraseña</label>
        <input id="nueva-pass2" type="password" autoComplete="new-password" className="input w-full"
          value={password2} onChange={(e) => setPassword2(e.target.value)} disabled={loading} />
        {noCoinciden && <p className="text-xs text-orange-600 mt-1">No coinciden.</p>}
      </div>
      {error && <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <button type="submit" disabled={loading || !password || !password2} className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40">
        {loading ? "Guardando…" : "Guardar y entrar"}
      </button>
    </form>
  );
}
