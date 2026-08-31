"""
Grant de acceso a un evento protegido (HMAC-SHA256) — sin tabla ni dependencias.

Cuando alguien valida la contraseña de un evento (`POST /public/events/{code}/unlock`)
se le emite este token opaco, scopeado a UN evento y a la VERSIÓN de la contraseña.
Rotar la contraseña incrementa `password_version` en la DB → todos los grants
emitidos con la versión anterior dejan de validar (revocación sin estado).

Formato (string url-safe base64 sin padding):
    base64url("<event_id>:<pwd_version>:<exp_epoch>:<hex_sig>")
donde
    hex_sig = HMAC_SHA256(AUTH_SECRET, "<event_id>:<pwd_version>:<exp_epoch>")

No confundir con `auth_token.py` (identidad del usuario). Este token NO identifica
a una persona: solo prueba que se conoció la clave del evento.
"""
import base64
import hashlib
import hmac
import time

from app.settings import AUTH_SECRET

_DEFAULT_TTL_HOURS = 24


def _sign(payload: str) -> str:
    return hmac.new(
        AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def issue_event_grant(event_id: str, password_version: int, ttl_hours: int = _DEFAULT_TTL_HOURS) -> tuple[str, int]:
    """
    Emite un grant firmado para `event_id` + `password_version`.
    Devuelve (token, exp_epoch).
    """
    exp = int(time.time()) + int(ttl_hours) * 3600
    payload = f"{event_id}:{int(password_version)}:{exp}"
    raw = f"{payload}:{_sign(payload)}"
    token = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    return token, exp


def verify_event_grant(token: str, event_id: str, current_password_version: int) -> bool:
    """
    True solo si el token: firma válida, no expiró, es de ESTE evento y su
    `password_version` coincide con la actual del evento (rotar clave lo invalida).
    """
    if not token:
        return False
    try:
        padding = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + padding).decode("utf-8")
        tok_event_id, tok_version_str, exp_str, sig = raw.rsplit(":", 3)
    except (ValueError, TypeError):
        return False

    payload = f"{tok_event_id}:{tok_version_str}:{exp_str}"
    if not hmac.compare_digest(sig, _sign(payload)):
        return False

    # Scope: mismo evento.
    if tok_event_id != str(event_id):
        return False

    # Versión de contraseña vigente (revocación por rotación).
    try:
        if int(tok_version_str) != int(current_password_version):
            return False
        if int(exp_str) < int(time.time()):
            return False
    except ValueError:
        return False

    return True
