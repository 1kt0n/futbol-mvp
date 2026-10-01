import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { SectionTitle } from '../components/Layout.jsx'
import { MatchCard } from '../components/MatchCard.jsx'

const BREAK_MIN = 75 // un hueco mayor entre turnos = receso (sábado 13:30 → 15:00)

function dayLabel(day, locale) {
  const d = new Date(Date.UTC(2000, day.month - 1, day.day))
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(d)}`
}

/** Turnos del día (hora → partidos), con marca de receso cuando hay un hueco largo. */
function slotsOf(matches) {
  const byTime = new Map()
  for (const m of matches) {
    if (!byTime.has(m.local.time)) byTime.set(m.local.time, { time: m.local.time, ms: m.local.ms, matches: [] })
    byTime.get(m.local.time).matches.push(m)
  }
  const slots = [...byTime.values()].sort((a, b) => a.ms - b.ms)
  return slots.map((s, i) => ({ ...s, breakBefore: i > 0 && (s.ms - slots[i - 1].ms) / 60_000 > BREAK_MIN }))
}

export default function Fixture() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const [params, setParams] = useSearchParams()
  const set = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  // Día por defecto: el de hoy si es día de torneo; si no, el primero.
  const today = new Date(Date.now() + model.offset * 60_000).toISOString().slice(0, 10)
  const dayKey = params.get('dia') || (model.days.some((d) => d.date === today) ? today : model.days[0]?.date)
  const day = model.days.find((d) => d.date === dayKey) || model.days[0]
  const view = params.get('vista') || 'grilla'
  const team = params.get('equipo') || ''
  const court = Number(params.get('cancha')) || 0

  const slots = useMemo(() => (day ? slotsOf(day.matches) : []), [day])
  const involves = (m) => !team || m.home.team_id === team || m.away.team_id === team
  const teamsSorted = useMemo(() => [...model.teams].sort((a, b) => a.name.localeCompare(b.name)), [model.teams])

  const pill = (active) =>
    `focus-ring rounded-full px-3.5 py-1.5 text-sm font-bold transition ${active ? 'bg-gold text-night' : 'bg-white/5 text-white/70 ring-1 ring-white/10 hover:text-white'}`
  const select = 'focus-ring rounded-full bg-white/5 px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/10 [&>option]:bg-indigo-800'

  return (
    <>
      <SectionTitle kicker={t('common.local_time')} title={t('nav.fixture')} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {model.days.map((d) => (
          <button key={d.date} type="button" className={pill(d.date === day?.date)} onClick={() => set('dia', d.date)}>
            {dayLabel(d, locale)}
          </button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" />
        <div className="flex rounded-full bg-white/5 p-0.5 ring-1 ring-white/10">
          {['grilla', 'lista'].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`focus-ring rounded-full px-3 py-1 text-xs font-bold ${view === v ? 'bg-white text-night' : 'text-white/60'}`}
              onClick={() => set('vista', v === 'grilla' ? '' : v)}
            >
              {t(v === 'grilla' ? 'fixture.grid' : 'fixture.list')}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="f-team">{t('fixture.filter_team')}</label>
        <select id="f-team" className={select} value={team} onChange={(e) => set('equipo', e.target.value)}>
          <option value="">{t('common.all_teams')}</option>
          {teamsSorted.map((tm) => (
            <option key={tm.id} value={tm.id}>{tm.name}</option>
          ))}
        </select>
        {view === 'lista' && (
          <>
            <label className="sr-only" htmlFor="f-court">{t('fixture.filter_court')}</label>
            <select id="f-court" className={select} value={court || ''} onChange={(e) => set('cancha', e.target.value)}>
              <option value="">{t('common.all_courts')}</option>
              {model.venues.map((v) => (
                <option key={v.number} value={v.number}>{t('common.court_n', { n: v.number })}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {view === 'grilla' ? (
        <div className="scroll-x -mx-4 px-4 pb-2">
          <div className="grid gap-2" style={{ gridTemplateColumns: `64px repeat(${model.venues.length}, minmax(200px, 1fr))`, minWidth: 64 + model.venues.length * 208 }}>
            <div />
            {model.venues.map((v) => (
              <div key={v.number} className="sticky top-0 pb-1 text-center">
                <span className="board-num text-2xl text-white/90">{v.number}</span>
                <span className="ml-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{t('common.court')}</span>
              </div>
            ))}
            {slots.map((s) => (
              <SlotRow key={s.time} slot={s} venues={model.venues} involves={involves} team={team} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {slots.map((s) => {
            const list = s.matches.filter((m) => involves(m) && (!court || m.venue === court))
            if (!list.length) return null
            return (
              <section key={s.time}>
                {s.breakBefore && <BreakBanner />}
                <h3 className="board-num mb-2 text-3xl text-gold">{s.time}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((m) => (
                    <MatchCard key={m.code} match={m} />
                  ))}
                </div>
              </section>
            )
          })}
          {!slots.some((s) => s.matches.some((m) => involves(m) && (!court || m.venue === court))) && (
            <p className="card p-6 text-center text-white/55">{t('fixture.empty')}</p>
          )}
        </div>
      )}
    </>
  )
}

function BreakBanner({ grid = false, cols = 1 }) {
  const { t } = useI18n()
  return (
    <div
      className="my-2 rounded-xl border border-dashed border-gold/30 bg-gold/5 py-2 text-center text-xs font-bold uppercase tracking-[0.2em] text-gold-light"
      style={grid ? { gridColumn: `1 / span ${cols}` } : undefined}
    >
      {t('fixture.lunch')}
    </div>
  )
}

function SlotRow({ slot, venues, involves, team }) {
  const byVenue = new Map(slot.matches.map((m) => [m.venue, m]))
  return (
    <>
      {slot.breakBefore && <BreakBanner grid cols={venues.length + 1} />}
      <div className="flex items-start justify-end pr-1 pt-2">
        <span className="board-num text-xl text-gold">{slot.time}</span>
      </div>
      {venues.map((v) => {
        const m = byVenue.get(v.number)
        if (!m) return <div key={v.number} className="rounded-xl border border-dashed border-white/5" />
        const on = involves(m)
        return (
          <div key={v.number} className={`transition ${team && !on ? 'opacity-25' : ''} ${team && on ? 'scale-[1.02]' : ''}`}>
            <MatchCard match={m} compact />
          </div>
        )
      })}
    </>
  )
}
