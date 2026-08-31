"""
Tests de External Players (Iteración 2) que NO requieren base de datos real.

Cubre el cifrado del contacto, el fingerprint de dedup, el token de gestión y el
gating por feature flag de los endpoints públicos. Los flujos con DB (alta,
dedup, waitlist, cancelación) se prueban con la app real contra un evento de
prueba, no acá.

Correr:  ./.venv/bin/python tests/test_external_participants.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
os.environ.setdefault("AUTH_SECRET", "test-secret-external")
# Flags OFF por defecto: probamos el gating de los endpoints externos.
for k in ("EVENT_ACCESS_ENABLED", "EVENT_PASSWORDS_ENABLED", "EXTERNAL_REGISTRATION_ENABLED"):
    os.environ.pop(k, None)

from starlette.testclient import TestClient  # noqa: E402

from app.utils.contact_crypto import encrypt_contact, decrypt_contact, contact_fingerprint  # noqa: E402
from app.utils.security import gen_management_token, hash_management_token  # noqa: E402
import app.main as main  # noqa: E402


# ---------- Contacto: cifrado reversible + fingerprint ----------

def test_contact_encrypt_roundtrip():
    tok = encrypt_contact("+5491133334444")
    assert tok != "+5491133334444"  # nunca plano
    assert decrypt_contact(tok) == "+5491133334444"
    assert decrypt_contact("basura-no-fernet") is None
    assert decrypt_contact("") is None


def test_contact_fingerprint_stable_and_normalized():
    fp_a = contact_fingerprint("11 3333-4444")
    fp_b = contact_fingerprint("+5491133334444")
    assert fp_a and len(fp_a) == 64
    # Distintos formatos del mismo número → mismo fingerprint (dedup robusto).
    assert fp_a == fp_b
    # No reversible ni derivable del contacto en claro.
    assert "3333" not in fp_a
    # Contacto inválido → None (no se puede deduplicar/insertar).
    assert contact_fingerprint("abc") is None
    assert contact_fingerprint("") is None


def test_management_token():
    tok = gen_management_token()
    h = hash_management_token(tok)
    assert len(tok) >= 32 and len(h) == 64
    assert hash_management_token(tok) == h          # determinístico
    assert gen_management_token() != tok            # aleatorio
    assert hash_management_token("otro") != h


# ---------- Gating por flag (sin DB) ----------

_VALID_BODY = {
    "display_name": "Juan Pérez",
    "contact": "+5491133334444",
    "court_id": "00000000-0000-0000-0000-000000000000",
    "privacy_accepted": True,
}


def test_participants_404_when_flag_off():
    # Body válido para pasar la validación de Pydantic y llegar al gating (404).
    with TestClient(main.app) as client:
        r = client.post("/public/events/cualquier-codigo/participants", json=_VALID_BODY)
        assert r.status_code == 404
        assert r.json()["detail"] == "EVENT_NOT_FOUND"


def test_participation_get_cancel_404_when_flag_off():
    with TestClient(main.app) as client:
        r = client.get("/public/participations/token-cualquiera")
        assert r.status_code == 404
        assert r.json()["detail"] == "INVALID_MANAGEMENT_TOKEN"
        r2 = client.post("/public/participations/token-cualquiera/cancel")
        assert r2.status_code == 404


def test_config_exposes_external_flag():
    with TestClient(main.app) as client:
        body = client.get("/config").json()
        assert body["externalRegistrationEnabled"] is False


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests de External Players pasaron")


if __name__ == "__main__":
    _run_all()
