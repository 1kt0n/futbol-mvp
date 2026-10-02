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


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests del sorteo en vivo pasaron")


if __name__ == "__main__":
    _run_all()
