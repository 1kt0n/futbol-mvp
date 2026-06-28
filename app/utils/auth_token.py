"""
Token de sesión firmado (HMAC-SHA256) — sin dependencias externas.

Reemplaza la confianza ciega en el header `X-Actor-User-Id` (que antes era el
UUID crudo del usuario y por lo tanto falsificable por cualquiera que conociera
ese UUID). Ahora el login emite un token firmado con `AUTH_SECRET`; sin ese
secreto es imposible forjar una identidad.

Formato del token (string opaco, URL-safe base64 sin padding):
    base64url( "<user_id>:<exp_epoch>:<hex_sig>" )
donde
    hex_sig = HMAC_SHA256(AUTH_SECRET, "<user_id>:<exp_epoch>")
"""
import base64
import hashlib
import hmac
import time

from app.settings import AUTH_SECRET


def _sign(payload: str) -> str:
    return hmac.new(
        AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def issue_token(user_id: str, ttl_days: int = 30) -> str:
    """Emite un token firmado para el user_id dado, válido por `ttl_days`."""
    exp = int(time.time()) + ttl_days * 24 * 3600
    payload = f"{user_id}:{exp}"
    raw = f"{payload}:{_sign(payload)}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def verify_token(token: str) -> str | None:
    """
    Verifica firma y expiración. Devuelve el user_id si el token es válido,
    o None si es inválido/expirado/malformado (incluye el caso de un UUID crudo,
    que NO es un token válido).
    """
    if not token:
        return None
    try:
        padding = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + padding).decode("utf-8")
        user_id, exp_str, sig = raw.rsplit(":", 2)
    except (ValueError, TypeError):
        return None

    payload = f"{user_id}:{exp_str}"
    expected = _sign(payload)
    # Comparación en tiempo constante para evitar timing attacks.
    if not hmac.compare_digest(sig, expected):
        return None

    try:
        if int(exp_str) < int(time.time()):
            return None
    except ValueError:
        return None

    return user_id
