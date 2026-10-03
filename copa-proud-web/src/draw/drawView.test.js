import { describe, expect, it } from 'vitest'
import { calendarUrl, revealMs, REVEAL_JUMP_MS, REVEAL_MS, visibleView } from './drawView.js'

const groups = ['A', 'B']
const empty = () => ({ A: { 1: null, 2: null }, B: { 1: null, 2: null } })

function state(over = {}) {
  return {
    mode: 'TANDAS',
    groups,
    group_size: 2,
    slots: empty(),
    picks: [],
    rules: { max_foreign: 1 },
    tandas: [
      { n: 1, label: 'Extranjeros', ball: 'GROUP', team_ids: ['br', 'uy'] },
      { n: 2, label: 'Resto', ball: 'SLOT', team_ids: ['ar1', 'ar2'] },
    ],
    teams: [
      { id: 'br', pot: 1, foreign: true },
      { id: 'uy', pot: 1, foreign: true },
      { id: 'ar1', pot: 2, foreign: false },
      { id: 'ar2', pot: 2, foreign: false },
    ],
    ...over,
  }
}

describe('visibleView', () => {
  it('oculta los picks que todavía no se mostraron (revelación / demora anti-spoiler)', () => {
    const s = state({
      slots: { A: { 1: 'br', 2: null }, B: { 1: 'uy', 2: null } },
      picks: [
        { seq: 1, team_id: 'br', group: 'A', position: 1, tanda: 1, ball: 'A' },
        { seq: 2, team_id: 'uy', group: 'B', position: 1, tanda: 1, ball: 'B' },
      ],
    })
    const v = visibleView(s, 1)
    expect(v.slots.B[1]).toBeNull()
    expect(v.placed).toBe(1)
    expect(v.tanda.n).toBe(1) // uy sigue "en el bombo" para este espectador
    expect(v.tandaTeams.map((t) => t.id)).toEqual(['uy'])
    expect(v.balls).toEqual(['B'])
    expect(v.foreignIn).toEqual({ A: 1, B: 0 })
  })

  it('el equipo que se está revelando ya salió del bombo y su bolilla cuenta como usada', () => {
    const s = state({
      slots: { A: { 1: 'br', 2: null }, B: { 1: null, 2: null } },
      picks: [{ seq: 1, team_id: 'br', group: 'A', position: 1, tanda: 1, ball: 'A' }],
    })
    const v = visibleView(s, 0, 1)
    expect(v.slots.A[1]).toBeNull()
    expect(v.inPot.map((t) => t.id)).not.toContain('br')
    expect(v.drawn).toEqual(['A'])
  })

  it('última tanda: las bolillas son los casilleros libres', () => {
    const s = state({
      slots: { A: { 1: 'br', 2: null }, B: { 1: 'uy', 2: null } },
      picks: [
        { seq: 1, team_id: 'br', group: 'A', position: 1, tanda: 1, ball: 'A' },
        { seq: 2, team_id: 'uy', group: 'B', position: 1, tanda: 1, ball: 'B' },
      ],
    })
    const v = visibleView(s, null)
    expect(v.tanda.n).toBe(2)
    expect(v.balls).toEqual(['A2', 'B2'])
  })

  it('sin tandas no calcula bombos', () => {
    const v = visibleView(state({ mode: 'ROUND_ROBIN' }), null)
    expect(v.tanda).toBeNull()
    expect(v.inPot).toHaveLength(4)
  })
})

describe('helpers', () => {
  it('la revelación dura más si hubo regla de salto', () => {
    expect(revealMs({})).toBe(REVEAL_MS)
    expect(revealMs({ jump: { from: 'A', to: 'B' } })).toBe(REVEAL_JUMP_MS)
  })

  it('link de calendario en UTC (22:15 ARG = 01:15Z del día siguiente)', () => {
    const url = calendarUrl({ title: 'Sorteo', startsAt: '2026-10-06T22:15:00-03:00', details: 'x' })
    expect(url).toContain('dates=20261007T011500Z%2F20261007T021500Z')
  })
})
