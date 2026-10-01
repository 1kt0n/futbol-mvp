import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { TeamLine } from './TeamBadge.jsx'

const BAR = {
  ORO: 'bg-gold',
  BRONCE: 'bg-bronze',
  THIRD: 'bg-gradient-to-b from-gold to-bronze',
}

/** A qué copa va cada puesto (reglamento 1.4). El 3° depende de la tabla general de terceros. */
export function destination(position, teamId, thirds) {
  if (position <= 2) return 'ORO'
  if (position === 4) return 'BRONCE'
  if (position === 3) {
    const settled = thirds && !thirds.blocked_groups?.length && thirds.rows?.every((r) => !r.tie_unresolved)
    const rank = thirds?.rows?.find((r) => r.team_id === teamId)?.rank
    if (settled && rank) return rank <= 2 ? 'ORO' : 'BRONCE'
    return 'THIRD'
  }
  return null
}

export function StandingsTable({ rows, complete = false, thirdsMode = false, highlightTeam }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const th = 'w-px whitespace-nowrap px-1.5 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-white/45'
  const td = 'px-1.5 py-2 text-center board-num text-base font-bold'
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-white/10">
          <th className={`${th} w-8`}>{t('table.pos')}</th>
          <th className="px-1.5 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-white/45">{t('table.team')}</th>
          {thirdsMode && <th className={th}>{t('common.zone')}</th>}
          <th className={th}>{t('table.played')}</th>
          <th className={`${th} hidden sm:table-cell`}>{t('table.won')}</th>
          <th className={`${th} hidden sm:table-cell`}>{t('table.drawn')}</th>
          <th className={`${th} hidden sm:table-cell`}>{t('table.lost')}</th>
          <th className={`${th} hidden md:table-cell`}>{t('table.gf')}</th>
          <th className={`${th} hidden md:table-cell`}>{t('table.ga')}</th>
          <th className={th}>{t('table.gd')}</th>
          <th className={`${th} hidden sm:table-cell`} title="Fair Play">{t('table.fp')}</th>
          <th className={`${th} text-gold-light`}>{t('table.pts')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pos = thirdsMode ? r.rank : r.position
          const dest = thirdsMode ? (r.rank <= 2 ? 'ORO' : 'BRONCE') : destination(r.position, r.team_id, model.thirds)
          const mine = highlightTeam && highlightTeam === r.team_id
          return (
            <tr key={r.team_id} className={`border-b border-white/5 last:border-0 ${mine ? 'bg-gold/10' : ''}`}>
              <td className="relative px-1.5 py-2 text-center">
                {dest && <span className={`absolute inset-y-1.5 left-0 w-1 rounded-full ${BAR[dest]}`} aria-hidden="true" />}
                <span className="board-num text-base text-white/70">{pos}</span>
              </td>
              <td className="max-w-0 px-1.5 py-2">
                <TeamLine team={model.teamById.get(r.team_id)} size="sm" className="text-sm" wrap />
                {r.tie_unresolved && (complete || thirdsMode) && (
                  <span className="ml-9 block text-[10px] font-semibold uppercase tracking-wider text-gold-light">{t('table.draw_pending')}</span>
                )}
              </td>
              {thirdsMode && <td className={`${td} text-white/70`}>{r.group}</td>}
              <td className={td}>{r.played}</td>
              <td className={`${td} hidden sm:table-cell text-white/70`}>{r.won}</td>
              <td className={`${td} hidden sm:table-cell text-white/70`}>{r.drawn}</td>
              <td className={`${td} hidden sm:table-cell text-white/70`}>{r.lost}</td>
              <td className={`${td} hidden md:table-cell text-white/70`}>{r.goals_for}</td>
              <td className={`${td} hidden md:table-cell text-white/70`}>{r.goals_against}</td>
              <td className={td}>{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
              <td className={`${td} hidden sm:table-cell text-white/60`}>{r.fair_play}</td>
              <td className={`${td} text-lg text-gold`}>{r.points}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
