import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Crest } from '../components/TeamBadge.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { DEMO_PREFIX, IS_DEMO } from '../lib/mode.js'
import { producerCall } from './drawApi.js'

// Panel interno de producción (lo usa una sola persona): textos en español.
const ERRORS = {
  INVALID_DRAW_TOKEN: 'Link de producción inválido o reemplazado. Generá uno nuevo con scripts/draw_link.py.',
  DRAW_NOT_LIVE: 'Primero tocá "Iniciar sorteo".',
  TEAM_ALREADY_DRAWN: 'Ese equipo ya salió.',
  SLOT_TAKEN: 'Ese lugar ya está ocupado.',
  INVALID_SLOT: 'Elegí zona y posición, o dejá las dos en automático.',
  POT_EMPTY: 'No quedan equipos para sortear en este bombo.',
  NO_FREE_SLOT: 'No quedan lugares libres.',
  DRAW_INCOMPLETE: 'Faltan equipos por ubicar.',
  GROUP_STAGE_ALREADY_STARTED: 'Ya empezó algún partido de la fase de grupos: el sorteo no se puede tocar.',
  DRAW_ALREADY_HAS_PICKS: 'La configuración se cambia antes del primer equipo (o después de reiniciar).',
  NOTHING_TO_UNDO: 'No hay nada para deshacer.',
}
const WARNINGS = {
  MOVED_BY_COUNTRY_RULE: 'Se ubicó en otra zona por la regla de país.',
  SAME_COUNTRY_IN_GROUP: 'Ojo: queda en una zona con otro equipo del mismo país.',
  POT_POSITION_MISMATCH: 'Ojo: no es la posición de su bombo.',
}
const errText = (d) => ERRORS[d] || (typeof d === 'string' ? d : 'No se pudo completar la acción.')

export default function ProducerPanel() {
  const { token } = useParams()
  const [state, setState] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [selected, setSelected] = useState(null) // equipo a revelar (o 'DIGITAL')
  const [manual, setManual] = useState({ group: '', position: '' })
  const [query, setQuery] = useState('')
  const [arm, setArm] = useState(null) // acción peligrosa armada: 'undo' | 'reset'
  const search = useRef(null)

  const load = useCallback(async () => {
    const res = await producerCall(token, 'GET', '').catch(() => null)
    if (!res) return
    if (res.status === 401) return setFatal(ERRORS.INVALID_DRAW_TOKEN)
    if (res.ok) setState(res.data)
  }, [token])

  useEffect(() => {
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  const act = async (action, body) => {
    setBusy(true)
    const res = await producerCall(token, 'POST', action, body || {}).catch(() => ({ ok: false, data: { detail: 'Sin conexión' } }))
    setBusy(false)
    setArm(null)
    if (!res.ok) {
      setToast({ kind: 'error', text: errText(res.data?.detail) })
      return null
    }
    setState(res.data.state)
    return res.data
  }

  const teamById = useMemo(() => new Map((state?.teams || []).map((t) => [t.id, t])), [state])
  const placed = useMemo(() => new Set(Object.values(state?.slots || {}).flatMap((p) => Object.values(p)).filter(Boolean)), [state])
  const remaining = (state?.teams || []).filter((t) => !placed.has(t.id))
  const eligible = new Set(state?.eligible_team_ids || [])
  const q = query.trim().toLowerCase()
  const visibleTeams = remaining.filter((t) => !q || t.name.toLowerCase().includes(q))
  const target = manual.group && manual.position ? `Zona ${manual.group} · Posición ${manual.position}` : state?.next_slot ? `Zona ${state.next_slot.group} · Posición ${state.next_slot.position}` : '—'

  const reveal = async () => {
    const body = {}
    if (selected !== 'DIGITAL') body.team_id = selected.id
    if (manual.group && manual.position) Object.assign(body, { group: manual.group, position: Number(manual.position) })
    const out = await act('pick', body)
    if (out?.pick) {
      const team = teamById.get(out.pick.team_id) || out.state.teams.find((t) => t.id === out.pick.team_id)
      const warns = (out.pick.warnings || []).map((w) => WARNINGS[w] || w)
      setToast({ kind: warns.length ? 'warn' : 'ok', text: `Revelado: ${team?.name} → Zona ${out.pick.group} · Posición ${out.pick.position}. ${warns.join(' ')}` })
      setSelected(null)
      setManual({ group: '', position: '' })
      setQuery('')
      search.current?.focus()
    }
  }

  // Teclado: Enter confirma / elige el primero de la búsqueda; Esc cancela.
  // El Enter que elige y el que revela tienen que ser dos pulsaciones distintas (selectedAt).
  const selectedAt = useRef(0)
  useEffect(() => {
    selectedAt.current = Date.now()
  }, [selected])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelected(null)
      if (e.key === 'Enter' && selected && !busy && !e.repeat && Date.now() - selectedAt.current > 250) {
        e.preventDefault()
        reveal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (fatal) return <Shell><p className="card mt-10 p-6 text-center font-bold">{fatal}</p></Shell>
  if (!state) return <Shell><p className="mt-16 text-center text-white/60">Cargando…</p></Shell>

  const total = state.teams.length
  const live = state.status === 'LIVE'
  const stageUrl = `${window.location.origin}${IS_DEMO ? DEMO_PREFIX : ''}/sorteo?tv=1`

  return (
    <Shell>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="kicker">Producción · {state.competition.name}</div>
          <h1 className="text-2xl font-extrabold">Sorteo de zonas</h1>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${live ? 'bg-live/20 text-[#ff8aa5]' : state.status === 'DONE' ? 'bg-gold/20 text-gold' : 'bg-white/10 text-white/70'}`}>
          {live ? '● En vivo' : state.status === 'DONE' ? 'Terminado' : 'Sin empezar'}
        </span>
        <span className="board-num text-4xl text-gold">{state.placed}<span className="text-white/30">/{total}</span></span>
        <a href={stageUrl} target="_blank" rel="noreferrer" className="focus-ring ml-auto rounded-full bg-white px-4 py-2 text-sm font-extrabold text-night">
          Abrir pantalla de transmisión ↗
        </a>
      </header>

      {toast && (
        <div role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold ${toast.kind === 'error' ? 'bg-live/25 text-[#ffc2cf]' : toast.kind === 'warn' ? 'bg-gold/20 text-gold-light' : 'bg-[#008026]/30 text-[#b6f5c8]'}`}>
          {toast.text}
        </div>
      )}

      {state.status === 'IDLE' && <Setup state={state} act={act} busy={busy} placedCount={state.placed} arm={arm} setArm={setArm} />}

      {(live || state.status === 'DONE') && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <section>
            {live && (
              <>
                <div className="card mb-4 flex flex-wrap items-center gap-4 p-4">
                  <div>
                    <div className="kicker">Próximo lugar</div>
                    <div className="board-num text-4xl text-gold">{state.next_slot ? `Zona ${state.next_slot.group} · Pos ${state.next_slot.position}` : 'Completo'}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-white/60">Lugar a mano:</span>
                    <select className="rounded-lg bg-white/10 px-2 py-1.5 [&>option]:bg-indigo-800" value={manual.group} onChange={(e) => setManual((m) => ({ ...m, group: e.target.value }))}>
                      <option value="">Zona auto</option>
                      {state.groups.map((g) => <option key={g} value={g}>Zona {g}</option>)}
                    </select>
                    <select className="rounded-lg bg-white/10 px-2 py-1.5 [&>option]:bg-indigo-800" value={manual.position} onChange={(e) => setManual((m) => ({ ...m, position: e.target.value }))}>
                      <option value="">Pos auto</option>
                      {Array.from({ length: state.group_size }, (_, i) => i + 1).map((p) => <option key={p} value={p}>Pos {p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mb-3 flex gap-2">
                  <input
                    ref={search}
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !selected) {
                        e.preventDefault()
                        // Que este Enter solo ELIJA: si llegara al atajo global también revelaría
                        // (un error de tipeo saldría al aire). Revelar siempre pide un segundo Enter.
                        e.stopPropagation()
                        e.nativeEvent.stopImmediatePropagation()
                        const first = visibleTeams.find((t) => eligible.has(t.id))
                        if (first) setSelected(first)
                      }
                    }}
                    placeholder="Escribí el equipo que salió y Enter…"
                    className="focus-ring flex-1 rounded-xl bg-white/10 px-4 py-3 text-lg font-semibold placeholder:text-white/40"
                  />
                  <button type="button" disabled={busy || !remaining.length} onClick={() => setSelected('DIGITAL')} className="focus-ring rounded-xl bg-white/10 px-4 font-extrabold ring-1 ring-white/20 disabled:opacity-40">
                    🎲 Sorteo digital
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {visibleTeams.map((t) => {
                    const can = eligible.has(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!can || busy}
                        onClick={() => setSelected(t)}
                        className={`focus-ring flex items-center gap-2 rounded-xl p-2.5 text-left ring-1 transition ${selected?.id === t.id ? 'bg-gold text-night ring-gold' : 'bg-white/5 ring-white/10 hover:bg-white/10'} disabled:opacity-30`}
                      >
                        <Crest team={t} size="md" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{t.name}</span>
                          {t.pot && <span className="text-[10px] font-bold uppercase opacity-70">Bombo {t.pot}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {!remaining.length && <p className="card p-4 text-center font-bold">Están todos los equipos ubicados.</p>}
              </>
            )}
            {state.placed === total && live && (
              <button type="button" disabled={busy} onClick={() => act('finish')} className="focus-ring mt-4 w-full rounded-xl bg-gold py-4 text-lg font-extrabold text-night">
                Finalizar sorteo ✓
              </button>
            )}
            {state.status === 'DONE' && <p className="card p-5 text-center text-lg font-extrabold text-gold">Sorteo terminado. El fixture del sábado ya está completo.</p>}
          </section>

          <aside>
            <div className="mb-2 flex items-center justify-between">
              <span className="kicker">Salieron ({state.picks.length})</span>
              {live && state.picks.length > 0 && (
                <button type="button" disabled={busy} onClick={() => (arm === 'undo' ? act('undo') : setArm('undo'))} className={`focus-ring rounded-lg px-3 py-1 text-xs font-extrabold ${arm === 'undo' ? 'bg-live text-white' : 'bg-white/10'}`}>
                  {arm === 'undo' ? 'Tocá de nuevo para deshacer' : 'Deshacer último'}
                </button>
              )}
            </div>
            <ol className="card max-h-[60vh] divide-y divide-white/5 overflow-y-auto">
              {[...state.picks].reverse().map((p) => {
                const t = teamById.get(p.team_id)
                return (
                  <li key={p.seq} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="board-num w-6 text-white/40">{p.seq}</span>
                    <Crest team={t} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{t?.name}</span>
                      {p.warnings?.length > 0 && <span className="block text-[11px] text-gold-light">{p.warnings.map((w) => WARNINGS[w] || w).join(' ')}</span>}
                    </span>
                    <span className="board-num text-xl text-gold">{p.group}{p.position}</span>
                    {p.digital && <span title="Sorteo digital">🎲</span>}
                  </li>
                )
              })}
              {!state.picks.length && <li className="px-3 py-4 text-sm text-white/50">Todavía no salió ningún equipo.</li>}
            </ol>
            <Danger arm={arm} setArm={setArm} act={act} busy={busy} />
          </aside>
        </div>
      )}

      {/* Confirmación de revelado */}
      {selected && live && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/40 bg-indigo-800/95 p-4 backdrop-blur" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4">
            {selected === 'DIGITAL' ? <span className="text-3xl">🎲</span> : <Crest team={selected} size="lg" />}
            <div className="min-w-0">
              <div className="kicker">{selected === 'DIGITAL' ? 'Sorteo digital' : 'Salió'}</div>
              <div className="truncate text-xl font-extrabold">{selected === 'DIGITAL' ? 'Un equipo al azar' : selected.name} → {target}</div>
            </div>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setSelected(null)} className="focus-ring rounded-xl px-4 py-3 font-bold ring-1 ring-white/30">Cancelar (Esc)</button>
              <button type="button" disabled={busy} onClick={reveal} className="focus-ring rounded-xl bg-gold px-6 py-3 text-lg font-extrabold text-night disabled:opacity-50">
                Revelar (Enter)
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Setup({ state, act, busy, placedCount, arm, setArm }) {
  const [mode, setMode] = useState(state.mode)
  const [countryRule, setCountryRule] = useState(Boolean(state.rules?.separate_country))
  const [pots, setPots] = useState(() => Object.fromEntries(state.teams.filter((t) => t.pot).map((t) => [t.id, t.pot])))
  const potCount = Object.keys(pots).length

  const save = () => act('config', { mode, rules: { separate_country: countryRule }, pots })
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="card p-5">
        {placedCount > 0 && (
          <div className="mb-5 rounded-xl bg-gold/15 p-4 text-sm font-bold text-gold-light">
            Ya hay {placedCount} equipos ubicados (de un sorteo anterior o cargados a mano). Para sortear desde cero, reiniciá el sorteo (abajo a la derecha).
          </div>
        )}
        <h2 className="mb-3 text-lg font-extrabold">Configuración</h2>
        <fieldset className="mb-4">
          <legend className="kicker mb-2">Orden de llenado</legend>
          {[
            ['ROUND_ROBIN', 'Ronda: A1, B1 … G1, después A2… (recomendado)'],
            ['BY_GROUP', 'Zona por zona: A1–A4, después B…'],
          ].map(([v, label]) => (
            <label key={v} className="mb-1 flex items-center gap-2 text-sm">
              <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /> {label}
            </label>
          ))}
        </fieldset>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={countryRule} onChange={(e) => setCountryRule(e.target.checked)} />
          Separar equipos del mismo país (si no hay zona posible, avisa y vos decidís)
        </label>
        <details className="mb-5 rounded-xl bg-white/5 p-3">
          <summary className="cursor-pointer text-sm font-bold">Bombos (opcional) · {potCount ? `${potCount} equipos asignados` : 'un solo bolillero'}</summary>
          <p className="my-2 text-xs text-white/60">Bombo N → posición N de cada zona. Sin bombo = puede salir en cualquier momento.</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {state.teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <select className="rounded bg-white/10 px-1 py-0.5 [&>option]:bg-indigo-800" value={pots[t.id] || ''} onChange={(e) => setPots((p) => { const n = { ...p }; if (e.target.value) n[t.id] = Number(e.target.value); else delete n[t.id]; return n })}>
                  <option value="">—</option>
                  {Array.from({ length: state.group_size }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="focus-ring rounded-xl bg-white/10 px-4 py-3 font-bold ring-1 ring-white/20">Guardar configuración</button>
          <button type="button" disabled={busy || placedCount === state.teams.length} onClick={async () => { if (await save()) await act('start') }} className="focus-ring rounded-xl bg-gold px-6 py-3 text-lg font-extrabold text-night disabled:opacity-40">
            Iniciar sorteo
          </button>
        </div>
      </section>
      <aside>
        <p className="card mb-3 p-4 text-sm text-white/70">
          Al iniciar, la pantalla de transmisión pasa a <b>EN VIVO</b>. Cada equipo que confirmes se revela ahí en ~4 segundos.
        </p>
        <Danger arm={arm} setArm={setArm} act={act} busy={busy} />
      </aside>
    </div>
  )
}

function Danger({ arm, setArm, act, busy }) {
  return (
    <div className="mt-4 rounded-xl border border-live/30 p-3">
      <button type="button" disabled={busy} onClick={() => (arm === 'reset' ? act('reset') : setArm('reset'))} className={`focus-ring w-full rounded-lg px-3 py-2 text-sm font-extrabold ${arm === 'reset' ? 'bg-live text-white' : 'text-[#ff9db3]'}`}>
        {arm === 'reset' ? 'Tocá de nuevo: se vacían TODAS las zonas' : 'Reiniciar sorteo'}
      </button>
    </div>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-dvh pb-32">
      <DemoBanner />
      <div className="mx-auto max-w-6xl px-4 pt-5">{children}</div>
    </div>
  )
}
