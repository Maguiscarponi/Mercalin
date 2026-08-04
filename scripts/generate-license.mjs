#!/usr/bin/env node
// Genera la clave de activación para un mail de comprador. Uso:
//
//   node scripts/generate-license.mjs mail@cliente.com
//
// El algoritmo tiene que ser IDÉNTICO al de compute_license_key() en
// src-tauri/src/commands/device.rs — incluido LICENSE_SECRET. Si tocás uno,
// tocá el otro, o las claves generadas acá van a dejar de servir.
import { createHash } from "node:crypto";

const LICENSE_SECRET = "1a111bf2ce775a006aaeadbb1cfeeda87b1f92592ea2a86425bec8530f3dce47";

function computeLicenseKey(email) {
  const normalized = email.trim().toLowerCase();
  const hash = createHash("sha256").update(`${LICENSE_SECRET}:${normalized}`).digest("hex");
  const code = hash.slice(0, 16).toUpperCase();
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("Uso: node scripts/generate-license.mjs mail@cliente.com");
  process.exit(1);
}

console.log("");
console.log(`Mail:  ${email.trim().toLowerCase()}`);
console.log(`Clave: ${computeLicenseKey(email)}`);
console.log("");
