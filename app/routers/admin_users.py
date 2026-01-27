import secrets
from fastapi import APIRouter, HTTPException, Header
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine
from app.schemas import CreateUserRequest, UpdateUserRequest, ResetPinRequest, UpdateUserRolesRequest
from app.utils.permissions import require_admin
from app.utils.security import hash_pin, assert_pin
from app.utils.phone import normalize_phone

router = APIRouter()


@router.get("/users")
def search_users(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    query: str | None = None,
    limit: int = 50
):
    """
    Busca usuarios por nombre o teléfono. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

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
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Obtiene detalle completo de un usuario. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

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
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Crea un usuario manualmente. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

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
                valid_roles = ["admin", "super_admin"]
                for role_code in body.roles:
                    if role_code.lower() not in valid_roles:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Rol inválido: {role_code}. Los roles válidos son: admin, super_admin"
                        )

                    # Si se intenta asignar super_admin, verificar que el actor es super_admin
                    if role_code.lower() == "super_admin":
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
                                detail="Solo un super_admin puede asignar el rol super_admin."
                            )

                    role = conn.execute(text("""
                        SELECT id FROM public.roles WHERE LOWER(code) = LOWER(:code)
                    """), {"code": role_code}).mappings().first()

                    if role:
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
                    NULL, :actor_user_id, 'CREATE_USER_MANUAL', CAST(:metadata AS jsonb)
                )
            """), {
                "actor_user_id": actor_user_id,
                "metadata": f'{{"user_id": "{user["id"]}", "roles": {assigned_roles}}}'.replace("'", '"')
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
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Actualiza el estado de un usuario (activar/desactivar). Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

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
                NULL, :actor_user_id, 'UPDATE_USER_STATUS', CAST(:metadata AS jsonb)
            )
        """), {
            "actor_user_id": actor_user_id,
            "metadata": f'{{"user_id": "{id}", "is_active": {str(body.is_active).lower()}}}'
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
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Resetea el PIN de un usuario. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

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
                NULL, :actor_user_id, 'RESET_PIN', CAST(:metadata AS jsonb)
            )
        """), {
            "actor_user_id": actor_user_id,
            "metadata": f'{{"user_id": "{id}"}}'
        })

    return {
        "user_id": id,
        "message": f"PIN reseteado exitosamente para {user['full_name']}."
    }


@router.put("/users/{id}/roles")
def update_user_roles(
    id: str,
    body: UpdateUserRolesRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Actualiza los roles de un usuario. Solo admin/super_admin.
    Para asignar super_admin, el actor debe ser super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Validar que el usuario existe
        user = conn.execute(text("""
            SELECT id FROM public.users WHERE id = :id
        """), {"id": id}).first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        # Validar que todos los roles existen
        valid_roles = ["admin", "super_admin"]
        for role_code in body.roles:
            if role_code.lower() not in valid_roles:
                raise HTTPException(
                    status_code=400,
                    detail=f"Rol inválido: {role_code}. Los roles válidos son: admin, super_admin"
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
                NULL, :actor_user_id, 'UPDATE_USER_ROLES', CAST(:metadata AS jsonb)
            )
        """), {
            "actor_user_id": actor_user_id,
            "metadata": f'{{"user_id": "{id}", "roles": {body.roles}}}'.replace("'", '"')
        })

    return {
        "user_id": id,
        "roles": body.roles,
        "message": "Roles actualizados exitosamente."
    }
