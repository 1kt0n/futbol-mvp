"""
Tests de la iteración 0d del rediseño UX (Repetir rápido: POST /admin/events/{id}/duplicate).

- Sin DB: el body se valida (422) y un token inválido da 401, antes de tocar la base.
- Con DB: contra una base Postgres LOCAL con las migraciones 001-020. Crea sus propios
  usuarios, rol, eventos y canchas (todo lleva un tag en el título o el código) y los borra
  al terminar. Exige UX_0D_DB_TEST=1 y DATABASE_URL en localhost; si no, se saltea.

Correr:
  ./.venv/bin/python tests/test_quick_repeat_0d.py
  UX_0D_DB_TEST=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python tests/test_quick_repeat_0d.py
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-quick-repeat-0d")
for k in ("AUTO_FINALIZE_ENABLED", "AUTO_CLOSE_ON_FULL", "ACCOUNT_APPROVAL_ENABLED",
          "EVENT_ACCESS_ENABLED", "EVENT_PASSWORDS_ENABLED", "EXTERNAL_REGISTRATION_ENABLED"):
    os.environ.pop(k, None)

from sqlalchemy import text  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402
from app.routers import events_public  # noqa: E402
from app.settings import engine  # noqa: E402
from app.utils.auth_token import issue_token  # noqa: E402
from app.utils.security import gen_salt, gen_share_code, hash_event_password  # noqa: E402

_url = os.environ.get("DATABASE_URL", "").replace("+psycopg", "")
DB_ENABLED = (
    os.environ.get("UX_0D_DB_TEST") == "1"
    and urlparse(_url).hostname in ("127.0.0.1", "localhost")
)

PASSWORD = "clave del martes"


# ---------- Sin DB ----------

def test_invalid_body_is_422():
    headers = {"X-Actor-User-Id": issue_token(str(uuid.uuid4()))}
    path = f"/admin/events/{uuid.uuid4()}/duplicate"
    with TestClient(main.app) as client:
        for body in (
            {"courts": []},
            {"courts": [{"name": "Cancha 1", "capacity": 0}]},
            {"courts": [{"name": "Cancha 1", "capacity": 51}]},
            {"courts": [{"name": "C", "capacity": 10}]},
            {"courts": [{"name": f"Cancha {i}", "capacity": 10} for i in range(13)]},
            {"title": "ab"},
            {"location_name": "x"},
        ):
            r = client.post(path, json=body, headers=headers)
            assert r.status_code == 422, (body, r.status_code, r.text)


def test_invalid_token_is_401():
    with TestClient(main.app) as client:
        r = client.post(f"/admin/events/{uuid.uuid4()}/duplicate", json={},
                        headers={"X-Actor-User-Id": "no-es-un-token"})
        assert r.status_code == 401, r.text


# ---------- Fixture con DB ----------

class World:
    """Usuarios, un rol con solo events.create y eventos propios, todos con el tag."""

    def __init__(self):
        self.tag = uuid.uuid4().hex[:8]
        self.users: dict[str, str] = {}
        self.role_code = f"solo_crear_{self.tag}"
        self.client = TestClient(main.app)

    def user(self, key: str, role: str | None = None) -> str:
        with engine.begin() as conn:
            uid = conn.execute(text("""
                insert into public.users (full_name, phone_e164, phone_login)
                values (:name, :phone, :phone) returning id::text
            """), {"name": f"{key.capitalize()} Test", "phone": f"+5491{self.tag}{len(self.users):03d}"}).scalar()
            if role:
                conn.execute(text("""
                    insert into public.user_roles (user_id, role_id)
                    select :uid, id from public.roles where code = :role
                """), {"uid": uid, "role": role})
        self.users[key] = uid
        return uid

    def create_only_role(self):
        with engine.begin() as conn:
            conn.execute(text("""
                insert into public.roles (code, name) values (:code, 'Solo crear eventos (test 0d)')
            """), {"code": self.role_code})
            conn.execute(text("""
                insert into public.role_permissions (role_id, permission_id)
                select r.id, p.id from public.roles r, public.permissions p
                where r.code = :code and p.code in ('events.view', 'events.create')
            """), {"code": self.role_code})

    def source(self, *, access: str = "MEMBERS_ONLY", visibility: str = "PRIVATE",
               courts=(("Cancha 1", 10, 1, "0 minutes", True),), starts_in: str = "-2 days",
               title: str | None = None) -> str:
        """Evento "de la semana pasada". courts: (nombre, cupo, sort_order, creada hace, abierta)."""
        salt = gen_salt() if access == "LINK_PASSWORD" else None
        with engine.begin() as conn:
            eid = conn.execute(text("""
                insert into public.events (
                    title, description, starts_at, location_name, close_at, status, visibility,
                    created_by_user_id, access_mode, allow_external_registration, share_code,
                    password_hash, password_salt, password_version, public_roster_visibility
                )
                values (
                    :title, 'Traer pechera clara y oscura', now() + CAST(:starts_in AS interval),
                    'Club Norte', now() + CAST(:starts_in AS interval) - interval '1 hour',
                    'FINALIZED', :visibility, :org, :access, :ext, :code, :hash, :salt, 3, :roster
                )
                returning id::text
            """), {
                "title": title or f"Martes 20 hs {self.tag}",
                "starts_in": starts_in,
                "visibility": visibility,
                "org": self.users["org"],
                "access": access,
                "ext": access != "MEMBERS_ONLY",
                "code": gen_share_code() if access != "MEMBERS_ONLY" else None,
                "hash": hash_event_password(PASSWORD, salt) if salt else None,
                "salt": salt,
                "roster": "FIRST_NAME" if access != "MEMBERS_ONLY" else "NONE",
            }).scalar()
            for name, capacity, sort_order, created_ago, is_open in courts:
                conn.execute(text("""
                    insert into public.event_courts (event_id, name, capacity, sort_order, is_open, created_at)
                    values (:e, :name, :cap, :so, :open, now() - CAST(:ago AS interval))
                """), {"e": eid, "name": name, "cap": capacity, "so": sort_order, "open": is_open,
                       "ago": created_ago})
        return eid

    def h(self, key: str) -> dict:
        return {"X-Actor-User-Id": issue_token(self.users[key])}

    def duplicate(self, key: str, eid: str, body: dict | None = None):
        return self.client.post(f"/admin/events/{eid}/duplicate", json=body or {}, headers=self.h(key))

    def q(self, sql: str, **params):
        with engine.connect() as conn:
            return conn.execute(text(sql), params).mappings().all()

    def event_row(self, eid: str):
        return self.q("""
            select title, description, starts_at, location_name, close_at, status, visibility,
                   created_by_user_id::text as created_by, access_mode, allow_external_registration,
                   share_code, password_hash, password_salt, password_version, public_roster_visibility
            from public.events where id = :e
        """, e=eid)[0]

    def courts(self, eid: str):
        return [dict(r) for r in self.q("""
            select name, capacity, is_open, sort_order from public.event_courts
            where event_id = :e order by sort_order, created_at, id
        """, e=eid)]

    def tagged_events(self) -> list[str]:
        return [r["id"] for r in self.q("select id::text as id from public.events where title like :t",
                                        t=f"%{self.tag}%")]

    def cleanup(self):
        with engine.begin() as conn:
            for eid in self.tagged_events():
                conn.execute(text("delete from public.event_audit_log where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.event_courts where event_id = :e"), {"e": eid})
                conn.execute(text("delete from public.events where id = :e"), {"e": eid})
            conn.execute(text("delete from public.notifications where message like :t"), {"t": f"%{self.tag}%"})
            uids = list(self.users.values())
            conn.execute(text("delete from public.user_roles where user_id = ANY(CAST(:u AS uuid[]))"), {"u": uids})
            conn.execute(text("delete from public.users where id = ANY(CAST(:u AS uuid[]))"), {"u": uids})
            conn.execute(text("delete from public.roles where code = :c"), {"c": self.role_code})


def _world() -> World:
    w = World()
    w.create_only_role()
    w.user("org", role="admin")
    w.user("ana")
    w.user("creadora", role=w.role_code)
    return w


def _audit(w: World, eid: str, action: str):
    return w.q("""
        select actor_user_id::text as actor, metadata
        from public.event_audit_log where event_id = :e and action = :a order by created_at, id
    """, e=eid, a=action)


# ---------- Con DB ----------

def db_test_copies_fields_and_access(w: World):
    src = w.source(access="LINK_PASSWORD", visibility="GLOBAL")
    r = w.duplicate("org", src)
    assert r.status_code == 200, r.text
    body = r.json()
    new = body["event_id"]
    assert body["duplicated_from"] == src

    a, b = w.event_row(src), w.event_row(new)
    for col in ("title", "description", "location_name", "visibility", "access_mode",
                "allow_external_registration", "password_hash", "password_salt",
                "public_roster_visibility"):
        assert b[col] == a[col], col
    assert b["status"] == "OPEN" and b["close_at"] is None
    assert b["created_by"] == w.users["org"]
    assert b["password_version"] == 0  # evento nuevo: nadie tiene grants

    # Link nuevo, nunca el de la semana pasada.
    assert b["share_code"] and b["share_code"] != a["share_code"]
    assert body["access"]["share_path"] == f"/e/{b['share_code']}"
    assert body["access"]["password_set"] is True
    assert "password_hash" not in body["access"] and "password_salt" not in body["access"]

    # GLOBAL avisa en la campana igual que crear un evento.
    assert len(w.q("select 1 from public.notifications where message = :t", t=a["title"])) == 1


def db_test_same_password_unlocks_new_link(w: World):
    src = w.source(access="LINK_PASSWORD")
    new = w.duplicate("org", src).json()["event_id"]
    code = w.event_row(new)["share_code"]

    events_public.EVENT_ACCESS_ENABLED = True
    try:
        ok = w.client.post(f"/public/events/{code}/unlock", json={"password": PASSWORD})
        assert ok.status_code == 200, ok.text
        assert ok.json()["access_token"]
        bad = w.client.post(f"/public/events/{code}/unlock", json={"password": "otra clave cualquiera"})
        assert bad.status_code == 401
    finally:
        events_public.EVENT_ACCESS_ENABLED = False


def db_test_members_only_has_no_link(w: World):
    src = w.source(access="MEMBERS_ONLY")
    r = w.duplicate("org", src)
    assert r.status_code == 200, r.text
    row = w.event_row(r.json()["event_id"])
    assert row["access_mode"] == "MEMBERS_ONLY"
    assert row["share_code"] is None and row["password_hash"] is None
    assert r.json()["access"]["share_path"] is None


def db_test_default_starts_at_and_copied_courts_in_order(w: World):
    # Mismo sort_order: van por orden de creación y después por id. La cerrada se copia abierta.
    src = w.source(courts=(
        ("Cancha 13", 10, 1, "0 minutes", True),
        ("Cancha 5", 12, 1, "20 minutes", False),
        ("Suplentes", 4, 2, "30 minutes", True),
    ))
    r = w.duplicate("org", src)
    assert r.status_code == 200, r.text
    new = r.json()["event_id"]

    assert w.event_row(new)["starts_at"] == w.event_row(src)["starts_at"] + timedelta(days=7)
    expected = [
        {"name": "Cancha 5", "capacity": 12, "is_open": True, "sort_order": 1},
        {"name": "Cancha 13", "capacity": 10, "is_open": True, "sort_order": 2},
        {"name": "Suplentes", "capacity": 4, "is_open": True, "sort_order": 3},
    ]
    assert w.courts(new) == expected
    assert [{k: c[k] for k in ("name", "capacity", "is_open", "sort_order")} for c in r.json()["courts"]] == expected
    # El original no se toca.
    assert len(w.courts(src)) == 3 and w.event_row(src)["status"] == "FINALIZED"


def db_test_explicit_courts_date_and_overrides(w: World):
    src = w.source(courts=(("Cancha 1", 10, 1, "0 minutes", True), ("Cancha 2", 10, 2, "0 minutes", True)))
    body = {
        "starts_at": "2026-10-29T19:00",  # sin zona: hora argentina
        "title": f"Jueves 19 hs {w.tag}",
        "location_name": "Poli Cramer",
        "courts": [{"name": "Cancha 5", "capacity": 14}, {"name": "Cancha 11", "capacity": 10},
                   {"name": "Cancha 13", "capacity": 10}],
    }
    r = w.duplicate("org", src, body)
    assert r.status_code == 200, r.text
    row = w.event_row(r.json()["event_id"])
    assert row["starts_at"] == datetime(2026, 10, 29, 22, 0, tzinfo=timezone.utc)
    assert row["title"] == body["title"] and row["location_name"] == "Poli Cramer"
    assert row["description"] == "Traer pechera clara y oscura"
    assert w.courts(r.json()["event_id"]) == [
        {"name": "Cancha 5", "capacity": 14, "is_open": True, "sort_order": 1},
        {"name": "Cancha 11", "capacity": 10, "is_open": True, "sort_order": 2},
        {"name": "Cancha 13", "capacity": 10, "is_open": True, "sort_order": 3},
    ]

    bad = w.duplicate("org", src, {"starts_at": "jueves que viene"})
    assert bad.status_code == 400, bad.text


def db_test_audit_quick_repeat(w: World):
    src = w.source(access="LINK_ACCESS")
    r = w.duplicate("org", src, {"courts": [{"name": "Cancha 1", "capacity": 10},
                                            {"name": "Cancha 2", "capacity": 12}]})
    assert r.status_code == 200, r.text
    new, courts = r.json()["event_id"], r.json()["courts"]

    created = _audit(w, new, "CREATE_EVENT")
    assert len(created) == 1 and created[0]["actor"] == w.users["org"]
    assert created[0]["metadata"] == {"visibility": "PRIVATE", "source": "quick_repeat", "duplicated_from": src,
                                      "access_mode": "LINK_ACCESS", "courts": 2}
    court_logs = _audit(w, new, "CREATE_COURT")
    assert [c["actor"] for c in court_logs] == [w.users["org"]] * 2
    # Misma transacción = mismo created_at: el orden entre filas no está definido.
    assert sorted((c["metadata"] for c in court_logs), key=lambda m: m["court_name"]) == [
        {"court_id": courts[0]["court_id"], "court_name": "Cancha 1", "capacity": 10,
         "source": "quick_repeat", "duplicated_from": src},
        {"court_id": courts[1]["court_id"], "court_name": "Cancha 2", "capacity": 12,
         "source": "quick_repeat", "duplicated_from": src},
    ]
    # Nada se audita en el original.
    assert _audit(w, src, "CREATE_EVENT") == [] and _audit(w, src, "CREATE_COURT") == []


def db_test_permissions(w: World):
    src = w.source()
    before = len(w.tagged_events())

    # Un jugador no puede.
    r = w.duplicate("ana", src)
    assert r.status_code == 403, r.text
    # Con events.create pero sin courts.manage tampoco: Repetir crea canchas.
    r = w.duplicate("creadora", src)
    assert r.status_code == 403 and "courts.manage" in r.json()["detail"], r.text
    assert len(w.tagged_events()) == before

    # Original inexistente.
    r = w.duplicate("org", str(uuid.uuid4()))
    assert r.status_code == 404, r.text


def db_test_court_name_with_quotes(w: World):
    src = w.source()
    name = 'Cancha "Los Pibes" \'B\' \\'
    r = w.duplicate("org", src, {"courts": [{"name": name, "capacity": 10}]})
    assert r.status_code == 200, r.text
    new = r.json()["event_id"]
    assert w.courts(new)[0]["name"] == name
    meta = _audit(w, new, "CREATE_COURT")[0]["metadata"]
    assert meta == {"court_id": r.json()["courts"][0]["court_id"], "court_name": name, "capacity": 10,
                    "source": "quick_repeat", "duplicated_from": src}

    # Título con comillas: el CREATE_EVENT también se arma con json.dumps.
    title = f'Martes "20 hs" \'{w.tag}\''
    r = w.duplicate("org", src, {"title": title})
    assert r.status_code == 200, r.text
    assert w.event_row(r.json()["event_id"])["title"] == title


def db_test_all_or_nothing(w: World):
    src = w.source()
    before = len(w.tagged_events())
    # Postgres rechaza el byte NUL en la 2.ª cancha, después de insertar el evento y la 1.ª.
    body = {"title": f"Atomico {w.tag}",
            "courts": [{"name": "Cancha 1", "capacity": 10}, {"name": "Cancha \x00 2", "capacity": 10}]}
    try:
        status = w.duplicate("org", src, body).status_code
    except Exception:
        status = 500  # TestClient re-lanza la excepción del servidor
    assert status >= 500, status
    assert len(w.tagged_events()) == before
    assert w.q("select 1 from public.events where title = :t", t=body["title"]) == []


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
        print(f"  (salteados {len(db_tests)} tests con DB: falta UX_0D_DB_TEST=1 y DATABASE_URL local)")
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
    print(f"\nOK: {passed} tests de la iteración 0d pasaron")


if __name__ == "__main__":
    _run_all()
