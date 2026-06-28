import json
import secrets
from fastapi import APIRouter, HTTPException, Depends
from app.utils.deps import get_actor_user_id
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine
from app.schemas import CreateUserRequest, UpdateUserRequest, ResetPinRequest, UpdateUserRolesRequest
from app.utils.permissions import require_permission
from app.utils.security import hash_pin, assert_pin
from app.utils.phone import normalize_phone

router = APIRouter()


@router.get("/users")
def search_users(
    actor_user_id: str = Depends(get_actor_user_id),
    query: str | None = None,
    limit: int = 50
):
    """
    Busca usuarios por nombre o teléfono. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.view')

        # Construir WHERE dinámicamente
        where_clause = "WHERE 1=1"
        params = {"limit": limit}

        if query:
            query_pattern = f"%{query}%"
            where_clause = "WHERE (u.full_name ILIKE :query_pattern OR u.phone_e164 ILIKE :query_pattern)"
            params["query_pattern"] = query_pattern

        sql = f"""
            SELECT
                u.id,
                u.full_name,
                u.phone_e164,
                u.is_active,
                u.created_at,
                COALESCE(
                    ARRAY_AGG(r.code) FILTER (WHERE r.code IS NOT NULL),
                    '{{}}' ::text[]
                ) as roles
            FROM public.users u
            LEFT JOIN public.user_roles ur ON ur.user_id = u.id
            LEFT JOIN public.roles r ON r.id = ur.role_id
            {where_clause}
            GROUP BY u.id, u.full_name, u.phone_e164, u.is_active, u.created_at
            ORDER BY u.full_name
            LIMIT :limit
        """

        users = conn.execute(text(sql), params).mappings().all()

        return {
            "users": [
                {
                    "id": str(u["id"]),
                    "full_name": u["full_name"],
                    "phone_e164": u["phone_e164"],
                    "is_active": u["is_active"],
                    "roles": u["roles"],
                    "created_at": str(u["created_at"])
                }
                for u in users
            ],
            "count": len(users)
        }


@router.get("/users/{id}")
def get_user_detail(
    id: str,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Obtiene detalle completo de un usuario. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.view')

        user = conn.execute(text("""
            SELECT
                id, full_name, phone_e164, email, is_active, created_at, updated_at
            FROM public.users
            WHERE id = :id
        """), {"id": id}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        roles = conn.execute(text("""
            SELECT r.code
            FROM public.user_roles ur
            JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.user_id = :id
        """), {"id": id}).mappings().all()

        return {
            "id": str(user["id"]),
            "full_name": user["full_name"],
            "phone_e164": user["phone_e164"],
            "email": user["email"],
            "is_active": user["is_active"],
            "roles": [r["code"] for r in roles],
            "created_at": str(user["created_at"]),
            "updated_at": str(user["updated_at"])
        }


@router.post("/users")
def create_user(
    body: CreateUserRequest,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Crea un usuario manualmente. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.create')

    phone_e164 = normalize_phone(body.phone)
    if not phone_e164:
        raise HTTPException(status_code=400, detail="Teléfono inválido.")

    # Si hay PIN, validarlo y hashearlo
    pin_salt = None
    pin_hash_value = None
    if body.pin:
        pin = assert_pin(body.pin)
        pin_salt = secrets.token_hex(16)
        pin_hash_value = hash_pin(pin, pin_salt)

    with engine.begin() as conn:
        try:
            user = conn.execute(text("""
                INSERT INTO public.users (
                    full_name,
                    phone_e164,
                    phone_login,
                    email,
                    is_active,
                    pin_salt,
                    pin_hash,
                    created_at,
                    updated_at
                )
                VALUES (
                    :full_name,
                    :phone_e164,
                    :phone_login,
                    :email,
                    true,
                    :pin_salt,
                    :pin_hash,
                    now(),
                    now()
                )
                RETURNING id, full_name, phone_e164
            """), {
                "full_name": body.full_name.strip(),
                "phone_e164": phone_e164,
                "phone_login": phone_e164,
                "email": body.email,
                "pin_salt": pin_salt,
                "pin_hash": pin_hash_value
            }).mappings().first()

            # Asignar roles si se proporcionaron
            assigned_roles = []
            if body.roles:
                # Si se intenta asignar super_admin, verificar que el actor es super_admin
                if any(rc.lower() == "super_admin" for rc in body.roles):
                    actor_roles = conn.execute(text("""
                        SELECT r.code
                        FROM public.user_roles ur
                        JOIN public.roles r ON r.id = ur.role_id
                        WHERE ur.user_id = :actor_user_id
                    """), {"actor_user_id": actor_user_id}).mappings().all()
                    if "super_admin" not in [r["code"].lower() for r in actor_roles]:
                        raise HTTPException(
                            status_code=403,
                            detail="Solo un super_admin puede asignar el rol super_admin."
                        )

                for role_code in body.roles:
                    # Validar contra la tabla de roles (no una lista hardcodeada)
                    role = conn.execute(text("""
                        SELECT id FROM public.roles WHERE LOWER(code) = LOWER(:code)
                    """), {"code": role_code}).mappings().first()

                    if not role:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Rol inválido: {role_code}."
                        )

                    conn.execute(text("""
                        INSERT INTO public.user_roles (user_id, role_id, created_at)
                        VALUES (:user_id, :role_id, now())
                    """), {
                        "user_id": user["id"],
                        "role_id": role["id"]
                    })
                    assigned_roles.append(role_code)

            # Audit log
            conn.execute(text("""
                INSERT INTO public.event_audit_log (
                    event_id, actor_user_id, action, metadata
                )
                VALUES (
                    NULL, :actor_user_id, 'CREATE_USER_MANUAL',
                    jsonb_build_object('user_id', :user_id, 'roles', CAST(:roles AS jsonb))
                )
            """), {
                "actor_user_id": actor_user_id,
                "user_id": str(user["id"]),
                "roles": json.dumps(assigned_roles),
            })

            return {
                "user_id": str(user["id"]),
                "full_name": user["full_name"],
                "phone_e164": user["phone_e164"],
                "roles": assigned_roles,
                "message": "Usuario creado exitosamente."
            }
        except IntegrityError:
            raise HTTPException(
                status_code=409,
                detail="Ya existe un usuario con ese teléfono."
            )


@router.patch("/users/{id}")
def update_user(
    id: str,
    body: UpdateUserRequest,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Actualiza el estado de un usuario (activar/desactivar). Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.manage')

        user = conn.execute(text("""
            SELECT id FROM public.users WHERE id = :id
        """), {"id": id}).first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.users
            SET is_active = :is_active, updated_at = now()
            WHERE id = :id
        """), {
            "id": id,
            "is_active": body.is_active
        })

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                NULL, :actor_user_id, 'UPDATE_USER_STATUS',
                jsonb_build_object('user_id', :user_id, 'is_active', :is_active)
            )
        """), {
            "actor_user_id": actor_user_id,
            "user_id": str(id),
            "is_active": bool(body.is_active),
        })

    return {
        "user_id": id,
        "is_active": body.is_active,
        "message": f"Usuario {'activado' if body.is_active else 'desactivado'} exitosamente."
    }


@router.post("/users/{id}/pin")
def reset_user_pin(
    id: str,
    body: ResetPinRequest,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Resetea el PIN de un usuario. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.manage')

        user = conn.execute(text("""
            SELECT id, full_name FROM public.users WHERE id = :id
        """), {"id": id}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    # Validar y hashear nuevo PIN
    pin = assert_pin(body.pin)
    pin_salt = secrets.token_hex(16)
    pin_hash_value = hash_pin(pin, pin_salt)

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.users
            SET pin_salt = :pin_salt, pin_hash = :pin_hash, updated_at = now()
            WHERE id = :id
        """), {
            "id": id,
            "pin_salt": pin_salt,
            "pin_hash": pin_hash_value
        })

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                NULL, :actor_user_id, 'RESET_PIN',
                jsonb_build_object('user_id', :user_id)
            )
        """), {
            "actor_user_id": actor_user_id,
            "user_id": str(id),
        })

    return {
        "user_id": id,
        "message": f"PIN reseteado exitosamente para {user['full_name']}."
    }


@router.put("/users/{id}/roles")
def update_user_roles(
    id: str,
    body: UpdateUserRolesRequest,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Actualiza los roles de un usuario. Solo admin/super_admin.
    Para asignar super_admin, el actor debe ser super_admin.
    """
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, 'users.roles.assign')

        # Validar que el usuario existe
        user = conn.execute(text("""
            SELECT id FROM public.users WHERE id = :id
        """), {"id": id}).first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        # Validar que todos los roles existen en la tabla de roles
        for role_code in body.roles:
            exists = conn.execute(text("""
                SELECT 1 FROM public.roles WHERE LOWER(code) = LOWER(:code) LIMIT 1
            """), {"code": role_code}).first()
            if not exists:
                raise HTTPException(
                    status_code=400,
                    detail=f"Rol inválido: {role_code}."
                )

        # Si se intenta asignar super_admin, verificar que el actor es super_admin
        if "super_admin" in [r.lower() for r in body.roles]:
            actor_roles = conn.execute(text("""
                SELECT r.code
                FROM public.user_roles ur
                JOIN public.roles r ON r.id = ur.role_id
                WHERE ur.user_id = :actor_user_id
            """), {"actor_user_id": actor_user_id}).mappings().all()

            actor_role_codes = [r["code"].lower() for r in actor_roles]
            if "super_admin" not in actor_role_codes:
                raise HTTPException(
                    status_code=403,
                    detail="Solo un super_admin puede asignar el rol super_admin a otros usuarios."
                )

    with engine.begin() as conn:
        # Eliminar roles actuales
        conn.execute(text("""
            DELETE FROM public.user_roles WHERE user_id = :user_id
        """), {"user_id": id})

        # Insertar nuevos roles
        for role_code in body.roles:
            role = conn.execute(text("""
                SELECT id FROM public.roles WHERE LOWER(code) = LOWER(:code)
            """), {"code": role_code}).mappings().first()

            if role:
                conn.execute(text("""
                    INSERT INTO public.user_roles (user_id, role_id, created_at)
                    VALUES (:user_id, :role_id, now())
                """), {
                    "user_id": id,
                    "role_id": role["id"]
                })

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                NULL, :actor_user_id, 'UPDATE_USER_ROLES',
                jsonb_build_object('user_id', :user_id, 'roles', CAST(:roles AS jsonb))
            )
        """), {
            "actor_user_id": actor_user_id,
            "user_id": str(id),
            "roles": json.dumps(list(body.roles)),
        })

    return {
        "user_id": id,
        "roles": body.roles,
        "message": "Roles actualizados exitosamente."
    }


# ============================================================
# Solicitudes de desbloqueo de PIN (buzón de administradores)
# ============================================================

@router.get("/unlock-requests")
def list_unlock_requests(actor_user_id: str = Depends(get_actor_user_id)):
    """Lista las solicitudes de desbloqueo PENDIENTES con datos del usuario."""
    with engine.connect() as conn:
        require_permission(conn, actor_user_id, "users.unlock")
        rows = conn.execute(text("""
            SELECT r.id, r.created_at, u.id AS user_id, u.full_name, u.phone_e164
            FROM public.pin_unlock_requests r
            JOIN public.users u ON u.id = r.user_id
            WHERE r.status = 'PENDING'
            ORDER BY r.created_at ASC
        """)).mappings().all()

    return {
        "requests": [
            {
                "id": str(x["id"]),
                "user_id": str(x["user_id"]),
                "full_name": x["full_name"],
                "phone": x["phone_e164"],
                "created_at": x["created_at"].isoformat() if x["created_at"] else None,
            }
            for x in rows
        ]
    }


@router.post("/unlock-requests/{request_id}/approve")
def approve_unlock_request(request_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Aprueba: el usuario podrá definir un PIN nuevo en su próximo ingreso."""
    with engine.begin() as conn:
        require_permission(conn, actor_user_id, "users.unlock")

        req = conn.execute(text("""
            SELECT id, user_id FROM public.pin_unlock_requests
            WHERE id = :id AND status = 'PENDING'
            FOR UPDATE
        """), {"id": request_id}).mappings().first()
        if not req:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada o ya resuelta.")

        conn.execute(text("""
            UPDATE public.users
            SET must_reset_pin = true, failed_pin_attempts = 0, locked_until = null, updated_at = now()
            WHERE id = :uid
        """), {"uid": req["user_id"]})

        conn.execute(text("""
            UPDATE public.pin_unlock_requests
            SET status = 'APPROVED', resolved_at = now(), resolved_by_user_id = :actor
            WHERE id = :id
        """), {"id": request_id, "actor": actor_user_id})

        conn.execute(text("""
            INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
            VALUES (NULL, :actor, 'APPROVE_PIN_UNLOCK',
                    jsonb_build_object('request_id', :id, 'user_id', :uid))
        """), {"actor": actor_user_id, "id": request_id, "uid": str(req["user_id"])})

    return {"message": "Desbloqueo aprobado. El usuario podrá definir un PIN nuevo."}


@router.post("/unlock-requests/{request_id}/deny")
def deny_unlock_request(request_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Rechaza la solicitud de desbloqueo."""
    with engine.begin() as conn:
        require_permission(conn, actor_user_id, "users.unlock")

        req = conn.execute(text("""
            SELECT id, user_id FROM public.pin_unlock_requests
            WHERE id = :id AND status = 'PENDING'
            FOR UPDATE
        """), {"id": request_id}).mappings().first()
        if not req:
            raise HTTPException(status_code=404, detail="Solicitud no encontrada o ya resuelta.")

        conn.execute(text("""
            UPDATE public.pin_unlock_requests
            SET status = 'DENIED', resolved_at = now(), resolved_by_user_id = :actor
            WHERE id = :id
        """), {"id": request_id, "actor": actor_user_id})

        conn.execute(text("""
            INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
            VALUES (NULL, :actor, 'DENY_PIN_UNLOCK',
                    jsonb_build_object('request_id', :id, 'user_id', :uid))
        """), {"actor": actor_user_id, "id": request_id, "uid": str(req["user_id"])})

    return {"message": "Solicitud rechazada."}
