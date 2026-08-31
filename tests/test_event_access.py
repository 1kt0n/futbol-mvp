"""
Tests de Event Access v1 que NO requieren base de datos real.

Cubre la lógica de seguridad (grant firmado + hash de clave + política) y el
gating por feature flag vía TestClient. Los endpoints que tocan la DB (unlock,
lectura pública autorizada, config de acceso admin) se prueban con la app real
contra un evento de prueba, no acá.

Correr:  ./.venv/bin/python tests/test_event_access.py
(También es compatible con pytest si se instala: pytest tests/test_event_access.py)
"""
import os
import sys

# Permite correr el script directamente (agrega el root del repo al path).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# El entorno debe fijarse ANTES de importar la app (settings lee env al import).
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-event-access")
# Flags OFF por defecto: probamos el gating.
os.environ.pop("EVENT_ACCESS_ENABLED", None)
os.environ.pop("EVENT_PASSWORDS_ENABLED", None)

from starlette.testclient import TestClient  # noqa: E402

from app.utils.event_access_token import issue_event_grant, verify_event_grant  # noqa: E402
from app.utils.security import (  # noqa: E402
    hash_event_password,
    verify_event_password,
    assert_event_password,
    gen_salt,
    gen_share_code,
)
import app.main as main  # noqa: E402


# ---------- Grant firmado ----------

def test_grant_roundtrip_and_scope():
    tok, exp = issue_event_grant("ev-1", 0)
    assert isinstance(exp, int) and exp > 0
    assert verify_event_grant(tok, "ev-1", 0) is True
    # Otro evento no valida (scope por event_id).
    assert verify_event_grant(tok, "ev-2", 0) is False


def test_grant_password_version_revokes():
    tok, _ = issue_event_grant("ev-1", 3)
    assert verify_event_grant(tok, "ev-1", 3) is True
    # Rotar la clave (version distinta) invalida el grant.
    assert verify_event_grant(tok, "ev-1", 4) is False


def test_grant_tampered_and_empty_and_expired():
    tok, _ = issue_event_grant("ev-1", 0)
    assert verify_event_grant(tok + "x", "ev-1", 0) is False
    assert verify_event_grant("", "ev-1", 0) is False
    assert verify_event_grant("not-base64-at-all!!", "ev-1", 0) is False
    expired, _ = issue_event_grant("ev-1", 0, ttl_hours=-1)
    assert verify_event_grant(expired, "ev-1", 0) is False


# ---------- Clave del evento ----------

def test_password_hash_and_verify():
    salt = gen_salt()
    h = hash_event_password("frase-secreta-larga", salt)
    assert h != "frase-secreta-larga"  # nunca plana
    assert verify_event_password("frase-secreta-larga", salt, h) is True
    assert verify_event_password("otra", salt, h) is False
    assert verify_event_password("", salt, h) is False
    # Salt distinto => hash distinto.
    assert hash_event_password("frase-secreta-larga", gen_salt()) != h


def test_password_policy():
    assert assert_event_password("  12345678  ") == "12345678"  # trim + 8 ok
    for bad in ["", "short", "  7chars "]:
        try:
            assert_event_password(bad)
            raise AssertionError(f"debería rechazar: {bad!r}")
        except Exception as e:
            assert "400" in str(e) or "caracteres" in str(e)


def test_share_code_random_unique():
    a, b = gen_share_code(), gen_share_code()
    assert a != b and len(a) >= 16


# ---------- Gating por flag (sin DB) ----------

def test_config_reflects_flags_off():
    with TestClient(main.app) as client:
        r = client.get("/config")
        assert r.status_code == 200
        body = r.json()
        assert body["eventAccessEnabled"] is False
        assert body["eventPasswordsEnabled"] is False


def test_public_events_404_when_flag_off():
    # Con el flag off, el endpoint responde 404 ANTES de tocar la DB.
    with TestClient(main.app) as client:
        r = client.get("/public/events/cualquier-codigo")
        assert r.status_code == 404
        assert r.json()["detail"] == "EVENT_NOT_FOUND"
        r2 = client.post("/public/events/cualquier-codigo/unlock", json={"password": "x"})
        assert r2.status_code == 404


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
        passed += 1
    print(f"\nOK: {passed}/{len(tests)} tests de Event Access pasaron")


if __name__ == "__main__":
    _run_all()
