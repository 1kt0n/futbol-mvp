import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import './styles/index.css'
import { I18nProvider, useI18n } from './i18n/I18nProvider.jsx'
import { CompetitionProvider, useCompetition } from './lib/CompetitionProvider.jsx'
import { Layout } from './components/Layout.jsx'
import { DemoBanner } from './components/DemoBanner.jsx'
import { IS_DEMO, ROUTER_BASENAME } from './lib/mode.js'
import Home from './pages/Home.jsx'
import Fixture from './pages/Fixture.jsx'
import Groups from './pages/Groups.jsx'
import Cups from './pages/Cups.jsx'
import Teams from './pages/Teams.jsx'
import Team from './pages/Team.jsx'
import Stats from './pages/Stats.jsx'
import Draw from './pages/Draw.jsx'
import NotFound from './pages/NotFound.jsx'

// El modo veedor es una pantalla aparte (lo usan ~6 personas): se carga solo si se abre su link.
const Veedor = lazy(() => import('./veedor/VeedorApp.jsx'))
const DrawStage = lazy(() => import('./draw/DrawStage.jsx'))
const ProducerPanel = lazy(() => import('./draw/ProducerPanel.jsx'))
const ObsApp = lazy(() => import('./obs/ObsApp.jsx'))

if (IS_DEMO) {
  // La demo no se indexa ni se confunde con el sitio real en la pestaña del navegador.
  const robots = document.createElement('meta')
  robots.name = 'robots'
  robots.content = 'noindex, nofollow'
  document.head.appendChild(robots)
  document.title = `DEMO · ${document.title}`
}

function Splash({ children }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="fixed inset-x-0 top-0"><DemoBanner /></div>
      <div className="flex flex-col items-center gap-5">
        <img src="/brand/logo-dark-bg.webp" alt="Copa Proud Sudamericana 2026" className="w-56 animate-pulse drop-shadow-[0_18px_40px_rgba(54,7,119,0.9)]" />
        {children}
      </div>
    </div>
  )
}

/** Muestra el sitio solo cuando hay datos; si no, un estado con marca (cargando / no publicado / error). */
function PublicSite() {
  const { t } = useI18n()
  const { status, model } = useCompetition()
  if (!model) {
    if (status === 'not_published') return <Splash><p className="font-bold text-white/70">{t('common.not_published')}</p></Splash>
    if (status === 'error') return <Splash><p className="font-bold text-white/70">{t('common.error')}</p></Splash>
    return <Splash><p className="text-sm font-semibold text-white/50">{t('common.loading')}</p></Splash>
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="fixture" element={<Fixture />} />
        <Route path="zonas" element={<Groups />} />
        <Route path="copas" element={<Cups />} />
        <Route path="equipos" element={<Teams />} />
        <Route path="equipos/:id" element={<Team />} />
        <Route path="estadisticas" element={<Stats />} />
        <Route path="sorteo" element={<Draw />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

/**
 * El sitio público. /sorteo es una pestaña más; /sorteo?tv=1 (link viejo de la pantalla de
 * transmisión) sigue abriendo el tablero a pantalla completa. Un solo elemento para todo el sitio
 * así navegar entre pestañas no vuelve a montar el proveedor de datos.
 */
function SiteRoot() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  if (pathname === '/sorteo' && params.get('tv') === '1') {
    return (
      <Suspense fallback={<Splash />}>
        <DrawStage />
      </Suspense>
    )
  }
  return (
    <CompetitionProvider>
      <PublicSite />
    </CompetitionProvider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Routes>
          <Route
            path="/v/:token"
            element={
              <Suspense fallback={<Splash />}>
                <Veedor />
              </Suspense>
            }
          />
          <Route
            path="/obs/*"
            element={
              <Suspense fallback={null}>
                <ObsApp />
              </Suspense>
            }
          />
          <Route
            path="/produccion/:token"
            element={
              <Suspense fallback={<Splash />}>
                <ProducerPanel />
              </Suspense>
            }
          />
          <Route path="*" element={<SiteRoot />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
