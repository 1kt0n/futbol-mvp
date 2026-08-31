import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { apiFetch, cn } from '../../../App.jsx'

const MODES = [
  { key: 'MEMBERS_ONLY', label: 'Solo miembros', hint: 'Solo la comunidad lo ve y se anota.' },
  { key: 'LINK_ACCESS', label: 'Con enlace', hint: 'Cualquiera con el link puede verlo.' },
  { key: 'LINK_PASSWORD', label: 'Con enlace + clave', hint: 'El link pide una contraseña.' },
]

/**
 * Bloque de configuración de acceso + compartir de un evento.
 * Autónomo: consulta GET /config y se oculta si la feature está deshabilitada.
 * Props:
 *  - event: { id, title, starts_at, location_name }
 *  - access: payload de acceso del detalle admin (access_mode, share_path, password_set, ...)
 *  - onChanged: () => void  (refresca el detalle del evento tras un cambio)
 *  - setToast, setErr: feedback del panel padre
 */
export default function EventAccessPanel({ event, access, onChanged, setToast, setErr }) {
  const [cfg, setCfg] = useState(null)
  const [mode, setMode] = useState(access?.access_mode || 'MEMBERS_ONLY')
  const [roster, setRoster] = useState(access?.public_roster_visibility || 'NONE')
  const [newPassword, setNewPassword] = useState('')
  const [allowExternal, setAllowExternal] = useState(!!access?.allow_external_registration)
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState('')

  useEffect(() => {
    let alive = true
    apiFetch('/config')
      .then((c) => { if (alive) setCfg(c) })
      .catch(() => { if (alive) setCfg({ eventAccessEnabled: false, eventPasswordsEnabled: false }) })
    return () => { alive = false }
  }, [])

  // Resincronizar cuando cambia el evento o su acceso persistido.
  useEffect(() => {
    setMode(access?.access_mode || 'MEMBERS_ONLY')
    setRoster(access?.public_roster_visibility || 'NONE')
    setAllowExternal(!!access?.allow_external_registration)
    setNewPassword('')
    setLocalErr('')
  }, [access?.access_mode, access?.public_roster_visibility, access?.allow_external_registration, event?.id])

  const shareUrl = useMemo(() => {
    if (!access?.share_path) return ''
    try { return `${window.location.origin}${access.share_path}` } catch { return access.share_path }
  }, [access?.share_path])

  if (!cfg || !cfg.eventAccessEnabled) return null

  const passwordsEnabled = !!cfg.eventPasswordsEnabled
  const dirty =
    mode !== access?.access_mode ||
    roster !== (access?.public_roster_visibility || 'NONE') ||
    allowExternal !== !!access?.allow_external_registration ||
    newPassword.trim() !== ''
  const showShare = mode !== 'MEMBERS_ONLY' && !!shareUrl && mode === access?.access_mode

  async function save() {
    setLocalErr('')
    if (mode === 'LINK_PASSWORD' && !access?.password_set && !newPassword.trim()) {
      setLocalErr('Definí una contraseña para el modo con clave.')
      return
    }
    if (mode === 'LINK_PASSWORD' && newPassword.trim() && newPassword.trim().length < 8) {
      setLocalErr('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    const body = { access_mode: mode, public_roster_visibility: roster, allow_external_registration: allowExternal }
    body.password = (mode === 'LINK_PASSWORD' && newPassword.trim())
      ? { action: 'set', value: newPassword.trim() }
      : { action: 'keep' }

    setBusy(true)
    try {
      await apiFetch(`/admin/events/${event.id}/access`, { method: 'PATCH', body })
      setNewPassword('')
      setToast?.('Acceso actualizado')
      onChanged?.()
    } catch (e) {
      setLocalErr(e.message || 'No se pudo guardar el acceso.')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    setBusy(true)
    try {
      await apiFetch(`/admin/events/${event.id}/rotate-share-code`, { method: 'POST' })
      setToast?.('Link rotado. El anterior ya no funciona.')
      onChanged?.()
    } catch (e) {
      setErr?.(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setToast?.('Link copiado')
    } catch {
      setLocalErr('No se pudo copiar. Copialo manualmente.')
    }
  }

  const waMsg = [
    `⚽ ${event.title}`,
    event.starts_at ? `🗓️ ${new Date(event.starts_at).toLocaleString()}` : '',
    event.location_name ? `📍 ${event.location_name}` : '',
    shareUrl ? `Anotate: ${shareUrl}` : '',
  ].filter(Boolean).join('\n')
  const waHref = `https://wa.me/?text=${encodeURIComponent(waMsg)}`

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4" data-testid="event-access-panel">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Acceso y compartir</h3>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const disabled = m.key === 'LINK_PASSWORD' && !passwordsEnabled
          const isActive = mode === m.key
          return (
            <button
              key={m.key}
              type="button"
              disabled={disabled}
              onClick={() => setMode(m.key)}
              data-testid={`access-mode-${m.key}`}
              title={disabled ? 'Habilitá las contraseñas de evento para usar este modo' : m.hint}
              className={cn(
                'rounded-xl border px-3 py-2 text-left text-sm',
                isActive
                  ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <div className="font-semibold">{m.label}</div>
              <div className="mt-0.5 text-xs text-white/50">{m.hint}</div>
            </button>
          )
        })}
      </div>

      {mode === 'LINK_PASSWORD' && (
        <div className="mt-3">
          <label className="text-xs text-white/60" htmlFor="access-password-input">
            {access?.password_set ? 'Contraseña (dejá vacío para mantener la actual)' : 'Contraseña del evento (mín. 8)'}
          </label>
          <input
            id="access-password-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            data-testid="access-password-input"
            placeholder={access?.password_set ? '•••••••• (sin cambios)' : 'frase secreta'}
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          />
          <p className="mt-1 text-xs text-white/40">La clave se comparte por un canal aparte; nunca va en el link ni en el mensaje de WhatsApp.</p>
        </div>
      )}

      {mode !== 'MEMBERS_ONLY' && (
        <div className="mt-3">
          <label className="text-xs text-white/60" htmlFor="access-roster-select">Mostrar anotados en la página pública</label>
          <select
            id="access-roster-select"
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            data-testid="access-roster-select"
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <option value="NONE">No mostrar</option>
            <option value="FIRST_NAME">Solo nombre de pila</option>
            <option value="DISPLAY_NAME">Nombre para mostrar</option>
          </select>
        </div>
      )}

      {mode !== 'MEMBERS_ONLY' && cfg.externalRegistrationEnabled && (
        <label className="mt-3 flex items-start gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={allowExternal}
            onChange={(e) => setAllowExternal(e.target.checked)}
            data-testid="access-allow-external"
            className="mt-0.5"
          />
          <span>
            Permitir inscripción sin cuenta
            <span className="mt-0.5 block text-xs text-white/50">Cualquiera con el enlace puede anotarse desde la página pública.</span>
          </span>
        </label>
      )}

      {localErr && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" role="alert">{localErr}</div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          data-testid="access-save-btn"
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
        >
          {busy ? 'Guardando…' : 'Guardar acceso'}
        </button>
        {mode !== 'MEMBERS_ONLY' && mode !== access?.access_mode && (
          <span className="self-center text-xs text-white/40">Guardá para generar el link.</span>
        )}
      </div>

      {showShare && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Compartir</div>
          <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_150px]">
            <div className="space-y-2">
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm break-all text-white/80" data-testid="access-share-link">{shareUrl}</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} data-testid="access-copy-btn" className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">Copiar link</button>
                <a href={waHref} target="_blank" rel="noreferrer" data-testid="access-whatsapp-link" className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100">WhatsApp</a>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">Abrir</a>
                <button type="button" onClick={rotate} disabled={busy} data-testid="access-rotate-btn" className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Rotar link</button>
              </div>
              {mode === 'LINK_PASSWORD' && <p className="text-xs text-amber-200/70">Acordate de compartir la contraseña por separado.</p>}
            </div>
            <div className="grid place-items-center rounded-lg border border-white/10 bg-black/30 p-2">
              <QRCodeSVG value={shareUrl} size={130} bgColor="#0a0a0a" fgColor="#f5f5f5" />
              <div className="mt-1 text-xs text-white/50">QR</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
