import { openUrl } from "@tauri-apps/plugin-opener";

// Mismo número que usa el sitio (mercalinonline-web/src/lib/whatsapp.ts) --
// un solo lugar real de contacto para todo lo que es Mercalin.
const SUPPORT_WHATSAPP_NUMBER = "542344502904";

function supportWhatsappUrl(message: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export async function openSupportWhatsapp(message: string): Promise<void> {
  await openUrl(supportWhatsappUrl(message));
}
