import { useEffect, useState } from 'react'
import { cn, apiFetch } from '../App.jsx'

// UI de gestion de roles y permisos (RBAC). Solo accesible con permiso 'roles.manage'
// (en la practica, super_admin). Permite crear/editar/eliminar roles y tildar
// que permisos tiene cada uno. Los roles de sistema (admin/super_admin) son de
// solo lectura.

const EMPTY_FORM = { code: '', name: '', description: '', permissions: [] }

export default function RolesPermisosTab({ setToast, setErr }) {
  const [roles, setRoles] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // null | 'new' | roleId
  const [form, setForm] = useState(EMPTY_FORM)

  async function load() {
    setLoading(true)
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiFetch('/admin/roles'),
        apiFetch('/admin/permissions'),
      ])
      setRoles(rolesRes.items || [])
      setCategories(permsRes.categories || [])
    } catch (e) {
      setErr?.(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditing('new')
  }

  function startEdit(role) {
    setForm({
      code: role.code,
      name: role.name || '',
      description: role.description || '',
      permissions: [...(role.permissions || [])],
    })
    setEditing(role.id)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  function togglePerm(code) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(code)
        ? f.permissions.filter((c) => c !== code)
        : [...f.permissions, code],
    }))
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      if (editing === 'new') {
        await apiFetch('/admin/roles', { method: 'POST', body: {
          code: form.code,
          name: form.name,
          description: form.description || null,
          permissions: form.permissions,
        }})
        setToast?.('Rol creado')
      } else {
        await apiFetch(`/admin/roles/${editing}`, { method: 'PATCH', body: {
          name: form.name,
          description: form.description || null,
          permissions: form.permissions,
        }})
        setToast?.('Rol actualizado')
      }
      cancelEdit()
      await load()
    } catch (err) {
      setErr?.(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(role) {
    if (!window.confirm(`¿Eliminar el rol "${role.name}"? Se quitará a todos los usuarios que lo tengan.`)) return
    setBusy(true)
    try {
      await apiFetch(`/admin/roles/${role.id}`, { method: 'DELETE' })
      setToast?.('Rol eliminado')
      await load()
    } catch (err) {
      setErr?.(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-white/60">Cargando roles...</div>
  }

  // Vista editor (crear / editar)
  if (editing) {
    return (
      <form onSubmit={save} className="space-y-6" data-testid="admin-role-editor">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{editing === 'new' ? 'Nuevo rol' : 'Editar rol'}</h3>
          <button type="button" onClick={cancelEdit} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10">
            ← Volver
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-white/60">Código</label>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              disabled={editing !== 'new'}
              placeholder="ej. gestor_notis"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/60">Nombre</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ej. Gestor de notificaciones"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-white/60">Descripción (opcional)</label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-white/50">Permisos</h4>
          {categories.map((cat) => (
            <div key={cat.category} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-semibold text-emerald-300">{cat.category}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cat.permissions.map((p) => (
                  <label key={p.code} className="flex items-start gap-2 rounded-lg p-2 hover:bg-white/5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(p.code)}
                      onChange={() => togglePerm(p.code)}
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
                    />
                    <span className="text-sm">
                      <span className="font-medium">{p.description}</span>
                      <span className="block text-xs text-white/40">{p.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={busy || !form.code || !form.name}
          className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
        >
          {busy ? 'Guardando...' : 'Guardar rol'}
        </button>
      </form>
    )
  }

  // Vista lista
  return (
    <div className="space-y-4" data-testid="admin-roles-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Roles ({roles.length})</h3>
        <button
          onClick={startCreate}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 font-semibold"
        >
          + Crear rol
        </button>
      </div>

      <div className="space-y-3">
        {roles.map((role) => (
          <div key={role.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{role.name}</span>
                  <code className="text-xs text-white/40">{role.code}</code>
                  {role.is_system && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase text-white/50">
                      Sistema
                    </span>
                  )}
                </div>
                {role.description && <p className="mt-0.5 text-sm text-white/60">{role.description}</p>}
                <p className="mt-2 text-xs text-white/40">
                  {role.is_wildcard
                    ? 'Acceso total (todos los permisos)'
                    : `${role.permissions.length} permiso(s)`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {!role.is_system && (
                  <>
                    <button
                      onClick={() => startEdit(role)}
                      className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/20"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => remove(role)}
                      disabled={busy}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
            {!role.is_wildcard && role.permissions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.permissions.map((code) => (
                  <span key={code} className={cn(
                    "rounded-md border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60"
                  )}>
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
