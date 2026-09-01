"""
Dependencias compartidas de FastAPI.

`get_actor_user_id` reemplaza al viejo patrón:
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
que confiaba ciegamente en el UUID enviado por el cliente. Ahora el header debe
contener un token firmado (emitido en el login); se verifica y se devuelve el
user_id real. Un UUID crudo (lo que mandaba el atacante) ya no valida → 401.

Con ACCOUNT_APPROVAL_ENABLED, además revalida el estado de la cuenta en cada
request: así suspender/rechazar revoca la sesión al instante (los tokens son
stateless) y se cierra el hueco donde un usuario desactivado con token viejo
seguía operando en endpoints que no chequean is_active. Con el flag apagado, el
comportamiento es idéntico al anterior (solo verificación del token, sin DB).
"""
from fastapi import Header, HTTPException
from sqlalchemy import text

from app.settings import engine, ACCOUNT_APPROVAL_ENABLED
from app.utils.auth_token import verify_token


def get_actor_user_id(
    x_actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
) -> str:
    user_id = verify_token(x_actor_user_id)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada. Volvé a iniciar sesión.")

    if ACCOUNT_APPROVAL_ENABLED:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT is_active, status FROM public.users WHERE id = :id LIMIT 1"
            ), {"id": user_id}).mappings().first()
        # Bloquear si la cuenta no existe, está desactivada, o su estado no es ACTIVE.
        if (not row
                or row["is_active"] is False
                or (row["status"] and row["status"] != "ACTIVE")):
            raise HTTPException(status_code=401, detail="Tu sesión ya no es válida. Volvé a iniciar sesión.")

    return user_id
