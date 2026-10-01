import { useI18n } from '../i18n/I18nProvider.jsx'

export function StatusChip({ match, className = '' }) {
  const { t } = useI18n()
  const s = match.status
  if (s === 'LIVE' || s === 'HALFTIME') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-live/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#ff7a98] ${className}`}>
        <span className="live-dot" aria-hidden="true" />
        {t(`status.${s}`)}
      </span>
    )
  }
  if (s === 'FINISHED' || s === 'WALKOVER') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white/60 ${className}`}>
        {t(`status.${s}`)}
        {match.confirmed && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-gold" aria-label={t('common.official')} role="img">
            <path fill="currentColor" d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5.1-5.1 1.1 1.1z" />
          </svg>
        )}
      </span>
    )
  }
  return (
    <span className={`board-num text-lg leading-none text-gold-light ${className}`}>{match.local?.time}</span>
  )
}
