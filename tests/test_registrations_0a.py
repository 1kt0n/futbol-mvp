"""
Tests de la iteración 0a del rediseño UX (bajas, espera, re-anotarse, invitados).

- Parte sin DB: /config expone AUTO_CLOSE_ON_FULL y GUEST_LIMIT_PER_USER.
- Parte con DB: va por HTTP (TestClient) contra una base Postgres LOCAL con las
  migraciones 001-019. Crea sus propios usuarios, evento y canchas y los borra al
  terminar. Exige REGISTRATIONS_DB_TEST=1 y DATABASE_URL en localhost; si no, se
  saltea.

Correr:
  ./.venv/bin/python tests/test_registrations_0a.py
  REGISTRATIONS_DB_TEST=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python tests/test_registrations_0a.py
"""
import os
import sys
import uuid
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-registrations-0a")
for k in ("AUTO_CLOSE_ON_FULL", "GUEST_LIMIT_PER_USER", "ACCOUNT_APPROVAL_ENABLED"):
    os.environ.pop(k, None)

from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app import settings  # noqa: E402
from app.settings import engine  # noqa: E402
from app.utils.auth_token import issue_token  # noqa: E402

_url = os.environ.get("DATABASE_URL", "").replace("+psycopg", "")
DB_ENABLED = (
    os.environ.get("REGISTRATIONS_DB_TEST") == "1"
    and urlparse(_url).hostname in ("127.0.0.1", "localhost")
)


# ---------- Sin DB ----------

def test_config_exposes_0a_flags():
    with TestClient(main.app) as client:
        body = client.get("/config").json()
        assert body["autoCloseOnFull"] is False
        assert body["guestLimitPerUser"] == 5


# ---------- Fixture con DB ----------

class World:
    """Usuarios + un evento futuro con dos canchas de cupo 2."""

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
            """), {"name": f"{key.capitalize()} Test", "phone": f"+5490{self.tag}{len(self.users):03d}"}).scalar()
            if admin:
                conn.execute(text("""
                    insert into public.user_roles (user_id, role_id)
                    select :uid, id from public.roles where code = 'admin'
                """), {"uid": uid})
        self.users[key] = uid
        return uid

    def event(self, capacity: int = 2, courts: int = 2, starts_in: str = "2 days", status: str = "OPEN"):
        with engine.begin() as conn:
            eid = conn.execute(text("""
                insert into public.events (title, starts_at, location_name, status, created_by_user_id)
                values (:title, now() + CAST(:starts_in AS interval), 'Club Test', :status, :org)
                returning id::text
            """), {"title": f"Partido {self.tag}", "starts_in": starts_in, "status": status,
                   "org": self.users["org"]}).scalar()
            court_ids = [
                conn.execute(text("""
                    insert into public.event_courts (event_id, name, capacity, sort_order)
                    values (:eid, :name, :cap, :so) returning id::text
                """), {"eid": eid, "name": f"Cancha {i + 1}", "cap": capacity, "so": i + 1}).scalar()
                for i in range(courts)
            ]
        self.event_ids.append(eid)
        return eid, court_ids

    def h(self, key: str) -> dict:
        return {"X-Actor-User-Id": issue_token(self.users[key])}

    def post(self, key: str, path: str, json=None):
        return self.client.post(path, json=json, headers=self.h(key))

    def register(self, key: str, eid: str, court_id: str):
        return self.post(key, f"/events/{eid}/register", {"court_id": court_id})

    def cancel(self, key: str, reg_id: str):
        return self.post(key, f"/registrations/{reg_id}/cancel")

    def q(self, sql: str, **params):
        with engine.connect() as conn:
            return conn.execute(text(sql), params).mappings().all()

    def cleanup(self):
        with engine.begin() as conn:
            for eid in self.event_ids:
                conn.execute(text("delete from public.event_audit_log where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_court_captains where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_captains where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_registrations where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_courts where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.events where id = :e"), {"e": eid})
            uids = list(self.users.values())
            conn.execute(text("delete from public.user_roles where user_id = ANY(CAST(:u AS uuid[]))"), {"u": uids})
            conn.execute(text("delete from public.users where id = ANY(CAST(:u AS uuid[]))"), {"u": uids})


def _world() -> World:
    w = World()
    w.user("org", admin=True)
    for k in ("ana", "beto", "caro", "dani", "eli", "fede", "capi", "legacy"):
        w.user(k)
    return w


def _audit(w: World, eid: str, action: str):
    return w.q("""
        select actor_user_id::text as actor, target_registration_id::text as target, metadata
        from public.event_audit_log where event_id = :e and action = :a order by created_at
    """, e=eid, a=action)


# ---------- Con DB ----------

def db_test_self_cancel_and_not_others(w: World):
    eid, (c1, _) = w.event()
    ana = w.register("ana", eid, c1).json()["registration_id"]
    beto = w.register("beto", eid, c1).json()["registration_id"]

    r = w.cancel("ana", beto)
    assert r.status_code == 403, r.text
    assert "quien organiza el partido" in r.json()["detail"] and "Org" in r.json()["detail"]

    r = w.cancel("ana", ana)
    assert r.status_code == 200, r.text
    log = _audit(w, eid, "CANCEL_REGISTRATION")[-1]
    assert log["actor"] == w.users["ana"] and log["target"] == ana and log["metadata"]["source"] == "self"


def db_test_guest_owner_can_remove_own_guest_only(w: World):
    eid, (c1, c2) = w.event()
    g_ana = w.post("ana", f"/events/{eid}/guests", {"guest_name": "Invitado Ana", "court_id": c1}).json()["registration_id"]
    g_beto = w.post("beto", f"/events/{eid}/guests", {"guest_name": "Invitado Beto", "court_id": c2}).json()["registration_id"]

    assert w.cancel("ana", g_beto).status_code == 403
    r = w.cancel("ana", g_ana)
    assert r.status_code == 200, r.text
    assert _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]["source"] == "guest_owner"


def db_test_court_captain_and_admin_and_legacy(w: World):
    eid, (c1, c2) = w.event(capacity=3)
    with engine.begin() as conn:
        conn.execute(text("""
            insert into public.event_court_captains (event_id, court_id, user_id) values (:e, :c, :u)
        """), {"e": eid, "c": c1, "u": w.users["capi"]})
    in_c1 = w.register("ana", eid, c1).json()["registration_id"]
    in_c2 = w.register("beto", eid, c2).json()["registration_id"]
    mover = w.register("caro", eid, c1).json()["registration_id"]

    # Capitán de la cancha 1: no puede bajar a alguien de la 2, sí de la 1.
    assert w.cancel("capi", in_c2).status_code == 403
    r = w.cancel("capi", in_c1)
    assert r.status_code == 200, r.text
    assert _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]["source"] == "captain"

    # Mover de su cancha a otra: alcanza con ser capitán del origen.
    r = w.post("capi", f"/registrations/{mover}/move", {"to_court_id": c2})
    assert r.status_code == 200, r.text
    # Un jugador cualquiera no puede mover.
    assert w.post("dani", f"/registrations/{in_c2}/move", {"to_court_id": c1}).status_code == 403

    # Admin (registrations.manage vía rol admin) puede bajar a cualquiera.
    r = w.cancel("org", in_c2)
    assert r.status_code == 200, r.text
    assert _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]["source"] == "admin"

    # event_captains legacy sigue valiendo como OR.
    with engine.begin() as conn:
        conn.execute(text("insert into public.event_captains (event_id, user_id) values (:e, :u)"),
                     {"e": eid, "u": w.users["legacy"]})
    r = w.cancel("legacy", mover)
    assert r.status_code == 200, r.text
    assert _audit(w, eid, "CANCEL_REGISTRATION")[-1]["metadata"]["source"] == "legacy_captain"

    # /events/active le dice a la UI de qué canchas es capitán.
    viewer = w.client.get(f"/events/active?event_id={eid}", headers=w.h("capi")).json()["viewer"]
    assert viewer == {"captain_court_ids": [c1], "is_event_captain": False}


def db_test_full_court_stays_open_waitlist_and_promotion(w: World):
    assert settings.AUTO_CLOSE_ON_FULL is False
    eid, (c1,) = w.event(capacity=2, courts=1)
    ana = w.register("ana", eid, c1).json()["registration_id"]
    assert w.register("beto", eid, c1).json()["status"] == "CONFIRMED"

    court = w.q("select is_open from public.event_courts where id = :c", c=c1)[0]
    event = w.q("select status from public.events where id = :e", e=eid)[0]
    assert court["is_open"] is True and event["status"] == "OPEN"
    full = _audit(w, eid, "COURT_FULL")
    assert len(full) == 1 and full[0]["metadata"]["court_id"] == c1
    assert _audit(w, eid, "AUTO_CLOSE_COURT") == [] and _audit(w, eid, "AUTO_CLOSE_EVENT") == []

    r1 = w.register("caro", eid, c1).json()
    r2 = w.register("dani", eid, c1).json()
    assert (r1["status"], r1["waitlist_position"]) == ("WAITLIST", 1)
    assert (r2["status"], r2["waitlist_position"]) == ("WAITLIST", 2)

    # Ana se baja sola: entra Caro, la primera de la espera.
    r = w.cancel("ana", ana).json()
    assert r["promoted_registration_id"] == r1["registration_id"]
    promo = _audit(w, eid, "PROMOTE_WAITLIST")[-1]
    assert promo["target"] == r1["registration_id"] and promo["metadata"]["source"] == "auto_from_cancel"
    # La cancha volvió a quedar llena en la misma transacción: no hay un segundo COURT_FULL.
    assert len(_audit(w, eid, "COURT_FULL")) == 1


def db_test_flag_on_keeps_legacy_auto_close(w: World):
    settings.AUTO_CLOSE_ON_FULL = True
    try:
        eid, (c1,) = w.event(capacity=1, courts=1)
        assert w.register("ana", eid, c1).json()["status"] == "CONFIRMED"
        assert w.q("select is_open from public.event_courts where id = :c", c=c1)[0]["is_open"] is False
        assert w.q("select status from public.events where id = :e", e=eid)[0]["status"] == "CLOSED"
        assert len(_audit(w, eid, "AUTO_CLOSE_COURT")) == 1 and len(_audit(w, eid, "COURT_FULL")) == 1
    finally:
        settings.AUTO_CLOSE_ON_FULL = False


def db_test_rejoin_reuses_row_and_goes_last(w: World):
    eid, (c1,) = w.event(capacity=1, courts=1)
    w.register("ana", eid, c1)
    beto = w.register("beto", eid, c1).json()
    caro = w.register("caro", eid, c1).json()
    assert beto["status"] == caro["status"] == "WAITLIST"

    # Activo → 409 con copy amigable.
    r = w.register("beto", eid, c1)
    assert r.status_code == 409 and r.json()["detail"] == "Ya estás en la lista de espera de este partido."
    r = w.register("ana", eid, c1)
    assert r.status_code == 409 and r.json()["detail"] == "Ya estás anotado en este partido (Cancha 1)."

    # Beto sale de la espera y vuelve: misma fila, pero ahora detrás de Caro.
    assert w.cancel("beto", beto["registration_id"]).status_code == 200
    again = w.register("beto", eid, c1).json()
    assert again["registration_id"] == beto["registration_id"]
    assert (again["status"], again["waitlist_position"]) == ("WAITLIST", 2)
    rows = w.q("""
        select count(*)::int as n from public.event_registrations
        where event_id = :e and user_id = :u
    """, e=eid, u=w.users["beto"])
    assert rows[0]["n"] == 1
    meta = _audit(w, eid, "REGISTER_USER")[-1]["metadata"]
    assert meta["rejoin"] is True and meta["previous_created_at"]


def db_test_guest_limit_and_organizer_exempt(w: World):
    eid, (c1,) = w.event(capacity=20, courts=1)
    for i in range(5):
        r = w.post("eli", f"/events/{eid}/guests", {"guest_name": f"Inv {i}", "court_id": c1})
        assert r.status_code == 200, r.text
    r = w.post("eli", f"/events/{eid}/guests", {"guest_name": "Inv 6", "court_id": c1})
    assert r.status_code == 400 and r.json()["detail"] == "Llegaste al máximo de 5 invitados para este partido."
    for i in range(6):
        r = w.post("org", f"/events/{eid}/guests", {"guest_name": f"Org {i}", "court_id": c1})
        assert r.status_code == 200, r.text


def db_test_open_court_and_capacity_promote(w: World):
    eid, (c1,) = w.event(capacity=1, courts=1)
    w.register("ana", eid, c1)
    beto = w.register("beto", eid, c1).json()
    caro = w.register("caro", eid, c1).json()
    dani = w.register("dani", eid, c1).json()

    # Subir el cupo de 1 a 2 hace entrar a Beto.
    r = w.client.patch(f"/admin/events/{eid}/courts/{c1}", json={"capacity": 2}, headers=w.h("org"))
    assert r.status_code == 200, r.text
    assert r.json()["promoted_registration_ids"] == [beto["registration_id"]]

    # Cerrar, subir a 4 con la cancha cerrada (no promueve) y abrir: entran Caro y Dani.
    assert w.post("org", f"/admin/events/{eid}/courts/{c1}/close").status_code == 200
    r = w.client.patch(f"/admin/events/{eid}/courts/{c1}", json={"capacity": 4}, headers=w.h("org"))
    assert r.json()["promoted_registration_ids"] == []
    r = w.post("org", f"/admin/events/{eid}/courts/{c1}/open")
    assert r.status_code == 200, r.text
    assert r.json()["promoted_registration_ids"] == [caro["registration_id"], dani["registration_id"]]
    sources = [x["metadata"]["source"] for x in _audit(w, eid, "PROMOTE_WAITLIST")]
    assert sources == ["auto_from_court_update", "auto_from_open_court", "auto_from_open_court"]


def db_test_home_opens_next_match(w: World):
    # Uno ya jugado (sin finalizar) y dos futuros: abre el más cercano a futuro.
    past, _ = w.event(starts_in="-2 days")
    soon, _ = w.event(starts_in="1 day")
    later, _ = w.event(starts_in="5 days")
    ids = [e["id"] for e in w.client.get("/events/open", headers=w.h("ana")).json()["events"]]
    mine = [i for i in ids if i in (past, soon, later)]
    assert mine == [past, soon, later]
    # Sin event_id, /events/active elige el próximo de toda la base; en la base de
    # prueba no hay otros eventos futuros más cercanos que `soon`.
    active = w.client.get("/events/active", headers=w.h("ana")).json()["event"]["id"]
    assert active == soon


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
        passed += 1

    db_tests = [v for k, v in sorted(globals().items()) if k.startswith("db_test_") and callable(v)]
    if not DB_ENABLED:
        print(f"  (salteados {len(db_tests)} tests con DB: falta REGISTRATIONS_DB_TEST=1 y DATABASE_URL local)")
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
    print(f"\nOK: {passed} tests de la iteración 0a pasaron")


if __name__ == "__main__":
    _run_all()
