import { useCallback, useEffect, useRef, useState } from 'react'
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

function ExternalRegistrationForm({ data, shareCode, grant, onCancel, onDone }) {
  const courts = (data.courts || []).filter((c) => c.is_open)
  const [displayName, setDisplayName] = useState('')
  const [contact, setContact] = useState('')
  const [courtId, setCourtId] = useState(courts[0]?.court_id || '')
  const [position, setPosition] = useState('')
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const idemRef = useRef(null)
  if (!idemRef.current) {
    idemRef.current = (globalThis.crypto?.randomUUID?.() || `${shareCode}-${Date.now()}`)
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return // prevención de doble submit
    setErr('')
    if (!displayName.trim() || !contact.trim() || !courtId) {
      setErr('Completá nombre, contacto y cancha.')
      return
    }
    if (!privacy) {
      setErr('Tenés que aceptar el aviso de privacidad.')
      return
    }
    setBusy(true)
    try {
      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': idemRef.current }
      if (grant) headers['X-Event-Access'] = grant
      const res = await fetch(`${API_BASE}/public/events/${encodeURIComponent(shareCode)}/participants`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          display_name: displayName.trim(),
          contact: contact.trim(),
          court_id: courtId,
          position: position.trim() || null,
          privacy_accepted: true,
        }),
      })
      if (res.status === 429) { setErr('Demasiados intentos. Esperá un momento e intentá de nuevo.'); return }
      if (res.status === 409) { setErr('Ya hay una inscripción con ese contacto para este evento.'); return }
      if (res.status === 400) {
        const b = await res.json().catch(() => ({}))
        const map = { REGISTRATION_CLOSED: 'La inscripción está cerrada.', PRIVACY_NOT_ACCEPTED: 'Tenés que aceptar el aviso de privacidad.' }
        setErr(map[b.detail] || b.detail || 'Datos inválidos. Revisá el formulario.')
        return
      }
      if (res.status === 401) { setErr('Necesitás la contraseña del evento para anotarte.'); return }
      if (!res.ok) { setErr('No se pudo completar la inscripción. Reintentá.'); return }
      onDone(await res.json())
    } catch {
      setErr('Sin conexión. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="app-card p-5" data-testid="external-registration-form">
      <h1 className="text-lg font-semibold">Anotarme</h1>
      <p className="mt-1 text-sm text-white/60">{data.title}</p>

      <label className="mt-4 block text-xs text-white/60" htmlFor="ext-name">Nombre y apellido</label>
      <input id="ext-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name"
        data-testid="ext-name-input" maxLength={60}
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />

      <label className="mt-3 block text-xs text-white/60" htmlFor="ext-contact">WhatsApp / teléfono</label>
      <input id="ext-contact" value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel" autoComplete="tel"
        data-testid="ext-contact-input" maxLength={30} placeholder="+54 9 11 ..."
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />

      <label className="mt-3 block text-xs text-white/60" htmlFor="ext-court">Cancha</label>
      <select id="ext-court" value={courtId} onChange={(e) => setCourtId(e.target.value)}
        data-testid="ext-court-select"
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20">
        {courts.length === 0 && <option value="">Sin canchas disponibles</option>}
        {courts.map((c) => (
          <option key={c.court_id} value={c.court_id}>
            {c.name} — {c.full ? 'lista de espera' : `${c.available} lugar(es)`}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs text-white/60" htmlFor="ext-position">Posición (opcional)</label>
      <input id="ext-position" value={position} onChange={(e) => setPosition(e.target.value)}
        data-testid="ext-position-input" maxLength={30} placeholder="Arquero, defensor, ..."
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />

      <label className="mt-4 flex items-start gap-2 text-xs text-white/70">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} data-testid="ext-privacy-checkbox" className="mt-0.5" />
        <span>Acepto que se use mi contacto para gestionar esta inscripción. No se comparte públicamente.</span>
      </label>

      {err && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" role="alert">{err}</div>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} data-testid="ext-submit-btn"
          className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">
          {busy ? 'Enviando…' : 'Confirmar inscripción'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm">Volver</button>
      </div>
    </form>
  )
}

function SuccessScreen({ result, onBack }) {
  const mgmtUrl = result.management_path ? `${window.location.origin}${result.management_path}` : ''
  const confirmed = result.status === 'CONFIRMED'
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(mgmtUrl); setCopied(true) } catch { /* noop */ }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Mi inscripción al partido: ${mgmtUrl}`)}`
  return (
    <div className="app-card p-6" data-testid="external-registration-success">
      <div className="text-3xl">{confirmed ? '✅' : '⏳'}</div>
      <h1 className="mt-2 text-xl font-semibold">{confirmed ? '¡Anotado!' : 'En lista de espera'}</h1>
      <p className="mt-1 text-sm text-white/70">
        {confirmed
          ? 'Tu lugar quedó confirmado.'
          : `Estás en la lista de espera${result.waitlist_position ? ` (puesto ${result.waitlist_position})` : ''}. Si se libera un lugar, entrás automáticamente.`}
      </p>
      {mgmtUrl && (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm">
          <div className="font-semibold text-amber-100">Guardá este link</div>
          <p className="mt-1 text-amber-100/80">Es tu acceso para ver el estado o cancelar. No lo compartas con otros.</p>
          <div className="mt-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs break-all text-white/80" data-testid="management-link">{mgmtUrl}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={copy} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black">{copied ? 'Copiado' : 'Copiar'}</button>
            <a href={mgmtUrl} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">Abrir gestión</a>
            <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100">Guardar por WhatsApp</a>
          </div>
        </div>
      )}
      <button onClick={onBack} className="mt-4 text-sm text-white/60 underline">Volver al evento</button>
    </div>
  )
}

export default function PublicEventPage() {
  const { shareCode } = useParams()
  const [grant, setGrant] = useState('') // grant en memoria, NO localStorage (spec seguridad)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ok | locked | notfound | error
  const [err, setErr] = useState('')
  const [mode, setMode] = useState('view') // view | register | done
  const [result, setResult] = useState(null)

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
  if (mode === 'done' && result) {
    return (
      <Shell>
        <SuccessScreen result={result} onBack={() => { setResult(null); setMode('view'); setStatus('loading'); load(grant) }} />
      </Shell>
    )
  }
  if (mode === 'register') {
    return (
      <Shell>
        <ExternalRegistrationForm
          data={data}
          shareCode={shareCode}
          grant={grant}
          onCancel={() => setMode('view')}
          onDone={(res) => { setResult(res); setMode('done') }}
        />
      </Shell>
    )
  }

  const cap = data.capacity || {}
  const open = data.registration_open
  const canRegister = data.allow_external_registration && open
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

        {canRegister ? (
          <div className="mt-5">
            <button onClick={() => setMode('register')} data-testid="public-event-register-cta"
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black hover:bg-emerald-400">
              {cap.full ? 'Sumarme a la lista de espera' : 'Anotarme'}
            </button>
            <a href="/" className="mt-3 block text-center text-xs text-white/50 underline">¿Sos de la comunidad? Ingresá a la app</a>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            {open ? 'Para anotarte, ingresá a la app de la comunidad.' : 'La inscripción está cerrada.'}
            <div className="mt-2">
              <a href="/" className="inline-block rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-black hover:bg-emerald-400">Ir a la app</a>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
