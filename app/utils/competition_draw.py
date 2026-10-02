"""
Sorteo de zonas EN VIVO (lógica pura, sin DB): qué lugar le toca al equipo que sale del
bolillero, qué equipos pueden salir ahora y qué reglas se respetan.

Diseño versátil (bolillero y reglas todavía no definidos por la organización):
  - Orden de llenado: ROUND_ROBIN (A1, B1…G1, A2…) o BY_GROUP (A1–A4, B1–B4…).
  - Bombos opcionales: `pots` = {team_id: n}. Un equipo del bombo n solo va a la posición n.
    Sin bombos, un solo bolillero con todos.
  - Reglas opcionales (`rules`): hoy `separate_country` (no repetir país en una zona). Si no hay
    lugar que la cumpla, se usa el siguiente libre y se devuelve una advertencia: la producción decide.
  - Lugar elegido a mano (`requested`): siempre se respeta si está libre; las reglas solo avisan.

Formas: slots = {"A": {1: team_id|None, …}, …}; teams = [{id, country_code, …}].
"""
import secrets

ORDERS = ("ROUND_ROBIN", "BY_GROUP")


def slot_order(groups: list[str], size: int, mode: str = "ROUND_ROBIN") -> list[tuple[str, int]]:
    if mode == "BY_GROUP":
        return [(g, p) for g in groups for p in range(1, size + 1)]
    return [(g, p) for p in range(1, size + 1) for g in groups]


def placed_ids(slots: dict) -> set:
    return {t for pos in slots.values() for t in pos.values() if t}


def free_slots(order: list, slots: dict) -> list[tuple[str, int]]:
    return [(g, p) for g, p in order if not (slots.get(g) or {}).get(p)]


def next_slot(order: list, slots: dict):
    free = free_slots(order, slots)
    return free[0] if free else None


def remaining_teams(teams: list[dict], slots: dict) -> list[dict]:
    placed = placed_ids(slots)
    return [t for t in teams if t["id"] not in placed]


def eligible_teams(teams: list[dict], slots: dict, order: list, pots: dict | None) -> list[dict]:
    """Equipos que pueden salir ahora. Con bombos: los del bombo de la posición que se está llenando."""
    remaining = remaining_teams(teams, slots)
    if not pots:
        return remaining
    nxt = next_slot(order, slots)
    if not nxt:
        return []
    pos = nxt[1]
    in_pot = [t for t in remaining if pots.get(t["id"]) == pos]
    # Si a ese bombo no le quedan equipos (bombos desparejos), cualquiera sin bombo puede salir.
    return in_pot or [t for t in remaining if t["id"] not in pots]


def _group_countries(slots: dict, group: str, country: dict) -> set:
    return {country.get(t) for t in (slots.get(group) or {}).values() if t and country.get(t)}


def place(team: dict, slots: dict, order: list, *, pots: dict | None = None,
          rules: dict | None = None, country: dict | None = None,
          requested: tuple[str, int] | None = None) -> tuple[tuple[str, int] | None, list[str]]:
    """
    Lugar para `team`. Devuelve ((grupo, posición), advertencias). (None, [motivo]) si no hay lugar.
    `country`: team_id → código de país (para la regla de país).
    """
    rules = rules or {}
    country = country or {}
    warnings: list[str] = []
    cc = team.get("country_code")

    if requested:
        g, p = requested
        if (slots.get(g) or {}).get(p):
            return None, ["SLOT_TAKEN"]
        if pots and pots.get(team["id"]) and pots[team["id"]] != p:
            warnings.append("POT_POSITION_MISMATCH")
        if rules.get("separate_country") and cc and cc in _group_countries(slots, g, country):
            warnings.append("SAME_COUNTRY_IN_GROUP")
        return (g, p), warnings

    candidates = free_slots(order, slots)
    pot = (pots or {}).get(team["id"])
    if pot:
        candidates = [c for c in candidates if c[1] == pot] or candidates
    elif pots:
        # Sin bombo propio: la fila que se está llenando.
        row = candidates[0][1] if candidates else None
        candidates = [c for c in candidates if c[1] == row] or candidates
    if not candidates:
        return None, ["NO_FREE_SLOT"]

    if rules.get("separate_country") and cc:
        ok = [c for c in candidates if cc not in _group_countries(slots, c[0], country)]
        if ok:
            if ok[0] != candidates[0]:
                warnings.append("MOVED_BY_COUNTRY_RULE")
            return ok[0], warnings
        warnings.append("SAME_COUNTRY_IN_GROUP")
    return candidates[0], warnings


def digital_pick(teams: list[dict], slots: dict, order: list, pots: dict | None, rng=None) -> dict | None:
    """Sorteo digital (respaldo): un equipo al azar entre los que pueden salir ahora."""
    pool = eligible_teams(teams, slots, order, pots)
    if not pool:
        return None
    rng = rng or secrets.SystemRandom()
    return rng.choice(pool)
