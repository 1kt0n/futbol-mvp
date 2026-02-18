import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.settings import CORS_ORIGINS, engine
from app.routers import (
    auth,
    events,
    admin_events,
    admin_users,
    admin_audit,
    ratings,
    notifications,
    tournaments_admin,
    tournaments_public,
)

# =========================
# FastAPI App
# =========================

app = FastAPI(title="Futbol MVP API")

# =========================
# CORS Middleware
# =========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Health Check Endpoints
# =========================

@app.get("/__whoami")
def whoami():
    """Marca de agua para verificar versión del código"""
    return {"whoami": "app/main.py v2026-01-27 refactored"}


@app.get("/health")
def health():
    """Health check básico"""
    return {"status": "ok"}


@app.get("/db-check")
def db_check():
    """Verifica conectividad con la base de datos"""
    try:
        with engine.connect() as conn:
            res = conn.execute(text("select now() as now")).mappings().first()
        return {"db": "ok", "now": str(res["now"])}
    except SQLAlchemyError as e:
        return {"db": "error", "detail": str(e)}


# =========================
# Include Routers
# =========================

app.include_router(auth.router, tags=["Auth"])
app.include_router(events.router, tags=["Events"])
app.include_router(admin_events.router, prefix="/admin", tags=["Admin - Events"])
app.include_router(admin_users.router, prefix="/admin", tags=["Admin - Users"])
app.include_router(admin_audit.router, prefix="/admin", tags=["Admin - Audit"])
app.include_router(ratings.router, tags=["Ratings"])
app.include_router(notifications.router, tags=["Notifications"])
app.include_router(notifications.admin_router, prefix="/admin", tags=["Admin - Notifications"])
app.include_router(tournaments_admin.router, prefix="/admin", tags=["Admin - Tournaments"])
app.include_router(tournaments_public.router, tags=["Public - Tournaments"])

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
