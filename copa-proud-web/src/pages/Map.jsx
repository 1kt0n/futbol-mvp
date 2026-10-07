import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { SectionTitle } from '../components/Layout.jsx'

// Sede del torneo (diseño "Mapa de canchas" de la organización, exportado de canchas.pdf).
const VENUE = {
  name: 'Polideportivo Cramer',
  address: 'Av. Crámer 3249, Núñez, Buenos Aires',
  maps: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Polideportivo Cramer, Av. Crámer 3249, Núñez, Buenos Aires'),
}
const MAP_IMG = '/brand/mapa-canchas.webp'

/** Pestaña "Mapa": dónde se juega y qué canchas usa el torneo. */
export default function MapPage() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const courts = model.venues.map((v) => v.number)
  const day = (iso) =>
    iso ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : ''

  return (
    <>
      <SectionTitle kicker={VENUE.name} title={t('map.title')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <a href={MAP_IMG} target="_blank" rel="noreferrer" className="card reveal focus-ring block overflow-hidden p-2" style={{ '--i': 0 }} title={t('map.open_full')}>
          <img src={MAP_IMG} alt={`${t('map.title')} · ${VENUE.name}`} width="1406" height="1846" className="mx-auto h-auto w-full max-w-[720px] rounded-xl" />
        </a>

        <aside className="reveal space-y-4 lg:sticky lg:top-24" style={{ '--i': 1 }}>
          <div className="card p-5">
            <div className="kicker mb-1">{t('map.venue')}</div>
            <p className="text-xl font-extrabold">{VENUE.name}</p>
            <p className="mt-1 text-sm text-white/70">{VENUE.address}</p>
            <a href={VENUE.maps} target="_blank" rel="noreferrer" className="focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-night">
              {t('map.directions')} ↗
            </a>
          </div>

          <div className="card p-5">
            <div className="kicker mb-3">{t('map.courts')}</div>
            <div className="grid grid-cols-6 gap-1.5">
              {courts.map((n) => (
                <span key={n} className="board-num grid aspect-square place-items-center rounded-xl bg-white/5 text-3xl leading-none text-gold ring-1 ring-white/10">
                  {n}
                </span>
              ))}
            </div>
            <p className="mt-4 text-sm text-white/70">
              <span className="block first-letter:uppercase">{day(model.comp.starts_on)}</span>
              <span className="block first-letter:uppercase">{day(model.comp.ends_on)}</span>
              <span className="block font-bold text-white/85">{t('map.hours')}</span>
            </p>
          </div>

          <p className="px-1 text-xs text-white/45">{t('map.tip')}</p>
        </aside>
      </div>
    </>
  )
}
