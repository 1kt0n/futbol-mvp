import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { flag } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { fetchDrawState } from './drawApi.js'

const REVEAL_MS = 4200 // escudo → nombre → destino → vuelo al lugar

/**
 * Pantalla de transmisión del sorteo (/sorteo). Pensada para capturarla con OBS (?tv=1 oculta el
 * cursor y fija 16:9) y también para seguirla desde el celular. Cada equipo que sale se revela en
 * el centro y después aparece en su lugar; si salen varios seguidos, se revelan en fila.
 */
export default function DrawStage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const tv = params.get('tv') === '1'
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [revealing, setRevealing] = useState(null) // pick en revelación
  const [shownSeq, setShownSeq] = useState(null) // hasta qué pick ya se mostró en las zonas
  const queue = useRef([])
  const lastSeq = useRef(null)

  // Polling: 1 s con el sorteo en vivo, 5 s si no.
  useEffect(() => {
    let alive = true
    let timer
    const tick = async () => {
      try {
        const s = await fetchDrawState()
        if (!alive) return
        setState(s)
        setError(null)
        const maxSeq = s.picks.length ? s.picks[s.picks.length - 1].seq : 0
        if (lastSeq.current === null) {
          lastSeq.current = maxSeq // al abrir la pantalla no se re-animan los que ya salieron
          setShownSeq(maxSeq)
        } else if (maxSeq > lastSeq.current) {
          queue.current.push(...s.picks.filter((p) => p.seq > lastSeq.current))
          lastSeq.current = maxSeq
        } else if (maxSeq < lastSeq.current) {
          // deshacer / reinicio: sin animación
          queue.current = queue.current.filter((p) => p.seq <= maxSeq)
          lastSeq.current = maxSeq
          setShownSeq(maxSeq)
        }
        timer = setTimeout(tick, s.status === 'LIVE' ? 1000 : 5000)
      } catch (e) {
        if (!alive) return
        setError(e.status === 404 ? 'not_found' : 'error')
        timer = setTimeout(tick, 3000)
      }
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  // Cola de revelaciones: de a una.
  useEffect(() => {
    if (revealing) return
    const id = setInterval(() => {
      if (!queue.current.length) return
      const next = queue.current.shift()
      setRevealing(next)
      setTimeout(() => {
        setRevealing(null)
        setShownSeq((s) => Math.max(s ?? 0, next.seq))
      }, REVEAL_MS)
    }, 150)
    return () => clearInterval(id)
  }, [revealing])

  const teamById = useMemo(() => new Map((state?.teams || []).map((tm) => [tm.id, tm])), [state])
  // Lo que se ve en las zonas: solo picks ya revelados (los que esperan su animación quedan ocultos).
  const hidden = useMemo(() => {
    const h = new Set()
    for (const p of state?.picks || []) if (shownSeq !== null && p.seq > shownSeq) h.add(p.team_id)
    return h
  }, [state, shownSeq])

  if (error === 'not_found') {
    return <Center>{t('common.not_published')}</Center>
  }
  if (!state) return <Center>{t('common.loading')}</Center>

  const placedVisible = state.placed - hidden.size
  const remaining = state.teams.filter((tm) => !isPlaced(state, tm.id) || hidden.has(tm.id))
  const eligible = new Set(state.eligible_team_ids)
  const lastShown = state.picks.filter((p) => shownSeq !== null && p.seq <= shownSeq).at(-1)
  const done = state.status === 'DONE' && !revealing && !queue.current.length

  return (
    <div className={`relative flex flex-col overflow-hidden ${tv ? 'h-dvh cursor-none' : 'min-h-dvh'}`}>
      <DemoBanner />
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-60" style={{ background: 'radial-gradient(60% 50% at 50% 0%, rgba(54,7,119,0.9), transparent 70%)' }} />

      {/* Encabezado */}
      <header className="relative z-10 flex items-center gap-4 px-[2.5vw] py-[1.6vh]">
        <img src="/brand/mark.webp" alt="" className="h-[clamp(40px,7vh,96px)] w-auto object-contain" />
        <div className="leading-none">
          <div className="text-[clamp(18px,3.2vh,44px)] font-extrabold tracking-tight">{t('draw.title')}</div>
          <div className="mt-1 text-[clamp(10px,1.5vh,20px)] font-bold tracking-[0.25em] text-white/60">COPA PROUD SUDAMERICANA 2026</div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {state.status === 'LIVE' && (
            <span className="inline-flex items-center gap-2 rounded-full bg-live/20 px-4 py-2 text-[clamp(12px,1.8vh,24px)] font-extrabold uppercase tracking-widest text-[#ff8aa5]">
              <span className="live-dot" aria-hidden="true" /> {t('status.LIVE')}
            </span>
          )}
          <span className="board-num text-[clamp(28px,5.5vh,72px)] leading-none text-gold">
            {placedVisible}<span className="text-white/30">/{state.teams.length || 28}</span>
          </span>
        </div>
      </header>
      <div className="rainbow-strip relative z-10" />

      <main className={`relative z-10 grid flex-1 gap-[1.6vw] p-[1.6vw] ${tv ? 'grid-cols-[22vw_1fr]' : 'grid-cols-1 lg:grid-cols-[22vw_1fr]'}`}>
        {/* Bolillero */}
        <section className="card flex flex-col p-[1vw]">
          <div className="kicker mb-[1vh] text-[clamp(10px,1.5vh,18px)]">
            {t('draw.pot')} · {remaining.length}
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-4 content-start gap-[0.6vw]">
            {remaining.map((tm) => (
              <div key={tm.id} className={`flex flex-col items-center gap-1 transition ${eligible.has(tm.id) || !state.eligible_team_ids.length ? '' : 'opacity-30 grayscale'}`} title={tm.name}>
                <Crest team={tm} size="fluid" className="h-[clamp(28px,5.5vh,72px)] w-[clamp(28px,5.5vh,72px)]" />
              </div>
            ))}
          </div>
        </section>

        {/* Zonas */}
        <section className={`grid gap-[0.8vw] ${tv ? 'grid-cols-7' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}`}>
          {state.groups.map((g) => (
            <div key={g} className="card flex flex-col p-[0.6vw]">
              <div className="mb-[1vh] flex items-baseline justify-center gap-2">
                <span className="text-[clamp(9px,1.3vh,16px)] font-bold uppercase tracking-[0.25em] text-white/50">{t('common.zone')}</span>
                <span className="board-num gold-text text-[clamp(28px,6vh,80px)] leading-none">{g}</span>
              </div>
              <div className="flex flex-1 flex-col gap-[0.8vh]">
                {Array.from({ length: state.group_size }, (_, i) => i + 1).map((pos) => {
                  const tid = state.slots[g]?.[String(pos)]
                  const visible = tid && !hidden.has(tid)
                  const team = visible ? teamById.get(tid) : null
                  const isNext = !revealing && state.status === 'LIVE' && state.next_slot?.group === g && state.next_slot?.position === pos && !hidden.size
                  const fresh = visible && lastShown?.team_id === tid
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
                          <span className="line-clamp-2 text-[clamp(10px,1.9vh,24px)] font-bold leading-tight">{team.name}</span>
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
        <Overlay>
          <img src="/brand/logo-dark-bg.webp" alt="" className="mx-auto h-[38vh] w-auto object-contain drop-shadow-[0_18px_40px_rgba(54,7,119,0.9)]" />
          <p className="mt-[3vh] text-[clamp(22px,4.5vh,60px)] font-extrabold">{t('draw.title')}</p>
          <p className="font-script text-[clamp(20px,4vh,52px)] text-gold">{t('draw.soon')}</p>
        </Overlay>
      )}

      {/* Revelación */}
      {revealing && <Reveal key={revealing.seq} pick={revealing} team={teamById.get(revealing.team_id)} />}

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

function isPlaced(state, teamId) {
  return Object.values(state.slots).some((pos) => Object.values(pos).includes(teamId))
}

function Reveal({ pick, team }) {
  const { t } = useI18n()
  return (
    <Overlay className="draw-reveal-bg">
      <div className="draw-reveal-crest relative mx-auto grid h-[34vh] w-[34vh] place-items-center">
        <div className="draw-ring" aria-hidden="true" />
        <div className="absolute inset-[6%] rounded-full bg-indigo-800/90 shadow-[0_0_80px_rgba(255,192,0,0.35)]" />
        <Crest team={team} size="fluid" className="relative h-[24vh] w-[24vh] text-4xl" />
      </div>
      <p className="draw-reveal-name mt-[3vh] text-[clamp(28px,7vh,96px)] font-extrabold leading-none tracking-tight">
        {team?.name}
        {team?.country_code && <span className="ml-3 text-[0.7em]">{flag(team.country_code)}</span>}
      </p>
      <p className="draw-reveal-dest mt-[2.5vh] text-[clamp(18px,4vh,56px)] font-extrabold uppercase tracking-[0.12em]">
        <span className="text-white/60">{t('draw.to')} </span>
        <span className="gold-text">{t('common.zone_x', { g: pick.group })} · {t('draw.position', { n: pick.position })}</span>
      </p>
    </Overlay>
  )
}

function Overlay({ children, className = '' }) {
  return (
    <div className={`absolute inset-0 z-20 grid place-items-center bg-night/85 text-center backdrop-blur-sm ${className}`}>
      <div>{children}</div>
    </div>
  )
}

function Center({ children }) {
  return <div className="grid min-h-dvh place-items-center px-6 text-center font-bold text-white/70">{children}</div>
}
