import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { LANGS } from '../i18n/messages.js'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { DemoBanner } from './DemoBanner.jsx'
import { IS_DEMO } from '../lib/mode.js'

const NAV = [
  ['/', 'nav.home'],
  ['/sorteo', 'nav.draw'],
  ['/fixture', 'nav.fixture'],
  ['/zonas', 'nav.groups'],
  ['/copas', 'nav.cups'],
  ['/equipos', 'nav.teams'],
  ['/estadisticas', 'nav.stats'],
  ['/revivi', 'nav.relive'],
  ['/mapa', 'nav.map'],
]

function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <div className="flex rounded-full bg-white/5 p-0.5 ring-1 ring-white/10" role="group" aria-label="Idioma / Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          title={l.name}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wider transition ${
            lang === l.code ? 'bg-gold text-night' : 'text-white/60 hover:text-white'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

function LiveBadge() {
  const { t } = useI18n()
  const { model } = useCompetition()
  const n = model?.liveMatches.length ?? 0
  if (!n) return null
  return (
    <NavLink to="/" className="focus-ring hidden items-center gap-1.5 rounded-full bg-live/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#ff7a98] sm:inline-flex">
      <span className="live-dot" aria-hidden="true" />
      {t('status.LIVE')} · {n}
    </NavLink>
  )
}

export function Layout() {
  const { t } = useI18n()
  const { offline, updatedAt, model } = useCompetition()
  const { pathname } = useLocation()
  // "Reviví tu partido" aparece cuando la organización carga la carpeta de fotos (en la demo, siempre).
  const nav = NAV.filter(([to]) => to !== '/revivi' || IS_DEMO || model?.comp?.gallery?.enabled)

  const navRef = useRef(null)
  useEffect(() => {
    window.scrollTo({ top: 0 })
    // En mobile el menú se desplaza de costado: centrar la pestaña activa.
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night/80 backdrop-blur-md">
        <DemoBanner />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:flex-nowrap">
          <NavLink to="/" className="focus-ring flex shrink-0 items-center gap-2 rounded" aria-label="Copa Proud Sudamericana 2026">
            <img src="/brand/mark.webp" alt="" className="h-9 w-9 object-contain" />
            <span className="hidden leading-none sm:block">
              <span className="block text-sm font-extrabold tracking-tight">COPA PROUD</span>
              <span className="block text-[10px] font-bold tracking-[0.22em] text-white/60">SUDAMERICANA 2026</span>
            </span>
          </NavLink>
          <nav ref={navRef} className="scroll-x no-scrollbar order-last -mx-1 flex w-full gap-1 px-1 sm:order-none sm:w-auto sm:flex-1" aria-label="Principal">
            {nav.map(([to, key]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `focus-ring shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold transition ${
                    isActive ? 'bg-white text-night' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {t(key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <LiveBadge />
            <LangSwitch />
          </div>
        </div>
        <div className="rainbow-strip opacity-80" />
      </header>

      {model?.comp?.draw_status === 'LIVE' && pathname !== '/sorteo' && (
        <Link to="/sorteo" className="focus-ring flex items-center justify-center gap-2 bg-live px-4 py-2 text-center text-sm font-extrabold uppercase tracking-wider text-white">
          <span className="live-dot !bg-white" aria-hidden="true" /> {t('draw.live_banner')} · {t('draw.watch')} →
        </Link>
      )}

      {offline && (
        <div role="status" className="bg-gold/15 px-4 py-2 text-center text-xs font-semibold text-gold-light">
          {t('common.offline')}
          {updatedAt && ` · ${t('common.updated', { time: updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}`}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6">
        <Outlet />
      </main>

      <footer className="border-t border-white/10 bg-night/60">
        <div className="rainbow-strip" />
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-lg font-extrabold">{t('footer.tagline_1')}</p>
          <p className="font-script text-3xl text-gold">{t('footer.tagline_2')}</p>
          <p className="max-w-md text-sm text-white/55">{t('footer.mission')}</p>
          <p className="text-xs text-white/35">
            {t('footer.org')} ·{' '}
            <a href="https://copaproud.com" className="focus-ring rounded underline-offset-2 hover:underline">
              copaproud.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

export function SectionTitle({ kicker, title, children, className = '' }) {
  return (
    <div className={`mb-4 flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div>
        {kicker && <div className="kicker mb-1">{kicker}</div>}
        <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
      </div>
      {children}
    </div>
  )
}
