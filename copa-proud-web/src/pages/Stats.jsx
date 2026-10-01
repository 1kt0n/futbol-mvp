import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { SectionTitle } from '../components/Layout.jsx'
import { TeamLine } from '../components/TeamBadge.jsx'

function Board({ title, rows, value, valueLabel, empty, render, note }) {
  const { t } = useI18n()
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {valueLabel && <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">{valueLabel}</span>}
      </div>
      {rows.length ? (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="board-num w-6 text-right text-lg text-white/50">{r.rank ?? i + 1}</span>
              <div className="min-w-0 flex-1">{render(r)}</div>
              {value && <span className="board-num text-2xl text-gold">{value(r)}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-white/50">{empty || t('stats.no_data')}</p>
      )}
      {note && <p className="mt-3 text-xs text-white/40">{note}</p>}
    </section>
  )
}

export default function Stats() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const { stats } = model
  const team = (id) => model.teamById.get(id)
  const player = (id) => model.playerById.get(id)
  const playedAny = model.doneMatches.length > 0

  return (
    <>
      <SectionTitle title={t('nav.stats')} />
      <div className="grid gap-4 md:grid-cols-2">
        <Board
          title={t('stats.scorers')}
          valueLabel={t('stats.goals')}
          rows={stats.scorers.slice(0, 15)}
          value={(r) => r.goals}
          note={t('stats.note')}
          render={(r) => {
            const p = player(r.player_id)
            return (
              <div className="min-w-0">
                <div className="truncate font-bold">{p ? p.full_name : t('stats.unknown_player')}</div>
                <TeamLine team={team(r.team_id)} size="xs" className="text-xs" />
              </div>
            )
          }}
        />
        <Board
          title={t('stats.least_conceded')}
          valueLabel={t('stats.conceded')}
          rows={playedAny ? stats.least_conceded.slice(0, 10) : []}
          value={(r) => r.goals_against}
          render={(r) => <TeamLine team={team(r.team_id)} size="sm" className="text-sm" />}
        />
        <Board
          title={t('stats.fair_play')}
          valueLabel={t('stats.points')}
          rows={playedAny ? stats.fair_play.slice(0, 10) : []}
          value={(r) => r.fair_play}
          render={(r) => (
            <div className="flex items-center gap-2">
              <TeamLine team={team(r.team_id)} size="sm" className="text-sm" />
              <span className="ml-auto flex items-center gap-1 text-xs text-white/60">
                <span className="inline-block h-3 w-2 rounded-[2px] bg-[#ffd400]" aria-hidden="true" />
                {r.yellow}
                <span className="ml-1 inline-block h-3 w-2 rounded-[2px] bg-[#e40303]" aria-hidden="true" />
                {r.red}
              </span>
            </div>
          )}
        />
        <Board
          title={t('stats.suspensions')}
          rows={stats.suspensions}
          note={stats.suspensions.length ? t('stats.susp_note') : null}
          render={(r) => {
            const p = player(r.player_id)
            return (
              <div className="min-w-0">
                <div className="truncate font-bold">
                  {p ? `${p.shirt_number != null ? `#${p.shirt_number} ` : ''}${p.full_name}` : t('stats.unknown_player')}
                </div>
                <div className="flex items-center gap-2 text-xs text-white/55">
                  <TeamLine team={team(r.team_id)} size="xs" className="text-xs" />
                  <span>· {t(r.reason === 'RED' ? 'stats.susp_red' : 'stats.susp_double')}</span>
                </div>
              </div>
            )
          }}
        />
      </div>
    </>
  )
}
