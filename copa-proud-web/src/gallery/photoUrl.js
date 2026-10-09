// Fotos de "Reviví tu partido": viven en el Google Drive del fotógrafo (carpeta pública), no se
// copian. Google sirve las miniaturas del tamaño pedido y el original para "Descargar HD".
// VITE_GALLERY_IMG_URL permite apuntar a otro servidor de imágenes (pruebas locales).

const IMG = import.meta.env.VITE_GALLERY_IMG_URL || 'https://lh3.googleusercontent.com/d/{id}=w{w}'
const IMG_FALLBACK = 'https://drive.google.com/thumbnail?id={id}&sz=w{w}'

const fill = (tpl, id, w) => tpl.replace('{id}', encodeURIComponent(id)).replace('{w}', String(w))

export const photoSrc = (id, w) => fill(IMG, id, w)
export const photoFallback = (id, w) => fill(IMG_FALLBACK, id, w)
/** El archivo original tal como lo subió el fotógrafo. */
export const downloadUrl = (id) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
export const embedUrl = (folderId) => `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`

/** Ancho para ver una foto a pantalla completa: el de la pantalla real, en escalones de 400 px (más aciertos de caché). */
export function fullWidth() {
  if (typeof window === 'undefined') return 1600
  const px = window.innerWidth * (window.devicePixelRatio || 1)
  return Math.min(2400, Math.max(800, Math.ceil(px / 400) * 400))
}
