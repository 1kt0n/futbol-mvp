"""
Rate limiting simple en memoria (sin Redis).

NOTA: el estado vive en el proceso → se resetea en cada reinicio y es por-instancia.
Railway corre 1 instancia, así que alcanza para frenar ráfagas y fuerza bruta.
Si en el futuro se escala a varias instancias, mover esto a Redis/Postgres.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, max_hits: int, window_seconds: float) -> None:
    """Permite `max_hits` por `window_seconds` para una `key`. Lanza 429 si se excede."""
    now = time.time()
    with _lock:
        dq = _hits[key]
        cutoff = now - window_seconds
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= max_hits:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas solicitudes. Esperá un momento e intentá de nuevo.",
            )
        dq.append(now)


def client_ip(request: Request | None) -> str:
    """IP del cliente, confiando en el proxy de Railway (X-Forwarded-For)."""
    if request is None:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
