import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { flag, initials, sourceLabel } from '../lib/model.js'

const SIZES = {
  xs: 'h-5 w-5 text-[8px]',
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-16 w-16 text-base',
  xl: 'h-28 w-28 text-2xl',
}

/** Escudo del equipo; si no hay imagen (o falla), iniciales sobre el color del equipo. */
export function Crest({ team, size = 'md', className = '' }) {
  const [broken, setBroken] = useState(false)
  const box = SIZES[size]
  if (team?.logo_url && !broken) {
    return (
      <img
        src={team.logo_url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={`${box} shrink-0 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${className}`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-grid shrink-0 place-items-center rounded-full font-extrabold text-white ring-1 ring-white/15 ${className}`}
      style={{ background: team?.color || 'linear-gradient(135deg, var(--cp-violet-glow), var(--cp-indigo-700))' }}
    >
      {team ? initials(team.name) : ''}
    </span>
  )
}

/** Equipo (escudo + nombre) o, si todavía no se definió, de dónde sale ("1° Zona A"). */
export function TeamLine({ team, source, pendingReason, size = 'sm', link = true, strong = false, wrap = false, className = '' }) {
  const { t } = useI18n()
  if (!team) {
    return (
      <span className={`flex min-w-0 items-center gap-2 ${className}`}>
        <span className={`${SIZES[size]} shrink-0 rounded-full border border-dashed border-white/25`} aria-hidden="true" />
        <span className="truncate text-sm italic text-white/55">
          {sourceLabel(source, t)}
          {pendingReason === 'TIE_NEEDS_DRAW' && <span className="ml-1 text-gold-light not-italic">· {t('table.draw_pending')}</span>}
        </span>
      </span>
    )
  }
  const name = (
    <span className={`${wrap ? 'line-clamp-2 leading-tight' : 'truncate'} ${strong ? 'font-extrabold text-white' : 'font-semibold text-white/90'}`}>
      {team.name}
      {team.country_code && <span className="ml-1.5 text-[0.85em]" aria-hidden="true">{flag(team.country_code)}</span>}
    </span>
  )
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <Crest team={team} size={size} />
      {link ? (
        <Link to={`/equipos/${team.id}`} className={`focus-ring min-w-0 rounded hover:text-gold-light ${wrap ? '' : 'truncate'}`}>
          {name}
        </Link>
      ) : (
        name
      )}
    </span>
  )
}
