import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { buildModel } from './model.js'
import { IS_DEMO } from './mode.js'

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const BASE_SLUG = import.meta.env.VITE_COMPETITION_SLUG || 'copa-proud-2026'
export const SLUG = IS_DEMO ? `${BASE_SLUG}-demo` : BASE_SLUG

const POLL_LIVE_MS = 15_000
const POLL_IDLE_MS = 60_000

const CompetitionContext = createContext(null)

/**
 * Un solo snapshot para todo el sitio (GET /public/competitions/{slug}).
 * `cache: 'no-cache'` revalida con ETag: si nada cambió, el server responde 304 sin cuerpo.
 * Si la red falla, se conservan los últimos datos y se marca `offline`.
 */
export function CompetitionProvider({ children }) {
  const [snapshot, setSnapshot] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | not_published | error
  const [offline, setOffline] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const timer = useRef(null)
  const versionRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/competitions/${SLUG}`, { cache: 'no-cache' })
      if (res.status === 404) {
        setStatus('not_published')
        return null
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.competition.data_version !== versionRef.current) {
        versionRef.current = data.competition.data_version
        setSnapshot(data)
      }
      setStatus('ready')
      setOffline(false)
      setUpdatedAt(new Date())
      return data
    } catch {
      setOffline(true)
      setStatus((s) => (s === 'loading' ? 'error' : s))
      return null
    }
  }, [])

  const model = useMemo(() => (snapshot ? buildModel(snapshot) : null), [snapshot])
  // Ritmo de polling: rápido si hay partidos en juego (o si se cortó la red), lento si no.
  const fastRef = useRef(false)
  useEffect(() => {
    fastRef.current = Boolean(model?.liveMatches.length) || offline
  }, [model, offline])

  useEffect(() => {
    let cancelled = false
    const schedule = () => {
      clearTimeout(timer.current)
      if (document.hidden) return
      timer.current = setTimeout(tick, fastRef.current ? POLL_LIVE_MS : POLL_IDLE_MS)
    }
    const tick = async () => {
      await load()
      if (!cancelled) schedule()
    }
    const onVisible = () => {
      if (!document.hidden) tick()
      else clearTimeout(timer.current)
    }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', tick)
    return () => {
      cancelled = true
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', tick)
    }
  }, [load])

  const value = useMemo(
    () => ({ model, status, offline, updatedAt, refresh: load }),
    [model, status, offline, updatedAt, load],
  )
  return <CompetitionContext.Provider value={value}>{children}</CompetitionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompetition() {
  const ctx = useContext(CompetitionContext)
  if (!ctx) throw new Error('useCompetition fuera de CompetitionProvider')
  return ctx
}
