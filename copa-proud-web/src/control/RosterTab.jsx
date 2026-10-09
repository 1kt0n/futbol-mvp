import { useEffect, useMemo, useRef, useState } from 'react'
import { Crest } from '../components/TeamBadge.jsx'

/*
 * Mesa de control → PLANTELES (lista de buena fe). En la acreditación se carga el número de
 * camiseta de cada jugador (la planilla de inscripción no lo trae), se corrige el nombre y se
 * agrega / quita a quien corresponda. Cada número se guarda solo al salir del campo o con Enter
 * (Enter salta al siguiente jugador). Los veedores ven los números en su app al instante.
 */

const byName = (a, b) => a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' })
const numbered = (t) => (t.players || []).filter((p) => p.shirt_number != null).length

export default function RosterTab({ model, act, busy }) {
  const teams = useMemo(() => [...model.teams].sort((a, b) => a.name.localeCompare(b.name, 'es')), [model.teams])
  const [teamId, setTeamId] = useState(() => teams[0]?.id)
  const [q, setQ] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const team = model.teamById.get(teamId) || teams[0]

  const total = teams.reduce((n, t) => n + (t.players?.length || 0), 0)
  const withNumber = teams.reduce((n, t) => n + numbered(t), 0)
  const query = q.trim().toLowerCase()
  const listed = teams.filter(
    (t) =>
      (!query || t.name.toLowerCase().includes(query) || (t.players || []).some((p) => p.full_name.toLowerCase().includes(query))) &&
      (!pendingOnly || numbered(t) < (t.players?.length || 0)),
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <aside className="space-y-3 lg:sticky lg:top-4">
        <div className="card p-3">
          <div className="kicker mb-1">Acreditación</div>
          <div className="text-sm text-white/70">
            <b className="text-white">{withNumber}</b> de {total} jugadores con número
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold" style={{ width: `${total ? (withNumber / total) * 100 : 0}%` }} />
          </div>
        </div>
        <input
          id="roster-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar equipo o jugador…"
          className="focus-ring w-full rounded-xl bg-white/10 px-3 py-2 text-sm placeholder:text-white/40"
        />
        <label className="flex items-center gap-2 px-1 text-xs font-bold text-white/60">
          <input id="roster-pending" type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          Solo equipos con números pendientes
        </label>
        {/* En el celular: un selector; en la compu: la lista con el avance de cada equipo. */}
        <select
          id="roster-team"
          value={team?.id || ''}
          onChange={(e) => setTeamId(e.target.value)}
          className="focus-ring w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-bold lg:hidden [&>option]:bg-indigo-800"
        >
          {listed.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {numbered(t)}/{t.players?.length || 0}
            </option>
          ))}
        </select>
        <ul className="card hidden max-h-[60vh] divide-y divide-white/5 overflow-y-auto lg:block">
          {listed.map((t) => {
            const n = t.players?.length || 0
            const done = n > 0 && numbered(t) === n
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTeamId(t.id)}
                  className={`focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${t.id === team?.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  <Crest team={t} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-bold">{t.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${done ? 'bg-[#008026]/30 text-[#b6f5c8]' : 'bg-white/10 text-white/60'}`}>
                    {numbered(t)}/{n}
                  </span>
                </button>
              </li>
            )
          })}
          {!listed.length && <li className="px-3 py-3 text-sm text-white/50">Ningún equipo coincide.</li>}
        </ul>
      </aside>

      {team ? <TeamRoster key={team.id} team={team} model={model} act={act} busy={busy} /> : <p className="text-white/60">No hay equipos cargados.</p>}
    </div>
  )
}

function TeamRoster({ team, model, act, busy }) {
  const players = useMemo(() => [...(team.players || [])].sort(byName), [team.players])
  const numberRefs = useRef(new Map())
  const [newP, setNewP] = useState({ number: '', name: '' })

  // Goles y tarjetas cargados por jugador: al quitarlo, quedan "sin identificar".
  const eventsByPlayer = useMemo(() => {
    const m = new Map()
    for (const match of model.matches) for (const e of match.events || []) if (e.player_id) m.set(e.player_id, (m.get(e.player_id) || 0) + 1)
    return m
  }, [model.matches])

  const focusNext = (id) => {
    const i = players.findIndex((p) => p.id === id)
    const next = players[i + 1]
    if (next) numberRefs.current.get(next.id)?.focus()
    else document.getElementById('roster-new-number')?.focus()
  }

  const add = async (e) => {
    e.preventDefault()
    const name = newP.name.trim()
    if (name.length < 2) return
    const number = newP.number === '' ? null : Number(newP.number)
    if (number != null && players.some((p) => p.shirt_number === number)) return // ya lo avisa el formulario
    const out = await act('POST', `/teams/${team.id}/players`, { full_name: name, shirt_number: number }, `Agregado: ${number != null ? `#${number} ` : ''}${name}.`)
    if (out) {
      setNewP({ number: '', name: '' })
      document.getElementById('roster-new-number')?.focus()
    }
  }
  const dupNew = newP.number !== '' && players.find((p) => p.shirt_number === Number(newP.number))

  return (
    <section className="min-w-0">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Crest team={team} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="kicker">{team.group ? `Zona ${team.group}` : 'Equipo'} · Lista de buena fe</div>
          <h2 className="truncate text-2xl font-extrabold">{team.name}</h2>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold tabular-nums text-white/70">
          {numbered(team)} de {players.length} con número
        </span>
      </header>
      <p className="mb-3 text-xs text-white/50">Escribí el número y apretá <b>Enter</b>: se guarda y pasa al siguiente jugador. Para borrar un número, dejalo vacío.</p>

      <ul className="card divide-y divide-white/5">
        {players.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            players={players}
            events={eventsByPlayer.get(p.id) || 0}
            act={act}
            busy={busy}
            inputRef={(el) => (el ? numberRefs.current.set(p.id, el) : numberRefs.current.delete(p.id))}
            onDone={() => focusNext(p.id)}
          />
        ))}
        {!players.length && <li className="px-4 py-4 text-sm text-white/50">Este equipo todavía no tiene jugadores cargados.</li>}
      </ul>

      <form onSubmit={add} className="card mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-2 p-3 sm:grid-cols-[72px_minmax(0,1fr)_auto]">
        <div className="kicker col-span-full">Agregar jugador (no estaba en la lista)</div>
        <input
          id="roster-new-number"
          inputMode="numeric"
          value={newP.number}
          onChange={(e) => setNewP((s) => ({ ...s, number: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
          placeholder="Nº"
          aria-label="Número de camiseta"
          className="focus-ring rounded-lg bg-white/10 px-2 py-2 text-center font-extrabold tabular-nums placeholder:text-white/35"
        />
        <input
          id="roster-new-name"
          value={newP.name}
          onChange={(e) => setNewP((s) => ({ ...s, name: e.target.value }))}
          maxLength={120}
          placeholder="Nombre y apellido"
          className="focus-ring min-w-0 rounded-lg bg-white/10 px-3 py-2 font-bold placeholder:text-white/35"
        />
        <button type="submit" disabled={busy || newP.name.trim().length < 2 || Boolean(dupNew)} className="focus-ring col-span-full rounded-lg bg-gold px-4 py-2 font-extrabold text-night disabled:opacity-40 sm:col-span-1">
          Agregar
        </button>
        {dupNew && <p className="col-span-full text-xs font-bold text-[#ff9db3]">El {newP.number} ya lo tiene {dupNew.full_name}.</p>}
      </form>
    </section>
  )
}

function PlayerRow({ player, players, events, act, busy, inputRef, onDone }) {
  const [number, setNumber] = useState(player.shirt_number ?? '')
  const [name, setName] = useState(player.full_name)
  const [state, setState] = useState(null) // 'saving' | 'ok' | 'error'
  const [arm, setArm] = useState(false)
  const editing = useRef(false)
  const cancelled = useRef(false) // Esc: el blur que sigue no guarda

  // Lo que llega del server (refresco cada 10 s) pisa el campo solo si no se está editando.
  useEffect(() => {
    if (!editing.current) setNumber(player.shirt_number ?? '')
  }, [player.shirt_number])
  useEffect(() => {
    if (!editing.current) setName(player.full_name)
  }, [player.full_name])
  useEffect(() => {
    if (state !== 'ok') return
    const id = setTimeout(() => setState(null), 2500)
    return () => clearTimeout(id)
  }, [state])

  const target = number === '' ? null : Number(number)
  const dup = target != null && players.find((p) => p.id !== player.id && p.shirt_number === target)

  const save = async (fields) => {
    setState('saving')
    const out = await act('PATCH', `/players/${player.id}`, fields, null)
    setState(out ? 'ok' : 'error')
    return Boolean(out)
  }
  const saveNumber = async () => {
    editing.current = false
    if (cancelled.current) {
      cancelled.current = false
      return false
    }
    if (target === (player.shirt_number ?? null)) return true
    if (dup) return false // lo explica el aviso "El N ya lo tiene …"
    return save({ shirt_number: target })
  }
  const saveName = async () => {
    editing.current = false
    const clean = name.trim()
    if (clean === player.full_name) return
    if (clean.length < 2) {
      setName(player.full_name)
      return
    }
    await save({ full_name: clean })
  }

  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
      <input
        ref={inputRef}
        inputMode="numeric"
        value={number}
        aria-label={`Número de ${player.full_name}`}
        onFocus={(e) => {
          editing.current = true
          e.target.select() // lo que se tipea reemplaza el número, no se suma
        }}
        onChange={(e) => {
          setNumber(e.target.value.replace(/\D/g, '').slice(0, 3))
          setState(null)
        }}
        onBlur={saveNumber}
        onKeyDown={async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (await saveNumber()) onDone()
          }
          if (e.key === 'Escape') {
            cancelled.current = true
            setNumber(player.shirt_number ?? '')
            setState(null)
            e.currentTarget.blur()
          }
        }}
        placeholder="–"
        className={`focus-ring w-full rounded-lg px-2 py-2 text-center text-xl font-extrabold tabular-nums placeholder:text-white/25 ${dup ? 'bg-live/25 text-[#ffc2cf] ring-1 ring-live' : number === '' ? 'bg-white/5' : 'bg-white/10 text-gold'}`}
      />
      <div className="min-w-0">
        <input
          value={name}
          aria-label="Nombre y apellido"
          maxLength={120}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="focus-ring w-full rounded-lg bg-transparent px-2 py-1.5 font-bold hover:bg-white/5 focus:bg-white/10"
        />
        <div className="px-2 text-[11px] font-bold">
          {dup && <span className="text-[#ff9db3]">El {target} ya lo tiene {dup.full_name}</span>}
          {!dup && state === 'saving' && <span className="text-white/45">Guardando…</span>}
          {!dup && state === 'ok' && <span className="text-[#b6f5c8]">✓ Guardado</span>}
          {!dup && state === 'error' && <span className="text-[#ff9db3]">No se guardó: revisá y probá de nuevo</span>}
          {!dup && !state && events > 0 && <span className="text-white/40">{events} gol(es)/tarjeta(s) cargados</span>}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => (arm ? (setArm(false), act('DELETE', `/players/${player.id}`, null, `Quitado: ${player.full_name}.`)) : setArm(true))}
        onBlur={() => setArm(false)}
        className={`focus-ring rounded-lg px-2 py-1.5 text-xs font-extrabold ${arm ? 'bg-live text-white' : 'text-[#ff9db3] hover:bg-white/5'}`}
        title={events ? 'Sus goles y tarjetas quedan sin identificar' : undefined}
      >
        {arm ? (events ? `Quitar (${events} quedan sin jugador)` : 'Tocá de nuevo') : 'Quitar'}
      </button>
    </li>
  )
}
