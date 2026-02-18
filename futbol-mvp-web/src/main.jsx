import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import AdminPanel from './AdminPanel.jsx'
import Profile from './Profile.jsx'
import RatingsPending from './RatingsPending.jsx'
import TournamentLive from './TournamentLive.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/ratings/pending-ui" element={<RatingsPending />} />
        <Route path="/tournaments/:id/live" element={<TournamentLive />} />
        <Route path="/tournaments/:id/live/tv" element={<TournamentLive />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
