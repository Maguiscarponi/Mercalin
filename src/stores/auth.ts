import { create } from "zustand";
import { api } from "@/lib/api";
import { IS_WEB } from "@/web/platform";
import type { LoginResult, User } from "@/types";

// En la web, recargar la página es normal (en la app de escritorio no pasa):
// el login de adentro se guarda en el navegador para no pedirlo cada vez.
const WEB_KEY = "mercalin_login";

function readSaved(): { user: User | null; sessionToken: string | null } {
  if (!IS_WEB) return { user: null, sessionToken: null };
  try {
    const raw = localStorage.getItem(WEB_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.user && saved?.sessionToken) return { user: saved.user, sessionToken: saved.sessionToken };
    }
  } catch {
    /* sin almacenamiento: se pide el login de nuevo */
  }
  return { user: null, sessionToken: null };
}

function save(user: User | null, sessionToken: string | null) {
  if (!IS_WEB) return;
  try {
    if (user && sessionToken) localStorage.setItem(WEB_KEY, JSON.stringify({ user, sessionToken }));
    else localStorage.removeItem(WEB_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

// Encontrado en la auditoría: las acciones de admin confiaban en un
// "actor_id" que el propio frontend elegía como argumento (el user.id de
// este store) -- ahora login/claim_admin_account devuelven además un token
// de sesión real, generado por el servidor, y es ESE token el que se manda
// en las acciones sensibles (ver los api.* que ahora piden sessionToken en
// vez de actorId). El user.id se sigue guardando para mostrar quién está
// logueado y para acciones que no son de admin (ej. atribuir una venta).
interface AuthState {
  user: User | null;
  sessionToken: string | null;
  setSession: (result: LoginResult) => void;
  logout: () => void;
  // Solo limpia en este navegador, sin avisar al servidor (sesión ya perdida).
  clearLocal: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...readSaved(),
  setSession: (result) => {
    save(result.user, result.session_token);
    set({ user: result.user, sessionToken: result.session_token });
  },
  logout: () => {
    const token = get().sessionToken;
    if (token) api.logout(token).catch(() => { /* best-effort: igual se limpia local */ });
    save(null, null);
    set({ user: null, sessionToken: null });
  },
  clearLocal: () => {
    save(null, null);
    set({ user: null, sessionToken: null });
  },
}));
