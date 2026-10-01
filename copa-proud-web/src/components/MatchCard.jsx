import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { DONE, LIVE, matchLabel } from '../lib/model.js'
import { StatusChip } from './StatusChip.jsx'
import { TeamLine } from './TeamBadge.jsx'

/** Marcador que destella en dorado cuando cambia (gol que entra en vivo). */
function Score({ value, dim }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (prev.current !== value && prev.current != null && value != null) {
      setFlash(true)
      const id = setTimeout(() => setFlash(false), 1800)
      prev.current = value
      return () => clearTimeout(id)
    }
    prev.current = value
  }, [value])
  return (
    <span className={`board-num w-7 text-right text-3xl leading-none ${dim ? 'text-white/45' : 'text-white'} ${flash ? 'score-flash' : ''}`}>
      {value ?? '–'}
    </span>
  )
}

function EventIcon({ type }) {
  if (type === 'YELLOW') return <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-[#ffd400]" aria-hidden="true" />
  if (type === 'RED') return <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-[#e40303]" aria-hidden="true" />
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#fff" />
      <path d="M10 5.2 13.4 7.7 12.1 11.7H7.9L6.6 7.7Z" fill="#1b0246" />
    </svg>
  )
}

function EventList({ match }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const events = match.events || []
  if (!events.length) return null
  return (
    <details className="group mt-2 border-t border-white/10 pt-2">
      <summary className="focus-ring cursor-pointer list-none rounded text-[11px] font-semibold uppercase tracking-wider text-white/50 hover:text-white/80">
        <span className="inline-flex items-center gap-1.5">
          <EventIcon type="GOAL" />
          {events.filter((e) => e.type === 'GOAL' || e.type === 'OWN_GOAL').length}
          <span className="ml-1" />
          <EventIcon type="YELLOW" />
          {events.filter((e) => e.type === 'YELLOW' || e.type === 'RED').length}
          <svg viewBox="0 0 12 12" className="h-3 w-3 transition group-open:rotate-180" aria-hidden="true">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </summary>
      <ul className="mt-2 space-y-1">
        {events.map((e) => {
          const player = e.player_id ? model.playerById.get(e.player_id) : null
          const team = model.teamById.get(e.team_id)
          const home = e.team_id === match.home.team_id
          return (
            <li key={e.id} className={`flex items-center gap-2 text-xs text-white/80 ${home ? '' : 'flex-row-reverse text-right'}`}>
              <EventIcon type={e.type} />
              <span className="truncate">
                {e.minute != null && <span className="board-num mr-1 text-sm text-gold-light">{e.minute}&apos;</span>}
                {player ? `${player.shirt_number != null ? `#${player.shirt_number} ` : ''}${player.full_name}` : team?.short_name || team?.name}
                {e.type === 'OWN_GOAL' && <span className="text-white/50"> ({t('event.OWN_GOAL')})</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/**
 * Tarjeta de partido. `compact` = celda de la grilla horario × cancha (sin eventos ni meta).
 * `showMeta` controla la línea superior (hora · cancha · etapa).
 */
export function MatchCard({ match, compact = false, showMeta = true, className = '', style }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const live = LIVE.has(match.status)
  const done = DONE.has(match.status)
  const home = model.teamById.get(match.home.team_id)
  const away = model.teamById.get(match.away.team_id)
  const winner = match.winner_team_id
  const hasPens = match.home_pens != null && match.away_pens != null

  return (
    <article
      style={style}
      className={`card ${live ? 'live-frame' : ''} ${compact ? 'p-2.5' : 'p-3.5'} ${className}`}
      aria-label={`${matchLabel(match.code, t)}: ${home?.name ?? ''} ${match.home_goals ?? ''} – ${match.away_goals ?? ''} ${away?.name ?? ''}`}
    >
      {showMeta && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <span className="kicker truncate">
            {compact ? matchLabel(match.code, t) : `${match.local?.time} · ${t('common.court_n', { n: match.venue })} · ${matchLabel(match.code, t)}`}
          </span>
          <StatusChip match={match} />
        </header>
      )}
      <div className="space-y-1.5">
        {[
          ['home', home, match.home_goals, match.home_pens],
          ['away', away, match.away_goals, match.away_pens],
        ].map(([side, team, goals, pens]) => (
          <div key={side} className="flex items-center justify-between gap-2">
            <TeamLine
              team={team}
              source={match[side].source}
              pendingReason={match[side].pending_reason}
              size={compact ? 'xs' : 'sm'}
              strong={done && winner && winner === team?.id}
              className={compact ? 'text-xs' : 'text-sm'}
            />
            {(live || done) && (
              <span className="flex items-center gap-1.5">
                {hasPens && <span className="board-num text-sm text-gold-light">({pens})</span>}
                <Score value={goals} dim={done && winner && winner !== team?.id} />
              </span>
            )}
          </div>
        ))}
      </div>
      {!compact && (hasPens || match.veedor_name || match.referee_name) && (
        <footer className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
          {hasPens && <span className="font-semibold text-gold-light/90">{t('common.penalties')} {match.home_pens}–{match.away_pens}</span>}
          {match.veedor_name && <span>{t('common.veedor')}: {match.veedor_name}</span>}
          {match.referee_name && <span>{t('common.referee')}: {match.referee_name}</span>}
        </footer>
      )}
      {!compact && <EventList match={match} />}
    </article>
  )
}
