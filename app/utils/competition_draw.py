"""
Sorteo de zonas EN VIVO (lógica pura, sin DB): qué lugar le toca al equipo que sale del
bolillero, qué equipos pueden salir ahora y qué reglas se respetan.

Dos familias de modos:

1) TANDAS — el procedimiento OFICIAL ("Reglamento y Procedimiento del Sorteo Oficial", 2026-10):
   doble bombo por tanda (uno de equipos y uno paralelo de bolillas de zona o de casillero).
     - `pots` = {team_id: n° de tanda}. Solo salen equipos de la tanda en curso (la menor con
       equipos sin ubicar). `tandas` = {"n": {"label", "ball": "GROUP"|"SLOT"}}.
     - Bolilla de ZONA (tandas 1–4): el equipo va a esa zona, en la primera posición libre.
       Las bolillas que ya salieron en la tanda no vuelven al bombo (se avisa si se repite una).
     - Bolilla de CASILLERO (tanda 5): zona + posición exactas entre los casilleros libres.
     - Reglas (`rules`): `max_foreign` por zona (extranjero = país ≠ `home_country`) y `pairs`
       (equipos del mismo club que no pueden compartir zona).
     - REGLA DE SALTO: si la zona de la bolilla no se puede usar (cupo de extranjeros lleno,
       está su pareja o no tiene lugar), el equipo pasa a la zona inmediata siguiente en orden
       alfabético (A → B … G → A) que sí cumpla. La bolilla queda usada.
2) ROUND_ROBIN / BY_GROUP — sorteo genérico (versión anterior, por si cambia el procedimiento):
     - Orden de llenado: A1, B1…G1, A2… o A1–A4, B1–B4…
     - Bombos opcionales: un equipo del bombo n solo va a la posición n.
     - Regla opcional `separate_country`: solo avisa / corre al siguiente lugar.
   En los dos, el lugar elegido a mano (`requested`) se respeta si está libre.

Formas: slots = {"A": {1: team_id|None, …}, …}; teams = [{id, country_code, …}].
"""
import secrets

ORDERS = ("ROUND_ROBIN", "BY_GROUP")
MODES = ORDERS + ("TANDAS",)


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


# ============================================================
# Procedimiento oficial por TANDAS
# ============================================================

def is_foreign(team: dict, home_country: str | None) -> bool:
    cc = team.get("country_code")
    return bool(cc and home_country and cc != home_country)


def tanda_of(team_id: str, pots: dict | None) -> int:
    """Tanda del equipo. Sin tanda asignada = después de todas (no queda nadie afuera)."""
    return int((pots or {}).get(team_id) or 999)


def current_tanda(teams: list[dict], slots: dict, pots: dict | None) -> int | None:
    remaining = remaining_teams(teams, slots)
    return min((tanda_of(t["id"], pots) for t in remaining), default=None)


def tanda_teams(teams: list[dict], slots: dict, pots: dict | None) -> list[dict]:
    """Los que pueden salir ahora: los que faltan de la tanda en curso."""
    cur = current_tanda(teams, slots, pots)
    if cur is None:
        return []
    return [t for t in remaining_teams(teams, slots) if tanda_of(t["id"], pots) == cur]


def ball_kind(tandas: dict | None, n: int | None) -> str:
    return ((tandas or {}).get(str(n)) or {}).get("ball", "GROUP")


def slot_ball(group: str, position: int) -> str:
    return f"{group}{position}"


def balls_drawn(picks: list[dict], n: int | None) -> list[str]:
    """Bolillas que ya salieron en la tanda `n` (las de zona no vuelven al bombo)."""
    return [p["ball"] for p in picks if p.get("tanda") == n and p.get("ball")]


def balls_left(groups: list[str], slots: dict, picks: list[dict], n: int | None, kind: str) -> list[str]:
    if n is None:
        return []
    if kind == "SLOT":
        return [slot_ball(g, p) for g in groups for p in sorted((slots.get(g) or {})) if not slots[g][p]]
    drawn = set(balls_drawn(picks, n))
    return [g for g in groups if g not in drawn]


def partners_of(team_id: str, pairs: list | None) -> set:
    out = set()
    for pair in pairs or []:
        if team_id in pair:
            out.update(t for t in pair if t != team_id)
    return out


def group_issue(team: dict, group: str, slots: dict, *, foreign_ids: set, max_foreign: int | None,
                partners: set) -> str | None:
    """Por qué `team` NO puede ir a `group` (None = puede)."""
    cells = slots.get(group) or {}
    if all(cells.values()):
        return "GROUP_FULL"
    members = {t for t in cells.values() if t}
    if max_foreign is not None and team["id"] in foreign_ids and len(members & foreign_ids) >= max_foreign:
        return "FOREIGN_LIMIT"
    if partners & members:
        return "SAME_CLUB"
    return None


def first_free_position(slots: dict, group: str) -> int | None:
    cells = slots.get(group) or {}
    return next((p for p in sorted(cells) if not cells[p]), None)


def place_tandas(team: dict, slots: dict, groups: list[str], *, ball: str, kind: str = "GROUP",
                 foreign_ids: set | None = None, max_foreign: int | None = None, pairs: list | None = None,
                 force_slot: tuple[str, int] | None = None) -> dict:
    """
    Ubica a `team` según la bolilla que salió. Devuelve
      {"slot": (zona, pos) | None, "jump": {...} | None, "warnings": [...], "error": str | None}
    - kind GROUP: `ball` = letra de zona. Regla de salto si la zona no se puede usar.
    - kind SLOT:  `ball` = casillero "B3" (zona + posición exactas).
    - force_slot: la producción ubica a mano (sin reglas); solo se avisa lo que no cumple.
    """
    foreign_ids = foreign_ids or set()
    partners = partners_of(team["id"], pairs)

    def issue(g):
        return group_issue(team, g, slots, foreign_ids=foreign_ids, max_foreign=max_foreign, partners=partners)

    if force_slot:
        g, p = force_slot
        if (slots.get(g) or {}).get(p):
            return {"slot": None, "jump": None, "warnings": [], "error": "SLOT_TAKEN"}
        why = issue(g)
        return {"slot": (g, p), "jump": None, "warnings": ["MANUAL_PLACEMENT"] + ([why] if why else []), "error": None}

    if kind == "SLOT":
        g, p = ball[:1], int(ball[1:] or 0)
        if g not in slots or p not in slots[g]:
            return {"slot": None, "jump": None, "warnings": [], "error": "INVALID_SLOT"}
        if slots[g][p]:
            return {"slot": None, "jump": None, "warnings": [], "error": "SLOT_TAKEN"}
        why = issue(g)
        return {"slot": (g, p), "jump": None, "warnings": [why] if why else [], "error": None}

    if ball not in groups:
        return {"slot": None, "jump": None, "warnings": [], "error": "INVALID_SLOT"}
    i = groups.index(ball)
    first = issue(ball)
    for g in groups[i:] + groups[:i]:
        if issue(g) is None:
            jump = None
            if g != ball:
                jump = {"from": ball, "to": g, "reason": first}
                if first == "SAME_CLUB":
                    jump["partner_id"] = next(iter(partners & set((slots.get(ball) or {}).values())), None)
            return {"slot": (g, first_free_position(slots, g)), "jump": jump, "warnings": [], "error": None}
    return {"slot": None, "jump": None, "warnings": [], "error": "NO_VALID_GROUP"}


def digital_tanda_pick(teams: list[dict], slots: dict, groups: list[str], picks: list[dict],
                       pots: dict | None, tandas: dict | None, rng=None) -> tuple[dict, str] | None:
    """Sorteo digital (respaldo) por tandas: un equipo y una bolilla al azar del bombo en curso."""
    pool = tanda_teams(teams, slots, pots)
    if not pool:
        return None
    rng = rng or secrets.SystemRandom()
    n = current_tanda(teams, slots, pots)
    balls = balls_left(groups, slots, picks, n, ball_kind(tandas, n))
    if not balls:
        # Se acabaron las bolillas de zona antes que los equipos (tanda más grande que 7):
        # se vuelven a usar todas.
        balls = groups if ball_kind(tandas, n) == "GROUP" else []
    if not balls:
        return None
    return rng.choice(pool), rng.choice(balls)


# Procedimiento oficial: quién va en cada tanda. Se arma con los equipos cargados (país y
# nombre), así sirve para la competencia real y para la demo.
def _norm(name: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in s if ch.isalnum())


def build_tandas_preset(teams: list[dict], procedure: dict) -> dict:
    """
    `procedure` (del formato): {home_country, max_foreign, pairs: [[nombre, nombre]…],
    tandas: [{n, label, ball, select: {"countries": [...]} | {"foreign": True} | {"pairs": True} | {"rest": True}}]}.
    Devuelve {pots, tandas, rules, problems}. Cada equipo va a la PRIMERA tanda que lo selecciona.
    """
    home = procedure.get("home_country")
    by_norm = {_norm(t["name"]): t["id"] for t in teams}
    pairs, problems = [], []
    for a, b in procedure.get("pairs", []):
        ia, ib = by_norm.get(_norm(a)), by_norm.get(_norm(b))
        if ia and ib:
            pairs.append([ia, ib])
        else:
            problems.append({"code": "PAIR_NOT_FOUND", "pair": [a, b]})
    in_pairs = {t for p in pairs for t in p}

    pots: dict = {}
    tandas: dict = {}
    for spec in procedure.get("tandas", []):
        n, sel = int(spec["n"]), spec.get("select", {})
        tandas[str(n)] = {"label": spec.get("label", f"Tanda {n}"), "ball": spec.get("ball", "GROUP")}
        for t in teams:
            if t["id"] in pots:
                continue
            cc = t.get("country_code")
            if (("countries" in sel and cc in sel["countries"])
                    or (sel.get("foreign") and is_foreign(t, home))
                    or (sel.get("pairs") and t["id"] in in_pairs)
                    or sel.get("rest")):
                pots[t["id"]] = n
        expected = spec.get("expected")
        got = sum(1 for v in pots.values() if v == n)
        if expected is not None and got != expected:
            problems.append({"code": "TANDA_COUNT", "tanda": n, "expected": expected, "got": got})
    missing = [t["name"] for t in teams if t["id"] not in pots]
    if missing:
        problems.append({"code": "TEAMS_WITHOUT_TANDA", "teams": missing})
    rules = {"max_foreign": procedure.get("max_foreign"), "home_country": home, "pairs": pairs}
    return {"pots": pots, "tandas": tandas, "rules": rules, "problems": problems}
