import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cn } from '../../../design/cn.js'

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || ''

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString()
}

function Shell({ children }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </main>
  )
}

const STATUS_LABEL = {
  CONFIRMED: { text: 'Confirmada', cls: 'bg-emerald-500/20 text-emerald-200' },
  WAITLIST: { text: 'En lista de espera', cls: 'bg-amber-500/20 text-amber-200' },
  CANCELLED: { text: 'Cancelada', cls: 'bg-white/10 text-white/50' },
}

export default function ExternalParticipationPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ok | notfound | error
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/public/participations/${encodeURIComponent(token)}`)
      if (res.status === 404) { setStatus('notfound'); return }
      if (!res.ok) { setStatus('error'); return }
      setData(await res.json())
      setStatus('ok')
    } catch {
      setStatus('error')
    }
  }, [token])

  // Fetch-on-mount; el estado inicial ya es 'loading'.
  useEffect(() => { load() }, [load])

  async function cancel() {
    if (busy) return
    if (!window.confirm('¿Seguro que querés cancelar tu inscripción?')) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/public/participations/${encodeURIComponent(token)}/cancel`, { method: 'POST' })
      if (!res.ok) { setMsg('No se pudo cancelar. Reintentá.'); return }
      const body = await res.json()
      setData((d) => (d ? { ...d, status: 'CANCELLED' } : d))
      setMsg(body.promoted
        ? 'Inscripción cancelada. Se liberó tu lugar y entró alguien de la lista de espera.'
        : 'Inscripción cancelada.')
    } catch {
      setMsg('Sin conexión. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <Shell><div className="app-card p-6 text-white/70">Cargando…</div></Shell>

  if (status === 'notfound') {
    return (
      <Shell>
        <div className="app-card p-6" data-testid="participation-notfound">
          <h1 className="text-lg font-semibold">Link no válido</h1>
          <p className="mt-1 text-sm text-white/60">Este link de gestión no es válido o expiró.</p>
        </div>
      </Shell>
    )
  }

  if (status === 'error') {
    return (
      <Shell>
        <div className="app-card p-6">
          <p className="text-sm text-rose-200" role="alert">No se pudo cargar. Reintentá.</p>
          <button onClick={() => { setStatus('loading'); load() }} className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">Reintentar</button>
        </div>
      </Shell>
    )
  }

  const st = STATUS_LABEL[data.status] || { text: data.status, cls: 'bg-white/10 text-white/60' }
  const cancelled = data.status === 'CANCELLED'
  return (
    <Shell>
      <div className="app-card p-5" data-testid="participation-detail">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Tu inscripción</div>
        <h1 className="mt-1 text-xl font-semibold">{data.event?.title}</h1>
        <p className="mt-1 text-sm text-white/70">📍 {data.event?.location_name}</p>
        <p className="mt-1 text-sm text-white/70">🗓️ {fmtDateTime(data.event?.starts_at)}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-white/70">{data.display_name}</span>
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', st.cls)} data-testid="participation-status">{st.text}</span>
          {data.court_name && !cancelled && <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">{data.court_name}</span>}
        </div>

        {msg && <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">{msg}</div>}

        {!cancelled && (
          <button onClick={cancel} disabled={busy} data-testid="participation-cancel-btn"
            className="mt-5 w-full rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/25 disabled:opacity-40">
            {busy ? 'Cancelando…' : 'Cancelar mi inscripción'}
          </button>
        )}
      </div>
    </Shell>
  )
}
