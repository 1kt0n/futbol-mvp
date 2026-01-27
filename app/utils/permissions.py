from fastapi import HTTPException
from sqlalchemy import text


def require_admin(conn, actor_user_id: str) -> None:
    """
    Valida que el actor sea admin o super_admin.
    Lanza HTTPException 403 si no tiene permisos.
    """
    is_admin = conn.execute(text("""
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :actor_user_id
          AND LOWER(r.code) IN ('admin', 'super_admin')
        LIMIT 1
    """), {"actor_user_id": actor_user_id}).first()

    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Acceso denegado. Requiere rol admin o super_admin."
        )


def require_captain_of_court(conn, event_id: str, court_id: str, actor_user_id: str) -> bool:
    """
    Valida que el actor sea capitán de la cancha específica.
    Retorna True si es capitán, False si no.
    """
    is_captain = conn.execute(text("""
        SELECT 1
        FROM public.event_court_captains ecc
        WHERE ecc.event_id = :event_id
          AND ecc.court_id = :court_id
          AND ecc.user_id = :actor_user_id
        LIMIT 1
    """), {
        "event_id": event_id,
        "court_id": court_id,
        "actor_user_id": actor_user_id
    }).first()

    return bool(is_captain)


def require_admin_or_captain(conn, event_id: str, court_id: str, actor_user_id: str) -> None:
    """
    Valida que el actor sea admin/super_admin O capitán de la cancha.
    Lanza HTTPException 403 si no cumple ninguna condición.
    """
    # Primero chequear admin
    is_admin = conn.execute(text("""
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :actor_user_id
          AND LOWER(r.code) IN ('admin', 'super_admin')
        LIMIT 1
    """), {"actor_user_id": actor_user_id}).first()

    if is_admin:
        return

    # Luego chequear capitán de cancha
    if require_captain_of_court(conn, event_id, court_id, actor_user_id):
        return

    raise HTTPException(
        status_code=403,
        detail="No tenés permisos para esta cancha. Requiere ser admin o capitán asignado."
    )
