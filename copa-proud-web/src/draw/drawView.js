// Lo que se VE del sorteo en una pantalla (puro, sin red). Las pantallas no muestran todo lo que
// ya pasó en el servidor: un equipo recién sorteado queda oculto mientras se revela (o mientras
// dura la demora anti-spoiler del sitio). Todo se calcula a partir de los picks visibles.

export const REVEAL_MS = 4200 // escudo → nombre → bolilla → destino
export const REVEAL_JUMP_MS = 6400 // + explicación de la regla de salto

export const revealMs = (pick) => (pick?.jump ? REVEAL_JUMP_MS : REVEAL_MS)

/**
 * @param state     estado público del sorteo (GET …/draw)
 * @param shownSeq  hasta qué pick (seq) se muestra en las zonas (null = todos)
 * @param outSeq    pick que se está revelando: su equipo ya salió del bombo aunque no esté en la zona
 */
export function visibleView(state, shownSeq, outSeq = null) {
  const shown = (p) => shownSeq === null || shownSeq === undefined || p.seq <= shownSeq
  const picks = state.picks.filter(shown)
  const hidden = new Set(state.picks.filter((p) => !shown(p)).map((p) => p.team_id))
  const revealingTeam = outSeq ? state.picks.find((p) => p.seq === outSeq)?.team_id : null

  const slots = {}
  const placed = new Set()
  for (const g of state.groups) {
    slots[g] = {}
    for (let pos = 1; pos <= state.group_size; pos++) {
      const tid = state.slots[g]?.[String(pos)]
      const visible = tid && !hidden.has(tid) ? tid : null
      slots[g][pos] = visible
      if (visible) placed.add(visible)
    }
  }
  // En el bombo: los que todavía no se ven ubicados, salvo el que se está revelando.
  const inPot = state.teams.filter((t) => !placed.has(t.id) && t.id !== revealingTeam)
  const foreignIds = new Set(state.teams.filter((t) => t.foreign).map((t) => t.id))
  const foreignIn = Object.fromEntries(state.groups.map((g) => [g, Object.values(slots[g]).filter((t) => t && foreignIds.has(t)).length]))

  const view = { slots, hidden, placed: placed.size, picks, inPot, foreignIn, tanda: null, tandaTeams: [], balls: [], drawn: [] }
  if (state.mode !== 'TANDAS') return view

  // Tanda en curso según lo visible (no la del servidor: puede ir adelantada).
  const potOf = (t) => t.pot ?? 999
  const notPlaced = state.teams.filter((t) => !placed.has(t.id))
  if (!notPlaced.length) return view
  const n = Math.min(...notPlaced.map(potOf))
  const info = state.tandas?.find((x) => x.n === n) || { n, label: `Tanda ${n}`, ball: 'GROUP', team_ids: [] }
  const drawn = state.picks.filter((p) => (shown(p) || p.seq === outSeq) && p.tanda === n && p.ball).map((p) => p.ball)
  const balls =
    info.ball === 'SLOT'
      ? state.groups.flatMap((g) => Object.keys(slots[g]).filter((pos) => !slots[g][pos]).map((pos) => `${g}${pos}`))
      : state.groups.filter((g) => !drawn.includes(g))
  return { ...view, tanda: info, tandaTeams: inPot.filter((t) => potOf(t) === n), balls, drawn }
}

/** Texto de la regla de salto para una pick ("La Zona C ya tiene 2 extranjeros"). */
export function jumpReason(pick, t, teamById) {
  const j = pick?.jump
  if (!j) return null
  const partner = j.partner_id ? teamById?.get(j.partner_id)?.name : ''
  return t(`draw.jump.${j.reason}`, { from: j.from, partner })
}

/** Etiqueta de la tanda: las del procedimiento oficial están traducidas; si no, la de la config. */
export function tandaLabel(tanda, t, official) {
  if (!tanda) return ''
  const key = `draw.tanda_label.${tanda.n}`
  const tr = official ? t(key) : key
  return tr !== key ? tr : tanda.label
}

/** Link "agendar en Google Calendar" (1 h desde el inicio). */
export function calendarUrl({ title, startsAt, details }) {
  const ms = Date.parse(startsAt)
  if (!ms) return null
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${fmt(ms)}/${fmt(ms + 3600_000)}`, details })
  return `https://calendar.google.com/calendar/render?${params}`
}
