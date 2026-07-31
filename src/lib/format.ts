// Los precios se guardan en centavos como enteros en la DB para evitar errores de float.
// Acá convertimos cuando hay que mostrar o cuando entra desde el formulario.

export function centsToARS(cents: number): string {
  const pesos = cents / 100;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(pesos);
}

export function centsToPlainNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export function arsStringToCents(input: string): number {
  // Acepta "1.500", "1.500,50", "1500.50", "1500,50". Devuelve centavos enteros.
  const clean = input
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // saca puntos de miles
    .replace(",", ".");
  const num = parseFloat(clean);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
