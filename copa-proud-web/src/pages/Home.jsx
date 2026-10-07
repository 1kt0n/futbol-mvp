import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { CUPS, DONE, LIVE, localParts, offsetMinutes } from '../lib/model.js'
import { SectionTitle } from '../components/Layout.jsx'
import { MatchCard } from '../components/MatchCard.jsx'
import { Crest } from '../components/TeamBadge.jsx'
import { Countdown } from '../components/Countdown.jsx'

function Hero() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const first = model.matches[0]
  const live = model.liveMatches.length
  const allDone = model.matches.length > 0 && model.doneMatches.length === model.matches.length
  const fmt = (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : '')
  const start = fmt(model.comp.starts_on)
  const end = fmt(model.comp.ends_on)
  const zones = model.groups.length
  const teams = zones * 4

  let status
  if (live) {
    status = (
      <span className="inline-flex items-center gap-2 rounded-full bg-live/20 px-3 py-1.5 text-sm font-extrabold uppercase tracking-wider text-[#ff8aa5]">
        <span className="live-dot" aria-hidden="true" />
        {t('status.LIVE')} · {live}
      </span>
    )
  } else if (allDone) {
    status = <span className="text-sm font-bold text-gold-light">{t('home.tournament_over')}</span>
  } else if (first?.local && first.status === 'SCHEDULED') {
    status = <Countdown target={first.local.ms} className="inline-block text-left" />
  }

  return (
    <section className="relative mb-10 grid items-center gap-6 sm:grid-cols-[minmax(0,320px)_1fr]">
      <img
        src="/brand/logo-dark-bg.webp"
        alt="Copa Proud Sudamericana 2026"
        width="1024"
        height="1116"
        className="reveal mx-auto w-56 drop-shadow-[0_18px_40px_rgba(54,7,119,0.9)] sm:w-full"
        style={{ '--i': 0 }}
      />
      <div className="reveal text-center sm:text-left" style={{ '--i': 2 }}>
        <p className="kicker mb-2">
          {start} – {end} · {t('common.local_time')}
        </p>
        <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          <span className="board-num text-6xl text-white sm:text-8xl">{teams}</span>{' '}
          <span className="gold-text">{t('home.hero_teams')}</span>
          <br />
          <span className="text-2xl text-white/80 sm:text-3xl">{t('home.hero_meta', { z: zones, c: model.venues.length })}</span>
        </h1>
        <p className="mt-2 font-script text-2xl text-gold sm:text-3xl">{t('footer.tagline_2')}</p>
        <div className="mt-4">{status}</div>
      </div>
    </section>
  )
}

/** Aviso del sorteo (hasta que termina): cuándo es y link a la pestaña. */
function DrawPromo() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const status = model.comp.draw_status
  const startsAt = model.comp.broadcast?.starts_at
  if (status === 'DONE' || status === 'LIVE' || !startsAt) return null
  const p = localParts(startsAt, offsetMinutes(model.comp.utc_offset))
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${p.date}T12:00:00Z`))
  return (
    <Link to="/sorteo" className="card reveal focus-ring mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:border-white/25" style={{ '--i': 1 }}>
      <span className="draw-ball h-11 w-11 text-2xl" aria-hidden="true">A</span>
      <span className="min-w-0 flex-1">
        <span className="kicker block">{t('draw.official')}</span>
        <span className="block text-lg font-extrabold first-letter:uppercase">
          {day} · <span className="text-gold">{p.time} hs</span> <span className="text-sm font-semibold text-white/55">({t('draw.arg_time')})</span>
        </span>
      </span>
      <span className="text-sm font-extrabold text-gold-light">{t('draw.watch_here')} →</span>
    </Link>
  )
}

/** Dónde se juega: acceso al mapa de canchas. */
function VenueCard() {
  const { t } = useI18n()
  return (
    <Link to="/mapa" className="card reveal focus-ring mb-8 flex items-center gap-4 p-3 pr-4 hover:border-white/25" style={{ '--i': 2 }}>
      <img src="/brand/mapa-canchas.webp" alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover object-top" />
      <span className="min-w-0 flex-1">
        <span className="kicker block">{t('home.where')}</span>
        <span className="block text-lg font-extrabold">Polideportivo Cramer</span>
        <span className="block truncate text-sm text-white/60">Av. Crámer 3249, Núñez · CABA</span>
      </span>
      <span className="hidden text-sm font-extrabold text-gold-light sm:block">{t('home.see_map')} →</span>
    </Link>
  )
}

function Champions() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const champs = CUPS.map((cup) => [cup, model.finals[cup]?.winner_team_id && model.teamById.get(model.finals[cup].winner_team_id)]).filter(([, team]) => team)
  if (!champs.length) return null
  const tone = { ORO: 'gold-text', PLATA: 'text-silver', BRONCE: 'text-bronze' }
  return (
    <section className="mb-10">
      <SectionTitle title={t('home.champions')} />
      <div className="grid gap-3 sm:grid-cols-3">
        {champs.map(([cup, team], i) => (
          <Link key={cup} to={`/equipos/${team.id}`} className="card reveal focus-ring flex items-center gap-4 p-4 hover:border-white/25" style={{ '--i': i }}>
            <Crest team={team} size="lg" />
            <div className="min-w-0">
              <div className={`kicker ${tone[cup]}`}>{t(`cup.${cup}`)}</div>
              <div className="truncate text-lg font-extrabold">{team.name}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Tablero "cancha por cancha": lo que se juega ahora en cada una, o lo próximo. */
function Courts() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const tiles = model.venues.map((v) => {
    const mine = model.matches.filter((m) => m.venue === v.number)
    const current = mine.find((m) => LIVE.has(m.status)) || mine.find((m) => m.status === 'SCHEDULED') || [...mine].reverse().find((m) => DONE.has(m.status))
    return { venue: v, match: current }
  })
  return (
    <section className="mb-10">
      <SectionTitle kicker={model.liveMatches.length ? t('home.live_now') : t('home.court_next')} title={t('home.by_court')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(({ venue, match }, i) => (
          <div key={venue.number} className="reveal" style={{ '--i': i + 3 }}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="board-num text-4xl leading-none text-white/90">{venue.number}</span>
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{t('common.court')}</span>
            </div>
            {match ? <MatchCard match={match} /> : <div className="card p-4 text-sm text-white/45">{t('home.court_free')}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const next = model.pending.slice(0, 6)
  const latest = [...model.doneMatches].sort((a, b) => (b.local?.ms ?? 0) - (a.local?.ms ?? 0)).slice(0, 6)

  return (
    <>
      <Hero />
      <DrawPromo />
      <VenueCard />
      <Champions />
      {model.pending.length + model.liveMatches.length > 0 && <Courts />}
      {next.length > 0 && (
        <section className="mb-10">
          <SectionTitle title={t('home.next')}>
            <Link to="/fixture" className="focus-ring rounded text-sm font-bold text-gold-light hover:underline">
              {t('common.see_all')} →
            </Link>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {next.map((m) => (
              <MatchCard key={m.code} match={m} />
            ))}
          </div>
        </section>
      )}
      {latest.length > 0 && (
        <section className="mb-10">
          <SectionTitle title={t('home.latest')} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((m) => (
              <MatchCard key={m.code} match={m} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
