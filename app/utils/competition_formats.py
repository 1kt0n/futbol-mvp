"""
Formatos de competencia declarados como DATOS (no hay editor de estructura en UI).

Cada formato describe zonas, canchas y TODOS los partidos con su horario, cancha
y la *fuente* de cada lado. El seed (`scripts/seed_competition.py`) lo vuelca a
las tablas `competition_*`; el motor (`competition_engine.py`) resuelve las
fuentes a equipos reales a medida que avanza el torneo.

Gramática de fuentes (ver `competition_engine.parse_source`):
  SLOT:A:1        → equipo sorteado en la posición 1 de la Zona A
  GROUP:A:1       → 1° de la Zona A (requiere fase de grupos CERRADA)
  THIRD:n         → n-ésimo mejor 3° de la tabla general de terceros
  FOURTH:n        → n-ésimo mejor 4° de la tabla general de cuartos
  WINNER:<code>   → ganador del partido <code> (goles; si empate, penales)
  LOSER:<code>    → perdedor del partido <code>
"""

# ============================================================
# Copa Proud Sudamericana 2026 — 28 equipos, 7 zonas, 6 canchas
# Fuente: "Copa Proud Sudamericana 2026 - Cronograma.pdf" + Reglamento (borrador).
# ============================================================

_SAT = "2026-10-10"
_SUN = "2026-10-11"

# Sábado: grilla horario x cancha (Cancha 1..6), tal cual el PDF.
# ⚠️ SUPUESTO 1: a las 13:30 en Cancha 6 el PDF dice "Eq. 2 vs 3 (Zona E)", pero ese
# cruce se repite a las 16:40 y a la Zona E le falta "2 vs 4". Se carga 2 vs 4.
_SAT_GRID = [
    ("11:00", ["A:1v2", "A:3v4", "B:1v2", "B:3v4", "C:1v2", "C:3v4"]),
    ("11:50", ["D:1v2", "D:3v4", "E:1v2", "E:3v4", "F:1v2", "F:3v4"]),
    ("12:40", ["G:1v2", "G:3v4", "A:1v3", "A:2v4", "B:1v3", "B:2v4"]),
    ("13:30", ["C:1v3", "C:2v4", "D:1v3", "D:2v4", "E:1v3", "E:2v4"]),
    # 14:20 receso general de almuerzo
    ("15:00", ["F:1v3", "F:2v4", "G:1v3", "G:2v4", "A:1v4", "A:2v3"]),
    ("15:50", ["B:1v4", "B:2v3", "C:1v4", "C:2v3", "D:1v4", "D:2v3"]),
    ("16:40", ["E:1v4", "E:2v3", "F:1v4", "F:2v3", "G:1v4", "G:2v3"]),
]

# Domingo: grilla horario x cancha con códigos de partido (None = cancha libre).
_SUN_GRID = [
    ("11:00", ["ORO-O1", "ORO-O2", "BRONCE-O1", "BRONCE-O2", "BRONCE-O3", "BRONCE-O4"]),
    ("12:00", ["ORO-O3", "ORO-O4", "ORO-O5", "ORO-O6", "ORO-O7", "ORO-O8"]),
    ("13:00", ["PLATA-C1", "PLATA-C2", "PLATA-C3", "PLATA-C4", "BRONCE-C1", "BRONCE-C2"]),
    ("14:00", ["ORO-C1", "ORO-C2", "ORO-C3", "ORO-C4", "BRONCE-C3", "BRONCE-C4"]),
    ("15:00", ["PLATA-S1", "PLATA-S2", "BRONCE-S1", "BRONCE-S2", None, None]),
    ("16:00", ["ORO-S1", "ORO-S2", None, None, None, None]),
    ("17:00", ["PLATA-F", "BRONCE-F", None, None, None, None]),
    ("18:00", ["ORO-F", None, None, None, None, None]),
]

# Cruces eliminatorios: code → (stage, cup, home_source, away_source)
_KNOCKOUT = {
    # ---- COPA DE ORO: octavos ----
    # ⚠️ SUPUESTO 2: el PDF repite "Mejor 3°/2°G" en Oct 1 y Oct 3, y "2° Mejor 3°/2°F"
    # en Oct 2 y Oct 4. Se interpreta: Oct1 1°A vs Mejor 3°, Oct3 1°C vs 2°G,
    # Oct2 1°B vs 2° Mejor 3°, Oct4 1°D vs 2°F; y si un mejor 3° cae contra el 1° de
    # su propia zona, se intercambia con el 2°G / 2°F (ver `swap_rules`).
    "ORO-O1": ("R16", "ORO", "GROUP:A:1", "THIRD:1"),
    "ORO-O2": ("R16", "ORO", "GROUP:B:1", "THIRD:2"),
    "ORO-O3": ("R16", "ORO", "GROUP:C:1", "GROUP:G:2"),
    "ORO-O4": ("R16", "ORO", "GROUP:D:1", "GROUP:F:2"),
    "ORO-O5": ("R16", "ORO", "GROUP:E:1", "GROUP:C:2"),
    "ORO-O6": ("R16", "ORO", "GROUP:F:1", "GROUP:D:2"),
    "ORO-O7": ("R16", "ORO", "GROUP:G:1", "GROUP:E:2"),
    "ORO-O8": ("R16", "ORO", "GROUP:A:2", "GROUP:B:2"),
    # ⚠️ SUPUESTO 5: cuartos/semis/final secuenciales (el PDF no los escribe).
    "ORO-C1": ("QF", "ORO", "WINNER:ORO-O1", "WINNER:ORO-O2"),
    "ORO-C2": ("QF", "ORO", "WINNER:ORO-O3", "WINNER:ORO-O4"),
    "ORO-C3": ("QF", "ORO", "WINNER:ORO-O5", "WINNER:ORO-O6"),
    "ORO-C4": ("QF", "ORO", "WINNER:ORO-O7", "WINNER:ORO-O8"),
    "ORO-S1": ("SF", "ORO", "WINNER:ORO-C1", "WINNER:ORO-C2"),
    "ORO-S2": ("SF", "ORO", "WINNER:ORO-C3", "WINNER:ORO-C4"),
    "ORO-F": ("F", "ORO", "WINNER:ORO-S1", "WINNER:ORO-S2"),
    # ---- COPA DE PLATA: perdedores de octavos de Oro (cruces del PDF) ----
    "PLATA-C1": ("QF", "PLATA", "LOSER:ORO-O1", "LOSER:ORO-O2"),
    "PLATA-C2": ("QF", "PLATA", "LOSER:ORO-O3", "LOSER:ORO-O4"),
    "PLATA-C3": ("QF", "PLATA", "LOSER:ORO-O5", "LOSER:ORO-O6"),
    "PLATA-C4": ("QF", "PLATA", "LOSER:ORO-O7", "LOSER:ORO-O8"),
    "PLATA-S1": ("SF", "PLATA", "WINNER:PLATA-C1", "WINNER:PLATA-C2"),
    "PLATA-S2": ("SF", "PLATA", "WINNER:PLATA-C3", "WINNER:PLATA-C4"),
    "PLATA-F": ("F", "PLATA", "WINNER:PLATA-S1", "WINNER:PLATA-S2"),
    # ---- COPA DE BRONCE ---- (planilla "Cronograma.xlsx" de la organización, 2026-10-08)
    # Octavos: 4°A vs 7° mejor 3°, 4°B vs 4°G, 4°C vs 4°F, 4°D vs 4°E. Si el 7° mejor 3° es de la
    # Zona A (le tocaría su propia zona) se intercambia con el 4°G (ver `swap_rules`).
    "BRONCE-O1": ("R16", "BRONCE", "GROUP:A:4", "THIRD:7"),
    "BRONCE-O2": ("R16", "BRONCE", "GROUP:B:4", "GROUP:G:4"),
    "BRONCE-O3": ("R16", "BRONCE", "GROUP:C:4", "GROUP:F:4"),
    "BRONCE-O4": ("R16", "BRONCE", "GROUP:D:4", "GROUP:E:4"),
    # Cuartos: cada uno, un clasificado directo (3°..6° mejor 3°) vs el ganador de un octavo.
    "BRONCE-C1": ("QF", "BRONCE", "THIRD:3", "WINNER:BRONCE-O1"),
    "BRONCE-C2": ("QF", "BRONCE", "THIRD:4", "WINNER:BRONCE-O2"),
    "BRONCE-C3": ("QF", "BRONCE", "THIRD:5", "WINNER:BRONCE-O3"),
    "BRONCE-C4": ("QF", "BRONCE", "THIRD:6", "WINNER:BRONCE-O4"),
    "BRONCE-S1": ("SF", "BRONCE", "WINNER:BRONCE-C1", "WINNER:BRONCE-C2"),
    "BRONCE-S2": ("SF", "BRONCE", "WINNER:BRONCE-C3", "WINNER:BRONCE-C4"),
    "BRONCE-F": ("F", "BRONCE", "WINNER:BRONCE-S1", "WINNER:BRONCE-S2"),
}


def _build_copa_proud_matches() -> list[dict]:
    matches = []
    for time_str, cells in _SAT_GRID:
        for venue_no, cell in enumerate(cells, start=1):
            group, pair = cell.split(":")
            a, b = pair.split("v")
            matches.append({
                "code": f"{group}-{a}v{b}",
                "stage": "GROUP",
                "cup": None,
                "group": group,
                "date": _SAT,
                "time": time_str,
                "venue": venue_no,
                "home_source": f"SLOT:{group}:{a}",
                "away_source": f"SLOT:{group}:{b}",
            })
    for time_str, cells in _SUN_GRID:
        for venue_no, code in enumerate(cells, start=1):
            if code is None:
                continue
            stage, cup, home, away = _KNOCKOUT[code]
            matches.append({
                "code": code,
                "stage": stage,
                "cup": cup,
                "group": None,
                "date": _SUN,
                "time": time_str,
                "venue": venue_no,
                "home_source": home,
                "away_source": away,
            })
    return matches


COPA_PROUD_2026 = {
    "slug": "copa-proud-2026",
    "name": "Copa Proud Sudamericana 2026",
    "starts_on": _SAT,
    "ends_on": _SUN,
    # Hora local del predio. ⚠️ Confirmar zona horaria de la sede.
    "utc_offset": "-03:00",
    "match_minutes": 40,
    "groups": ["A", "B", "C", "D", "E", "F", "G"],
    "group_size": 4,
    # Canchas reales del predio (2026-10-07): columna 1..6 de las grillas → cancha 9, 10, 11, 13,
    # 14 y 15 (de 11 a 19, sábado y domingo). El número es el que se ve en el sitio y en el veedor.
    "venues": ["Cancha 9", "Cancha 10", "Cancha 11", "Cancha 13", "Cancha 14", "Cancha 15"],
    "venue_numbers": [9, 10, 11, 13, 14, 15],
    "settings": {
        # Reglamento 5.2 (el PDF dice "empatado: o puntos" en el 3er ítem → es perdido: 0).
        "points": {"win": 3, "draw": 1, "loss": 0},
        # Reglamento 1.5 criterio 4: amarilla = 1, roja = 3 (menor puntaje gana).
        "fair_play": {"YELLOW": 1, "RED": 3},
        # Reglamento 5.5 / 5.21 / 7.4: W.O. = 3-0.
        "walkover_goals": 3,
        # Reglamento 7.9: goleador y valla menos vencida solo en fase clasificatoria.
        "stats_group_stage_only": True,
        # Transmisión del sorteo (la producción la cambia desde su panel; esto es el default).
        "broadcast": {"starts_at": "2026-10-06T22:15:00-03:00", "youtube_id": None, "spoiler_delay_s": 10},
    },
    # "Reglamento y Procedimiento del Sorteo Oficial" (recibido 2026-10-02): doble bombo por
    # tanda, máx. 2 extranjeros por zona, clubes con 2 equipos separados, regla de salto.
    # Las tandas se arman con los equipos cargados (país / nombre): ver competition_draw.build_tandas_preset.
    "draw_procedure": {
        "home_country": "AR",
        "max_foreign": 2,
        "pairs": [["Tercer Tiempo", "Cuarto Tiempo"], ["Rayos.cba", "Rayos.cba II"], ["Dogos", "Dogos Seniors"]],
        "tandas": [
            {"n": 1, "label": "Brasil", "ball": "GROUP", "select": {"countries": ["BR"]}, "expected": 5},
            {"n": 2, "label": "Uruguay", "ball": "GROUP", "select": {"countries": ["UY"]}, "expected": 3},
            {"n": 3, "label": "Resto de extranjeros", "ball": "GROUP", "select": {"foreign": True}, "expected": 4},
            {"n": 4, "label": "Parejas de agrupaciones", "ball": "GROUP", "select": {"pairs": True}, "expected": 6},
            {"n": 5, "label": "Resto de Argentina", "ball": "SLOT", "select": {"rest": True}, "expected": 10},
        ],
    },
    # Intercambio para evitar que un mejor 3° enfrente al 1° de su propia zona (SUPUESTO 2).
    # Cada regla: si el equipo en (match, side) es de la misma zona que su rival,
    # se intercambia con el equipo en (other_match, other_side).
    "swap_rules": [
        {"match": "ORO-O1", "side": "away", "other_match": "ORO-O3", "other_side": "away"},
        {"match": "ORO-O2", "side": "away", "other_match": "ORO-O4", "other_side": "away"},
        # Bronce: si el 7° mejor 3° es de la Zona A, pasa a O2 (vs 4°B) y el 4°G a O1 (vs 4°A).
        {"match": "BRONCE-O1", "side": "away", "other_match": "BRONCE-O2", "other_side": "away"},
    ],
    "matches": _build_copa_proud_matches(),
}

FORMATS = {
    COPA_PROUD_2026["slug"]: COPA_PROUD_2026,
}
