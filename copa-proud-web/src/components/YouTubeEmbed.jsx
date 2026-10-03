/**
 * Reproductor de YouTube (dominio sin cookies). Sirve para un vivo programado: antes de empezar
 * muestra la sala de espera de YouTube y, cuando arranca, el vivo. `live` = autoplay en silencio.
 */
export function YouTubeEmbed({ id, title, live = false, className = '' }) {
  const params = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1' })
  if (live) {
    params.set('autoplay', '1')
    params.set('mute', '1')
  }
  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 ${className}`}>
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  )
}
