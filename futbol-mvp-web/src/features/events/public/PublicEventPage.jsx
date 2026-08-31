import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cn } from '../../../design/cn.js'

// Same-origin por defecto (el backend sirve el SPA). En dev, VITE_API_URL apunta al backend.
const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || ''

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString()
}

function Shell({ children }) {
  // Layout público mínimo: sin navegación de comunidad.
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </main>
  )
}

function UnlockForm({ shareCode, onUnlocked }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (busy) return // prevención de doble submit
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API_BASE}/public/events/${encodeURIComponent(shareCode)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (res.status === 429) {
        setErr('Demasiados intentos. Esperá un momento e intentá de nuevo.')
        return
      }
      if (res.status === 401) {
        setErr('Contraseña incorrecta.')
        return
      }
      if (!res.ok) {
        setErr('No se pudo validar. Reintentá.')
        return
      }
      const body = await res.json()
      onUnlocked(body.access_token)
    } catch {
      setErr('Sin conexión. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="app-card p-6" data-testid="public-event-unlock">
      <h1 className="text-lg font-semibold">Evento protegido</h1>
      <p className="mt-1 text-sm text-white/60">Ingresá la contraseña que te compartieron para ver este evento.</p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
        autoComplete="off"
        data-testid="unlock-password-input"
        className="mt-4 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
        placeholder="Contraseña del evento"
        aria-label="Contraseña del evento"
      />
      {err && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" role="alert">
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !pw}
        data-testid="unlock-submit-btn"
        className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
      >
        {busy ? 'Validando…' : 'Entrar'}
      </button>
    </form>
  )
}

export default function PublicEventPage() {
  const { shareCode } = useParams()
  const [grant, setGrant] = useState('') // grant en memoria, NO localStorage (spec seguridad)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ok | locked | notfound | error
  const [err, setErr] = useState('')

  // El await va primero a propósito: evita setState síncrono dentro del efecto de
  // montaje (el estado inicial ya es 'loading'). El 'loading' de reintentos se
  // dispara desde los handlers (onClick / onUnlocked), donde setState sí es válido.
  const load = useCallback(async (accessToken = '') => {
    if (!shareCode) return
    try {
      const headers = {}
      if (accessToken) headers['X-Event-Access'] = accessToken
      const res = await fetch(`${API_BASE}/public/events/${encodeURIComponent(shareCode)}`, { headers })
      if (res.status === 404) {
        setStatus('notfound')
        return
      }
      if (!res.ok) {
        setErr('No se pudo cargar el evento.')
        setStatus('error')
        return
      }
      const body = await res.json()
      if (body.password_required) {
        setData(body)
        setStatus('locked')
        return
      }
      setData(body)
      setStatus('ok')
    } catch {
      setErr('Sin conexión. Reintentá.')
      setStatus('error')
    }
  }, [shareCode])

  // Fetch-on-mount: el estado inicial ya es 'loading' y load() setea el resultado
  // recién tras el await. El linter marca cualquier setState alcanzable desde un
  // efecto; acá es intencional y no encadena renders.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (status === 'loading') {
    return <Shell><div className="app-card p-6 text-white/70">Cargando…</div></Shell>
  }

  if (status === 'notfound') {
    return (
      <Shell>
        <div className="app-card p-6" data-testid="public-event-notfound">
          <h1 className="text-lg font-semibold">Evento no disponible</h1>
          <p className="mt-1 text-sm text-white/60">El link no es válido o el evento ya no está disponible.</p>
        </div>
      </Shell>
    )
  }

  if (status === 'error') {
    return (
      <Shell>
        <div className="app-card p-6">
          <p className="text-sm text-rose-200" role="alert">{err}</p>
          <button onClick={() => { setStatus('loading'); load(grant) }} className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">Reintentar</button>
        </div>
      </Shell>
    )
  }

  if (status === 'locked') {
    return <Shell><UnlockForm shareCode={shareCode} onUnlocked={(tok) => { setGrant(tok); setStatus('loading'); load(tok) }} /></Shell>
  }

  // status === 'ok'
  const cap = data.capacity || {}
  const open = data.registration_open
  return (
    <Shell>
      <div className="app-card p-5">
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="public-event-title">{data.title}</h1>
        <p className="mt-1 text-sm text-white/70">📍 {data.location_name}</p>
        <p className="mt-1 text-sm text-white/70">🗓️ {fmtDateTime(data.starts_at)}</p>
        {data.description && (
          <p className="mt-3 max-w-prose whitespace-pre-line text-sm text-white/70">{data.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', open ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/60')}>
            {open ? 'Inscripción abierta' : 'Inscripción cerrada'}
          </span>
          {typeof cap.available === 'number' && (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70" data-testid="public-event-capacity">
              {cap.full ? 'Sin cupos (podés sumarte a la lista de espera)' : `${cap.available} lugar(es) disponible(s)`}
            </span>
          )}
        </div>

        {Array.isArray(data.roster) && data.roster.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Anotados</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.roster.map((p, i) => (
                <span key={i} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/70">{p.name}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
          Para anotarte, ingresá a la app de la comunidad.
          <div className="mt-2">
            <a href="/" className="inline-block rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400">Ir a la app</a>
          </div>
        </div>
      </div>
    </Shell>
  )
}
