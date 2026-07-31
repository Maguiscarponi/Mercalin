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

export default function App() {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/caja" element={<Caja />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/caja-gestion" element={<CajaGestion />} />
        <Route path="/proveedores" element={<Proveedores />} />
        <Route path="/vencimientos" element={<Vencimientos />} />
        <Route path="/etiquetas" element={<Etiquetas />} />
        <Route path="/promociones" element={<Promociones />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/devoluciones" element={<Devoluciones />} />
        <Route path="/rubros" element={<Rubros />} />
        <Route path="/presupuestos" element={<Presupuestos />} />
        <Route path="/configuracion" element={<Configuracion />} />
        <Route path="/auditoria" element={<Auditoria />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/combos" element={<Combos />} />
        <Route path="/facturacion" element={<Facturacion />} />
      </Route>
    </Routes>
  );
}
