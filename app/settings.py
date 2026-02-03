import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from supabase import create_client, Client

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en el .env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

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
AVATAR_MAX_SIZE = 2 * 1024 * 1024  # 2MB