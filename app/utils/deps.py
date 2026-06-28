"""
Dependencias compartidas de FastAPI.

`get_actor_user_id` reemplaza al viejo patrón:
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
que confiaba ciegamente en el UUID enviado por el cliente. Ahora el header debe
contener un token firmado (emitido en el login); se verifica y se devuelve el
user_id real. Un UUID crudo (lo que mandaba el atacante) ya no valida → 401.
"""
from fastapi import Header, HTTPException

from app.utils.auth_token import verify_token


def get_actor_user_id(
    x_actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
) -> str:
    user_id = verify_token(x_actor_user_id)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada. Volvé a iniciar sesión.")
    return user_id
