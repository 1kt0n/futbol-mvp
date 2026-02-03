import secrets
import re
import io
from fastapi import APIRouter, HTTPException, Header, UploadFile, File
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from PIL import Image

from app.settings import engine, supabase_client, AVATAR_BUCKET, AVATAR_MAX_SIZE, SUPABASE_URL
from app.schemas import PinRegisterRequest, PinLoginRequest, UpdateProfileRequest
from app.utils.security import hash_pin, assert_pin
from app.utils.phone import normalize_phone

router = APIRouter()


def validate_email(email: str) -> bool:
    """Validación básica de email."""
    if not email:
        return True
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


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
            select id, full_name, email, phone_e164, nickname, avatar_url, is_active
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
                "phone": user["phone_e164"],
                "nickname": user["nickname"],
                "avatar_url": user["avatar_url"],
            },
            "roles": roles,
            "is_admin": is_admin,
        }


@router.patch("/me")
def update_profile(
    body: UpdateProfileRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Actualiza datos del perfil del usuario autenticado.
    """
    # Validar email si se provee
    if body.email and not validate_email(body.email):
        raise HTTPException(status_code=400, detail="Email inválido.")

    # Construir campos a actualizar
    updates = []
    params = {"id": actor_user_id}

    if body.full_name is not None:
        updates.append("full_name = :full_name")
        params["full_name"] = body.full_name.strip()

    if body.nickname is not None:
        updates.append("nickname = :nickname")
        params["nickname"] = body.nickname.strip() if body.nickname else None

    if body.email is not None:
        updates.append("email = :email")
        params["email"] = body.email.strip().lower() if body.email else None

    if not updates:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar.")

    updates.append("updated_at = now()")

    with engine.begin() as conn:
        # Verificar que el usuario existe
        exists = conn.execute(text("""
            select 1 from public.users where id = :id
        """), {"id": actor_user_id}).first()

        if not exists:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        # Actualizar
        conn.execute(text(f"""
            update public.users
            set {", ".join(updates)}
            where id = :id
        """), params)

    # Devolver usuario actualizado
    return me(actor_user_id)


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Sube un avatar para el usuario. Convierte a WebP optimizado.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Servicio de storage no configurado.")

    # Validar tipo de archivo
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen.")

    # Leer y validar tamaño
    content = await file.read()
    if len(content) > AVATAR_MAX_SIZE:
        raise HTTPException(status_code=400, detail="La imagen excede el límite de 2MB.")

    try:
        # Abrir imagen y convertir a WebP
        img = Image.open(io.BytesIO(content))

        # Convertir a RGB si es necesario (para WebP)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Redimensionar si es muy grande (max 512x512)
        max_size = 512
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        # Guardar como WebP
        output = io.BytesIO()
        img.save(output, format="WEBP", quality=85)
        output.seek(0)
        webp_content = output.getvalue()

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error procesando imagen: {str(e)}")

    # Subir a Supabase Storage
    file_path = f"{actor_user_id}/avatar.webp"

    try:
        # Intentar eliminar el anterior si existe
        try:
            supabase_client.storage.from_(AVATAR_BUCKET).remove([file_path])
        except Exception:
            pass

        # Subir nuevo
        supabase_client.storage.from_(AVATAR_BUCKET).upload(
            file_path,
            webp_content,
            file_options={"content-type": "image/webp", "upsert": "true"}
        )

        # Construir URL pública
        avatar_url = f"{SUPABASE_URL}/storage/v1/object/public/{AVATAR_BUCKET}/{file_path}"

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error subiendo avatar: {str(e)}")

    # Guardar URL en DB
    with engine.begin() as conn:
        conn.execute(text("""
            update public.users
            set avatar_url = :avatar_url, updated_at = now()
            where id = :id
        """), {"avatar_url": avatar_url, "id": actor_user_id})

    return {"avatar_url": avatar_url, "message": "Avatar actualizado."}


@router.delete("/me/avatar")
def delete_avatar(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Elimina el avatar del usuario.
    """
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Servicio de storage no configurado.")

    file_path = f"{actor_user_id}/avatar.webp"

    try:
        supabase_client.storage.from_(AVATAR_BUCKET).remove([file_path])
    except Exception:
        pass  # Ignorar si no existe

    # Limpiar URL en DB
    with engine.begin() as conn:
        conn.execute(text("""
            update public.users
            set avatar_url = null, updated_at = now()
            where id = :id
        """), {"id": actor_user_id})

    return {"message": "Avatar eliminado."}
