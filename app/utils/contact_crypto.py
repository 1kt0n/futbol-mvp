"""
Cifrado en reposo del contacto de participantes externos (Fernet) + fingerprint
HMAC para deduplicación sin exponer el dato.

- El contacto (WhatsApp/teléfono) se guarda cifrado y REVERSIBLE: el organizador
  con permiso puede verlo para coordinar. La clave sale de `EXTERNAL_CONTACT_KEY`
  (Fernet key) o se deriva de `AUTH_SECRET` si no está seteada.
- El fingerprint es HMAC-SHA256 sobre el teléfono normalizado: NO reversible,
  estable, alimenta el índice único de dedup `(event_id, contact_fingerprint)`.
"""
import base64
import hashlib
import hmac
import os

from cryptography.fernet import Fernet, InvalidToken

from app.settings import AUTH_SECRET
from app.utils.phone import normalize_phone

_fernet_instance: Fernet | None = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        key = os.getenv("EXTERNAL_CONTACT_KEY", "").strip()
        if key:
            _fernet_instance = Fernet(key.encode("utf-8"))
        else:
            # Derivar una Fernet key válida (32 bytes url-safe base64) desde AUTH_SECRET.
            derived = hashlib.sha256(("ext-contact:" + AUTH_SECRET).encode("utf-8")).digest()
            _fernet_instance = Fernet(base64.urlsafe_b64encode(derived))
    return _fernet_instance


_FP_KEY = hashlib.sha256(("ext-fingerprint:" + AUTH_SECRET).encode("utf-8")).digest()


def encrypt_contact(plain: str) -> str:
    return _fernet().encrypt((plain or "").encode("utf-8")).decode("ascii")


def decrypt_contact(token: str) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return None


def contact_fingerprint(raw: str) -> str | None:
    """HMAC del teléfono normalizado. None si el contacto no es válido/parseable."""
    normalized = normalize_phone(raw or "")
    if not normalized:
        return None
    return hmac.new(_FP_KEY, normalized.encode("utf-8"), hashlib.sha256).hexdigest()
