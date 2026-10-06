import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useSearchParams } from 'react-router-dom'
import { I18nProvider, useI18n } from '../i18n/I18nProvider.jsx'
import { DEMO_PREFIX, IS_DEMO } from '../lib/mode.js'
import { flag } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { Sponsors } from '../components/Sponsors.jsx'
import DrawStage from '../draw/DrawStage.jsx'
import { useDrawFeed } from '../draw/useDrawFeed.js'
import { tandaLabel, visibleView } from '../draw/drawView.js'
import { BallsRow, Reveal, ZonesGrid } from '../draw/DrawBoard.jsx'

/*
 * Escenas de la transmisión del sorteo para OBS ("Fuente de navegador" de 1920×1080).
 * Cada escena es un escenario fijo de 1920×1080 en px que se escala a la ventana (en OBS queda 1:1;
 * en un navegador común se ve entera para revisarla). Las transparentes van encima de la cámara.
 * Las arma solas copa-proud-web/obs/setup-obs.mjs. En español siempre (?lang=pt|en para otra).
 *
 * Ventana de la cámara en "Cámara + Tablero": tiene que coincidir con SPLIT_WINDOW de setup-obs.mjs.
 */
export const SPLIT_WINDOW = { x: 64, y: 208, w: 896, h: 504 }
// Ventana VERTICAL del conductor en "Equipos" (/obs/equipos?camara=1) = EQUIPOS_WINDOW de setup-obs.mjs.
export const EQUIPOS_WINDOW = { x: 64, y: 196, w: 540, h: 820 }
// Ventana 9:16 del video de la canción oficial (un Short) = CANCION_WINDOW de setup-obs.mjs.
export const CANCION_WINDOW = { x: 707, y: 90, w: 506, h: 900 }

const SCENES = [
  ['espera', 'Espera', 'Cuenta regresiva hasta el inicio, con los 28 escudos pasando.', false],
  ['reglas', 'Reglamento', 'Cómo es el sorteo: tandas, cupo de extranjeros, parejas y regla de salto.', false],
  ['equipos?camara=1', 'Equipos', 'Los 28 equipos, tanda por tanda, con el conductor de pie a la izquierda (ventana para la cámara).', true],
  ['overlay', 'Overlay sorteo', 'Va ENCIMA de la cámara: marca, EN VIVO, tanda y bolillas; revela cada equipo con un zócalo.', true],
  ['zocalo?nombre=Nombre%20Apellido&rol=Conducci%C3%B3n', 'Zócalo conductor', 'Va ENCIMA de la cámara. Cambiá nombre y rol en el link.', true],
  ['split', 'Cámara + Tablero', 'Ventana transparente a la izquierda para la cámara; zonas a la derecha.', true],
  ['tablero', 'Tablero', 'Las 7 zonas a pantalla completa, con la revelación en el centro.', false],
  ['pausa', 'Pausa', 'Volvemos enseguida.', false],
  ['cancion', 'Canción oficial', 'Fondo con una ventana vertical para el video de la canción (fuente multimedia debajo).', true],
  ['cierre', 'Cierre', 'Así quedaron las zonas + dónde seguir el torneo.', false],
]

export default function ObsApp() {
  const [params] = useSearchParams()
  return (
    <I18nProvider forceLang={params.get('lang') || 'es'}>
      <Routes>
        <Route index element={<ObsIndex />} />
        <Route path="espera" element={<Waiting />} />
        <Route path="reglas" element={<Rules />} />
        <Route path="equipos" element={<TeamsScene />} />
        <Route path="overlay" element={<CameraOverlay />} />
        <Route path="zocalo" element={<LowerThird />} />
        <Route path="split" element={<Split />} />
        <Route path="tablero" element={<Board />} />
        <Route path="pausa" element={<Pause />} />
        <Route path="cancion" element={<Song />} />
        <Route path="cierre" element={<Closing />} />
        <Route path="*" element={<ObsIndex />} />
      </Routes>
    </I18nProvider>
  )
}

// ------------------------------------------------------------------ base

function useScale() {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
  useEffect(() => {
    const onResize = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

/** Escenario 1920×1080. `transparent`: sin fondo (va sobre la cámara). */
function Stage({ transparent = false, children }) {
  const scale = useScale()
  useEffect(() => {
    if (!transparent) return
    document.documentElement.classList.add('obs-transparent')
    return () => document.documentElement.classList.remove('obs-transparent')
  }, [transparent])
  return (
    <div className="fixed inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {!transparent && <BrandBg />}
        {children}
        {IS_DEMO && (
          <div className="absolute right-[16px] top-[12px] z-50 rounded-[6px] bg-gold px-[10px] py-[2px] text-[15px] font-extrabold tracking-[0.2em] text-night">
            ENSAYO
          </div>
        )}
      </div>
    </div>
  )
}

function BrandBg() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 60% at 50% -10%, rgba(54,7,119,0.95), transparent 65%), radial-gradient(60% 50% at 100% 100%, rgba(54,7,119,0.55), transparent 70%), linear-gradient(180deg, #120236, #04011e 75%)',
        }}
      />
      <div className="rainbow-strip absolute inset-x-0 bottom-0 !h-[8px]" />
    </div>
  )
}

/**
 * Fondo de marca con una ventana transparente (ahí se ve la cámara, que en OBS va DEBAJO de esta
 * página) y un marco arcoíris alrededor. Fuera de OBS se marca dónde va la cámara.
 */
function CameraHole({ win, label = 'Cámara' }) {
  const mask = `linear-gradient(#000 0 0) ${win.x}px ${win.y}px / ${win.w}px ${win.h}px no-repeat, linear-gradient(#000 0 0)`
  return (
    <>
      <div className="absolute inset-0" style={{ WebkitMask: mask, WebkitMaskComposite: 'xor', mask, maskComposite: 'exclude' }}>
        <BrandBg />
      </div>
      <div
        className="absolute rounded-[18px]"
        style={{ left: win.x - 6, top: win.y - 6, width: win.w + 12, height: win.h + 12, padding: 6, background: 'linear-gradient(90deg, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787)', WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude' }}
      />
      {!window.obsstudio && (
        <div className="absolute grid place-items-center text-[26px] font-extrabold uppercase tracking-[0.25em] text-white/40" style={{ left: win.x, top: win.y, width: win.w, height: win.h, background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 20px, transparent 20px 40px)' }}>
          {label}
        </div>
      )}
    </>
  )
}

function useFeed(opts) {
  const feed = useDrawFeed(opts)
  const teamById = useMemo(() => new Map((feed.state?.teams || []).map((t) => [t.id, t])), [feed.state])
  return { ...feed, teamById }
}

function Title({ kicker, children, className = '' }) {
  return (
    <div className={className}>
      {kicker && <div className="mb-[8px] text-[22px] font-extrabold uppercase tracking-[0.3em] text-gold-light">{kicker}</div>}
      <div className="text-[64px] font-extrabold leading-none tracking-tight">{children}</div>
    </div>
  )
}

function Header({ state, view }) {
  const { t } = useI18n()
  const live = state?.status === 'LIVE'
  return (
    <div className="absolute inset-x-[64px] top-[44px] flex items-center gap-[24px]">
      <img src="/brand/mark.webp" alt="" className="h-[110px] w-[110px] object-contain" />
      <div>
        <div className="whitespace-nowrap text-[44px] font-extrabold leading-none tracking-tight">{t('draw.official')}</div>
        <div className="mt-[8px] whitespace-nowrap text-[18px] font-bold tracking-[0.3em] text-white/60">COPA PROUD SUDAMERICANA 2026</div>
      </div>
      <div className="ml-auto flex items-center gap-[20px]">
        {live && view?.tanda && (
          <span className="whitespace-nowrap rounded-full bg-white/10 px-[20px] py-[10px] text-[22px] font-extrabold uppercase tracking-wider ring-1 ring-white/15">
            <span className="text-gold">{t('draw.tanda', { n: view.tanda.n })}</span> · {tandaLabel(view.tanda, t, state.has_official_procedure)}
          </span>
        )}
        {live && (
          <span className="inline-flex items-center gap-[12px] whitespace-nowrap rounded-full bg-live/25 px-[20px] py-[10px] text-[22px] font-extrabold uppercase tracking-widest text-[#ff8aa5]">
            <span className="live-dot" aria-hidden="true" /> {t('status.LIVE')}
          </span>
        )}
        {state && view && (
          <span className="board-num whitespace-nowrap text-[72px] leading-none text-gold">
            {view.placed}<span className="text-white/30">/{state.teams.length || 28}</span>
          </span>
        )}
      </div>
    </div>
  )
}

const pad = (n) => String(n).padStart(2, '0')

// ------------------------------------------------------------------ 1 · Espera

function Waiting() {
  const { t, locale } = useI18n()
  const { state, teamById } = useFeed({ animate: false, slowMs: 20000 })
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const startsAt = state?.broadcast?.starts_at
  const startMs = Date.parse(startsAt || '')
  const left = Math.max(0, Math.floor((startMs - now) / 1000))
  const d = Math.floor(left / 86400)
  const clock = `${d ? `${d}d ` : ''}${pad(Math.floor((left % 86400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`
  // Fecha en hora de Argentina (−03:00), como dice el reglamento.
  const venue = startMs ? new Date(startMs - 3 * 3600_000) : null
  const when = venue
    ? `${new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(venue)} · ${pad(venue.getUTCHours())}:${pad(venue.getUTCMinutes())} hs (ARG)`
    : ''
  const teams = state?.teams || []

  return (
    <Stage>
      <img src="/brand/logo-dark-bg.webp" alt="" className="absolute left-[120px] top-[110px] h-[680px] w-auto object-contain drop-shadow-[0_30px_70px_rgba(54,7,119,0.95)]" />
      <div className="absolute left-[860px] right-[100px] top-[190px]">
        <div className="text-[26px] font-extrabold uppercase tracking-[0.35em] text-gold-light">{t('draw.official')}</div>
        <div className="mt-[18px] text-[64px] font-extrabold leading-none tracking-tight">{left > 0 ? t('draw.starts_in') : '¡Arrancamos!'}</div>
        {startMs > 0 && left > 0 && (
          <div className={`board-num mt-[18px] whitespace-nowrap leading-[0.9] text-gold [text-shadow:0_0_60px_rgba(255,192,0,0.35)] ${d ? 'text-[170px]' : 'text-[230px]'}`}>{clock}</div>
        )}
        <div className="mt-[22px] text-[40px] font-bold text-white/85 first-letter:uppercase">{when}</div>
        <div className="mt-[10px] font-script text-[56px] text-gold">Competí con pasión</div>
        <Sponsors height={60} gap={56} align="start" className="mt-[34px]" labelClassName="text-[18px] tracking-[0.3em]" />
      </div>
      {teams.length > 0 && (
        <div className="absolute inset-x-0 bottom-[60px] overflow-hidden border-y border-white/10 bg-night/50 py-[22px]">
          <div className="marquee flex w-max gap-[56px] pl-[56px]">
            {[...teams, ...teams].map((tm, i) => (
              <div key={`${tm.id}-${i}`} className="flex items-center gap-[16px]">
                <Crest team={teamById.get(tm.id)} size="fluid" className="h-[84px] w-[84px] text-xl" />
                <span className="whitespace-nowrap text-[28px] font-bold">{tm.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="absolute bottom-[16px] right-[64px] text-[22px] font-bold tracking-[0.15em] text-white/60">live.copaproud.com</div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 2 · Reglamento

function Rules() {
  const { t } = useI18n()
  const { state, teamById } = useFeed({ animate: false, slowMs: 20000 })
  if (!state) return <Stage />
  const tandas = state.mode === 'TANDAS' ? state.tandas || [] : []
  const pairs = (state.rules?.pairs || []).map(([a, b]) => `${teamById.get(a)?.name ?? '?'} / ${teamById.get(b)?.name ?? '?'}`)
  const rules = [
    ['🎱', 'Doble bombo por tanda', 'De un bombo sale el equipo y del otro la bolilla de la zona.'],
    state.rules?.max_foreign && ['🌎', `Máximo ${state.rules.max_foreign} extranjeros por zona`, 'Brasil, Uruguay, Paraguay, Colombia, Chile y Venezuela.'],
    pairs.length && ['🤝', 'Mismo club, zonas distintas', pairs.join(' · ')],
    ['↷', 'Regla de salto', 'Si la zona que sale no se puede usar, el equipo pasa a la siguiente: A → B … G → A.'],
  ].filter(Boolean)
  return (
    <Stage>
      <Title kicker="Reglamento oficial" className="absolute left-[80px] top-[64px]">Así es el sorteo</Title>
      <Sponsors height={48} gap={44} align="end" className="absolute right-[80px] top-[70px]" labelClassName="text-[18px] tracking-[0.3em]" />
      <div className="absolute left-[80px] top-[230px] flex w-[1060px] flex-col gap-[16px]">
        {tandas.map((td) => (
          <div key={td.n} className="card flex items-center gap-[24px] px-[24px] py-[16px]">
            <span className="board-num w-[150px] shrink-0 text-[48px] leading-none text-gold">{t('draw.tanda', { n: td.n })}</span>
            <span className="w-[330px] shrink-0">
              <span className="block text-[30px] font-extrabold leading-tight">{tandaLabel(td, t, state.has_official_procedure)}</span>
              <span className="text-[19px] font-bold text-white/55">
                {td.team_ids.length} equipos · {td.ball === 'SLOT' ? 'bolillas de casilleros libres' : 'bolillas de zona A–G'}
              </span>
            </span>
            <span className="flex flex-wrap gap-[8px]">
              {td.team_ids.map((id) => (
                <Crest key={id} team={teamById.get(id)} size="fluid" className="h-[52px] w-[52px]" />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="absolute right-[80px] top-[230px] flex w-[620px] flex-col gap-[18px]">
        {rules.map(([icon, title, text]) => (
          <div key={title} className="card flex gap-[20px] p-[24px]">
            <span className="text-[44px] leading-none">{icon}</span>
            <span>
              <span className="block text-[30px] font-extrabold leading-tight text-gold-light">{title}</span>
              <span className="mt-[6px] block text-[22px] leading-snug text-white/80">{text}</span>
            </span>
          </div>
        ))}
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 3 · Equipos

function TeamsScene() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const withCamera = params.get('camara') === '1'
  const { state, teamById } = useFeed({ animate: false, slowMs: 20000 })
  if (!state) return <Stage transparent={withCamera} />
  const columns =
    state.mode === 'TANDAS' && state.tandas?.length
      ? state.tandas.map((td) => ({ key: td.n, title: t('draw.tanda', { n: td.n }), sub: tandaLabel(td, t, state.has_official_procedure), ids: td.team_ids }))
      : [{ key: 'all', title: 'Equipos', sub: '', ids: state.teams.map((x) => x.id) }]
  const w = EQUIPOS_WINDOW
  // Con cámara: el conductor de pie a la izquierda y las tandas en lo que queda a la derecha.
  const grid = withCamera
    ? { left: w.x + w.w + 40, right: 64, top: w.y, gap: 12, pad: 14, crest: 'h-[46px] w-[46px]', name: 'line-clamp-2 text-[18px] leading-[1.1]', title: 'text-[38px]', sub: 'text-[17px]', row: 10 }
    : { left: 80, right: 80, top: 220, gap: 20, pad: 18, crest: 'h-[52px] w-[52px]', name: 'truncate text-[22px]', title: 'text-[44px]', sub: 'text-[22px]', row: 10 }
  return (
    <Stage transparent={withCamera}>
      {withCamera && <CameraHole win={w} />}
      <Title kicker={t('draw.official')} className={`absolute top-[56px] ${withCamera ? 'left-[64px]' : 'left-[80px]'}`}>
        Los {state.teams.length} equipos
      </Title>
      <Sponsors height={48} gap={44} align="end" className="absolute right-[64px] top-[62px]" labelClassName="text-[18px] tracking-[0.3em]" />
      <div
        className="absolute grid"
        style={{ left: grid.left, right: grid.right, top: grid.top, height: withCamera ? w.h : undefined, gap: grid.gap, gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => (
          <div key={col.key} className="card" style={{ padding: grid.pad }}>
            <div className={`board-num leading-none text-gold ${grid.title}`}>{col.title}</div>
            <div className={`mb-[14px] mt-[4px] font-extrabold leading-tight ${grid.sub}`}>{col.sub}</div>
            <div className="flex flex-col" style={{ gap: grid.row }}>
              {col.ids.map((id) => {
                const tm = teamById.get(id)
                return (
                  <div key={id} className="flex items-center gap-[10px]">
                    <Crest team={tm} size="fluid" className={grid.crest} />
                    <span className={`min-w-0 font-bold ${grid.name}`}>
                      {tm?.name} {tm?.country_code && <span className="text-[0.9em]">{flag(tm.country_code)}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 4 · Overlay sobre cámara

function CameraOverlay() {
  const { t } = useI18n()
  const { state, shownSeq, revealing, teamById, done } = useFeed()
  if (!state) return <Stage transparent />
  const view = visibleView(state, shownSeq, revealing?.seq)
  const live = state.status === 'LIVE'
  return (
    <Stage transparent>
      {/* Marca */}
      <div className="absolute left-[48px] top-[40px] flex items-center gap-[18px] rounded-[24px] bg-night/80 py-[14px] pl-[14px] pr-[28px] ring-1 ring-white/10 backdrop-blur">
        <img src="/brand/mark.webp" alt="" className="h-[84px] w-[84px] object-contain" />
        <div>
          <div className="text-[30px] font-extrabold leading-none">{t('draw.official')}</div>
          <div className="mt-[6px] text-[16px] font-bold tracking-[0.28em] text-white/60">COPA PROUD SUDAMERICANA 2026</div>
        </div>
        {live && (
          <span className="ml-[10px] inline-flex items-center gap-[10px] rounded-full bg-live px-[16px] py-[6px] text-[20px] font-extrabold uppercase tracking-widest">
            <span className="live-dot !bg-white" aria-hidden="true" /> {t('status.LIVE')}
          </span>
        )}
      </div>
      {/* Tanda + bolillas + contador */}
      {(live || view.placed > 0) && (
        <div className="absolute right-[48px] top-[40px] flex flex-col items-end gap-[12px]">
          <div className="flex items-center gap-[16px] rounded-[24px] bg-night/80 px-[24px] py-[12px] ring-1 ring-white/10 backdrop-blur">
            {view.tanda && live && (
              <span className="text-[26px] font-extrabold uppercase tracking-wider">
                <span className="text-gold">{t('draw.tanda', { n: view.tanda.n })}</span> · {tandaLabel(view.tanda, t, state.has_official_procedure)}
              </span>
            )}
            <span className="board-num text-[56px] leading-none text-gold">
              {view.placed}<span className="text-white/30">/{state.teams.length}</span>
            </span>
          </div>
          {view.tanda && live && !revealing && (
            <div className="rounded-[24px] bg-night/80 px-[18px] py-[14px] ring-1 ring-white/10 backdrop-blur">
              <BallsRow state={state} view={view} size={50} className="max-w-[640px] justify-end" />
            </div>
          )}
        </div>
      )}
      <div className="absolute bottom-[48px] right-[48px] w-[300px] rounded-[20px] bg-night/80 px-[20px] py-[16px] ring-1 ring-white/10 backdrop-blur">
        <Sponsors height={30} gap={14} stack labelClassName="text-[13px] tracking-[0.25em]" />
      </div>
      {revealing && <Reveal key={revealing.seq} pick={revealing} team={teamById.get(revealing.team_id)} teamById={teamById} variant="lower" />}
      {done && (
        <div className="draw-done absolute bottom-[64px] left-1/2 -translate-x-1/2 rounded-full bg-gold px-[40px] py-[14px] text-[40px] font-extrabold text-night shadow-2xl">
          {t('draw.done')}
        </div>
      )}
    </Stage>
  )
}

// ------------------------------------------------------------------ 5 · Zócalo del conductor

function LowerThird() {
  const [params] = useSearchParams()
  const name = params.get('nombre') || 'Conducción'
  const role = params.get('rol') || 'Copa Proud Sudamericana 2026'
  return (
    <Stage transparent>
      <div className="lower-stay absolute bottom-[90px] left-[64px] flex items-stretch overflow-hidden rounded-[22px] bg-night/90 shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
        <div className="w-[12px]" style={{ background: 'linear-gradient(180deg, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787)' }} />
        <img src="/brand/mark.webp" alt="" className="m-[18px] h-[110px] w-[110px] object-contain" />
        <div className="flex flex-col justify-center py-[18px] pr-[48px]">
          <div className="text-[60px] font-extrabold leading-none tracking-tight">{name}</div>
          <div className="mt-[10px] text-[28px] font-bold uppercase tracking-[0.2em] text-gold">{role}</div>
        </div>
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 6 · Cámara + tablero

function Split() {
  const { t } = useI18n()
  const { state, shownSeq, revealing, lastShown, teamById } = useFeed()
  const w = SPLIT_WINDOW
  const view = state ? visibleView(state, shownSeq, revealing?.seq) : null
  return (
    <Stage transparent>
      <CameraHole win={w} />
      {state && view && (
        <>
          <Header state={state} view={view} />
          {/* Debajo de la cámara: bombo de la tanda en curso */}
          <div className="absolute flex flex-col gap-[14px]" style={{ left: w.x, top: w.y + w.h + 28, width: w.w }}>
            {view.tanda && state.status === 'LIVE' && (
              <>
                <div className="flex flex-wrap gap-[10px]">
                  {view.tandaTeams.map((tm) => (
                    <span key={tm.id} className="flex items-center gap-[8px] rounded-full bg-white/5 py-[4px] pl-[4px] pr-[14px] ring-1 ring-white/10">
                      <Crest team={tm} size="fluid" className="h-[38px] w-[38px]" />
                      <span className="text-[18px] font-bold">{tm.name}</span>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-[16px]">
                  <span className="text-[18px] font-extrabold uppercase tracking-[0.2em] text-gold-light">
                    {view.tanda.ball === 'SLOT' ? t('draw.slots_left') : t('draw.balls_left')}
                  </span>
                  <BallsRow state={state} view={view} size={44} />
                </div>
              </>
            )}
          </div>
          <div className="absolute" style={{ left: 1000, top: w.y, width: 856 }}>
            <ZonesGrid state={state} view={view} teamById={teamById} fresh={lastShown?.team_id} variant="split">
              <div className="card grid place-items-center p-[14px]">
                <Sponsors height={24} gap={22} stack labelClassName="text-[12px] tracking-[0.2em]" />
              </div>
            </ZonesGrid>
          </div>
          {revealing && <Reveal key={revealing.seq} pick={revealing} team={teamById.get(revealing.team_id)} teamById={teamById} variant="lower" />}
        </>
      )}
    </Stage>
  )
}

// ------------------------------------------------------------------ 7 · Tablero

function Board() {
  // El tablero escala con la ventana por su cuenta (vh/vw): en OBS a 1920×1080 queda igual.
  return (
    <>
      <DrawStage forceTv embedded />
      {IS_DEMO && (
        <div className="fixed bottom-[1vh] right-[0.8vw] z-50 rounded bg-gold px-[0.6vw] text-[1.4vh] font-extrabold tracking-[0.2em] text-night">ENSAYO</div>
      )}
    </>
  )
}

// ------------------------------------------------------------------ 8 · Pausa

function Pause() {
  const { state, shownSeq } = useFeed({ animate: false })
  const view = state ? visibleView(state, shownSeq) : null
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <img src="/brand/logo-dark-bg.webp" alt="" className="mx-auto h-[520px] w-auto object-contain drop-shadow-[0_30px_70px_rgba(54,7,119,0.95)]" />
          <div className="mt-[30px] text-[96px] font-extrabold leading-none tracking-tight">Volvemos enseguida</div>
          {view && state.picks.length > 0 && (
            <div className="mt-[20px] text-[34px] font-bold text-white/70">
              Ya hay <span className="text-gold">{view.placed}</span> de {state.teams.length} equipos sorteados
            </div>
          )}
          <Sponsors height={56} gap={56} className="mt-[48px]" labelClassName="text-[18px] tracking-[0.3em]" />
        </div>
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 10 · Canción oficial

function Song() {
  return (
    <Stage transparent>
      <CameraHole win={CANCION_WINDOW} label="Video" />
      <div className="absolute left-[80px] top-[300px] w-[560px]">
        <img src="/brand/mark.webp" alt="" className="h-[170px] w-[170px] object-contain drop-shadow-[0_20px_50px_rgba(54,7,119,0.95)]" />
        <div className="mt-[28px] whitespace-nowrap text-[20px] font-extrabold uppercase tracking-[0.22em] text-gold-light">Copa Proud Sudamericana 2026</div>
        <div className="mt-[14px] text-[84px] font-extrabold leading-[0.95] tracking-tight">La canción oficial</div>
        <div className="mt-[18px] font-script text-[52px] text-gold">Competí con pasión</div>
      </div>
      <div className="absolute right-[90px] top-[380px] w-[520px]">
        <Sponsors height={70} gap={48} stack labelClassName="text-[18px] tracking-[0.3em]" />
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ 9 · Cierre

function Closing() {
  const { t } = useI18n()
  const { state, shownSeq, teamById } = useFeed({ animate: false })
  const view = state ? visibleView(state, shownSeq) : null
  return (
    <Stage>
      <Title kicker={t('draw.official')} className="absolute left-[64px] top-[48px]">
        {t('draw.board_done')}
      </Title>
      <img src="/brand/mark.webp" alt="" className="absolute right-[64px] top-[36px] h-[120px] w-[120px] object-contain" />
      <Sponsors height={44} gap={40} align="end" className="absolute right-[220px] top-[58px]" labelClassName="text-[18px] tracking-[0.3em]" />
      {state && view && (
        <div className="absolute inset-x-[64px] top-[200px]">
          <ZonesGrid state={state} view={view} teamById={teamById} variant="final" />
        </div>
      )}
      <div className="absolute inset-x-[64px] bottom-[34px] flex items-center justify-between text-[30px] font-bold">
        <span>
          Nos vemos el <span className="text-gold">sábado 10 y domingo 11 de octubre</span>
        </span>
        <span className="text-white/75">Fixture y resultados en vivo: <span className="text-gold">live.copaproud.com</span></span>
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------ índice (para la producción)

function ObsIndex() {
  const base = `${window.location.origin}${IS_DEMO ? DEMO_PREFIX : ''}/obs`
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="kicker mb-1">Producción · OBS {IS_DEMO && '· ENSAYO (demo)'}</div>
      <h1 className="text-3xl font-extrabold">Escenas de la transmisión</h1>
      <p className="mt-2 max-w-3xl text-sm text-white/70">
        Cada escena es una <b>Fuente de navegador</b> de 1920×1080 en OBS. Las marcadas como <b>transparente</b> van encima de la cámara. El script{' '}
        <code className="rounded bg-white/10 px-1">copa-proud-web/obs/setup-obs.mjs</code> las crea solas.
      </p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SCENES.map(([path, name, desc, transparent], i) => (
          <div key={path} className="card overflow-hidden">
            <div className="relative aspect-video overflow-hidden" style={transparent ? { background: 'repeating-conic-gradient(#2a2440 0 25%, #1a1530 0 50%) 0 0 / 24px 24px' } : undefined}>
              <iframe title={name} src={`${base}/${path}`} loading="lazy" className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: 'scale(var(--s))', '--s': 0.19 }} />
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2">
                <span className="board-num text-xl text-gold">{i + 1}</span>
                <span className="font-extrabold">{name}</span>
                {transparent && <span className="rounded bg-white/10 px-1.5 text-[10px] font-bold uppercase">transparente</span>}
              </div>
              <p className="mt-1 text-xs text-white/60">{desc}</p>
              <Link to={`/obs/${path}`} target="_blank" className="mt-2 block truncate text-xs font-bold text-gold-light hover:underline">
                {base}/{path}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
