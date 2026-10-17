"""
Tests de la migración 020: audit con actor NULL en las acciones sin usuario logueado.

En producción event_audit_log.actor_user_id era NOT NULL. Con eso, el alta y la baja de
externos daban 500 y EVENT_UNLOCK se perdía. Estos tests recorren esos caminos por HTTP
(TestClient) contra una base Postgres LOCAL con las migraciones 001-020. Crean su propio
evento y lo borran al terminar. Exigen AUDIT_DB_TEST=1 y DATABASE_URL en localhost; si no,
se saltean. Para reproducir prod antes de la 020:
  ALTER TABLE public.event_audit_log ALTER COLUMN actor_user_id SET NOT NULL
Con eso fallan con NotNullViolation (23502).

Correr:
  AUDIT_DB_TEST=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python tests/test_audit_actor_nullable.py
"""
import os
import sys
import uuid
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-audit-actor")
# events_public lee estos flags al importarse.
os.environ["EVENT_ACCESS_ENABLED"] = "true"
os.environ["EXTERNAL_REGISTRATION_ENABLED"] = "true"
os.environ.pop("AUTO_CLOSE_ON_FULL", None)

from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app import settings  # noqa: E402
from app.settings import engine  # noqa: E402
from app.utils.security import gen_salt, hash_event_password  # noqa: E402

_url = os.environ.get("DATABASE_URL", "").replace("+psycopg", "")
DB_ENABLED = (
    os.environ.get("AUDIT_DB_TEST") == "1"
    and urlparse(_url).hostname in ("127.0.0.1", "localhost")
)

PASSWORD = "clave-de-prueba-larga"


class World:
    """Un organizador y eventos públicos con inscripción externa."""

    def __init__(self):
        self.tag = uuid.uuid4().hex[:8]
        self.event_ids: list[str] = []
        self.client = TestClient(main.app)
        with engine.begin() as conn:
            self.org = conn.execute(text("""
                insert into public.users (full_name, phone_e164, phone_login)
                values ('Org Test', :phone, :phone) returning id::text
            """), {"phone": f"+5490{self.tag}"}).scalar()

    def event(self, capacity: int = 1, access_mode: str = "LINK_ACCESS"):
        code = f"aud{self.tag}{len(self.event_ids)}"
        salt = gen_salt() if access_mode == "LINK_PASSWORD" else None
        with engine.begin() as conn:
            eid = conn.execute(text("""
                insert into public.events (
                    title, starts_at, location_name, status, created_by_user_id,
                    access_mode, share_code, allow_external_registration, password_salt, password_hash
                )
                values (:title, now() + interval '2 days', 'Club Test', 'OPEN', :org,
                        :mode, :code, true, :salt, :hash)
                returning id::text
            """), {"title": f"Partido {self.tag}", "org": self.org, "mode": access_mode, "code": code,
                   "salt": salt, "hash": hash_event_password(PASSWORD, salt) if salt else None}).scalar()
            court = conn.execute(text("""
                insert into public.event_courts (event_id, name, capacity, sort_order)
                values (:eid, 'Cancha 1', :cap, 1) returning id::text
            """), {"eid": eid, "cap": capacity}).scalar()
        self.event_ids.append(eid)
        return eid, code, court

    def external(self, code: str, court_id: str, name: str):
        return self.client.post(f"/public/events/{code}/participants", json={
            "display_name": name,
            "contact": f"+54911{uuid.uuid4().int % 10**8:08d}",
            "court_id": court_id,
            "privacy_accepted": True,
        })

    def audit(self, eid: str, action: str):
        with engine.connect() as conn:
            return conn.execute(text("""
                select actor_user_id::text as actor, target_registration_id::text as target, metadata
                from public.event_audit_log where event_id = :e and action = :a order by created_at
            """), {"e": eid, "a": action}).mappings().all()

    def cleanup(self):
        with engine.begin() as conn:
            for eid in self.event_ids:
                conn.execute(text("delete from public.event_audit_log where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_registrations where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_courts where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.events where id = :e"), {"e": eid})
            conn.execute(text("delete from public.users where id = :u"), {"u": self.org})


# ---------- Con DB ----------

def db_test_0_actor_column_is_nullable(w: World):
    with engine.connect() as conn:
        nullable = conn.execute(text("""
            select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'event_audit_log' and column_name = 'actor_user_id'
        """)).scalar()
    assert nullable == "YES", "event_audit_log.actor_user_id sigue NOT NULL: falta correr migrations/020"


def db_test_unlock_is_audited_without_actor(w: World):
    eid, code, _ = w.event(access_mode="LINK_PASSWORD")
    r = w.client.post(f"/public/events/{code}/unlock", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    logs = w.audit(eid, "EVENT_UNLOCK")
    assert len(logs) == 1 and logs[0]["actor"] is None and logs[0]["metadata"] == {"result": "success"}


def db_test_external_register_waitlist_cancel_promote(w: World):
    eid, code, court = w.event(capacity=1)

    first = w.external(code, court, "Externo Uno")
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "CONFIRMED"
    reg = w.audit(eid, "REGISTER_EXTERNAL")
    assert len(reg) == 1 and reg[0]["actor"] is None and reg[0]["target"] == first.json()["participation_id"]
    full = w.audit(eid, "COURT_FULL")
    assert len(full) == 1 and full[0]["actor"] is None and full[0]["metadata"]["source"] == "external"

    second = w.external(code, court, "Externo Dos")
    assert second.status_code == 201, second.text
    assert second.json()["status"] == "WAITLIST" and second.json()["waitlist_position"] == 1

    token = first.json()["management_path"].rsplit("/", 1)[1]
    r = w.client.post(f"/public/participations/{token}/cancel")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "CANCELLED", "promoted": True}
    cancel = w.audit(eid, "CANCEL_EXTERNAL")
    assert len(cancel) == 1 and cancel[0]["actor"] is None and cancel[0]["target"] == first.json()["participation_id"]
    promo = w.audit(eid, "PROMOTE_WAITLIST")
    assert len(promo) == 1 and promo[0]["actor"] is None
    assert promo[0]["target"] == second.json()["participation_id"]
    assert promo[0]["metadata"]["source"] == "auto_from_external_cancel"

    with engine.connect() as conn:
        status = conn.execute(text("select status from public.event_registrations where id = :id"),
                              {"id": second.json()["participation_id"]}).scalar()
    assert status == "CONFIRMED"


def db_test_auto_close_from_external_without_actor(w: World):
    eid, code, court = w.event(capacity=1)
    settings.AUTO_CLOSE_ON_FULL = True
    try:
        r = w.external(code, court, "Externo Tres")
    finally:
        settings.AUTO_CLOSE_ON_FULL = False
    assert r.status_code == 201, r.text
    for action in ("AUTO_CLOSE_COURT", "AUTO_CLOSE_EVENT"):
        logs = w.audit(eid, action)
        assert len(logs) == 1 and logs[0]["actor"] is None, action
    with engine.connect() as conn:
        assert conn.execute(text("select status from public.events where id = :e"), {"e": eid}).scalar() == "CLOSED"


def _run_all():
    db_tests = [v for k, v in sorted(globals().items()) if k.startswith("db_test_") and callable(v)]
    if not DB_ENABLED:
        print(f"  (salteados {len(db_tests)} tests con DB: falta AUDIT_DB_TEST=1 y DATABASE_URL local)")
        return
    w = World()
    try:
        with w.client:
            for t in db_tests:
                t(w)
                print(f"  ✓ {t.__name__}")
    finally:
        w.cleanup()
    print(f"\nOK: {len(db_tests)} tests de audit con actor NULL pasaron")


if __name__ == "__main__":
    _run_all()
