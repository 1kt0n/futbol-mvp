import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Crest } from '../components/TeamBadge.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { DEMO_PREFIX, IS_DEMO } from '../lib/mode.js'
import { flag } from '../lib/model.js'
import { producerCall } from './drawApi.js'

// Panel interno de producción (lo usa una sola persona): textos en español.
const ERRORS = {
  INVALID_DRAW_TOKEN: 'Link de producción inválido o reemplazado. Generá uno nuevo con scripts/draw_link.py.',
  DRAW_NOT_LIVE: 'Primero tocá "Iniciar sorteo".',
  TEAM_ALREADY_DRAWN: 'Ese equipo ya salió.',
  TEAM_NOT_IN_TANDA: 'Ese equipo no es de la tanda que se está sorteando.',
  BALL_REQUIRED: 'Falta la bolilla: elegí la zona (o el casillero) que salió.',
  NO_VALID_GROUP: 'No hay ninguna zona que cumpla las reglas: ubicalo a mano.',
  SLOT_TAKEN: 'Ese lugar ya está ocupado.',
  INVALID_SLOT: 'Elegí zona y posición.',
  POT_EMPTY: 'No quedan equipos para sortear en este bombo.',
  NO_FREE_SLOT: 'No quedan lugares libres.',
  DRAW_INCOMPLETE: 'Faltan equipos por ubicar.',
  GROUP_STAGE_ALREADY_STARTED: IS_DEMO
    ? 'Ya empezó algún partido de la fase de grupos. En la demo usá "Reiniciar TODO (demo)".'
    : 'Ya empezó algún partido de la fase de grupos: el sorteo no se puede tocar.',
  DEMO_ONLY: 'Reiniciar TODO es solo para la demo.',
  DRAW_ALREADY_HAS_PICKS: 'La configuración se cambia antes del primer equipo (o después de reiniciar).',
  TANDAS_NOT_CONFIGURED: 'Faltan las tandas: tocá "Cargar procedimiento oficial".',
  NO_OFFICIAL_PROCEDURE: 'Este torneo no tiene procedimiento oficial cargado.',
  NOTHING_TO_UNDO: 'No hay nada para deshacer.',
  INVALID_YOUTUBE_URL: 'No reconozco ese link de YouTube. Pegá el link del vivo (youtube.com/live/… o youtu.be/…).',
  INVALID_START: 'Fecha u hora inválida.',
}
const WARNINGS = {
  MOVED_BY_COUNTRY_RULE: 'Se ubicó en otra zona por la regla de país.',
  SAME_COUNTRY_IN_GROUP: 'Ojo: queda en una zona con otro equipo del mismo país.',
  POT_POSITION_MISMATCH: 'Ojo: no es la posición de su bombo.',
  BALL_ALREADY_DRAWN: 'Ojo: esa bolilla ya había salido en esta tanda.',
  MANUAL_PLACEMENT: 'Ubicado a mano (sin reglas).',
  FOREIGN_LIMIT: 'Ojo: la zona queda con más extranjeros que el cupo.',
  SAME_CLUB: 'Ojo: queda en la zona de su equipo hermano.',
  GROUP_FULL: 'Ojo: zona completa.',
}
const errText = (d) => ERRORS[d] || (typeof d === 'string' ? d : 'No se pudo completar la acción.')
const jumpText = (j, teamById) =>
  j
    ? `Salto ${j.from} → ${j.to}: ${
        j.reason === 'FOREIGN_LIMIT' ? `la Zona ${j.from} ya tiene 2 extranjeros` : j.reason === 'SAME_CLUB' ? `en la Zona ${j.from} está ${teamById.get(j.partner_id)?.name ?? 'su equipo hermano'}` : `la Zona ${j.from} está completa`
      }`
    : ''

export default function ProducerPanel() {
  const { token } = useParams()
  const [state, setState] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [selected, setSelected] = useState(null) // equipo a revelar (o 'DIGITAL')
  const [ball, setBall] = useState('') // bolilla de zona ('C') o de casillero ('B3')
  const [slotLetter, setSlotLetter] = useState('') // teclado: primera mitad del casillero
  const [manualOn, setManualOn] = useState(false) // ubicación manual (sin reglas)
  const [manual, setManual] = useState({ group: '', position: '' })
  const [preview, setPreview] = useState(null)
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
    const id = setTimeout(() => setToast(null), 7000)
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

  const tandas = state?.mode === 'TANDAS'
  const tanda = state?.current_tanda
  const slotKind = tandas && tanda?.ball === 'SLOT'
  const teamById = useMemo(() => new Map((state?.teams || []).map((t) => [t.id, t])), [state])
  const placed = useMemo(() => new Set(Object.values(state?.slots || {}).flatMap((p) => Object.values(p)).filter(Boolean)), [state])
  const remaining = (state?.teams || []).filter((t) => !placed.has(t.id))
  const eligible = new Set(state?.eligible_team_ids || [])
  const q = query.trim().toLowerCase()
  const listed = tandas ? remaining.filter((t) => eligible.has(t.id)) : remaining
  const visibleTeams = listed.filter((t) => !q || t.name.toLowerCase().includes(q))

  const clearSelection = () => {
    setSelected(null)
    setBall('')
    setSlotLetter('')
    setManual({ group: '', position: '' })
    setManualOn(false)
    setPreview(null)
  }

  const pickBody = () => {
    const body = {}
    if (selected && selected !== 'DIGITAL') body.team_id = selected.id
    if (manualOn) {
      Object.assign(body, { group: manual.group, position: Number(manual.position), force: tandas })
    } else if (tandas && ball) {
      body.group = ball.slice(0, 1)
      if (ball.length > 1) body.position = Number(ball.slice(1))
    }
    return body
  }
  const ready =
    !!selected &&
    (selected === 'DIGITAL' ||
      (manualOn ? manual.group && manual.position : tandas ? Boolean(ball) : true))

  // Vista previa: qué va a pasar (zona, posición, salto) antes de revelar.
  useEffect(() => {
    setPreview(null)
    if (!ready || selected === 'DIGITAL' || !state || state.status !== 'LIVE') return
    let cancelled = false
    producerCall(token, 'POST', 'preview', pickBody()).then((res) => {
      if (cancelled) return
      setPreview(res.ok ? res.data.preview : { error: errText(res.data?.detail) })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ball, manualOn, manual.group, manual.position, state?.version])

  const reveal = async () => {
    if (!ready || preview?.error) return
    const out = await act('pick', pickBody())
    if (out?.pick) {
      const p = out.pick
      const team = out.state.teams.find((t) => t.id === p.team_id)
      const warns = (p.warnings || []).map((w) => WARNINGS[w] || w)
      const jump = jumpText(p.jump, new Map(out.state.teams.map((t) => [t.id, t])))
      setToast({ kind: warns.length || jump ? 'warn' : 'ok', text: `Revelado: ${team?.name}${p.ball ? ` · bolilla ${p.ball}` : ''} → Zona ${p.group} · Posición ${p.position}. ${jump} ${warns.join(' ')}` })
      clearSelection()
      setQuery('')
      search.current?.focus()
    }
  }

  // Teclado: Enter elige / revela; A–G = bolilla (en la última tanda: letra + número); Esc cancela.
  // El Enter que elige y el que revela tienen que ser dos pulsaciones distintas (selectedAt).
  const selectedAt = useRef(0)
  useEffect(() => {
    selectedAt.current = Date.now()
  }, [selected, ball])
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      if (e.key === 'Escape') return clearSelection()
      if (!selected || typing || state?.status !== 'LIVE') return
      if (tandas && !manualOn && /^[a-z]$/i.test(e.key)) {
        const L = e.key.toUpperCase()
        if (!state.groups.includes(L)) return
        e.preventDefault()
        if (slotKind) setSlotLetter(L)
        else setBall(L)
        return
      }
      if (tandas && slotKind && slotLetter && /^[1-8]$/.test(e.key)) {
        e.preventDefault()
        setBall(`${slotLetter}${e.key}`)
        setSlotLetter('')
        return
      }
      if (e.key === 'Backspace') {
        setBall('')
        setSlotLetter('')
        return
      }
      if (e.key === 'Enter' && !busy && !e.repeat && Date.now() - selectedAt.current > 250) {
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
  const base = `${window.location.origin}${IS_DEMO ? DEMO_PREFIX : ''}`
  const target = manualOn
    ? manual.group && manual.position ? `Zona ${manual.group} · Posición ${manual.position} (a mano)` : 'Elegí zona y posición'
    : preview && !preview.error
      ? `Zona ${preview.group} · Posición ${preview.position}`
      : !tandas && state.next_slot
        ? `Zona ${state.next_slot.group} · Posición ${state.next_slot.position}`
        : '—'

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
        <nav className="ml-auto flex flex-wrap gap-2 text-sm font-extrabold">
          <a href={`${base}/obs/tablero`} target="_blank" rel="noreferrer" className="focus-ring rounded-full bg-white px-4 py-2 text-night">Tablero ↗</a>
          <a href={`${base}/obs`} target="_blank" rel="noreferrer" className="focus-ring rounded-full bg-white/10 px-4 py-2 ring-1 ring-white/20">Escenas OBS ↗</a>
          <a href={`${base}/sorteo`} target="_blank" rel="noreferrer" className="focus-ring rounded-full bg-white/10 px-4 py-2 ring-1 ring-white/20">Página pública ↗</a>
        </nav>
      </header>

      {toast && (
        <div role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold ${toast.kind === 'error' ? 'bg-live/25 text-[#ffc2cf]' : toast.kind === 'warn' ? 'bg-gold/20 text-gold-light' : 'bg-[#008026]/30 text-[#b6f5c8]'}`}>
          {toast.text}
        </div>
      )}

      <Broadcast state={state} act={act} busy={busy} setToast={setToast} />

      {state.status === 'IDLE' && <Setup state={state} act={act} busy={busy} arm={arm} setArm={setArm} setToast={setToast} teamById={teamById} />}

      {(live || state.status === 'DONE') && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <section>
            {live && (
              <>
                {tandas ? (
                  <div className="card mb-4 p-4">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="board-num text-4xl text-gold">{tanda ? `Tanda ${tanda.n}` : 'Completo'}</span>
                      {tanda && <span className="text-xl font-extrabold">{tanda.label}</span>}
                      {tanda && <span className="text-sm text-white/60">quedan {listed.length} equipos · {slotKind ? 'bolillas de casilleros' : 'bolillas de zona'}</span>}
                    </div>
                    {tanda && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(slotKind ? state.balls_left : state.groups).map((b) => {
                          const used = !slotKind && !state.balls_left.includes(b)
                          return (
                            <button
                              key={b}
                              type="button"
                              disabled={!selected || selected === 'DIGITAL' || manualOn}
                              onClick={() => setBall(b)}
                              title={used ? 'Ya salió en esta tanda' : ''}
                              className={`draw-ball focus-ring h-12 ${slotKind ? 'w-14 text-lg' : 'w-12 text-2xl'} ${used ? 'is-used' : ''} ${ball === b ? 'ring-4 ring-white' : ''} disabled:cursor-not-allowed`}
                            >
                              {b}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="card mb-4 flex flex-wrap items-center gap-4 p-4">
                    <div>
                      <div className="kicker">Próximo lugar</div>
                      <div className="board-num text-4xl text-gold">{state.next_slot ? `Zona ${state.next_slot.group} · Pos ${state.next_slot.position}` : 'Completo'}</div>
                    </div>
                  </div>
                )}

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
                        // (un error de tipeo saldría al aire). Revelar siempre pide otra tecla.
                        e.stopPropagation()
                        e.nativeEvent.stopImmediatePropagation()
                        const first = visibleTeams.find((t) => eligible.has(t.id))
                        if (first) {
                          setSelected(first)
                          e.currentTarget.blur() // las letras que siguen son la bolilla
                        }
                      }
                    }}
                    placeholder={tandas ? 'Equipo que salió + Enter, después la letra de la bolilla…' : 'Escribí el equipo que salió y Enter…'}
                    className="focus-ring flex-1 rounded-xl bg-white/10 px-4 py-3 text-lg font-semibold placeholder:text-white/40"
                  />
                  <button type="button" disabled={busy || !remaining.length} onClick={() => { clearSelection(); setSelected('DIGITAL') }} className="focus-ring rounded-xl bg-white/10 px-4 font-extrabold ring-1 ring-white/20 disabled:opacity-40">
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
                        onClick={() => { setSelected(t); setPreview(null) }}
                        className={`focus-ring flex items-center gap-2 rounded-xl p-2.5 text-left ring-1 transition ${selected?.id === t.id ? 'bg-gold text-night ring-gold' : 'bg-white/5 ring-white/10 hover:bg-white/10'} disabled:opacity-30`}
                      >
                        <Crest team={t} size="md" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{t.name} {t.foreign && flag(t.country_code)}</span>
                          {t.pot && <span className="text-[10px] font-bold uppercase opacity-70">{tandas ? 'Tanda' : 'Bombo'} {t.pot}</span>}
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
                      {p.jump && <span className="block text-[11px] text-[#ffb3c4]">↷ {jumpText(p.jump, teamById)}</span>}
                      {p.warnings?.length > 0 && <span className="block text-[11px] text-gold-light">{p.warnings.map((w) => WARNINGS[w] || w).join(' ')}</span>}
                    </span>
                    {p.ball && p.ball !== `${p.group}${p.position}` && <span className="text-xs text-white/50" title="Bolilla">({p.ball})</span>}
                    <span className="board-num text-xl text-gold">{p.group}{p.position}</span>
                    {p.digital && <span title="Sorteo digital">🎲</span>}
                  </li>
                )
              })}
              {!state.picks.length && <li className="px-3 py-4 text-sm text-white/50">Todavía no salió ningún equipo.</li>}
            </ol>
            <Danger arm={arm} setArm={setArm} act={act} busy={busy} setToast={setToast} />
          </aside>
        </div>
      )}

      {/* Confirmación de revelado */}
      {selected && live && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/40 bg-indigo-800/95 p-4 backdrop-blur" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
            {selected === 'DIGITAL' ? <span className="text-3xl">🎲</span> : <Crest team={selected} size="lg" />}
            <div className="min-w-0 flex-1">
              <div className="kicker">{selected === 'DIGITAL' ? 'Sorteo digital' : 'Salió'}</div>
              <div className="truncate text-xl font-extrabold">
                {selected === 'DIGITAL' ? (tandas ? 'Equipo y bolilla al azar' : 'Un equipo al azar') : selected.name}
                {selected !== 'DIGITAL' && tandas && !manualOn && (
                  <span className="ml-3 text-white/70">
                    · bolilla{' '}
                    {ball ? <span className="draw-ball mx-1 h-8 w-auto min-w-8 px-1.5 align-middle text-lg">{ball}</span> : <span className="text-gold">{slotKind ? `${slotLetter || '?'}? (letra + número)` : '? (tecla A–G)'}</span>}
                  </span>
                )}
                {selected !== 'DIGITAL' && <span className="text-white/70"> → </span>}
                {selected !== 'DIGITAL' && <span className="text-gold">{target}</span>}
              </div>
              {preview?.jump && <div className="mt-1 text-sm font-extrabold text-[#ffb3c4]">↷ {jumpText(preview.jump, teamById)}</div>}
              {preview?.warnings?.length > 0 && <div className="mt-1 text-sm font-bold text-gold-light">{preview.warnings.map((w) => WARNINGS[w] || w).join(' ')}</div>}
              {preview?.error && <div className="mt-1 text-sm font-bold text-[#ffc2cf]">{preview.error}</div>}
              {selected !== 'DIGITAL' && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 text-white/60">
                    <input type="checkbox" checked={manualOn} onChange={(e) => setManualOn(e.target.checked)} /> Ubicar a mano{tandas ? ' (sin reglas)' : ''}
                  </label>
                  {manualOn && (
                    <>
                      <select className="rounded-lg bg-white/10 px-2 py-1 [&>option]:bg-indigo-800" value={manual.group} onChange={(e) => setManual((m) => ({ ...m, group: e.target.value }))}>
                        <option value="">Zona</option>
                        {state.groups.map((g) => <option key={g} value={g}>Zona {g}</option>)}
                      </select>
                      <select className="rounded-lg bg-white/10 px-2 py-1 [&>option]:bg-indigo-800" value={manual.position} onChange={(e) => setManual((m) => ({ ...m, position: e.target.value }))}>
                        <option value="">Pos</option>
                        {Array.from({ length: state.group_size }, (_, i) => i + 1).map((p) => <option key={p} value={p}>Pos {p}</option>)}
                      </select>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={clearSelection} className="focus-ring rounded-xl px-4 py-3 font-bold ring-1 ring-white/30">Cancelar (Esc)</button>
              <button type="button" disabled={busy || !ready || Boolean(preview?.error)} onClick={reveal} className="focus-ring rounded-xl bg-gold px-6 py-3 text-lg font-extrabold text-night disabled:opacity-40">
                Revelar (Enter)
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ------------------------------------------------------------------ transmisión

/** "2026-10-06T22:15:00-03:00" ↔ "2026-10-06T22:15" (hora de Argentina, −03:00). */
const toArgInput = (iso) => {
  const ms = Date.parse(iso || '')
  if (!ms) return ''
  return new Date(ms - 3 * 3600_000).toISOString().slice(0, 16)
}

function Broadcast({ state, act, busy, setToast }) {
  const b = state.broadcast || {}
  const [open, setOpen] = useState(!b.youtube_id)
  const [url, setUrl] = useState(b.youtube_url || '')
  const [start, setStart] = useState(toArgInput(b.starts_at))
  const [delay, setDelay] = useState(b.spoiler_delay_s ?? 10)
  const save = async () => {
    const out = await act('broadcast', { youtube_url: url, starts_at: start ? `${start}:00-03:00` : null, spoiler_delay_s: Number(delay) || 0 })
    if (out) {
      setToast({ kind: 'ok', text: 'Transmisión guardada: la página pública ya la muestra.' })
      setUrl(out.state.broadcast.youtube_url || '')
    }
  }
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="card mb-5 p-4">
      <summary className="cursor-pointer select-none font-extrabold">
        📺 Transmisión ·{' '}
        <span className="font-semibold text-white/60">
          {b.youtube_id ? `YouTube ✓ (${b.youtube_id})` : 'sin link de YouTube'} · empieza {b.starts_at ? `${toArgInput(b.starts_at).replace('T', ' ')} (ARG)` : '—'}
        </span>
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto_auto] md:items-end">
        <label className="text-sm">
          <span className="kicker mb-1 block">Link del vivo de YouTube</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/live/…" className="focus-ring w-full rounded-lg bg-white/10 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="kicker mb-1 block">Empieza (hora ARG)</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="focus-ring w-full rounded-lg bg-white/10 px-3 py-2 [color-scheme:dark]" />
        </label>
        <label className="text-sm">
          <span className="kicker mb-1 block">Demora del tablero (s)</span>
          <input type="number" min="0" max="120" value={delay} onChange={(e) => setDelay(e.target.value)} className="focus-ring w-24 rounded-lg bg-white/10 px-3 py-2" />
        </label>
        <button type="button" disabled={busy} onClick={save} className="focus-ring rounded-xl bg-gold px-5 py-2.5 font-extrabold text-night">Guardar</button>
      </div>
      <p className="mt-3 text-xs text-white/55">
        El video se ve embebido en la pestaña <b>Sorteo</b> del sitio{IS_DEMO ? ' de la DEMO (solo quien tenga el link /demo)' : ''}. Para ensayar en secreto, creá el vivo en YouTube como <b>No listado</b> y
        con <b>insertar permitido</b>. La demora hace que el tablero de la página no se adelante a la transmisión (YouTube va ~5–15 s atrás). Dejá el link vacío para sacar el video.
      </p>
    </details>
  )
}

// ------------------------------------------------------------------ configuración

function Setup({ state, act, busy, arm, setArm, setToast, teamById }) {
  const [mode, setMode] = useState(state.mode)
  const [countryRule, setCountryRule] = useState(Boolean(state.rules?.separate_country))
  const [pots, setPots] = useState(() => Object.fromEntries(state.teams.filter((t) => t.pot).map((t) => [t.id, t.pot])))
  useEffect(() => {
    setMode(state.mode)
    setPots(Object.fromEntries(state.teams.filter((t) => t.pot).map((t) => [t.id, t.pot])))
  }, [state.mode, state.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const potCount = Object.keys(pots).length
  const tandaNumbers = (state.tandas || []).map((t) => t.n)
  const placedCount = state.placed

  const save = () => (mode === 'TANDAS' ? act('config', { mode, pots }) : act('config', { mode, rules: { separate_country: countryRule }, pots }))
  const preset = async () => {
    const out = await act('preset')
    if (!out) return
    const problems = out.problems || []
    setToast(
      problems.length
        ? { kind: 'warn', text: `Procedimiento cargado con avisos: ${problems.map((p) => (p.code === 'PAIR_NOT_FOUND' ? `no encuentro la pareja ${p.pair.join(' / ')}` : p.code === 'TANDA_COUNT' ? `la tanda ${p.tanda} tiene ${p.got} equipos (el reglamento dice ${p.expected})` : `equipos sin tanda: ${(p.teams || []).join(', ')}`)).join(' · ')}` }
        : { kind: 'ok', text: 'Procedimiento oficial cargado: 5 tandas, máx. 2 extranjeros por zona y 3 parejas separadas.' },
    )
  }
  const pairs = (state.rules?.pairs || []).map(([a, b]) => `${teamById.get(a)?.name ?? '?'} / ${teamById.get(b)?.name ?? '?'}`)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="card p-5">
        {placedCount > 0 && (
          <div className="mb-5 rounded-xl bg-gold/15 p-4 text-sm font-bold text-gold-light">
            Ya hay {placedCount} equipos ubicados (de un sorteo anterior o cargados a mano). Para sortear desde cero, reiniciá el sorteo (abajo a la derecha).
          </div>
        )}
        {!state.teams.length && (
          <div className="mb-5 rounded-xl bg-live/20 p-4 text-sm font-bold text-[#ffc2cf]">
            Todavía no hay equipos cargados en este torneo: corré <code>scripts/equipos_oficiales.py</code>.
          </div>
        )}
        <h2 className="mb-3 text-lg font-extrabold">Configuración</h2>
        <fieldset className="mb-4">
          <legend className="kicker mb-2">Procedimiento</legend>
          {[
            ['TANDAS', 'Oficial por tandas (reglamento): doble bombo, cupo de extranjeros, parejas y regla de salto'],
            ['ROUND_ROBIN', 'Genérico, un bolillero: A1, B1 … G1, después A2…'],
            ['BY_GROUP', 'Genérico, zona por zona: A1–A4, después B…'],
          ].map(([v, label]) => (
            <label key={v} className="mb-1 flex items-center gap-2 text-sm">
              <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} /> {label}
            </label>
          ))}
        </fieldset>

        {mode === 'TANDAS' ? (
          <>
            {state.has_official_procedure && (
              <button type="button" disabled={busy} onClick={preset} className="focus-ring mb-4 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-extrabold ring-1 ring-white/20">
                ⚙️ Cargar procedimiento oficial (arma las tandas solo)
              </button>
            )}
            {state.rules?.max_foreign ? (
              <ul className="mb-4 space-y-1 text-sm text-white/75">
                <li>🌎 Máximo <b>{state.rules.max_foreign}</b> extranjeros por zona (local: {state.rules.home_country}).</li>
                {pairs.length > 0 && <li>🤝 Parejas separadas: {pairs.join(' · ')}</li>}
                <li>↷ Regla de salto: zona siguiente A → B … G → A.</li>
              </ul>
            ) : null}
            {state.tandas?.length ? (
              <div className="mb-5 space-y-2">
                {state.tandas.map((td) => (
                  <div key={td.n} className="rounded-xl bg-white/5 p-3">
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="board-num text-2xl text-gold">Tanda {td.n}</span>
                      <span className="font-extrabold">{td.label}</span>
                      <span className="text-xs text-white/55">· {Object.values(pots).filter((v) => v === td.n).length} equipos · {td.ball === 'SLOT' ? 'bolillas de casilleros' : 'bolillas de zona'}</span>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {state.teams.filter((t) => pots[t.id] === td.n).map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm">
                          <select className="rounded bg-white/10 px-1 py-0.5 [&>option]:bg-indigo-800" value={pots[t.id] || ''} onChange={(e) => setPots((p) => ({ ...p, [t.id]: Number(e.target.value) }))}>
                            {tandaNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <Crest team={t} size="xs" />
                          <span className="truncate">{t.name} {t.foreign && flag(t.country_code)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {state.teams.some((t) => !pots[t.id]) && (
                  <p className="text-sm font-bold text-gold-light">Sin tanda: {state.teams.filter((t) => !pots[t.id]).map((t) => t.name).join(', ')}</p>
                )}
              </div>
            ) : (
              <p className="mb-5 text-sm text-white/60">Todavía no hay tandas: tocá “Cargar procedimiento oficial”.</p>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="focus-ring rounded-xl bg-white/10 px-4 py-3 font-bold ring-1 ring-white/20">Guardar configuración</button>
          <button type="button" disabled={busy || !state.teams.length || placedCount === state.teams.length} onClick={async () => { if (await save()) await act('start') }} className="focus-ring rounded-xl bg-gold px-6 py-3 text-lg font-extrabold text-night disabled:opacity-40">
            Iniciar sorteo
          </button>
        </div>
      </section>
      <aside>
        <p className="card mb-3 p-4 text-sm text-white/70">
          Al iniciar, las pantallas pasan a <b>EN VIVO</b>. En cada tanda: escribí el equipo + Enter, apretá la letra de la bolilla (en la última tanda, letra + número del casillero), mirá la vista previa (avisa si hay salto) y Enter para revelar.
        </p>
        <Danger arm={arm} setArm={setArm} act={act} busy={busy} setToast={setToast} />
      </aside>
    </div>
  )
}

function Danger({ arm, setArm, act, busy, setToast }) {
  // Solo la demo: además del sorteo, resultados, goles, tarjetas, cierre de zonas y quién tomó
  // cada partido (el server lo rechaza en el torneo real).
  const resetAll = async () => {
    const out = await act('reset_all')
    if (out) setToast({ kind: 'ok', text: 'Listo: todo en cero. Equipos, planteles y veedores intactos; el sorteo está listo para empezar.' })
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-live/30 p-3">
      <button type="button" disabled={busy} onClick={() => (arm === 'reset' ? act('reset') : setArm('reset'))} className={`focus-ring w-full rounded-lg px-3 py-2 text-sm font-extrabold ${arm === 'reset' ? 'bg-live text-white' : 'text-[#ff9db3]'}`}>
        {arm === 'reset' ? 'Tocá de nuevo: se vacían TODAS las zonas' : 'Reiniciar sorteo'}
      </button>
      {IS_DEMO && (
        <button type="button" disabled={busy} onClick={() => (arm === 'reset_all' ? resetAll() : setArm('reset_all'))} className={`focus-ring w-full rounded-lg px-3 py-2 text-sm font-extrabold ${arm === 'reset_all' ? 'bg-live text-white' : 'text-[#ff9db3] ring-1 ring-live/40'}`}>
          {arm === 'reset_all' ? 'Tocá de nuevo: se borran resultados, goles, tarjetas, cierre de zonas, veedores de cada partido y el sorteo' : 'Reiniciar TODO (demo)'}
        </button>
      )}
    </div>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-dvh pb-40">
      <DemoBanner />
      <div className="mx-auto max-w-6xl px-4 pt-5">{children}</div>
    </div>
  )
}
