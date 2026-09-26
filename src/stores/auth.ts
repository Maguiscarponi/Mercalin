import { create } from "zustand";
import { api } from "@/lib/api";
import type { LoginResult, User } from "@/types";

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
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  sessionToken: null,
  setSession: (result) => set({ user: result.user, sessionToken: result.session_token }),
  logout: () => {
    const token = get().sessionToken;
    if (token) api.logout(token).catch(() => { /* best-effort: igual se limpia local */ });
    set({ user: null, sessionToken: null });
  },
}));
