import secrets
from fastapi import APIRouter, HTTPException, Header
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine
from app.schemas import PinRegisterRequest, PinLoginRequest
from app.utils.security import hash_pin, assert_pin
from app.utils.phone import normalize_phone

router = APIRouter()


@router.post("/auth/pin/register")
def pin_register(body: PinRegisterRequest):
    """
    Registra un nuevo usuario con PIN.
    """
    phone_e164 = normalize_phone(body.phone)
    pin = assert_pin(body.pin)
    full_name = body.full_name.strip()

    if not phone_e164:
        raise HTTPException(status_code=400, detail="Teléfono inválido.")

    salt_hex = secrets.token_hex(16)
    pin_hash = hash_pin(pin, salt_hex)

    with engine.begin() as conn:
        exists = conn.execute(text("""
            select 1 from public.users where phone_login = :p limit 1
        """), {"p": phone_e164}).first()

        if exists:
            raise HTTPException(status_code=409, detail="Ya existe un usuario con ese teléfono.")

        user = conn.execute(text("""
            insert into public.users (
                full_name,
                phone_e164,
                phone_login,
                is_active,
                pin_salt,
                pin_hash,
                created_at,
                updated_at
            )
            values (
                :full_name,
                :phone_e164,
                :phone_login,
                true,
                :pin_salt,
                :pin_hash,
                now(),
                now()
            )
            returning id, full_name, phone_e164
        """), {
            "full_name": full_name,
            "phone_e164": phone_e164,
            "phone_login": phone_e164,
            "pin_salt": salt_hex,
            "pin_hash": pin_hash,
        }).mappings().first()

        roles_rows = conn.execute(text("""
            select r.code
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = :id
        """), {"id": user["id"]}).mappings().all()

        roles = [r["code"] for r in roles_rows] if roles_rows else []
        is_admin = any(x.lower() in ("admin", "super_admin") for x in roles)

        return {
            "actor_user_id": str(user["id"]),
            "me": {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "phone_e164": user["phone_e164"],
                "roles": roles,
                "is_admin": is_admin,
            }
        }


@router.post("/auth/pin/login")
def pin_login(body: PinLoginRequest):
    """
    Login con teléfono y PIN.
    """
    phone_login = normalize_phone(body.phone)
    pin = assert_pin(body.pin)

    with engine.connect() as conn:
        user = conn.execute(text("""
            select id, full_name, is_active, pin_salt, pin_hash
            from public.users
            where phone_login = :p
            limit 1
        """), {"p": phone_login}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Usuario inactivo.")

        if not user["pin_salt"] or not user["pin_hash"]:
            raise HTTPException(status_code=400, detail="El usuario no tiene PIN configurado.")

        calc = hash_pin(pin, user["pin_salt"])
        if calc != user["pin_hash"]:
            raise HTTPException(status_code=401, detail="PIN incorrecto.")

        roles_rows = conn.execute(text("""
            select r.code
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = :id
        """), {"id": user["id"]}).mappings().all()

        roles = [r["code"] for r in roles_rows] if roles_rows else []
        is_admin = any(x.lower() in ("admin", "super_admin") for x in roles)

        return {
            "actor_user_id": str(user["id"]),
            "me": {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "roles": roles,
                "is_admin": is_admin,
            }
        }


@router.get("/auth/me")
def auth_me(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Devuelve info básica del usuario autenticado.
    """
    with engine.connect() as conn:
        user = conn.execute(text("""
            select id, full_name
            from public.users
            where id = :id
            limit 1
        """), {"id": actor_user_id}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Actor no existe en users")

        roles = conn.execute(text("""
            select r.code
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = :id
        """), {"id": actor_user_id}).mappings().all()

        return {
            "id": str(user["id"]),
            "full_name": user["full_name"],
            "roles": [r["code"] for r in roles],
            "is_admin": any(r["code"].lower() in ("admin", "super_admin") for r in roles),
        }


@router.get("/me")
def me(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Valida el Actor ID contra la DB y devuelve identidad + roles.
    """
    with engine.connect() as conn:
        user = conn.execute(text("""
            select id, full_name, email, is_active
            from public.users
            where id = :id
            limit 1
        """), {"id": actor_user_id}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Actor ID inválido (usuario no existe).")

        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Usuario inactivo.")

        roles_rows = conn.execute(text("""
            select r.code
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = :id
        """), {"id": actor_user_id}).mappings().all()

        roles = [r["code"] for r in roles_rows] if roles_rows else []
        is_admin = any(x.lower() in ("admin", "super_admin") for x in roles)

        return {
            "user": {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "email": user["email"],
            },
            "roles": roles,
            "is_admin": is_admin,
        }
