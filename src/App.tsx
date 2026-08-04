import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./routes/Login";
import Dashboard from "./routes/Dashboard";
import Caja from "./routes/Caja";
import Productos from "./routes/Productos";
import Reportes from "./routes/Reportes";
import Clientes from "./routes/Clientes";
import CajaGestion from "./routes/CajaGestion";
import Proveedores from "./routes/Proveedores";
import Configuracion from "./routes/Configuracion";
import Vencimientos from "./routes/Vencimientos";
import Etiquetas from "./routes/Etiquetas";
import Usuarios from "./routes/Usuarios";
import Promociones from "./routes/Promociones";
import Auditoria from "./routes/Auditoria";
import Devoluciones from "./routes/Devoluciones";
import Rubros from "./routes/Rubros";
import Presupuestos from "./routes/Presupuestos";
import Inventario from "./routes/Inventario";
import Combos from "./routes/Combos";
import Facturacion from "./routes/Facturacion";
import { useAuthStore } from "./stores/auth";
import { usePosModeStore } from "./stores/posMode";
import { ROUTE_MIN_ROLE, defaultRouteFor, hasAccess } from "./lib/navigation";
import type { UserRole } from "./types";

// Cubre el acceso directo por URL a pantallas que el nav ya oculta en modo
// cliente (ver `serverOnly` en navigation.ts) — ocultar el link del menú no
// alcanza si alguien escribe la ruta a mano.
function RequireServerMode({ children }: { children: React.ReactNode }) {
  const mode = usePosModeStore((s) => s.mode);
  if (mode === "client") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// Hace cumplir de verdad el mínimo rol que ya declara ROUTE_MIN_ROLE (la
// misma fuente que usa el sidebar para ocultar el link) — antes ocultar el
// link era la única protección, así que entrar por URL directa o por el
// historial del navegador saltaba el control por completo.
function RequireRole({ path, children }: { path: string; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const role = (user?.role as UserRole) ?? "cajero";
  const minRole = ROUTE_MIN_ROLE[path];
  if (minRole && !hasAccess(role, minRole)) {
    return <Navigate to={defaultRouteFor(role)} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Login />;

  const role = (user.role as UserRole) ?? "cajero";

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={defaultRouteFor(role)} replace />} />
        <Route path="/dashboard" element={<RequireRole path="/dashboard"><Dashboard /></RequireRole>} />
        <Route path="/caja" element={<Caja />} />
        <Route path="/productos" element={<RequireRole path="/productos"><Productos /></RequireRole>} />
        <Route path="/clientes" element={<RequireRole path="/clientes"><Clientes /></RequireRole>} />
        <Route path="/caja-gestion" element={<RequireRole path="/caja-gestion"><CajaGestion /></RequireRole>} />
        <Route path="/proveedores" element={<RequireRole path="/proveedores"><Proveedores /></RequireRole>} />
        <Route path="/vencimientos" element={<RequireRole path="/vencimientos"><Vencimientos /></RequireRole>} />
        <Route path="/etiquetas" element={<RequireRole path="/etiquetas"><Etiquetas /></RequireRole>} />
        <Route path="/promociones" element={<RequireRole path="/promociones"><Promociones /></RequireRole>} />
        <Route path="/usuarios" element={<RequireRole path="/usuarios"><RequireServerMode><Usuarios /></RequireServerMode></RequireRole>} />
        <Route path="/reportes" element={<RequireRole path="/reportes"><Reportes /></RequireRole>} />
        <Route path="/devoluciones" element={<RequireRole path="/devoluciones"><Devoluciones /></RequireRole>} />
        <Route path="/rubros" element={<RequireRole path="/rubros"><Rubros /></RequireRole>} />
        <Route path="/presupuestos" element={<RequireRole path="/presupuestos"><Presupuestos /></RequireRole>} />
        <Route path="/configuracion" element={<RequireRole path="/configuracion"><Configuracion /></RequireRole>} />
        <Route path="/auditoria" element={<RequireRole path="/auditoria"><Auditoria /></RequireRole>} />
        <Route path="/inventario" element={<RequireRole path="/inventario"><Inventario /></RequireRole>} />
        <Route path="/combos" element={<RequireRole path="/combos"><Combos /></RequireRole>} />
        <Route path="/facturacion" element={<RequireRole path="/facturacion"><Facturacion /></RequireRole>} />
      </Route>
    </Routes>
  );
}
