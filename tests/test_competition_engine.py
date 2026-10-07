"""
Tests del motor de competencia + formato Copa Proud 2026. NO requieren base de datos.

Cubre: estructura del cronograma (75 partidos, canchas, fuentes), tablas con los 5
criterios del reglamento, ranking de terceros, resolución de fuentes, penales, W.O.,
intercambio anti-cruce intra-zona, conflictos/reversión, estadísticas y una
simulación completa del torneo con muchas semillas (empates, sorteos, penales).

Correr:  ./.venv/bin/python tests/test_competition_engine.py
"""
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils import competition_engine as ce  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026 as FMT  # noqa: E402


# ---------- helpers ----------

def _m(code, h, a, hg=None, ag=None, status="FINISHED", group="A", stage="GROUP", hp=None, ap=None):
    return {
        "code": code, "stage": stage, "group": group if stage == "GROUP" else None,
        "home_source": f"SLOT:{group}:1", "away_source": f"SLOT:{group}:2",
        "home_team_id": h, "away_team_id": a, "status": status,
        "home_goals": hg, "away_goals": ag, "home_pens": hp, "away_pens": ap,
    }


def _fresh_matches():
    return [
        {**m, "home_team_id": None, "away_team_id": None, "status": "SCHEDULED",
         "home_goals": None, "away_goals": None, "home_pens": None, "away_pens": None}
        for m in FMT["matches"]
    ]


def _slots_for(teams_by_group):
    return {g: {i + 1: t for i, t in enumerate(ts)} for g, ts in teams_by_group.items()}


def _apply(matches, updates):
    by_code = {m["code"]: m for m in matches}
    for u in updates:
        by_code[u["code"]][f"{u['side']}_team_id"] = u["team_id"]


def _kickoff(m):
    return (m["date"], m["time"])


# ---------- Estructura del formato ----------

def test_format_counts():
    ms = FMT["matches"]
    assert len(ms) == 75
    assert sum(m["stage"] == "GROUP" for m in ms) == 42
    cups = Counter(m["cup"] for m in ms if m["stage"] != "GROUP")
    assert cups == {"ORO": 15, "PLATA": 7, "BRONCE": 11}
    assert len({m["code"] for m in ms}) == 75


def test_format_each_zone_round_robin():
    pairs = {"1v2", "3v4", "1v3", "2v4", "1v4", "2v3"}
    for g in FMT["groups"]:
        got = [m["code"].split("-")[1] for m in FMT["matches"] if m.get("group") == g]
        assert sorted(got) == sorted(pairs), (g, got)  # incluye el fix de Zona E 13:30


def test_format_no_double_booking():
    venue_use = Counter((m["date"], m["time"], m["venue"]) for m in FMT["matches"])
    assert max(venue_use.values()) == 1
    # Un slot de zona (equipo) nunca juega dos partidos a la misma hora.
    seen = Counter()
    for m in FMT["matches"]:
        if m["stage"] == "GROUP":
            for s in (m["home_source"], m["away_source"]):
                seen[(m["date"], m["time"], s)] += 1
    assert max(seen.values()) == 1


def test_format_sources_valid_and_causal():
    by_code = {m["code"]: m for m in FMT["matches"]}
    for m in FMT["matches"]:
        for s in (m["home_source"], m["away_source"]):
            p = ce.parse_source(s)
            if p[0] in ("WINNER", "LOSER"):
                ref = by_code[p[1]]
                assert _kickoff(ref) < _kickoff(m), (m["code"], s)


def test_format_every_team_enters_sunday_once():
    entry = Counter()
    for m in FMT["matches"]:
        if m["stage"] == "GROUP":
            continue
        for s in (m["home_source"], m["away_source"]):
            if ce.parse_source(s)[0] in ("GROUP", "THIRD", "FOURTH"):
                entry[s] += 1
    assert all(v == 1 for v in entry.values())
    expected = {f"GROUP:{g}:{p}" for g in FMT["groups"] for p in (1, 2, 4)}
    expected |= {f"THIRD:{n}" for n in range(1, 8)}
    assert set(entry) == expected  # 21 + 7 = 28 equipos, cada uno una sola vez


def test_parse_source_rejects_garbage():
    for bad in ("", "GROUP:A", "THIRD:0", "WINNER:", "FOO:1", "GROUP:A:x"):
        try:
            ce.parse_source(bad)
        except ValueError:
            continue
        raise AssertionError(f"debería fallar: {bad!r}")


# ---------- Tablas y desempates ----------

def test_table_points_gd_gf():
    ms = [
        _m("A-1v2", "t1", "t2", 2, 0),
        _m("A-3v4", "t3", "t4", 1, 1),
        _m("A-1v3", "t1", "t3", 0, 1),
        _m("A-2v4", "t2", "t4", 3, 0),
    ]
    t = ce.compute_group_table("A", ["t1", "t2", "t3", "t4"], ms, [])
    order = [r["team_id"] for r in t["rows"]]
    # t3: 4 pts; t1: 3 pts (DG +1); t2: 3 pts (DG +1, GF 3 → gana a t1 por GF)
    assert order[0] == "t3"
    assert order[1:3] == ["t2", "t1"]
    assert order[3] == "t4"
    assert t["complete"] is True  # todos los partidos de la zona presentes están terminados


def test_table_fair_play_breaks_tie():
    ms = [_m("A-1v2", "t1", "t2", 1, 1, group="A")]
    events = [{"match_code": "A-1v2", "team_id": "t1", "type": "YELLOW"}]
    t = ce.compute_group_table("A", ["t1", "t2"], ms, events)
    assert [r["team_id"] for r in t["rows"]] == ["t2", "t1"]
    assert t["rows"][1]["fair_play"] == 1
    assert not t["unresolved_ties"]


def test_table_red_weighs_three():
    ms = [_m("A-1v2", "t1", "t2", 0, 0)]
    events = [
        {"match_code": "A-1v2", "team_id": "t1", "type": "RED"},
        {"match_code": "A-1v2", "team_id": "t2", "type": "YELLOW"},
        {"match_code": "A-1v2", "team_id": "t2", "type": "YELLOW"},
    ]
    t = ce.compute_group_table("A", ["t1", "t2"], ms, events)
    assert [r["team_id"] for r in t["rows"]] == ["t2", "t1"]  # 2 < 3


def test_table_unresolved_tie_then_draw():
    ms = [_m("A-1v2", "t1", "t2", 1, 1)]
    t = ce.compute_group_table("A", ["t1", "t2"], ms, [])
    assert t["unresolved_ties"] == [["t1", "t2"]]
    assert all(r["tie_unresolved"] for r in t["rows"])
    t2 = ce.compute_group_table("A", ["t1", "t2"], ms, [], draw_ranks={"t2": 1, "t1": 2})
    assert [r["team_id"] for r in t2["rows"]] == ["t2", "t1"]
    assert not t2["unresolved_ties"]


def test_walkover_counts_as_result():
    ms = [_m("A-1v2", "t1", "t2", 3, 0, status="WALKOVER")]
    t = ce.compute_group_table("A", ["t1", "t2"], ms, [])
    top = t["rows"][0]
    assert top["team_id"] == "t1" and top["points"] == 3 and top["goals_for"] == 3


def test_only_finished_matches_count():
    ms = [_m("A-1v2", "t1", "t2", 5, 0, status="LIVE")]
    t = ce.compute_group_table("A", ["t1", "t2"], ms, [])
    assert all(r["played"] == 0 for r in t["rows"])
    assert t["complete"] is False


# ---------- Resultado de partido ----------

def test_winner_by_goals_and_penalties():
    assert ce.match_winner(_m("X", "a", "b", 2, 1, stage="R16")) == "a"
    assert ce.match_winner(_m("X", "a", "b", 1, 1, stage="R16", hp=2, ap=3)) == "b"
    assert ce.match_loser(_m("X", "a", "b", 1, 1, stage="R16", hp=2, ap=3)) == "a"
    assert ce.match_winner(_m("X", "a", "b", 1, 1, stage="R16")) is None
    assert ce.match_winner(_m("X", "a", "b", 2, 0, stage="R16", status="LIVE")) is None


def test_goal_tally_own_goal_counts_for_rival():
    m = _m("X", "a", "b", 2, 1)
    events = [
        {"match_code": "X", "team_id": "a", "type": "GOAL"},
        {"match_code": "X", "team_id": "b", "type": "OWN_GOAL"},
        {"match_code": "X", "team_id": "b", "type": "GOAL"},
        {"match_code": "Y", "team_id": "a", "type": "GOAL"},
    ]
    assert ce.goal_tally(m, events) == (2, 1)


# ---------- Resolución / propagación sobre el formato real ----------

def _play_groups(matches, teams_by_group, results):
    """results: {(group, 'a', 'b'): (ga, gb)} por posición de slot."""
    slots = _slots_for(teams_by_group)
    _apply(matches, ce.plan_updates(matches, slots=slots, standings=ce.Standings(), group_stage_closed=False)["updates"])
    for m in matches:
        if m["stage"] != "GROUP":
            continue
        a, b = m["code"].split("-")[1].split("v")
        m["home_goals"], m["away_goals"] = results[(m["group"], a, b)]
        m["status"] = "FINISHED"
    return slots


def _deterministic_results():
    # Posición 1 gana todo, 2 le gana a 3 y 4, 3 le gana a 4 → tabla 1-2-3-4 sin empates,
    # y los terceros se diferencian por goles para que el ranking sea determinístico.
    res = {}
    for gi, g in enumerate(FMT["groups"]):
        for a, b in ((1, 2), (3, 4), (1, 3), (2, 4), (1, 4), (2, 3)):
            margin = 1 + (gi if (a, b) == (3, 4) else 0)  # 3° de la zona G es el mejor
            res[(g, str(a), str(b))] = (margin, 0)
    return res


def _teams():
    return {g: [f"{g}{i}" for i in range(1, 5)] for g in FMT["groups"]}


def test_slots_fill_saturday_before_close_and_sunday_waits():
    ms = _fresh_matches()
    slots = _slots_for(_teams())
    plan = ce.plan_updates(ms, slots=slots, standings=ce.Standings(), group_stage_closed=False)
    _apply(ms, plan["updates"])
    sat = [m for m in ms if m["stage"] == "GROUP"]
    assert all(m["home_team_id"] and m["away_team_id"] for m in sat)
    sun = [m for m in ms if m["stage"] != "GROUP"]
    assert all(m["home_team_id"] is None and m["away_team_id"] is None for m in sun)
    reasons = {p["reason"] for p in plan["pending"]}
    assert ce.GROUP_STAGE_OPEN in reasons and ce.MATCH_PENDING in reasons


def test_close_check_and_expected_pairings():
    ms = _fresh_matches()
    teams = _teams()
    slots = _play_groups(ms, teams, _deterministic_results())
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    check = ce.group_stage_close_check(ms, slots=slots, standings=st, swap_rules=FMT["swap_rules"])
    assert check["can_close"], check["blockers"]
    thirds = [r["team_id"] for r in st.thirds["rows"]]
    assert thirds[0] == "G3" and thirds[1] == "F3"
    _apply(ms, ce.plan_updates(ms, slots=slots, standings=st, group_stage_closed=True,
                               swap_rules=FMT["swap_rules"])["updates"])
    by = {m["code"]: m for m in ms}
    assert (by["ORO-O1"]["home_team_id"], by["ORO-O1"]["away_team_id"]) == ("A1", "G3")
    assert (by["ORO-O8"]["home_team_id"], by["ORO-O8"]["away_team_id"]) == ("A2", "B2")
    # Bronce (planilla 2026-10-07): 4°A-4°G, 4°B-7° mejor 3°, 4°C-4°F, 4°D-4°E;
    # cuartos = 3°..6° mejor 3° vs ganador de cada octavo (este espera el resultado).
    assert thirds[6] == "A3"
    assert (by["BRONCE-O1"]["home_team_id"], by["BRONCE-O1"]["away_team_id"]) == ("A4", "G4")
    assert (by["BRONCE-O2"]["home_team_id"], by["BRONCE-O2"]["away_team_id"]) == ("B4", "A3")
    assert (by["BRONCE-O3"]["home_team_id"], by["BRONCE-O3"]["away_team_id"]) == ("C4", "F4")
    assert (by["BRONCE-O4"]["home_team_id"], by["BRONCE-O4"]["away_team_id"]) == ("D4", "E4")
    for i, code in enumerate(("BRONCE-C1", "BRONCE-C2", "BRONCE-C3", "BRONCE-C4")):
        assert (by[code]["home_team_id"], by[code]["away_team_id"]) == (thirds[2 + i], None)
    # Cuartos/Plata esperan resultados del domingo.
    assert by["PLATA-C1"]["home_team_id"] is None


def test_close_blocked_by_unfinished_and_by_tie():
    ms = _fresh_matches()
    slots = _play_groups(ms, _teams(), _deterministic_results())
    ms[0]["status"] = "LIVE"
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    check = ce.group_stage_close_check(ms, slots=slots, standings=st)
    assert not check["can_close"] and ms[0]["code"] in check["unfinished_matches"]

    # Empate perfecto entre 1° y 2° de la Zona A → bloquea hasta cargar el sorteo.
    ms = _fresh_matches()
    res = _deterministic_results()
    res[("A", "1", "2")] = (0, 0)
    res[("A", "1", "3")] = (1, 0)
    res[("A", "1", "4")] = (1, 0)
    res[("A", "2", "3")] = (1, 0)
    res[("A", "2", "4")] = (1, 0)
    slots = _play_groups(ms, _teams(), res)
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    check = ce.group_stage_close_check(ms, slots=slots, standings=st)
    assert not check["can_close"]
    assert {"context": "GROUP:A", "team_ids": ["A1", "A2"]} in check["ties"]
    assert any(b["source"] == "GROUP:A:1" and b["reason"] == ce.TIE_NEEDS_DRAW for b in check["blockers"])
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"], draws={"GROUP:A": {"A2": 1, "A1": 2}})
    check = ce.group_stage_close_check(ms, slots=slots, standings=st)
    assert check["can_close"], check["blockers"]
    assert st.tables["A"]["rows"][0]["team_id"] == "A2"


def test_swap_rule_avoids_same_zone_best_third():
    ms = _fresh_matches()
    res = _deterministic_results()
    res[("A", "3", "4")] = (9, 0)  # el 3° de la Zona A pasa a ser el mejor 3°
    slots = _play_groups(ms, _teams(), res)
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    assert st.thirds["rows"][0]["team_id"] == "A3"
    _apply(ms, ce.plan_updates(ms, slots=slots, standings=st, group_stage_closed=True,
                               swap_rules=FMT["swap_rules"])["updates"])
    by = {m["code"]: m for m in ms}
    assert (by["ORO-O1"]["home_team_id"], by["ORO-O1"]["away_team_id"]) == ("A1", "G2")
    assert (by["ORO-O3"]["home_team_id"], by["ORO-O3"]["away_team_id"]) == ("C1", "A3")
    # Bronce: el 7° mejor 3° es B3 y le tocaría 4°B → pasa a O1 (vs 4°A) y el 4°G va a O2.
    assert st.thirds["rows"][6]["team_id"] == "B3"
    assert (by["BRONCE-O1"]["home_team_id"], by["BRONCE-O1"]["away_team_id"]) == ("A4", "B3")
    assert (by["BRONCE-O2"]["home_team_id"], by["BRONCE-O2"]["away_team_id"]) == ("B4", "G4")


def test_conflict_and_revert():
    ms = _fresh_matches()
    slots = _play_groups(ms, _teams(), _deterministic_results())
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    kw = dict(slots=slots, standings=st, group_stage_closed=True, swap_rules=FMT["swap_rules"])
    _apply(ms, ce.plan_updates(ms, **kw)["updates"])
    by = {m["code"]: m for m in ms}
    o1, o2 = by["ORO-O1"], by["ORO-O2"]
    o1.update(status="FINISHED", home_goals=2, away_goals=0)
    o2.update(status="FINISHED", home_goals=0, away_goals=1)
    _apply(ms, ce.plan_updates(ms, **kw)["updates"])
    assert (by["ORO-C1"]["home_team_id"], by["ORO-C1"]["away_team_id"]) == (o1["home_team_id"], o2["away_team_id"])
    assert (by["PLATA-C1"]["home_team_id"], by["PLATA-C1"]["away_team_id"]) == (o1["away_team_id"], o2["home_team_id"])

    # Corrección antes de que empiece el cruce → se reescribe (reversión).
    o1.update(home_goals=0, away_goals=1)
    plan = ce.plan_updates(ms, **kw)
    assert not plan["conflicts"]
    _apply(ms, plan["updates"])
    assert by["ORO-C1"]["home_team_id"] == o1["away_team_id"]

    # Partido reabierto → el siguiente vuelve a quedar sin equipo.
    o1["status"] = "LIVE"
    _apply(ms, ce.plan_updates(ms, **kw)["updates"])
    assert by["ORO-C1"]["home_team_id"] is None

    # Si el cruce ya empezó, NO se toca: se reporta conflicto.
    o1.update(status="FINISHED", home_goals=3, away_goals=0)
    _apply(ms, ce.plan_updates(ms, **kw)["updates"])
    by["ORO-C1"]["status"] = "LIVE"
    o1.update(home_goals=0, away_goals=3)
    plan = ce.plan_updates(ms, **kw)
    assert any(c["code"] == "ORO-C1" and c["side"] == "home" for c in plan["conflicts"])
    assert not any(u["code"] == "ORO-C1" for u in plan["updates"])


def test_knockout_draw_without_penalties_is_pending():
    ms = _fresh_matches()
    slots = _play_groups(ms, _teams(), _deterministic_results())
    st = ce.compute_standings(FMT["groups"], slots, ms, [], FMT["settings"])
    kw = dict(slots=slots, standings=st, group_stage_closed=True, swap_rules=FMT["swap_rules"])
    _apply(ms, ce.plan_updates(ms, **kw)["updates"])
    by = {m["code"]: m for m in ms}
    by["ORO-O1"].update(status="FINISHED", home_goals=1, away_goals=1)
    plan = ce.plan_updates(ms, **kw)
    assert {"code": "ORO-C1", "side": "home", "source": "WINNER:ORO-O1", "reason": ce.NO_WINNER} in plan["pending"]


# ---------- Estadísticas ----------

def test_top_scorers_group_only_and_no_own_goals():
    ms = [_m("A-1v2", "t1", "t2", 2, 1), _m("ORO-O1", "t1", "t3", 1, 0, stage="R16")]
    events = [
        {"match_code": "A-1v2", "team_id": "t1", "type": "GOAL", "player_id": "p1"},
        {"match_code": "A-1v2", "team_id": "t1", "type": "GOAL", "player_id": "p1"},
        {"match_code": "A-1v2", "team_id": "t1", "type": "OWN_GOAL", "player_id": "p9"},
        {"match_code": "A-1v2", "team_id": "t2", "type": "GOAL"},  # sin jugador: no suma
        {"match_code": "ORO-O1", "team_id": "t1", "type": "GOAL", "player_id": "p2"},
    ]
    s = ce.top_scorers(ms, events)
    assert s == [{"player_id": "p1", "team_id": "t1", "goals": 2, "rank": 1}]
    assert len(ce.top_scorers(ms, events, group_stage_only=False)) == 2


def test_suspensions_red_and_double_yellow():
    ms = [_m("A-1v2", "t1", "t2", 0, 0)]
    events = [
        {"match_code": "A-1v2", "team_id": "t1", "type": "YELLOW", "player_id": "p1"},
        {"match_code": "A-1v2", "team_id": "t1", "type": "YELLOW", "player_id": "p1"},
        {"match_code": "A-1v2", "team_id": "t2", "type": "RED", "player_id": "p2"},
        {"match_code": "A-1v2", "team_id": "t2", "type": "YELLOW", "player_id": "p3"},
    ]
    got = {(s["player_id"], s["reason"]) for s in ce.suspensions(ms, events)}
    assert got == {("p1", "DOUBLE_YELLOW"), ("p2", "RED")}


# ---------- Simulación completa (muchas semillas) ----------

def _simulate(seed):
    rng = random.Random(seed)
    ms = _fresh_matches()
    teams = _teams()
    for g in teams:
        rng.shuffle(teams[g])  # sorteo de posiciones
    slots = _slots_for(teams)
    events = []
    _apply(ms, ce.plan_updates(ms, slots=slots, standings=ce.Standings(), group_stage_closed=False)["updates"])

    for m in ms:
        if m["stage"] != "GROUP":
            continue
        m["home_goals"], m["away_goals"] = rng.randint(0, 3), rng.randint(0, 3)
        m["status"] = "WALKOVER" if rng.random() < 0.02 else "FINISHED"
        if m["status"] == "WALKOVER":
            m["home_goals"], m["away_goals"] = 3, 0
        for side in ("home", "away"):
            for _ in range(rng.choice([0, 0, 1, 2])):
                events.append({"match_code": m["code"], "team_id": m[f"{side}_team_id"],
                               "type": rng.choice(["YELLOW", "YELLOW", "RED"])})

    draws: dict = {}
    for _ in range(4):  # sortear hasta desbloquear (un sorteo puede destapar otro empate)
        st = ce.compute_standings(FMT["groups"], slots, ms, events, FMT["settings"], draws)
        check = ce.group_stage_close_check(ms, slots=slots, standings=st, swap_rules=FMT["swap_rules"])
        if check["can_close"]:
            break
        for tie in check["ties"]:
            order = list(tie["team_ids"])
            rng.shuffle(order)
            ctx = draws.setdefault(tie["context"], {})
            for i, t in enumerate(order, start=1):
                ctx[t] = i
    assert check["can_close"], (seed, check["blockers"])

    kw = dict(slots=slots, standings=st, group_stage_closed=True, swap_rules=FMT["swap_rules"])
    sunday = sorted((m for m in ms if m["stage"] != "GROUP"), key=_kickoff)
    for m in sunday:
        plan = ce.plan_updates(ms, **kw)
        assert not plan["conflicts"], (seed, plan["conflicts"])
        _apply(ms, plan["updates"])
        assert m["home_team_id"] and m["away_team_id"], (seed, m["code"])
        assert m["home_team_id"] != m["away_team_id"]
        m["home_goals"], m["away_goals"] = rng.randint(0, 3), rng.randint(0, 3)
        if m["home_goals"] == m["away_goals"]:
            m["home_pens"] = rng.randint(0, 3)
            m["away_pens"] = (m["home_pens"] + rng.choice([-1, 1])) % 4
        m["status"] = "FINISHED"
    return ms, teams, st


def test_full_tournament_simulation():
    all_teams = {t for ts in _teams().values() for t in ts}
    for seed in range(200):
        ms, teams, st = _simulate(seed)
        # Cada equipo: exactamente 3 partidos de grupos.
        per_team = Counter()
        for m in ms:
            if m["stage"] == "GROUP":
                per_team[m["home_team_id"]] += 1
                per_team[m["away_team_id"]] += 1
        assert set(per_team.values()) == {3}
        by = {m["code"]: m for m in ms}
        oro_r16 = {t for c in range(1, 9) for t in (by[f"ORO-O{c}"]["home_team_id"], by[f"ORO-O{c}"]["away_team_id"])}
        bronce = {t for c in range(1, 5) for t in (by[f"BRONCE-O{c}"]["home_team_id"], by[f"BRONCE-O{c}"]["away_team_id"])}
        # Clasificados directos a cuartos de Bronce: el local de cada cuarto (3°..6° mejor 3°).
        bronce |= {by[f"BRONCE-C{c}"]["home_team_id"] for c in range(1, 5)}
        assert len(oro_r16) == 16 and len(bronce) == 12
        assert oro_r16 | bronce == all_teams and not (oro_r16 & bronce)
        plata = {t for c in range(1, 5) for t in (by[f"PLATA-C{c}"]["home_team_id"], by[f"PLATA-C{c}"]["away_team_id"])}
        assert plata == {ce.match_loser(by[f"ORO-O{c}"]) for c in range(1, 9)}
        # Nunca un equipo en dos canchas a la misma hora.
        at = Counter()
        for m in ms:
            for t in (m["home_team_id"], m["away_team_id"]):
                at[(m["date"], m["time"], t)] += 1
        assert max(at.values()) == 1
        # Las tres finales tienen campeón.
        for final in ("ORO-F", "PLATA-F", "BRONCE-F"):
            assert ce.match_winner(by[final]), (seed, final)
        # Ningún mejor 3° cruza con el 1° de su zona en octavos de Oro.
        for c in (1, 2, 3, 4):
            h, a = by[f"ORO-O{c}"]["home_team_id"], by[f"ORO-O{c}"]["away_team_id"]
            assert st.team_group[h] != st.team_group[a], (seed, c)


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests del motor de competencia pasaron")


if __name__ == "__main__":
    _run_all()
