import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import mercalinLogo from "@/assets/mercalin-logo.svg";

export default function Login() {
  const setSession = useAuthStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.login(username.trim(), password);
      setSession(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  if (recuperando) {
    return (
      <RecuperarContrasena
        mailInicial={username}
        onVolver={() => setRecuperando(false)}
        onListo={(mail) => {
          setUsername(mail);
          setPassword("");
          setError(null);
          setAviso("Contraseña cambiada. Ya podés ingresar con la nueva.");
          setRecuperando(false);
        }}
      />
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-stone-100">
      <div className="w-full max-w-sm">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <img src={mercalinLogo} alt="Mercalin" className="h-14 mx-auto mb-4" />
          <p className="text-stone-500 text-sm mt-1">Iniciá sesión para continuar</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {aviso && (
              <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg px-4 py-3 text-sm" role="status">
                {aviso}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Usuario
              </label>
              <input
                type="text"
                autoFocus
                className="input w-full"
                placeholder="vos@tunegocio.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                className="input w-full"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-orange-50 text-orange-700 border border-orange-200 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40"
            >
              {loading ? "Ingresando…" : "Ingresar"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setAviso(null);
              setRecuperando(true);
            }}
            className="block w-full text-center text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 mt-5"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>
      </div>
    </div>
  );
}

// Recuperación sin internet: la clave de activación (la del mail de la prueba
// o de la compra) prueba que es el dueño de esta instalación, y con eso elige
// una contraseña nueva. Ver reset_password_with_license_key en users.rs.
function RecuperarContrasena({
  mailInicial,
  onVolver,
  onListo,
}: {
  mailInicial: string;
  onVolver: () => void;
  onListo: (mail: string) => void;
}) {
  const [email, setEmail] = useState(mailInicial.includes("@") ? mailInicial : "");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noCoinciden = password2.length > 0 && password !== password2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !key.trim() || !password) return;
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
      await api.resetPasswordWithLicenseKey(email.trim(), key.trim(), password);
      onListo(email.trim().toLowerCase());
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
          <p className="text-stone-500 text-sm mt-1">
            Elegí una contraseña nueva. Para confirmar que sos vos, te pedimos la clave de activación que te llegó por mail.
          </p>
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
              <textarea
                className="input w-full font-mono text-xs break-all"
                rows={3}
                placeholder="Pegá acá la clave que te mandamos por mail"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Contraseña nueva</label>
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
              disabled={loading || !email.trim() || !key.trim() || !password || !password2}
              className="btn btn-primary w-full py-2.5 text-base disabled:opacity-40"
            >
              {loading ? "Cambiando…" : "Cambiar contraseña"}
            </button>
          </form>

          <button
            type="button"
            onClick={onVolver}
            className="block w-full text-center text-sm text-stone-500 hover:text-stone-800 underline underline-offset-2 mt-5"
          >
            Volver a iniciar sesión
          </button>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">
          ¿No encontrás el mail con la clave? Escribinos y te la reenviamos.
        </p>
      </div>
    </div>
  );
}
