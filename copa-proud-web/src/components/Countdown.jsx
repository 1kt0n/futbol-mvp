import { useI18n } from '../i18n/I18nProvider.jsx'
import { useNow } from '../lib/useNow.js'

const pad = (n) => String(n).padStart(2, '0')

/**
 * Cuenta regresiva en vivo hasta `target` (ms epoch): días · horas · min · seg, bajando cada
 * segundo. Vive en su propio componente para que el tic de cada segundo no re-renderice la página.
 * Al llegar a cero desaparece (el estado "en vivo" lo muestra el resto del sitio).
 */
export function Countdown({ target, label, className = '' }) {
  const { t } = useI18n()
  const now = useNow(1000)
  const diff = target - now
  if (!(diff > 0)) return null
  const title = label || t('home.starts_in')

  const total = Math.floor(diff / 1000)
  const parts = [
    { key: 'd', value: String(Math.floor(total / 86400)) },
    { key: 'h', value: pad(Math.floor((total % 86400) / 3600)) },
    { key: 'm', value: pad(Math.floor((total % 3600) / 60)) },
    { key: 's', value: pad(total % 60) },
  ]
  // Sin días restantes, no mostrar "0 días".
  const shown = parts[0].value === '0' ? parts.slice(1) : parts

  return (
    <div className={className} role="timer" aria-label={`${title} ${shown.map((p) => `${p.value} ${t(`countdown.${p.key}`)}`).join(' ')}`}>
      <div className="kicker mb-2">{title}</div>
      <div className="flex items-start gap-2 sm:gap-3" aria-hidden="true">
        {shown.map((p, i) => (
          <div key={p.key} className="flex items-start gap-2 sm:gap-3">
            {i > 0 && <span className="board-num pt-1 text-3xl leading-none text-white/25 sm:text-4xl">:</span>}
            <div className="flex min-w-[3.25rem] flex-col items-center rounded-xl bg-white/5 px-2 py-1.5 ring-1 ring-white/10 sm:min-w-[4rem]">
              {/* key = valor: cada cambio de número vuelve a montar el span y dispara el "tic" */}
              <span key={p.value} className="countdown-tick board-num text-4xl leading-none text-gold sm:text-5xl">
                {p.value}
              </span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{t(`countdown.${p.key}`)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
