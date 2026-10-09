import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { DONE, LIVE, matchLabel, sourceLabel } from '../lib/model.js'
import { Crest } from '../components/TeamBadge.jsx'
import { Photo } from './Photo.jsx'

export const photoCount = (n, t) => (n === 1 ? t('relive.photo_one') : t('relive.photos_n', { n }))

/** Portada de un álbum: el partido (escudos, resultado, hora y cancha), el equipo o el nombre de la carpeta. */
export function AlbumCard({ album, match, i = 0 }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const team = album.link?.type === 'team' ? model.teamById.get(album.link.team_id) : null

  return (
    <Link
      to={`/revivi/${album.id}`}
      className="card reveal focus-ring group relative block overflow-hidden transition hover:-translate-y-0.5 hover:ring-1 hover:ring-gold/60"
      style={{ '--i': Math.min(i, 8) }}
    >
      <div className="relative aspect-[4/3] bg-white/5">
        {album.cover && (
          <Photo id={album.cover.id} w={720} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0220] via-[#0b0220]/35 to-transparent" />
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-extrabold text-white backdrop-blur">
          📷 {photoCount(album.count, t)}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-3">
          {match ? <MatchCaption match={match} /> : team ? <TeamCaption team={team} /> : (
            <p className="line-clamp-2 text-lg font-extrabold leading-tight drop-shadow">{album.is_root ? t('relive.more') : album.name}</p>
          )}
        </div>
      </div>
    </Link>
  )
}

function MatchCaption({ match }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const side = (s) => {
    const tm = s.team_id ? model.teamById.get(s.team_id) : null
    return { team: tm, name: tm ? tm.name : sourceLabel(s.source, t) }
  }
  const home = side(match.home)
  const away = side(match.away)
  const scored = DONE.has(match.status) || LIVE.has(match.status)
  return (
    <>
      <div className="flex items-center gap-2">
        <Crest team={home.team} size="sm" />
        <span className="min-w-0 flex-1 truncate text-right text-sm font-extrabold">{home.name}</span>
        <span className="board-num shrink-0 text-2xl leading-none text-gold">
          {scored ? <>{match.home_goals ?? 0}<span className="text-white/40">-</span>{match.away_goals ?? 0}</> : t('common.vs')}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{away.name}</span>
        <Crest team={away.team} size="sm" />
      </div>
      <p className="mt-1 text-center text-[11px] font-bold uppercase tracking-wider text-white/60">
        {match.local?.time} · {t('common.court_n', { n: match.venue })} · {matchLabel(match.code, t)}
      </p>
    </>
  )
}

function TeamCaption({ team }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2.5">
      <Crest team={team} size="md" />
      <div className="min-w-0">
        <p className="truncate text-lg font-extrabold leading-tight">{team.name}</p>
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">{t('relive.team_album')}</p>
      </div>
    </div>
  )
}
