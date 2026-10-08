import { API_URL, SLUG } from '../lib/CompetitionProvider.jsx'

/** Llamada a la API de la mesa de control (link privado: header X-Control-Token). */
export async function controlCall(token, method, path, body) {
  const res = await fetch(`${API_URL}/public/competitions/${SLUG}/control${path}`, {
    method,
    headers: { 'X-Control-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
