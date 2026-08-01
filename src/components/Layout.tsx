import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ShoppingCart, Wallet, Users, RotateCcw,
  Package, Truck, Tag, Calendar, ClipboardList, Layers, Gift,
  FileText, Percent, Receipt, Lock,
  LayoutDashboard, BarChart2, Search, Settings,
  LogOut, Maximize2, Minimize2, ChevronLeft, ChevronRight, ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { ensureCatalogImportListeners } from "@/stores/catalogImport";
import { usePosModeStore } from "@/stores/posMode";
import type { UserRole } from "@/types";

type NavLinkDef = {
  to: string;
  label: string;
  icon: LucideIcon;
  key: string;
  altKey?: string;
  minRole?: UserRole;
  // Oculto para una caja en modo "cliente" — pensado para pantallas donde
  // administrar cuentas desde una caja cualquiera generaría confusión.
  serverOnly?: boolean;
};

const ROLE_LEVEL: Record<UserRole, number> = { cajero: 1, supervisor: 2, admin: 3 };

function hasAccess(userRole: UserRole, minRole: UserRole = "cajero") {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

const NAV_GROUPS: Array<{ label: string; links: NavLinkDef[] }> = [
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
      { to: "/rubros",       label: "Rubros",           icon: Tag,             key: "",                minRole: "supervisor" },
      { to: "/vencimientos", label: "Vencimientos",     icon: Calendar,        key: "",                minRole: "supervisor" },
      { to: "/inventario",   label: "Inventario",       icon: ClipboardList,   key: "",                minRole: "supervisor" },
      { to: "/etiquetas",    label: "Etiquetas",        icon: Layers,          key: "",                minRole: "supervisor" },
      { to: "/combos",       label: "Combos",           icon: Gift,            key: "",                minRole: "supervisor" },
    ],
  },
  {
    label: "Gestión",
    links: [
      { to: "/presupuestos", label: "Presupuestos",     icon: FileText,        key: "",               minRole: "supervisor" },
      { to: "/promociones",  label: "Promociones",      icon: Percent,         key: "",               minRole: "supervisor" },
      { to: "/facturacion",  label: "Facturación",      icon: Receipt,         key: "",               minRole: "supervisor" },
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

const KEY_ROUTES: Record<string, string> = {
  F4: "/dashboard",
  F9: "/caja", F10: "/caja-gestion", F11: "/clientes",
  F5: "/productos", F6: "/proveedores", F7: "/reportes", F8: "/configuracion",
};

const ALT_KEY_ROUTES: Record<string, string> = {
  "1": "/caja", "2": "/caja-gestion", "3": "/clientes",
  "4": "/productos", "5": "/proveedores", "6": "/reportes", "7": "/configuracion",
  "8": "/dashboard",
};

const ROLE_LABEL: Record<UserRole, string> = { admin: "Admin", supervisor: "Supervisor", cajero: "Cajero" };

// Pantallas que se benefician de usar todo el espacio disponible y minimizar distracciones
// (por ahora solo Caja: es donde más importa durante una venta con el cliente esperando).
// El resto de los módulos mantiene el menú lateral para poder saltar de uno a otro directo.
const FOCUS_MODE_ROUTES = new Set(["/caja"]);

export default function Layout() {
  const [businessName, setBusinessName] = useState("Punto Simple");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const userRole = (user?.role as UserRole) ?? "cajero";
  const posModeMode = usePosModeStore((s) => s.mode);
  const isFocusMode = FOCUS_MODE_ROUTES.has(location.pathname);
  const focusLabel = NAV_GROUPS.flatMap((g) => g.links).find((l) => l.to === location.pathname)?.label ?? "";

  useEffect(() => {
    api.getConfig("business_name").then((n) => { if (n) setBusinessName(n); }).catch(console.error);
  }, []);

  useEffect(() => { ensureCatalogImportListeners(); }, []);
  useEffect(() => { usePosModeStore.getState().hydrate(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.altKey) {
        const route = ALT_KEY_ROUTES[e.key];
        if (route) { e.preventDefault(); navigate(route); }
        return;
      }
      const route = KEY_ROUTES[e.key];
      if (route) { e.preventDefault(); navigate(route); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.error);
    else document.exitFullscreen().catch(console.error);
  }

  return (
    <div className="h-screen flex bg-stone-100">

      {/* ── Sidebar (oculto en modo foco) ──────────────────────── */}
      {!isFocusMode && (
      <aside className={clsx(
        "bg-zinc-800 flex flex-col shrink-0 transition-all duration-200",
        sidebarOpen ? "w-52" : "w-14"
      )}>

        {/* Logo / nombre */}
        <div className={clsx(
          "border-b border-zinc-700 flex items-center",
          sidebarOpen ? "px-4 py-4 gap-2" : "px-0 py-4 justify-center"
        )}>
          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-white truncate leading-tight">{businessName}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5 tracking-wide">Punto Simple POS</div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="text-white/60 hover:text-white transition-colors shrink-0 w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10"
            title={sidebarOpen ? "Colapsar" : "Expandir"}
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        {/* Links */}
        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {NAV_GROUPS.map((group) => {
            const links = group.links.filter((l) => hasAccess(userRole, l.minRole) && (!l.serverOnly || posModeMode !== "client"));
            if (!links.length) return null;
            return (
              <div key={group.label} className="mb-1">
                {sidebarOpen && (
                  <p className="px-4 pt-4 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    {group.label}
                  </p>
                )}
                {links.map((l) => {
                  const Icon = l.icon;
                  return (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      title={!sidebarOpen ? l.label : undefined}
                      className={({ isActive }) => clsx(
                        "flex items-center transition-all duration-100 mx-2 rounded-md",
                        sidebarOpen ? "px-2.5 py-[7px] gap-2.5" : "justify-center py-2",
                        isActive
                          ? "bg-white/15 text-white font-bold"
                          : "text-white/75 hover:text-white hover:bg-white/10"
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            size={17}
                            strokeWidth={2}
                            className={clsx("shrink-0 transition-transform duration-150", isActive && "scale-110")}
                          />
                          {sidebarOpen && (
                            <span className="text-[11px] font-semibold uppercase tracking-wider leading-none">
                              {l.label}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer / usuario */}
        <div className={clsx(
          "border-t border-zinc-700",
          sidebarOpen ? "px-3 py-3" : "px-1 py-3 flex flex-col items-center gap-1.5"
        )}>
          {sidebarOpen ? (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{user?.full_name}</p>
                <p className="text-[10px] text-zinc-400">{ROLE_LABEL[userRole]}</p>
              </div>
              <button onClick={logout} title="Cerrar sesión"
                className="text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-md w-7 h-7 flex items-center justify-center">
                <LogOut size={13} />
              </button>
              <button onClick={toggleFullscreen}
                className="text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors w-7 h-7 flex items-center justify-center"
                title={isFullscreen ? "Salir pantalla completa" : "Pantalla completa"}>
                {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </div>
          ) : (
            <>
              <button onClick={logout} title="Cerrar sesión"
                className="text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-md w-8 h-8 flex items-center justify-center">
                <LogOut size={13} />
              </button>
              <button onClick={toggleFullscreen}
                className="text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors w-8 h-8 flex items-center justify-center">
                {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </>
          )}
        </div>
      </aside>
      )}

      {/* ── Contenido ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {isFocusMode && (
          <div className="h-11 bg-zinc-800 flex items-center px-2 gap-1 shrink-0">
            <button
              onClick={() => navigate("/dashboard")}
              title="Volver"
              className="text-white/70 hover:text-white hover:bg-white/10 transition-colors rounded-md w-8 h-8 flex items-center justify-center shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="text-white text-[11px] font-semibold uppercase tracking-wider">{focusLabel}</span>
            <div className="flex-1" />
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Salir pantalla completa" : "Pantalla completa"}
              className="text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors w-8 h-8 flex items-center justify-center shrink-0"
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-md w-8 h-8 flex items-center justify-center shrink-0"
            >
              <LogOut size={13} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
