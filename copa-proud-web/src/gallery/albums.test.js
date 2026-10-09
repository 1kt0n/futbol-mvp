import { describe, expect, it } from 'vitest'
import { albumsPerTeam, albumTeamIds, groupAlbums, parseCredit } from './albums.js'

const match = (code, date, time, ms, venue, home, away) => ({
  code,
  venue,
  local: { date, time, ms },
  home: { team_id: home },
  away: { team_id: away },
})
const matches = [
  match('A-1v2', '2026-10-10', '11:00', 1, 9, 't1', 't2'),
  match('A-3v4', '2026-10-10', '11:50', 2, 9, 't3', 't4'),
  match('ORO-F', '2026-10-11', '18:10', 3, 9, 't1', 't3'),
]
const model = {
  matchByCode: new Map(matches.map((m) => [m.code, m])),
  teamById: new Map(['t1', 't2', 't3', 't4'].map((id) => [id, { id }])),
}
const album = (id, link, extra = {}) => ({ id, name: id, link, count: 3, is_root: false, ...extra })
const albums = [
  album('sab1100', { type: 'match', code: 'A-1v2' }),
  album('sab1150', { type: 'match', code: 'A-3v4' }),
  album('final', { type: 'match', code: 'ORO-F' }),
  album('equipo1', { type: 'team', team_id: 't1' }),
  album('ambiente', null),
  album('raiz', null, { is_root: true }),
  album('fantasma', { type: 'match', code: 'Z-9v9' }),
]

describe('álbumes de Reviví tu partido', () => {
  it('equipos de cada álbum', () => {
    expect(albumTeamIds(albums[0], model)).toEqual(['t1', 't2'])
    expect(albumTeamIds(albums[3], model)).toEqual(['t1'])
    expect(albumTeamIds(albums[4], model)).toEqual([])
    expect(albumTeamIds(albums[6], model)).toEqual([])
  })

  it('agrupa por día (el más reciente primero), después equipos y generales', () => {
    const s = groupAlbums(albums, model)
    expect(s.map((x) => x.key)).toEqual(['2026-10-11', '2026-10-10', 'teams', 'more'])
    expect(s[1].items.map((x) => x.album.id)).toEqual(['sab1150', 'sab1100'])
    expect(s[3].items.map((x) => x.album.id)).toEqual(['raiz', 'ambiente', 'fantasma'])
  })

  it('filtra por equipo', () => {
    const s = groupAlbums(albums, model, 't1')
    expect(s.flatMap((x) => x.items.map((i) => i.album.id))).toEqual(['final', 'sab1100', 'equipo1'])
    expect(groupAlbums(albums, model, 't4').flatMap((x) => x.items.map((i) => i.album.id))).toEqual(['sab1150'])
    expect(albumsPerTeam(albums, model).get('t1')).toBe(3)
  })

  it('crédito con usuario de Instagram', () => {
    expect(parseCredit('Juan Pérez · @juan.foto')).toEqual({ text: 'Juan Pérez · @juan.foto', instagram: 'juan.foto' })
    expect(parseCredit('Estudio X')).toEqual({ text: 'Estudio X', instagram: null })
    expect(parseCredit('')).toBeNull()
  })
})
