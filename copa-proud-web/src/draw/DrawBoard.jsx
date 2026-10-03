// Piezas del sorteo que comparten la página pública, el tablero de transmisión y las escenas de OBS.
import { useI18n } from '../i18n/I18nProvider.jsx'
import { flag } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { jumpReason, revealMs } from './drawView.js'

/** Puntitos de extranjeros en una zona (●● = cupo lleno). */
export function ForeignDots({ n, max, className = '' }) {
  const { t } = useI18n()
  if (!max) return null
  return (
    <span className={`inline-flex items-center gap-[0.25em] ${className}`} title={`${n}/${max} ${t('draw.foreign')}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`inline-block h-[0.55em] w-[0.55em] rounded-full ${i < n ? 'bg-gold' : 'bg-white/15'}`} />
      ))}
    </span>
  )
}

/** Bolillas del bombo de zonas (o casilleros libres en la última tanda). */
export function BallsRow({ state, view, size = 44, className = '' }) {
  if (!view.tanda) return null
  const slotKind = view.tanda.ball === 'SLOT'
  const all = slotKind ? view.balls : state.groups
  const used = new Set(view.drawn)
  return (
    <div className={`flex flex-wrap gap-[0.4em] ${className}`}>
      {all.map((b) => (
        <span
          key={b}
          className={`draw-ball ${!slotKind && used.has(b) ? 'is-used' : ''}`}
          style={{ width: size * (slotKind ? 1.15 : 1), height: size, fontSize: size * (slotKind ? 0.42 : 0.55) }}
        >
          {b}
        </span>
      ))}
    </div>
  )
}

const ZONE = {
  page: {
    grid: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7',
    card: 'card p-2',
    head: 'board-num gold-text text-3xl leading-none',
    cells: 'flex flex-col gap-1',
    cell: 'flex min-h-[40px] items-center gap-2 rounded-lg px-2 py-1.5 text-left',
    crest: 'h-7 w-7',
    name: 'line-clamp-2 text-[12px] font-bold leading-tight',
    empty: 'board-num text-base text-white/20',
    dots: 'text-[12px]',
  },
  // Escenario fijo de 1920×1080 (OBS): tamaños en px
  split: {
    grid: 'grid grid-cols-4 gap-[14px]',
    card: 'card p-[12px]',
    head: 'board-num gold-text text-[52px] leading-none',
    cells: 'flex flex-col gap-[8px]',
    cell: 'flex h-[64px] items-center gap-[10px] rounded-[12px] px-[10px] text-left',
    crest: 'h-[46px] w-[46px]',
    name: 'line-clamp-2 text-[17px] font-bold leading-tight',
    empty: 'board-num text-[24px] text-white/20',
    dots: 'text-[16px]',
  },
  final: {
    grid: 'grid grid-cols-7 gap-[16px]',
    card: 'card p-[14px]',
    head: 'board-num gold-text text-[72px] leading-none',
    cells: 'flex flex-col gap-[12px]',
    cell: 'flex h-[150px] flex-col items-center justify-center gap-[8px] rounded-[14px] px-[6px] text-center',
    crest: 'h-[84px] w-[84px]',
    name: 'line-clamp-2 text-[20px] font-bold leading-tight',
    empty: 'board-num text-[34px] text-white/20',
    dots: 'text-[18px]',
  },
}

/** Zonas con los equipos visibles. `fresh` = equipo recién ubicado (destello). */
export function ZonesGrid({ state, view, teamById, fresh, variant = 'page', className = '' }) {
  const { t } = useI18n()
  const z = ZONE[variant]
  const max = state.rules?.max_foreign
  return (
    <div className={`${z.grid} ${className}`}>
      {state.groups.map((g) => (
        <div key={g} className={z.card}>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/45" style={variant !== 'page' ? { fontSize: variant === 'final' ? 16 : 13 } : undefined}>
                {t('common.zone')}
              </span>
              <span className={z.head}>{g}</span>
            </span>
            <ForeignDots n={view.foreignIn[g] || 0} max={max} className={z.dots} />
          </div>
          <div className={z.cells}>
            {Array.from({ length: state.group_size }, (_, i) => i + 1).map((pos) => {
              const team = view.slots[g][pos] ? teamById.get(view.slots[g][pos]) : null
              return (
                <div key={pos} className={`${z.cell} ring-1 ${team ? 'bg-white/5 ring-white/10' : 'ring-white/5'} ${team && fresh === team.id ? 'draw-fresh' : ''}`}>
                  {team ? (
                    <>
                      <Crest team={team} size="fluid" className={z.crest} />
                      <span className={`min-w-0 ${z.name}`}>
                        {team.name}
                        {team.foreign && <span className="ml-1">{flag(team.country_code)}</span>}
                      </span>
                    </>
                  ) : (
                    <span className={`${z.empty} ${variant === 'final' ? '' : 'pl-1'}`}>{g}{pos}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Revelación de un equipo. `center`: a pantalla completa (tablero). `lower`: zócalo sobre la cámara.
 * Secuencia: escudo → nombre → bolilla → (regla de salto) → zona y posición.
 */
export function Reveal({ pick, team, teamById, variant = 'center' }) {
  const { t } = useI18n()
  const ms = revealMs(pick)
  const jump = jumpReason(pick, t, teamById)
  const tBall = 1.4
  const tJump = 2.3
  const tDest = pick.jump ? 3.5 : pick.ball ? 2.2 : 1.5
  const dest = (
    <>
      <span className="text-white/60">{t('draw.to')} </span>
      <span className="gold-text">{t('common.zone_x', { g: pick.group })} · {t('draw.position', { n: pick.position })}</span>
    </>
  )

  if (variant === 'lower') {
    return (
      <div className="lower-in absolute bottom-[64px] left-[64px] flex max-w-[1500px] items-center gap-[28px] rounded-[28px] bg-night/90 py-[22px] pl-[22px] pr-[44px] shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10" style={{ '--reveal-ms': `${ms}ms` }}>
        <div className="draw-reveal-crest relative grid h-[170px] w-[170px] shrink-0 place-items-center">
          <div className="draw-ring" aria-hidden="true" />
          <div className="absolute inset-[7%] rounded-full bg-indigo-800" />
          <Crest team={team} size="fluid" className="relative h-[120px] w-[120px] text-3xl" />
        </div>
        <div className="min-w-0">
          <div className="draw-reveal-name text-[64px] font-extrabold leading-none tracking-tight">
            {team?.name} {team?.country_code && <span className="text-[0.7em]">{flag(team.country_code)}</span>}
          </div>
          <div className="mt-[14px] flex flex-wrap items-center gap-x-[22px] gap-y-[8px] text-[34px] font-extrabold uppercase tracking-[0.08em]">
            {pick.ball && (
              <span className="draw-step flex items-center gap-[12px]" style={{ animationDelay: `${tBall}s` }}>
                <span className="text-white/60">{t('draw.ball')}</span>
                <span className="draw-ball" style={{ width: 54, height: 54, fontSize: pick.ball.length > 1 ? 24 : 32 }}>{pick.ball}</span>
              </span>
            )}
            {jump && (
              <span className="draw-jump rounded-full bg-live/25 px-[18px] py-[6px] text-[24px] text-[#ffb3c4]" style={{ animationDelay: `${tJump}s` }}>
                ↷ {t('draw.jump_rule')}: {jump}
              </span>
            )}
            <span className="draw-step" style={{ animationDelay: `${tDest}s` }}>{dest}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="draw-reveal-bg absolute inset-0 z-20 grid place-items-center bg-night/85 text-center backdrop-blur-sm" style={{ '--reveal-ms': `${ms}ms` }}>
      <div>
        <div className="draw-reveal-crest relative mx-auto grid h-[34vh] w-[34vh] place-items-center">
          <div className="draw-ring" aria-hidden="true" />
          <div className="absolute inset-[6%] rounded-full bg-indigo-800/90 shadow-[0_0_80px_rgba(255,192,0,0.35)]" />
          <Crest team={team} size="fluid" className="relative h-[24vh] w-[24vh] text-4xl" />
        </div>
        <p className="draw-reveal-name mt-[3vh] text-[clamp(28px,7vh,96px)] font-extrabold leading-none tracking-tight">
          {team?.name}
          {team?.country_code && <span className="ml-3 text-[0.7em]">{flag(team.country_code)}</span>}
        </p>
        {pick.ball && (
          <p className="draw-step mt-[2.2vh] flex items-center justify-center gap-[1.2vh] text-[clamp(16px,3.4vh,44px)] font-extrabold uppercase tracking-[0.12em]" style={{ animationDelay: `${tBall}s` }}>
            <span className="text-white/60">{t('draw.ball')}</span>
            <span className="draw-ball" style={{ width: '6vh', height: '6vh', fontSize: pick.ball.length > 1 ? '2.6vh' : '3.6vh' }}>{pick.ball}</span>
          </p>
        )}
        {jump && (
          <p className="draw-jump mx-auto mt-[2vh] w-fit rounded-full bg-live/25 px-[2.4vh] py-[0.8vh] text-[clamp(14px,2.6vh,34px)] font-extrabold text-[#ffb3c4]" style={{ animationDelay: `${tJump}s` }}>
            ↷ {t('draw.jump_rule')}: {jump}
          </p>
        )}
        <p className="draw-step mt-[2.2vh] text-[clamp(18px,4vh,56px)] font-extrabold uppercase tracking-[0.12em]" style={{ animationDelay: `${tDest}s` }}>
          {dest}
        </p>
      </div>
    </div>
  )
}
