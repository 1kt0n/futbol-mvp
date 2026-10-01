// Modelo derivado del snapshot público. Puro: se testea sin red (model.test.js).

export const LIVE = new Set(['LIVE', 'HALFTIME'])
export const DONE = new Set(['FINISHED', 'WALKOVER'])
export const STAGES = ['R16', 'QF', 'SF', 'F']
export const CUPS = ['ORO', 'PLATA', 'BRONCE']

/** "-03:00" → -180 (minutos). */
export function offsetMinutes(offset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset || '')
  if (!m) return 0
  const mins = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -mins : mins
}

/**
 * Fecha/hora LOCAL del predio para un ISO con zona (no la del teléfono: alguien que mira desde
 * São Paulo o Madrid tiene que ver el mismo horario que dice el cronograma).
 */
export function localParts(iso, offsetMin) {
  if (!iso) return null
  const ms = Date.parse(iso)
  const shifted = new Date(ms + offsetMin * 60_000)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    ms,
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay(),
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
  }
}

/** 'ORO-O1' → {cup:'ORO', stage:'R16', n:1}; 'A-1v2' → {group:'A', pair:'1v2'}. */
export function parseCode(code) {
  const ko = /^(ORO|PLATA|BRONCE)-([OCSF])(\d*)$/.exec(code)
  if (ko) {
    const stage = { O: 'R16', C: 'QF', S: 'SF', F: 'F' }[ko[2]]
    return { cup: ko[1], stage, n: ko[3] ? Number(ko[3]) : 1 }
  }
  const g = /^([A-Z]+)-(\d+v\d+)$/.exec(code)
  if (g) return { group: g[1], pair: g[2] }
  return {}
}

export function matchLabel(code, t) {
  const p = parseCode(code)
  if (p.group) return t('common.zone_x', { g: p.group })
  if (!p.cup) return code
  const cup = t(`cup.${p.cup}_short`)
  if (p.stage === 'F') return `${t('stage.F_short')} ${cup}`
  return `${t(`stage.${p.stage}_short`)} ${cup} ${p.n}`
}

export function sourceLabel(source, t) {
  const [kind, a, b] = (source || '').split(':')
  switch (kind) {
    case 'SLOT':
      return t('source.SLOT', { g: a, n: b })
    case 'GROUP':
      return t('source.GROUP', { g: a, n: b })
    case 'THIRD':
      return t('source.THIRD', { n: a })
    case 'FOURTH':
      return t('source.FOURTH', { n: a })
    case 'WINNER':
      return t('source.WINNER', { match: matchLabel(a, t) })
    case 'LOSER':
      return t('source.LOSER', { match: matchLabel(a, t) })
    default:
      return t('common.tbd')
  }
}

export function buildModel(snap) {
  const comp = snap.competition
  const offset = offsetMinutes(comp.utc_offset)
  const teamById = new Map(snap.teams.map((t) => [t.id, t]))
  const playerById = new Map()
  for (const t of snap.teams) for (const p of t.players || []) playerById.set(p.id, { ...p, team_id: t.id })

  const matches = snap.matches
    .map((m) => ({ ...m, local: localParts(m.scheduled_at, offset), parsed: parseCode(m.code) }))
    .sort((x, y) => (x.local?.ms ?? 0) - (y.local?.ms ?? 0) || (x.venue ?? 0) - (y.venue ?? 0))
  const matchByCode = new Map(matches.map((m) => [m.code, m]))

  const dayMap = new Map()
  for (const m of matches) {
    if (!m.local) continue
    if (!dayMap.has(m.local.date)) dayMap.set(m.local.date, { date: m.local.date, weekday: m.local.weekday, day: m.local.day, month: m.local.month, matches: [] })
    dayMap.get(m.local.date).matches.push(m)
  }
  const days = [...dayMap.values()]

  const liveMatches = matches.filter((m) => LIVE.has(m.status))
  const doneMatches = matches.filter((m) => DONE.has(m.status))
  const pending = matches.filter((m) => m.status === 'SCHEDULED')

  const finals = Object.fromEntries(
    CUPS.map((cup) => [cup, matches.find((m) => m.parsed.cup === cup && m.parsed.stage === 'F') || null]),
  )

  return {
    comp,
    offset,
    venues: snap.venues,
    teams: snap.teams,
    teamById,
    playerById,
    matches,
    matchByCode,
    days,
    liveMatches,
    doneMatches,
    pending,
    finals,
    groups: snap.groups,
    thirds: snap.thirds,
    stats: snap.stats,
  }
}

/** Partidos de una copa agrupados por ronda, en orden de llave. */
export function cupRounds(model, cup) {
  return STAGES.map((stage) => ({
    stage,
    matches: model.matches.filter((m) => m.parsed.cup === cup && m.parsed.stage === stage).sort((a, b) => a.parsed.n - b.parsed.n),
  })).filter((r) => r.matches.length)
}

export function teamMatches(model, teamId) {
  return model.matches.filter((m) => m.home.team_id === teamId || m.away.team_id === teamId)
}

/** Bandera emoji a partir del código ISO (AR → 🇦🇷). */
export function flag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter((w) => /^[\p{L}\d]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
