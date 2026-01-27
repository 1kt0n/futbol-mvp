import re
import hmac
import hashlib
from fastapi import HTTPException

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