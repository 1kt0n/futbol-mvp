"""
Simulación END-TO-END de la Copa Proud contra la API real y una base Postgres LOCAL.

Recorre el torneo completo por HTTP (TestClient): seed → alta masiva de 28 equipos con
sorteo → planteles → veedores por cancha → publicar → 42 partidos del sábado (mezcla de
veedor desde el celular, mesa central y W.O.) → sorteos de desempate → cierre de fase →
33 partidos del domingo con penales → verificación del snapshot público. En el camino
prueba los rechazos esperados (403/401/409), la idempotencia de reintentos del veedor,
las correcciones con re-propagación de llaves y el caché/ETag del snapshot.

⚠️ BORRA y re-crea la competencia `copa-proud-2026` en la base apuntada. Por eso exige
una base en localhost y el flag explícito COMPETITION_E2E_DB=1.

Correr:
  COMPETITION_E2E_DB=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \
    ./.venv/bin/python tests/e2e_competition_sim.py
"""
import gzip
import importlib.util
import json
import os
import random
import sys
import time
import uuid
from collections import Counter
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_url = os.environ.get("DATABASE_URL", "")
if os.environ.get("COMPETITION_E2E_DB") != "1" or urlparse(_url.replace("+psycopg", "")).hostname not in ("127.0.0.1", "localhost"):
    sys.exit("Abortado: requiere COMPETITION_E2E_DB=1 y DATABASE_URL apuntando a localhost (borra datos).")
os.environ.setdefault("AUTH_SECRET", "test-secret-e2e")

from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app.settings import engine  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402
from app.utils import ratelimit  # noqa: E402
from app.utils.auth_token import issue_token  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026 as FMT  # noqa: E402
from app.utils.security import hash_management_token  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "seed_competition", os.path.join(os.path.dirname(__file__), "..", "scripts", "seed_competition.py"))
seed_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_mod)

SLUG = FMT["slug"]
# Primera cancha real del formato (las canchas se numeran 9, 10, 11, 13, 14, 15).
V1 = (FMT.get("venue_numbers") or [1])[0]
ADM = f"/admin/competitions/{SLUG}"
PUB = f"/public/competitions/{SLUG}"
DEMO_TOKENS: dict = {}
DEMO_ADMIN: dict = {}
rng = random.Random(int(os.environ.get("E2E_SEED", "2026")))
# E2E_DEMO_STOP=N: juega N partidos del sábado, deja el turno siguiente EN VIVO y sale
# (sin las verificaciones finales). Sirve para mirar el sitio con datos realistas.
DEMO_STOP = int(os.environ["E2E_DEMO_STOP"]) if os.environ.get("E2E_DEMO_STOP") else None
checks = Counter()


def ok(cond, msg):
    assert cond, msg
    checks["ok"] += 1


def expect(resp, status, detail=None):
    body = resp.json() if resp.content and resp.headers.get("content-type", "").startswith("application/json") else None
    assert resp.status_code == status, f"esperaba {status}, vino {resp.status_code}: {body}"
    if detail is not None:
        got = body.get("detail") if isinstance(body, dict) else None
        got = got.get("code") if isinstance(got, dict) else got
        assert got == detail, f"esperaba detail={detail}, vino {got}"
    checks["ok"] += 1
    return body


# ---------- setup ----------

def reset_db():
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM public.competitions WHERE slug = :s"), {"s": SLUG})
        conn.execute(text("DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM public.users WHERE phone_login LIKE 'e2e-%')"))
        conn.execute(text("DELETE FROM public.users WHERE phone_login LIKE 'e2e-%'"))
        admin = conn.execute(text("""
            INSERT INTO public.users (full_name, phone_e164, phone_login)
            VALUES ('Mesa Central E2E', '+5490000000001', 'e2e-admin') RETURNING id
        """)).scalar()
        conn.execute(text("""
            INSERT INTO public.user_roles (user_id, role_id)
            SELECT :uid, id FROM public.roles WHERE code = 'admin'
        """), {"uid": admin})
        nobody = conn.execute(text("""
            INSERT INTO public.users (full_name, phone_e164, phone_login)
            VALUES ('Jugador E2E', '+5490000000002', 'e2e-user') RETURNING id
        """)).scalar()
        seed_mod.seed(conn, FMT)
    svc.invalidate_cache()
    return str(admin), str(nobody)


def next_minute():
    """La simulación comprime 2 días en segundos: se resetea el rate limit entre partidos
    (en la vida real un veedor hace pocas acciones por minuto)."""
    ratelimit._hits.clear()


def snapshot(client, admin_h):
    return client.get(ADM, headers=admin_h).json()


def main_sim():
    admin_id, nobody_id = reset_db()
    H = {"X-Actor-User-Id": issue_token(admin_id)}
    NOBODY = {"X-Actor-User-Id": issue_token(nobody_id)}
    client = TestClient(main.app)

    # ---- permisos y visibilidad ----
    expect(client.get("/admin/competitions", headers=NOBODY), 403)
    expect(client.get(PUB), 404, "COMPETITION_NOT_FOUND")  # DRAFT no se expone

    # ---- alta masiva de 28 equipos + sorteo ----
    # Equipos reales con escudo (scripts/copa_proud_teams.json, 26) + 2 todavía sin confirmar.
    real = json.load(open(os.path.join(os.path.dirname(__file__), "..", "scripts", "copa_proud_teams.json")))
    pool = real + [{"name": f"Equipo por confirmar {k}", "country_code": None, "logo_url": None} for k in (1, 2)]
    rng.shuffle(pool)  # sorteo de zonas y posiciones
    teams_payload = []
    for gi, g in enumerate(FMT["groups"]):
        for pos in range(1, 5):
            t = pool[gi * 4 + pos - 1]
            teams_payload.append({"name": t["name"], "logo_url": t["logo_url"],
                                  "country_code": t["country_code"].lower() if t["country_code"] else None,
                                  "group": g, "position": pos})
    body = expect(client.post(f"{ADM}/teams/bulk", json={"teams": teams_payload}, headers=H), 200)
    ok(len(body["created"]) == 28, "28 equipos creados")
    expect(client.post(f"{ADM}/teams", json={"name": teams_payload[0]["name"].upper()}, headers=H),
           409, "TEAM_NAME_TAKEN")  # unicidad case-insensitive

    snap = snapshot(client, H)
    team_by_slot = {(t["group"], t["position"]): t["id"] for t in snap["teams"]}
    sat = [m for m in snap["matches"] if m["stage"] == "GROUP"]
    ok(all(m["home"]["team_id"] and m["away"]["team_id"] for m in sat), "sábado completo tras el sorteo")
    ok(all(m["home"]["team_id"] is None for m in snap["matches"] if m["stage"] != "GROUP"), "domingo vacío")
    ok(all(not t["country_code"] or t["country_code"].isupper() for t in snap["teams"]), "country_code normalizado")

    # ---- planteles (opcionales: 20 equipos sí, 8 no) ----
    for t in snap["teams"][:20]:
        players = [{"full_name": f"Jugador {n} {t['name']}", "shirt_number": n,
                    "is_goalkeeper": n == 1, "is_captain": n == 2} for n in range(1, 9)]
        expect(client.post(f"{ADM}/teams/{t['id']}/players/bulk", json={"players": players}, headers=H), 200)
    t0 = snap["teams"][0]["id"]
    expect(client.post(f"{ADM}/teams/{t0}/players", json={"full_name": "Dup", "shirt_number": 5}, headers=H),
           409, "SHIRT_NUMBER_TAKEN")

    # ---- veedores POR EQUIPO: 14 veedores con 2 equipos cada uno + 1 de reserva por cancha ----
    staff_tokens = DEMO_TOKENS          # nombre → token
    team_token: dict = {}               # team_id → token de su veedor
    staff_ids: dict = {}                # nombre → staff_id
    ordered = sorted(snap["teams"], key=lambda t: (t["group"], t["position"]))
    for k in range(14):
        a, b = ordered[k], ordered[k + 14]
        name = f"Veedor {k + 1:02d}"
        body = expect(client.post(f"{ADM}/staff", json={"full_name": name, "contact": f"+54 9 11 5555-{k:04d}",
                                                         "team_ids": [a["id"], b["id"]]}, headers=H), 200)
        staff_tokens[name] = body["token"]
        staff_ids[name] = body["staff_id"]
        team_token[a["id"]] = team_token[b["id"]] = body["token"]
    # Reasignar: el equipo b del veedor 01 pasa al 02 y vuelve (un equipo tiene un solo veedor).
    a01, b01 = ordered[0]["id"], ordered[14]["id"]
    r = expect(client.put(f"{ADM}/staff/{staff_ids['Veedor 02']}/teams",
                          json={"team_ids": [ordered[1]["id"], ordered[15]["id"], b01]}, headers=H), 200)
    ok(r["assigned"] == 3 and r["released"] == 0, "veedor 02 toma un equipo más")
    r = expect(client.put(f"{ADM}/staff/{staff_ids['Veedor 01']}/teams", json={"team_ids": [a01, b01]}, headers=H), 200)
    ok(r["assigned"] == 2, "veedor 01 lo recupera")
    expect(client.put(f"{ADM}/staff/{staff_ids['Veedor 01']}/teams", json={"team_ids": ["00000000-0000-0000-0000-000000000000"]},
                      headers=H), 404, "TEAM_NOT_FOUND")
    reserve = expect(client.post(f"{ADM}/staff", json={"full_name": "Veedor Reserva"}, headers=H), 200)
    staff_tokens["Veedor Reserva"] = reserve["token"]
    r = expect(client.post(f"{ADM}/staff/{reserve['staff_id']}/assign", json={"venue": V1, "date": FMT["starts_on"]},
                           headers=H), 200)
    ok(r["assigned"] == 7, "reserva asignada a los 7 partidos de cancha 1 del sábado")

    snap = snapshot(client, H)
    DEMO_ADMIN.update(snap)
    by_name = {st["full_name"]: st for st in snap["staff"]}
    ok(len(by_name["Veedor 01"]["team_ids"]) == 2 and len(by_name["Veedor 02"]["team_ids"]) == 2, "equipos por veedor")
    ok(all(t["veedor_staff_id"] for t in snap["teams"]), "todos los equipos tienen veedor")
    sat_snap = [m for m in snap["matches"] if m["stage"] == "GROUP"]
    ok(all(len(m["veedor_names"]) == (3 if m["venue"] == V1 else 2) for m in sat_snap),
       "sábado: veedor de cada equipo (+ reserva en cancha 1)")
    ok(by_name["Veedor 01"]["contact"].startswith("+54"), "contacto del veedor descifrado para admin")

    # ---- publicar + caché/ETag ----
    expect(client.patch(ADM, json={"status": "PUBLISHED"}, headers=H), 200)
    r = client.get(PUB)
    expect(r, 200)
    pub = r.json()
    ok("staff" not in pub and "slots" not in pub, "el snapshot público no expone datos de admin")
    ok(all("veedor_staff_id" not in t for t in pub["teams"]), "sin ids de veedor en público")
    ok(all("contact" not in str(m) for m in pub["matches"][:3]), "sin contactos en público")
    ok(all(" · " in m["veedor_name"] for m in pub["matches"] if m["stage"] == "GROUP"), "nombres de los veedores en público")
    etag = r.headers["etag"]
    expect(client.get(PUB, headers={"If-None-Match": etag}), 304)

    # ---- modo veedor: acceso por equipo ----
    expect(client.get(f"{PUB}/staff/me", headers={"X-Staff-Token": "x" * 40}), 401, "INVALID_STAFF_TOKEN")
    me = expect(client.get(f"{PUB}/staff/me", headers={"X-Staff-Token": staff_tokens["Veedor 01"]}), 200)
    ok(len(me["matches"]) == 75, "me trae TODOS los partidos (para elegir cancha)")
    mine_01 = [m for m in me["matches"] if m["mine"]]
    ok(len(mine_01) == 6, f"veedor 01 opera los 6 partidos de sus 2 equipos (opera {len(mine_01)})")
    ok(len(me["staff"]["teams"]) == 2 and me["server_now"], "me trae sus equipos y la hora del server")
    ok(all(m["my_team_ids"] and len(m["other_veedors"]) >= 1 for m in mine_01), "marca su equipo y el otro veedor")
    ok(me["venues"] == FMT["venue_numbers"], "me trae las canchas en orden")
    rme = expect(client.get(f"{PUB}/staff/me", headers={"X-Staff-Token": staff_tokens["Veedor Reserva"]}), 200)
    mine_r = [m for m in rme["matches"] if m["mine"]]
    ok(len(mine_r) == 7 and all(not m["my_team_ids"] and m["holder"]["me"] for m in mine_r),
       "reserva tiene los 7 de su cancha (holder = él), sin equipos propios")
    ok(all(m["holder"] is None or not m["holder"]["me"] for m in me["matches"]), "veedor 01 no tiene partidos tomados")
    with_roster = next(t for t in snap["teams"] if t["players"])
    me_r = expect(client.get(f"{PUB}/staff/me", headers={"X-Staff-Token": team_token[with_roster["id"]]}), 200)
    ok(len(me_r["teams"][with_roster["id"]]["players"]) == 8, "el veedor recibe los planteles (una vez, en teams)")

    def VT(team_id):
        return {"X-Staff-Token": team_token[team_id]}

    def VH(m):
        return VT(m["home"]["team_id"])

    def VA(m):
        return VT(m["away"]["team_id"])

    probe = sat[0]
    outsider = next(tok for tok in staff_tokens.values()
                    if tok not in (team_token[probe["home"]["team_id"]], team_token[probe["away"]["team_id"]])
                    and tok != staff_tokens["Veedor Reserva"])
    expect(client.post(f"{PUB}/staff/matches/{probe['code']}/status", json={"status": "LIVE"},
                       headers={"X-Staff-Token": outsider}), 403, "MATCH_NOT_ASSIGNED")

    # ---- SÁBADO ----
    expected_scores = {}
    veedor_only = set()

    def play_with_veedor(m, hg, ag, cards=True):
        """Cargan LOS DOS veedores: cada uno los goles de su equipo; el estado lo mueve cualquiera."""
        base = f"{PUB}/staff/matches/{m['code']}"
        expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=VH(m)), 200)
        ok(client.post(f"{base}/status", json={"status": "LIVE"}, headers=VA(m)).status_code == 200,
           "el segundo veedor también toca Iniciar: idempotente")
        for side, goals in (("home", hg), ("away", ag)):
            tid = m[side]["team_id"]
            h = VT(tid)
            for _ in range(goals):
                ev = {"team_id": tid, "type": "GOAL", "client_event_id": uuid.uuid4().hex,
                      "shirt_number": rng.choice([None, 3, 4, 7, 9])}
                expect(client.post(f"{base}/events", json=ev, headers=h), 200)
                if rng.random() < 0.15:  # reintento por mala señal → no duplica
                    dup = expect(client.post(f"{base}/events", json=ev, headers=h), 200)
                    ok(dup["duplicate"] is True, "reintento idempotente")
            if cards and rng.random() < 0.4:
                expect(client.post(f"{base}/events", json={"team_id": tid, "type": rng.choice(["YELLOW", "YELLOW", "RED"]),
                                                          "shirt_number": 5}, headers=h), 200)
        if cards and m["venue"] == V1 and rng.random() < 0.3:  # la reserva de la cancha 1 también puede cargar
            expect(client.post(f"{base}/events", json={"team_id": m["home"]["team_id"], "type": "YELLOW"},
                               headers={"X-Staff-Token": staff_tokens["Veedor Reserva"]}), 200)
        if rng.random() < 0.25:  # gol cargado por error: el otro veedor NO puede borrarlo; el que lo cargó sí
            e = expect(client.post(f"{base}/events", json={"team_id": m["home"]["team_id"], "type": "GOAL"}, headers=VH(m)), 200)
            if team_token[m["home"]["team_id"]] != team_token[m["away"]["team_id"]]:
                expect(client.delete(f"{base}/events/{e['event_id']}", headers=VA(m)), 403, "EVENT_NOT_YOURS")
            expect(client.delete(f"{base}/events/{e['event_id']}", headers=VH(m)), 200)
        expect(client.post(f"{base}/status", json={"status": "HALFTIME"}, headers=VA(m)), 200)
        expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=VH(m)), 200)

    sat.sort(key=lambda m: (m["scheduled_at"], m["venue"]))
    for i, m in enumerate(sat):
        next_minute()
        if DEMO_STOP is not None and i == DEMO_STOP:
            return demo_live(client, sat[i:i + 6], VH, VT)
        hg, ag = rng.choice([0, 0, 1, 1, 2, 3]), rng.choice([0, 0, 1, 1, 2, 3])
        if i == len(sat) - 1:
            # Antes del último partido, cerrar la fase tiene que fallar.
            expect(client.post(f"{ADM}/group-stage/close", headers=H), 409, "CANNOT_CLOSE_GROUP_STAGE")
        if i == 5:
            expect(client.post(f"{ADM}/matches/{m['code']}/walkover", json={"winner": "AWAY"}, headers=H), 200)
            expected_scores[m["code"]] = (0, 3)
            continue
        if m["group"] == "A":
            # Zona A: todo 1-1 sin tarjetas → empate perfecto de 4 → obliga a cargar el sorteo.
            hg = ag = 1
            expect(client.post(f"{ADM}/matches/{m['code']}/result",
                               json={"home_goals": hg, "away_goals": ag}, headers=H), 200)
        elif i % 3 == 1:  # mesa central desde la planilla
            expect(client.post(f"{ADM}/matches/{m['code']}/result",
                               json={"home_goals": hg, "away_goals": ag}, headers=H), 200)
        else:  # veedor en vivo
            play_with_veedor(m, hg, ag)
            expect(client.post(f"{PUB}/staff/matches/{m['code']}/status", json={"status": "FINISHED"},
                               headers=VA(m)), 200)
            veedor_only.add(m["code"])
            if i % 3 == 2:
                # Con el partido TERMINADO el veedor todavía puede asignarle jugador a lo que cargó
                # "sin identificar" (no toca el marcador); el otro veedor no; con la mesa, nadie.
                base = f"{PUB}/staff/matches/{m['code']}"
                ev = expect(client.post(f"{base}/events", json={"team_id": m["home"]["team_id"], "type": "YELLOW"},
                                        headers=VH(m)), 200)
                me_h = expect(client.get(f"{PUB}/staff/me", headers=VH(m)), 200)
                mine = next(x for x in me_h["matches"] if x["code"] == m["code"])
                roster = me_h["teams"][mine["home_team_id"]]["players"]
                if roster:
                    r = expect(client.patch(f"{base}/events/{ev['event_id']}", json={"player_id": roster[0]["id"]},
                                            headers=VH(m)), 200)
                    ok(r["changed"] is True, "veedor asigna jugador con el partido terminado")
                expect(client.patch(f"{base}/events/{ev['event_id']}", json={"player_id": str(uuid.uuid4())},
                                    headers=VH(m)), 400, "PLAYER_NOT_IN_TEAM")
                if team_token[m["home"]["team_id"]] != team_token[m["away"]["team_id"]]:
                    expect(client.patch(f"{base}/events/{ev['event_id']}", json={"player_id": None},
                                        headers=VA(m)), 403, "EVENT_NOT_YOURS")
                expect(client.post(f"{ADM}/matches/{m['code']}/confirm", headers=H), 200)
                expect(client.post(f"{PUB}/staff/matches/{m['code']}/events",
                                   json={"team_id": m["home"]["team_id"], "type": "GOAL"},
                                   headers=VH(m)), 409, "MATCH_CONFIRMED")
                expect(client.patch(f"{base}/events/{ev['event_id']}", json={"player_id": None},
                                    headers=VH(m)), 409, "MATCH_CONFIRMED")
        expected_scores[m["code"]] = (hg, ag)

    # Corrección de la mesa: un partido del veedor con marcador mal → PATCH (queda desfasaje con eventos).
    confirmed = {m["code"] for k, m in enumerate(sat) if k % 3 == 2}
    fix = next(c for c in sorted(veedor_only) if c not in confirmed and sum(expected_scores[c]) > 0)
    h0, a0 = expected_scores[fix]
    expect(client.patch(f"{ADM}/matches/{fix}", json={"home_goals": h0 + 1}, headers=H), 200)
    expected_scores[fix] = (h0 + 1, a0)
    veedor_only.discard(fix)

    snap = snapshot(client, H)
    by = {m["code"]: m for m in snap["matches"]}
    for code, (hg, ag) in expected_scores.items():
        ok((by[code]["home_goals"], by[code]["away_goals"]) == (hg, ag), f"marcador {code}")
    ok(all(by[c]["goal_detail_mismatch"] is False for c in veedor_only), "eventos del veedor == marcador")
    ok(by[fix]["goal_detail_mismatch"] is True, "la corrección manual se marca como desfasaje")
    ok(all(r["played"] == 3 for g in snap["groups"] for r in g["rows"]), "cada equipo jugó 3")
    ok(sum(r["points"] for g in snap["groups"] for r in g["rows"]) ==
       sum(3 if by[c]["home_goals"] != by[c]["away_goals"] else 2 for c in expected_scores), "puntos totales")

    # ---- cierre de fase (con sorteos si hace falta) ----
    for _ in range(5):
        prev = expect(client.get(f"{ADM}/group-stage/preview", headers=H), 200)
        if prev["can_close"]:
            break
        ok(not prev["unfinished_matches"], "no quedan partidos sin terminar")
        for tie in prev["ties"]:
            order = list(tie["team_ids"])
            rng.shuffle(order)
            expect(client.put(f"{ADM}/draws", json={"context": tie["context"],
                                                   "ranks": [{"team_id": t, "rank": k + 1} for k, t in enumerate(order)]},
                              headers=H), 200)
            checks["draws"] += 1
    body = expect(client.post(f"{ADM}/group-stage/close", headers=H), 200)
    ok(body["updates"] >= 28, f"cierre escribe los cruces del domingo ({body['updates']})")
    expect(client.post(f"{ADM}/group-stage/close", headers=H), 409, "GROUP_STAGE_ALREADY_CLOSED")
    expect(client.put(f"{ADM}/slots", json={"assignments": [{"group": "A", "position": 1, "team_id": None}]},
                      headers=H), 409, "GROUP_STAGE_CLOSED")

    snap = snapshot(client, H)
    by = {m["code"]: m for m in snap["matches"]}
    thirds = [r["team_id"] for r in snap["thirds"]["rows"]]
    grp = {t["id"]: t["group"] for t in snap["teams"]}
    for c in (1, 2, 3, 4):
        m = by[f"ORO-O{c}"]
        ok(grp[m["home"]["team_id"]] != grp[m["away"]["team_id"]], f"ORO-O{c} sin cruce intra-zona")
    for c in (1, 2, 3, 4):  # cuartos de Bronce: 3°..6° mejor 3° vs ganador del octavo c
        ok(by[f"BRONCE-C{c}"]["home"]["team_id"] == thirds[1 + c], f"Bronce C{c}: local = {2 + c}° mejor 3°")
    for c in (1, 2):
        m = by[f"BRONCE-O{c}"]
        ok(grp[m["home"]["team_id"]] != grp[m["away"]["team_id"]], f"BRONCE-O{c} sin cruce intra-zona")

    # ---- DOMINGO ----
    sunday = sorted((m for m in snap["matches"] if m["stage"] != "GROUP"), key=lambda m: (m["scheduled_at"], m["venue"]))
    pens_count = 0
    for m in sunday:
        next_minute()
        cur = {x["code"]: x for x in snapshot(client, H)["matches"]}[m["code"]]
        ok(cur["home"]["team_id"] and cur["away"]["team_id"], f"{m['code']} tiene ambos equipos a su hora")
        hg, ag = rng.choice([0, 1, 1, 2, 3]), rng.choice([0, 1, 1, 2, 3])
        base = f"{PUB}/staff/matches/{m['code']}"
        if m["code"] in ("ORO-O3", "BRONCE-O2", "PLATA-S1", "ORO-F"):
            # Mesa central: empate sin penales → rechazo; con penales → ok.
            if hg == ag:
                expect(client.post(f"{ADM}/matches/{m['code']}/result",
                                   json={"home_goals": hg, "away_goals": ag}, headers=H), 409, "PENALTIES_REQUIRED")
                expect(client.post(f"{ADM}/matches/{m['code']}/result",
                                   json={"home_goals": hg, "away_goals": ag, "home_pens": 3, "away_pens": 2}, headers=H), 200)
                pens_count += 1
            else:
                expect(client.post(f"{ADM}/matches/{m['code']}/result",
                                   json={"home_goals": hg, "away_goals": ag}, headers=H), 200)
            continue
        # El equipo avanzó → su veedor ve el cruce sin que nadie lo reasigne.
        me_home = expect(client.get(f"{PUB}/staff/me", headers=VH(cur)), 200)
        ok(m["code"] in {x["code"] for x in me_home["matches"] if x["mine"]}, f"{m['code']}: el veedor del equipo opera el cruce")
        play_with_veedor(cur, hg, ag, cards=False)
        if hg == ag:
            expect(client.post(f"{base}/status", json={"status": "FINISHED"}, headers=VH(cur)), 409, "PENALTIES_REQUIRED")
            hp = rng.randint(0, 3)
            expect(client.put(f"{base}/penalties", json={"home_pens": hp, "away_pens": (hp + 1) % 4},
                              headers=VA(cur)), 200)
            pens_count += 1
        expect(client.post(f"{base}/status", json={"status": "FINISHED"}, headers=VH(cur)), 200)

        if m["code"] == "ORO-O2":
            # Corrección con re-propagación: dar vuelta ORO-O1 antes de que empiece ORO-C1.
            s = {x["code"]: x for x in snapshot(client, H)["matches"]}
            o1 = s["ORO-O1"]
            before = s["ORO-C1"]["home"]["team_id"]
            loser = s["PLATA-C1"]["home"]["team_id"]
            hp, ap = o1["home_pens"], o1["away_pens"]
            if hp is None:
                patch = {"home_goals": o1["away_goals"], "away_goals": o1["home_goals"]}
            else:
                patch = {"home_pens": ap, "away_pens": hp}
            expect(client.patch(f"{ADM}/matches/ORO-O1", json=patch, headers=H), 200)
            s2 = {x["code"]: x for x in snapshot(client, H)["matches"]}
            ok(s2["ORO-C1"]["home"]["team_id"] == loser and s2["PLATA-C1"]["home"]["team_id"] == before,
               "corrección de ORO-O1 re-propaga a Oro C1 y Plata C1")

    # ---- verificación final (snapshot PÚBLICO) ----
    svc.invalidate_cache()
    pub = client.get(PUB).json()
    by = {m["code"]: m for m in pub["matches"]}
    ok(all(m["status"] in ("FINISHED", "WALKOVER") for m in pub["matches"]), "75 partidos terminados")
    for final in ("ORO-F", "PLATA-F", "BRONCE-F"):
        ok(by[final]["winner_team_id"], f"campeón {final}")
    ok(len({by[f"ORO-F"]["winner_team_id"], by["PLATA-F"]["winner_team_id"], by["BRONCE-F"]["winner_team_id"]}) == 3,
       "tres campeones distintos")
    at = Counter((m["scheduled_at"], t) for m in pub["matches"] for t in (m["home"]["team_id"], m["away"]["team_id"]))
    ok(max(at.values()) == 1, "nadie juega dos partidos a la vez")
    ok(len(pub["stats"]["scorers"]) > 0, "tabla de goleadores con datos")
    ok(all(s["goals"] >= 1 for s in pub["stats"]["scorers"]), "goleadores válidos")
    ok(pub["competition"]["status"] == "LIVE", "la competencia pasó a LIVE sola")

    with engine.connect() as conn:
        n_audit = conn.execute(text("""
            SELECT COUNT(*) FROM public.competition_audit_log a
            JOIN public.competitions c ON c.id = a.competition_id WHERE c.slug = :s
        """), {"s": SLUG}).scalar()
    ok(n_audit > 200, f"auditoría registrada ({n_audit} entradas)")

    rotating_veedores(client, H)

    # ---- performance del snapshot ----
    svc.invalidate_cache()
    t = time.perf_counter()
    r = client.get(PUB)
    cold_ms = (time.perf_counter() - t) * 1000
    raw = len(r.content)
    gz = len(gzip.compress(r.content))
    ok(r.headers.get("content-encoding") == "gzip", "respuesta comprimida con gzip")
    n = 1000
    next_minute()
    t = time.perf_counter()
    for _ in range(n):
        client.get(PUB)
    warm_rps = n / (time.perf_counter() - t)

    print(f"\n✓ {checks['ok']} verificaciones OK  |  sorteos de desempate: {checks['draws']}  |  definiciones por penales: {pens_count}")
    print(f"  snapshot: {raw/1024:.0f} KB crudo → {gz/1024:.0f} KB gzip  |  frío: {cold_ms:.0f} ms  |  cacheado: {warm_rps:.0f} req/s (in-process)")
    print(f"  campeones: Oro={_name(pub, by['ORO-F']['winner_team_id'])}  Plata={_name(pub, by['PLATA-F']['winner_team_id'])}  "
          f"Bronce={_name(pub, by['BRONCE-F']['winner_team_id'])}")


def rotating_veedores(client, H):
    """
    Veedores ROTATIVOS (decisión 2026-10-08) sobre una DEMO local: "Reiniciar TODO" del panel de
    producción (y que en el torneo real se rechace), sorteo de nuevo, alta de veedores con nombre
    desde la mesa de control y la toma de partidos en la cancha (tomar, conflicto, tomarlo igual,
    soltar, reasignar desde la mesa, baja).
    """
    spec = importlib.util.spec_from_file_location(
        "demo_competition", os.path.join(os.path.dirname(__file__), "..", "scripts", "demo_competition.py"))
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    dslug = demo.DEMO_SLUG
    dpub = f"/public/competitions/{dslug}"
    prod_tok, ctl_tok = uuid.uuid4().hex * 2, uuid.uuid4().hex * 2
    D, C = {"X-Draw-Token": prod_tok}, {"X-Control-Token": ctl_tok}

    def set_tokens(conn, slug):
        st = conn.execute(text("SELECT settings FROM public.competitions WHERE slug = :s"), {"s": slug}).scalar() or {}
        st = dict(st) if isinstance(st, dict) else json.loads(st)
        st["live_draw"] = {**(st.get("live_draw") or {}), "producer_token_hash": hash_management_token(prod_tok)}
        st["control"] = {"token_hash": hash_management_token(ctl_tok)}
        conn.execute(text("UPDATE public.competitions SET settings = CAST(:st AS jsonb) WHERE slug = :s"),
                     {"st": json.dumps(st), "s": slug})

    with engine.begin() as conn:
        links = demo.crear(conn, "2026-10-10", random.Random(7))
        set_tokens(conn, dslug)
        set_tokens(conn, SLUG)
    svc.invalidate_cache()
    next_minute()

    # ---- "Reiniciar TODO": solo demo ----
    expect(client.post(f"{PUB}/draw/control/reset_all", headers=D), 403, "DEMO_ONLY")
    V = {"X-Staff-Token": links[0]["link"].rsplit("/", 1)[1]}  # veedor por cancha de la demo
    played = [m for m in expect(client.get(f"{dpub}/staff/me", headers=V), 200)["matches"] if m["mine"]][:2]
    ok(len(played) == 2, "la demo trae veedores por cancha con partidos")
    for m in played:
        base = f"{dpub}/staff/matches/{m['code']}"
        expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=V), 200)
        expect(client.post(f"{base}/events", json={"team_id": m["home_team_id"], "type": "GOAL"}, headers=V), 200)
    expect(client.post(f"{dpub}/staff/matches/{played[0]['code']}/status", json={"status": "FINISHED"}, headers=V), 200)
    expect(client.post(f"{dpub}/control/matches/{played[0]['code']}/confirm", headers=C), 200)
    expect(client.post(f"{dpub}/draw/control/reset", headers=D), 409, "GROUP_STAGE_ALREADY_STARTED")
    out = expect(client.post(f"{dpub}/draw/control/reset_all", headers=D), 200)
    st = out["state"]
    ok(out["matches_reset"] == 75 and st["status"] == "IDLE" and st["placed"] == 0 and not st["picks"],
       "Reiniciar TODO: 75 partidos a cero, sorteo sin empezar y zonas vacías")
    ok(st["mode"] == "TANDAS" and st["current_tanda"]["n"] == 1, "quedan cargadas las tandas oficiales")
    with engine.connect() as conn:
        cid = conn.execute(text("SELECT id FROM public.competitions WHERE slug = :s"), {"s": dslug}).scalar()
        dirty = conn.execute(text("""
            SELECT COUNT(*) FROM public.competition_matches
            WHERE competition_id = :cid AND (status <> 'SCHEDULED' OR home_goals IS NOT NULL OR confirmed_at IS NOT NULL
                  OR veedor_staff_id IS NOT NULL OR home_team_id IS NOT NULL OR away_team_id IS NOT NULL)
        """), {"cid": cid}).scalar()
        n_events = conn.execute(text("SELECT COUNT(*) FROM public.competition_match_events WHERE competition_id = :cid"),
                                {"cid": cid}).scalar()
        n_players = conn.execute(text("SELECT COUNT(*) FROM public.competition_players WHERE competition_id = :cid"),
                                 {"cid": cid}).scalar()
    ok(dirty == 0 and n_events == 0, "ningún partido con resultado, equipos ni veedor; sin eventos")
    ok(n_players > 0, "los planteles quedan")
    ok(not any(m["mine"] for m in expect(client.get(f"{dpub}/staff/me", headers=V), 200)["matches"]),
       "el veedor por cancha queda sin partidos (siguen sus links)")

    # ---- sorteo otra vez (digital) ----
    expect(client.post(f"{dpub}/draw/control/start", headers=D), 200)
    for _ in range(28):
        expect(client.post(f"{dpub}/draw/control/pick", json={}, headers=D), 200)
    st = expect(client.post(f"{dpub}/draw/control/finish", headers=D), 200)["state"]
    ok(st["status"] == "DONE" and st["placed"] == 28, "sorteo hecho de nuevo después de reiniciar")

    # ---- veedores con nombre desde la mesa de control ----
    ana = expect(client.post(f"{dpub}/control/staff", json={"full_name": "Ana Rotativa"}, headers=C), 200)
    beto = expect(client.post(f"{dpub}/control/staff", json={"full_name": "Beto Rotativo"}, headers=C), 200)
    A, B = {"X-Staff-Token": ana["token"]}, {"X-Staff-Token": beto["token"]}

    def mine_view(h, code):
        me = expect(client.get(f"{dpub}/staff/me", headers=h), 200)
        return me, next(x for x in me["matches"] if x["code"] == code)

    me_a = expect(client.get(f"{dpub}/staff/me", headers=A), 200)
    m = next(x for x in me_a["matches"] if x["stage"] == "GROUP")
    ok(m["holder"] is None and not m["mine"] and m["home_team_id"], "partido libre (con equipos del sorteo nuevo)")
    base = f"{dpub}/staff/matches/{m['code']}"
    expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=A), 403, "MATCH_NOT_ASSIGNED")
    r = expect(client.post(f"{base}/claim", json={}, headers=A), 200)
    ok(r["changed"] and not r["took_over"], "Ana toma el partido")
    ok(expect(client.post(f"{base}/claim", headers=A), 200)["changed"] is False, "tomarlo otra vez no cambia nada")
    expect(client.post(f"{base}/claim", json={}, headers=B), 409, "MATCH_TAKEN")
    _, mb = mine_view(B, m["code"])
    ok(mb["holder"] == {"name": "Ana Rotativa", "me": False} and not mb["mine"], "Beto ve que lo tiene Ana")
    expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=A), 200)
    e1 = expect(client.post(f"{base}/events", json={"team_id": m["home_team_id"], "type": "GOAL"}, headers=A), 200)
    expect(client.post(f"{base}/release", headers=A), 409, "MATCH_ALREADY_STARTED")
    ok(expect(client.post(f"{base}/claim", json={"force": True}, headers=B), 200)["took_over"], "Beto lo toma igual")
    expect(client.post(f"{base}/events", json={"team_id": m["home_team_id"], "type": "YELLOW"}, headers=A),
           403, "MATCH_NOT_ASSIGNED")
    me_b, mb = mine_view(B, m["code"])
    ev = next(e for e in mb["events"] if e["id"] == e1["event_id"])
    ok(mb["holder"]["me"] and mb["mine"] and ev["editable"] and not ev["mine"], "Beto puede corregir el gol que cargó Ana")
    roster = me_b["teams"][m["home_team_id"]]["players"]
    expect(client.patch(f"{base}/events/{e1['event_id']}", json={"player_id": roster[0]["id"]}, headers=B), 200)
    e2 = expect(client.post(f"{dpub}/control/matches/{m['code']}/events",
                            json={"team_id": m["away_team_id"], "type": "YELLOW"}, headers=C), 200)
    expect(client.delete(f"{base}/events/{e2['event_id']}", headers=B), 403, "EVENT_NOT_YOURS")
    expect(client.delete(f"{base}/events/{e1['event_id']}", headers=B), 200)
    _, ma = mine_view(A, m["code"])
    ok(ma["holder"]["name"] == "Beto Rotativo" and not ma["mine"] and not any(e["editable"] for e in ma["events"]),
       "Ana ya no opera el partido")

    # soltar uno tomado por error (solo antes de empezar y solo el que lo tiene)
    m2 = next(x for x in me_a["matches"] if x["stage"] == "GROUP" and x["code"] != m["code"])
    b2 = f"{dpub}/staff/matches/{m2['code']}"
    expect(client.post(f"{b2}/claim", json={}, headers=A), 200)
    expect(client.post(f"{b2}/release", headers=B), 403, "MATCH_NOT_ASSIGNED")
    expect(client.post(f"{b2}/release", headers=A), 200)
    ok(mine_view(A, m2["code"])[1]["holder"] is None, "Ana suelta el partido que tomó por error")

    # la mesa reasigna / libera
    expect(client.patch(f"{dpub}/control/matches/{m['code']}", json={"veedor_staff_id": ana["staff_id"]}, headers=C), 200)
    ok(mine_view(A, m["code"])[1]["holder"]["me"], "la mesa se lo pasa a Ana")
    svc.invalidate_cache()
    pub_m = next(x for x in client.get(dpub).json()["matches"] if x["code"] == m["code"])
    ok(pub_m["veedor_name"] == "Ana Rotativa", "el sitio público muestra quién lo carga")
    expect(client.patch(f"{dpub}/control/matches/{m['code']}", json={"clear_veedor": True}, headers=C), 200)
    ok(mine_view(A, m["code"])[1]["holder"] is None, "la mesa lo deja libre")

    # baja y link nuevo
    expect(client.post(f"{dpub}/control/staff/{beto['staff_id']}/revoke", headers=C), 200)
    expect(client.get(f"{dpub}/staff/me", headers=B), 401, "INVALID_STAFF_TOKEN")
    nb = expect(client.post(f"{dpub}/control/staff/{beto['staff_id']}/rotate-token", headers=C), 200)
    expect(client.get(f"{dpub}/staff/me", headers={"X-Staff-Token": nb["token"]}), 200)
    expect(client.post(f"{dpub}/control/staff", json={"full_name": "x"}, headers=C), 422)
    expect(client.post(f"{dpub}/control/staff", json={"full_name": "Sin token"}), 401, "INVALID_CONTROL_TOKEN")

    acts = {r["action"] for r in expect(client.get(f"{dpub}/control/audit?limit=500", headers=C), 200)}
    ok({"MATCH_CLAIM", "MATCH_TAKEOVER", "MATCH_RELEASE", "DEMO_RESET_ALL", "STAFF_CREATE", "STAFF_REVOKE"} <= acts,
       "auditoría: tomas, soltar, reinicio y altas/bajas")

    with engine.begin() as conn:
        demo.borrar(conn)
    svc.invalidate_cache()


def demo_live(client, turn, VH, VT):
    """Pone en juego el próximo turno (6 canchas); cada veedor carga los goles de su equipo."""
    for k, m in enumerate(turn):
        base = f"{PUB}/staff/matches/{m['code']}"
        expect(client.post(f"{base}/status", json={"status": "LIVE"}, headers=VH(m)), 200)
        for _ in range(rng.choice([0, 1, 1, 2])):
            side = rng.choice(["home", "away"])
            expect(client.post(f"{base}/events", json={"team_id": m[side]["team_id"], "type": "GOAL",
                                                          "shirt_number": rng.choice([7, 9, 10, None])},
                               headers=VT(m[side]["team_id"])), 200)
        if k == 2:
            expect(client.post(f"{base}/status", json={"status": "HALFTIME"}, headers=VH(m)), 200)
    pub = client.get(PUB).json()
    print(f"\nDEMO listo: {len(turn)} partidos en vivo. Links de veedor (equipos a cargo):")
    snap_staff = {st["full_name"]: st for st in DEMO_ADMIN["staff"]} if DEMO_ADMIN else {}
    team_names = {t["id"]: t["name"] for t in pub["teams"]}
    for name, token in DEMO_TOKENS.items():
        teams = [team_names[t] for t in snap_staff.get(name, {}).get("team_ids", [])]
        print(f"  {name}: /v/{token}  ← {', '.join(teams) or 'cancha 1 (reserva)'}")


def _name(pub, tid):
    return next(t["name"] for t in pub["teams"] if t["id"] == tid)


if __name__ == "__main__":
    main_sim()
