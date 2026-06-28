import os
import hashlib
import logging
from dotenv import load_dotenv
from sqlalchemy import create_engine
from supabase import create_client, Client

load_dotenv()

logger = logging.getLogger("uvicorn.error")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en el .env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# Secreto para firmar los tokens de sesión (ver app/utils/auth_token.py).
# Si no se setea AUTH_SECRET, se deriva de DATABASE_URL (estable entre reinicios
# y secreto, ya que contiene la password de la DB) para que el deploy no se
# rompa. RECOMENDADO setear AUTH_SECRET explícito en Railway:
#   python -c "import secrets; print(secrets.token_hex(32))"
AUTH_SECRET = os.getenv("AUTH_SECRET")
if not AUTH_SECRET:
    AUTH_SECRET = hashlib.sha256(DATABASE_URL.encode("utf-8")).hexdigest()
    logger.warning(
        "AUTH_SECRET no está seteada; usando secreto derivado de DATABASE_URL. "
        "Setear AUTH_SECRET explícito en producción."
    )

# CORS: configurable via env var (comma-separated) o defaults para desarrollo
_cors_env = os.getenv("CORS_ORIGINS", "")
if _cors_env.strip():
    CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    CORS_ORIGINS = [
        "http://192.168.0.57:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

# Supabase Storage client
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

supabase_client: Client | None = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

AVATAR_BUCKET = "avatars"
try:
    AVATAR_MAX_MB = int(os.getenv("AVATAR_MAX_MB", "8"))
except ValueError:
    AVATAR_MAX_MB = 8

if AVATAR_MAX_MB < 1:
    AVATAR_MAX_MB = 1

AVATAR_MAX_SIZE = AVATAR_MAX_MB * 1024 * 1024
