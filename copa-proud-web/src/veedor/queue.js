// Cola de acciones del veedor que sobrevive a cortes de señal y a recargar la página.
// Cada acción se reintenta hasta que el servidor responde. Los eventos llevan client_event_id,
// así un reintento de un gol que sí había llegado no lo duplica (el server devuelve duplicate).
import { API_URL, SLUG } from '../lib/CompetitionProvider.jsx'

const keyFor = (token) => `cp-veedor-queue-${token.slice(0, 10)}`

export function loadQueue(token) {
  try {
    return JSON.parse(localStorage.getItem(keyFor(token)) || '[]')
  } catch {
    return []
  }
}

export function saveQueue(token, queue) {
  try {
    localStorage.setItem(keyFor(token), JSON.stringify(queue))
  } catch {
    // sin storage: la cola vive solo en memoria mientras la pestaña esté abierta
  }
}

export function newId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, '')
}

export async function staffFetch(token, method, path, body) {
  const res = await fetch(`${API_URL}/public/competitions/${SLUG}/staff${path}`, {
    method,
    headers: { 'X-Staff-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data }
}

/**
 * Envía la cola en orden. Se detiene ante error de red, 429 o 5xx (se reintenta luego).
 * Un 4xx (p.ej. el partido ya fue confirmado) descarta la acción y se informa.
 */
export async function flushQueue(token, queue, { onSent, onRejected }) {
  let rest = [...queue]
  while (rest.length) {
    const action = rest[0]
    let res
    try {
      res = await staffFetch(token, action.method, action.path, action.body)
    } catch {
      return rest // sin red
    }
    if (res.ok) {
      onSent?.(action, res.data)
    } else if (res.status === 429 || res.status >= 500) {
      return rest
    } else {
      onRejected?.(action, res.data?.detail || `HTTP ${res.status}`)
    }
    rest = rest.slice(1)
  }
  return rest
}
