from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import text

from app.settings import engine
from app.schemas import CreateNotificationRequest
from app.utils.permissions import require_admin
from app.routers.ratings import get_pending_ratings

router = APIRouter()
admin_router = APIRouter()


def _fmt_ts(value):
    return str(value) if value else None


@router.get("/notifications")
def get_notifications(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Devuelve notificaciones activas para el usuario:
    - Informativas (persistidas) no descartadas y no vencidas.
    - Dinamica de votos pendientes.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                n.id,
                n.kind,
                n.title,
                n.message,
                n.action_url,
                n.created_at,
                n.expires_at
            FROM public.notifications n
            LEFT JOIN public.user_notification_dismissals d
                ON d.notification_id = n.id
               AND d.user_id = :actor_user_id
            WHERE n.is_active = true
              AND n.starts_at <= now()
              AND n.expires_at > now()
              AND d.notification_id IS NULL
            ORDER BY n.created_at DESC
            LIMIT :limit
        """), {
            "actor_user_id": actor_user_id,
            "limit": limit,
        }).mappings().all()

    items = [{
        "id": str(r["id"]),
        "kind": r["kind"],
        "title": r["title"],
        "message": r["message"],
        "action_url": r["action_url"],
        "dismissible": True,
        "created_at": _fmt_ts(r["created_at"]),
        "expires_at": _fmt_ts(r["expires_at"]),
    } for r in rows]

    pending_ratings_count = 0
    try:
        pending = get_pending_ratings(actor_user_id=actor_user_id)
        pending_ratings_count = int(pending.get("total_pending", 0))
    except Exception:
        pending_ratings_count = 0

    if pending_ratings_count > 0:
        items.insert(0, {
            "id": "pending-ratings",
            "kind": "PENDING_RATINGS",
            "title": "Tenes votos pendientes",
            "message": (
                f"Tenes {pending_ratings_count} voto pendiente."
                if pending_ratings_count == 1
                else f"Tenes {pending_ratings_count} votos pendientes."
            ),
            "action_url": "/ratings/pending",
            "dismissible": False,
            "created_at": None,
            "expires_at": None,
            "meta": {"pending_count": pending_ratings_count},
        })

    return {
        "unread_count": len(items),
        "pending_ratings_count": pending_ratings_count,
        "items": items,
    }


@router.post("/notifications/{notification_id}/dismiss")
def dismiss_notification(
    notification_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Descarta una notificacion informativa para el usuario actual.
    """
    if notification_id == "pending-ratings":
        raise HTTPException(
            status_code=400,
            detail="La notificacion de votos pendientes no se puede descartar manualmente.",
        )

    with engine.begin() as conn:
        notif = conn.execute(text("""
            SELECT id
            FROM public.notifications
            WHERE id = :notification_id
              AND is_active = true
              AND starts_at <= now()
              AND expires_at > now()
            LIMIT 1
        """), {"notification_id": notification_id}).first()

        if not notif:
            raise HTTPException(status_code=404, detail="Notificacion no encontrada o vencida.")

        conn.execute(text("""
            INSERT INTO public.user_notification_dismissals (
                user_id, notification_id, dismissed_at
            )
            VALUES (
                :user_id, :notification_id, now()
            )
            ON CONFLICT (user_id, notification_id)
            DO UPDATE SET dismissed_at = now()
        """), {
            "user_id": actor_user_id,
            "notification_id": notification_id,
        })

    return {"notification_id": notification_id, "message": "Notificacion descartada."}


@admin_router.get("/notifications")
def list_admin_notifications(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    include_inactive: bool = False,
    limit: int = Query(100, ge=1, le=500),
):
    """
    Lista notificaciones informativas para administracion.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        where_clause = ""
        params = {"limit": limit}
        if not include_inactive:
            where_clause = "WHERE n.is_active = true"

        rows = conn.execute(text(f"""
            SELECT
                n.id,
                n.kind,
                n.title,
                n.message,
                n.action_url,
                n.starts_at,
                n.expires_at,
                n.is_active,
                n.created_by_user_id,
                n.created_at,
                n.updated_at
            FROM public.notifications n
            {where_clause}
            ORDER BY n.created_at DESC
            LIMIT :limit
        """), params).mappings().all()

    return {
        "items": [{
            "id": str(r["id"]),
            "kind": r["kind"],
            "title": r["title"],
            "message": r["message"],
            "action_url": r["action_url"],
            "starts_at": _fmt_ts(r["starts_at"]),
            "expires_at": _fmt_ts(r["expires_at"]),
            "is_active": r["is_active"],
            "created_by_user_id": str(r["created_by_user_id"]) if r["created_by_user_id"] else None,
            "created_at": _fmt_ts(r["created_at"]),
            "updated_at": _fmt_ts(r["updated_at"]),
        } for r in rows],
        "count": len(rows),
    }


@admin_router.post("/notifications")
def create_notification(
    body: CreateNotificationRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Crea una notificacion informativa global.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    with engine.begin() as conn:
        row = conn.execute(text("""
            INSERT INTO public.notifications (
                kind,
                title,
                message,
                action_url,
                starts_at,
                expires_at,
                is_active,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                'INFO',
                :title,
                :message,
                :action_url,
                now(),
                now() + (:expires_in_days || ' days')::interval,
                true,
                :actor_user_id,
                now(),
                now()
            )
            RETURNING id, title, message, action_url, starts_at, expires_at
        """), {
            "title": body.title.strip(),
            "message": body.message.strip(),
            "action_url": body.action_url.strip() if body.action_url else None,
            "expires_in_days": body.expires_in_days,
            "actor_user_id": actor_user_id,
        }).mappings().first()

        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                NULL, :actor_user_id, 'CREATE_NOTIFICATION', CAST(:metadata AS jsonb)
            )
        """), {
            "actor_user_id": actor_user_id,
            "metadata": f'{{"notification_id":"{row["id"]}","expires_in_days":{body.expires_in_days}}}',
        })

    return {
        "id": str(row["id"]),
        "title": row["title"],
        "message": row["message"],
        "action_url": row["action_url"],
        "starts_at": _fmt_ts(row["starts_at"]),
        "expires_at": _fmt_ts(row["expires_at"]),
        "message_status": "Notificacion creada.",
    }


@admin_router.delete("/notifications/{notification_id}")
def deactivate_notification(
    notification_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Desactiva una notificacion informativa.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    with engine.begin() as conn:
        row = conn.execute(text("""
            UPDATE public.notifications
            SET is_active = false, updated_at = now()
            WHERE id = :notification_id
              AND is_active = true
            RETURNING id
        """), {"notification_id": notification_id}).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Notificacion no encontrada o ya desactivada.")

        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                NULL, :actor_user_id, 'DEACTIVATE_NOTIFICATION', CAST(:metadata AS jsonb)
            )
        """), {
            "actor_user_id": actor_user_id,
            "metadata": f'{{"notification_id":"{notification_id}"}}',
        })

    return {"notification_id": notification_id, "message": "Notificacion desactivada."}
