import { useState } from 'react'
import { photoFallback, photoSrc } from './photoUrl.js'

/** Foto de Drive al ancho pedido; si el primer servidor de Google falla, prueba con el otro. */
export function Photo({ id, w, alt = '', className = '', ...rest }) {
  const [src, setSrc] = useState(() => photoSrc(id, w))
  const [failed, setFailed] = useState(false)
  if (failed) return <span aria-hidden="true" className={`block bg-white/5 ${className}`} />
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        const alt2 = photoFallback(id, w)
        if (src !== alt2) setSrc(alt2)
        else setFailed(true)
      }}
      className={className}
      {...rest}
    />
  )
}
