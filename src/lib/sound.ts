// Sonido sintetizado con Web Audio API (sin archivos que empaquetar): confirmación
// audible de venta y aviso de error, pedido explícito del brief de auditoría UX —
// útil en un local ruidoso o cuando el cajero no está mirando la pantalla en el
// momento exacto del cobro. Preferencia por dispositivo (localStorage), no por
// cuenta: dos cajas en el mismo local pueden querer configuraciones distintas.
const STORAGE_KEY = "kiosco_sound_enabled";

let ctx: AudioContext | null = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== "0";

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => { /* ignore */ });
  return ctx;
}

function tone(freq: number, startOffset: number, duration: number, gain = 0.15) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const t0 = c.currentTime + startOffset;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(v: boolean) {
  enabled = v;
  localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
}

/** Blip corto y agudo — feedback de que un escaneo encontró el producto. */
export function playScan() {
  if (!enabled) return;
  try { tone(1046, 0, 0.07, 0.12); } catch { /* Web Audio no disponible: sin sonido, no rompe nada */ }
}

/** Campanita ascendente de dos notas — venta confirmada. */
export function playSuccess() {
  if (!enabled) return;
  try {
    tone(784, 0, 0.09, 0.15);
    tone(1175, 0.09, 0.16, 0.15);
  } catch { /* ignore */ }
}

/** Zumbido grave — error o bloqueo (sin stock, venta rechazada, código no encontrado). */
export function playError() {
  if (!enabled) return;
  try { tone(220, 0, 0.18, 0.15); } catch { /* ignore */ }
}
