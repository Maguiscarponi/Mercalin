import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { SESSION_LOST_EVENT } from "./shims/core";
import WebEntry from "./WebEntry";
import { webApi, type WebAccount } from "./webApi";
import { invoke } from "@tauri-apps/api/core";

// Envuelve la app en la versión web: si este navegador no entró a ninguna
// cuenta, muestra la pantalla de entrada/registro. Si entró recién (registro,
// link desde la web o código al mail), entra directo como dueño, sin pedir
// contraseña.
interface WebContextValue {
  account: WebAccount;
  refresh: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
}

const WebContext = createContext<WebContextValue | null>(null);

export function useWebAccount(): WebContextValue | null {
  return useContext(WebContext);
}

export default function WebGate({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<WebAccount | null>(null);
  const [status, setStatus] = useState<"cargando" | "afuera" | "adentro">("cargando");
  const setSession = useAuthStore((s) => s.setSession);

  const refresh = useCallback(async () => {
    const me = await webApi.me();
    if (!me) {
      useAuthStore.getState().clearLocal();
      setAccount(null);
      setStatus("afuera");
      return;
    }
    setAccount(me.account);
    if (me.ownerPending) {
      const result = await webApi.ownerLogin();
      if (result) setSession(result);
    } else {
      // Sesión guardada de una visita anterior: se confirma que el servidor
      // la siga reconociendo (se pierde si el servidor se reinició).
      const token = useAuthStore.getState().sessionToken;
      if (token) {
        const valida = await invoke<boolean>("web_session_valid", { sessionToken: token }).catch(() => false);
        if (!valida) useAuthStore.getState().clearLocal();
      }
    }
    // Saca ?email=, ?registro= etc. de la barra de direcciones.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    setStatus("adentro");
  }, [setSession]);

  const signOutEverywhere = useCallback(async () => {
    useAuthStore.getState().logout();
    await webApi.logout();
    setAccount(null);
    setStatus("afuera");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onLost = () => {
      useAuthStore.getState().clearLocal();
      setAccount(null);
      setStatus("afuera");
    };
    window.addEventListener(SESSION_LOST_EVENT, onLost);
    return () => window.removeEventListener(SESSION_LOST_EVENT, onLost);
  }, []);

  if (status === "cargando") return <div className="h-[100dvh] bg-stone-100" />;
  if (status === "afuera" || !account) return <WebEntry onEntered={refresh} />;

  return <WebContext.Provider value={{ account, refresh, signOutEverywhere }}>{children}</WebContext.Provider>;
}
