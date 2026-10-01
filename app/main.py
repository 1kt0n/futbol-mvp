import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.settings import (
    CORS_ORIGINS,
    engine,
    EVENT_ACCESS_ENABLED,
    EVENT_PASSWORDS_ENABLED,
    EXTERNAL_REGISTRATION_ENABLED,
    ACCOUNT_APPROVAL_ENABLED,
)
from app.utils.auth_token import verify_token
from app.utils.ratelimit import client_ip
from app.routers import (
    auth,
    events,
    events_public,
    admin_events,
    admin_users,
    admin_audit,
    ratings,
    notifications,
    tournaments_admin,
    tournaments_public,
    calendar,
    admin_calendar,
    admin_roles,
    competitions_admin,
    competitions_public,
)

# =========================
# FastAPI App
# =========================

app = FastAPI(title="Futbol MVP API")

logger = logging.getLogger("uvicorn.error")
access_logger = logging.getLogger("futbol.access")

# =========================
# CORS Middleware
# =========================
# No combinar allow_credentials=True con "*"; restringir a orígenes/headers
# concretos. La app autentica por header (no cookies), así que no necesitamos
# credentials cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Actor-User-Id", "X-Event-Access", "X-Staff-Token"],
)
# El snapshot público de competencias (~100 KB de JSON repetitivo) baja ~10x con gzip.
app.add_middleware(GZipMiddleware, minimum_size=1024)


# =========================
# Forensic access log
# =========================
# Registra cada request mutante con IP, User-Agent y el actor REAL (derivado del
# token verificado, no del valor crudo). Railway retiene estos logs → trazabilidad
# de quién hizo qué, que antes no existía.
@app.middleware("http")
async def forensic_access_log(request: Request, call_next):
    response = await call_next(request)
    try:
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            actor = verify_token(request.headers.get("X-Actor-User-Id", "")) or "-"
            access_logger.info(
                "req method=%s path=%s status=%s ip=%s actor=%s ua=%r",
                request.method,
                request.url.path,
                response.status_code,
                client_ip(request),
                actor,
                request.headers.get("user-agent", "-"),
            )
    except Exception:
        pass
    return response

# =========================
# Health Check Endpoints
# =========================

@app.get("/health")
def health():
    """Health check básico"""
    return {"status": "ok"}


@app.get("/db-check")
def db_check():
    """Verifica conectividad con la base de datos (sin filtrar detalles internos)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return {"db": "ok"}
    except SQLAlchemyError:
        logger.exception("db-check failed")
        return {"db": "error"}


@app.get("/config")
def app_config():
    """
    Feature flags públicas para el frontend (sin auth, sin secretos).
    El cliente decide qué UI mostrar sin depender de constantes de build.
    """
    return {
        "eventAccessEnabled": EVENT_ACCESS_ENABLED,
        "eventPasswordsEnabled": EVENT_PASSWORDS_ENABLED,
        "externalRegistrationEnabled": EXTERNAL_REGISTRATION_ENABLED,
        "accountApprovalEnabled": ACCOUNT_APPROVAL_ENABLED,
    }


# =========================
# Include Routers
# =========================

app.include_router(auth.router, tags=["Auth"])
app.include_router(events.router, tags=["Events"])
app.include_router(events_public.router, tags=["Public - Events"])
app.include_router(admin_events.router, prefix="/admin", tags=["Admin - Events"])
app.include_router(admin_users.router, prefix="/admin", tags=["Admin - Users"])
app.include_router(admin_audit.router, prefix="/admin", tags=["Admin - Audit"])
app.include_router(ratings.router, tags=["Ratings"])
app.include_router(notifications.router, tags=["Notifications"])
app.include_router(notifications.admin_router, prefix="/admin", tags=["Admin - Notifications"])
app.include_router(tournaments_admin.router, prefix="/admin", tags=["Admin - Tournaments"])
app.include_router(tournaments_public.router, tags=["Public - Tournaments"])
app.include_router(calendar.router, tags=["Calendar"])
app.include_router(admin_calendar.router, prefix="/admin", tags=["Admin - Calendar"])
app.include_router(admin_roles.router, prefix="/admin", tags=["Admin - Roles"])
app.include_router(competitions_admin.router, prefix="/admin", tags=["Admin - Competitions"])
app.include_router(competitions_public.router, tags=["Public - Competitions"])

# =========================
# Serve Frontend (production)
# =========================

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.is_dir():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="static-assets")

    # Catch-all: serve index.html for any non-API route (SPA routing)
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        no_cache_headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
        # If the file exists in static dir, serve it directly
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            # HTML should not be cached to force clients to pick the latest app shell.
            if file_path.suffix.lower() == ".html":
                return FileResponse(file_path, headers=no_cache_headers)
            return FileResponse(file_path)
        # Otherwise serve index.html (React Router handles the rest)
        return FileResponse(STATIC_DIR / "index.html", headers=no_cache_headers)
