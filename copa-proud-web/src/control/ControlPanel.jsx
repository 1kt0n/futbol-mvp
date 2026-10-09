import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { I18nProvider, useI18n } from '../i18n/I18nProvider.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { Crest } from '../components/TeamBadge.jsx'
import { buildModel, matchLabel, sourceLabel } from '../lib/model.js'
import { controlCall } from './controlApi.js'
import { GalleryTab } from './GalleryTab.jsx'
import StaffTab from './StaffTab.jsx'
import RosterTab from './RosterTab.jsx'

/*
 * MESA DE CONTROL (/control/<token>): resultados de todos los partidos y sus correcciones.
 * Lo usa la organización en el predio (sin login): ver lo que cargan los veedores, corregir
 * marcadores y eventos, W.O., penales, confirmar contra la planilla y cerrar la fase de grupos.
 * Textos en español (uso interno). Se refresca solo cada 10 s.
 */

const STATUS = {
  SCHEDULED: ['Programado', 'bg-white/10 text-white/70'],
  LIVE: ['En juego', 'bg-live/25 text-[#ff8aa5]'],
  HALFTIME: ['Entretiempo', 'bg-gold/20 text-gold-light'],
  FINISHED: ['Terminado', 'bg-[#008026]/30 text-[#b6f5c8]'],
  WALKOVER: ['W.O.', 'bg-[#008026]/30 text-[#b6f5c8]'],
}
const EVENT = { GOAL: 'Gol', OWN_GOAL: 'Gol en contra', YELLOW: 'Amarilla', RED: 'Roja' }
const ERRORS = {
  INVALID_CONTROL_TOKEN: 'Link inválido o reemplazado. Generá uno nuevo con scripts/control_link.py.',
  MATCH_CONFIRMED: 'Está confirmado: tocá "Desconfirmar" para poder editarlo.',
  MATCH_NOT_STARTED: 'El partido no empezó: cargá el resultado final o pasalo a "En juego".',
  TEAMS_NOT_DEFINED: 'Todavía no están definidos los dos equipos de este partido.',
  PENALTIES_REQUIRED: 'Empate en un cruce eliminatorio: cargá los penales.',
  SCORE_REQUIRED: 'Completá los goles de los dos equipos.',
  MATCH_NOT_FINISHED: 'Solo se confirma un partido terminado.',
  PLAYER_NOT_IN_TEAM: 'Ese jugador no es de ese equipo.',
  EVENT_NOT_FOUND: 'Ese evento ya no existe (alguien lo borró). Se actualizó la pantalla.',
  GROUP_STAGE_ALREADY_CLOSED: 'La fase de grupos ya estaba cerrada.',
  CANNOT_CLOSE_GROUP_STAGE: 'Todavía no se puede cerrar: mirá lo que falta en la revisión.',
  KNOCKOUT_ALREADY_STARTED: 'Ya empezó algún cruce eliminatorio: no se puede reabrir.',
  DUPLICATE_RANKS: 'El orden del sorteo tiene posiciones repetidas.',
  SHIRT_NUMBER_TAKEN: 'Ese número ya lo tiene otro jugador del equipo.',
  PLAYER_NOT_FOUND: 'Ese jugador ya no existe (alguien lo quitó). Se actualizó la pantalla.',
  NAME_REQUIRED: 'El nombre no puede quedar vacío.',
}
const errText = (d) => {
  const code = typeof d === 'object' && d ? d.code : d
  if (typeof code === 'string' && code.startsWith('INVALID_TRANSITION')) return 'Ese cambio de estado no está permitido desde el estado actual.'
  return ERRORS[code] || (typeof code === 'string' ? code : 'No se pudo completar la acción.')
}

export default function ControlPanel() {
  return (
    <I18nProvider forceLang="es">
      <Panel />
    </I18nProvider>
  )
}

function Panel() {
  const { token } = useParams()
  const [snap, setSnap] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [tab, setTab] = useState('partidos')
  const [openCode, setOpenCode] = useState(null)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    const res = await controlCall(token, 'GET', '').catch(() => null)
    if (!res) return
    if (res.status === 401) return setFatal(ERRORS.INVALID_CONTROL_TOKEN)
    if (res.ok) {
      setSnap(res.data)
      setUpdatedAt(new Date())
    }
  }, [token])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(id)
  }, [toast])

  /** Acción contra la API: avisa el error o los cruces en conflicto y refresca. */
  const act = useCallback(
    async (method, path, body, okText) => {
      setBusy(true)
      const res = await controlCall(token, method, path, body).catch(() => ({ ok: false, data: { detail: 'Sin conexión: probá de nuevo.' } }))
      setBusy(false)
      if (!res.ok) {
        setToast({ kind: 'error', text: errText(res.data?.detail) })
        if (res.status === 404) load()
        return null
      }
      const conflicts = res.data?.conflicts || []
      if (conflicts.length) {
        setToast({ kind: 'warn', text: `Guardado. Ojo: ${conflicts.length} cruce(s) ya empezado(s) quedarían con otro equipo (${[...new Set(conflicts.map((c) => c.code))].join(', ')}). Revisalos.` })
      } else if (okText) {
        setToast({ kind: 'ok', text: okText })
      }
      await load()
      return res.data || {}
    },
    [token, load],
  )

  const model = useMemo(() => (snap ? buildModel(snap) : null), [snap])

  if (fatal) return <Shell><p className="card mt-10 p-6 text-center font-bold">{fatal}</p></Shell>
  if (!model) return <Shell><p className="mt-16 text-center text-white/60">Cargando…</p></Shell>

  const open = openCode ? model.matchByCode.get(openCode) : null
  return (
    <Shell>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="kicker">Mesa de control · {model.comp.name}</div>
          <h1 className="text-2xl font-extrabold">Resultados</h1>
        </div>
        <span className="text-xs text-white/45">{updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
        <nav className="ml-auto flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/5 p-1 ring-1 ring-white/10">
          {[['partidos', 'Partidos'], ['zonas', 'Zonas y cierre'], ['veedores', 'Veedores'], ['planteles', 'Planteles'], ['fotos', 'Fotos'], ['historial', 'Historial']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`focus-ring shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-white text-night' : 'text-white/70 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {toast && (
        <div role="status" className={`sticky top-2 z-30 mb-4 rounded-xl px-4 py-3 text-sm font-bold shadow-xl ${toast.kind === 'error' ? 'bg-[#5a1022] text-[#ffc2cf]' : toast.kind === 'warn' ? 'bg-[#4a3a08] text-gold-light' : 'bg-[#0d3b1c] text-[#b6f5c8]'}`}>
          {toast.text}
        </div>
      )}

      {tab === 'partidos' && <MatchesTab model={model} onOpen={setOpenCode} />}
      {tab === 'zonas' && <GroupsTab model={model} token={token} act={act} busy={busy} />}
      {tab === 'veedores' && <StaffTab staff={snap.staff || []} model={model} act={act} busy={busy} />}
      {tab === 'planteles' && <RosterTab model={model} act={act} busy={busy} />}
      {tab === 'fotos' && <GalleryTab token={token} model={model} />}
      {tab === 'historial' && <AuditTab token={token} model={model} />}

      {open && <MatchEditor key={open.code} match={open} model={model} staff={snap.staff || []} act={act} busy={busy} onClose={() => setOpenCode(null)} />}
    </Shell>
  )
}

// ------------------------------------------------------------------ partidos

function teamName(model, side, t) {
  const tm = side.team_id ? model.teamById.get(side.team_id) : null
  return tm ? tm.name : sourceLabel(side.source, t)
}

function StatusChip({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-white/10']
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${cls}`}>{label}</span>
}

function MatchesTab({ model, onOpen }) {
  const { t } = useI18n()
  const [day, setDay] = useState(() => {
    const live = model.liveMatches[0]?.local?.date
    return live || model.days.find((d) => d.matches.some((m) => m.status !== 'FINISHED' && m.status !== 'WALKOVER'))?.date || model.days[0]?.date
  })
  const [court, setCourt] = useState('')
  const [filter, setFilter] = useState('todos')
  const [q, setQ] = useState('')

  const all = model.matches
  const counts = {
    live: all.filter((m) => m.status === 'LIVE' || m.status === 'HALFTIME').length,
    toConfirm: all.filter((m) => (m.status === 'FINISHED' || m.status === 'WALKOVER') && !m.confirmed).length,
    confirmed: all.filter((m) => m.confirmed).length,
    mismatch: all.filter((m) => m.goal_detail_mismatch).length,
  }
  const FILTERS = [
    ['todos', 'Todos'],
    ['vivo', `En juego (${counts.live})`],
    ['confirmar', `Para confirmar (${counts.toConfirm})`],
    ['confirmados', `Confirmados (${counts.confirmed})`],
    ['programados', 'Programados'],
    ['desfasaje', `Marcador ≠ goles (${counts.mismatch})`],
  ]
  const needle = q.trim().toLowerCase()
  const rows = all.filter((m) => {
    if (day && m.local?.date !== day) return false
    if (court && String(m.venue) !== court) return false
    if (filter === 'vivo' && !(m.status === 'LIVE' || m.status === 'HALFTIME')) return false
    if (filter === 'confirmar' && !((m.status === 'FINISHED' || m.status === 'WALKOVER') && !m.confirmed)) return false
    if (filter === 'confirmados' && !m.confirmed) return false
    if (filter === 'programados' && m.status !== 'SCHEDULED') return false
    if (filter === 'desfasaje' && !m.goal_detail_mismatch) return false
    if (needle) {
      const names = `${teamName(model, m.home, t)} ${teamName(model, m.away, t)} ${m.code}`.toLowerCase()
      if (!names.includes(needle)) return false
    }
    return true
  })
  const dayLabel = (d) => `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.weekday]} ${d.day}/${d.month}`

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-white/5 p-1 ring-1 ring-white/10">
          {model.days.map((d) => (
            <button key={d.date} type="button" onClick={() => setDay(d.date)} className={`focus-ring rounded-full px-3 py-1 text-sm font-bold ${day === d.date ? 'bg-gold text-night' : 'text-white/70'}`}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
        <select value={court} onChange={(e) => setCourt(e.target.value)} className="rounded-lg bg-white/10 px-2 py-1.5 text-sm [&>option]:bg-indigo-800">
          <option value="">Todas las canchas</option>
          {model.venues.map((v) => <option key={v.number} value={v.number}>Cancha {v.number}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar equipo…" className="focus-ring min-w-[160px] flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm placeholder:text-white/40" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`focus-ring rounded-full px-3 py-1 text-xs font-bold ring-1 ${filter === k ? 'bg-white text-night ring-white' : 'text-white/70 ring-white/15 hover:bg-white/10'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="card divide-y divide-white/5">
        {rows.map((m) => (
          <button key={m.code} type="button" onClick={() => onOpen(m.code)} className="focus-ring grid w-full grid-cols-[52px_44px_1fr_auto] items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 sm:grid-cols-[52px_52px_110px_1fr_auto]">
            <span className="board-num text-xl text-gold">{m.local?.time}</span>
            <span className="text-xs font-bold text-white/60">C{m.venue}</span>
            <span className="hidden truncate text-xs font-bold uppercase tracking-wide text-white/50 sm:block">{matchLabel(m.code, t)}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-right font-bold">{teamName(model, m.home, t)}</span>
                <span className="board-num w-14 shrink-0 text-center text-xl">
                  {m.home_goals ?? '–'}<span className="text-white/30">:</span>{m.away_goals ?? '–'}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">{teamName(model, m.away, t)}</span>
              </span>
              {m.veedor_name && <span className="block truncate text-center text-[11px] text-white/40">Veedor: {m.veedor_name}</span>}
            </span>
            <span className="flex flex-col items-end gap-1">
              <StatusChip status={m.status} />
              {m.confirmed && <span className="text-[11px] font-extrabold text-[#b6f5c8]">✓ Confirmado</span>}
              {m.goal_detail_mismatch && <span className="text-[11px] font-extrabold text-gold-light" title="El marcador no coincide con los goles cargados">⚠ goles</span>}
            </span>
          </button>
        ))}
        {!rows.length && <p className="px-4 py-6 text-center text-sm text-white/50">No hay partidos con ese filtro.</p>}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ edición de un partido

function MatchEditor({ match, model, staff, act, busy, onClose }) {
  const { t } = useI18n()
  const base = `/matches/${match.code}`
  const home = match.home.team_id ? model.teamById.get(match.home.team_id) : null
  const away = match.away.team_id ? model.teamById.get(match.away.team_id) : null
  const knockout = match.stage !== 'GROUP'
  const [hg, setHg] = useState(match.home_goals ?? '')
  const [ag, setAg] = useState(match.away_goals ?? '')
  const [hp, setHp] = useState(match.home_pens ?? '')
  const [ap, setAp] = useState(match.away_pens ?? '')
  const [arm, setArm] = useState(null)
  const [newEv, setNewEv] = useState({ side: 'home', type: 'GOAL', player: '' })
  const locked = match.confirmed
  const num = (v) => (v === '' || v === null ? null : Number(v))
  const tie = num(hg) !== null && num(hg) === num(ag)

  const saveFinal = () =>
    act('POST', `${base}/result`, { home_goals: num(hg), away_goals: num(ag), ...(knockout && tie ? { home_pens: num(hp), away_pens: num(ap) } : {}) }, `Resultado final guardado: ${num(hg)}-${num(ag)}.`)
  const fixScore = () => act('PATCH', base, { home_goals: num(hg), away_goals: num(ag) }, 'Marcador corregido (el estado no cambió).')
  const armed = (key, fn) => () => (arm === key ? (setArm(null), fn()) : setArm(key))
  const teamOf = (teamId) => (teamId === home?.id ? home : away)
  const players = (team) => team?.players || []

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-indigo-800 p-5 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="kicker">{matchLabel(match.code, t)} · {match.local?.time} · Cancha {match.venue}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusChip status={match.status} />
              {match.confirmed && <span className="rounded-full bg-[#008026]/30 px-2 py-0.5 text-[11px] font-extrabold text-[#b6f5c8]">✓ CONFIRMADO</span>}
              <VeedorSelect match={match} staff={staff} act={act} busy={busy} />
            </div>
          </div>
          <button type="button" onClick={onClose} className="focus-ring rounded-lg px-3 py-1 text-white/60 ring-1 ring-white/15">Cerrar ✕</button>
        </div>

        {match.goal_detail_mismatch && (
          <p className="mb-3 rounded-xl bg-gold/15 p-3 text-sm font-bold text-gold-light">⚠ El marcador no coincide con los goles cargados como eventos. Revisá la lista de abajo.</p>
        )}
        {locked && <p className="mb-3 rounded-xl bg-white/5 p-3 text-sm text-white/70">Confirmado contra la planilla: para corregir algo, primero <b>Desconfirmar</b>.</p>}

        {/* Marcador */}
        <div className="card mb-4 p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <TeamBlock team={home} fallback={teamName(model, match.home, t)} />
            <div className="flex items-center gap-2">
              <ScoreInput value={hg} onChange={setHg} disabled={locked} />
              <span className="text-white/40">:</span>
              <ScoreInput value={ag} onChange={setAg} disabled={locked} />
            </div>
            <TeamBlock team={away} fallback={teamName(model, match.away, t)} />
          </div>
          {knockout && tie && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              <span className="text-white/60">Penales</span>
              <ScoreInput value={hp} onChange={setHp} disabled={locked} small />
              <span className="text-white/40">:</span>
              <ScoreInput value={ap} onChange={setAp} disabled={locked} small />
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy || locked || !home || !away} onClick={saveFinal} className="focus-ring rounded-xl bg-gold px-4 py-2.5 font-extrabold text-night disabled:opacity-40">
              Guardar resultado final
            </button>
            {match.status !== 'SCHEDULED' && (
              <button type="button" disabled={busy || locked} onClick={fixScore} className="focus-ring rounded-xl px-4 py-2.5 text-sm font-bold ring-1 ring-white/25 disabled:opacity-40">
                Solo corregir el marcador
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-white/45">"Resultado final" deja el partido Terminado (también si no se cargó en vivo). "Solo corregir" no cambia el estado.</p>
        </div>

        {/* Estado, W.O. y confirmación */}
        <div className="card mb-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="kicker w-16">Estado</span>
            {[
              ['LIVE', match.status === 'FINISHED' || match.status === 'WALKOVER' ? 'Reabrir (en juego)' : 'En juego'],
              ['HALFTIME', 'Entretiempo'],
              ['FINISHED', 'Terminado'],
            ].map(([st, label]) => (
              <button key={st} type="button" disabled={busy || locked || match.status === st} onClick={() => act('POST', `${base}/status`, { status: st }, `Estado: ${label}.`)} className="focus-ring rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold disabled:opacity-30">
                {label}
              </button>
            ))}
          </div>
          {home && away && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="kicker w-16">W.O.</span>
              {[['HOME', home], ['AWAY', away]].map(([w, team]) => (
                <button key={w} type="button" disabled={busy || locked} onClick={armed(`wo-${w}`, () => act('POST', `${base}/walkover`, { winner: w }, `W.O.: gana ${team.name}.`))} className={`focus-ring rounded-lg px-3 py-1.5 text-sm font-bold disabled:opacity-30 ${arm === `wo-${w}` ? 'bg-live text-white' : 'bg-white/10'}`}>
                  {arm === `wo-${w}` ? 'Tocá de nuevo para confirmar' : `Gana ${team.name}`}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="kicker w-16">Planilla</span>
            {match.confirmed ? (
              <button type="button" disabled={busy} onClick={() => act('POST', `${base}/unconfirm`, null, 'Desconfirmado: ya se puede editar.')} className="focus-ring rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold">
                Desconfirmar
              </button>
            ) : (
              <button type="button" disabled={busy || !(match.status === 'FINISHED' || match.status === 'WALKOVER')} onClick={() => act('POST', `${base}/confirm`, null, '✓ Confirmado como resultado oficial.')} className="focus-ring rounded-lg bg-[#008026] px-3 py-1.5 text-sm font-extrabold text-white disabled:opacity-30">
                ✓ Confirmar (coincide con la planilla)
              </button>
            )}
          </div>
        </div>

        {/* Eventos */}
        <div className="card p-4">
          <div className="kicker mb-2">Goles y tarjetas ({match.events.length})</div>
          <ul className="mb-3 divide-y divide-white/5">
            {match.events.map((e) => {
              const team = teamOf(e.team_id)
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="w-24 shrink-0 font-bold">{EVENT[e.type] || e.type}</span>
                  <span className="w-28 shrink-0 truncate text-white/60">{team?.name}</span>
                  <select
                    value={e.player_id || ''}
                    disabled={busy || locked}
                    onChange={(ev) => act('PATCH', `${base}/events/${e.id}`, { player_id: ev.target.value || null }, 'Jugador actualizado.')}
                    className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-sm [&>option]:bg-indigo-800"
                  >
                    <option value="">— sin identificar —</option>
                    {players(team).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <span className="w-full text-[11px] text-white/40 sm:w-auto">{e.loaded_by ? `cargó ${e.loaded_by}` : e.source === 'ADMIN' ? 'mesa' : ''}</span>
                  <button type="button" disabled={busy || locked} onClick={armed(`del-${e.id}`, () => act('DELETE', `${base}/events/${e.id}`, null, 'Evento borrado.'))} className={`focus-ring rounded-lg px-2 py-1 text-xs font-bold disabled:opacity-30 ${arm === `del-${e.id}` ? 'bg-live text-white' : 'text-[#ff9db3]'}`}>
                    {arm === `del-${e.id}` ? '¿Borrar?' : 'Borrar'}
                  </button>
                </li>
              )
            })}
            {!match.events.length && <li className="py-2 text-sm text-white/45">Sin goles ni tarjetas cargados.</li>}
          </ul>
          {home && away && !locked && match.status !== 'SCHEDULED' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-2">
              <select value={newEv.side} onChange={(e) => setNewEv({ ...newEv, side: e.target.value, player: '' })} className="rounded-lg bg-white/10 px-2 py-1 text-sm [&>option]:bg-indigo-800">
                <option value="home">{home.name}</option>
                <option value="away">{away.name}</option>
              </select>
              <select value={newEv.type} onChange={(e) => setNewEv({ ...newEv, type: e.target.value })} className="rounded-lg bg-white/10 px-2 py-1 text-sm [&>option]:bg-indigo-800">
                {Object.entries(EVENT).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <select value={newEv.player} onChange={(e) => setNewEv({ ...newEv, player: e.target.value })} className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-sm [&>option]:bg-indigo-800">
                <option value="">— sin identificar —</option>
                {players(newEv.side === 'home' ? home : away).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act('POST', `${base}/events`, {
                    team_id: (newEv.side === 'home' ? home : away).id,
                    type: newEv.type,
                    player_id: newEv.player || null,
                    client_event_id: (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
                  }, `${EVENT[newEv.type]} agregado.`).then((ok) => ok && setNewEv({ ...newEv, player: '' }))
                }
                className="focus-ring rounded-lg bg-white px-3 py-1 text-sm font-extrabold text-night"
              >
                Agregar
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-white/45">Agregar o borrar un gol mueve el marcador; cambiar el jugador no.</p>
        </div>
      </div>
    </div>
  )
}

/** Quién tiene el partido (los veedores lo toman en la cancha). Acá se cambia o se libera. */
function VeedorSelect({ match, staff, act, busy }) {
  const active = staff.filter((s) => s.role === 'VEEDOR' && !s.revoked)
  const current = match.veedor_staff_id || ''
  const change = (e) => {
    const id = e.target.value
    if (id === current) return
    const name = active.find((s) => s.id === id)?.full_name
    act('PATCH', `/matches/${match.code}`, id ? { veedor_staff_id: id } : { clear_veedor: true }, id ? `Ahora lo carga ${name}.` : 'Partido sin veedor: lo puede tomar cualquiera.')
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-white/55">
      Veedor
      <select value={current} onChange={change} disabled={busy} className="focus-ring max-w-[200px] rounded-lg bg-white/10 px-2 py-1 text-sm font-bold text-white [&>option]:bg-indigo-800">
        <option value="">— Libre (sin veedor) —</option>
        {active.map((s) => (
          <option key={s.id} value={s.id}>{s.full_name}</option>
        ))}
        {current && !active.some((s) => s.id === current) && <option value={current}>{match.veedor_name || 'Dado de baja'}</option>}
      </select>
    </label>
  )
}

function TeamBlock({ team, fallback }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      {team ? <Crest team={team} size="md" /> : <span className="h-10 w-10 rounded-full border border-dashed border-white/25" />}
      <span className="line-clamp-2 text-sm font-bold leading-tight">{team ? team.name : fallback}</span>
    </div>
  )
}

function ScoreInput({ value, onChange, disabled, small }) {
  return (
    <input
      type="number"
      min="0"
      max="99"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(0, Math.min(99, Number(e.target.value))))}
      className={`board-num rounded-lg bg-white/10 text-center text-gold ring-1 ring-white/15 disabled:opacity-50 ${small ? 'h-10 w-12 text-2xl' : 'h-14 w-16 text-4xl'}`}
    />
  )
}

// ------------------------------------------------------------------ zonas y cierre

function GroupsTab({ model, token, act, busy }) {
  const [check, setCheck] = useState(null)
  const [arm, setArm] = useState(null)
  const closed = model.comp.group_stage_closed
  const groupMatches = model.matches.filter((m) => m.stage === 'GROUP')
  const finished = groupMatches.filter((m) => m.status === 'FINISHED' || m.status === 'WALKOVER').length
  const name = (id) => model.teamById.get(id)?.name || '?'
  // Un empate solo se sortea cuando la zona terminó (antes puede cambiar); terceros y cuartos, al
  // terminar todas.
  const groupDone = (g) => groupMatches.filter((m) => m.group === g).every((m) => m.status === 'FINISHED' || m.status === 'WALKOVER')
  const ties = (check?.ties || []).filter((tie) =>
    tie.context.startsWith('GROUP:') ? groupDone(tie.context.slice(6)) : finished === groupMatches.length,
  )
  const preview = (check?.preview || []).filter((p) => p.home || p.away)

  const review = useCallback(async () => {
    const res = await controlCall(token, 'GET', '/group-stage/preview').catch(() => null)
    if (res?.ok) setCheck(res.data)
  }, [token])
  useEffect(() => {
    review()
  }, [review, model.comp.data_version])

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {model.groups.map((g) => (
          <div key={g.code} className="card overflow-x-auto p-3">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="board-num gold-text text-3xl leading-none">{g.code}</span>
              <span className="text-xs text-white/50">{g.complete ? 'completa' : 'en juego'}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-white/45">
                  <th className="w-6 text-left">#</th><th className="text-left">Equipo</th><th>PJ</th><th>Pts</th><th>DG</th><th>GF</th><th>FP</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={r.team_id} className="border-t border-white/5">
                    <td className="py-1 text-white/50">{i + 1}</td>
                    <td className="truncate py-1 font-bold">{name(r.team_id)}{r.tie_unresolved && <span className="ml-1 text-gold-light" title="Empate que se define por sorteo">⚑</span>}</td>
                    <td className="text-center">{r.played}</td>
                    <td className="text-center font-extrabold text-gold">{r.points}</td>
                    <td className="text-center">{r.goal_diff}</td>
                    <td className="text-center">{r.goals_for}</td>
                    <td className="text-center text-white/60">{r.fair_play}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="card p-4">
          <div className="kicker mb-1">Fase de grupos</div>
          <p className="text-lg font-extrabold">{closed ? 'Cerrada ✓' : 'Abierta'}</p>
          <p className="text-sm text-white/60">{finished} de {groupMatches.length} partidos terminados</p>

          {!closed && check && (
            <div className="mt-3 space-y-2 text-sm">
              {check.unfinished_matches.length > 0 && (
                <p className="rounded-lg bg-white/5 p-2">Faltan terminar {check.unfinished_matches.length} partido(s): {check.unfinished_matches.slice(0, 8).join(', ')}{check.unfinished_matches.length > 8 ? '…' : ''}</p>
              )}
              {ties.length > 0 && <p className="rounded-lg bg-gold/15 p-2 font-bold text-gold-light">Hay {ties.length} empate(s) que se definen por sorteo: cargá el orden abajo.</p>}
              {check.can_close && <p className="rounded-lg bg-[#008026]/25 p-2 font-bold text-[#b6f5c8]">Todo listo para cerrar.</p>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {!closed ? (
              <button
                type="button"
                disabled={busy || !check?.can_close}
                onClick={() => (arm === 'close' ? (setArm(null), act('POST', '/group-stage/close', null, 'Fase de grupos cerrada: los cruces del domingo quedaron armados.')) : setArm('close'))}
                className={`focus-ring rounded-xl px-4 py-2.5 font-extrabold disabled:opacity-30 ${arm === 'close' ? 'bg-live text-white' : 'bg-gold text-night'}`}
              >
                {arm === 'close' ? 'Tocá de nuevo: se arman los cruces' : 'Cerrar fase de grupos'}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => (arm === 'reopen' ? (setArm(null), act('POST', '/group-stage/reopen', null, 'Fase de grupos reabierta.')) : setArm('reopen'))}
                className={`focus-ring rounded-xl px-4 py-2.5 text-sm font-extrabold ${arm === 'reopen' ? 'bg-live text-white' : 'text-[#ff9db3] ring-1 ring-[#ff9db3]/40'}`}
              >
                {arm === 'reopen' ? 'Tocá de nuevo: se vacían los cruces' : 'Reabrir fase de grupos'}
              </button>
            )}
            <button type="button" onClick={review} className="focus-ring rounded-xl px-3 py-2.5 text-sm font-bold ring-1 ring-white/20">Revisar</button>
          </div>
        </div>

        {!closed && ties.map((tie) => <TieBreak key={tie.context + tie.team_ids.join()} tie={tie} name={name} act={act} busy={busy} />)}

        {preview.length > 0 && (
          <div className="card p-4">
            <div className="kicker mb-2">{closed ? 'Cruces armados' : 'Así quedarían los cruces'}</div>
            <ul className="space-y-1 text-sm">
              {preview.map((p) => (
                <li key={p.code} className="flex gap-2">
                  <span className="w-20 shrink-0 text-xs font-bold text-white/50">{p.code}</span>
                  <span className="truncate">{p.home ? name(p.home) : '·'} <span className="text-white/40">vs</span> {p.away ? name(p.away) : '·'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </section>
  )
}

/** Empate que se define por sorteo: se ordena con ↑ ↓ y se guarda. */
function TieBreak({ tie, name, act, busy }) {
  const [order, setOrder] = useState(tie.team_ids)
  const move = (i, d) => {
    const next = [...order]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setOrder(next)
  }
  const label = tie.context.startsWith('GROUP:') ? `Zona ${tie.context.slice(6)}` : tie.context === 'THIRD' ? 'Mejores terceros' : 'Mejores cuartos'
  return (
    <div className="card p-4">
      <div className="kicker mb-1">Sorteo de desempate · {label}</div>
      <p className="mb-2 text-xs text-white/55">Ordená según el sorteo (arriba = mejor ubicado) y guardá.</p>
      <ol className="mb-3 space-y-1">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1 text-sm">
            <span className="w-5 font-bold text-gold">{i + 1}</span>
            <span className="flex-1 truncate font-bold">{name(id)}</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-2 disabled:opacity-20">↑</button>
            <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="rounded px-2 disabled:opacity-20">↓</button>
          </li>
        ))}
      </ol>
      <button type="button" disabled={busy} onClick={() => act('PUT', '/draws', { context: tie.context, ranks: order.map((team_id, i) => ({ team_id, rank: i + 1 })) }, `Sorteo guardado (${label}).`)} className="focus-ring rounded-xl bg-gold px-4 py-2 text-sm font-extrabold text-night">
        Guardar sorteo
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ historial

const ACTIONS = {
  MATCH_RESULT: 'Resultado final', MATCH_PATCH: 'Corrección', MATCH_WALKOVER: 'W.O.', MATCH_CONFIRM: 'Confirmado',
  MATCH_UNCONFIRM: 'Desconfirmado', MATCH_STATUS: 'Estado', GROUP_STAGE_CLOSE: 'Cierre de grupos', GROUP_STAGE_REOPEN: 'Reapertura de grupos',
  DRAW_SET: 'Sorteo de desempate', BRACKET_SYNC: 'Cruces actualizados',
  GALLERY_CONFIG: 'Fotos: carpeta / crédito', GALLERY_LINK: 'Fotos: álbum vinculado',
  MATCH_CLAIM: 'Tomó el partido', MATCH_TAKEOVER: 'Tomó el partido (se lo sacó a otro)', MATCH_RELEASE: 'Soltó el partido',
  STAFF_CREATE: 'Alta de veedor', STAFF_ROTATE_TOKEN: 'Link nuevo de veedor', STAFF_REVOKE: 'Baja de veedor',
  DEMO_RESET_ALL: 'Demo reiniciada', DRAW_RESET: 'Sorteo reiniciado',
  PLAYER_CREATE: 'Plantel: jugador agregado', PLAYER_UPDATE: 'Plantel: número / nombre', PLAYER_DELETE: 'Plantel: jugador quitado',
  MATCH_LIVE: 'Estado: en juego', MATCH_HALFTIME: 'Estado: entretiempo', MATCH_FINISHED: 'Estado: terminado',
}
const actionLabel = (a) => {
  if (ACTIONS[a]) return ACTIONS[a]
  const ev = /^EVENT_(ADD|DELETE|PLAYER)_(\w+)$/.exec(a)
  if (ev) return `${{ ADD: 'Carga', DELETE: 'Borrado', PLAYER: 'Jugador' }[ev[1]]}: ${EVENT[ev[2]] || ev[2]}`
  if (a.startsWith('MATCH_STATUS')) return 'Estado'
  return a
}

function AuditTab({ token, model }) {
  const { t } = useI18n()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    controlCall(token, 'GET', '/audit?limit=200').then((r) => r.ok && setRows(r.data))
  }, [token, model.comp.data_version])
  if (!rows) return <p className="text-white/60">Cargando…</p>
  return (
    <ul className="card divide-y divide-white/5 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[64px_1fr] gap-2 px-3 py-2 sm:grid-cols-[64px_170px_140px_1fr]">
          <span className="text-white/50">{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="font-bold">{actionLabel(r.action)}</span>
          <span className="text-white/60">{r.match_code ? matchLabel(r.match_code, t) : ''}</span>
          <span className="truncate text-white/50">{r.staff_name || r.user_name || 'Mesa de control'}</span>
        </li>
      ))}
      {!rows.length && <li className="px-3 py-4 text-white/50">Todavía no hay movimientos.</li>}
    </ul>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-dvh pb-24">
      <DemoBanner />
      <div className="mx-auto max-w-6xl px-4 pt-5">{children}</div>
    </div>
  )
}
