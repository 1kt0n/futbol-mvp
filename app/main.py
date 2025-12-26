import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
import re
import secrets
import hashlib
import hmac
from datetime import datetime, timezone, timedelta

from fastapi import Depends
from typing import List, Optional


load_dotenv()

# ✅ UNA sola instancia
app = FastAPI(title="Futbol MVP API")

# ✅ CORS sobre ESTE app (el real)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://192.168.0.57:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ DB UNA sola vez
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL no está definida en el .env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# =========================
# Marca de agua / Health
# =========================

@app.get("/__whoami")
def whoami():
    return {"whoami": "app/main.py v2025-12-12 cors-fix"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/db-check")
def db_check():
    try:
        with engine.connect() as conn:
            res = conn.execute(text("select now() as now")).mappings().first()
        return {"db": "ok", "now": str(res["now"])}
    except SQLAlchemyError as e:
        return {"db": "error", "detail": str(e)}

@app.get("/auth/me")
def auth_me(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
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
            "is_admin": any(r["code"] in ("admin", "super_admin") for r in roles),
        }

@app.get("/me")
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
        is_admin = any(x in ("admin", "super_admin") for x in roles)

        return {
            "user": {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "email": user["email"],
            },
            "roles": roles,
            "is_admin": is_admin,
        }



# =========================
# Models (Requests)
# =========================

class RegisterRequest(BaseModel):
    court_id: str = Field(..., description="UUID de la cancha elegida")

class GuestRequest(BaseModel):
    guest_name: str = Field(..., min_length=2, max_length=60)
    court_id: str = Field(..., description="UUID de la cancha elegida")

class MoveRequest(BaseModel):
    to_court_id: str = Field(..., description="UUID de la cancha destino")

class PinRegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=120)
    phone: str = Field(..., min_length=6, max_length=30)
    pin: str = Field(..., min_length=4, max_length=6)

class PinLoginRequest(BaseModel):
    phone: str = Field(..., min_length=6, max_length=30)
    pin: str = Field(..., min_length=4, max_length=6)


# =========================
# Helpers
# =========================

def assert_can_move(conn, event_id: str, actor_user_id: str):
    is_admin = conn.execute(text("""
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = :actor_user_id
          and r.code in ('admin', 'super_admin')
        limit 1
    """), {"actor_user_id": actor_user_id}).first()

    if is_admin:
        return

    is_captain = conn.execute(text("""
        select 1
        from public.event_captains ec
        where ec.event_id = :event_id
          and ec.user_id = :actor_user_id
        limit 1
    """), {"event_id": event_id, "actor_user_id": actor_user_id}).first()

    if is_captain:
        return

    raise HTTPException(
        status_code=403,
        detail="No tenés permisos para realizar esta acción (solo Admin o Capitán del evento)."
    )


def normalize_phone(raw: str) -> str:
    """
    MVP: normaliza a formato tipo +54911....
    - saca espacios/guiones
    - si empieza con 00 -> lo convierte a +
    - si arranca con 549... -> +549...
    - si arranca con 54... -> +54...
    - si arranca con 11... -> +54911...
    """
    if raw is None:
        return ""

    s = raw.strip()
    if s.startswith("00"):
        s = "+" + s[2:]

    # dejamos solo + y dígitos
    s = re.sub(r"[^\d+]", "", s)

    if s.startswith("+"):
        out = s
    else:
        digits = re.sub(r"\D", "", s)
        if digits.startswith("549"):
            out = "+" + digits
        elif digits.startswith("54"):
            out = "+" + digits
        elif digits.startswith("11"):
            out = "+549" + digits
        else:
            out = "+" + digits

    # guard-rails mínimos
    digits_only = re.sub(r"\D", "", out)
    if len(digits_only) < 8:   # demasiado corto => inválido
        return ""
    return out

def hash_pin(pin: str, salt_hex: str) -> str:
    pin_bytes = pin.encode("utf-8")
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", pin_bytes, salt, 120_000)
    return dk.hex()

def verify_pin(pin: str, salt_hex: str, expected_hash_hex: str) -> bool:
    got = hash_pin(pin, salt_hex)
    return hmac.compare_digest(got, expected_hash_hex)

def assert_pin(pin: str) -> str:
    p = (pin or "").strip()
    if not re.fullmatch(r"\d{4}|\d{6}", p):
        raise HTTPException(status_code=400, detail="PIN inválido. Usá 4 o 6 dígitos.")
    return p

def hash_pin(pin: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 200_000)
    return dk.hex()


# =========================
# Eventos
# =========================

@app.get("/events/active")
def get_active_event(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    with engine.connect() as conn:
        event = conn.execute(text("""
            select id, title, starts_at, location_name, status, close_at
            from public.events
            where status = 'OPEN'
            order by starts_at asc
            limit 1
        """)).mappings().first()

        if not event:
            return {"event": None, "courts": [], "waitlist": []}

        event_id = event["id"]

        courts = conn.execute(text("""
            select id, name, capacity, is_open, sort_order
            from public.event_courts
            where event_id = :event_id
            order by sort_order asc
        """), {"event_id": event_id}).mappings().all()

        confirmed = conn.execute(text("""
            select
              r.id as registration_id,
              r.court_id,
              r.registration_type,
              r.status,
              r.created_at,
              r.created_by_user_id,
              r.user_id,
              r.guest_name,
              u.full_name as user_full_name
            from public.event_registrations r
            left join public.users u on u.id = r.user_id
            where r.event_id = :event_id
              and r.status = 'CONFIRMED'
              and r.court_id is not null
            order by r.created_at asc
        """), {"event_id": event_id}).mappings().all()

        waitlist = conn.execute(text("""
            select
              r.id as registration_id,
              r.registration_type,
              r.status,
              r.created_at,
              r.created_by_user_id,
              r.user_id,
              r.guest_name,
              u.full_name as user_full_name
            from public.event_registrations r
            left join public.users u on u.id = r.user_id
            where r.event_id = :event_id
              and r.status = 'WAITLIST'
              and r.court_id is null
            order by r.created_at asc
        """), {"event_id": event_id}).mappings().all()

        confirmed_by_court = {}
        for r in confirmed:
            confirmed_by_court.setdefault(r["court_id"], []).append({
                "registration_id": str(r["registration_id"]),
                "type": r["registration_type"],
                "name": r["user_full_name"] if r["registration_type"] == "USER" else r["guest_name"],
                "created_at": str(r["created_at"]),
                "created_by_user_id": str(r["created_by_user_id"]),
            })

        courts_payload = []
        for c in courts:
            players = confirmed_by_court.get(c["id"], [])
            occupied = len(players)
            capacity = c["capacity"]
            available = max(capacity - occupied, 0)

            courts_payload.append({
                "court_id": str(c["id"]),
                "name": c["name"],
                "capacity": capacity,
                "occupied": occupied,
                "available": available,
                "is_open": c["is_open"],
                "players": players,
            })

        waitlist_payload = [{
            "registration_id": str(r["registration_id"]),
            "type": r["registration_type"],
            "name": r["user_full_name"] if r["registration_type"] == "USER" else r["guest_name"],
            "created_at": str(r["created_at"]),
            "created_by_user_id": str(r["created_by_user_id"]),
        } for r in waitlist]

        return {
            "event": {
                "id": str(event["id"]),
                "title": event["title"],
                "starts_at": str(event["starts_at"]),
                "location_name": event["location_name"],
                "status": event["status"],
                "close_at": str(event["close_at"]) if event["close_at"] else None,
            },
            "courts": courts_payload,
            "waitlist": waitlist_payload,
        }


# =========================
# Inscripciones
# =========================

@app.post("/events/{event_id}/register")
def register_user(
    event_id: str,
    body: RegisterRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    El actor (header) se auto-anota.
    """
    with engine.begin() as conn:

        event = conn.execute(text("""
            select id, status
            from public.events
            where id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado")
        if event["status"] != "OPEN":
            raise HTTPException(status_code=400, detail="El evento no está abierto")

        court = conn.execute(text("""
            select id, capacity, is_open
            from public.event_courts
            where id = :court_id and event_id = :event_id
            for update
        """), {"court_id": body.court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada para este evento")
        if not court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha está cerrada")

        occupied = conn.execute(text("""
            select count(*)::int as cnt
            from public.event_registrations
            where event_id = :event_id
              and court_id = :court_id
              and status = 'CONFIRMED'
        """), {"event_id": event_id, "court_id": body.court_id}).mappings().first()["cnt"]

        has_capacity = occupied < court["capacity"]
        status = "CONFIRMED" if has_capacity else "WAITLIST"
        court_id_to_set = body.court_id if has_capacity else None

        try:
            reg = conn.execute(text("""
                insert into public.event_registrations (
                  event_id, registration_type, status, court_id, created_by_user_id, user_id
                )
                values (
                  :event_id, 'USER', :status, :court_id, :created_by_user_id, :user_id
                )
                returning id, status, court_id, created_at
            """), {
                "event_id": event_id,
                "status": status,
                "court_id": court_id_to_set,
                "created_by_user_id": actor_user_id,
                "user_id": actor_user_id,
            }).mappings().first()
        except IntegrityError:
            raise HTTPException(status_code=409, detail="El usuario ya está inscripto en este evento")

        conn.execute(text("""
            insert into public.event_audit_log (
              event_id, actor_user_id, action, target_registration_id, metadata
            )
            values (
              :event_id, :actor_user_id, 'REGISTER_USER', :target_registration_id, CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "target_registration_id": reg["id"],
            "metadata": '{"source":"api"}'
        })

        return {
            "registration_id": str(reg["id"]),
            "status": reg["status"],
            "court_id": str(reg["court_id"]) if reg["court_id"] else None,
            "created_at": str(reg["created_at"]),
            "message": "Inscripción confirmada" if reg["status"] == "CONFIRMED" else "Agregado a lista de espera",
        }

# =========================
# Pin Register
# =========================
    
@app.post("/auth/pin/register")
def pin_register(body: PinRegisterRequest):
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
        is_admin = any(x in ("admin", "super_admin") for x in roles)

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

@app.post("/auth/pin/login")
def pin_login(body: PinLoginRequest):
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
        is_admin = any(x in ("admin", "super_admin") for x in roles)

        return {
            "actor_user_id": str(user["id"]),
            "me": {
                "id": str(user["id"]),
                "full_name": user["full_name"],
                "roles": roles,
                "is_admin": is_admin,
            }
        }


# =========================
# Cancelar inscripción (Admin / Capitán)
# =========================

@app.post("/registrations/{registration_id}/cancel")
def cancel_registration(
    registration_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    with engine.begin() as conn:

        reg = conn.execute(text("""
            select id, event_id, court_id, status
            from public.event_registrations
            where id = :registration_id
            for update
        """), {"registration_id": registration_id}).mappings().first()

        if not reg:
            raise HTTPException(status_code=404, detail="Inscripción no encontrada")
        if reg["status"] == "CANCELLED":
            raise HTTPException(status_code=400, detail="La inscripción ya está cancelada")

        event_id = reg["event_id"]
        freed_court_id = reg["court_id"]

        # Permisos: admin/super_admin o capitán del evento
        assert_can_move(conn, str(event_id), actor_user_id)

        # 1) Cancelar inscripción
        conn.execute(text("""
            update public.event_registrations
            set status = 'CANCELLED',
                cancelled_at = now(),
                updated_at = now()
            where id = :registration_id
        """), {"registration_id": registration_id})

        # 2) Audit log - cancelación
        conn.execute(text("""
            insert into public.event_audit_log (
                event_id, actor_user_id, action, target_registration_id, metadata
            )
            values (
                :event_id,
                :actor_user_id,
                'CANCEL_REGISTRATION',
                :target_registration_id,
                CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "target_registration_id": registration_id,
            "metadata": '{"reason":"manual_cancel"}'
        })

        promoted_id = None

        # 3) Promover primer WAITLIST si se liberó una cancha
        if freed_court_id:
            wait = conn.execute(text("""
                select id
                from public.event_registrations
                where event_id = :event_id
                  and status = 'WAITLIST'
                  and court_id is null
                order by created_at asc
                limit 1
                for update
            """), {"event_id": event_id}).mappings().first()

            if wait:
                # Validar cupo real en la cancha liberada
                court = conn.execute(text("""
                    select capacity, is_open
                    from public.event_courts
                    where id = :court_id and event_id = :event_id
                    for update
                """), {"court_id": freed_court_id, "event_id": event_id}).mappings().first()

                if court and court["is_open"]:
                    occupied = conn.execute(text("""
                        select count(*)::int as cnt
                        from public.event_registrations
                        where event_id = :event_id
                          and court_id = :court_id
                          and status = 'CONFIRMED'
                    """), {"event_id": event_id, "court_id": freed_court_id}).mappings().first()["cnt"]

                    if occupied < court["capacity"]:
                        conn.execute(text("""
                            update public.event_registrations
                            set status = 'CONFIRMED',
                                court_id = :court_id,
                                updated_at = now()
                            where id = :wait_id
                        """), {"court_id": freed_court_id, "wait_id": wait["id"]})

                        promoted_id = wait["id"]

                        conn.execute(text("""
                            insert into public.event_audit_log (
                                event_id, actor_user_id, action, target_registration_id, metadata
                            )
                            values (
                                :event_id,
                                :actor_user_id,
                                'PROMOTE_WAITLIST',
                                :target_registration_id,
                                CAST(:metadata AS jsonb)
                            )
                        """), {
                            "event_id": event_id,
                            "actor_user_id": actor_user_id,
                            "target_registration_id": promoted_id,
                            "metadata": '{"source":"auto_from_cancel"}'
                        })

        return {
            "cancelled_registration_id": registration_id,
            "promoted_registration_id": str(promoted_id) if promoted_id else None,
            "message": "Inscripción cancelada correctamente"
        }


# =========================
# Invitados
# =========================

@app.post("/events/{event_id}/guests")
def register_guest(
    event_id: str,
    body: GuestRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    with engine.begin() as conn:

        event = conn.execute(text("""
            select id, status
            from public.events
            where id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado")
        if event["status"] != "OPEN":
            raise HTTPException(status_code=400, detail="El evento no está abierto")

        court = conn.execute(text("""
            select id, capacity, is_open
            from public.event_courts
            where id = :court_id and event_id = :event_id
            for update
        """), {"court_id": body.court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada para este evento")
        if not court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha está cerrada")

        # Límite 5 invitados por actor/evento (no cuenta CANCELLED)
        guest_count = conn.execute(text("""
            select count(*)::int as cnt
            from public.event_registrations
            where event_id = :event_id
              and registration_type = 'GUEST'
              and created_by_user_id = :actor_user_id
              and status != 'CANCELLED'
        """), {"event_id": event_id, "actor_user_id": actor_user_id}).mappings().first()["cnt"]

        if guest_count >= 10:
            raise HTTPException(status_code=400, detail="Límite de 10 invitados alcanzado para este evento")

        # Cupo (sin sobrecupo)
        occupied = conn.execute(text("""
            select count(*)::int as cnt
            from public.event_registrations
            where event_id = :event_id
              and court_id = :court_id
              and status = 'CONFIRMED'
        """), {"event_id": event_id, "court_id": body.court_id}).mappings().first()["cnt"]

        if occupied >= court["capacity"]:
            raise HTTPException(status_code=409, detail="La cancha está completa. No se permite sobrecupo.")

        reg = conn.execute(text("""
            insert into public.event_registrations (
              event_id, registration_type, status, court_id, created_by_user_id, guest_name
            )
            values (
              :event_id, 'GUEST', 'CONFIRMED', :court_id, :created_by_user_id, :guest_name
            )
            returning id, status, court_id, created_at
        """), {
            "event_id": event_id,
            "court_id": body.court_id,
            "created_by_user_id": actor_user_id,
            "guest_name": body.guest_name.strip(),
        }).mappings().first()

        conn.execute(text("""
            insert into public.event_audit_log (
              event_id, actor_user_id, action, target_registration_id, metadata
            )
            values (
              :event_id, :actor_user_id, 'REGISTER_GUEST', :target_registration_id, CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "target_registration_id": reg["id"],
            "metadata": '{"source":"api"}'
        })

        return {
            "registration_id": str(reg["id"]),
            "status": reg["status"],
            "court_id": str(reg["court_id"]),
            "created_at": str(reg["created_at"]),
            "guest_name": body.guest_name.strip(),
            "message": "Invitado confirmado"
        }



# =========================
# Mover inscripción (Admin / Capitán)
# =========================

@app.post("/registrations/{registration_id}/move")
def move_registration(
    registration_id: str,
    body: MoveRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    with engine.begin() as conn:

        reg = conn.execute(text("""
            select id, event_id, court_id, status
            from public.event_registrations
            where id = :registration_id
            for update
        """), {"registration_id": registration_id}).mappings().first()

        if not reg:
            raise HTTPException(status_code=404, detail="Inscripción no encontrada")
        if reg["status"] != "CONFIRMED":
            raise HTTPException(status_code=400, detail="Solo se pueden mover inscripciones CONFIRMED")

        event_id = reg["event_id"]
        from_court_id = reg["court_id"]

        if not from_court_id:
            raise HTTPException(status_code=400, detail="La inscripción no tiene cancha asignada")
        if body.to_court_id == str(from_court_id):
            raise HTTPException(status_code=400, detail="La inscripción ya está en esa cancha")

        # Permisos: admin/super_admin o capitán del evento
        assert_can_move(conn, str(event_id), actor_user_id)

        # Evento abierto
        event = conn.execute(text("""
            select status
            from public.events
            where id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event or event["status"] != "OPEN":
            raise HTTPException(status_code=400, detail="El evento no está abierto")

        # Lock cancha destino
        to_court = conn.execute(text("""
            select id, capacity, is_open
            from public.event_courts
            where id = :court_id and event_id = :event_id
            for update
        """), {"court_id": body.to_court_id, "event_id": event_id}).mappings().first()

        if not to_court:
            raise HTTPException(status_code=404, detail="Cancha destino no encontrada para este evento")
        if not to_court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha destino está cerrada")

        # Cupo destino
        occupied_to = conn.execute(text("""
            select count(*)::int as cnt
            from public.event_registrations
            where event_id = :event_id
              and court_id = :court_id
              and status = 'CONFIRMED'
        """), {"event_id": event_id, "court_id": body.to_court_id}).mappings().first()["cnt"]

        if occupied_to >= to_court["capacity"]:
            raise HTTPException(status_code=409, detail="La cancha destino está completa")

        # Mover
        conn.execute(text("""
            update public.event_registrations
            set court_id = :to_court_id,
                updated_at = now()
            where id = :registration_id
        """), {"to_court_id": body.to_court_id, "registration_id": registration_id})

        # Audit move
        conn.execute(text("""
            insert into public.event_audit_log (
              event_id, actor_user_id, action, target_registration_id, metadata
            )
            values (
              :event_id, :actor_user_id, 'MOVE_REGISTRATION', :target_registration_id, CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "target_registration_id": registration_id,
            "metadata": f'{{"from_court_id":"{from_court_id}","to_court_id":"{body.to_court_id}"}}'
        })

        # Promover WAITLIST a la cancha liberada
        promoted_id = None

        wait = conn.execute(text("""
            select id
            from public.event_registrations
            where event_id = :event_id
              and status = 'WAITLIST'
              and court_id is null
            order by created_at asc
            limit 1
            for update
        """), {"event_id": event_id}).mappings().first()

        if wait:
            from_court = conn.execute(text("""
                select capacity, is_open
                from public.event_courts
                where id = :court_id and event_id = :event_id
                for update
            """), {"court_id": from_court_id, "event_id": event_id}).mappings().first()

            if from_court and from_court["is_open"]:
                occupied_from = conn.execute(text("""
                    select count(*)::int as cnt
                    from public.event_registrations
                    where event_id = :event_id
                      and court_id = :court_id
                      and status = 'CONFIRMED'
                """), {"event_id": event_id, "court_id": from_court_id}).mappings().first()["cnt"]

                if occupied_from < from_court["capacity"]:
                    conn.execute(text("""
                        update public.event_registrations
                        set status = 'CONFIRMED',
                            court_id = :court_id,
                            updated_at = now()
                        where id = :wait_id
                    """), {"court_id": from_court_id, "wait_id": wait["id"]})

                    promoted_id = wait["id"]

                    conn.execute(text("""
                        insert into public.event_audit_log (
                          event_id, actor_user_id, action, target_registration_id, metadata
                        )
                        values (
                          :event_id, :actor_user_id, 'PROMOTE_WAITLIST', :target_registration_id, CAST(:metadata AS jsonb)
                        )
                    """), {
                        "event_id": event_id,
                        "actor_user_id": actor_user_id,
                        "target_registration_id": promoted_id,
                        "metadata": '{"source":"auto_from_move"}'
                    })

        return {
            "moved_registration_id": registration_id,
            "from_court_id": str(from_court_id),
            "to_court_id": body.to_court_id,
            "promoted_registration_id": str(promoted_id) if promoted_id else None,
            "message": "Movimiento realizado"
        }

