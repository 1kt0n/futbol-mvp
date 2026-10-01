import { useI18n } from '../i18n/I18nProvider.jsx'
import { useCompetition } from '../lib/CompetitionProvider.jsx'
import { cupRounds } from '../lib/model.js'
import { MatchCard } from './MatchCard.jsx'
import { Crest } from './TeamBadge.jsx'

const COL_W = 236
const GAP = 40
const SLOT_H = 112
const METAL = {
  ORO: { text: 'gold-text', line: '#ffc000', ring: 'ring-gold/60' },
  PLATA: { text: 'text-silver', line: '#c9cbd8', ring: 'ring-silver/60' },
  BRONCE: { text: 'text-bronze', line: '#d08a4e', ring: 'ring-bronze/60' },
}

/**
 * Posición vertical de cada partido: los que tienen "padres" dentro de la copa (WINNER/LOSER de
 * otro partido de la misma copa) se centran entre ellos; el resto toma el próximo hueco libre.
 * Sirve para llaves no perfectas como la de Bronce (cuartos 3 y 4 con clasificados directos).
 */
export function layoutBracket(rounds) {
  const inCup = new Set(rounds.flatMap((r) => r.matches.map((m) => m.code)))
  const y = new Map()
  const feeders = new Map()
  let nextLeaf = 0
  rounds.forEach((round) => {
    for (const m of round.matches) {
      const parents = [m.home.source, m.away.source]
        .map((s) => /^(?:WINNER|LOSER):(.+)$/.exec(s || '')?.[1])
        .filter((code) => code && inCup.has(code))
      feeders.set(m.code, parents)
      if (parents.length) y.set(m.code, parents.reduce((acc, c) => acc + y.get(c), 0) / parents.length)
      else y.set(m.code, nextLeaf++)
    }
  })
  return { y, feeders, slots: Math.max(nextLeaf, 1) }
}

export function Bracket({ cup }) {
  const { t } = useI18n()
  const { model } = useCompetition()
  const rounds = cupRounds(model, cup)
  const { y, feeders, slots } = layoutBracket(rounds)
  const colOf = new Map(rounds.flatMap((r, i) => r.matches.map((m) => [m.code, i])))
  const height = slots * SLOT_H
  const width = (rounds.length + 1) * (COL_W + GAP)
  const center = (code) => y.get(code) * SLOT_H + SLOT_H / 2
  const final = model.finals[cup]
  const champion = final?.winner_team_id ? model.teamById.get(final.winner_team_id) : null
  const metal = METAL[cup]

  return (
    <div className="scroll-x -mx-4 px-4 pb-4">
      <div className="relative" style={{ width, minWidth: width }}>
        {/* encabezados de ronda */}
        <div className="mb-3 flex" style={{ gap: GAP }}>
          {rounds.map((r) => (
            <div key={r.stage} style={{ width: COL_W }} className="kicker">
              {t(`stage.${r.stage}`)}
            </div>
          ))}
          <div style={{ width: COL_W }} className={`kicker ${metal.text}`}>
            {t('cup.champion')}
          </div>
        </div>

        <div className="relative" style={{ height }}>
          {/* conectores */}
          <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
            {rounds.flatMap((r, i) =>
              r.matches.flatMap((m) =>
                feeders.get(m.code).map((parent) => {
                  const x1 = colOf.get(parent) * (COL_W + GAP) + COL_W
                  const x2 = i * (COL_W + GAP)
                  const mid = x1 + GAP / 2
                  return (
                    <path
                      key={`${parent}-${m.code}`}
                      d={`M${x1},${center(parent)} H${mid} V${center(m.code)} H${x2}`}
                      fill="none"
                      stroke={metal.line}
                      strokeOpacity="0.35"
                      strokeWidth="1.5"
                    />
                  )
                }),
              ),
            )}
            {final && (
              <path
                d={`M${(rounds.length - 1) * (COL_W + GAP) + COL_W},${center(final.code)} H${rounds.length * (COL_W + GAP)}`}
                stroke={metal.line}
                strokeOpacity="0.6"
                strokeWidth="2"
              />
            )}
          </svg>

          {/* partidos */}
          {rounds.flatMap((r, i) =>
            r.matches.map((m) => (
              <div
                key={m.code}
                className="absolute"
                style={{ left: i * (COL_W + GAP), top: center(m.code), width: COL_W, transform: 'translateY(-50%)' }}
              >
                <MatchCard match={m} compact />
                <div className="mt-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {m.status === 'SCHEDULED' ? t('common.court_n', { n: m.venue }) : `${m.local?.time} · ${t('common.court_n', { n: m.venue })}`}
                </div>
              </div>
            )),
          )}

          {/* campeón */}
          {final && (
            <div
              className="absolute"
              style={{ left: rounds.length * (COL_W + GAP), top: center(final.code), width: COL_W, transform: 'translateY(-50%)' }}
            >
              <div className={`card flex items-center gap-3 p-3 ring-1 ${metal.ring}`}>
                {champion ? (
                  <>
                    <Crest team={champion} size="lg" />
                    <div className="min-w-0">
                      <div className={`kicker ${metal.text}`}>{t(`cup.${cup}`)}</div>
                      <div className="truncate font-extrabold">{champion.name}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <img src="/brand/mark.webp" alt="" className="h-14 w-14 object-contain opacity-80" />
                    <div className={`text-sm font-bold ${metal.text}`}>{t(`cup.${cup}`)}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
