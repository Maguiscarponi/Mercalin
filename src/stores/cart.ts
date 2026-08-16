import { create } from "zustand";
import type { CartItem, Combo, Product } from "@/types";

export interface ParkedSale {
  id: string;
  label: string;
  items: CartItem[];
  discount_cents: number;
  client_id: number | null;
  client_name: string | null;
  client_is_ri: boolean;
  parked_at: number;
}

interface CartState {
  items: CartItem[];
  discount_cents: number;
  client_id: number | null;
  client_name: string | null;
  client_is_ri: boolean;
  parked: ParkedSale[];

  addProduct: (p: Product, priceOverride?: number) => void;
  addWeighedProduct: (p: Product, priceOverride: number | undefined, kg: number) => void;
  addCombo: (c: Combo) => void;
  addOpenItem: (name: string, price_cents: number) => void;
  incQty: (idx: number) => void;
  decQty: (idx: number) => void;
  removeItem: (idx: number) => void;
  setQty: (idx: number, qty: number) => void;
  setItemDiscount: (idx: number, pct: number) => void;
  setDiscount: (cents: number) => void;
  setClient: (id: number | null, name: string | null, isRi?: boolean) => void;
  clear: () => void;

  // Reemplaza el carrito entero de una — usado al convertir un presupuesto
  // guardado en una venta real, para no tener que reproducir ítem por ítem
  // con las acciones normales (que tienen su propia lógica de deduplicado).
  loadItems: (items: CartItem[], discount_cents: number, client_id: number | null, client_name: string | null, client_is_ri: boolean) => void;

  // Aparcar/retomar: deja el carrito actual de lado (con cliente y descuento
  // incluidos) para atender a otra persona, sin perder lo que ya se había armado.
  parkCurrent: (label?: string) => void;
  resumeParked: (id: string) => void;
  discardParked: (id: string) => void;

  subtotal_cents: () => number;
  total_cents: () => number;
  itemCount: () => number;
  unitCount: () => number;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  discount_cents: 0,
  client_id: null,
  client_name: null,
  client_is_ri: false,
  parked: [],

  addProduct: (p, priceOverride) =>
    set((state) => {
      const price = priceOverride !== undefined ? priceOverride : p.price_cents;
      const existing = state.items.findIndex(
        (i) => i.product_id === p.id && i.unit_price_cents === price
      );
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = { ...items[existing], qty: items[existing].qty + 1 };
        return { items };
      }
      return {
        items: [
          ...state.items,
          {
            product_id: p.id,
            barcode: p.barcode,
            name: p.name,
            unit_price_cents: price,
            discount_pct: 0,
            qty: 1,
          },
        ],
      };
    }),

  // Para productos pesables: cada pesada SUMA los kg indicados (no +1 como una
  // unidad normal) — si ya hay una línea del mismo producto/precio, se acumula.
  addWeighedProduct: (p, priceOverride, kg) =>
    set((state) => {
      const price = priceOverride !== undefined ? priceOverride : p.price_cents;
      const existing = state.items.findIndex(
        (i) => i.product_id === p.id && i.unit_price_cents === price
      );
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = { ...items[existing], qty: Math.round((items[existing].qty + kg) * 1000) / 1000 };
        return { items };
      }
      return {
        items: [
          ...state.items,
          {
            product_id: p.id,
            barcode: p.barcode,
            name: p.name,
            unit_price_cents: price,
            discount_pct: 0,
            qty: Math.round(kg * 1000) / 1000,
          },
        ],
      };
    }),

  addCombo: (c) =>
    set((state) => {
      const existing = state.items.findIndex((i) => i.combo_id === c.id);
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = { ...items[existing], qty: items[existing].qty + 1 };
        return { items };
      }
      return {
        items: [
          ...state.items,
          {
            product_id: null,
            combo_id: c.id,
            barcode: c.barcode,
            name: c.name,
            unit_price_cents: c.price_cents,
            discount_pct: 0,
            qty: 1,
          },
        ],
      };
    }),

  addOpenItem: (name, price_cents) =>
    set((state) => {
      const existing = state.items.findIndex(
        (i) => i.product_id === null && i.name === name && i.unit_price_cents === price_cents
      );
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = { ...items[existing], qty: items[existing].qty + 1 };
        return { items };
      }
      return {
        items: [
          ...state.items,
          { product_id: null, barcode: null, name, unit_price_cents: price_cents, discount_pct: 0, qty: 1 },
        ],
      };
    }),

  incQty: (idx) =>
    set((state) => {
      const items = [...state.items];
      items[idx] = { ...items[idx], qty: items[idx].qty + 1 };
      return { items };
    }),

  decQty: (idx) =>
    set((state) => {
      const items = [...state.items];
      const newQty = items[idx].qty - 1;
      if (newQty <= 0) items.splice(idx, 1);
      else items[idx] = { ...items[idx], qty: newQty };
      return { items };
    }),

  removeItem: (idx) =>
    set((state) => {
      const items = [...state.items];
      items.splice(idx, 1);
      return { items };
    }),

  setQty: (idx, qty) =>
    set((state) => {
      const items = [...state.items];
      if (qty <= 0) items.splice(idx, 1);
      else items[idx] = { ...items[idx], qty };
      return { items };
    }),

  setItemDiscount: (idx, pct) =>
    set((state) => {
      const items = [...state.items];
      items[idx] = { ...items[idx], discount_pct: Math.min(100, Math.max(0, pct)) };
      return { items };
    }),

  setDiscount: (cents) => set({ discount_cents: Math.max(0, cents) }),

  setClient: (id, name, isRi = false) => set({ client_id: id, client_name: name, client_is_ri: isRi }),

  clear: () => set({ items: [], discount_cents: 0, client_id: null, client_name: null, client_is_ri: false }),

  loadItems: (items, discount_cents, client_id, client_name, client_is_ri) =>
    set({ items, discount_cents, client_id, client_name, client_is_ri }),

  parkCurrent: (label) =>
    set((state) => {
      if (state.items.length === 0) return {};
      const entry: ParkedSale = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: label?.trim() || `Venta aparcada`,
        items: state.items,
        discount_cents: state.discount_cents,
        client_id: state.client_id,
        client_name: state.client_name,
        client_is_ri: state.client_is_ri,
        parked_at: Date.now(),
      };
      return {
        parked: [...state.parked, entry],
        items: [],
        discount_cents: 0,
        client_id: null,
        client_name: null,
        client_is_ri: false,
      };
    }),

  resumeParked: (id) =>
    set((state) => {
      const entry = state.parked.find((p) => p.id === id);
      if (!entry) return {};
      return {
        items: entry.items,
        discount_cents: entry.discount_cents,
        client_id: entry.client_id,
        client_name: entry.client_name,
        client_is_ri: entry.client_is_ri,
        parked: state.parked.filter((p) => p.id !== id),
      };
    }),

  discardParked: (id) =>
    set((state) => ({ parked: state.parked.filter((p) => p.id !== id) })),

  subtotal_cents: () =>
    get().items.reduce((s, i) => {
      const line = i.unit_price_cents * i.qty;
      const disc = (line * i.discount_pct) / 100;
      return s + line - disc;
    }, 0),

  total_cents: () => Math.max(0, get().subtotal_cents() - get().discount_cents),

  itemCount: () => get().items.length,
  unitCount: () => get().items.reduce((s, i) => s + i.qty, 0),
}));
