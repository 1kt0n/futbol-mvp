from fastapi import APIRouter, Header
from sqlalchemy import text

from app.settings import engine
from app.utils.permissions import require_admin

router = APIRouter()


@router.get("/audit")
def get_audit_logs(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    event_id: str | None = None,
    action: str | None = None,
    actor_user_id_filter: str | None = None,
    limit: int = 100,
    offset: int = 0
):
    """
    Obtiene logs de auditoría con filtros opcionales. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Construir WHERE dinámicamente
        where_conditions = []
        params = {"limit": limit, "offset": offset}

        if event_id:
            where_conditions.append("eal.event_id = :event_id")
            params["event_id"] = event_id

        if action:
            where_conditions.append("eal.action = :action")
            params["action"] = action

        if actor_user_id_filter:
            where_conditions.append("eal.actor_user_id = :actor_user_id_filter")
            params["actor_user_id_filter"] = actor_user_id_filter

        where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""

        query = f"""
            SELECT
                eal.id,
                eal.event_id,
                eal.actor_user_id,
                u.full_name as actor_name,
                eal.action,
                eal.target_registration_id,
                eal.metadata,
                eal.created_at
            FROM public.event_audit_log eal
            LEFT JOIN public.users u ON u.id = eal.actor_user_id
            {where_clause}
            ORDER BY eal.created_at DESC
            LIMIT :limit OFFSET :offset
        """

        logs = conn.execute(text(query), params).mappings().all()

        return {
            "logs": [
                {
                    "id": str(log["id"]),
                    "event_id": str(log["event_id"]) if log["event_id"] else None,
                    "actor_user_id": str(log["actor_user_id"]),
                    "actor_name": log["actor_name"],
                    "action": log["action"],
                    "target_registration_id": str(log["target_registration_id"]) if log["target_registration_id"] else None,
                    "metadata": log["metadata"],
                    "created_at": str(log["created_at"])
                }
                for log in logs
            ],
            "count": len(logs),
            "offset": offset,
            "limit": limit
        }
