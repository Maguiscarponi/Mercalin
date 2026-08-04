import { useEffect, useRef, useState } from "react";
import { useCart } from "@/stores/cart";
import { api } from "@/lib/api";
import { centsToARS, arsStringToCents, formatDateTime, todayISO, dateToLocalISO } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import { playError, playScan } from "@/lib/sound";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import clsx from "clsx";
import PaymentModal from "@/components/PaymentModal";
import { CashSessionPanel, OpenCashForm } from "./Caja_Sesion";
import HelpButton from "@/components/HelpModal";
import { confirmAction, showToast } from "@/stores/dialogs";
import type { CashSession, Client, DeptButton, Product, Promotion } from "@/types";

export default function Caja() {
  const cart = useCart();
  const [scanValue, setScanValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<import("@/types").Product[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const [openSessions, setOpenSessions] = useState<CashSession[]>([]);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [deptButtons, setDeptButtons] = useState<DeptButton[]>([]);
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [discountStr, setDiscountStr] = useState("");
  const [showPriceCheck, setShowPriceCheck] = useState(false);
  const [businessName, setBusinessName] = useState("Punto Simple POS");
  const [focusedResultIndex, setFocusedResultIndex] = useState(-1);
  const [priceList, setPriceList] = useState<1 | 2 | 3>(1);
  const [priceListNames, setPriceListNames] = useState<[string, string, string]>(["Minorista", "Mayorista", "Especial"]);
  const [discountMode, setDiscountMode] = useState<"$" | "%">("$");
  const [stockMap, setStockMap] = useState<Record<number, number>>({});
  const [costMap, setCostMap] = useState<Record<number, number>>({});
  const [minMarginPct, setMinMarginPct] = useState(10);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [promoToast, setPromoToast] = useState<string | null>(null);
  const [pendingPriceProduct, setPendingPriceProduct] = useState<Product | null>(null);
  const [quickProducts, setQuickProducts] = useState<Product[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Producto detrás de cada línea del carrito con promo aplicada, para poder
  // recalcular el descuento (2x1/3x2/mínimo) cada vez que cambia la cantidad.
  const promoProductsRef = useRef<Record<string, Product>>({});

  // Ítem del carrito que pide más cantidad de la que hay en stock — bloquea el cobro.
  const stockIssueItem = cart.items.find(
    (item) => item.product_id && stockMap[item.product_id] !== undefined && item.qty > stockMap[item.product_id]
  );
  const hasStockIssue = stockIssueItem !== undefined;

  useEffect(() => {
    Promise.all([
      api.listOpenSessions(),
      api.getConfig("dept_buttons"),
      api.getConfig("business_name"),
      api.getConfig("price1_name"),
      api.getConfig("price2_name"),
      api.getConfig("price3_name"),
      api.listPromotions(),
      api.getConfig("min_margin_pct"),
    ]).then(([sessions, btns, bname, p1, p2, p3, promoList, minMarg]) => {
      setOpenSessions(sessions);
      if (sessions.length === 1) setSession(sessions[0]);
      else if (sessions.length === 0) setSession(null);
      else setSession(null); // Multiple: show picker
      if (btns) { try { setDeptButtons(JSON.parse(btns)); } catch { /* ignore */ } }
      if (bname) setBusinessName(bname);
      setPriceListNames([p1 || "Minorista", p2 || "Mayorista", p3 || "Especial"]);
      setPromos(promoList);
      if (minMarg) setMinMarginPct(Number(minMarg) || 10);
    }).catch(console.error);
  }, []);

  useEffect(() => { scanRef.current?.focus(); }, []);

  // Grilla de acceso rápido: en vez de botones de departamento configurados a mano,
  // se auto-completa con los productos que más se agarran en los últimos 30 días
  // (por cantidad, no por facturación — importa la frecuencia real de venta).
  useEffect(() => {
    const dateFrom = dateToLocalISO(new Date(Date.now() - 30 * 86400000));
    api.topProductsByQty(dateFrom, todayISO(), 8)
      .then(async (top) => {
        const ids = top.map((t) => t.product_id).filter((id): id is number => id != null);
        const products = await Promise.all(ids.map((id) => api.getProduct(id).catch(() => null)));
        setQuickProducts(products.filter((p): p is Product => !!p && p.active));
      })
      .catch(console.error);
  }, []);


  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const target = e.target as HTMLElement;
        const isOtherInput = (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && target !== scanRef.current;
        if (!isOtherInput && !payOpen && !showPriceCheck && !showClientSearch && !pendingPriceProduct) {
          const scanEmpty = !(scanRef.current?.value.trim());
          if (scanEmpty && cart.items.length > 0 && session !== null && !hasStockIssue) {
            e.preventDefault();
            setPayOpen(true);
          }
        }
      }
      if (e.key === "F2" && cart.items.length > 0 && session !== null && !hasStockIssue && !payOpen && !showPriceCheck && !pendingPriceProduct) {
        e.preventDefault(); setPayOpen(true);
      }
      if (e.key === "F3" && !payOpen && !pendingPriceProduct) {
        e.preventDefault(); setShowPriceCheck(true);
      }
      if (e.key === "Escape") {
        setPayOpen(false); setShowClientSearch(false);
        setSearchResults([]); setShowPriceCheck(false);
        setPendingPriceProduct(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cart.items.length, session, payOpen, showPriceCheck, showClientSearch, pendingPriceProduct, hasStockIssue]);

  function handleSearchChange(value: string) {
    setScanValue(value);
    setFocusedResultIndex(-1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length >= 2) {
      searchTimer.current = setTimeout(async () => {
        try {
          const results = await api.listProducts(value.trim(), true);
          if (results.length === 1) {
            selectSearchResult(results[0]);
          } else {
            setSearchResults(results);
          }
          setError(null);
        } catch { /* ignore */ }
      }, 220);
    } else {
      setSearchResults([]);
    }
  }

  async function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    // Navegación con flechas y Tab dentro de los resultados
    if (e.key === "ArrowDown" && searchResults.length > 0) {
      e.preventDefault();
      setFocusedResultIndex((i) => Math.min(i + 1, searchResults.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && searchResults.length > 0) {
      e.preventDefault();
      setFocusedResultIndex((i) => (i <= 0 ? -1 : i - 1));
      return;
    }
    if (e.key === "Tab" && searchResults.length > 0) {
      e.preventDefault();
      setFocusedResultIndex((i) =>
        e.shiftKey ? Math.max(i - 1, -1) : Math.min(i + 1, searchResults.length - 1)
      );
      return;
    }
    if (e.key === "Escape" && searchResults.length > 0) {
      e.preventDefault();
      setSearchResults([]);
      setFocusedResultIndex(-1);
      return;
    }

    if (e.key !== "Enter") return;

    // Si hay texto o resultados visibles, tomamos el evento aquí y bloqueamos
    // el handler global (window) para que no abra el pago por el mismo Enter.
    if (scanValue.trim() || searchResults.length > 0) {
      e.nativeEvent.stopImmediatePropagation();
    }

    // Enter con resultados visibles → seleccionar el resaltado, o el primero si no hay ninguno
    if (searchResults.length > 0) {
      const toSelect = focusedResultIndex >= 0
        ? searchResults[focusedResultIndex]
        : searchResults[0];
      if (toSelect) {
        selectSearchResult(toSelect);
        setFocusedResultIndex(-1);
        return;
      }
    }

    const code = scanValue.trim();
    if (!code) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchResults([]);
    setFocusedResultIndex(-1);
    setError(null);
    try {
      const product = await api.findProductByBarcode(code);
      if (product) {
        addProductSafely(product);
        setScanValue("");
        return;
      }
      const results = await api.listProducts(code, true);
      if (results.length === 1) {
        addProductSafely(results[0]);
        setScanValue("");
      } else if (results.length > 1) {
        setSearchResults(results);
      } else {
        playError();
        setError(`No encontrado: "${code}"`);
        setTimeout(() => setError(null), 2500);
        setScanValue("");
      }
    } catch (err) {
      console.error(err);
      playError();
      setError("Error al buscar el producto");
      setScanValue("");
    }
  }

  // ¿La promo está vigente ahora mismo según día de la semana y horario configurados?
  function isPromoActiveNow(p: Promotion): boolean {
    if (p.days_of_week) {
      try {
        const days = JSON.parse(p.days_of_week);
        if (Array.isArray(days) && days.length > 0 && !days.includes(new Date().getDay())) return false;
      } catch { /* condición mal formada: no bloquea la promo */ }
    }
    if (p.time_start || p.time_end) {
      const now = new Date();
      const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (p.time_start && hm < p.time_start) return false;
      if (p.time_end && hm > p.time_end) return false;
    }
    return true;
  }

  function findPromo(product: Product): Promotion | null {
    const today = todayISO();
    const active = promos.filter(
      (p) => p.active
        && (!p.starts_at || p.starts_at <= today)
        && (!p.ends_at || p.ends_at >= today)
        && isPromoActiveNow(p)
    );
    return (
      active.find((p) => p.applies_to === "product" && (p.target_id ? p.target_id === product.id : p.target_name === product.name)) ||
      active.find((p) => p.applies_to === "category" && p.target_name === product.category) ||
      active.find((p) => p.applies_to === "all")
    ) ?? null;
  }

  // Porcentaje de descuento a aplicar sobre la línea, según tipo de promo y la cantidad ya cargada.
  // Se recalcula cada vez que cambia la cantidad (ver bumpQty) para que 2x1/3x2 y el mínimo
  // requerido respondan de verdad al carrito, no solo al momento en que se agregó el producto.
  function promoDiscountPct(promo: Promotion, qty: number, unitPrice: number): number {
    if (promo.min_qty && qty < promo.min_qty) return 0;
    switch (promo.promo_type) {
      case "pct": return Math.min(100, Math.max(0, promo.value));
      case "fixed": return unitPrice > 0 ? Math.min(100, Math.max(0, (promo.value / unitPrice) * 100)) : 0;
      case "2x1": return qty > 0 ? (Math.floor(qty / 2) / qty) * 100 : 0;
      case "3x2": return qty > 0 ? (Math.floor(qty / 3) / qty) * 100 : 0;
      default: return 0;
    }
  }

  function showPromoToast(msg: string) {
    setPromoToast(msg);
    setTimeout(() => setPromoToast(null), 2500);
  }

  function promoLineKey(productId: number, price: number) {
    return `${productId}:${price}`;
  }

  function applyPromoToLine(product: Product, price: number) {
    const promo = findPromo(product);
    if (!promo) return;
    promoProductsRef.current[promoLineKey(product.id, price)] = product;
    const items = useCart.getState().items;
    const idx = items.findIndex((i) => i.product_id === product.id && i.unit_price_cents === price);
    if (idx < 0) return;
    const qty = items[idx].qty;
    const pct = promoDiscountPct(promo, qty, price);
    cart.setItemDiscount(idx, pct);
    if (pct > 0) {
      const label =
        promo.promo_type === "pct" ? `−${promo.value}%` :
        promo.promo_type === "fixed" ? `−${centsToARS(promo.value)}` :
        promo.promo_type === "2x1" ? "Llevá 2, pagá 1" : "Llevá 3, pagá 2";
      showPromoToast(`✓ ${promo.name} (${label})`);
    } else if (promo.min_qty && promo.min_qty > qty) {
      showPromoToast(`${promo.name}: agregá ${promo.min_qty - qty} más para activar la promo`);
    }
  }

  function addWithPromo(product: Product, price: number) {
    cart.addProduct(product, price);
    applyPromoToLine(product, price);
  }

  // Usado por los botones +/− del carrito: además de cambiar la cantidad,
  // recalcula el descuento de la línea si tiene una promo asociada.
  function bumpQty(idx: number, delta: 1 | -1) {
    if (delta > 0) cart.incQty(idx); else cart.decQty(idx);
    const items = useCart.getState().items;
    const item = items[idx];
    if (!item || item.product_id == null) return;
    const product = promoProductsRef.current[promoLineKey(item.product_id, item.unit_price_cents)];
    if (!product) return;
    const promo = findPromo(product);
    const pct = promo ? promoDiscountPct(promo, item.qty, item.unit_price_cents) : 0;
    cart.setItemDiscount(idx, pct);
  }

  function getPriceForList(p: Product): number {
    if (priceList === 2 && p.price2_cents > 0) return p.price2_cents;
    if (priceList === 3 && p.price3_cents > 0) return p.price3_cents;
    return p.price_cents;
  }

  // Punto único para agregar un producto encontrado (escaneo, búsqueda o desplegable):
  // si no tiene precio cargado en la lista activa, no lo agrega — pide el precio primero
  // para no dejar vender nada a $0 por error.
  function addProductSafely(product: Product) {
    const price = getPriceForList(product);
    if (price <= 0) {
      setPendingPriceProduct(product);
      return;
    }
    addWithPromo(product, price);
    setStockMap((m) => ({ ...m, [product.id]: product.stock }));
    setCostMap((m) => ({ ...m, [product.id]: product.cost_cents }));
    playScan();
  }

  function selectSearchResult(product: Product) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    addProductSafely(product);
    setSearchResults([]);
    setScanValue("");
    scanRef.current?.focus();
  }

  function printQuote() {
    const now = new Date().toLocaleString("es-AR");
    const itemsHtml = cart.items.map((item) => {
      const line = item.unit_price_cents * item.qty;
      const disc = (line * item.discount_pct) / 100;
      return `<div style="display:flex;justify-content:space-between;margin:4px 0">
        <span style="flex:1">${item.name}</span>
        <span>${centsToARS(line - disc)}</span>
      </div>
      <div style="font-size:10px;color:#666;padding-left:8px">${item.qty} × ${centsToARS(item.unit_price_cents)}${item.discount_pct > 0 ? ` (-${item.discount_pct}%)` : ""}</div>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;padding:16px;width:280px;color:#000}
.center{text-align:center}.bold{font-weight:bold}.dashed{border-top:1px dashed #000;margin:8px 0}
.big{font-size:16px}.watermark{font-size:22px;font-weight:bold;letter-spacing:4px;color:#aaa;text-align:center;margin:8px 0}
@page{margin:0;size:80mm auto}</style></head><body>
<div class="center bold big">${businessName}</div>
<div class="watermark">PRESUPUESTO</div>
<div class="dashed"></div>
<div style="font-size:10px;color:#666">Fecha: ${now}</div>
<div class="dashed"></div>
${itemsHtml}
<div class="dashed"></div>
<div class="bold" style="display:flex;justify-content:space-between;font-size:14px">
  <span>TOTAL</span><span>${centsToARS(total)}</span>
</div>
<div class="dashed"></div>
<div class="center" style="font-size:10px;color:#666">Válido por 24 horas · No constituye factura</div>
</body></html>`;
    printHtml(html);
  }

  const subtotal = cart.subtotal_cents();
  const total = cart.total_cents();
  const discount = cart.discount_cents;

  // Alerta de margen: estima margen global con los costos conocidos
  const marginAlert = (() => {
    if (cart.items.length === 0 || total <= 0) return null;
    const knownCost = cart.items.reduce((sum, item) => {
      const cost = item.product_id ? (costMap[item.product_id] ?? 0) : 0;
      return sum + cost * item.qty;
    }, 0);
    if (knownCost === 0) return null;
    const margin = ((total - knownCost) / total) * 100;
    if (margin < minMarginPct) return margin;
    return null;
  })();

  if (session === null) {
    // Multiple open sessions → show picker
    if (openSessions.length > 1) {
      return (
        <div className="h-full flex items-center justify-center bg-stone-100">
          <div className="bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center gap-5 max-w-lg w-full text-center">
            <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center text-2xl">🏪</div>
            <div>
              <h2 className="text-xl font-bold text-stone-800">Seleccioná tu caja</h2>
              <p className="text-sm text-stone-500 mt-1">Hay {openSessions.length} cajas abiertas. Elegí con cuál vas a trabajar.</p>
            </div>
            <div className="w-full space-y-2">
              {openSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSession(s)}
                  className="w-full text-left px-4 py-3 border-2 border-stone-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-xl transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-stone-800">Caja #{s.id}</div>
                    <div className="text-xs text-stone-500 mt-0.5">Abierta: {formatDateTime(s.opened_at)}</div>
                  </div>
                  <span className="text-indigo-600 font-bold text-sm">Usar →</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowOpenForm(true)}
              className="btn btn-secondary w-full"
            >
              + Abrir caja nueva
            </button>
            {showOpenForm && (
              <OpenCashForm
                onCancel={() => setShowOpenForm(false)}
                onOpened={(s) => {
                  const updated = [s, ...openSessions];
                  setOpenSessions(updated);
                  setSession(s);
                  setShowOpenForm(false);
                }}
              />
            )}
          </div>
        </div>
      );
    }

    // No sessions → show "Caja cerrada"
    return (
      <div className="h-full flex items-center justify-center bg-stone-100">
        <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center gap-5 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center text-3xl">🔒</div>
          <div>
            <h2 className="text-xl font-bold text-stone-800">Caja cerrada</h2>
            <p className="text-sm text-stone-500 mt-1">Para operar, abrí una sesión de caja primero.</p>
          </div>
          <button
            onClick={() => setShowOpenForm(true)}
            className="btn btn-primary w-full text-base py-3"
          >
            Abrir caja
          </button>
          {showOpenForm && (
            <OpenCashForm
              onCancel={() => setShowOpenForm(false)}
              onOpened={(s) => {
                setOpenSessions([s]);
                setSession(s);
                setShowOpenForm(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-3 gap-3 relative">

      <div className="flex-1 grid grid-cols-[1fr_420px] gap-3 min-h-0">
        {/* Columna izquierda: scan + items */}
        <div className="card flex flex-col min-h-0">
          <div className="p-4 border-b border-stone-200">
            <input
              ref={scanRef}
              type="text"
              className="input font-mono text-base h-12"
              placeholder="Código de barras o nombre del producto…"
              value={scanValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleScan}
              autoComplete="off"
              onBlur={(e) => {
                const next = e.relatedTarget as HTMLElement | null;
                // Si el foco se va a otro INPUT/TEXTAREA real, dejarlo ir
                if (next && (next.tagName === "INPUT" || next.tagName === "TEXTAREA" || next.tagName === "SELECT")) return;
                // Si el foco se va a un control del carrito (−/+/×), dejarlo operable por teclado
                // en vez de arrebatarle el foco de inmediato.
                if (next && next.closest("[data-cart-ctrl]")) return;
                // Si el foco se va a otro elemento (ej: menú lateral), recuperar foco después
                setTimeout(() => {
                  const active = document.activeElement as HTMLElement | null;
                  if (!active) { scanRef.current?.focus(); return; }
                  if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT") return;
                  if (active.closest("[data-cart-ctrl]")) return;
                  scanRef.current?.focus();
                }, 150);
              }}
            />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            {searchResults.length > 0 && (
              <div className="mt-2 border border-stone-200 rounded-lg shadow-lg bg-white overflow-hidden">
                <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 text-xs text-stone-500 font-medium">
                  {searchResults.length} resultados — seleccioná uno o presioná Enter
                </div>
                <ul className="max-h-56 overflow-y-auto">
                  {searchResults.map((p, idx) => (
                    <li key={p.id}>
                      <button
                        onClick={() => { selectSearchResult(p); setFocusedResultIndex(-1); }}
                        className={`w-full text-left px-4 py-3 flex justify-between items-center border-b border-stone-50 last:border-0 transition-colors ${
                          focusedResultIndex === idx ? "bg-indigo-100 ring-2 ring-inset ring-indigo-400" : "hover:bg-indigo-50"
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-base">{p.name}</div>
                          <div className="text-sm text-stone-400 mt-0.5">{p.barcode || "Sin código"} · Stock: {p.stock}</div>
                        </div>
                        <div className="tabular text-base font-bold text-stone-800 ml-4">{centsToARS(getPriceForList(p))}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {cart.items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-stone-300">
                <div className="text-5xl">🛒</div>
                <div className="text-base font-medium">Esperando productos…</div>
                <div className="text-sm">Escaneá o buscá arriba</div>
              </div>
            ) : (
              <ul>
                {cart.items.map((item, idx) => {
                  const lineTotal = item.unit_price_cents * item.qty;
                  const discAmt = (lineTotal * item.discount_pct) / 100;
                  return (
                    <li
                      key={idx}
                      className="grid grid-cols-[1fr_auto_150px_40px] gap-3 items-center px-4 py-4 border-b border-stone-100 hover:bg-stone-50"
                    >
                      <div>
                        <div className="font-semibold text-base leading-tight flex items-center gap-2">
                          {item.name}
                          {item.product_id && stockMap[item.product_id] !== undefined && item.qty > stockMap[item.product_id] && (
                            <span title={`Stock disponible: ${stockMap[item.product_id]}`} className="text-amber-500 text-sm">⚠</span>
                          )}
                        </div>
                        <div className="text-sm text-stone-400 font-mono mt-1 flex items-center gap-2">
                          {centsToARS(item.unit_price_cents)} c/u
                          {item.discount_pct > 0 && (
                            <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium">
                              -{item.discount_pct}%
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={() => bumpQty(idx, -1)} data-cart-ctrl="true" className="w-9 h-9 rounded-md border border-stone-300 hover:bg-stone-100 text-lg font-bold">−</button>
                        <span className="tabular w-9 text-center font-bold text-base">{item.qty}</span>
                        <button onClick={() => bumpQty(idx, 1)} data-cart-ctrl="true" className="w-9 h-9 rounded-md border border-stone-300 hover:bg-stone-100 text-lg font-bold">+</button>
                      </div>

                      <div className="text-right">
                        <div className="tabular font-bold text-base">{centsToARS(lineTotal - discAmt)}</div>
                        {discAmt > 0 && (
                          <div className="text-sm text-stone-400 line-through tabular">{centsToARS(lineTotal)}</div>
                        )}
                      </div>

                      <button onClick={() => cart.removeItem(idx)} data-cart-ctrl="true" className="text-stone-400 hover:text-red-500 text-2xl flex items-center justify-center">×</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Columna derecha — panel POS */}
        <div className="flex flex-col min-h-0 gap-3">

          {/* LISTA DE PRECIOS — discreta a propósito: un cliente mirando la pantalla no
              tiene por qué ver que hay precios distintos según a quién le vendas. */}
          <div className="flex items-center justify-end gap-1.5 px-1 shrink-0">
            <span className="text-[9px] font-medium text-stone-400 uppercase tracking-wide">Lista</span>
            <select
              value={priceList}
              onChange={(e) => setPriceList(Number(e.target.value) as 1 | 2 | 3)}
              title="Cambiar lista de precios"
              className={clsx(
                "text-[11px] font-semibold bg-transparent border-0 rounded py-0.5 pl-1 pr-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300",
                priceList === 1 ? "text-stone-400" : "text-indigo-600"
              )}
            >
              {priceListNames.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>

          {/* TOTAL — blanco, número enorme */}
          <div className="card px-5 py-10 flex flex-col items-center text-center shrink-0">
            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-stone-400 mb-3">
              Total a cobrar
            </div>
            <div className="text-7xl font-black tabular leading-none text-stone-900">
              {centsToARS(total)}
            </div>
            <div className="mt-4 text-sm text-stone-400 flex items-center gap-2">
              <span>{cart.itemCount()} art. · {cart.unitCount()} unid.</span>
              {session && (
                <button
                  onClick={() => setShowSessionPanel(true)}
                  className="text-stone-300 hover:text-stone-500 transition-colors"
                  title="Gestión de caja"
                >⚙</button>
              )}
            </div>
            {discount > 0 && (
              <div className="mt-1 text-xs text-stone-400">
                Subtotal {centsToARS(subtotal)} · Dto. {centsToARS(discount)}
              </div>
            )}
          </div>

          {/* DESCUENTO — siempre visible, nunca en scroll */}
          <div className="card px-4 py-3 shrink-0 flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide shrink-0">Dto.</span>
            <div className="flex gap-0.5 shrink-0">
              {(["$", "%"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setDiscountMode(m); setDiscountStr(""); cart.setDiscount(0); }}
                  className={clsx(
                    "w-7 h-7 text-xs rounded border transition-colors font-mono",
                    discountMode === m
                      ? "bg-stone-700 text-white border-stone-700"
                      : "bg-stone-50 border-stone-200 text-stone-500 hover:bg-stone-100"
                  )}
                >{m}</button>
              ))}
            </div>
            <input
              className="input h-9 tabular text-right flex-1 text-base"
              placeholder="0"
              value={discountStr}
              onChange={(e) => {
                setDiscountStr(e.target.value);
                const v = parseFloat(e.target.value.replace(",", ".")) || 0;
                if (discountMode === "$") {
                  cart.setDiscount(Math.round(v * 100));
                } else {
                  cart.setDiscount(Math.round(subtotal * v / 100));
                }
              }}
              inputMode="numeric"
            />
            {discount > 0 && (
              <button
                onClick={() => { setDiscountStr(""); cart.setDiscount(0); }}
                className="text-stone-400 hover:text-red-500 text-xl px-1 shrink-0"
              >✕</button>
            )}
          </div>

          {/* Alerta de margen bajo */}
          {marginAlert !== null && (
            <div className="px-4 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800 flex items-center gap-2 shrink-0">
              <span className="font-bold">⚠</span>
              <span>Margen estimado: <strong>{marginAlert.toFixed(1)}%</strong> — por debajo del mínimo configurado ({minMarginPct}%)</span>
            </div>
          )}

          {/* Sin stock suficiente — bloquea el cobro */}
          {stockIssueItem && (
            <div className="px-4 py-2 bg-red-50 border border-red-300 rounded-lg text-xs text-red-800 flex items-center gap-2 shrink-0">
              <span className="font-bold">⚠</span>
              <span>
                No hay stock suficiente de <strong>{stockIssueItem.name}</strong> (quedan{" "}
                {stockIssueItem.product_id ? stockMap[stockIssueItem.product_id] : 0}). Bajá la cantidad para poder cobrar.
              </span>
            </div>
          )}

          {/* COBRAR — botón dominante */}
          <button
            onClick={() => setPayOpen(true)}
            disabled={cart.items.length === 0 || session === null || hasStockIssue}
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-black text-2xl disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-colors shrink-0"
            style={{ height: "80px" }}
          >
            Cobrar
            <span
              className="text-sm font-normal bg-white/20 px-2 py-1 rounded-md font-mono"
              title="Con el buscador vacío y productos en el carrito, Enter cobra directo — sirve incluso si en tu teclado F2 no anda sin Fn"
            >
              Enter · F2
            </span>
          </button>

          {/* ANULAR VENTA */}
          <button
            onClick={async () => {
              if (await confirmAction("Se van a borrar todos los ítems del carrito actual.", { title: "¿Anular toda la venta?", danger: true, confirmLabel: "Anular" })) {
                cart.clear();
                setDiscountStr("");
                promoProductsRef.current = {};
              }
            }}
            disabled={cart.items.length === 0}
            className="w-full rounded-xl border-2 border-red-300 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shrink-0"
            style={{ height: "46px" }}
          >
            🗑 Anular venta
          </button>

          {/* SECUNDARIO — scrollable */}
          <div className="card flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
            {/* Cliente */}
            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-stone-400 mb-1.5">Cliente</div>
              {cart.client_id ? (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                  <span className="text-sm text-emerald-800 font-semibold">👥 {cart.client_name}</span>
                  <button onClick={() => cart.setClient(null, null)} className="text-stone-400 hover:text-red-600">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClientSearch(true)}
                  className="w-full text-left px-3 py-2.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-500"
                >
                  👥 Asignar cliente…
                </button>
              )}
            </div>

            {/* Acciones rápidas */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowPriceCheck(true)}
                className="h-10 text-sm bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg flex items-center justify-center gap-1.5 font-medium text-stone-700"
              >
                🔍 Precio <span className="font-mono text-xs text-stone-400">F3</span>
              </button>
              <button
                onClick={printQuote}
                disabled={cart.items.length === 0}
                className="h-10 text-sm bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg flex items-center justify-center gap-1.5 font-medium text-stone-700 disabled:opacity-40"
              >
                📄 Presupuesto
              </button>
            </div>
            {/* Grilla de acceso rápido — auto-ordenada por venta real, sin configurar nada */}
            {quickProducts.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-stone-400 mb-1.5">Más vendidos</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {quickProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProductSafely(p)}
                      title={p.name}
                      className="text-left px-2.5 py-2 bg-stone-50 hover:bg-indigo-50 border border-stone-200 hover:border-indigo-200 rounded-lg text-xs"
                    >
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="tabular text-stone-500 font-mono mt-0.5">{centsToARS(getPriceForList(p))}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Botones de departamento */}
            {deptButtons.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-stone-400 mb-1.5">Acceso rápido</div>
                <div className="space-y-1.5">
                  {deptButtons.map((btn, i) => (
                    <button
                      key={i}
                      onClick={() => cart.addOpenItem(btn.label, btn.price_cents)}
                      className="w-full text-left px-3 py-2.5 bg-stone-50 hover:bg-indigo-50 border border-stone-200 hover:border-indigo-200 rounded-lg text-sm font-medium flex justify-between items-center"
                    >
                      <span>{btn.label}</span>
                      <span className="tabular text-stone-500 font-mono">{centsToARS(btn.price_cents)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {payOpen && (
        <PaymentModal
          totalCents={total}
          sessionId={session?.id ?? null}
          isRi={cart.client_is_ri}
          onClose={() => setPayOpen(false)}
          onConfirmed={() => {
            cart.clear();
            setPayOpen(false);
            setDiscountStr("");
            promoProductsRef.current = {};
            scanRef.current?.focus();
          }}
        />
      )}

      {showSessionPanel && session && (
        <CashSessionPanel
          session={session}
          onClose={() => setShowSessionPanel(false)}
          onClosed={() => {
            const remaining = openSessions.filter((s) => s.id !== session.id);
            setOpenSessions(remaining);
            setSession(remaining.length === 1 ? remaining[0] : null);
            setShowSessionPanel(false);
          }}
        />
      )}

      {showOpenForm && (
        <OpenCashForm
          onCancel={() => setShowOpenForm(false)}
          onOpened={(s) => {
            const updated = [s, ...openSessions];
            setOpenSessions(updated);
            setSession(s);
            setShowOpenForm(false);
          }}
        />
      )}

      {showClientSearch && (
        <ClientSearch
          onSelect={(c) => { cart.setClient(c.id, c.name, c.is_ri); setShowClientSearch(false); }}
          onClose={() => setShowClientSearch(false)}
        />
      )}

      {showPriceCheck && (
        <PriceCheckModal onClose={() => { setShowPriceCheck(false); scanRef.current?.focus(); }} />
      )}

      {pendingPriceProduct && (
        <SetPriceModal
          product={pendingPriceProduct}
          onCancel={() => { setPendingPriceProduct(null); scanRef.current?.focus(); }}
          onSaved={(updated) => {
            setPendingPriceProduct(null);
            addWithPromo(updated, getPriceForList(updated));
            setStockMap((m) => ({ ...m, [updated.id]: updated.stock }));
            setCostMap((m) => ({ ...m, [updated.id]: updated.cost_cents }));
            scanRef.current?.focus();
          }}
        />
      )}

      {/* Promo toast */}
      {promoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white px-5 py-2.5 rounded-full shadow-lg text-sm font-medium pointer-events-none whitespace-nowrap">
          {promoToast}
        </div>
      )}

      <HelpButton module="caja" />

    </div>
  );
}

function ClientSearch({ onSelect, onClose }: { onSelect: (c: Client) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  useEscapeToClose(onClose);

  useEffect(() => {
    api.listClients(query).then(setResults).catch(console.error);
  }, [query]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <h3 className="font-semibold mb-3">Seleccionar cliente</h3>
        <input
          autoFocus
          className="input mb-3"
          placeholder="Buscar por nombre, teléfono o DNI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="space-y-1 max-h-60 overflow-y-auto">
          {results.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c)}
                className="w-full text-left px-3 py-2.5 rounded-md hover:bg-emerald-50 hover:border-emerald-200 border border-transparent text-sm"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-stone-400">
                  {c.phone && `📞 ${c.phone}`}
                  {c.balance_cents > 0 && ` · Deuda: ${centsToARS(c.balance_cents)}`}
                </div>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="text-center py-4 text-stone-400 text-sm">Sin resultados</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function SetPriceModal({
  product,
  onCancel,
  onSaved,
}: {
  product: Product;
  onCancel: () => void;
  onSaved: (updated: Product) => void;
}) {
  const [priceStr, setPriceStr] = useState("");
  const [saving, setSaving] = useState(false);
  const cents = arsStringToCents(priceStr);
  useEscapeToClose(onCancel);

  async function submit() {
    if (cents <= 0 || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateProduct({ ...product, price_cents: cents });
      onSaved(updated);
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo guardar el precio", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[380px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h3 className="font-semibold mb-1">Precio no cargado</h3>
        <p className="text-sm text-stone-500 mb-4">
          <strong>{product.name}</strong> todavía no tiene un precio de venta. Cargalo para agregarlo a esta
          venta — queda guardado para la próxima vez.
        </p>
        <input
          autoFocus
          className="input tabular text-right h-12 text-lg mb-4"
          placeholder="0"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          inputMode="numeric"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving || cents <= 0}
            className="btn btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Guardando…" : "Guardar y agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceCheckModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEscapeToClose(onClose);

  function handleChange(v: string) {
    setQuery(v); setFound(null); setNotFound(false);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length >= 2) {
      timer.current = setTimeout(async () => {
        const byBarcode = await api.findProductByBarcode(v.trim()).catch(() => null);
        if (byBarcode) { setFound(byBarcode); return; }
        const list = await api.listProducts(v.trim(), true).catch(() => []);
        if (list.length > 0) setFound(list[0]);
        else setNotFound(true);
      }, 200);
    }
  }

  async function handleEnter(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !query.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    const byBarcode = await api.findProductByBarcode(query.trim()).catch(() => null);
    if (byBarcode) { setFound(byBarcode); setNotFound(false); return; }
    const list = await api.listProducts(query.trim(), true).catch(() => []);
    if (list.length > 0) { setFound(list[0]); setNotFound(false); }
    else { setFound(null); setNotFound(true); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[380px] p-5" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Consulta de precio</h3>
          <span className="text-xs text-stone-400 font-mono mr-6">F3 / Esc</span>
        </div>
        <input
          autoFocus
          className="input mb-4"
          placeholder="Código de barras o nombre…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleEnter}
        />
        {found && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="font-semibold text-base">{found.name}</div>
            {found.category && <div className="text-xs text-stone-500 mt-0.5">{found.category}</div>}
            <div className="text-3xl font-bold text-emerald-700 mt-2">{centsToARS(found.price_cents)}</div>
            <div className="flex gap-4 mt-2 text-xs text-stone-500">
              {found.barcode && <span>Cód: {found.barcode}</span>}
              <span>Stock: <strong className={found.stock <= found.min_stock ? "text-red-600" : ""}>{found.stock}</strong></span>
            </div>
          </div>
        )}
        {notFound && (
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-center text-stone-500 text-sm">
            Producto no encontrado
          </div>
        )}
        <button onClick={onClose} className="btn btn-secondary w-full mt-4">Cerrar</button>
      </div>
    </div>
  );
}
