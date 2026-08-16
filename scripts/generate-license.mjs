#!/usr/bin/env node
// Genera una clave de activación. Uso:
//
//   node scripts/generate-license.mjs mail@cliente.com                → clave completa, no vence
//   node scripts/generate-license.mjs mail@cliente.com --trial        → clave de prueba, vence en 7 días desde AHORA
//   node scripts/generate-license.mjs mail@cliente.com --minutes 3    → clave de prueba corta (uso interno, para
//                                                                        probar la pantalla de bloqueo sin esperar
//                                                                        una semana real)
//
// El algoritmo tiene que ser IDÉNTICO al de build_payload/hmac_sign en
// src-tauri/src/commands/device.rs — incluido LICENSE_SECRET. Si tocás uno,
// tocá el otro, o las claves generadas acá van a dejar de servir.
import { createHmac } from "node:crypto";

const LICENSE_SECRET = process.env.LICENSE_SECRET;
if (!LICENSE_SECRET) {
  console.error("Falta la variable de entorno LICENSE_SECRET (la misma que usa device.rs para compilar).");
  process.exit(1);
}

const TRIAL_SECONDS = 7 * 24 * 60 * 60;

function b64url(buf) {
  return buf.toString("base64url");
}

function buildPayload(kind, email, expiresAt) {
  return `LICPAYLOAD1|${kind}|${email}|${expiresAt}`;
}

function generateLicenseKey(email, kind, expiresAt) {
  const payloadStr = buildPayload(kind, email, expiresAt);
  const sig = createHmac("sha256", LICENSE_SECRET).update(payloadStr).digest();
  return `${b64url(Buffer.from(payloadStr, "utf8"))}.${b64url(sig)}`;
}

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const minutesIdx = args.indexOf("--minutes");
const minutesOverride = minutesIdx !== -1 ? Number(args[minutesIdx + 1]) : null;
const isTrial = args.includes("--trial") || minutesOverride !== null;

if (!email || !email.includes("@") || email.includes("|")) {
  console.error("Uso: node scripts/generate-license.mjs mail@cliente.com [--trial | --minutes N]");
  process.exit(1);
}
if (minutesOverride !== null && (!Number.isFinite(minutesOverride) || minutesOverride <= 0)) {
  console.error("--minutes necesita un número positivo.");
  process.exit(1);
}

const kind = isTrial ? "trial" : "full";
const expiresAt = isTrial
  ? Math.floor(Date.now() / 1000) + (minutesOverride !== null ? Math.round(minutesOverride * 60) : TRIAL_SECONDS)
  : 0;

const key = generateLicenseKey(email, kind, expiresAt);

console.log("");
console.log(`Mail:  ${email}`);
console.log(`Tipo:  ${kind}${isTrial ? ` — expira ${new Date(expiresAt * 1000).toLocaleString("es-AR", { hour12: false })}` : " — no expira"}`);
console.log(`Clave: ${key}`);
console.log("");
