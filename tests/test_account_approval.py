"""
Tests de Account Approval (Iteración 3) que NO requieren base de datos real.

Cubre el flag en /config, el gate de sesión `get_actor_user_id` con el flag
apagado (chequeo puro de token, sin DB) y que la bandeja exige autenticación.
Los flujos con DB (registro→PENDING, aprobar/rechazar, login por estado) se
prueban con la app real, no acá.

Correr:  ./.venv/bin/python tests/test_account_approval.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-approval")
# Flag OFF por defecto: get_actor_user_id no toca la DB (chequeo puro de token).
os.environ.pop("ACCOUNT_APPROVAL_ENABLED", None)

from starlette.testclient import TestClient  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.utils.auth_token import issue_token  # noqa: E402
from app.utils.deps import get_actor_user_id  # noqa: E402
import app.main as main  # noqa: E402


def test_config_exposes_account_flag():
    with TestClient(main.app) as client:
        body = client.get("/config").json()
        assert body["accountApprovalEnabled"] is False


def test_get_actor_user_id_valid_token_flag_off():
    # Con el flag apagado, un token válido devuelve el user_id sin tocar la DB.
    token = issue_token("user-123")
    assert get_actor_user_id(token) == "user-123"


def test_get_actor_user_id_rejects_bad_token():
    for bad in ["", "no-es-un-token", "user-123"]:  # UUID/valor crudo no es token firmado
        try:
            get_actor_user_id(bad)
            raise AssertionError(f"debería rechazar: {bad!r}")
        except HTTPException as e:
            assert e.status_code == 401


def test_account_requests_requires_auth():
    with TestClient(main.app) as client:
        # Sin header → 422 (falta el header requerido).
        r = client.get("/admin/account-requests")
        assert r.status_code == 422
        # Token inválido → 401 (antes de tocar la DB, con flag off).
        r2 = client.get("/admin/account-requests", headers={"X-Actor-User-Id": "token-falso"})
        assert r2.status_code == 401
        r3 = client.post("/admin/account-requests/xxx/approve", headers={"X-Actor-User-Id": "token-falso"})
        assert r3.status_code == 401


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests de Account Approval pasaron")


if __name__ == "__main__":
    _run_all()
