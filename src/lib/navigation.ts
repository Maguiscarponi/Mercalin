import {
  ShoppingCart, Wallet, Users, RotateCcw,
  Package, Truck, Tag, Calendar, ClipboardList, Layers, Gift,
  FileText, Percent, Lock,
  LayoutDashboard, BarChart2, Search, Settings,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/types";

// Única fuente de verdad de "qué rutas existen y quién puede verlas" —
// la usan tanto el sidebar (para ocultar links) como el router (para
// bloquear el acceso directo por URL). Antes vivían como dos copias
// separadas que podían desincronizarse — ver Hallazgo 04 de la auditoría UX.
export type NavLinkDef = {
  to: string;
  label: string;
  icon: LucideIcon;
  key: string;
  altKey?: string;
  minRole?: UserRole;
  // Oculto/bloqueado para una caja en modo "cliente" — pensado para pantallas
  // donde administrar cuentas desde una caja cualquiera generaría confusión.
  serverOnly?: boolean;
  // Oculto si la función opcional correspondiente está apagada en Configuración.
  featureFlag?: "combos";
};

export const ROLE_LEVEL: Record<UserRole, number> = { cajero: 1, supervisor: 2, admin: 3 };

export function hasAccess(userRole: UserRole, minRole: UserRole = "cajero") {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

export const NAV_GROUPS: Array<{ label: string; links: NavLinkDef[] }> = [
  {
    label: "Operación",
    links: [
      { to: "/caja",         label: "Caja",            icon: ShoppingCart,    key: "F9",  altKey: "1" },
      { to: "/caja-gestion", label: "Gestión de caja", icon: Wallet,          key: "F10", altKey: "2", minRole: "supervisor" },
      { to: "/clientes",     label: "Clientes",         icon: Users,           key: "F11", altKey: "3", minRole: "supervisor" },
      { to: "/devoluciones", label: "Devoluciones",     icon: RotateCcw,       key: "",                 minRole: "supervisor" },
    ],
  },
  {
    label: "Catálogo",
    links: [
      { to: "/productos",    label: "Productos",        icon: Package,         key: "F5", altKey: "4", minRole: "supervisor" },
      { to: "/proveedores",  label: "Proveedores",      icon: Truck,           key: "F6", altKey: "5", minRole: "supervisor" },
      { to: "/categorias",   label: "Categorías",       icon: Tag,             key: "",                minRole: "supervisor" },
      { to: "/vencimientos", label: "Vencimientos",     icon: Calendar,        key: "",                minRole: "supervisor" },
      { to: "/inventario",   label: "Inventario",       icon: ClipboardList,   key: "",                minRole: "supervisor" },
      { to: "/etiquetas",    label: "Etiquetas",        icon: Layers,          key: "",                minRole: "supervisor" },
      { to: "/combos",       label: "Combos",           icon: Gift,            key: "",                minRole: "supervisor", featureFlag: "combos" },
    ],
  },
  {
    label: "Gestión",
    links: [
      { to: "/presupuestos", label: "Presupuestos",     icon: FileText,        key: "",               minRole: "supervisor" },
      { to: "/promociones",  label: "Promociones",      icon: Percent,         key: "",               minRole: "supervisor" },
      { to: "/usuarios",     label: "Usuarios",         icon: Lock,            key: "",               minRole: "admin", serverOnly: true },
    ],
  },
  {
    label: "Análisis",
    links: [
      { to: "/dashboard",    label: "Dashboard",        icon: LayoutDashboard, key: "F4", altKey: "8", minRole: "supervisor" },
      { to: "/reportes",     label: "Reportes",         icon: BarChart2,       key: "F7", altKey: "6", minRole: "supervisor" },
    ],
  },
  {
    label: "Sistema",
    links: [
      { to: "/auditoria",     label: "Auditoría",       icon: Search,          key: "",               minRole: "supervisor" },
      { to: "/configuracion", label: "Configuración",   icon: Settings,        key: "F8", altKey: "7", minRole: "admin" },
    ],
  },
];

export const KEY_ROUTES: Record<string, string> = {
  F4: "/dashboard",
  F9: "/caja", F10: "/caja-gestion", F11: "/clientes",
  F5: "/productos", F6: "/proveedores", F7: "/reportes", F8: "/configuracion",
};

export const ALT_KEY_ROUTES: Record<string, string> = {
  "1": "/caja", "2": "/caja-gestion", "3": "/clientes",
  "4": "/productos", "5": "/proveedores", "6": "/reportes", "7": "/configuracion",
  "8": "/dashboard",
};

export const ROLE_LABEL: Record<UserRole, string> = { admin: "Admin", supervisor: "Supervisor", cajero: "Cajero" };

// El mínimo rol requerido para acceder a cada ruta, derivado de NAV_GROUPS —
// lo usa el router para bloquear el acceso directo por URL, no solo el
// sidebar para ocultar el link.
export const ROUTE_MIN_ROLE: Record<string, UserRole> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.links).filter((l) => l.minRole).map((l) => [l.to, l.minRole as UserRole])
);

// Pantalla de arranque: un cajero va directo a vender, no a un panel
// financiero que ni siquiera puede ver desde el menú (Hallazgo 04).
export function defaultRouteFor(role: UserRole): string {
  return role === "cajero" ? "/caja" : "/dashboard";
}
