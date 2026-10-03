"""
Tests de la lógica del sorteo en vivo (app/utils/competition_draw.py). Sin base de datos.

Correr:  ./.venv/bin/python tests/test_competition_draw.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils import competition_draw as d  # noqa: E402

GROUPS = list("ABCDEFG")


def _teams(n=28, countries=None):
    countries = countries or ["AR", "BR", "UY", "PY"]
    return [{"id": f"t{i}", "country_code": countries[i % len(countries)]} for i in range(n)]


def _empty():
    return {g: {p: None for p in range(1, 5)} for g in GROUPS}


def test_round_robin_order():
    o = d.slot_order(GROUPS, 4)
    assert o[:8] == [("A", 1), ("B", 1), ("C", 1), ("D", 1), ("E", 1), ("F", 1), ("G", 1), ("A", 2)]
    assert len(o) == 28 and len(set(o)) == 28
    assert d.slot_order(GROUPS, 4, "BY_GROUP")[:5] == [("A", 1), ("A", 2), ("A", 3), ("A", 4), ("B", 1)]


def test_full_draw_fills_every_slot_once():
    teams, slots, order = _teams(), _empty(), d.slot_order(GROUPS, 4)
    rng = random.Random(1)
    for _ in range(28):
        t = d.digital_pick(teams, slots, order, None, rng)
        (g, p), _w = d.place(t, slots, order)
        slots[g][p] = t["id"]
    assert d.next_slot(order, slots) is None
    assert len(d.placed_ids(slots)) == 28
    assert d.digital_pick(teams, slots, order, None, rng) is None


def test_requested_slot_respected_and_taken_refused():
    teams, slots, order = _teams(), _empty(), d.slot_order(GROUPS, 4)
    (g, p), w = d.place(teams[0], slots, order, requested=("E", 3))
    assert (g, p) == ("E", 3) and w == []
    slots["E"][3] = teams[0]["id"]
    assert d.place(teams[1], slots, order, requested=("E", 3)) == (None, ["SLOT_TAKEN"])
    # el automático sigue por el primer libre
    assert d.place(teams[1], slots, order)[0] == ("A", 1)


def test_pots_restrict_who_can_come_out_and_where():
    teams, slots, order = _teams(), _empty(), d.slot_order(GROUPS, 4)
    pots = {t["id"]: i // 7 + 1 for i, t in enumerate(teams)}  # bombo 1 = t0..t6, etc.
    assert {t["id"] for t in d.eligible_teams(teams, slots, order, pots)} == {f"t{i}" for i in range(7)}
    # un equipo del bombo 3 sacado "fuera de orden" igual va a la posición 3
    (g, p), _ = d.place(teams[15], slots, order, pots=pots)
    assert p == 3
    # y si se lo fuerza a otra posición, avisa
    assert "POT_POSITION_MISMATCH" in d.place(teams[15], slots, order, pots=pots, requested=("A", 1))[1]


def test_country_rule_moves_to_next_valid_zone_or_warns():
    teams, slots, order = _teams(countries=["AR"]), _empty(), d.slot_order(GROUPS, 4)
    country = {t["id"]: t["country_code"] for t in teams}
    rules = {"separate_country": True}
    slots["A"][1] = "t0"  # zona A ya tiene un AR
    slots["B"][1] = "x"  # B1 ocupado por otro
    br = {"id": "br1", "country_code": "BR"}
    country["br1"] = "BR"
    # un BR va al primer libre (C1)
    assert d.place(br, slots, order, rules=rules, country=country)[0] == ("C", 1)
    # un AR: el primer libre es C1 (sin AR) → ahí; si en C ya hay AR, se mueve a D y avisa
    slots["C"][2] = "t5"
    (slot, w) = d.place(teams[1], slots, order, rules=rules, country=country)
    assert slot == ("D", 1) and "MOVED_BY_COUNTRY_RULE" in w
    # todas las zonas con AR → no hay lugar válido: usa el primero libre y avisa
    for g in GROUPS:
        slots[g][4] = f"ar-{g}"
        country[f"ar-{g}"] = "AR"
    (slot, w) = d.place(teams[2], slots, order, rules=rules, country=country)
    assert slot == ("C", 1) and "SAME_COUNTRY_IN_GROUP" in w


def test_rule_off_ignores_country():
    teams, slots, order = _teams(countries=["AR"]), _empty(), d.slot_order(GROUPS, 4)
    slots["A"][1] = "t0"
    assert d.place(teams[1], slots, order, rules={}, country={"t0": "AR", "t1": "AR"}) == (("B", 1), [])


# ============================================================
# Procedimiento oficial por tandas
# ============================================================

def _official():
    """Los 28 equipos oficiales (scripts/copa_proud_teams.json) + el procedimiento del formato."""
    import json
    from app.utils.competition_formats import COPA_PROUD_2026
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "copa_proud_teams.json")
    teams = [{**t, "id": f"id{i}"} for i, t in enumerate(json.load(open(path, encoding="utf-8")))]
    return teams, COPA_PROUD_2026["draw_procedure"]


def test_official_preset_builds_the_five_tandas():
    teams, proc = _official()
    preset = d.build_tandas_preset(teams, proc)
    assert preset["problems"] == [], preset["problems"]
    count = lambda n: sum(1 for v in preset["pots"].values() if v == n)  # noqa: E731
    assert [count(n) for n in range(1, 6)] == [5, 3, 4, 6, 10]
    assert len(preset["rules"]["pairs"]) == 3
    assert preset["tandas"]["5"]["ball"] == "SLOT" and preset["tandas"]["1"]["ball"] == "GROUP"
    by_name = {t["name"]: t["id"] for t in teams}
    assert preset["pots"][by_name["Fútbol X"]] == 3          # Chile: resto de extranjeros
    assert preset["pots"][by_name["Rayos.cba II"]] == 4      # pareja
    assert preset["pots"][by_name["Guatemala IyD"]] == 5     # es argentino (no extranjero)


def test_preset_reports_missing_pair():
    teams, proc = _official()
    teams = [t for t in teams if t["name"] != "Dogos Seniors"]
    problems = d.build_tandas_preset(teams, proc)["problems"]
    assert {"code": "PAIR_NOT_FOUND", "pair": ["Dogos", "Dogos Seniors"]} in problems
    assert any(p["code"] == "TANDA_COUNT" and p["tanda"] == 4 for p in problems)


def test_group_ball_goes_to_first_free_position():
    slots = _empty()
    slots["C"][1] = "x"
    r = d.place_tandas({"id": "t"}, slots, GROUPS, ball="C")
    assert r["slot"] == ("C", 2) and r["jump"] is None and r["error"] is None


def test_jump_when_group_has_two_foreigners():
    slots = _empty()
    slots["C"][1], slots["C"][2] = "br", "uy"
    slots["D"][1], slots["D"][2] = "br2", "uy2"
    r = d.place_tandas({"id": "cl"}, slots, GROUPS, ball="C", foreign_ids={"br", "uy", "br2", "uy2", "cl"}, max_foreign=2)
    assert r["slot"] == ("E", 1)
    assert r["jump"] == {"from": "C", "to": "E", "reason": "FOREIGN_LIMIT"}
    # un argentino en la misma zona no salta
    r = d.place_tandas({"id": "ar"}, slots, GROUPS, ball="C", foreign_ids={"br", "uy"}, max_foreign=2)
    assert r["slot"] == ("C", 3) and r["jump"] is None


def test_jump_wraps_from_G_to_A():
    slots = _empty()
    slots["G"][1], slots["G"][2] = "f1", "f2"
    r = d.place_tandas({"id": "f3"}, slots, GROUPS, ball="G", foreign_ids={"f1", "f2", "f3"}, max_foreign=2)
    assert r["slot"] == ("A", 1) and r["jump"]["to"] == "A"


def test_jump_for_same_club_pair():
    slots = _empty()
    slots["B"][1] = "rayos"
    r = d.place_tandas({"id": "rayos2"}, slots, GROUPS, ball="B", pairs=[["rayos", "rayos2"]])
    assert r["slot"] == ("C", 1)
    assert r["jump"] == {"from": "B", "to": "C", "reason": "SAME_CLUB", "partner_id": "rayos"}


def test_jump_when_group_full():
    slots = _empty()
    for p in range(1, 5):
        slots["A"][p] = f"a{p}"
    r = d.place_tandas({"id": "t"}, slots, GROUPS, ball="A")
    assert r["slot"] == ("B", 1) and r["jump"]["reason"] == "GROUP_FULL"


def test_slot_ball_and_manual_placement():
    slots = _empty()
    assert d.place_tandas({"id": "t"}, slots, GROUPS, ball="D3", kind="SLOT")["slot"] == ("D", 3)
    slots["D"][3] = "x"
    assert d.place_tandas({"id": "t"}, slots, GROUPS, ball="D3", kind="SLOT")["error"] == "SLOT_TAKEN"
    # manual: se respeta aunque rompa el cupo, y se avisa
    slots["E"][1], slots["E"][2] = "f1", "f2"
    r = d.place_tandas({"id": "f3"}, slots, GROUPS, ball="", foreign_ids={"f1", "f2", "f3"}, max_foreign=2,
                       force_slot=("E", 3))
    assert r["slot"] == ("E", 3) and r["warnings"] == ["MANUAL_PLACEMENT", "FOREIGN_LIMIT"]


def test_balls_left_per_tanda():
    slots = _empty()
    picks = [{"tanda": 1, "ball": "A"}, {"tanda": 1, "ball": "C"}, {"tanda": 2, "ball": "B"}]
    assert d.balls_left(GROUPS, slots, picks, 1, "GROUP") == ["B", "D", "E", "F", "G"]
    assert d.balls_left(GROUPS, slots, picks, 2, "GROUP") == ["A", "C", "D", "E", "F", "G"]
    slots["A"] = {1: "x", 2: "y", 3: None, 4: None}
    assert d.balls_left(GROUPS, slots, picks, 5, "SLOT")[:2] == ["A3", "A4"]


def test_official_draw_simulation_respects_every_rule():
    """1000 sorteos oficiales completos al azar: siempre se cumple el reglamento."""
    teams, proc = _official()
    preset = d.build_tandas_preset(teams, proc)
    pots, tandas, rules = preset["pots"], preset["tandas"], preset["rules"]
    foreign = {t["id"] for t in teams if d.is_foreign(t, rules["home_country"])}
    assert len(foreign) == 12
    jumps = 0
    for seed in range(1000):
        rng = random.Random(seed)
        slots, picks, order_seen = _empty(), [], []
        while True:
            got = d.digital_tanda_pick(teams, slots, GROUPS, picks, pots, tandas, rng)
            if not got:
                break
            team, ball = got
            n = d.tanda_of(team["id"], pots)
            assert n == d.current_tanda(teams, slots, pots)
            order_seen.append(n)
            r = d.place_tandas(team, slots, GROUPS, ball=ball, kind=d.ball_kind(tandas, n), foreign_ids=foreign,
                               max_foreign=rules["max_foreign"], pairs=rules["pairs"])
            assert r["error"] is None, (seed, team["name"], ball, r)
            jumps += bool(r["jump"])
            g, p = r["slot"]
            slots[g][p] = team["id"]
            picks.append({"tanda": n, "ball": ball})
        assert len(d.placed_ids(slots)) == 28
        assert order_seen == sorted(order_seen)  # tandas en orden
        for g in GROUPS:
            members = set(slots[g].values())
            assert len(members & foreign) <= 2, (seed, g)
            for a, b in rules["pairs"]:
                assert not ({a, b} <= members), (seed, g)
        # tanda 1 (Brasil) y 2 (Uruguay): cada uno en una zona distinta
        for n in (1, 2):
            groups_n = [g for g in GROUPS for t in slots[g].values() if pots.get(t) == n]
            assert len(groups_n) == len(set(groups_n))
    assert jumps > 0  # la regla de salto se ejercita en la simulación


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests del sorteo en vivo pasaron")


if __name__ == "__main__":
    _run_all()
