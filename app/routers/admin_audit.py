"""
Auditoria enriquecida para el panel admin.

GET /admin/audit devuelve eventos del log con nombres resueltos (actor, target,
event, cancha) y un objeto `context` con todos los UUIDs de la metadata ya
convertidos a strings legibles. El frontend usa eso para armar frases naturales.

GET /admin/audit/actors devuelve los admins que emitieron al menos un log,
para el typeahead del filtro.
"""

from typing import Iterable

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import text

from app.settings import engine
from app.utils.datetime_parser import parse_client_datetime
from app.utils.permissions import require_admin

router = APIRouter()

# Mapeo action -> categoria visual (chip + color)
ACTION_CATEGORY: dict[str, str] = {
    # EVENTO
    "CREATE_EVENT": "EVENTO",
    "CLOSE_EVENT": "EVENTO",
    "REOPEN_EVENT": "EVENTO",
    "FINALIZE_EVENT": "EVENTO",
    "UPDATE_EVENT_VISIBILITY": "EVENTO",
    "AUTO_CLOSE_EVENT": "EVENTO",
    # CANCHA
    "CREATE_COURT": "CANCHA",
    "UPDATE_COURT": "CANCHA",
    "DELETE_COURT": "CANCHA",
    "OPEN_COURT": "CANCHA",
    "CLOSE_COURT": "CANCHA",
    "AUTO_CLOSE_COURT": "CANCHA",
    # INSCRIPCION
    "REGISTER_USER": "INSCRIPCION",
    "REGISTER_GUEST": "INSCRIPCION",
    "CANCEL_REGISTRATION": "INSCRIPCION",
    "MOVE_REGISTRATION": "INSCRIPCION",
    "PROMOTE_WAITLIST": "INSCRIPCION",
    # CAPITAN
    "ASSIGN_CAPTAIN": "CAPITAN",
    "REMOVE_CAPTAIN": "CAPITAN",
    # USUARIO
    "CREATE_USER_MANUAL": "USUARIO",
    "UPDATE_USER_STATUS": "USUARIO",
    "UPDATE_USER_ROLES": "USUARIO",
    # NOTIFICACION
    "CREATE_NOTIFICATION": "NOTIFICACION",
    "DEACTIVATE_NOTIFICATION": "NOTIFICACION",
}

# Acciones disparadas por el sistema (no por una persona); ocultas por default.
SYSTEM_ACTIONS: set[str] = {
    "AUTO_CLOSE_COURT",
    "AUTO_CLOSE_EVENT",
    "PROMOTE_WAITLIST",
}

VALID_CATEGORIES = {
    "EVENTO", "CANCHA", "INSCRIPCION", "CAPITAN", "USUARIO", "NOTIFICACION", "SISTEMA",
}

# Llaves dentro de metadata que sabemos que son court UUIDs
COURT_KEYS = ("court_id", "from_court_id", "to_court_id")
# Llaves dentro de metadata que sabemos que son user UUIDs
USER_KEYS = ("user_id", "captain_user_id", "removed_user_id", "target_user_id")


def _classify(action: str) -> tuple[str, bool]:
    """Devuelve (category, is_system) para un action string."""
    is_system = action in SYSTEM_ACTIONS
    if is_system:
        return "SISTEMA", True
    return ACTION_CATEGORY.get(action, "OTRO"), False


def _coerce_uuid_strs(values: Iterable) -> set[str]:
    """Filtra valores no-string-uuid de un iterable y devuelve set de strings."""
    out: set[str] = set()
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if len(s) == 36 and s.count("-") == 4:
            out.add(s)
    return out


@router.get("/audit")
def get_audit_logs(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    event_id: str | None = None,
    action: str | None = None,
    actor_user_id_filter: str | None = None,
    category: list[str] | None = Query(default=None),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    include_system: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """
    Devuelve logs de auditoria con campos enriquecidos (actor, event, target, context).
    """
    if category:
        bad = [c for c in category if c not in VALID_CATEGORIES]
        if bad:
            raise HTTPException(status_code=400, detail=f"Categoria invalida: {bad}")

    try:
        from_dt = parse_client_datetime(from_, "from") if from_ else None
        to_dt = parse_client_datetime(to, "to") if to else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Filtros que se aplican en SQL: event_id, action, actor, from, to.
    # Los filtros category e include_system se aplican en Python (post-fetch)
    # porque dependen de un map estatico. Para que el LIMIT/OFFSET tenga
    # sentido cuando hay filtros de categoria, agarramos un page tope y
    # filtramos en memoria.
    where_conditions: list[str] = []
    params: dict = {"sql_limit": min(limit * 4, 500), "sql_offset": offset}

    if event_id:
        where_conditions.append("eal.event_id = :event_id")
        params["event_id"] = event_id

    if action:
        where_conditions.append("eal.action = :action")
        params["action"] = action

    if actor_user_id_filter:
        where_conditions.append("eal.actor_user_id = :actor_user_id_filter")
        params["actor_user_id_filter"] = actor_user_id_filter

    if from_dt:
        where_conditions.append("eal.created_at >= :from_dt")
        params["from_dt"] = from_dt

    if to_dt:
        where_conditions.append("eal.created_at < :to_dt")
        params["to_dt"] = to_dt

    where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""

    query = f"""
        SELECT
            eal.id,
            eal.action,
            eal.created_at,
            eal.metadata,
            eal.event_id,
            eal.actor_user_id,
            ua.full_name AS actor_name,
            e.title AS event_title,
            eal.target_registration_id,
            r.registration_type AS target_reg_type,
            r.guest_name AS target_guest_name,
            ur.full_name AS target_user_name,
            rc.name AS target_court_name
        FROM public.event_audit_log eal
        LEFT JOIN public.users ua ON ua.id = eal.actor_user_id
        LEFT JOIN public.events e ON e.id = eal.event_id
        LEFT JOIN public.event_registrations r ON r.id = eal.target_registration_id
        LEFT JOIN public.users ur ON ur.id = r.user_id
        LEFT JOIN public.event_courts rc ON rc.id = r.court_id
        {where_clause}
        ORDER BY eal.created_at DESC
        LIMIT :sql_limit OFFSET :sql_offset
    """

    with engine.connect() as conn:
        require_admin(conn, actor_user_id)
        rows = conn.execute(text(query), params).mappings().all()

        # Recolectar court_ids y user_ids referenciados en metadata para resolver en batch.
        court_ids: set[str] = set()
        user_ids: set[str] = set()
        for r in rows:
            meta = r["metadata"] or {}
            if not isinstance(meta, dict):
                continue
            court_ids.update(_coerce_uuid_strs(meta.get(k) for k in COURT_KEYS))
            user_ids.update(_coerce_uuid_strs(meta.get(k) for k in USER_KEYS))

        courts_by_id: dict[str, str] = {}
        users_by_id: dict[str, str] = {}

        if court_ids:
            cr = conn.execute(text("""
                SELECT id::text AS id, name
                FROM public.event_courts
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """), {"ids": list(court_ids)}).mappings().all()
            courts_by_id = {row["id"]: row["name"] for row in cr}

        if user_ids:
            ur_rows = conn.execute(text("""
                SELECT id::text AS id, full_name
                FROM public.users
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """), {"ids": list(user_ids)}).mappings().all()
            users_by_id = {row["id"]: row["full_name"] for row in ur_rows}

    # Armar respuesta y aplicar filtros post-SQL (category, include_system).
    items: list[dict] = []
    requested_cats = set(category) if category else None

    for r in rows:
        cat, is_system = _classify(r["action"])

        if not include_system and is_system:
            continue
        if requested_cats and cat not in requested_cats:
            continue

        meta = r["metadata"] or {}
        if not isinstance(meta, dict):
            meta = {}

        # Resolver context con nombres
        def name_of_court(key: str) -> str | None:
            cid = meta.get(key)
            return courts_by_id.get(str(cid)) if cid else None

        def name_of_user(key: str) -> str | None:
            uid = meta.get(key)
            return users_by_id.get(str(uid)) if uid else None

        # Para CREATE_COURT, UPDATE_COURT, DELETE_COURT: la metadata trae 'court_name' o 'name' directos
        court_name_fallback = meta.get("court_name") or meta.get("name")

        context = {
            "court_name": name_of_court("court_id") or court_name_fallback,
            "from_court_name": name_of_court("from_court_id"),
            "to_court_name": name_of_court("to_court_id"),
            "previous_status": meta.get("previous_status") or meta.get("previous"),
            "next_status": meta.get("next") or meta.get("next_status"),
            "captain_name": name_of_user("user_id") or name_of_user("captain_user_id"),
            "target_user_name": name_of_user("target_user_id") or name_of_user("user_id"),
            "reason": meta.get("reason"),
            "capacity": meta.get("capacity"),
            "expires_in_days": meta.get("expires_in_days"),
        }

        # Target (jugador afectado)
        target = None
        if r["target_registration_id"]:
            player_name = (
                r["target_user_name"]
                if r["target_reg_type"] == "USER"
                else r["target_guest_name"]
            )
            target = {
                "kind": "registration",
                "registration_id": str(r["target_registration_id"]),
                "registration_type": r["target_reg_type"],
                "player_name": player_name or "Jugador",
                "court_name": r["target_court_name"],
            }

        actor = None
        if r["actor_user_id"]:
            actor = {
                "id": str(r["actor_user_id"]),
                "name": r["actor_name"] or "Admin",
            }

        event_ref = None
        if r["event_id"]:
            event_ref = {
                "id": str(r["event_id"]),
                "title": r["event_title"] or "Evento",
            }

        items.append({
            "id": str(r["id"]),
            "action": r["action"],
            "category": cat,
            "is_system": is_system,
            "created_at": str(r["created_at"]),
            "actor": actor,
            "event": event_ref,
            "target": target,
            "context": context,
            "metadata": meta,
        })

        if len(items) >= limit:
            break

    has_more = len(items) >= limit and len(rows) >= params["sql_limit"]

    return {
        "items": items,
        "has_more": has_more,
        "limit": limit,
        "offset": offset,
    }


@router.get("/audit/actors")
def get_audit_actors(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Lista los admins que emitieron al menos un log (para el typeahead del filtro).
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        rows = conn.execute(text("""
            SELECT DISTINCT eal.actor_user_id::text AS id, u.full_name AS name
            FROM public.event_audit_log eal
            JOIN public.users u ON u.id = eal.actor_user_id
            ORDER BY u.full_name ASC
            LIMIT 200
        """)).mappings().all()

    return {"items": [{"id": r["id"], "name": r["name"]} for r in rows]}
