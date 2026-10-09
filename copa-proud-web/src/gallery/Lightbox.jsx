import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { Photo } from './Photo.jsx'
import { downloadUrl, fullWidth, photoSrc } from './photoUrl.js'

const THUMB_W = 480

/**
 * Visor a pantalla completa. Muestra al instante la miniatura (ya está en caché de la grilla) y
 * encima la foto grande cuando termina de bajar. Flechas, teclado y deslizar con el dedo.
 */
export function Lightbox({ photos, index, onIndex, onClose, onShare, title }) {
  const { t } = useI18n()
  const photo = photos[index]
  const w = useRef(fullWidth()).current
  const [loaded, setLoaded] = useState(false)
  const touch = useRef(null)
  const closeRef = useRef(null)
  const has = (i) => i >= 0 && i < photos.length
  const go = (i) => has(i) && onIndex(i)

  useEffect(() => setLoaded(false), [photo?.id])

  // Precarga la anterior y la siguiente: pasar de foto se siente instantáneo.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      if (has(i)) new Image().src = photoSrc(photos[i].id, w)
    }
  })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(index + 1)
      else if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!photo) return null
  const time = photo.t ? photo.t.slice(11, 16) : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-[#07010f]/95 backdrop-blur-sm"
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return
        const dx = e.changedTouches[0].clientX - touch.current.x
        const dy = e.changedTouches[0].clientY - touch.current.y
        touch.current = null
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1)
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose()
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <span className="board-num text-xl text-white/80">
          {index + 1}<span className="text-white/35"> / {photos.length}</span>
        </span>
        {time && <span className="text-xs font-semibold text-white/45">{time}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => onShare(photo)} className="focus-ring rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/20">
            <ShareIcon /> <span className="hidden sm:inline">{t('relive.share')}</span>
          </button>
          <a
            href={downloadUrl(photo.id)}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-2 text-sm font-extrabold text-night"
          >
            <DownloadIcon /> {t('relive.download_hd')}
          </a>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('relive.close')} className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/10 text-2xl leading-none text-white hover:bg-white/20">
            ×
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 select-none">
        <div className="absolute inset-0 grid place-items-center p-2 sm:px-16">
          <div className="relative h-full w-full">
            <Photo key={`t-${photo.id}`} id={photo.id} w={THUMB_W} alt="" className="absolute inset-0 h-full w-full object-contain blur-[2px]" />
            <Photo
              key={`f-${photo.id}`}
              id={photo.id}
              w={w}
              alt={title}
              loading="eager"
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        </div>
        {has(index - 1) && (
          <button type="button" onClick={() => go(index - 1)} aria-label={t('relive.prev')} className="focus-ring absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20 sm:grid">
            ‹
          </button>
        )}
        {has(index + 1) && (
          <button type="button" onClick={() => go(index + 1)} aria-label={t('relive.next')} className="focus-ring absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-3xl text-white hover:bg-white/20 sm:grid">
            ›
          </button>
        )}
      </div>
      <p className="px-4 pb-3 pt-1 text-center text-[11px] text-white/40 sm:hidden">{t('relive.swipe_hint')}</p>
    </div>
  )
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" className="inline h-4 w-4 align-[-3px]" aria-hidden="true">
      <path fill="currentColor" d="M14 13a3 3 0 0 0-2.2 1l-4.9-2.6a3 3 0 0 0 0-1.8l4.9-2.6A3 3 0 1 0 11 5l-4.9 2.6a3 3 0 1 0 0 4.8L11 15a3 3 0 1 0 3-2Z" />
    </svg>
  )
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" className="inline h-4 w-4" aria-hidden="true">
      <path fill="currentColor" d="M9 3h2v7.6l2.8-2.8 1.4 1.4L10 14.4 4.8 9.2l1.4-1.4L9 10.6V3Zm-5 13h12v2H4v-2Z" />
    </svg>
  )
}
