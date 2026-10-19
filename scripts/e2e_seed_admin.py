"""
Crea (o deja al día) un admin con teléfono y PIN para los e2e de Playwright, SOLO en una base local.

Los specs (futbol-mvp-web/e2e/*.spec.ts) entran por la pantalla de login con
E2E_ADMIN_PHONE / E2E_ADMIN_PIN; este script deja ese usuario listo: activo, sin
bloqueos, con el PIN hasheado igual que el backend (app/utils/security.py) y con los
roles admin y super_admin (Roles y Permisos pide roles.manage).

También deja una solicitud de cuenta pendiente ("Solicitud E2E", teléfono +5491100000098)
para que e2e/overlays.spec.ts pueda abrir el diálogo de rechazo (lo abre y lo cancela), y
un jugador sin permisos ("Jugador E2E") para e2e/match.spec.ts (pantalla del partido, 1a).

Valores de prueba por defecto (no son de nadie, solo existen en la base local):
  E2E_ADMIN_PHONE=1100000099   (se guarda normalizado como +5491100000099)
  E2E_ADMIN_PIN=4826
  E2E_PLAYER_PHONE=1100000097  (+5491100000097)
  E2E_PLAYER_PIN=7351

Uso:
  DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test \\
    ./.venv/bin/python scripts/e2e_seed_admin.py

Se niega a correr si DATABASE_URL no apunta a 127.0.0.1 o localhost.
"""
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.utils.phone import normalize_phone  # noqa: E402
from app.utils.security import assert_pin, hash_pin  # noqa: E402

DEFAULT_PHONE = "1100000099"
DEFAULT_PIN = "4826"
PENDING_PHONE = "+5491100000098"
DEFAULT_PLAYER_PHONE = "1100000097"
DEFAULT_PLAYER_PIN = "7351"


def main() -> None:
    raw_url = os.environ.get("DATABASE_URL", "").strip()
    if not raw_url:
        sys.exit("Falta DATABASE_URL (una base local, p. ej. postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test).")
    for prefix in ("postgres://", "postgresql://"):
        if raw_url.startswith(prefix):
            raw_url = "postgresql+psycopg://" + raw_url[len(prefix):]
    url = make_url(raw_url)
    if url.host not in ("127.0.0.1", "localhost"):
        sys.exit(f"DATABASE_URL apunta a {url.host!r}: este script solo corre contra una base local.")

    phone = normalize_phone(os.environ.get("E2E_ADMIN_PHONE", DEFAULT_PHONE))
    if not phone:
        sys.exit("E2E_ADMIN_PHONE no es un teléfono válido.")
    pin = assert_pin(os.environ.get("E2E_ADMIN_PIN", DEFAULT_PIN))
    salt = secrets.token_hex(16)
    pin_hash = hash_pin(pin, salt)

    player_phone = normalize_phone(os.environ.get("E2E_PLAYER_PHONE", DEFAULT_PLAYER_PHONE))
    if not player_phone:
        sys.exit("E2E_PLAYER_PHONE no es un teléfono válido.")
    player_pin = assert_pin(os.environ.get("E2E_PLAYER_PIN", DEFAULT_PLAYER_PIN))
    player_salt = secrets.token_hex(16)

    engine = create_engine(url)
    with engine.begin() as conn:
        user_id = conn.execute(
            text(
                """
                insert into public.users (full_name, phone_e164, phone_login, pin_salt, pin_hash, is_active, status)
                values ('Admin E2E', :phone, :phone, :salt, :hash, true, 'ACTIVE')
                on conflict (phone_login) do update
                   set pin_salt = excluded.pin_salt,
                       pin_hash = excluded.pin_hash,
                       is_active = true,
                       status = 'ACTIVE',
                       must_reset_pin = false,
                       failed_pin_attempts = 0,
                       locked_until = null,
                       updated_at = now()
                returning id
                """
            ),
            {"phone": phone, "salt": salt, "hash": pin_hash},
        ).scalar_one()
        conn.execute(
            text(
                """
                insert into public.user_roles (user_id, role_id)
                select :uid, id from public.roles where code in ('admin', 'super_admin')
                on conflict do nothing
                """
            ),
            {"uid": user_id},
        )
        conn.execute(
            text(
                """
                insert into public.users (full_name, phone_e164, phone_login, is_active, status)
                values ('Solicitud E2E', :phone, :phone, true, 'PENDING')
                on conflict (phone_login) do update set status = 'PENDING', updated_at = now()
                """
            ),
            {"phone": PENDING_PHONE},
        )
        player_id = conn.execute(
            text(
                """
                insert into public.users (full_name, phone_e164, phone_login, pin_salt, pin_hash, is_active, status)
                values ('Jugador E2E', :phone, :phone, :salt, :hash, true, 'ACTIVE')
                on conflict (phone_login) do update
                   set pin_salt = excluded.pin_salt,
                       pin_hash = excluded.pin_hash,
                       is_active = true,
                       status = 'ACTIVE',
                       must_reset_pin = false,
                       failed_pin_attempts = 0,
                       locked_until = null,
                       updated_at = now()
                returning id
                """
            ),
            {"phone": player_phone, "salt": player_salt, "hash": hash_pin(player_pin, player_salt)},
        ).scalar_one()
        # Sin roles: tiene que ver la pantalla como un jugador cualquiera.
        conn.execute(text("delete from public.user_roles where user_id = :uid"), {"uid": player_id})
    print(f"Admin E2E listo en {url.host}:{url.port}/{url.database} (teléfono {phone}).")
    print(f"Jugador E2E listo (teléfono {player_phone}).")


if __name__ == "__main__":
    main()
