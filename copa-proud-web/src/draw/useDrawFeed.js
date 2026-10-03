import { useEffect, useRef, useState } from 'react'
import { fetchDrawState } from './drawApi.js'
import { revealMs } from './drawView.js'

/**
 * Estado del sorteo para una pantalla (tablero de OBS, overlay, página pública):
 *  - polling: `fastMs` con el sorteo en vivo, `slowMs` si no;
 *  - `delayMs`: cada equipo nuevo se "libera" recién después de esa demora desde que esta pantalla
 *    lo vio (la página pública va detrás de YouTube para no spoilear la transmisión);
 *  - `animate`: los equipos liberados pasan por una revelación (de a uno, en fila) antes de
 *    aparecer en su zona. Sin animación aparecen directo.
 * Al abrir la pantalla, lo que ya había salido se muestra sin animar.
 * Deshacer / reiniciar: se ve al instante (sin animación).
 */
export function useDrawFeed({ delayMs = 0, animate = true, fastMs = 1000, slowMs = 5000 } = {}) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [shownSeq, setShownSeq] = useState(null) // hasta qué pick se ve en las zonas
  const [revealing, setRevealing] = useState(null)
  const stateRef = useRef(null)
  const known = useRef(new Map()) // seq → { at, seenAt }
  const released = useRef(null) // último seq liberado
  const queue = useRef([])
  const delayRef = useRef(delayMs)
  delayRef.current = delayMs

  // Polling
  useEffect(() => {
    let alive = true
    let timer
    const tick = async () => {
      try {
        const s = await fetchDrawState()
        if (!alive) return
        stateRef.current = s
        setState(s)
        setError(null)
        const now = Date.now()
        if (released.current === null) {
          for (const p of s.picks) known.current.set(p.seq, { at: p.at, seenAt: -Infinity })
          released.current = s.picks.at(-1)?.seq ?? 0
          setShownSeq(released.current)
        } else {
          // ¿Se deshizo algo (o se rehízo distinto con el mismo número)?
          let rollback = null
          for (const [seq, k] of known.current) {
            const p = s.picks.find((x) => x.seq === seq)
            if (!p || p.at !== k.at) rollback = Math.min(rollback ?? Infinity, seq - 1)
          }
          if (rollback !== null) {
            for (const seq of [...known.current.keys()]) if (seq > rollback) known.current.delete(seq)
            queue.current = queue.current.filter((p) => p.seq <= rollback)
            released.current = Math.min(released.current, rollback)
            setShownSeq((v) => Math.min(v ?? 0, rollback))
            setRevealing((r) => (r && r.seq > rollback ? null : r))
          }
          for (const p of s.picks) if (!known.current.has(p.seq)) known.current.set(p.seq, { at: p.at, seenAt: now })
        }
        timer = setTimeout(tick, s.status === 'LIVE' ? fastMs : slowMs)
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
  }, [fastMs, slowMs])

  // Liberación (con demora) → cola de revelación o directo a las zonas
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current
      if (!s || released.current === null) return
      const now = Date.now()
      for (const p of s.picks) {
        if (p.seq <= released.current) continue
        const k = known.current.get(p.seq)
        if (!k || k.seenAt + delayRef.current > now) break // en orden: no saltear
        released.current = p.seq
        if (animate) queue.current.push(p)
        else setShownSeq(p.seq)
      }
    }, 200)
    return () => clearInterval(id)
  }, [animate])

  // Revelaciones de a una
  useEffect(() => {
    if (!animate || revealing) return
    const id = setInterval(() => {
      if (!queue.current.length) return
      const next = queue.current.shift()
      setRevealing(next)
      setTimeout(() => {
        setRevealing((r) => (r?.seq === next.seq ? null : r))
        // Si mientras se revelaba lo deshicieron, no se muestra.
        if (known.current.get(next.seq)?.at === next.at) setShownSeq((v) => Math.max(v ?? 0, next.seq))
      }, revealMs(next))
    }, 150)
    return () => clearInterval(id)
  }, [animate, revealing])

  const lastShown = state?.picks.filter((p) => shownSeq !== null && p.seq <= shownSeq).at(-1) ?? null
  const pending = state ? state.picks.some((p) => shownSeq !== null && p.seq > shownSeq) : false
  const done = state?.status === 'DONE' && !revealing && !pending
  return { state, error, shownSeq, revealing, lastShown, done }
}
