import { useCallback, useEffect, useState } from 'react'
import { API_URL, SLUG } from '../lib/CompetitionProvider.jsx'

const REFRESH_MS = 60_000
// Última respuesta por URL: volver de un álbum a la lista (o al revés) muestra lo que ya había al toque.
const memory = new Map()

/**
 * GET con refresco cada minuto mientras la pestaña está visible (el fotógrafo va subiendo fotos
 * durante el partido). status: loading | ready | not_found | error.
 */
function usePolled(path) {
  const url = path ? `${API_URL}/public/competitions/${SLUG}${path}` : null
  const [state, setState] = useState(() => (url && memory.has(url) ? { data: memory.get(url), status: 'ready' } : { data: null, status: 'loading' }))

  const load = useCallback(async () => {
    if (!url) return
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (res.status === 404) {
        memory.delete(url)
        setState({ data: null, status: 'not_found' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      memory.set(url, data)
      setState({ data, status: 'ready' })
    } catch {
      setState((s) => (s.data ? s : { data: null, status: 'error' }))
    }
  }, [url])

  useEffect(() => {
    if (!url) return undefined
    setState(memory.has(url) ? { data: memory.get(url), status: 'ready' } : { data: null, status: 'loading' })
    load()
    const id = setInterval(() => {
      if (!document.hidden) load()
    }, REFRESH_MS)
    const onVisible = () => !document.hidden && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [url, load])

  return state
}

/** Álbumes visibles: {enabled, mode: 'gallery'|'embed', credit, folder_url, albums[]}. */
export const useGallery = () => usePolled('/gallery')

/** Un álbum con sus fotos: {album, photos[], folder_url, credit}. */
export const useAlbum = (albumId) => usePolled(albumId ? `/gallery/${encodeURIComponent(albumId)}` : null)
