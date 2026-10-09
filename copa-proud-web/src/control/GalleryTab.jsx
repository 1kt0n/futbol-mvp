import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { sourceLabel } from '../lib/model.js'
import { Photo } from '../gallery/Photo.jsx'
import { controlCall } from './controlApi.js'

/*
 * Pestaña "Fotos" de la mesa de control: la carpeta de Drive del fotógrafo ("Reviví tu partido"),
 * el crédito, y a qué partido va cada álbum. El vínculo sale solo del nombre de la carpeta
 * ("Sáb 11:00 · Cancha 9", "Dogos vs Zorros"); acá se corrige el que no se reconoció.
 */

const ERRORS = {
  INVALID_FOLDER_URL: 'Eso no parece un link de carpeta de Google Drive.',
  DRIVE_FOLDER_NOT_FOUND: 'No encontramos la carpeta. Revisá el link y que esté compartida como "Cualquier persona con el enlace · Lector".',
  DRIVE_FORBIDDEN: 'Google rechazó la API key (GOOGLE_DRIVE_API_KEY en Railway): revisá que sea la correcta y que tenga habilitada la Google Drive API.',
  DRIVE_UNAVAILABLE: 'Google Drive no respondió. Probá de nuevo en un rato.',
  DRIVE_NOT_CONFIGURED: 'Falta la API key de Drive en el servidor.',
  INVALID_LINK: 'Ese partido o equipo no existe.',
  ALBUM_NOT_FOUND: 'Ese álbum ya no está en la carpeta.',
}
const errText = (d) => ERRORS[typeof d === 'object' && d ? d.code : d] || (typeof d === 'string' ? d : 'No se pudo completar la acción.')
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function GalleryTab({ token, model }) {
  const { t } = useI18n()
  const [g, setG] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [folder, setFolder] = useState('')
  const [credit, setCredit] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(
    async (refresh = false) => {
      const res = await controlCall(token, 'GET', `/gallery${refresh ? '?refresh=1' : ''}`).catch(() => null)
      if (res?.ok) setG(res.data)
      return res
    },
    [token],
  )

  useEffect(() => {
    load()
    const id = setInterval(() => load(), 30000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (g && !dirty) {
      setFolder(g.folder_url || '')
      setCredit(g.credit || '')
    }
  }, [g, dirty])

  const call = async (method, path, body, ok) => {
    setBusy(true)
    setMsg(null)
    const res = await controlCall(token, method, path, body).catch(() => ({ ok: false, data: { detail: 'Sin conexión: probá de nuevo.' } }))
    setBusy(false)
    if (!res.ok) {
      setMsg({ kind: 'error', text: errText(res.data?.detail) })
      return false
    }
    setG(res.data)
    if (ok) setMsg({ kind: 'ok', text: ok })
    return true
  }

  const save = async (e) => {
    e.preventDefault()
    if (await call('PUT', '/gallery', { folder_url: folder.trim(), credit: credit.trim() }, 'Guardado.')) setDirty(false)
  }

  const options = useMemo(() => linkOptions(model, t), [model, t])
  const labelOf = (link) => options.labels.get(link) || (link === 'G' ? 'General (Más fotos)' : link === 'X' ? 'Oculto' : 'Sin vincular')

  if (!g) return <p className="text-white/60">Cargando…</p>
  // Fuera: la raíz sin fotos sueltas y las carpetas que solo agrupan (p. ej. "Sábado" con una subcarpeta por partido).
  const albums = g.albums.filter((a) => a.count || (!a.is_root && !g.albums.some((b) => b.path.startsWith(`${a.path} / `))))
  const photos = albums.reduce((n, a) => n + a.count, 0)
  const unlinked = albums.filter((a) => !a.is_root && !a.link && !a.hidden && a.manual !== 'G').length

  return (
    <section className="space-y-5">
      {msg && (
        <div role="status" className={`rounded-xl px-4 py-3 text-sm font-bold ${msg.kind === 'error' ? 'bg-[#5a1022] text-[#ffc2cf]' : 'bg-[#0d3b1c] text-[#b6f5c8]'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={save} className="card grid gap-3 p-4 sm:grid-cols-[1fr_280px_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/50">Carpeta de Drive del fotógrafo</span>
          <input value={folder} onChange={(e) => { setFolder(e.target.value); setDirty(true) }} placeholder="https://drive.google.com/drive/folders/…" className="focus-ring w-full rounded-lg bg-white/10 px-3 py-2 text-sm placeholder:text-white/35" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/50">Crédito (nombre · @instagram)</span>
          <input value={credit} onChange={(e) => { setCredit(e.target.value); setDirty(true) }} placeholder="Juan Pérez · @juanfoto" className="focus-ring w-full rounded-lg bg-white/10 px-3 py-2 text-sm placeholder:text-white/35" />
        </label>
        <button type="submit" disabled={busy || !dirty} className="focus-ring rounded-full bg-gold px-5 py-2 text-sm font-extrabold text-night disabled:opacity-40">
          Guardar
        </button>
        <p className="text-xs text-white/45 sm:col-span-3">
          La carpeta tiene que estar compartida como <b>"Cualquier persona con el enlace · Lector"</b>. Una subcarpeta por partido, por
          ejemplo <b>"Sáb 11:00 · Cancha 9"</b> o <b>"Dogos vs Zorros"</b>: se vincula sola. Dejar el link vacío y guardar saca la pestaña del sitio.
        </p>
      </form>

      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span className={g.api_key ? 'font-bold text-[#b6f5c8]' : 'font-bold text-gold-light'}>
          {g.api_key ? '✓ API key de Drive cargada' : '⚠ Sin API key de Drive: el sitio muestra la carpeta embebida'}
        </span>
        {g.folder_id && (
          <a href={g.folder_url} target="_blank" rel="noreferrer" className="focus-ring rounded font-bold underline-offset-2 hover:underline">
            📁 {g.folder_name || 'Carpeta'} ↗
          </a>
        )}
        {g.folder_id && g.api_key && !g.error && (
          <span className="text-white/60">
            {albums.filter((a) => !a.is_root).length} álbumes · {photos} fotos{unlinked ? ` · ${unlinked} sin vincular` : ''}
          </span>
        )}
        {g.error && <span className="font-bold text-[#ffc2cf]">{errText(g.error)}</span>}
        {g.fetched_at && <span className="text-xs text-white/45">Leído de Drive {new Date(g.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
        {g.folder_id && g.api_key && (
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await load(true); setBusy(false); if (r && !r.ok) setMsg({ kind: 'error', text: errText(r.data?.detail) }) }} className="focus-ring ml-auto rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-40">
            ↻ Actualizar ahora
          </button>
        )}
      </div>

      {albums.length > 0 && (
        <div className="card divide-y divide-white/5">
          {albums.map((a) => (
            <div key={a.id} className={`grid grid-cols-[56px_1fr] items-center gap-3 px-3 py-2.5 sm:grid-cols-[56px_1fr_minmax(260px,360px)] ${a.hidden ? 'opacity-50' : ''}`}>
              <span className="h-14 w-14 overflow-hidden rounded-lg bg-white/5">
                {a.cover && <Photo id={a.cover.id} w={160} className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-bold">{a.is_root ? `${a.path} (fotos sueltas)` : a.path}</span>
                <span className="block text-xs text-white/50">
                  {a.count} fotos · {a.manual ? <b className="text-gold-light">a mano: {labelOf(a.manual)}</b> : a.auto ? `solo: ${labelOf(a.auto)}` : 'no se reconoció → va a "Más fotos"'}
                  {a.count > 0 && !a.hidden && (
                    <> · <Link to={`/revivi/${a.id}`} target="_blank" className="font-bold text-white/70 underline-offset-2 hover:underline">ver ↗</Link></>
                  )}
                </span>
              </span>
              {!a.is_root && (
                <select
                  value={a.manual || ''}
                  disabled={busy}
                  onChange={(e) => call('PUT', `/gallery/albums/${a.id}`, { link: e.target.value || null }, 'Álbum actualizado.')}
                  className="col-span-2 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm sm:col-span-1 [&_option]:bg-indigo-800"
                >
                  <option value="">Automático{a.auto ? ` → ${labelOf(a.auto)}` : ' (sin vincular)'}</option>
                  {options.groups.map((grp) => (
                    <optgroup key={grp.label} label={grp.label}>
                      {grp.items.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </optgroup>
                  ))}
                  <optgroup label="Otros">
                    <option value="G">General (Más fotos)</option>
                    <option value="X">Ocultar del sitio</option>
                  </optgroup>
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {g.folder_id && g.api_key && !g.error && !albums.length && (
        <p className="card p-6 text-center text-sm text-white/55">La carpeta todavía no tiene fotos ni subcarpetas.</p>
      )}
    </section>
  )
}

/** Opciones del selector: partidos por día ("Sáb 11:00 · C9 · Dogos vs Zorros") y equipos. */
function linkOptions(model, t) {
  const name = (side) => (side.team_id ? model.teamById.get(side.team_id)?.name : null) || sourceLabel(side.source, t)
  const labels = new Map()
  const groups = model.days.map((d) => ({
    label: `${DAYS[d.weekday]} ${d.day}/${d.month}`,
    items: d.matches.map((m) => {
      const label = `${m.local.time} · C${m.venue} · ${name(m.home)} vs ${name(m.away)}`
      labels.set(`M:${m.code}`, `${DAYS[d.weekday]} ${label}`)
      return [`M:${m.code}`, label]
    }),
  }))
  const teams = [...model.teams].sort((a, b) => a.name.localeCompare(b.name)).map((tm) => {
    labels.set(`T:${tm.id}`, `Equipo ${tm.name}`)
    return [`T:${tm.id}`, tm.name]
  })
  groups.push({ label: 'Equipos (álbum del equipo)', items: teams })
  return { groups, labels }
}
