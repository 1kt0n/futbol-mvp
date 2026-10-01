"""
Motor de competencia (módulo `competitions`): PURO, sin DB ni FastAPI.

Recibe filas planas (dicts, como salen de `.mappings()`) y devuelve estructuras
planas. Así se testea sin base (`tests/test_competition_engine.py`) y los routers
solo hacen I/O.

Formas de los datos de entrada:
  match  = {code, stage, group, home_source, away_source, home_team_id, away_team_id,
            status, home_goals, away_goals, home_pens, away_pens}
  event  = {match_code, team_id, type, player_id?}
           type ∈ GOAL / OWN_GOAL / YELLOW / RED.
           `team_id` es SIEMPRE el equipo del jugador; un OWN_GOAL suma para el rival.
  slots  = {"A": {1: team_id, 2: team_id, ...}, ...}   (resultado del sorteo)
  draws  = {"GROUP:A": {team_id: rank}, "THIRD": {...}, "FOURTH": {...}}
           (desempate por sorteo, reglamento 1.5 criterio 5; menor rank gana)

Criterios de desempate (reglamento 1.5): Pts → DG → GF → Fair Play (menor) → Sorteo.
"""
from dataclasses import dataclass, field

FINISHED_STATUSES = frozenset({"FINISHED", "WALKOVER"})
PLAYED_STATUSES = frozenset({"LIVE", "HALFTIME", "FINISHED", "WALKOVER"})
EVENT_TYPES = frozenset({"GOAL", "OWN_GOAL", "YELLOW", "RED"})

# Motivos por los que una fuente todavía no se puede resolver (el front los traduce).
SLOT_UNASSIGNED = "SLOT_UNASSIGNED"
GROUP_STAGE_OPEN = "GROUP_STAGE_OPEN"
GROUP_INCOMPLETE = "GROUP_INCOMPLETE"
TIE_NEEDS_DRAW = "TIE_NEEDS_DRAW"
MATCH_PENDING = "MATCH_PENDING"
NO_WINNER = "NO_WINNER"

_DEFAULT_SETTINGS = {
    "points": {"win": 3, "draw": 1, "loss": 0},
    "fair_play": {"YELLOW": 1, "RED": 3},
}


# ============================================================
# Fuentes
# ============================================================

def parse_source(source: str) -> tuple:
    """'GROUP:A:1' → ('GROUP', 'A', 1). Lanza ValueError si es inválida."""
    parts = (source or "").split(":")
    kind = parts[0]
    try:
        if kind in ("SLOT", "GROUP") and len(parts) == 3 and parts[1]:
            pos = int(parts[2])
            if pos >= 1:
                return (kind, parts[1], pos)
        elif kind in ("THIRD", "FOURTH") and len(parts) == 2:
            rank = int(parts[1])
            if rank >= 1:
                return (kind, rank)
        elif kind in ("WINNER", "LOSER") and len(parts) == 2 and parts[1]:
            return (kind, parts[1])
    except ValueError:
        pass
    raise ValueError(f"Fuente inválida: {source!r}")


# ============================================================
# Resultado de un partido
# ============================================================

def _goals(v) -> int:
    return int(v) if v is not None else 0


def match_winner(match: dict):
    """Ganador de un partido terminado (goles; si empate, penales). None si no hay."""
    if match.get("status") not in FINISHED_STATUSES:
        return None
    home, away = match.get("home_team_id"), match.get("away_team_id")
    if not home or not away:
        return None
    hg, ag = _goals(match.get("home_goals")), _goals(match.get("away_goals"))
    if hg != ag:
        return home if hg > ag else away
    hp, ap = match.get("home_pens"), match.get("away_pens")
    if hp is not None and ap is not None and int(hp) != int(ap):
        return home if int(hp) > int(ap) else away
    return None


def match_loser(match: dict):
    winner = match_winner(match)
    if winner is None:
        return None
    return match["away_team_id"] if winner == match["home_team_id"] else match["home_team_id"]


def goal_tally(match: dict, events: list[dict]) -> tuple[int, int]:
    """Marcador que surge de los eventos de gol cargados (para detectar desfasajes)."""
    home, away = match.get("home_team_id"), match.get("away_team_id")
    h = a = 0
    for e in events:
        if e.get("match_code") != match["code"]:
            continue
        if e["type"] == "GOAL":
            h += e["team_id"] == home
            a += e["team_id"] == away
        elif e["type"] == "OWN_GOAL":
            h += e["team_id"] == away
            a += e["team_id"] == home
    return h, a


# ============================================================
# Tablas
# ============================================================

def _blank_row(team_id) -> dict:
    return {
        "team_id": team_id,
        "played": 0, "won": 0, "drawn": 0, "lost": 0,
        "goals_for": 0, "goals_against": 0, "goal_diff": 0,
        "points": 0, "yellow": 0, "red": 0, "fair_play": 0,
        "position": None, "tie_unresolved": False,
    }


def _perf_key(row: dict) -> tuple:
    return (-row["points"], -row["goal_diff"], -row["goals_for"], row["fair_play"])


def _order_rows(rows: list[dict], draw_ranks: dict) -> tuple[list[dict], list[list]]:
    """
    Ordena por criterios deportivos; los empates perfectos se rompen con el sorteo
    (`draw_ranks`). Si falta el sorteo, marca `tie_unresolved` y devuelve los grupos
    de equipos empatados para que la mesa central lo cargue.
    """
    rows = sorted(rows, key=lambda r: (_perf_key(r), str(r["team_id"])))
    ordered: list[dict] = []
    unresolved: list[list] = []
    i = 0
    while i < len(rows):
        j = i + 1
        while j < len(rows) and _perf_key(rows[j]) == _perf_key(rows[i]):
            j += 1
        tie = rows[i:j]
        if len(tie) > 1:
            ranks = [draw_ranks.get(r["team_id"]) for r in tie]
            if all(r is not None for r in ranks) and len(set(ranks)) == len(ranks):
                tie = sorted(tie, key=lambda r: draw_ranks[r["team_id"]])
            else:
                for r in tie:
                    r["tie_unresolved"] = True
                unresolved.append([r["team_id"] for r in tie])
        ordered.extend(tie)
        i = j
    for pos, r in enumerate(ordered, start=1):
        r["position"] = pos
    return ordered, unresolved


def compute_group_table(
    group: str,
    team_ids: list,
    matches: list[dict],
    events: list[dict],
    settings: dict | None = None,
    draw_ranks: dict | None = None,
) -> dict:
    """Tabla de una zona. Solo cuentan partidos FINISHED/WALKOVER (W.O. = marcador cargado)."""
    settings = settings or _DEFAULT_SETTINGS
    pts = settings["points"]
    fp_weights = settings["fair_play"]
    stats = {tid: _blank_row(tid) for tid in team_ids if tid}

    group_matches = [m for m in matches if m["stage"] == "GROUP" and m.get("group") == group]
    finished_codes = set()
    for m in group_matches:
        if m["status"] not in FINISHED_STATUSES:
            continue
        h, a = m.get("home_team_id"), m.get("away_team_id")
        if h not in stats or a not in stats:
            continue
        hg, ag = _goals(m.get("home_goals")), _goals(m.get("away_goals"))
        for tid, gf, ga in ((h, hg, ag), (a, ag, hg)):
            r = stats[tid]
            r["played"] += 1
            r["goals_for"] += gf
            r["goals_against"] += ga
            if gf > ga:
                r["won"] += 1
                r["points"] += pts["win"]
            elif gf == ga:
                r["drawn"] += 1
                r["points"] += pts["draw"]
            else:
                r["lost"] += 1
                r["points"] += pts["loss"]
        finished_codes.add(m["code"])

    for e in events:
        if e.get("match_code") not in finished_codes or e.get("team_id") not in stats:
            continue
        kind = e["type"]
        if kind in fp_weights:
            r = stats[e["team_id"]]
            r["fair_play"] += fp_weights[kind]
            if kind == "YELLOW":
                r["yellow"] += 1
            elif kind == "RED":
                r["red"] += 1

    for r in stats.values():
        r["goal_diff"] = r["goals_for"] - r["goals_against"]

    rows, unresolved = _order_rows(list(stats.values()), draw_ranks or {})
    complete = bool(group_matches) and all(m["status"] in FINISHED_STATUSES for m in group_matches)
    return {"group": group, "complete": complete, "rows": rows, "unresolved_ties": unresolved}


def rank_across_groups(tables: dict, position: int, draw_ranks: dict | None = None) -> dict:
    """
    Tabla general de los equipos que terminaron en `position` (p.ej. mejores terceros).
    Queda `blocked` si alguna zona no terminó o si su puesto `position` depende de un sorteo.
    """
    rows, blocked = [], []
    for group, table in sorted(tables.items()):
        if len(table["rows"]) < position:
            continue
        src = table["rows"][position - 1]
        if not table["complete"] or src["tie_unresolved"]:
            blocked.append(group)
        row = {k: src[k] for k in (
            "team_id", "played", "won", "drawn", "lost", "goals_for", "goals_against",
            "goal_diff", "points", "yellow", "red", "fair_play",
        )}
        row["group"] = group
        row["tie_unresolved"] = False
        rows.append(row)
    ordered, unresolved = _order_rows(rows, draw_ranks or {})
    for r in ordered:
        r["rank"] = r.pop("position")
    return {"position": position, "rows": ordered, "blocked_groups": blocked, "unresolved_ties": unresolved}


@dataclass
class Standings:
    tables: dict = field(default_factory=dict)   # group → table
    thirds: dict = field(default_factory=dict)
    fourths: dict = field(default_factory=dict)
    team_group: dict = field(default_factory=dict)  # team_id → group


def compute_standings(
    groups: list[str],
    slots: dict,
    matches: list[dict],
    events: list[dict],
    settings: dict | None = None,
    draws: dict | None = None,
) -> Standings:
    draws = draws or {}
    st = Standings()
    for g in groups:
        team_ids = [t for _, t in sorted((slots.get(g) or {}).items()) if t]
        for t in team_ids:
            st.team_group[t] = g
        st.tables[g] = compute_group_table(g, team_ids, matches, events, settings, draws.get(f"GROUP:{g}"))
    st.thirds = rank_across_groups(st.tables, 3, draws.get("THIRD"))
    st.fourths = rank_across_groups(st.tables, 4, draws.get("FOURTH"))
    return st


# ============================================================
# Resolución de fuentes y propagación de llaves
# ============================================================

def resolve_source(
    source: str,
    *,
    slots: dict,
    standings: Standings,
    matches_by_code: dict,
    group_stage_closed: bool,
) -> tuple:
    """Devuelve (team_id, None) o (None, MOTIVO)."""
    parsed = parse_source(source)
    kind = parsed[0]

    if kind == "SLOT":
        team = (slots.get(parsed[1]) or {}).get(parsed[2])
        return (team, None) if team else (None, SLOT_UNASSIGNED)

    if kind in ("GROUP", "THIRD", "FOURTH") and not group_stage_closed:
        return (None, GROUP_STAGE_OPEN)

    if kind == "GROUP":
        table = standings.tables.get(parsed[1])
        if not table or not table["complete"]:
            return (None, GROUP_INCOMPLETE)
        if len(table["rows"]) < parsed[2]:
            return (None, SLOT_UNASSIGNED)
        row = table["rows"][parsed[2] - 1]
        return (None, TIE_NEEDS_DRAW) if row["tie_unresolved"] else (row["team_id"], None)

    if kind in ("THIRD", "FOURTH"):
        ranking = standings.thirds if kind == "THIRD" else standings.fourths
        blocked = ranking.get("blocked_groups") or []
        if blocked:
            incomplete = any(not standings.tables[g]["complete"] for g in blocked)
            return (None, GROUP_INCOMPLETE if incomplete else TIE_NEEDS_DRAW)
        rows = ranking.get("rows", [])
        if len(rows) < parsed[1]:
            return (None, SLOT_UNASSIGNED)
        row = rows[parsed[1] - 1]
        return (None, TIE_NEEDS_DRAW) if row["tie_unresolved"] else (row["team_id"], None)

    # WINNER / LOSER
    ref = matches_by_code.get(parsed[1])
    if ref is None:
        raise ValueError(f"Fuente apunta a un partido inexistente: {source!r}")
    if ref["status"] not in FINISHED_STATUSES:
        return (None, MATCH_PENDING)
    team = match_winner(ref) if kind == "WINNER" else match_loser(ref)
    return (team, None) if team else (None, NO_WINNER)


def resolve_all(
    matches: list[dict],
    *,
    slots: dict,
    standings: Standings,
    group_stage_closed: bool,
    swap_rules: list[dict] | None = None,
) -> dict:
    """(code, side) → (team_id|None, motivo|None) para todos los partidos."""
    by_code = {m["code"]: m for m in matches}
    resolved = {}
    for m in matches:
        for side in ("home", "away"):
            resolved[(m["code"], side)] = resolve_source(
                m[f"{side}_source"], slots=slots, standings=standings,
                matches_by_code=by_code, group_stage_closed=group_stage_closed,
            )
    _apply_swap_rules(resolved, swap_rules or [], standings.team_group)
    return resolved


def _other(side: str) -> str:
    return "away" if side == "home" else "home"


def _apply_swap_rules(resolved: dict, rules: list[dict], team_group: dict) -> None:
    """Evita cruces entre equipos de la misma zona intercambiando con otro slot (in-place)."""
    for rule in rules:
        k1 = (rule["match"], rule["side"])
        k2 = (rule["other_match"], rule["other_side"])
        t1, t2 = resolved[k1][0], resolved[k2][0]
        opp1 = resolved[(rule["match"], _other(rule["side"]))][0]
        opp2 = resolved[(rule["other_match"], _other(rule["other_side"]))][0]
        if not (t1 and t2 and opp1 and opp2):
            continue
        g = team_group.get
        if g(t1) != g(opp1):
            continue
        # Solo intercambiar si el cambio no genera un nuevo cruce intra-zona.
        if g(t2) == g(opp1) or g(t1) == g(opp2):
            continue
        resolved[k1], resolved[k2] = resolved[k2], resolved[k1]


def plan_updates(
    matches: list[dict],
    *,
    slots: dict,
    standings: Standings,
    group_stage_closed: bool,
    swap_rules: list[dict] | None = None,
) -> dict:
    """
    Qué equipos hay que escribir en cada partido. Solo se tocan partidos SCHEDULED;
    si un partido ya empezado quedaría con otro equipo, se reporta como conflicto
    (la mesa central decide). Idempotente: correrlo dos veces no cambia nada.
    """
    resolved = resolve_all(
        matches, slots=slots, standings=standings,
        group_stage_closed=group_stage_closed, swap_rules=swap_rules,
    )
    by_code = {m["code"]: m for m in matches}
    updates, conflicts, pending = [], [], []
    for (code, side), (team, reason) in resolved.items():
        m = by_code[code]
        if reason:
            pending.append({"code": code, "side": side, "source": m[f"{side}_source"], "reason": reason})
        current = m.get(f"{side}_team_id")
        if team == current:
            continue
        if m["status"] == "SCHEDULED":
            updates.append({"code": code, "side": side, "team_id": team})
        else:
            conflicts.append({"code": code, "side": side, "current": current, "expected": team})
    return {"updates": updates, "conflicts": conflicts, "pending": pending}


def group_stage_close_check(
    matches: list[dict],
    *,
    slots: dict,
    standings: Standings,
    swap_rules: list[dict] | None = None,
) -> dict:
    """
    Vista previa de "Cerrar fase de grupos": qué cruces quedarían y qué lo bloquea
    (partidos sin terminar o empates que necesitan sorteo). No persiste nada.
    """
    unfinished = [m["code"] for m in matches if m["stage"] == "GROUP" and m["status"] not in FINISHED_STATUSES]
    resolved = resolve_all(
        matches, slots=slots, standings=standings,
        group_stage_closed=True, swap_rules=swap_rules,
    )
    blockers, preview = [], []
    for m in matches:
        if m["stage"] == "GROUP":
            continue
        row = {"code": m["code"]}
        for side in ("home", "away"):
            source = m[f"{side}_source"]
            if parse_source(source)[0] not in ("GROUP", "THIRD", "FOURTH"):
                continue
            team, reason = resolved[(m["code"], side)]
            row[side] = team
            if reason:
                blockers.append({"code": m["code"], "side": side, "source": source, "reason": reason})
        if len(row) > 1:
            preview.append(row)

    ties = []
    for g, t in sorted(standings.tables.items()):
        for tie in t["unresolved_ties"]:
            ties.append({"context": f"GROUP:{g}", "team_ids": tie})
    for ctx, ranking in (("THIRD", standings.thirds), ("FOURTH", standings.fourths)):
        for tie in ranking.get("unresolved_ties", []):
            ties.append({"context": ctx, "team_ids": tie})

    return {
        "can_close": not unfinished and not blockers,
        "unfinished_matches": unfinished,
        "blockers": blockers,
        "ties": ties,
        "preview": preview,
    }


# ============================================================
# Estadísticas (opcionales: dependen de que se carguen eventos con jugador)
# ============================================================

def top_scorers(matches: list[dict], events: list[dict], group_stage_only: bool = True) -> list[dict]:
    """Goleadores (reglamento 7.9: solo fase clasificatoria). Goles en contra no suman."""
    valid = {
        m["code"] for m in matches
        if m["status"] in PLAYED_STATUSES and (not group_stage_only or m["stage"] == "GROUP")
    }
    tally: dict = {}
    for e in events:
        if e["type"] != "GOAL" or not e.get("player_id") or e.get("match_code") not in valid:
            continue
        key = (e["player_id"], e["team_id"])
        tally[key] = tally.get(key, 0) + 1
    out = [{"player_id": p, "team_id": t, "goals": n} for (p, t), n in tally.items()]
    out.sort(key=lambda r: (-r["goals"], str(r["player_id"])))
    _assign_shared_rank(out, "goals")
    return out


def least_conceded(standings: Standings) -> list[dict]:
    """Valla menos vencida por equipo (fase de grupos)."""
    out = [
        {"team_id": r["team_id"], "group": g, "played": r["played"], "goals_against": r["goals_against"]}
        for g, t in standings.tables.items() for r in t["rows"]
    ]
    out.sort(key=lambda r: (r["goals_against"], -r["played"], str(r["team_id"])))
    _assign_shared_rank(out, "goals_against")
    return out


def fair_play_table(standings: Standings) -> list[dict]:
    out = [
        {"team_id": r["team_id"], "group": g, "yellow": r["yellow"], "red": r["red"], "fair_play": r["fair_play"]}
        for g, t in standings.tables.items() for r in t["rows"]
    ]
    out.sort(key=lambda r: (r["fair_play"], str(r["team_id"])))
    _assign_shared_rank(out, "fair_play")
    return out


def suspensions(matches: list[dict], events: list[dict]) -> list[dict]:
    """
    Jugadores expulsados (roja o doble amarilla en un mismo partido) → suspendidos
    al menos 1 fecha (reglamento 6.4). Solo informativo: la organización decide.
    """
    played = {m["code"] for m in matches if m["status"] in PLAYED_STATUSES}
    per: dict = {}
    for e in events:
        if not e.get("player_id") or e.get("match_code") not in played:
            continue
        if e["type"] not in ("YELLOW", "RED"):
            continue
        key = (e["player_id"], e["team_id"], e["match_code"])
        c = per.setdefault(key, {"YELLOW": 0, "RED": 0})
        c[e["type"]] += 1
    out = []
    for (player_id, team_id, code), c in per.items():
        if c["RED"] or c["YELLOW"] >= 2:
            out.append({
                "player_id": player_id,
                "team_id": team_id,
                "match_code": code,
                "reason": "RED" if c["RED"] else "DOUBLE_YELLOW",
            })
    return out


def _assign_shared_rank(rows: list[dict], key: str) -> None:
    """Ranking con empates compartidos (1, 2, 2, 4…) sobre filas ya ordenadas."""
    prev, rank = object(), 0
    for i, r in enumerate(rows, start=1):
        if r[key] != prev:
            rank, prev = i, r[key]
        r["rank"] = rank
