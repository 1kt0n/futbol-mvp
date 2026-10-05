import { useI18n } from '../i18n/I18nProvider.jsx'

// Sponsors del sorteo. Los logos están preparados para fondo oscuro (public/sponsors/):
// Nutrishop sin el damero que traía pegado y American Top pasado a blanco.
export const SPONSORS = [
  { name: 'Nutrishop', logo: '/sponsors/nutrishop.webp', ratio: 900 / 132 },
  { name: 'American Top Underwear', logo: '/sponsors/american-top.webp', ratio: 900 / 115 },
]

/**
 * "Con el apoyo de" + logos. `height` = alto de cada logo (número en px, o CSS como '3.6vh').
 * `stack` los pone uno abajo del otro (lugares angostos).
 */
export function Sponsors({ height = 40, gap = 32, stack = false, label = true, align = 'center', className = '', labelClassName = '' }) {
  const { t } = useI18n()
  const h = typeof height === 'number' ? `${height}px` : height
  const g = typeof gap === 'number' ? `${gap}px` : gap
  const justify = align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center'
  return (
    <div className={className} style={{ textAlign: align === 'start' ? 'left' : align === 'end' ? 'right' : 'center' }}>
      {label && <div className={`kicker mb-[0.6em] text-white/60 ${labelClassName}`}>{t('draw.sponsors')}</div>}
      <div className={`flex ${stack ? 'flex-col' : 'flex-row flex-wrap'} items-center`} style={{ gap: g, justifyContent: justify, alignItems: stack ? justify : 'center' }}>
        {SPONSORS.map((s) => (
          <img key={s.name} src={s.logo} alt={s.name} title={s.name} style={{ height: h, width: 'auto', maxWidth: '100%' }} className="object-contain" />
        ))}
      </div>
    </div>
  )
}
