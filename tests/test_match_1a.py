"""
Tests de la iteración 1a del rediseño UX (pantalla del partido, "Me anoto" de un toque).

- Parte sin DB: pseudo-canchas y primera libre (funciones puras), flags en /config,
  CORS con X-UI-Source, schema del alta.
- Parte con DB: va por HTTP (TestClient) contra una base Postgres LOCAL con las
  migraciones 001-020. Crea sus propios usuarios, eventos y canchas y los borra al
  terminar. Exige UX_1A_DB_TEST=1 y DATABASE_URL en localhost; si no, se saltea.
  Las carreras llaman a los endpoints desde hilos, cada uno con su transacción.

Correr:
  ./.venv/bin/python tests/test_match_1a.py
  UX_1A_DB_TEST=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python tests/test_match_1a.py
"""
import os
import sys
import threading
import uuid
from contextlib import contextmanager
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-match-1a")
for k in ("AUTO_CLOSE_ON_FULL", "GUEST_LIMIT_PER_USER", "ACCOUNT_APPROVAL_ENABLED",
          "MATCH_SCREEN_ENABLED", "ONE_TAP_REGISTER_ENABLED", "CORS_ORIGINS"):
    os.environ.pop(k, None)

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app import settings  # noqa: E402
from app.routers import events as ev  # noqa: E402
from app.schemas import CancelRequest, RegisterRequest  # noqa: E402
from app.settings import engine  # noqa: E402
from app.utils.audit import parse_ui_source  # noqa: E402
from app.utils.auth_token import issue_token  # noqa: E402
from app.utils.courts import alternatives, is_pseudo_court, pick_first_free  # noqa: E402

_url = os.environ.get("DATABASE_URL", "").replace("+psycopg", "")
DB_ENABLED = (
    os.environ.get("UX_1A_DB_TEST") == "1"
    and urlparse(_url).hostname in ("127.0.0.1", "localhost")
)


@contextmanager
def one_tap(enabled: bool = True):
    before = settings.ONE_TAP_REGISTER_ENABLED
    settings.ONE_TAP_REGISTER_ENABLED = enabled
    try:
        yield
    finally:
        settings.ONE_TAP_REGISTER_ENABLED = before


# ---------- Sin DB ----------

def test_pseudo_court_names():
    for name in ("Sala de espera", "suplentes", "Suplentes | lista de espera",
                 "cancha suplente - sujeta a disp", "Reserva", "BANCO"):
        assert is_pseudo_court(name), name
    for name in ("Cancha 1", "cancha 13", "Equipo blanco", "Techada", "", None, "Desesperados FC"):
        assert not is_pseudo_court(name), name


def _c(cid, name, cap=2, is_open=True):
    return {"id": cid, "name": name, "capacity": cap, "is_open": is_open}


def test_pick_first_free_rules():
    courts = [_c("s", "Suplentes"), _c("a", "Cancha 1", is_open=False), _c("b", "Cancha 2", cap=1),
              _c("c", "Cancha 3")]
    # Saltea la pseudo, la cerrada y la llena.
    assert pick_first_free(courts, {"b": 1})["id"] == "c"
    # La cancha de quien invita va primero si tiene lugar.
    assert pick_first_free(courts, {}, prefer_court_id="c")["id"] == "c"
    assert pick_first_free(courts, {"c": 2}, prefer_court_id="c")["id"] == "b"
    # Todo lleno → None (aunque la pseudo tenga lugar).
    assert pick_first_free(courts, {"b": 1, "c": 2}) is None
    # Solo pseudo-canchas: cuentan como canchas.
    assert pick_first_free([_c("s", "Lista de espera")], {})["id"] == "s"


def test_alternatives_real_first():
    courts = [_c("s", "Suplentes", cap=5), _c("a", "Cancha 1", cap=1), _c("b", "Cancha 2", cap=3),
              _c("c", "Cancha 3", is_open=False)]
    alts = alternatives(courts, {"a": 1, "b": 1}, exclude_court_id="a")
    assert [a["court_id"] for a in alts] == ["b", "s"]
    assert alts[0] == {"court_id": "b", "name": "Cancha 2", "available": 2, "is_pseudo": False}


def test_match_screen_mode_parse():
    parse = settings._match_screen_mode
    assert [parse(v) for v in (None, "", "off", "false", "nope")] == ["off"] * 5
    assert [parse(v) for v in ("admins", " ADMINS ")] == ["admins"] * 2
    assert [parse(v) for v in ("all", "true", "True")] == ["all"] * 3


def test_ui_source_parse():
    assert parse_ui_source("match") == "match"
    assert parse_ui_source(" Legacy ") == "legacy"
    assert parse_ui_source("shell") is None
    assert parse_ui_source(None) is None


def test_config_exposes_1a_flags():
    with TestClient(main.app) as client:
        body = client.get("/config").json()
        assert body["matchScreen"] == "off"
        assert body["oneTapRegisterEnabled"] is False
        before = settings.MATCH_SCREEN_ENABLED
        settings.MATCH_SCREEN_ENABLED = "admins"
        try:
            with one_tap():
                body = client.get("/config").json()
        finally:
            settings.MATCH_SCREEN_ENABLED = before
        assert body["matchScreen"] == "admins"
        assert body["oneTapRegisterEnabled"] is True


def test_cors_allows_ui_source():
    with TestClient(main.app) as client:
        r = client.options("/events/x/register", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-actor-user-id,x-ui-source",
        })
        assert r.status_code == 200, r.text
        assert "x-ui-source" in r.headers["access-control-allow-headers"].lower()


def test_register_schema():
    assert RegisterRequest().court_id is None
    assert RegisterRequest(court_id="  ").court_id is None
    assert RegisterRequest().if_full == "waitlist"
    try:
        RegisterRequest(court_id="no-es-uuid")
    except ValueError:
        pass
    else:
        raise AssertionError("court_id inválido tiene que fallar la validación")


# ---------- Fixture con DB ----------

class World:
    def __init__(self):
        self.tag = uuid.uuid4().hex[:8]
        self.users: dict[str, str] = {}
        self.event_ids: list[str] = []
        self.client = TestClient(main.app)

    def user(self, key: str, admin: bool = False) -> str:
        with engine.begin() as conn:
            uid = conn.execute(text("""
                insert into public.users (full_name, phone_e164, phone_login)
                values (:name, :phone, :phone) returning id::text
            """), {"name": f"{key.capitalize()} Test", "phone": f"+5491{self.tag}{len(self.users):03d}"}).scalar()
            if admin:
                conn.execute(text("""
                    insert into public.user_roles (user_id, role_id)
                    select :uid, id from public.roles where code = 'admin'
                """), {"uid": uid})
        self.users[key] = uid
        return uid

    def event(self, courts, starts_in: str = "2 days", status: str = "OPEN"):
        """courts: lista de (name, capacity, sort_order, created_offset_min, is_open)."""
        with engine.begin() as conn:
            eid = conn.execute(text("""
                insert into public.events (title, starts_at, location_name, status, created_by_user_id)
                values (:title, now() + CAST(:starts_in AS interval), 'Club Test', :status, :org)
                returning id::text
            """), {"title": f"Partido 1a {self.tag}", "starts_in": starts_in, "status": status,
                   "org": self.users["org"]}).scalar()
            ids = []
            for name, cap, so, offset, is_open in courts:
                ids.append(conn.execute(text("""
                    insert into public.event_courts (event_id, name, capacity, sort_order, is_open, created_at)
                    values (:eid, :name, :cap, :so, :open, now() + make_interval(mins => :off))
                    returning id::text
                """), {"eid": eid, "name": name, "cap": cap, "so": so, "open": is_open, "off": offset}).scalar())
        self.event_ids.append(eid)
        return eid, ids

    def h(self, key: str, ui: str | None = None) -> dict:
        headers = {"X-Actor-User-Id": issue_token(self.users[key])}
        if ui:
            headers["X-UI-Source"] = ui
        return headers

    def register(self, key: str, eid: str, body=None, ui=None):
        return self.client.post(f"/events/{eid}/register", json=body or {}, headers=self.h(key, ui))

    def cancel(self, key: str, reg_id: str, body=None, ui=None):
        return self.client.post(f"/registrations/{reg_id}/cancel", json=body, headers=self.h(key, ui))

    def active(self, key: str, eid: str, extra: str = ""):
        return self.client.get(f"/events/active?event_id={eid}{extra}", headers=self.h(key))

    def q(self, sql: str, **params):
        with engine.connect() as conn:
            return conn.execute(text(sql), params).mappings().all()

    def cleanup(self):
        with engine.begin() as conn:
            for eid in self.event_ids:
                conn.execute(text("delete from public.event_audit_log where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_registrations where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_courts where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.events where id = :e"), {"e": eid})
            uids = list(self.users.values())
            conn.execute(text("delete from public.user_roles where user_id = ANY(CAST(:u AS uuid[]))"), {"u": uids})
            conn.execute(text("delete from public.users where id = ANY(CAST(:u AS uuid[]))"), {"u": uids})


def _world() -> World:
    w = World()
    w.user("org", admin=True)
    for k in ("ana", "beto", "caro", "dani"):
        w.user(k)
    return w


def _audit(w: World, eid: str, action: str):
    return w.q("""
        select actor_user_id::text as actor, target_registration_id::text as target, metadata
        from public.event_audit_log where event_id = :e and action = :a order by created_at, id
    """, e=eid, a=action)


def _status(w: World, reg_id: str):
    return w.q("select status, court_id::text as court_id from public.event_registrations where id = :r",
               r=reg_id)[0]


# ---------- Con DB ----------

def db_test_one_tap_order(w: World):
    # sort_order empatado: gana la creada antes ("Cancha 5"), no el nombre.
    eid, (c13, c5) = w.event([("Cancha 13", 1, 1, 5, True), ("Cancha 5", 1, 1, 0, True)])
    with one_tap():
        r = w.register("ana", eid)
        assert r.status_code == 200, r.text
        assert (r.json()["court_id"], r.json()["court_name"], r.json()["assigned"]) == (c5, "Cancha 5", "auto")
        assert w.register("beto", eid).json()["court_id"] == c13
    # sort_order al revés que la creación: manda sort_order.
    eid, (late, first) = w.event([("B", 2, 2, -10, True), ("A", 2, 1, 10, True)])
    with one_tap():
        assert w.register("ana", eid).json()["court_id"] == first


def db_test_one_tap_skips_pseudo_closed_full(w: World):
    eid, (sup, c1, c2, c3) = w.event([
        ("Suplentes", 5, 1, 0, True), ("Cancha 1", 2, 2, 0, False),
        ("Cancha 2", 1, 3, 0, True), ("Cancha 3", 2, 4, 0, True),
    ])
    with one_tap():
        assert w.register("ana", eid).json()["court_id"] == c2
        assert w.register("beto", eid).json()["court_id"] == c3
    # Un partido solo con pseudo-canchas: la usa.
    eid, (only,) = w.event([("Lista de espera", 3, 1, 0, True)])
    with one_tap():
        assert w.register("ana", eid).json()["court_id"] == only


def db_test_all_full_waitlist_and_edge_cases(w: World):
    eid, (c1, sup) = w.event([("Cancha 1", 1, 1, 0, True), ("Suplentes", 5, 2, 0, True)])
    with one_tap():
        assert w.register("ana", eid).json()["status"] == "CONFIRMED"
        b = w.register("beto", eid).json()
        c = w.register("caro", eid).json()
    assert (b["status"], b["court_id"], b["court_name"], b["waitlist_position"]) == ("WAITLIST", None, None, 1)
    assert c["waitlist_position"] == 2
    # Ya anotado: 409 con el texto de siempre.
    with one_tap():
        r = w.register("ana", eid)
    assert r.status_code == 409 and r.json()["detail"] == "Ya estás anotado en este partido (Cancha 1)."

    # Sin canchas, y con todas las reales cerradas (aunque la pseudo esté abierta).
    no_courts, _ = w.event([])
    closed, _ = w.event([("Cancha 1", 2, 1, 0, False), ("Suplentes", 5, 2, 0, True)])
    with one_tap():
        r1 = w.register("dani", no_courts)
        r2 = w.register("dani", closed)
    assert (r1.status_code, r1.json()["detail"]) == (400, "El partido todavía no tiene canchas.")
    assert (r2.status_code, r2.json()["detail"]) == (400, "La inscripción está cerrada.")


def db_test_flag_off_requires_court(w: World):
    eid, (c1,) = w.event([("Cancha 1", 2, 1, 0, True)])
    with one_tap(False):
        r = w.register("ana", eid)
        assert (r.status_code, r.json()["detail"]) == (400, "Elegí una cancha.")
        # Con cancha, igual que siempre.
        assert w.register("ana", eid, {"court_id": c1}).json()["status"] == "CONFIRMED"


def db_test_conflict_on_full_court(w: World):
    eid, (c1, sup, c2) = w.event([
        ("Cancha 1", 1, 1, 0, True), ("Suplentes", 5, 2, 0, True), ("Cancha 2", 3, 3, 0, True),
    ])
    assert w.register("ana", eid, {"court_id": c1}).json()["status"] == "CONFIRMED"
    r = w.register("beto", eid, {"court_id": c1, "if_full": "conflict"}, ui="match")
    assert r.status_code == 409, r.text
    d = r.json()["detail"]
    assert (d["code"], d["court_id"], d["court_name"]) == ("COURT_FULL", c1, "Cancha 1")
    assert [(a["court_id"], a["available"], a["is_pseudo"]) for a in d["alternatives"]] == \
        [(c2, 3, False), (sup, 5, True)]
    assert w.q("select 1 from public.event_registrations where event_id = :e and user_id = :u",
               e=eid, u=w.users["beto"]) == []
    # La Home vieja (sin if_full) sigue anotando en la espera.
    legacy = w.register("beto", eid, {"court_id": c1}).json()
    assert (legacy["status"], legacy["waitlist_position"]) == ("WAITLIST", 1)


def db_test_audit_source_assigned_and_ui(w: World):
    eid, (c1, c2) = w.event([("Cancha 1", 1, 1, 0, True), ("Cancha 2", 2, 2, 0, True)])
    with one_tap():
        a = w.register("ana", eid, ui="match").json()
    b = w.register("beto", eid, {"court_id": c2, "if_full": "conflict"}, ui="legacy").json()
    c = w.register("caro", eid, {"court_id": c2}).json()
    meta = {x["target"]: x["metadata"] for x in _audit(w, eid, "REGISTER_USER")}
    assert meta[a["registration_id"]] == {"source": "one_tap", "assigned": "auto", "court_id": c1, "ui": "match"}
    assert meta[b["registration_id"]] == {"source": "slot_pick", "assigned": "chosen", "court_id": c2,
                                         "ui": "legacy"}
    assert meta[c["registration_id"]] == {"source": "api", "assigned": "chosen", "court_id": c2}
    # COURT_FULL lleva la pantalla del alta que llenó la cancha.
    full = {x["metadata"]["court_id"]: x["metadata"] for x in _audit(w, eid, "COURT_FULL")}
    assert full[c1]["ui"] == "match" and "ui" not in full[c2]
    # Un header desconocido no se guarda.
    with one_tap():
        d = w.register("dani", eid, ui="shell").json()
    assert "ui" not in {x["target"]: x["metadata"] for x in _audit(w, eid, "REGISTER_USER")}[d["registration_id"]]


def db_test_cancel_intent_promotion_and_rejoin(w: World):
    eid, (c1,) = w.event([("Cancha 1", 1, 1, 0, True)])
    with one_tap():
        a = w.register("ana", eid, ui="match").json()
        b = w.register("beto", eid, ui="match").json()
    assert b["status"] == "WAITLIST"
    # "Liberar y avisar al grupo": promueve a Beto y lo dice la respuesta.
    r = w.cancel("ana", a["registration_id"], {"intent": "notify_group"}, ui="match")
    assert r.status_code == 200, r.text
    assert r.json()["promoted_registration_id"] == b["registration_id"]
    # Quién entró, para "Lo toma Beto" aunque la pantalla no lo tuviera cargado.
    assert r.json()["promoted"] == {"registration_id": b["registration_id"], "type": "USER",
                                    "name": "Beto Test", "created_by_name": "Beto Test"}
    assert _status(w, b["registration_id"]) == {"status": "CONFIRMED", "court_id": c1}
    cancel_meta = _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]
    assert cancel_meta == {"reason": "manual_cancel", "source": "self", "intent": "notify_group", "ui": "match"}
    assert _audit(w, eid, "PROMOTE_WAITLIST")[-1]["metadata"] == {"source": "auto_from_cancel", "ui": "match"}

    # Deshacer: baja con intent undo; al volver a anotarse entra al final (re-anota la fila).
    with one_tap():
        caro = w.register("caro", eid).json()
        again = w.register("ana", eid).json()
    assert (caro["status"], caro["waitlist_position"]) == ("WAITLIST", 1)
    assert again["registration_id"] == a["registration_id"]
    assert (again["status"], again["waitlist_position"]) == ("WAITLIST", 2)
    r = w.cancel("ana", again["registration_id"], {"intent": "undo"})
    assert _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"] == \
        {"reason": "manual_cancel", "source": "self", "intent": "undo"}
    # Sin body, como hoy (Home vieja, Calendario).
    r = w.cancel("beto", b["registration_id"])
    assert r.status_code == 200
    assert "intent" not in _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]
    # Intent inválido → 422.
    assert w.cancel("caro", caro["registration_id"], {"intent": "otro"}).status_code == 422


def db_test_active_payload(w: World):
    eid, (c1, sup) = w.event([("Cancha 1", 1, 1, 0, True), ("Suplentes", 5, 2, 0, True)])
    with one_tap():
        a = w.register("ana", eid).json()
        b = w.register("beto", eid).json()
        c = w.register("caro", eid).json()
    body = w.active("beto", eid).json()
    assert [(x["court_id"], x["is_pseudo"]) for x in body["courts"]] == [(c1, False), (sup, True)]
    viewer = body["viewer"]
    assert viewer["user_id"] == w.users["beto"]
    assert viewer["registration"] == {"registration_id": b["registration_id"], "status": "WAITLIST",
                                      "court_id": None, "waitlist_position": 1, "promoted_at": None}
    assert w.active("caro", eid).json()["viewer"]["registration"]["waitlist_position"] == 2
    assert w.active("dani", eid).json()["viewer"]["registration"] is None
    mine = w.active("ana", eid).json()["viewer"]["registration"]
    assert (mine["status"], mine["court_id"], mine["promoted_at"]) == ("CONFIRMED", c1, None)

    # Ana se baja: Beto entra desde la espera y lo ve en promoted_at; Caro pasa a ser la 1.ª.
    w.cancel("ana", a["registration_id"])
    beto = w.active("beto", eid).json()["viewer"]["registration"]
    assert (beto["status"], beto["court_id"], beto["waitlist_position"]) == ("CONFIRMED", c1, None)
    assert beto["promoted_at"]
    assert w.active("caro", eid).json()["viewer"]["registration"]["waitlist_position"] == 1
    assert c["registration_id"]

    # FINALIZED: solo con include_finished=1.
    done, _ = w.event([("Cancha 1", 2, 1, 0, True)], starts_in="-1 day", status="FINALIZED")
    assert w.active("ana", done).json()["event"] is None
    finished = w.active("ana", done, "&include_finished=1").json()
    assert finished["event"]["id"] == done and finished["event"]["status"] == "FINALIZED"
    # Un id que no es uuid ya no da 500.
    assert w.client.get("/events/active?event_id=abc", headers=w.h("ana")).status_code == 422


def db_test_guest_auto_court(w: World):
    eid, (c1, c2) = w.event([("Cancha 1", 2, 1, 0, True), ("Cancha 2", 2, 2, 0, True)])
    assert w.register("ana", eid, {"court_id": c2}).json()["status"] == "CONFIRMED"
    with one_tap():
        g1 = w.client.post(f"/events/{eid}/guests", json={"guest_name": "Fede"}, headers=w.h("ana", "match"))
        assert g1.status_code == 200, g1.text
        # Va con quien invita.
        assert (g1.json()["court_id"], g1.json()["assigned"]) == (c2, "auto")
        # La cancha de Ana está llena: el siguiente va a la primera libre.
        g2 = w.client.post(f"/events/{eid}/guests", json={"guest_name": "Gabi"}, headers=w.h("ana")).json()
        assert g2["court_id"] == c1
        w.client.post(f"/events/{eid}/guests", json={"guest_name": "Hugo"}, headers=w.h("ana"))
        full = w.client.post(f"/events/{eid}/guests", json={"guest_name": "Ivo"}, headers=w.h("ana"))
    assert (full.status_code, full.json()["detail"]) == \
        (409, "El partido está completo: no quedan lugares para invitados.")
    meta = _audit(w, eid, "REGISTER_GUEST")[0]["metadata"]
    assert meta == {"source": "one_tap", "assigned": "auto", "court_id": c2, "ui": "match"}
    with one_tap(False):
        off = w.client.post(f"/events/{eid}/guests", json={"guest_name": "Juli"}, headers=w.h("org"))
    assert (off.status_code, off.json()["detail"]) == (400, "Elegí una cancha.")


def _run_parallel(*fns):
    barrier = threading.Barrier(len(fns))
    results = [None] * len(fns)

    def run(i, fn):
        barrier.wait()
        try:
            results[i] = fn()
        except HTTPException as e:
            results[i] = e
    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def _occupancy(w: World, eid: str):
    rows = w.q("""
        select status, court_id::text as court_id from public.event_registrations
        where event_id = :e and status <> 'CANCELLED'
    """, e=eid)
    return sum(r["status"] == "CONFIRMED" for r in rows), sum(r["status"] == "WAITLIST" for r in rows)


def db_test_race_two_one_taps_for_last_spot(w: World):
    with one_tap():
        for _ in range(10):
            eid, _ = w.event([("Cancha 1", 1, 1, 0, True)])
            res = _run_parallel(
                lambda: ev.register_user(eid, RegisterRequest(), actor_user_id=w.users["ana"]),
                lambda: ev.register_user(eid, RegisterRequest(), actor_user_id=w.users["beto"]),
            )
            assert sorted(r["status"] for r in res) == ["CONFIRMED", "WAITLIST"], res
            assert _occupancy(w, eid) == (1, 1)


def db_test_admin_court_changes_take_the_match_lock(w: World):
    # Si el organizador sube el cupo mientras alguien toca "Anotarme en espera",
    # sin el lock el alta podía quedar en la espera con el lugar nuevo libre.
    eid, (c1,) = w.event([("Cancha 1", 1, 1, 0, True)])
    with one_tap():
        assert w.register("ana", eid).json()["status"] == "CONFIRMED"
    calls = [
        ("patch", f"/admin/events/{eid}/courts/{c1}", {"capacity": 2}),
        ("post", f"/admin/events/{eid}/courts/{c1}/close", None),
        ("post", f"/admin/events/{eid}/courts/{c1}/open", None),
        ("post", f"/admin/events/{eid}/courts", {"name": "Cancha 2", "capacity": 2, "sort_order": 2}),
    ]
    for method, path, body in calls:
        conn = engine.connect()
        tx = conn.begin()
        ev.lock_event_occupancy(conn, eid.upper())  # otra transacción del mismo partido (y otra grafía del id)
        result = {}
        t = threading.Thread(target=lambda: result.setdefault(
            "r", getattr(w.client, method)(path, json=body, headers=w.h("org"))))
        t.start()
        t.join(0.5)
        blocked = t.is_alive()
        tx.rollback()
        conn.close()
        t.join(10)
        assert blocked, f"{method} {path} no esperó el lock del partido"
        assert result["r"].status_code == 200, (path, result["r"].text)


def db_test_race_cancel_vs_one_tap(w: World):
    # Sin el lock del partido, Beto podía quedar en la espera con el lugar de Ana libre.
    with one_tap():
        for _ in range(10):
            eid, _ = w.event([("Cancha 1", 1, 1, 0, True)])
            ana = ev.register_user(eid, RegisterRequest(), actor_user_id=w.users["ana"])
            _run_parallel(
                lambda: ev.cancel_registration(ana["registration_id"], CancelRequest(),
                                               actor_user_id=w.users["ana"]),
                lambda: ev.register_user(eid, RegisterRequest(), actor_user_id=w.users["beto"]),
            )
            assert _occupancy(w, eid) == (1, 0)


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
        passed += 1

    db_tests = [v for k, v in sorted(globals().items()) if k.startswith("db_test_") and callable(v)]
    if not DB_ENABLED:
        print(f"  (salteados {len(db_tests)} tests con DB: falta UX_1A_DB_TEST=1 y DATABASE_URL local)")
    else:
        w = _world()
        try:
            with w.client:
                for t in db_tests:
                    t(w)
                    print(f"  ✓ {t.__name__}")
                    passed += 1
        finally:
            w.cleanup()
    print(f"\nOK: {passed} tests de la iteración 1a pasaron")


if __name__ == "__main__":
    _run_all()
