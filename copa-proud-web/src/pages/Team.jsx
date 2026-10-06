import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { flag, teamMatches } from '../lib/model.js'
import { SectionTitle } from '../components/Layout.jsx'
import { MatchCard } from '../components/MatchCard.jsx'
import { StandingsTable } from '../components/StandingsTable.jsx'
import { Crest } from '../components/TeamBadge.jsx'
import NotFound from './NotFound.jsx'

export default function Team() {
  const { id } = useParams()
  const { t } = useI18n()
  const { model } = useCompetition()
  const team = model.teamById.get(id)
  if (!team) return <NotFound />

  const group = model.groups.find((g) => g.code === team.group)
  const row = group?.rows.find((r) => r.team_id === team.id)
  const matches = teamMatches(model, team.id)
  const players = team.players || []

  return (
    <>
      <section className="mb-8 flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <Crest team={team} size="xl" className="reveal" />
        <div className="reveal" style={{ '--i': 1 }}>
          {team.group && (
            <div className="kicker mb-1">
              {row ? t('teams.position', { n: row.position, g: team.group }) : t('common.zone_x', { g: team.group })}
            </div>
          )}
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{team.name}</h1>
          {(team.country_code || team.city) && (
            <p className="mt-1 text-white/60">
              {team.country_code && <span className="mr-1.5 text-xl" aria-hidden="true">{flag(team.country_code)}</span>}
              {team.city}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {group && (
            <section className="card p-3 sm:p-4">
              <h2 className="mb-1 text-sm font-bold uppercase tracking-[0.2em] text-white/50">
                <Link to="/zonas" className="focus-ring rounded hover:text-white">{t('common.zone_x', { g: group.code })}</Link>
              </h2>
              <StandingsTable rows={group.rows} complete={group.complete} highlightTeam={team.id} />
            </section>
          )}
          <section>
            <SectionTitle title={t('teams.matches')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((m) => (
                <MatchCard key={m.code} match={m} />
              ))}
            </div>
          </section>
        </div>

        <aside>
          <SectionTitle title={t('teams.roster')} />
          {players.length ? (
            <ul className="card divide-y divide-white/5">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  {players.some((x) => x.shirt_number != null) && <span className="board-num w-8 text-right text-2xl text-gold">{p.shirt_number ?? '–'}</span>}
                  <span className="flex-1 truncate font-semibold">{p.full_name}</span>
                  {p.is_captain && (
                    <span title={t('teams.captain')} className="rounded bg-gold px-1.5 text-[10px] font-extrabold text-night">C</span>
                  )}
                  {p.is_goalkeeper && (
                    <span title={t('teams.gk')} className="rounded bg-white/15 px-1.5 text-[10px] font-extrabold">
                      {t('teams.gk').slice(0, 3).toUpperCase()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="card p-4 text-sm text-white/55">{t('teams.no_roster')}</p>
          )}
        </aside>
      </div>
    </>
  )
}
