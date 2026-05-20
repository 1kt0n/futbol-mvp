"""
CRUD admin de anuncios del calendario + hook a notifications cuando se publica algo nuevo.

Los anuncios son entradas informativas (sin inscripcion) que aparecen en el calendario
de todos los jugadores. Cada vez que un admin crea un anuncio, se inserta una fila en
public.notifications con action_url=/calendar para que aparezca tambien en la bell.
"""

import logging

from fastapi import APIRouter, HTTPException, Header
from sqlalchemy import text

from app.settings import engine
from app.schemas import CreateAnnouncementRequest, UpdateAnnouncementRequest
from app.utils.datetime_parser import parse_client_datetime
from app.utils.permissions import require_admin

router = APIRouter()
logger = logging.getLogger(__name__)


def _fmt_ts(value):
    return str(value) if value else None


def _serialize(row) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "description": row["description"],
        "starts_at": _fmt_ts(row["starts_at"]),
        "ends_at": _fmt_ts(row["ends_at"]),
        "location_name": row["location_name"],
        "action_url": row["action_url"],
        "action_label": row["action_label"],
        "created_by_user_id": str(row["created_by_user_id"]) if row["created_by_user_id"] else None,
        "created_at": _fmt_ts(row["created_at"]),
        "updated_at": _fmt_ts(row["updated_at"]),
    }


def _broadcast_to_bell(conn, title: str, message: str) -> None:
    """Best-effort: inserta una notificacion global de 48h con link al calendario."""
    try:
        conn.execute(text("""
            INSERT INTO public.notifications (
                kind, title, message, action_url,
                starts_at, expires_at, is_active, created_at, updated_at
            )
            VALUES (
                'INFO',
                :title,
                :message,
                '/calendar',
                now(),
                now() + interval '48 hours',
                true,
                now(),
                now()
            )
        """), {"title": title, "message": message})
    except Exception:
        logger.exception("Failed to broadcast calendar announcement to notifications.")


@router.get("/calendar/announcements")
def list_announcements(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    include_past: bool = False,
    limit: int = 200,
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        where = "" if include_past else "WHERE starts_at >= now() - interval '7 days'"
        rows = conn.execute(text(f"""
            SELECT id, title, description, starts_at, ends_at,
                   location_name, action_url, action_label,
                   created_by_user_id, created_at, updated_at
            FROM public.calendar_announcements
            {where}
            ORDER BY starts_at DESC
            LIMIT :limit
        """), {"limit": limit}).mappings().all()

    return {"items": [_serialize(r) for r in rows], "count": len(rows)}


@router.post("/calendar/announcements")
def create_announcement(
    body: CreateAnnouncementRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    try:
        starts_at = parse_client_datetime(body.starts_at, "starts_at", required=True)
        ends_at = parse_client_datetime(body.ends_at, "ends_at")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if ends_at and ends_at < starts_at:
        raise HTTPException(status_code=400, detail="ends_at debe ser posterior a starts_at.")

    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO public.calendar_announcements (
                title, description, starts_at, ends_at,
                location_name, action_url, action_label,
                created_by_user_id, created_at, updated_at
            )
            VALUES (
                :title, :description, :starts_at, :ends_at,
                :location_name, :action_url, :action_label,
                :actor_user_id, now(), now()
            )
            RETURNING id, title, description, starts_at, ends_at,
                      location_name, action_url, action_label,
                      created_by_user_id, created_at, updated_at
        """), {
            "title": body.title.strip(),
            "description": body.description.strip() if body.description else None,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "location_name": body.location_name.strip() if body.location_name else None,
            "action_url": body.action_url.strip() if body.action_url else None,
            "action_label": body.action_label.strip() if body.action_label else None,
            "actor_user_id": actor_user_id,
        }).mappings().first()

        _broadcast_to_bell(
            conn,
            title="Nuevo en el calendario",
            message=row["title"],
        )

    return _serialize(row)


@router.patch("/calendar/announcements/{announcement_id}")
def update_announcement(
    announcement_id: str,
    body: UpdateAnnouncementRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    try:
        starts_at = parse_client_datetime(body.starts_at, "starts_at") if body.starts_at else None
        ends_at = parse_client_datetime(body.ends_at, "ends_at") if body.ends_at else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    updates: list[str] = []
    params: dict = {"announcement_id": announcement_id}

    if body.title is not None:
        updates.append("title = :title")
        params["title"] = body.title.strip()
    if body.description is not None:
        updates.append("description = :description")
        params["description"] = body.description.strip() if body.description else None
    if starts_at is not None:
        updates.append("starts_at = :starts_at")
        params["starts_at"] = starts_at
    if body.ends_at is not None:
        # permitir vaciar pasando string vacio
        updates.append("ends_at = :ends_at")
        params["ends_at"] = ends_at
    if body.location_name is not None:
        updates.append("location_name = :location_name")
        params["location_name"] = body.location_name.strip() if body.location_name else None
    if body.action_url is not None:
        updates.append("action_url = :action_url")
        params["action_url"] = body.action_url.strip() if body.action_url else None
    if body.action_label is not None:
        updates.append("action_label = :action_label")
        params["action_label"] = body.action_label.strip() if body.action_label else None

    if not updates:
        raise HTTPException(status_code=400, detail="No se especificaron campos para actualizar.")

    updates.append("updated_at = now()")

    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    with engine.begin() as conn:
        row = conn.execute(text(f"""
            UPDATE public.calendar_announcements
            SET {", ".join(updates)}
            WHERE id = :announcement_id
            RETURNING id, title, description, starts_at, ends_at,
                      location_name, action_url, action_label,
                      created_by_user_id, created_at, updated_at
        """), params).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Anuncio no encontrado.")

    return _serialize(row)


@router.delete("/calendar/announcements/{announcement_id}")
def delete_announcement(
    announcement_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    with engine.begin() as conn:
        row = conn.execute(text("""
            DELETE FROM public.calendar_announcements
            WHERE id = :announcement_id
            RETURNING id
        """), {"announcement_id": announcement_id}).first()

        if not row:
            raise HTTPException(status_code=404, detail="Anuncio no encontrado.")

    return {"announcement_id": announcement_id, "message": "Anuncio eliminado."}
