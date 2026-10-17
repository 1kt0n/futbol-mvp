// Mensaje de WhatsApp para compartir un evento. Lo usan "Acceso y compartir"
// (EventAccessPanel) y el paso Compartir de "Repetir partido" (AdminPanel).

// URL absoluta a partir de la ruta relativa que manda el backend (share_path).
export function shareUrlFromPath(path) {
  if (!path) return ''
  try { return `${window.location.origin}${path}` } catch { return path }
}

// event: { title, starts_at, location_name }. La clave nunca va en el mensaje.
// starts_at llega como "2026-10-29 22:00:00+00:00": con la "T" también lo entiende Safari.
export function buildEventShareMessage(event, shareUrl) {
  return [
    `⚽ ${event.title}`,
    event.starts_at ? `🗓️ ${new Date(String(event.starts_at).replace(' ', 'T')).toLocaleString()}` : '',
    event.location_name ? `📍 ${event.location_name}` : '',
    shareUrl ? `Anotate: ${shareUrl}` : '',
  ].filter(Boolean).join('\n')
}

export function whatsAppHref(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
