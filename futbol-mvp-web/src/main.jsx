import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import AdminPanel from './AdminPanel.jsx'
import Profile from './Profile.jsx'
import RatingsPending from './RatingsPending.jsx'
import Calendar from './calendar/Calendar.jsx'
import TournamentPublicPage from './features/tournaments/public/TournamentPublicPage.jsx'
import TournamentTvPage from './features/tournaments/public/TournamentTvPage.jsx'
import PublicEventPage from './features/events/public/PublicEventPage.jsx'
import ExternalParticipationPage from './features/events/public/ExternalParticipationPage.jsx'
import AvisosPage from './features/avisos/AvisosPage.jsx'
import AppShell from './shell/AppShell.jsx'
import { Toaster } from './design/ui/overlay/index.js'

function LegacyPublicRedirect() {
  const { id } = useParams()
  const location = useLocation()
  return <Navigate replace to={`/tournaments/${id}${location.search || ''}`} />
}

function LegacyTvRedirect() {
  const { id } = useParams()
  const location = useLocation()
  return <Navigate replace to={`/tournaments/${id}/tv${location.search || ''}`} />
}

registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Pantallas con sesión: comparten la barra inferior */}
        <Route element={<AppShell />}>
          <Route path="/" element={<App />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/avisos" element={<AvisosPage />} />
          <Route path="/ratings/pending-ui" element={<RatingsPending />} />
        </Route>
        <Route path="/e/:shareCode" element={<PublicEventPage />} />
        <Route path="/g/:token" element={<ExternalParticipationPage />} />
        <Route path="/tournaments/:id" element={<TournamentPublicPage />} />
        <Route path="/tournaments/:id/tv" element={<TournamentTvPage />} />
        <Route path="/tournaments/:id/live" element={<LegacyPublicRedirect />} />
        <Route path="/tournaments/:id/live/tv" element={<LegacyTvRedirect />} />
      </Routes>
      {/* Un solo lugar para los toasts de toda la app (también en las páginas públicas) */}
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
)
