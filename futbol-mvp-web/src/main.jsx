import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useParams } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import AdminPanel from './AdminPanel.jsx'
import Profile from './Profile.jsx'
import RatingsPending from './RatingsPending.jsx'
import TournamentPublicPage from './features/tournaments/public/TournamentPublicPage.jsx'
import TournamentTvPage from './features/tournaments/public/TournamentTvPage.jsx'

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
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/ratings/pending-ui" element={<RatingsPending />} />
        <Route path="/tournaments/:id" element={<TournamentPublicPage />} />
        <Route path="/tournaments/:id/tv" element={<TournamentTvPage />} />
        <Route path="/tournaments/:id/live" element={<LegacyPublicRedirect />} />
        <Route path="/tournaments/:id/live/tv" element={<LegacyTvRedirect />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
