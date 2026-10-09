import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { DONE, LIVE, matchLabel, sourceLabel } from '../lib/model.js'
import { SectionTitle } from '../components/Layout.jsx'
import { Crest } from '../components/TeamBadge.jsx'
import { useAlbum, useGallery } from '../gallery/useGallery.js'
import { albumMatch, albumsPerTeam, groupAlbums, parseCredit } from '../gallery/albums.js'
import { AlbumCard, photoCount } from '../gallery/AlbumCard.jsx'
import { DownloadIcon, Lightbox, ShareIcon } from '../gallery/Lightbox.jsx'
import { Photo } from '../gallery/Photo.jsx'
import { embedUrl } from '../gallery/photoUrl.js'

const TEAM_KEY = 'cp.relive.team'
const readTeam = () => {
  try {
    return localStorage.getItem(TEAM_KEY) || ''
  } catch {
    return ''
  }
}
const saveTeam = (id) => {
  try {
    if (id) localStorage.setItem(TEAM_KEY, id)
    else localStorage.removeItem(TEAM_KEY)
  } catch {
    /* modo privado: no se recuerda */
  }
}

/** Compartir con el menú del teléfono; si no hay, copiar el link. */
function useShare() {
  const { t } = useI18n()
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])
  const share = async (url, title) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast(t('relive.copied'))
    } catch {
      window.prompt(t('relive.share'), url)
    }
  }
  const node = toast && (
    <div role="status" className="fixed inset-x-0 bottom-6 z-[60] mx-auto w-fit rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-night shadow-xl">
      {toast}
    </div>
  )
  return { share, toast: node }
}

/** Pestaña "Reviví tu partido": las fotos del fotógrafo oficial, álbum por partido. */
export default function Relive() {
  const { albumId } = useParams()
  return albumId ? <AlbumView albumId={albumId} /> : <AlbumList />
}

function Credit({ credit }) {
  const { t } = useI18n()
  const c = parseCredit(credit)
  if (!c) return null
  return (
    <p className="text-xs text-white/55 sm:text-right">
      <span className="block font-bold uppercase tracking-wider text-white/40">{t('relive.photographer')}</span>
      {c.instagram ? (
        <a href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer" className="focus-ring rounded font-bold text-white/85 hover:text-gold">
          {c.text}
        </a>
      ) : (
        <span className="font-bold text-white/85">{c.text}</span>
      )}
    </p>
  )
}

// ------------------------------------------------------------------ lista de álbumes

function AlbumList() {
  const { t, locale } = useI18n()
  const { model } = useCompetition()
  const { data, status } = useGallery()
  const [params, setParams] = useSearchParams()
  const teamId = params.get('equipo') || ''

  // Sin ?equipo= en el link: el último equipo elegido en este teléfono.
  useEffect(() => {
    if (!params.has('equipo')) {
      const saved = readTeam()
      if (saved && model.teamById.has(saved)) setParams({ equipo: saved }, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const albums = useMemo(() => data?.albums || [], [data])
  const perTeam = useMemo(() => albumsPerTeam(albums, model), [albums, model])
  const sections = useMemo(() => groupAlbums(albums, model, teamId || null), [albums, model, teamId])
  const team = teamId ? model.teamById.get(teamId) : null
  const teams = useMemo(() => [...model.teams].sort((a, b) => a.name.localeCompare(b.name, locale)), [model.teams, locale])

  const pickTeam = (id) => {
    saveTeam(id)
    setParams(id ? { equipo: id } : {}, { replace: true })
  }
  const dayTitle = (date) => {
    const s = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  return (
    <>
      <SectionTitle kicker={t('relive.kicker')} title={t('relive.title')}>
        <Credit credit={data?.credit} />
      </SectionTitle>

      {data?.mode === 'embed' ? (
        <EmbedView data={data} />
      ) : (
        <>
          <div className="reveal mb-6 flex flex-wrap items-center gap-3" style={{ '--i': 0 }}>
            <label className="card relative flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 sm:max-w-md">
              <Crest team={team} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">{t('relive.your_team')}</span>
                <span className="block truncate text-base font-extrabold">{team ? team.name : t('common.all_teams')}</span>
              </span>
              <span aria-hidden="true" className="text-white/50">▾</span>
              <select
                value={teamId}
                onChange={(e) => pickTeam(e.target.value)}
                aria-label={t('relive.your_team')}
                className="absolute inset-0 cursor-pointer opacity-0 [&>option]:bg-indigo-800 [&>option]:text-white"
              >
                <option value="">{t('common.all_teams')}</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}{perTeam.get(tm.id) ? ` · ${perTeam.get(tm.id)} 📷` : ''}
                  </option>
                ))}
              </select>
            </label>
            {team && (
              <button type="button" onClick={() => pickTeam('')} className="focus-ring rounded-full px-3 py-1.5 text-sm font-bold text-white/70 ring-1 ring-white/15 hover:bg-white/10">
                {t('common.all_teams')}
              </button>
            )}
            <p className="w-full text-xs text-white/45 sm:w-auto">{t('relive.tap_hint')}</p>
          </div>

          {status === 'loading' && !data && <p className="py-10 text-center text-sm text-white/50">{t('common.loading')}</p>}
          {status === 'error' && !data && <p className="card p-6 text-center text-sm text-white/60">{t('common.error')}</p>}

          {data && !sections.length && (
            <div className="card reveal flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="text-5xl" aria-hidden="true">📸</span>
              <p className="max-w-md text-lg font-extrabold">{team ? t('relive.empty_team', { team: team.name }) : t('relive.empty')}</p>
              <p className="max-w-md text-sm text-white/55">{t('relive.empty_hint')}</p>
            </div>
          )}

          <div className="space-y-10">
            {sections.map((s) => (
              <section key={s.key}>
                <SectionTitle
                  kicker={s.kind === 'day' ? photoCount(s.items.reduce((n, x) => n + x.album.count, 0), t) : null}
                  title={s.kind === 'day' ? dayTitle(s.date) : s.kind === 'teams' ? t('relive.teams_section') : t('relive.more')}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {s.items.map((x, i) => (
                    <AlbumCard key={x.album.id} album={x.album} match={x.match} i={i} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** Sin API key de Drive: la carpeta del fotógrafo embebida tal cual. */
function EmbedView({ data }) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden p-1.5">
        <iframe title={t('relive.title')} src={embedUrl(data.folder_id)} className="h-[70vh] w-full rounded-xl bg-white" loading="lazy" />
      </div>
      <a href={data.folder_url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-night">
        {t('relive.open_drive')} ↗
      </a>
    </div>
  )
}

// ------------------------------------------------------------------ un álbum

function AlbumView({ albumId }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const { data, status } = useAlbum(albumId)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { share, toast } = useShare()

  const photos = data?.photos || []
  const fotoId = params.get('foto')
  const index = fotoId ? photos.findIndex((p) => p.id === fotoId) : -1
  const album = data?.album
  const match = album ? albumMatch(album, model) : null
  const team = album?.link?.type === 'team' ? model.teamById.get(album.link.team_id) : null
  const title = match ? matchTitle(match, model, t) : team ? team.name : album?.is_root ? t('relive.more') : album?.name || ''

  const pageUrl = (photoId) => {
    const u = new URL(window.location.href)
    u.search = photoId ? `?foto=${encodeURIComponent(photoId)}` : ''
    return u.toString()
  }
  // Abrir una foto suma una entrada al historial: el "atrás" del teléfono cierra el visor.
  const openPhoto = (id) => setParams({ foto: id }, { state: { fromGrid: true } })
  const showPhoto = (i) => setParams({ foto: photos[i].id }, { replace: true, state: location.state })
  const closePhoto = () => (location.state?.fromGrid ? navigate(-1) : setParams({}, { replace: true }))

  if (status === 'not_found' || status === 'error') {
    return (
      <div className="card mx-auto mt-6 max-w-lg p-8 text-center">
        <p className="font-bold">{status === 'not_found' ? t('relive.not_found') : t('common.error')}</p>
        <Link to="/revivi" className="focus-ring mt-4 inline-block rounded-full bg-white px-4 py-2 text-sm font-extrabold text-night">← {t('relive.back')}</Link>
      </div>
    )
  }
  if (!data) return <p className="py-10 text-center text-sm text-white/50">{t('common.loading')}</p>

  return (
    <>
      <Link to="/revivi" className="focus-ring mb-4 inline-flex items-center gap-1 rounded text-sm font-bold text-white/60 hover:text-white">
        ← {t('relive.back')}
      </Link>

      <header className="reveal mb-5 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:flex-1">
          {match ? <MatchHeader match={match} /> : (
            <div className="flex items-center gap-3">
              {team && <Crest team={team} size="lg" />}
              <div>
                <div className="kicker mb-1">{team ? t('relive.team_album') : t('relive.kicker')}</div>
                <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
              </div>
            </div>
          )}
          <p className="mt-2 text-sm text-white/55">{photoCount(photos.length, t)} · {t('relive.tap_hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => share(pageUrl(null), title)} className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20">
            <ShareIcon /> {t('relive.share')}
          </button>
          <a href={data.folder_url} target="_blank" rel="noreferrer" title={t('relive.download_album_hint')} className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20">
            <DownloadIcon /> {t('relive.download_album')}
          </a>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-5">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => openPhoto(p.id)}
            aria-label={`${title} · ${i + 1}/${photos.length}`}
            className="focus-ring group relative aspect-square overflow-hidden rounded-md bg-white/5"
          >
            <Photo id={p.id} w={480} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          </button>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Credit credit={data.credit} />
      </div>

      {index >= 0 && (
        <Lightbox
          photos={photos}
          index={index}
          title={title}
          onIndex={showPhoto}
          onClose={closePhoto}
          onShare={(p) => share(pageUrl(p.id), title)}
        />
      )}
      {toast}
    </>
  )
}

function matchTitle(match, model, t) {
  const name = (s) => (s.team_id ? model.teamById.get(s.team_id)?.name : null) || sourceLabel(s.source, t)
  return `${name(match.home)} ${t('common.vs')} ${name(match.away)}`
}

function MatchHeader({ match }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const home = match.home.team_id ? model.teamById.get(match.home.team_id) : null
  const away = match.away.team_id ? model.teamById.get(match.away.team_id) : null
  const scored = DONE.has(match.status) || LIVE.has(match.status)
  const name = (tm, s) => (tm ? tm.name : sourceLabel(s.source, t))
  return (
    <div>
      <div className="kicker mb-2">
        {matchLabel(match.code, t)} · {match.local?.time} · {t('common.court_n', { n: match.venue })}
      </div>
      <div className="flex items-center gap-3">
        <Link to={home ? `/equipos/${home.id}` : '#'} className="focus-ring flex min-w-0 flex-1 items-center justify-end gap-2 rounded text-right">
          <span className="truncate text-lg font-extrabold sm:text-2xl">{name(home, match.home)}</span>
          <Crest team={home} size="lg" />
        </Link>
        <span className="board-num shrink-0 text-4xl text-gold sm:text-5xl">
          {scored ? <>{match.home_goals ?? 0}<span className="text-white/35">-</span>{match.away_goals ?? 0}</> : t('common.vs')}
        </span>
        <Link to={away ? `/equipos/${away.id}` : '#'} className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded">
          <Crest team={away} size="lg" />
          <span className="truncate text-lg font-extrabold sm:text-2xl">{name(away, match.away)}</span>
        </Link>
      </div>
    </div>
  )
}
