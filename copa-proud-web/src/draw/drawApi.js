import { API_URL, SLUG } from '../lib/CompetitionProvider.jsx'

const BASE = () => `${API_URL}/public/competitions/${SLUG}/draw`

export async function fetchDrawState() {
  const res = await fetch(BASE(), { cache: 'no-cache' })
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
  return res.json()
}

export async function producerCall(token, method, action, body) {
  const res = await fetch(`${BASE()}/control${action ? `/${action}` : ''}`, {
    method,
    headers: { 'X-Draw-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
