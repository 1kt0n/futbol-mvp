from fastapi import HTTPException
from sqlalchemy import text


def is_super_admin(conn, actor_user_id: str) -> bool:
    """True si el actor tiene el rol super_admin (comodin: tiene todos los permisos)."""
    row = conn.execute(text("""
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :actor_user_id
          AND LOWER(r.code) = 'super_admin'
        LIMIT 1
    """), {"actor_user_id": actor_user_id}).first()
    return bool(row)


def get_effective_permissions(conn, actor_user_id: str) -> set[str]:
    """
    Devuelve el set de codigos de permiso efectivos del actor (union de sus roles).
    super_admin -> {'*'} (comodin: tiene todo, incluso permisos que se agreguen luego).
    """
    if is_super_admin(conn, actor_user_id):
        return {"*"}

    rows = conn.execute(text("""
        SELECT DISTINCT p.code
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = :actor_user_id
    """), {"actor_user_id": actor_user_id}).mappings().all()
    return {r["code"] for r in rows}


def require_permission(conn, actor_user_id: str, permission_code: str) -> None:
    """
    Valida que el actor tenga el permiso indicado (via alguno de sus roles) o sea super_admin.
    Lanza HTTPException 403 si no lo tiene.
    """
    if is_super_admin(conn, actor_user_id):
        return

    has_perm = conn.execute(text("""
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = :actor_user_id
          AND p.code = :permission_code
        LIMIT 1
    """), {"actor_user_id": actor_user_id, "permission_code": permission_code}).first()

    if not has_perm:
        raise HTTPException(
            status_code=403,
            detail=f"Acceso denegado. Requiere el permiso '{permission_code}'."
        )


def require_admin(conn, actor_user_id: str) -> None:
    """
    [Compat] Valida que el actor sea admin o super_admin.
    Preferir require_permission con un permiso especifico para nuevos endpoints.
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
