"""
Tests de la iteración 0c del rediseño UX (finalizar solo + canchas en orden).

- Sin DB: /config expone AUTO_FINALIZE_ENABLED y AUTO_FINALIZE_AFTER_MINUTES; con el flag
  apagado el hook no toca la base, y con el flag prendido es best-effort y respeta el throttle.
- Con DB: contra una base Postgres LOCAL con las migraciones 001-020 (la 020 deja auditar con
  actor NULL). Crea sus propios usuarios, eventos y canchas y los borra al terminar. Exige
  UX_0C_DB_TEST=1 y DATABASE_URL en localhost; si no, se saltea. finalize_due_events finaliza
  todos los eventos vencidos de la base, no solo los del test.

Correr:
  ./.venv/bin/python tests/test_finalize_0c.py
  UX_0C_DB_TEST=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python tests/test_finalize_0c.py
"""
import logging
import os
import sys
import uuid
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-finalize-0c")
for k in ("AUTO_FINALIZE_ENABLED", "AUTO_FINALIZE_AFTER_MINUTES", "AUTO_CLOSE_ON_FULL",
          "GUEST_LIMIT_PER_USER", "ACCOUNT_APPROVAL_ENABLED"):
    os.environ.pop(k, None)

from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app import settings  # noqa: E402
from app.settings import engine  # noqa: E402
from app.routers.events_public import _courts_availability  # noqa: E402
from app.utils import auto_finalize  # noqa: E402
from app.utils.auto_finalize import finalize_due_events  # noqa: E402
from app.utils.auth_token import issue_token  # noqa: E402

_url = os.environ.get("DATABASE_URL", "").replace("+psycopg", "")
DB_ENABLED = (
    os.environ.get("UX_0C_DB_TEST") == "1"
    and urlparse(_url).hostname in ("127.0.0.1", "localhost")
)

LOCK_SQL = "select pg_advisory_xact_lock(hashtext('finalize_due_events'))"


# ---------- Sin DB ----------

def test_config_exposes_0c_flags():
    with TestClient(main.app) as client:
        body = client.get("/config").json()
        assert body["autoFinalizeEnabled"] is False
        assert body["autoFinalizeAfterMinutes"] == 150


class _CountingEngine:
    """Reemplaza al engine: cuenta las transacciones y falla como una base caída."""

    def __init__(self):
        self.calls = 0

    def begin(self):
        self.calls += 1
        raise RuntimeError("base caída")


def test_hook_off_does_not_touch_db_and_on_is_best_effort():
    real_engine = auto_finalize.engine
    fake = _CountingEngine()
    auto_finalize.engine = fake
    log = logging.getLogger("uvicorn.error")
    try:
        assert settings.AUTO_FINALIZE_ENABLED is False
        auto_finalize._last_run = 0.0
        auto_finalize.auto_finalize_if_due()
        assert fake.calls == 0

        settings.AUTO_FINALIZE_ENABLED = True
        log.disabled = True
        auto_finalize.auto_finalize_if_due()  # el error no sale del hook
        auto_finalize.auto_finalize_if_due()  # dentro del minuto: no vuelve a correr
        assert fake.calls == 1
    finally:
        settings.AUTO_FINALIZE_ENABLED = False
        auto_finalize._last_run = 0.0
        auto_finalize.engine = real_engine
        log.disabled = False


# ---------- Fixture con DB ----------

class World:
    """Usuarios y eventos propios; cada evento se crea "hace" created_ago."""

    def __init__(self):
        self.tag = uuid.uuid4().hex[:8]
        self.users: dict[str, str] = {}
        self.event_ids: list[str] = []
        self.client = TestClient(main.app)

    def user(self, key: str, admin: bool = False, opt_in: bool = False) -> str:
        with engine.begin() as conn:
            uid = conn.execute(text("""
                insert into public.users (full_name, phone_e164, phone_login, ranking_opt_in)
                values (:name, :phone, :phone, :opt_in) returning id::text
            """), {"name": f"{key.capitalize()} Test", "phone": f"+5491{self.tag}{len(self.users):03d}",
                   "opt_in": opt_in}).scalar()
            if admin:
                conn.execute(text("""
                    insert into public.user_roles (user_id, role_id)
                    select :uid, id from public.roles where code = 'admin'
                """), {"uid": uid})
        self.users[key] = uid
        return uid

    def event(self, starts_in: str, status: str = "OPEN", created_ago: str = "3 days",
              courts: int = 1, capacity: int = 2):
        with engine.begin() as conn:
            eid = conn.execute(text("""
                insert into public.events (title, starts_at, location_name, status, created_by_user_id, created_at)
                values (:title, now() + CAST(:starts_in AS interval), 'Club Test', :status, :org,
                        now() - CAST(:created_ago AS interval))
                returning id::text
            """), {"title": f"Partido {self.tag}", "starts_in": starts_in, "status": status,
                   "org": self.users["org"], "created_ago": created_ago}).scalar()
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

    def q(self, sql: str, **params):
        with engine.connect() as conn:
            return conn.execute(text(sql), params).mappings().all()

    def status(self, eid: str):
        return self.q("select status, finalized_at from public.events where id = :e", e=eid)[0]

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
    w.user("ana", opt_in=True)
    w.user("beto", opt_in=True)
    w.user("caro")
    return w


def _audit(w: World, eid: str, action: str):
    return w.q("""
        select actor_user_id::text as actor, target_registration_id::text as target, metadata
        from public.event_audit_log where event_id = :e and action = :a order by created_at, id
    """, e=eid, a=action)


def _finalize(minutes: int = 150) -> list[str]:
    with engine.begin() as conn:
        return finalize_due_events(conn, minutes)


# ---------- Con DB: auto-finalizar ----------

def db_test_finalize_respects_window(w: World):
    due_open, _ = w.event(starts_in="-3 hours")
    due_closed, _ = w.event(starts_in="-4 hours", status="CLOSED")
    recent, _ = w.event(starts_in="-2 hours")
    future, _ = w.event(starts_in="2 days")
    cancelled, _ = w.event(starts_in="-1 day", status="CANCELLED")
    already, _ = w.event(starts_in="-1 day", status="FINALIZED")
    retro, _ = w.event(starts_in="-2 days", created_ago="1 minute")  # cargado hoy con fecha pasada

    done = set(_finalize())
    assert {due_open, due_closed} <= done
    assert not done & {recent, future, cancelled, already, retro}

    for eid, previous in ((due_open, "OPEN"), (due_closed, "CLOSED")):
        row = w.status(eid)
        assert row["status"] == "FINALIZED" and row["finalized_at"] is not None
        logs = _audit(w, eid, "FINALIZE_EVENT")
        assert len(logs) == 1 and logs[0]["actor"] is None
        assert logs[0]["metadata"] == {"source": "auto", "previous_status": previous, "after_minutes": 150}

    for eid in (recent, future, retro):
        assert w.status(eid) == {"status": "OPEN", "finalized_at": None}
    assert w.status(cancelled)["status"] == "CANCELLED"
    assert w.status(already) == {"status": "FINALIZED", "finalized_at": None}
    for eid in (recent, future, retro, cancelled, already):
        assert _audit(w, eid, "FINALIZE_EVENT") == []


def db_test_finalize_only_once(w: World):
    eid, _ = w.event(starts_in="-3 hours")
    assert eid in _finalize()
    first = w.status(eid)["finalized_at"]
    assert eid not in _finalize()
    assert w.status(eid)["finalized_at"] == first
    assert len(_audit(w, eid, "FINALIZE_EVENT")) == 1
    # El finalize manual ya no aplica.
    assert w.post("org", f"/admin/events/{eid}/finalize").status_code == 400


def db_test_finalize_respects_lock_and_row_locks(w: World):
    eid, _ = w.event(starts_in="-3 hours")
    busy, _ = w.event(starts_in="-3 hours")

    # Otra corrida tiene el lock: no hace nada.
    holder = engine.connect()
    tx = holder.begin()
    try:
        holder.execute(text(LOCK_SQL))
        assert _finalize() == []
        assert w.status(eid)["status"] == "OPEN"
    finally:
        tx.rollback()
        holder.close()

    # Un admin tiene la fila de `busy` bloqueada: se saltea sin esperar y entra en la próxima.
    holder = engine.connect()
    tx = holder.begin()
    try:
        holder.execute(text("select 1 from public.events where id = :e for update"), {"e": busy})
        done = _finalize()
        assert eid in done and busy not in done
    finally:
        tx.rollback()
        holder.close()
    assert busy in _finalize()


def db_test_reactivate_restarts_clock(w: World):
    eid, _ = w.event(starts_in="-3 hours")
    assert eid in _finalize()

    r = w.post("org", f"/admin/events/{eid}/open")
    assert r.status_code == 200, r.text
    assert eid not in _finalize()
    assert w.status(eid) == {"status": "OPEN", "finalized_at": None}

    # 150 min después de reabrir se vuelve a finalizar solo.
    with engine.begin() as conn:
        conn.execute(text("""
            update public.event_audit_log set created_at = created_at - interval '3 hours'
            where event_id = :e and action = 'REOPEN_EVENT'
        """), {"e": eid})
    assert eid in _finalize()
    assert [x["metadata"]["previous_status"] for x in _audit(w, eid, "FINALIZE_EVENT")] == ["OPEN", "OPEN"]


def db_test_lazy_hook_on_get_endpoints(w: World):
    paths = ["/events/open", "/events/active", "/ratings/pending", "/notifications"]

    # Flag apagado (default): los GET no finalizan nada.
    off, _ = w.event(starts_in="-3 hours")
    for path in paths:
        auto_finalize._last_run = 0.0
        assert w.client.get(path, headers=w.h("ana")).status_code == 200
    assert w.status(off)["status"] == "OPEN"

    settings.AUTO_FINALIZE_ENABLED = True
    try:
        for path in paths:
            eid, (court,) = w.event(starts_in="-3 hours")
            with engine.begin() as conn:
                for key in ("ana", "beto"):
                    conn.execute(text("""
                        insert into public.event_registrations (event_id, registration_type, status, court_id,
                                                                created_by_user_id, user_id)
                        values (:e, 'USER', 'CONFIRMED', :c, :u, :u)
                    """), {"e": eid, "c": court, "u": w.users[key]})
            auto_finalize._last_run = 0.0
            r = w.client.get(path, headers=w.h("ana"))
            assert r.status_code == 200, (path, r.text)
            assert w.status(eid)["status"] == "FINALIZED", path
            if path == "/events/open":
                assert eid not in [e["id"] for e in r.json()["events"]]
            if path == "/ratings/pending":
                # Finalizar abre los votos en el mismo request.
                assert eid in [i["event_id"] for i in r.json()["items"]]

        # Throttle: dentro del minuto no vuelve a correr.
        later, _ = w.event(starts_in="-3 hours")
        assert w.client.get("/events/open", headers=w.h("ana")).status_code == 200
        assert w.status(later)["status"] == "OPEN"
    finally:
        settings.AUTO_FINALIZE_ENABLED = False
        auto_finalize._last_run = 0.0


# ---------- Con DB: canchas ----------

def db_test_courts_stable_order(w: World):
    eid, _ = w.event(starts_in="2 days", courts=0)
    with engine.begin() as conn:
        ids = [
            conn.execute(text("""
                insert into public.event_courts (event_id, name, capacity, sort_order, created_at)
                values (:e, :name, 10, 1, now() - CAST(:ago AS interval)) returning id::text
            """), {"e": eid, "name": name, "ago": ago}).scalar()
            for name, ago in (("Cancha 13", "0 minutes"), ("Cancha 5", "10 minutes"), ("Cancha 11", "10 minutes"))
        ]
    # Mismo sort_order: primero por orden de creación (no por nombre) y, si empatan, por id.
    expected = sorted(ids[1:]) + [ids[0]]

    active = w.client.get(f"/events/active?event_id={eid}", headers=w.h("ana")).json()
    assert [c["court_id"] for c in active["courts"]] == expected
    detail = w.client.get(f"/admin/events/{eid}/detail", headers=w.h("org")).json()
    assert [c["court_id"] for c in detail["courts"]] == expected
    with engine.connect() as conn:
        assert [c["court_id"] for c in _courts_availability(conn, eid)] == expected


def db_test_create_court_promotes_waitlist(w: World):
    eid, (c1,) = w.event(starts_in="2 days", capacity=1)
    assert w.register("ana", eid, c1).json()["status"] == "CONFIRMED"
    beto = w.register("beto", eid, c1).json()
    caro = w.register("caro", eid, c1).json()
    assert beto["status"] == caro["status"] == "WAITLIST"

    r = w.post("org", f"/admin/events/{eid}/courts", {"name": "Cancha 2", "capacity": 1, "sort_order": 2})
    assert r.status_code == 200, r.text
    c2 = r.json()["court_id"]
    assert r.json()["promoted_registration_ids"] == [beto["registration_id"]]
    row = w.q("select status, court_id::text as court_id from public.event_registrations where id = :r",
              r=beto["registration_id"])[0]
    assert row == {"status": "CONFIRMED", "court_id": c2}
    promo = _audit(w, eid, "PROMOTE_WAITLIST")
    assert [(p["target"], p["metadata"]["source"]) for p in promo] == [(beto["registration_id"], "auto_from_create_court")]

    # Cerrada no promueve: Caro sigue esperando.
    r = w.post("org", f"/admin/events/{eid}/courts",
               {"name": "Cancha 3", "capacity": 2, "sort_order": 3, "is_open": False})
    assert r.status_code == 200, r.text
    assert r.json()["promoted_registration_ids"] == []
    assert w.q("select status from public.event_registrations where id = :r",
               r=caro["registration_id"])[0]["status"] == "WAITLIST"


def db_test_create_court_name_with_quotes(w: World):
    eid, _ = w.event(starts_in="2 days", courts=0)
    name = 'Cancha "Los Pibes" \'B\' \\'
    r = w.post("org", f"/admin/events/{eid}/courts", {"name": name, "capacity": 10})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == name
    meta = _audit(w, eid, "CREATE_COURT")[-1]["metadata"]
    assert meta == {"court_id": r.json()["court_id"], "court_name": name, "capacity": 10}


def _assert_audit_actor_nullable():
    with engine.connect() as conn:
        nullable = conn.execute(text("""
            select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'event_audit_log' and column_name = 'actor_user_id'
        """)).scalar()
    if nullable != "YES":
        raise SystemExit("La base local no tiene la 020 (actor_user_id NOT NULL): "
                         "correr migrations/020_audit_actor_nullable.sql")


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
        passed += 1

    db_tests = [v for k, v in sorted(globals().items()) if k.startswith("db_test_") and callable(v)]
    if not DB_ENABLED:
        print(f"  (salteados {len(db_tests)} tests con DB: falta UX_0C_DB_TEST=1 y DATABASE_URL local)")
    else:
        _assert_audit_actor_nullable()
        w = _world()
        try:
            with w.client:
                for t in db_tests:
                    t(w)
                    print(f"  ✓ {t.__name__}")
                    passed += 1
        finally:
            w.cleanup()
    print(f"\nOK: {passed} tests de la iteración 0c pasaron")


if __name__ == "__main__":
    _run_all()
