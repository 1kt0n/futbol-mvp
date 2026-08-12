"""
Gestion de roles y permisos (RBAC) para el panel admin.

Todos los endpoints requieren el permiso 'roles.manage' (de hecho, solo super_admin
lo tiene por defecto). Permite ver el catalogo de permisos, listar roles con sus
permisos, y crear/editar/eliminar roles. Los roles de sistema (admin, super_admin)
no se pueden editar ni borrar.
"""

import logging

from fastapi import APIRouter, HTTPException, Depends
from app.utils.deps import get_actor_user_id
from sqlalchemy import text

from app.settings import engine
from app.schemas import CreateRoleRequest, UpdateRoleRequest
from app.utils.permissions import require_permission

router = APIRouter()
logger = logging.getLogger(__name__)


def _audit(conn, actor_user_id: str, action: str, metadata_sql: str, params: dict) -> None:
    """Inserta un registro de auditoria (best-effort dentro de la misma transaccion)."""
    conn.execute(text(f"""
        INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
        VALUES (NULL, :actor_user_id, :action, {metadata_sql})
    """), {"actor_user_id": actor_user_id, "action": action, **params})


@router.get("/permissions")
def list_permissions(actor_user_id: str = Depends(get_actor_user_id)):
    """Catalogo de permisos disponibles, agrupado por categoria."""
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "roles.manage")
        rows = conn.execute(text("""
            SELECT code, category, description
            FROM public.permissions
            ORDER BY category, code
        """)).mappings().all()

    grouped: dict[str, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["category"], []).append({
            "code": r["code"],
            "description": r["description"],
        })
    return {
        "categories": [{"category": cat, "permissions": perms} for cat, perms in grouped.items()],
        "all_codes": [r["code"] for r in rows],
    }


@router.get("/roles")
def list_roles(actor_user_id: str = Depends(get_actor_user_id)):
    """Lista los roles con sus permisos. super_admin se reporta como comodin (todos)."""
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "roles.manage")

        roles = conn.execute(text("""
            SELECT id::text AS id, code, name, description, is_system
            FROM public.roles
            ORDER BY is_system DESC, name ASC
        """)).mappings().all()

        perms_by_role = conn.execute(text("""
            SELECT rp.role_id::text AS role_id, p.code
            FROM public.role_permissions rp
            JOIN public.permissions p ON p.id = rp.permission_id
        """)).mappings().all()

        all_codes = [r["code"] for r in conn.execute(text(
            "SELECT code FROM public.permissions ORDER BY code"
        )).mappings().all()]

    role_perms: dict[str, list[str]] = {}
    for r in perms_by_role:
        role_perms.setdefault(r["role_id"], []).append(r["code"])

    items = []
    for r in roles:
        is_wildcard = r["code"].lower() == "super_admin"
        items.append({
            "id": r["id"],
            "code": r["code"],
            "name": r["name"] or r["code"],
            "description": r["description"],
            "is_system": r["is_system"],
            "is_wildcard": is_wildcard,
            "permissions": all_codes if is_wildcard else sorted(role_perms.get(r["id"], [])),
        })
    return {"items": items}


def _set_role_permissions(conn, role_id: str, permission_codes: list[str]) -> None:
    """
    Reemplaza el set de permisos de un rol. Valida que los codigos existan.
    Se compara role_id como texto para ser agnostico al tipo de roles.id (smallint).
    """
    conn.execute(text("DELETE FROM public.role_permissions WHERE role_id::text = :rid"), {"rid": role_id})
    codes = list(set(permission_codes))
    if not codes:
        return
    inserted = conn.execute(text("""
        INSERT INTO public.role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM public.roles r
        CROSS JOIN public.permissions p
        WHERE r.id::text = :rid
          AND p.code = ANY(CAST(:codes AS text[]))
        RETURNING permission_id
    """), {"rid": role_id, "codes": codes}).fetchall()
    if len(inserted) != len(codes):
        raise HTTPException(status_code=400, detail="Uno o mas codigos de permiso no existen.")


@router.post("/roles")
def create_role(body: CreateRoleRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Crea un rol nuevo con su set de permisos."""
    code = body.code.strip().lower().replace(" ", "_")
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "roles.manage")

    with engine.begin() as conn:
        exists = conn.execute(text(
            "SELECT 1 FROM public.roles WHERE LOWER(code) = :code LIMIT 1"
        ), {"code": code}).first()
        if exists:
            raise HTTPException(status_code=409, detail=f"Ya existe un rol con el codigo '{code}'.")

        role = conn.execute(text("""
            INSERT INTO public.roles (code, name, description, is_system)
            VALUES (:code, :name, :description, false)
            RETURNING id::text AS id
        """), {"code": code, "name": body.name.strip(), "description": body.description}).mappings().first()

        _set_role_permissions(conn, role["id"], body.permissions)
        _audit(conn, actor_user_id, "CREATE_ROLE",
               "jsonb_build_object('role_id', CAST(:role_id AS text), 'code', CAST(:code AS text))",
               {"role_id": role["id"], "code": code})

    return {"id": role["id"], "code": code, "message": "Rol creado."}


@router.patch("/roles/{role_id}")
def update_role(role_id: str, body: UpdateRoleRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Actualiza nombre/descripcion y, si se envia, el set de permisos. Bloquea roles de sistema."""
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "roles.manage")

    with engine.begin() as conn:
        role = conn.execute(text(
            "SELECT id::text AS id, is_system FROM public.roles WHERE id::text = :id"
        ), {"id": role_id}).mappings().first()
        if not role:
            raise HTTPException(status_code=404, detail="Rol no encontrado.")
        if role["is_system"]:
            raise HTTPException(status_code=403, detail="Los roles de sistema no se pueden editar.")

        if body.name is not None or body.description is not None:
            conn.execute(text("""
                UPDATE public.roles
                SET name = COALESCE(:name, name),
                    description = COALESCE(:description, description)
                WHERE id::text = :id
            """), {"id": role_id, "name": body.name, "description": body.description})

        if body.permissions is not None:
            _set_role_permissions(conn, role_id, body.permissions)

        _audit(conn, actor_user_id, "UPDATE_ROLE",
               "jsonb_build_object('role_id', CAST(:role_id AS text))", {"role_id": role_id})

    return {"id": role_id, "message": "Rol actualizado."}


@router.delete("/roles/{role_id}")
def delete_role(role_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Elimina un rol (y sus asignaciones). Bloquea roles de sistema."""
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "roles.manage")

    with engine.begin() as conn:
        role = conn.execute(text(
            "SELECT code, is_system FROM public.roles WHERE id::text = :id"
        ), {"id": role_id}).mappings().first()
        if not role:
            raise HTTPException(status_code=404, detail="Rol no encontrado.")
        if role["is_system"]:
            raise HTTPException(status_code=403, detail="Los roles de sistema no se pueden eliminar.")

        # role_permissions se limpia por ON DELETE CASCADE; las asignaciones a
        # usuarios se borran explicitamente.
        conn.execute(text("DELETE FROM public.user_roles WHERE role_id::text = :id"), {"id": role_id})
        conn.execute(text("DELETE FROM public.roles WHERE id::text = :id"), {"id": role_id})

        _audit(conn, actor_user_id, "DELETE_ROLE",
               "jsonb_build_object('role_id', CAST(:role_id AS text), 'code', CAST(:code AS text))",
               {"role_id": role_id, "code": role["code"]})

    return {"id": role_id, "message": "Rol eliminado."}
