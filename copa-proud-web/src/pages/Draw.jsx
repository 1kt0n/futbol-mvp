import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { flag, localParts, offsetMinutes } from '../lib/model.js'
import { IS_DEMO, DEMO_PREFIX } from '../lib/mode.js'
import { SectionTitle } from '../components/Layout.jsx'
import { Countdown } from '../components/Countdown.jsx'
import { Crest } from '../components/TeamBadge.jsx'
import { YouTubeEmbed } from '../components/YouTubeEmbed.jsx'
import { useDrawFeed } from '../draw/useDrawFeed.js'
import { calendarUrl, jumpReason, tandaLabel, visibleView } from '../draw/drawView.js'
import { BallsRow, ZonesGrid } from '../draw/DrawBoard.jsx'

/**
 * Pestaña "Sorteo": cuándo es (con cuenta regresiva y la hora del visitante), la transmisión de
 * YouTube embebida y el tablero en vivo. Con video, el tablero va `spoiler_delay_s` atrás para no
 * adelantarse a la transmisión (YouTube tiene varios segundos de demora).
 */
export default function Draw() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const broadcast = model.comp.broadcast || {}
  const hasVideo = Boolean(broadcast.youtube_id)
  const delayMs = hasVideo ? (broadcast.spoiler_delay_s ?? 0) * 1000 : 0
  const { state, shownSeq, lastShown } = useDrawFeed({ delayMs, animate: false, fastMs: 2000, slowMs: 15000 })
  const teamById = useMemo(() => new Map((state?.teams || []).map((tm) => [tm.id, tm])), [state])

  const status = state?.status || model.comp.draw_status || 'IDLE'
  const live = status === 'LIVE'
  const finished = status === 'DONE'
  const startMs = Date.parse(broadcast.starts_at || '')
  const view = state ? visibleView(state, shownSeq) : null

  // Fecha y hora en la hora del predio (ARG), más la del visitante si es distinta.
  const offset = offsetMinutes(model.comp.utc_offset)
  const venue = startMs ? localParts(broadcast.starts_at, offset) : null
  const dateText = venue
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${venue.date}T12:00:00Z`))
    : null
  const viewerOffset = -new Date(startMs || Date.now()).getTimezoneOffset()
  const viewerTime = startMs && viewerOffset !== offset ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(startMs)) : null
  const siteUrl = `${window.location.origin}${IS_DEMO ? DEMO_PREFIX : ''}/sorteo`
  const calUrl = startMs ? calendarUrl({ title: `${t('draw.official')} · Copa Proud Sudamericana 2026`, startsAt: broadcast.starts_at, details: siteUrl }) : null

  return (
    <>
      {/* Cuándo */}
      <section className="reveal mb-6 grid items-center gap-6 sm:grid-cols-[auto_1fr]" style={{ '--i': 0 }}>
        <img src="/brand/mark.webp" alt="" className="mx-auto h-28 w-28 object-contain drop-shadow-[0_18px_40px_rgba(54,7,119,0.9)] sm:h-36 sm:w-36" />
        <div className="text-center sm:text-left">
          <p className="kicker mb-2">{t('draw.official')}</p>
          {live ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-live/20 px-3 py-1.5 text-lg font-extrabold uppercase tracking-wider text-[#ff8aa5]">
              <span className="live-dot" aria-hidden="true" /> {t('draw.live_banner')}
            </p>
          ) : finished ? (
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('draw.done')}</h1>
          ) : venue ? (
            <>
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                <span className="inline-block first-letter:uppercase">{dateText}</span>
                <span className="gold-text"> · {venue.time} hs</span>
              </h1>
              <p className="mt-1 text-sm font-semibold text-white/60">
                {t('draw.arg_time')}
                {viewerTime && <> · {t('draw.your_time', { time: viewerTime })}</>}
              </p>
            </>
          ) : (
            <h1 className="text-3xl font-extrabold tracking-tight">{t('draw.title')}</h1>
          )}
          {!live && !finished && startMs > 0 && <Countdown target={startMs} label={t('draw.starts_in')} className="mt-4 inline-block text-left" />}
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {hasVideo && (
              <a href={broadcast.youtube_url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-2 rounded-full bg-[#ff0033] px-4 py-2 text-sm font-extrabold text-white">
                ▶ {t('draw.watch_youtube')} ↗
              </a>
            )}
            {calUrl && !live && !finished && (
              <a href={calUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold ring-1 ring-white/15 hover:bg-white/15">
                📅 {t('draw.add_calendar')}
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Transmisión */}
      <section className="reveal mb-8" style={{ '--i': 1 }}>
        {hasVideo ? (
          <YouTubeEmbed id={broadcast.youtube_id} title={t('draw.official')} live={live} />
        ) : (
          <div className="card grid aspect-video place-items-center p-6 text-center">
            <div>
              <img src="/brand/logo-dark-bg.webp" alt="" className="mx-auto h-32 w-auto object-contain opacity-90 sm:h-44" />
              <p className="mt-4 font-bold text-white/70">{t('draw.stream_soon')}</p>
            </div>
          </div>
        )}
      </section>

      {/* Tablero */}
      {state && view && (state.picks.length > 0 || live) && (
        <section className="mb-10">
          <SectionTitle kicker={view.tanda && live ? `${t('draw.tanda', { n: view.tanda.n })} · ${tandaLabel(view.tanda, t, state.has_official_procedure)}` : null} title={finished ? t('draw.board_done') : t('draw.board')}>
            <span className="board-num text-3xl text-gold">
              {view.placed}<span className="text-white/30">/{state.teams.length}</span>
            </span>
          </SectionTitle>
          {live && lastShown && <LastPick pick={lastShown} team={teamById.get(lastShown.team_id)} teamById={teamById} />}
          {live && view.tanda && view.balls.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="kicker">{view.tanda.ball === 'SLOT' ? t('draw.slots_left') : t('draw.balls_left')}</span>
              <BallsRow state={state} view={view} size={30} />
            </div>
          )}
          <ZonesGrid state={state} view={view} teamById={teamById} fresh={lastShown?.team_id} />
          {live && hasVideo && delayMs > 0 && <p className="mt-2 text-xs text-white/45">{t('draw.delay_note')}</p>}
          {finished && (
            <div className="mt-4 flex justify-center">
              <Link to="/zonas" className="focus-ring rounded-full bg-gold px-5 py-2.5 font-extrabold text-night">{t('draw.see_groups')} →</Link>
            </div>
          )}
        </section>
      )}

      {/* Cómo es */}
      {state && <HowItWorks state={state} teamById={teamById} />}
    </>
  )
}

function LastPick({ pick, team, teamById }) {
  const { t } = useI18n()
  const jump = jumpReason(pick, t, teamById)
  return (
    <div key={pick.seq} className="reveal card mb-3 flex flex-wrap items-center gap-3 p-3 ring-1 ring-gold/40">
      <span className="kicker">{t('draw.last_pick')}</span>
      <Crest team={team} size="md" />
      <span className="font-extrabold">
        {team?.name} {team?.foreign && flag(team.country_code)}
      </span>
      <span className="text-white/60">→</span>
      <span className="font-extrabold text-gold">{t('common.zone_x', { g: pick.group })} · {t('draw.position', { n: pick.position })}</span>
      {jump && <span className="rounded-full bg-live/20 px-2.5 py-0.5 text-xs font-bold text-[#ffb3c4]">↷ {t('draw.jump_rule')}: {jump}</span>}
    </div>
  )
}

function HowItWorks({ state, teamById }) {
  const { t } = useI18n()
  if (state.mode !== 'TANDAS' || !state.tandas?.length) return null
  const pairs = (state.rules?.pairs || []).map(([a, b]) => `${teamById.get(a)?.name ?? '?'} / ${teamById.get(b)?.name ?? '?'}`)
  return (
    <section className="mb-10">
      <SectionTitle title={t('draw.how')} />
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,380px)]">
        <ol className="grid gap-2">
          {state.tandas.map((td) => (
            <li key={td.n} className="card flex flex-wrap items-center gap-3 p-3">
              <span className="board-num w-24 shrink-0 text-2xl text-gold">{t('draw.tanda', { n: td.n })}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">{tandaLabel(td, t, state.has_official_procedure)}</span>
                <span className="text-xs text-white/55">
                  {t('draw.tanda_teams', { n: td.team_ids.length })} · {td.ball === 'SLOT' ? t('draw.slots_left') : t('draw.balls_left')}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {td.team_ids.map((id) => (
                  <Crest key={id} team={teamById.get(id)} size="sm" />
                ))}
              </span>
            </li>
          ))}
        </ol>
        <ul className="card space-y-3 p-4 text-sm leading-relaxed text-white/80">
          <li>🎱 {t('draw.how_double')}</li>
          {state.rules?.max_foreign ? <li>🌎 {t('draw.how_foreign', { n: state.rules.max_foreign })}</li> : null}
          {pairs.length > 0 && <li>🤝 {t('draw.how_pairs', { pairs: pairs.join(' · ') })}</li>}
          <li>↷ {t('draw.how_jump')}</li>
          {state.tandas.some((td) => td.ball === 'SLOT') && <li>🔢 {t('draw.how_last')}</li>}
        </ul>
      </div>
    </section>
  )
}
