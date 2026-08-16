import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { confirmAction, showToast } from "@/stores/dialogs";
import { useAuthStore } from "@/stores/auth";
import Field from "@/components/ui/Field";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import ModalCloseButton from "@/components/ui/ModalCloseButton";
import type { NewUser, User, UserRole } from "@/types";
import clsx from "clsx";

const ROLES: { id: UserRole; label: string; desc: string }[] = [
  { id: "admin", label: "Administrador", desc: "Acceso completo al sistema" },
  { id: "supervisor", label: "Supervisor", desc: "Todo el sistema excepto Usuarios y Configuración" },
  { id: "cajero", label: "Cajero", desc: "Solo pantalla de ventas y caja" },
];

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-purple-100 text-purple-700",
  supervisor: "bg-blue-100 text-blue-700",
  cajero: "bg-stone-100 text-stone-600",
};

export default function Usuarios() {
  const actorId = useAuthStore((s) => s.user?.id ?? null);
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [showPassModal, setShowPassModal] = useState<User | null>(null);

  async function load() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(u: Partial<User> & { password?: string }) {
    try {
      if (u.id) {
        await api.updateUser(u as User, actorId);
      } else {
        await api.createUser({
          username: u.username!,
          full_name: u.full_name!,
          password: u.password || "1234",
          role: u.role as UserRole,
        } as NewUser, actorId);
      }
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : "No se pudo guardar el usuario";
      showToast({ message, tone: "danger" });
    }
  }

  async function handleDelete(id: number) {
    if (!(await confirmAction("La persona no va a poder iniciar sesión hasta que se reactive.", { title: "¿Desactivar este usuario?", danger: true, confirmLabel: "Desactivar" }))) return;
    try {
      await api.deleteUser(id, actorId);
      load();
      showToast({ message: "Usuario desactivado" });
    } catch (e) {
      console.error(e);
      const message = typeof e === "string" ? e : e instanceof Error ? e.message : "No se pudo desactivar el usuario";
      showToast({ message, tone: "danger" });
    }
  }

  async function handleReactivate(u: User) {
    try {
      await api.updateUser({ ...u, active: true }, actorId);
      load();
      showToast({ message: "Usuario reactivado", tone: "success" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo reactivar el usuario", tone: "danger" });
    }
  }

  const active = users.filter((u) => u.active);
  const inactive = users.filter((u) => !u.active);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuarios y Permisos</h1>
        <button
          onClick={() => setEditing({ role: "cajero" })}
          className="btn btn-primary"
        >
          + Nuevo usuario
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Roles explicados */}
        <div className="grid grid-cols-3 gap-3">
          {ROLES.map((r) => (
            <div key={r.id} className="card p-3">
              <span className={clsx("text-xs font-semibold px-2 py-0.5 rounded-full", ROLE_COLORS[r.id])}>
                {r.label}
              </span>
              <p className="text-xs text-stone-500 mt-1.5">{r.desc}</p>
            </div>
          ))}
        </div>

        {/* Usuarios activos */}
        <div className="card">
          <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
            <h2 className="font-medium text-sm">Usuarios activos ({active.length})</h2>
          </div>
          {active.length === 0 ? (
            <p className="text-center py-6 text-stone-400 text-sm">Sin usuarios registrados</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Nombre</th>
                  <th className="text-left px-4 py-2.5 font-medium">Usuario</th>
                  <th className="text-left px-4 py-2.5 font-medium">Rol</th>
                  <th className="text-left px-4 py-2.5 font-medium">Creado</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium">{u.full_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">@{u.username}</td>
                    <td className="px-4 py-3">
                      <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS[u.role as UserRole])}>
                        {ROLES.find((r) => r.id === u.role)?.label || u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setShowPassModal(u)} className="btn-table-neutral">Contraseña</button>
                        <button onClick={() => setEditing(u)} className="btn-table-neutral">Editar</button>
                        <button onClick={() => handleDelete(u.id)} className="btn-table-danger">Desactivar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Usuarios inactivos */}
        {inactive.length > 0 && (
          <div className="card">
            <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
              <h2 className="font-medium text-sm text-stone-500">Inactivos ({inactive.length})</h2>
            </div>
            <table className="w-full text-sm opacity-70">
              <tbody>
                {inactive.map((u) => (
                  <tr key={u.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2.5 text-stone-500 line-through">{u.full_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-400">@{u.username}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-stone-400">{u.role}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => handleReactivate(u)} className="btn-table-success">Reactivar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <UserForm
          user={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {showPassModal && (
        <ChangePasswordModal
          user={showPassModal}
          onClose={() => setShowPassModal(null)}
        />
      )}
    </div>
  );
}

function UserForm({
  user,
  onSave,
  onCancel,
}: {
  user: Partial<User> & { password?: string };
  onSave: (u: Partial<User> & { password?: string }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...user, password: "" });
  const isNew = !user.id;
  useEscapeToClose(onCancel);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit() {
    if (!form.full_name?.trim() || !form.username?.trim()) {
      showToast({ message: "Nombre y usuario son obligatorios", tone: "danger" });
      return;
    }
    if (isNew && !form.password) {
      showToast({ message: "Ingresá una contraseña", tone: "danger" });
      return;
    }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="relative bg-white rounded-lg shadow-xl w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onCancel} />
        <h2 className="font-semibold text-lg mb-5">{isNew ? "Nuevo usuario" : "Editar usuario"}</h2>

        <div className="space-y-3">
          <Field label="Nombre completo">
            <input
              autoFocus
              className="input"
              value={form.full_name || ""}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Juan Pérez"
            />
          </Field>
          <Field label="Nombre de usuario">
            <input
              className="input font-mono"
              value={form.username || ""}
              onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))}
              placeholder="jperez"
            />
          </Field>
          {isNew && (
            <Field label="Contraseña inicial">
              <input
                className="input"
                type="password"
                value={form.password || ""}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Mínimo 4 caracteres"
              />
            </Field>
          )}
          <Field label="Rol">
            <select
              className="input"
              value={form.role || "cajero"}
              onChange={(e) => set("role", e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.desc}
                </option>
              ))}
            </select>
          </Field>
          {!isNew && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active !== false}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <label htmlFor="active" className="text-sm text-stone-600">Usuario activo</label>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} className="btn btn-primary flex-1">
            {isNew ? "Crear usuario" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const actorId = useAuthStore((s) => s.user?.id ?? null);
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(onClose);

  async function submit() {
    if (pw.length < 4) { showToast({ message: "Mínimo 4 caracteres", tone: "danger" }); return; }
    setSaving(true);
    try {
      await api.changePassword(user.id, pw, actorId);
      onClose();
      showToast({ message: "Contraseña actualizada", tone: "success" });
    } catch (e) {
      console.error(e);
      showToast({ message: "No se pudo cambiar la contraseña", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="relative bg-white rounded-lg shadow-xl w-[360px] p-6" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClick={onClose} />
        <h3 className="font-semibold mb-1">Cambiar contraseña</h3>
        <p className="text-sm text-stone-500 mb-4">Usuario: <strong>{user.full_name}</strong></p>
        <input
          autoFocus
          type="password"
          className="input mb-4"
          placeholder="Nueva contraseña (mín. 4 caracteres)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">Cancelar</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary flex-1">
            {saving ? "Guardando…" : "Cambiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

