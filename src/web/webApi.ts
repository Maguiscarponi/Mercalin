// Llamadas propias de la versión web (cuenta, entrada con código, registro).
// Todo lo demás (ventas, stock, etc.) va por el mismo `invoke` que la app de
// escritorio (ver src/web/shims/core.ts).
import type { LoginResult } from "@/types";

export interface WebAccount {
  email: string;
  businessName: string;
  phone: string | null;
  plan: "prueba" | "mensual" | "baja";
  createdAt: number;
  trialEndsAt: number;
  expired: boolean;
}

type Json = Record<string, unknown>;

async function post<T = Json>(url: string, body?: unknown): Promise<{ status: number; json: T & { ok?: boolean; error?: string } }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error("No hay conexión a internet. Revisá la conexión y probá de nuevo.");
  }
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { status: res.status, json };
}

export const webApi = {
  async me(): Promise<{ account: WebAccount; ownerPending: boolean } | null> {
    try {
      const res = await fetch("/api/web/me", { credentials: "same-origin" });
      if (!res.ok) return null;
      const json = await res.json();
      return { account: json.account, ownerPending: !!json.ownerPending };
    } catch {
      return null;
    }
  },

  async signup(email: string, businessName: string, phone: string) {
    return post<{ exists?: boolean }>("/api/web/signup", { email, businessName, phone: phone || null });
  },

  async requestCode(email: string) {
    return post<{ noAccount?: boolean; alreadySent?: boolean }>("/api/web/code/request", { email });
  },

  async verifyCode(email: string, code: string) {
    return post("/api/web/code/verify", { email, code });
  },

  async ownerLogin(): Promise<LoginResult | null> {
    const { json } = await post<{ data?: LoginResult }>("/api/web/owner-login");
    return json.ok && json.data ? json.data : null;
  },

  async logout() {
    await post("/api/web/logout").catch(() => {});
  },
};
