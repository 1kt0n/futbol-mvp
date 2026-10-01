import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { SectionTitle } from '../components/Layout.jsx'
import { StandingsTable } from '../components/StandingsTable.jsx'

function Legend() {
  const { t } = useI18n()
  const item = (bar, label) => (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-1 rounded-full ${bar}`} aria-hidden="true" />
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-white/60">
      {item('bg-gold', t('groups.legend_oro'))}
      {item('bg-gradient-to-b from-gold to-bronze', t('groups.legend_third'))}
      {item('bg-bronze', t('groups.legend_bronce'))}
    </div>
  )
}

export default function Groups() {
  const { t } = useI18n()
  const { model } = useCompetition()
  return (
    <>
      <SectionTitle kicker={t('common.group_stage')} title={t('nav.groups')}>
        <Legend />
      </SectionTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        {model.groups.map((g, i) => (
          <section key={g.code} className="card reveal p-3 sm:p-4" style={{ '--i': i }} aria-labelledby={`zona-${g.code}`}>
            <h3 id={`zona-${g.code}`} className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{t('common.zone')}</span>
              <span className="board-num text-3xl leading-none gold-text">{g.code}</span>
            </h3>
            <StandingsTable rows={g.rows} complete={g.complete} />
          </section>
        ))}
      </div>

      <section className="card mt-8 p-3 sm:p-4" aria-labelledby="terceros">
        <SectionTitle title={<span id="terceros">{t('groups.thirds')}</span>} className="mb-2" />
        <p className="mb-3 text-xs font-semibold text-white/55">{t('groups.thirds_note')}</p>
        <StandingsTable rows={model.thirds.rows} thirdsMode />
      </section>

      <p className="mt-4 text-xs text-white/45">{t('table.tiebreak')}</p>
    </>
  )
}
