import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { LANGS } from '../i18n/messages.js'
import { localParts, matchLabel, offsetMinutes, sourceLabel } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { DemoBanner } from '../components/DemoBanner.jsx'
import { flushQueue, loadQueue, newId, saveQueue, staffFetch } from './queue.js'

const REFRESH_FAST_MS = 5_000
const REFRESH_SLOW_EVERY = 4 // 4 × 5 s = 20 s
const DUP_WINDOW_S = 90
const LIVE = new Set(['LIVE', 'HALFTIME'])

function errorText(t, code) {
  const known = ['MATCH_CONFIRMED', 'MATCH_NOT_ASSIGNED', 'TEAMS_NOT_DEFINED', 'PENALTIES_REQUIRED', 'INVALID_STAFF_TOKEN', 'MATCH_NOT_STARTED', 'EVENT_NOT_YOURS']
  if (known.includes(code)) return t(`veedor.err.${code}`)
  if (typeof code === 'string' && code.startsWith('INVALID_TRANSITION')) return t('veedor.err.INVALID_TRANSITION')
  return t('veedor.err.generic')
}

export default function VeedorApp() {
  const { token } = useParams()
  const { t, lang, setLang } = useI18n()
  const [me, setMe] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [queue, setQueue] = useState(() => loadQueue(token))
  const [notice, setNotice] = useState(null)
  const [openCode, setOpenCode] = useState(null)
  const flushing = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const res = await staffFetch(token, 'GET', '/me')
      if (res.status === 401) return setFatal('INVALID_STAFF_TOKEN')
      if (res.ok) {
        // Desfase entre el reloj del teléfono y el del server (para la antigüedad de los eventos).
        const skew = res.data.server_now ? Date.parse(res.data.server_now) - Date.now() : 0
        setMe({ ...res.data, skew })
        setFatal(null)
      }
    } catch {
      // sin red: seguimos mostrando lo último
    }
  }, [token])

  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    const current = loadQueue(token)
    const rest = await flushQueue(token, current, {
      onRejected: (action, detail) => setNotice({ kind: 'error', text: `${action.label}: ${errorText(t, detail)}` }),
    })
    saveQueue(token, rest)
    setQueue(rest)
    flushing.current = false
    if (rest.length < current.length) refresh()
  }, [token, refresh, t])

  const enqueue = useCallback(
    (action) => {
      const next = [...loadQueue(token), { id: newId(), createdAt: Date.now(), ...action }]
      saveQueue(token, next)
      setQueue(next)
      flush()
    },
    [token, flush],
  )

  const fastRef = useRef(false)
  useEffect(() => {
    const m = me?.matches.find((x) => x.code === openCode)
    fastRef.current = Boolean(m && LIVE.has(m.status))
  }, [me, openCode])

  useEffect(() => {
    refresh()
    flush()
    let tick = 0
    const id = setInterval(() => {
      tick += 1
      if (loadQueue(token).length) flush()
      else if (fastRef.current || tick % REFRESH_SLOW_EVERY === 0) refresh()
    }, REFRESH_FAST_MS)
    window.addEventListener('online', flush)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', flush)
    }
  }, [refresh, flush, token])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  if (fatal) {
    return (
      <Shell>
        <div className="card mt-10 p-6 text-center">
          <p className="text-lg font-bold">{errorText(t, fatal)}</p>
        </div>
      </Shell>
    )
  }
  if (!me) {
    return (
      <Shell>
        <p className="mt-16 text-center text-white/60">{t('common.loading')}</p>
      </Shell>
    )
  }

  const offset = offsetMinutes(me.competition.utc_offset)
  const matches = me.matches.map((m) => ({ ...m, local: localParts(m.scheduled_at, offset) })).sort((a, b) => (a.local?.ms ?? 0) - (b.local?.ms ?? 0))
  const open = matches.find((m) => m.code === openCode)

  return (
    <Shell
      right={
        <div className="flex rounded-full bg-white/5 p-0.5 ring-1 ring-white/10">
          {LANGS.map((l) => (
            <button key={l.code} type="button" onClick={() => setLang(l.code)} className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${lang === l.code ? 'bg-gold text-night' : 'text-white/60'}`}>
              {l.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4">
        <div className="kicker">{t('veedor.title')}</div>
        <div className="text-lg font-extrabold">{me.staff.full_name}</div>
        {me.staff.teams?.length > 0 && (
          <div className="mt-0.5 text-xs font-semibold text-white/60">
            {t('veedor.your_teams')}: <span className="text-gold-light">{me.staff.teams.join(' · ')}</span>
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <div role="status" className="mb-3 rounded-xl bg-gold/15 px-3 py-2 text-sm font-semibold text-gold-light">
          {t('veedor.pending', { n: queue.length })}
        </div>
      )}
      {notice && (
        <div role="alert" className="mb-3 rounded-xl bg-live/20 px-3 py-2 text-sm font-semibold text-[#ffb3c4]">
          {notice.text}
        </div>
      )}

      {open ? (
        <MatchControl match={open} queue={queue} enqueue={enqueue} skew={me.skew} onBack={() => setOpenCode(null)} />
      ) : (
        <MatchList matches={matches} onOpen={setOpenCode} />
      )}
    </Shell>
  )
}

function Shell({ children, right }) {
  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-32 pt-3">
      <div className="-mx-4 -mt-3 mb-3"><DemoBanner /></div>
      <header className="mb-4 flex items-center justify-between">
        <img src="/brand/mark.webp" alt="Copa Proud" className="h-10 w-10 object-contain" />
        {right}
      </header>
      <div className="rainbow-strip mb-4 rounded-full" />
      {children}
    </div>
  )
}

function MatchList({ matches, onOpen }) {
  const { t } = useI18n()
  if (!matches.length) return <p className="card p-5 text-center text-white/60">{t('veedor.no_matches')}</p>
  const nextIdx = matches.findIndex((m) => m.status !== 'FINISHED' && m.status !== 'WALKOVER')
  return (
    <ul className="space-y-2">
      {matches.map((m, i) => (
        <li key={m.code}>
          <button
            type="button"
            onClick={() => onOpen(m.code)}
            className={`card focus-ring flex w-full items-center gap-3 p-3 text-left ${LIVE.has(m.status) ? 'live-frame' : ''} ${i === nextIdx ? 'ring-1 ring-gold/60' : ''}`}
          >
            <span className="w-14 shrink-0 text-center">
              <span className="board-num block text-2xl leading-none text-gold">{m.local?.time}</span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-white/45">{t('common.court_n', { n: m.venue })}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="kicker block truncate">{matchLabel(m.code, t)}</span>
              {['home', 'away'].map((side) => {
                const team = m[side]
                const own = team && m.my_team_ids?.includes(team.id)
                return (
                  <span key={side} className={`block truncate text-sm font-bold ${own ? 'text-gold-light' : ''}`}>
                    {own && <span className="mr-1" aria-label={t('veedor.your_team')}>★</span>}
                    {team?.name || sourceLabel(m[`${side}_source`], t)}
                  </span>
                )
              })}
            </span>
            <span className="text-right">
              {m.status !== 'SCHEDULED' && <span className="board-num block text-2xl">{m.home_goals ?? 0}–{m.away_goals ?? 0}</span>}
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                {m.confirmed ? t('common.official') : t(`status.${m.status}`)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function MatchControl({ match, queue, enqueue, skew = 0, onBack }) {
  const { t } = useI18n()
  const [picker, setPicker] = useState(null) // {side, type}
  const [dup, setDup] = useState(null) // posible duplicado a confirmar
  const [armFinish, setArmFinish] = useState(false)
  const base = `/matches/${match.code}`
  const live = LIVE.has(match.status)
  const locked = match.confirmed || match.status === 'FINISHED' || match.status === 'WALKOVER'

  // Marcador optimista: goles en cola todavía no confirmados por el server.
  const pendingDelta = useMemo(() => {
    let h = 0
    let a = 0
    for (const q of queue) {
      if (q.path !== `${base}/events` || q.method !== 'POST') continue
      const { type, team_id: tid } = q.body
      const forHome = type === 'GOAL' ? tid === match.home?.id : type === 'OWN_GOAL' ? tid === match.away?.id : null
      if (forHome === true) h++
      if (forHome === false) a++
    }
    return { h, a }
  }, [queue, base, match.home?.id, match.away?.id])

  const teamOf = (side) => (side === 'home' ? match.home : match.away)
  const own = (team) => Boolean(team && match.my_team_ids?.includes(team.id))

  /**
   * En un partido cargan los dos veedores. Si el OTRO cargó lo mismo (tipo + equipo) hace menos de
   * 90 s, es probable que sea el mismo gol/tarjeta: se pregunta antes de cargarlo.
   */
  const recentByOther = (team, type) => {
    const now = Date.now() + skew
    return (match.events || [])
      .filter((e) => !e.mine && e.type === type && e.team_id === team.id && e.created_at)
      .map((e) => ({ ...e, age: Math.round((now - Date.parse(e.created_at)) / 1000) }))
      .filter((e) => e.age >= 0 && e.age <= DUP_WINDOW_S)
      .sort((a, b) => a.age - b.age)[0]
  }

  const addEvent = (side, type, player, { force = false } = {}) => {
    const team = teamOf(side)
    const recent = !force && recentByOther(team, type)
    if (recent) {
      setPicker(null)
      setDup({ side, type, player, by: recent.loaded_by, age: recent.age, team: team.name })
      return
    }
    setDup(null)
    enqueue({
      method: 'POST',
      path: `${base}/events`,
      body: { team_id: team.id, type, player_id: player?.id ?? null, client_event_id: newId() },
      label: `${t(`event.${type}`)} · ${team.name}`,
    })
    setPicker(null)
  }
  const setStatus = (status) => {
    enqueue({ method: 'POST', path: `${base}/status`, body: { status }, label: t(`status.${status}`) })
    setArmFinish(false)
  }

  const tied = (match.home_goals ?? 0) + pendingDelta.h === (match.away_goals ?? 0) + pendingDelta.a
  const needsPens = match.stage !== 'GROUP' && tied && live

  return (
    <div>
      <button type="button" onClick={onBack} className="focus-ring mb-3 rounded text-sm font-bold text-gold-light">
        ← {t('veedor.my_matches')}
      </button>
      <div className="kicker mb-2">
        {match.local?.time} · {t('common.court_n', { n: match.venue })} · {matchLabel(match.code, t)}
      </div>

      <section className={`card mb-4 p-4 ${live ? 'live-frame' : ''}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          {['home', 'away'].map((side, idx) => {
            const team = teamOf(side)
            const goals = (side === 'home' ? match.home_goals : match.away_goals) ?? 0
            const delta = side === 'home' ? pendingDelta.h : pendingDelta.a
            const block = (
              <div key={side} className="flex flex-col items-center gap-2">
                <Crest team={team} size="lg" />
                <span className="line-clamp-2 text-sm font-bold leading-tight">{team?.name || sourceLabel(match[`${side}_source`], t)}</span>
                {own(team) && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-gold">
                    ★ {t('veedor.your_team')}
                  </span>
                )}
                <span className="board-num text-6xl leading-none">
                  {goals + delta}
                  {delta > 0 && <span className="align-top text-base text-gold-light">*</span>}
                </span>
              </div>
            )
            return idx === 0 ? [block, <span key="sep" className="board-num self-end pb-2 text-4xl text-white/30">–</span>] : block
          })}
        </div>
        {match.home_pens != null && (
          <p className="mt-2 text-center text-sm font-bold text-gold-light">
            {t('common.penalties')} {match.home_pens}–{match.away_pens}
          </p>
        )}
        {match.other_veedors?.length > 0 && (
          <p className="mt-3 text-center text-[11px] font-semibold text-white/50">
            {t('veedor.also_loading', { names: match.other_veedors.join(', ') })}
          </p>
        )}
      </section>

      {live && !match.confirmed && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {['home', 'away'].map((side) => (
            <div key={side} className="space-y-2">
              <BigButton tone="gold" className="w-full" onClick={() => setPicker({ side, type: 'GOAL' })}>
                ⚽ {t('event.GOAL')}
              </BigButton>
              <div className="grid grid-cols-3 gap-2">
                <SmallButton onClick={() => setPicker({ side, type: 'YELLOW' })} label={t('event.YELLOW')}>
                  <span className="inline-block h-5 w-3.5 rounded-[2px] bg-[#ffd400]" />
                </SmallButton>
                <SmallButton onClick={() => setPicker({ side, type: 'RED' })} label={t('event.RED')}>
                  <span className="inline-block h-5 w-3.5 rounded-[2px] bg-[#e40303]" />
                </SmallButton>
                <SmallButton onClick={() => setPicker({ side, type: 'OWN_GOAL' })} label={t('event.OWN_GOAL')}>
                  <span className="text-[10px] font-extrabold">{t('veedor.og_short')}</span>
                </SmallButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {needsPens && <Penalties match={match} onSave={(hp, ap) => enqueue({ method: 'PUT', path: `${base}/penalties`, body: { home_pens: hp, away_pens: ap }, label: t('common.penalties') })} />}

      <EventLog match={match} locked={locked} enqueue={enqueue} base={base} />

      {/* barra de estado fija abajo */}
      {!match.confirmed && match.status !== 'FINISHED' && match.status !== 'WALKOVER' && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night/90 p-3 backdrop-blur-md" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
            {match.status === 'SCHEDULED' && (
              <BigButton tone="gold" className="col-span-2" disabled={!match.home || !match.away} onClick={() => setStatus('LIVE')}>
                {t('veedor.start')}
              </BigButton>
            )}
            {match.status === 'LIVE' && <BigButton onClick={() => setStatus('HALFTIME')}>{t('veedor.halftime')}</BigButton>}
            {match.status === 'HALFTIME' && <BigButton onClick={() => setStatus('LIVE')}>{t('veedor.second_half')}</BigButton>}
            {live && (
              <BigButton tone={armFinish ? 'danger' : 'outline'} onClick={() => (armFinish ? setStatus('FINISHED') : setArmFinish(true))}>
                {armFinish ? t('veedor.finish_confirm') : t('veedor.finish')}
              </BigButton>
            )}
          </div>
        </div>
      )}
      {match.status === 'FINISHED' && !match.confirmed && <p className="card p-3 text-center text-sm text-white/60">{t('veedor.waiting_confirm')}</p>}

      {picker && <PlayerPicker team={teamOf(picker.side)} type={picker.type} onPick={(p) => addEvent(picker.side, picker.type, p)} onClose={() => setPicker(null)} />}

      {dup && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-indigo-800 p-5 text-center ring-1 ring-gold/40">
            <p className="kicker mb-2">{t('veedor.dup_title')}</p>
            <p className="mb-5 text-base font-bold">
              {t('veedor.dup_text', { by: dup.by || '—', type: t(`event.${dup.type}`).toLowerCase(), team: dup.team, s: dup.age })}
            </p>
            <div className="grid gap-2">
              <BigButton tone="gold" onClick={() => addEvent(dup.side, dup.type, dup.player, { force: true })}>
                {t('veedor.dup_yes')}
              </BigButton>
              <BigButton tone="outline" onClick={() => setDup(null)}>
                {t('veedor.dup_no')}
              </BigButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Penalties({ match, onSave }) {
  const { t } = useI18n()
  const [hp, setHp] = useState(match.home_pens ?? 0)
  const [ap, setAp] = useState(match.away_pens ?? 0)
  const step = (v, set, d) => set(Math.max(0, v + d))
  return (
    <section className="card mb-4 p-4">
      <p className="kicker mb-3">{t('veedor.pens_title')}</p>
      <div className="grid grid-cols-2 gap-4">
        {[
          [match.home?.name, hp, setHp],
          [match.away?.name, ap, setAp],
        ].map(([name, v, set], i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <span className="truncate text-xs font-bold text-white/70">{name}</span>
            <div className="flex items-center gap-3">
              <SmallButton onClick={() => step(v, set, -1)} label="−">−</SmallButton>
              <span className="board-num w-8 text-center text-4xl">{v}</span>
              <SmallButton onClick={() => step(v, set, 1)} label="+">+</SmallButton>
            </div>
          </div>
        ))}
      </div>
      <BigButton className="mt-4 w-full" tone="gold" disabled={hp === ap} onClick={() => onSave(hp, ap)}>
        {t('veedor.pens_save')}
      </BigButton>
    </section>
  )
}

function EventLog({ match, locked, enqueue, base }) {
  const { t } = useI18n()
  const players = new Map([...(match.home?.players || []), ...(match.away?.players || [])].map((p) => [p.id, p]))
  const events = [...(match.events || [])].reverse()
  if (!events.length) return null
  return (
    <section className="mb-4">
      <p className="kicker mb-2">{t('veedor.log')}</p>
      <ul className="card divide-y divide-white/5">
        {events.map((e) => {
          const p = e.player_id ? players.get(e.player_id) : null
          const team = e.team_id === match.home?.id ? match.home : match.away
          return (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 font-bold">{t(`event.${e.type}`)}</span>
              <span className="min-w-0 flex-1 text-white/70">
                <span className="block truncate">{p ? `#${p.shirt_number ?? '–'} ${p.full_name}` : team?.name}</span>
                {!e.mine && e.loaded_by && (
                  <span className="block truncate text-[11px] text-white/40">{t('veedor.by', { name: e.loaded_by })}</span>
                )}
              </span>
              {!locked && e.mine && (
                <button
                  type="button"
                  className="focus-ring rounded px-2 py-1 text-xs font-bold text-[#ff9db3]"
                  onClick={() => enqueue({ method: 'DELETE', path: `${base}/events/${e.id}`, label: t('veedor.undo') })}
                >
                  {t('veedor.undo')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PlayerPicker({ team, type, onPick, onClose }) {
  const { t } = useI18n()
  const players = team?.players || []
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mx-auto w-full max-w-lg rounded-t-2xl bg-indigo-800 p-4 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-extrabold">
            {t(`event.${type}`)} · {team?.name}
          </p>
          <button type="button" onClick={onClose} className="focus-ring rounded px-2 text-white/60" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="grid max-h-[50dvh] grid-cols-3 gap-2 overflow-y-auto">
          {players.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p)} className="focus-ring rounded-xl bg-white/5 p-2 text-center ring-1 ring-white/10 active:bg-gold active:text-night">
              <span className="board-num block text-3xl leading-none text-gold">{p.shirt_number ?? '–'}</span>
              <span className="block truncate text-[11px] font-semibold">{p.full_name}</span>
            </button>
          ))}
        </div>
        <BigButton className="mt-3 w-full" tone="outline" onClick={() => onPick(null)}>
          {t('veedor.no_player')}
        </BigButton>
      </div>
    </div>
  )
}

function BigButton({ children, onClick, tone = 'solid', className = '', disabled }) {
  const tones = {
    gold: 'bg-gold text-night',
    solid: 'bg-white text-night',
    outline: 'bg-transparent text-white ring-1 ring-white/30',
    danger: 'bg-live text-white',
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`focus-ring min-h-[52px] rounded-xl px-4 text-base font-extrabold transition active:scale-[0.98] disabled:opacity-40 ${tones[tone]} ${className}`}>
      {children}
    </button>
  )
}

function SmallButton({ children, onClick, label }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="focus-ring grid min-h-[48px] place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 active:bg-white/20">
      {children}
    </button>
  )
}
