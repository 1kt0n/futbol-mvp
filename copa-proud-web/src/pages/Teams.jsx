import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { flag } from '../lib/model.js'
import { SectionTitle } from '../components/Layout.jsx'
import { Crest } from '../components/TeamBadge.jsx'

function TeamTile({ team, i }) {
  return (
    <Link
      to={`/equipos/${team.id}`}
      className="card reveal focus-ring group flex flex-col items-center gap-2 p-4 text-center transition hover:-translate-y-0.5 hover:border-gold/40"
      style={{ '--i': i }}
    >
      <Crest team={team} size="lg" className="transition group-hover:scale-105" />
      <span className="line-clamp-2 text-sm font-bold leading-tight">{team.name}</span>
      {team.country_code && <span className="text-lg leading-none" aria-hidden="true">{flag(team.country_code)}</span>}
    </Link>
  )
}

export default function Teams() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const assigned = model.teams.some((tm) => tm.group)
  const sorted = [...model.teams].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <SectionTitle title={t('teams.title')} />
      {assigned ? (
        <div className="space-y-8">
          {model.groups.map((g) => {
            const teams = model.teams.filter((tm) => tm.group === g.code).sort((a, b) => a.position - b.position)
            if (!teams.length) return null
            return (
              <section key={g.code}>
                <h3 className="mb-3 flex items-baseline gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{t('common.zone')}</span>
                  <span className="board-num text-3xl leading-none gold-text">{g.code}</span>
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {teams.map((tm, i) => (
                    <TeamTile key={tm.id} team={tm} i={i} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {sorted.map((tm, i) => (
            <TeamTile key={tm.id} team={tm} i={i} />
          ))}
        </div>
      )}
    </>
  )
}
