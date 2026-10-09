// Álbumes de "Reviví tu partido" cruzados con el modelo del torneo. Puro (albums.test.js).

/** Partido del álbum (si está vinculado a uno que existe). */
export function albumMatch(album, model) {
  return album.link?.type === 'match' ? model.matchByCode.get(album.link.code) || null : null
}

/** Equipos del álbum: los dos del partido o el del álbum de equipo. */
export function albumTeamIds(album, model) {
  const m = albumMatch(album, model)
  if (m) return [m.home.team_id, m.away.team_id].filter(Boolean)
  if (album.link?.type === 'team' && model.teamById.has(album.link.team_id)) return [album.link.team_id]
  return []
}

/**
 * Secciones para mostrar: un bloque por día con los álbumes de partidos (el día y el partido más
 * recientes primero: lo último que se jugó es lo que más se busca), después los de equipos y al
 * final los generales. Con teamId, solo los álbumes de ese equipo.
 */
export function groupAlbums(albums, model, teamId = null) {
  const days = new Map()
  const teams = []
  const more = []
  for (const a of albums) {
    if (teamId && !albumTeamIds(a, model).includes(teamId)) continue
    const m = albumMatch(a, model)
    if (m?.local) {
      if (!days.has(m.local.date)) days.set(m.local.date, [])
      days.get(m.local.date).push({ album: a, match: m })
    } else if (albumTeamIds(a, model).length) {
      teams.push({ album: a, match: null })
    } else {
      more.push({ album: a, match: null })
    }
  }
  const sections = [...days.entries()]
    .sort(([x], [y]) => (x < y ? 1 : -1))
    .map(([date, items]) => ({
      key: date,
      kind: 'day',
      date,
      items: items.sort((x, y) => y.match.local.ms - x.match.local.ms || (x.match.venue ?? 0) - (y.match.venue ?? 0)),
    }))
  const byName = (x, y) => x.album.name.localeCompare(y.album.name)
  if (teams.length) sections.push({ key: 'teams', kind: 'teams', items: teams.sort(byName) })
  if (more.length) sections.push({ key: 'more', kind: 'more', items: more.sort((x, y) => Number(y.album.is_root) - Number(x.album.is_root) || byName(x, y)) })
  return sections
}

/** Cuántos álbumes tiene cada equipo (para el selector "Buscá tu equipo"). */
export function albumsPerTeam(albums, model) {
  const out = new Map()
  for (const a of albums) for (const id of albumTeamIds(a, model)) out.set(id, (out.get(id) || 0) + 1)
  return out
}

/** "Juan Pérez · @juanfoto" → {text, instagram: 'juanfoto'} para linkear el usuario. */
export function parseCredit(credit) {
  if (!credit) return null
  const ig = /@([A-Za-z0-9._]{2,30})/.exec(credit)
  return { text: credit, instagram: ig ? ig[1] : null }
}
