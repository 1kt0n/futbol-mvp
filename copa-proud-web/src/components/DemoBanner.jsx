import { useI18n } from '../i18n/I18nProvider.jsx'
import { IS_DEMO } from '../lib/mode.js'

/** Franja fija "MODO DEMO": imposible confundir el ensayo con el torneo real. */
export function DemoBanner() {
  const { t } = useI18n()
  if (!IS_DEMO) return null
  return (
    <div
      role="status"
      className="relative z-40 px-4 py-1.5 text-center text-[11px] font-extrabold uppercase tracking-[0.18em] text-night"
      style={{ background: 'repeating-linear-gradient(-45deg, #ffc000 0 14px, #f6d381 14px 28px)' }}
    >
      {t('demo.banner')}
    </div>
  )
}
