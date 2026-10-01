import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'

export default function NotFound() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <img src="/brand/mark.webp" alt="" className="h-24 w-24 object-contain opacity-70" />
      <p className="text-lg font-bold">{t('common.not_found')}</p>
      <Link to="/" className="focus-ring rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-night">
        {t('common.back_home')}
      </Link>
    </div>
  )
}
