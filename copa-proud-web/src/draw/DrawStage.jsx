import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { flag } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { useDrawFeed } from './useDrawFeed.js'
import { tandaLabel, visibleView } from './drawView.js'
import { BallsRow, ForeignDots, Reveal } from './DrawBoard.jsx'

/**
 * Tablero del sorteo a pantalla completa (/sorteo?tv=1 y la escena de OBS /obs/tablero).
 * `tv` oculta el cursor y fija 16:9. También se puede seguir desde el celular.
 * Cada equipo que sale se revela en el centro (bolilla y regla de salto incluidas) y después
 * aparece en su zona; si salen varios seguidos, se revelan en fila.
 */
export default function DrawStage({ forceTv = false, embedded = false }) {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const tv = forceTv || params.get('tv') === '1'
  const { state, error, shownSeq, revealing, lastShown, done } = useDrawFeed()
  const teamById = useMemo(() => new Map((state?.teams || []).map((tm) => [tm.id, tm])), [state])

  if (error === 'not_found') return <Center>{t('common.not_published')}</Center>
  if (!state) return <Center>{t('common.loading')}</Center>

  const view = visibleView(state, shownSeq, revealing?.seq)
  const tandas = state.mode === 'TANDAS'
  const eligible = new Set(state.eligible_team_ids)
  const pot = tandas ? view.tandaTeams : view.inPot
  const max = state.rules?.max_foreign

  return (
    <div className={`relative flex flex-col overflow-hidden ${tv ? 'h-dvh cursor-none' : 'min-h-dvh'}`}>
      {!embedded && <DemoBanner />}
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-60" style={{ background: 'radial-gradient(60% 50% at 50% 0%, rgba(54,7,119,0.9), transparent 70%)' }} />

      {/* Encabezado */}
      <header className="relative z-10 flex items-center gap-4 px-[2.5vw] py-[1.6vh]">
        <img src="/brand/mark.webp" alt="" className="h-[clamp(40px,7vh,96px)] w-auto object-contain" />
        <div className="leading-none">
          <div className="text-[clamp(18px,3.2vh,44px)] font-extrabold tracking-tight">{t('draw.title')}</div>
          <div className="mt-1 text-[clamp(10px,1.5vh,20px)] font-bold tracking-[0.25em] text-white/60">COPA PROUD SUDAMERICANA 2026</div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {view.tanda && state.status === 'LIVE' && (
            <span className="rounded-full bg-white/10 px-[1.4vh] py-[0.8vh] text-[clamp(12px,2vh,26px)] font-extrabold uppercase tracking-wider ring-1 ring-white/15">
              <span className="text-gold">{t('draw.tanda', { n: view.tanda.n })}</span> · {tandaLabel(view.tanda, t, state.has_official_procedure)}
            </span>
          )}
          {state.status === 'LIVE' && (
            <span className="inline-flex items-center gap-2 rounded-full bg-live/20 px-4 py-2 text-[clamp(12px,1.8vh,24px)] font-extrabold uppercase tracking-widest text-[#ff8aa5]">
              <span className="live-dot" aria-hidden="true" /> {t('status.LIVE')}
            </span>
          )}
          <span className="board-num text-[clamp(28px,5.5vh,72px)] leading-none text-gold">
            {view.placed}<span className="text-white/30">/{state.teams.length || 28}</span>
          </span>
        </div>
      </header>
      <div className="rainbow-strip relative z-10" />

      <main className={`relative z-10 grid flex-1 gap-[1.6vw] p-[1.6vw] ${tv ? 'grid-cols-[22vw_1fr]' : 'grid-cols-1 lg:grid-cols-[22vw_1fr]'}`}>
        {/* Bombos */}
        <section className="card flex flex-col gap-[1.4vh] p-[1vw]">
          <div className="kicker text-[clamp(10px,1.5vh,18px)]">
            {tandas ? t('draw.teams_pot') : t('draw.pot')} · {pot.length}
          </div>
          <div className={`grid auto-rows-min content-start gap-[0.6vw] ${tandas ? 'grid-cols-2' : 'flex-1 grid-cols-4'}`}>
            {pot.map((tm) =>
              tandas ? (
                <div key={tm.id} className="flex items-center gap-[0.6vw] rounded-xl bg-white/5 p-[0.5vw] ring-1 ring-white/10">
                  <Crest team={tm} size="fluid" className="h-[clamp(24px,4.6vh,60px)] w-[clamp(24px,4.6vh,60px)]" />
                  <span className="line-clamp-2 text-[clamp(10px,1.6vh,20px)] font-bold leading-tight">{tm.name}</span>
                </div>
              ) : (
                <div key={tm.id} className={`flex flex-col items-center gap-1 transition ${eligible.has(tm.id) || !state.eligible_team_ids.length ? '' : 'opacity-30 grayscale'}`} title={tm.name}>
                  <Crest team={tm} size="fluid" className="h-[clamp(28px,5.5vh,72px)] w-[clamp(28px,5.5vh,72px)]" />
                </div>
              ),
            )}
          </div>
          {tandas && view.tanda && (
            <div className="mt-auto">
              <div className="kicker mb-[1vh] text-[clamp(10px,1.5vh,18px)]">
                {view.tanda.ball === 'SLOT' ? t('draw.slots_left') : t('draw.balls_left')}
              </div>
              <BallsRow state={state} view={view} size={Math.round(Math.min(window.innerHeight * 0.055, 64))} />
            </div>
          )}
        </section>

        {/* Zonas */}
        <section className={`grid gap-[0.8vw] ${tv ? 'grid-cols-7' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}`}>
          {state.groups.map((g) => (
            <div key={g} className="card flex flex-col p-[0.6vw]">
              <div className="mb-[1vh] flex items-baseline justify-center gap-2">
                <span className="text-[clamp(9px,1.3vh,16px)] font-bold uppercase tracking-[0.25em] text-white/50">{t('common.zone')}</span>
                <span className="board-num gold-text text-[clamp(28px,6vh,80px)] leading-none">{g}</span>
              </div>
              {max ? <ForeignDots n={view.foreignIn[g] || 0} max={max} className="mb-[0.8vh] justify-center self-center text-[clamp(10px,1.6vh,20px)]" /> : null}
              <div className="flex flex-1 flex-col gap-[0.8vh]">
                {Array.from({ length: state.group_size }, (_, i) => i + 1).map((pos) => {
                  const tid = view.slots[g][pos]
                  const team = tid ? teamById.get(tid) : null
                  const isNext = !revealing && state.status === 'LIVE' && state.next_slot?.group === g && state.next_slot?.position === pos && !view.hidden.size
                  const fresh = team && lastShown?.team_id === team.id
                  return (
                    <div
                      key={pos}
                      className={`flex flex-1 flex-col items-center justify-center gap-[0.5vh] rounded-xl px-1 py-[0.6vh] text-center ring-1 transition ${
                        team ? 'bg-white/5 ring-white/10' : 'ring-white/5'
                      } ${isNext ? 'draw-next ring-2 ring-gold/70' : ''} ${fresh ? 'draw-fresh' : ''}`}
                    >
                      {team ? (
                        <>
                          <Crest team={team} size="fluid" className="h-[clamp(32px,7.5vh,96px)] w-[clamp(32px,7.5vh,96px)]" />
                          <span className="line-clamp-2 text-[clamp(10px,1.9vh,24px)] font-bold leading-tight">
                            {team.name}
                            {team.foreign && <span className="ml-1">{flag(team.country_code)}</span>}
                          </span>
                        </>
                      ) : (
                        <span className="board-num text-[clamp(14px,2.6vh,32px)] text-white/20">{g}{pos}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </main>

      {!tv && (
        <div className="relative z-10 pb-4 text-center">
          <Link to="/" className="focus-ring rounded text-sm font-bold text-gold-light hover:underline">← {t('nav.home')}</Link>
        </div>
      )}

      {/* Antes de empezar */}
      {state.status === 'IDLE' && !state.picks.length && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-night/85 text-center backdrop-blur-sm">
          <div>
            <img src="/brand/logo-dark-bg.webp" alt="" className="mx-auto h-[38vh] w-auto object-contain drop-shadow-[0_18px_40px_rgba(54,7,119,0.9)]" />
            <p className="mt-[3vh] text-[clamp(22px,4.5vh,60px)] font-extrabold">{t('draw.title')}</p>
            <p className="font-script text-[clamp(20px,4vh,52px)] text-gold">{t('draw.soon')}</p>
          </div>
        </div>
      )}

      {revealing && <Reveal key={revealing.seq} pick={revealing} team={teamById.get(revealing.team_id)} teamById={teamById} />}

      {done && (
        <div className="draw-done pointer-events-none absolute inset-x-0 bottom-[3vh] z-30 text-center">
          <span className="rounded-full bg-gold px-[2vw] py-[1vh] text-[clamp(16px,3vh,40px)] font-extrabold text-night shadow-2xl">
            {t('draw.done')}
          </span>
        </div>
      )}
    </div>
  )
}

function Center({ children }) {
  return <div className="grid min-h-dvh place-items-center px-6 text-center font-bold text-white/70">{children}</div>
}
