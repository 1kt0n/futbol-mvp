import re
import hmac
import hashlib
import secrets
from fastapi import HTTPException

# Iteraciones PBKDF2 para la contraseña de evento. Más alto que el PIN (120k)
# porque una frase tiene más entropía a proteger y el unlock no es hot-path.
_EVENT_PWD_ITERATIONS = 200_000
_EVENT_PWD_MIN_LEN = 8


def hash_pin(pin: str, salt_hex: str) -> str:
    pin_bytes = pin.encode("utf-8")
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", pin_bytes, salt, 120_000)
    return dk.hex()

def verify_pin(pin: str, salt_hex: str, expected_hash_hex: str) -> bool:
    got = hash_pin(pin, salt_hex)
    return hmac.compare_digest(got, expected_hash_hex)

def assert_pin(pin: str) -> str:
    p = (pin or "").strip()
    if not re.fullmatch(r"\d{4}|\d{6}", p):
        raise HTTPException(status_code=400, detail="PIN inválido. Usá 4 o 6 dígitos.")
    return p


# ============================================================
# Contraseña de evento (Event Access v1)
# ============================================================

def gen_salt() -> str:
    """Salt aleatorio (16 bytes) en hex, para hashear la clave del evento."""
    return secrets.token_hex(16)


def gen_share_code() -> str:
    """
    Código de compartir aleatorio, no secuencial, url-safe (~132 bits de entropía).
    No es secreto por sí mismo: en LINK_PASSWORD la clave es la que autoriza.
    """
    return secrets.token_urlsafe(16)


def hash_event_password(password: str, salt_hex: str) -> str:
    """PBKDF2-HMAC-SHA256 de la clave del evento. Nunca se guarda la clave plana."""
    pwd_bytes = password.encode("utf-8")
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt, _EVENT_PWD_ITERATIONS)
    return dk.hex()


def verify_event_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    """Comparación en tiempo constante contra el hash guardado."""
    if not (password and salt_hex and expected_hash_hex):
        return False
    got = hash_event_password(password, salt_hex)
    return hmac.compare_digest(got, expected_hash_hex)


def assert_event_password(password: str) -> str:
    """Valida la política mínima de la clave de evento (frase de 8+ caracteres)."""
    p = (password or "").strip()
    if len(p) < _EVENT_PWD_MIN_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"La contraseña del evento debe tener al menos {_EVENT_PWD_MIN_LEN} caracteres.",
        )
    if len(p) > 200:
        raise HTTPException(status_code=400, detail="La contraseña del evento es demasiado larga.")
    return p


# ============================================================
# Token de gestión de participante externo (Event Access v2)
# ============================================================

def gen_management_token() -> str:
    """Token opaco de gestión (~256 bits). El plano se muestra 1 vez; se guarda su hash."""
    return secrets.token_urlsafe(32)


def hash_management_token(token: str) -> str:
    """SHA-256 del token (256 bits de entropía → sin brute-force, no necesita PBKDF2)."""
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()