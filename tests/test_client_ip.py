"""
Tests de `client_ip` y `rate_limit` (app/utils/ratelimit.py). Sin base de datos.

Fijan el contrato del que dependen los límites por IP: la clave sale de la primera
entrada de X-Forwarded-For (el borde de Railway la escribe y descarta la del cliente;
ver el docstring de `client_ip` y scripts/check_forwarded_for.py) y, sin ese header,
de la conexión.

Correr:  ./.venv/bin/python tests/test_client_ip.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app.utils import ratelimit  # noqa: E402
from app.utils.ratelimit import client_ip, rate_limit  # noqa: E402


def _request(headers=None, peer=("100.64.0.7", 41234)):
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/auth/pin/login",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": peer,
    }
    return Request(scope)


def test_uses_first_forwarded_entry():
    # Forma que entrega el borde de Railway: [cliente real, salto interno].
    r = _request({"X-Forwarded-For": "181.45.12.9, 100.64.0.2"})
    assert client_ip(r) == "181.45.12.9"


def test_strips_spaces_and_single_entry():
    assert client_ip(_request({"X-Forwarded-For": "  181.45.12.9  "})) == "181.45.12.9"


def test_falls_back_to_connection_without_header():
    assert client_ip(_request(peer=("127.0.0.1", 50000))) == "127.0.0.1"


def test_unknown_without_request_or_client():
    assert client_ip(None) == "unknown"
    assert client_ip(_request(peer=None)) == "unknown"


def test_rate_limit_blocks_after_max_hits_per_key():
    ratelimit._hits.clear()
    for _ in range(3):
        rate_limit("test:a", max_hits=3, window_seconds=60)
    try:
        rate_limit("test:a", max_hits=3, window_seconds=60)
    except HTTPException as e:
        assert e.status_code == 429
    else:
        raise AssertionError("el 4.º intento tenía que dar 429")
    # Otra clave (otra IP) no comparte el cupo.
    rate_limit("test:b", max_hits=3, window_seconds=60)
    ratelimit._hits.clear()


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests de client_ip/rate_limit pasaron")


if __name__ == "__main__":
    _run_all()
