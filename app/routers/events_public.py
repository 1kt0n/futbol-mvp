"""
API pública de eventos (Event Access v1) — SIN autenticación de miembro.

Espeja el patrón probado de `tournaments_public.py`: lectura por `share_code`,
respuesta sanitizada, 404 genérico. Encima agrega la capa de contraseña:
- LINK_PASSWORD sin grant válido → descriptor mínimo (no revela nada).
- unlock valida la clave (rate-limited) y emite un grant firmado (ver
  `app/utils/event_access_token.py`).

Nada de PII/tokens/claves en logs ni en URLs. El grant viaja en el header
`X-Event-Access`, no en la query string.
"""
import json
import threading
import time

from fastapi import APIRouter, HTTPException, Header, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine, EVENT_ACCESS_ENABLED, EXTERNAL_REGISTRATION_ENABLED
from app.schemas import EventUnlockRequest, ExternalRegisterRequest
from app.utils.event_access_token import issue_event_grant, verify_event_grant
from app.utils.security import verify_event_password, gen_management_token, hash_management_token
from app.utils.contact_crypto import encrypt_contact, decrypt_contact, contact_fingerprint
from app.utils.ratelimit import rate_limit, client_ip
from app.routers.events import check_and_auto_close_court, promote_first_waitlist

router = APIRouter()

# Idempotencia in-memory para el alta externa (doble-submit / retry de red).
# Por-instancia y efímera (como el rate limit); el índice de dedup es la garantía durable.
_IDEM_TTL = 600
_idem_lock = threading.Lock()
_idem_store: dict[str, tuple[float, dict]] = {}


def _idem_get(key: str):
    with _idem_lock:
        v = _idem_store.get(key)
        if not v:
            return None
        ts, resp = v
        if time.time() - ts > _IDEM_TTL:
            _idem_store.pop(key, None)
            return None
        return resp


def _idem_put(key: str, resp: dict):
    with _idem_lock:
        _idem_store[key] = (time.time(), resp)
        if len(_idem_store) > 2000:
            cutoff = time.time() - _IDEM_TTL
            for k in [k for k, (ts, _) in _idem_store.items() if ts < cutoff]:
                _idem_store.pop(k, None)


def _courts_availability(conn, event_id) -> list[dict]:
    """Disponibilidad por cancha para el selector del externo (sin roster/PII)."""
    rows = conn.execute(text("""
        SELECT ec.id, ec.name, ec.capacity, ec.is_open, ec.sort_order,
               COUNT(er.id) FILTER (WHERE er.status = 'CONFIRMED') AS occupied
        FROM public.event_courts ec
        LEFT JOIN public.event_registrations er ON er.court_id = ec.id
        WHERE ec.event_id = :event_id
        GROUP BY ec.id, ec.name, ec.capacity, ec.is_open, ec.sort_order
        ORDER BY ec.sort_order ASC
    """), {"event_id": event_id}).mappings().all()
    out = []
    for c in rows:
        available = max(c["capacity"] - int(c["occupied"]), 0)
        out.append({
            "court_id": str(c["id"]),
            "name": c["name"],
            "capacity": c["capacity"],
            "available": available,
            "is_open": c["is_open"],
            "full": available <= 0,
        })
    return out


def _aggregate_capacity(conn, event_id) -> dict:
    """Disponibilidad agregada (sin roster): suma de cupos de canchas abiertas."""
    courts = conn.execute(text("""
        SELECT ec.capacity,
               COUNT(er.id) FILTER (WHERE er.status = 'CONFIRMED') AS occupied
        FROM public.event_courts ec
        LEFT JOIN public.event_registrations er ON er.court_id = ec.id
        WHERE ec.event_id = :event_id AND ec.is_open = true
        GROUP BY ec.id, ec.capacity
    """), {"event_id": event_id}).mappings().all()

    total = sum(c["capacity"] for c in courts)
    occupied = sum(int(c["occupied"]) for c in courts)
    available = max(total - occupied, 0)
    return {"total": total, "available": available, "full": available <= 0}


def _public_roster(conn, event_id, visibility: str) -> list[dict]:
    """Roster público según política. NONE → vacío. Nunca teléfono/email."""
    if visibility not in ("FIRST_NAME", "DISPLAY_NAME"):
        return []
    rows = conn.execute(text("""
        SELECT r.registration_type, r.guest_name, u.full_name, u.nickname
        FROM public.event_registrations r
        LEFT JOIN public.users u ON u.id = r.user_id
        WHERE r.event_id = :event_id
          AND r.status = 'CONFIRMED'
          AND r.court_id IS NOT NULL
        ORDER BY r.created_at ASC
    """), {"event_id": event_id}).mappings().all()

    out = []
    for row in rows:
        if row["registration_type"] == "USER":
            name = (row["nickname"] or row["full_name"] or "").strip() if visibility == "DISPLAY_NAME" \
                else (row["full_name"] or "").strip()
        else:
            name = (row["guest_name"] or "").strip()
        if not name:
            continue
        if visibility == "FIRST_NAME":
            name = name.split(" ")[0]
        out.append({"name": name})
    return out


@router.get("/public/events/{share_code}")
def get_public_event(
    share_code: str,
    x_event_access: str | None = Header(None, alias="X-Event-Access"),
):
    if not EVENT_ACCESS_ENABLED:
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

    with engine.connect() as conn:
        ev = conn.execute(text("""
            SELECT id, title, description, starts_at, location_name, status,
                   access_mode, password_version, public_roster_visibility,
                   allow_external_registration
            FROM public.events
            WHERE share_code = :share_code
            LIMIT 1
        """), {"share_code": share_code}).mappings().first()

        # MEMBERS_ONLY no se sirve por link público aunque tenga share_code.
        if not ev or ev["access_mode"] == "MEMBERS_ONLY":
            raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

        locked = ev["access_mode"] == "LINK_PASSWORD"
        has_grant = bool(
            locked and x_event_access
            and verify_event_grant(x_event_access, str(ev["id"]), ev["password_version"])
        )

        if locked and not has_grant:
            # Descriptor mínimo: no revelar título, lugar, cupos ni roster.
            return {
                "event_id": str(ev["id"]),
                "access_mode": ev["access_mode"],
                "password_required": True,
            }

        return {
            "event_id": str(ev["id"]),
            "access_mode": ev["access_mode"],
            "password_required": False,
            "title": ev["title"],
            "description": ev["description"],
            "starts_at": str(ev["starts_at"]),
            "location_name": ev["location_name"],
            "status": ev["status"],
            "registration_open": ev["status"] == "OPEN",
            "capacity": _aggregate_capacity(conn, ev["id"]),
            "courts": _courts_availability(conn, ev["id"]),
            "public_roster_visibility": ev["public_roster_visibility"],
            "roster": _public_roster(conn, ev["id"], ev["public_roster_visibility"]),
            "allow_external_registration": ev["allow_external_registration"],
        }


@router.post("/public/events/{share_code}/unlock")
def unlock_public_event(share_code: str, body: EventUnlockRequest, request: Request):
    if not EVENT_ACCESS_ENABLED:
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

    ip = client_ip(request)
    rate_limit(f"unlock:{share_code}", max_hits=5, window_seconds=60)
    rate_limit(f"unlock-ip:{ip}", max_hits=10, window_seconds=60)

    with engine.connect() as conn:
        ev = conn.execute(text("""
            SELECT id, access_mode, password_salt, password_hash, password_version
            FROM public.events
            WHERE share_code = :share_code
            LIMIT 1
        """), {"share_code": share_code}).mappings().first()

    # No revelar si el evento existe o su modo: error uniforme.
    if not ev or ev["access_mode"] != "LINK_PASSWORD":
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

    if not verify_event_password(body.password, ev["password_salt"], ev["password_hash"]):
        raise HTTPException(status_code=401, detail="INVALID_EVENT_PASSWORD")

    token, exp = issue_event_grant(str(ev["id"]), ev["password_version"])

    # Auditoría best-effort del desbloqueo exitoso (sin la clave).
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
                VALUES (:event_id, NULL, 'EVENT_UNLOCK', CAST(:metadata AS jsonb))
            """), {"event_id": str(ev["id"]), "metadata": json.dumps({"result": "success"})})
    except Exception:
        pass

    return {"access_token": token, "expires_at": exp}


# =========================
# Inscripción externa (sin cuenta)
# =========================

@router.post("/public/events/{share_code}/participants", status_code=201)
def register_external(
    share_code: str,
    body: ExternalRegisterRequest,
    request: Request,
    x_event_access: str | None = Header(None, alias="X-Event-Access"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """
    Alta de un participante EXTERNAL desde el enlace público (sin cuenta).
    El externo elige cancha; misma regla de cupo/waitlist que el alta de miembro.
    """
    if not (EVENT_ACCESS_ENABLED and EXTERNAL_REGISTRATION_ENABLED):
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

    if not body.privacy_accepted:
        raise HTTPException(status_code=400, detail="PRIVACY_NOT_ACCEPTED")

    display_name = (body.display_name or "").strip()
    if len(display_name) < 2 or len(display_name) > 60:
        raise HTTPException(status_code=400, detail="Nombre inválido (2 a 60 caracteres).")

    fingerprint = contact_fingerprint(body.contact)
    if not fingerprint:
        raise HTTPException(status_code=400, detail="Contacto (WhatsApp/teléfono) inválido.")

    ip = client_ip(request)
    rate_limit(f"ext-reg-ip:{ip}", max_hits=10, window_seconds=60)
    rate_limit(f"ext-reg-code:{share_code}", max_hits=30, window_seconds=60)
    rate_limit(f"ext-reg-fp:{fingerprint}", max_hits=5, window_seconds=300)

    idem_key = f"{share_code}:{idempotency_key}" if idempotency_key else None
    if idem_key:
        cached = _idem_get(idem_key)
        if cached is not None:
            return cached

    with engine.connect() as conn:
        ev = conn.execute(text("""
            SELECT id, status, access_mode, password_version, allow_external_registration
            FROM public.events WHERE share_code = :share_code LIMIT 1
        """), {"share_code": share_code}).mappings().first()

    if not ev or ev["access_mode"] == "MEMBERS_ONLY" or not ev["allow_external_registration"]:
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")

    # LINK_PASSWORD: exige grant válido (haber desbloqueado).
    if ev["access_mode"] == "LINK_PASSWORD":
        if not (x_event_access and verify_event_grant(x_event_access, str(ev["id"]), ev["password_version"])):
            raise HTTPException(status_code=401, detail="PASSWORD_REQUIRED")

    if ev["status"] != "OPEN":
        raise HTTPException(status_code=400, detail="REGISTRATION_CLOSED")

    event_id = ev["id"]
    contact_enc = encrypt_contact(body.contact.strip())
    position = (body.position or "").strip() or None
    mgmt_token = gen_management_token()
    mgmt_hash = hash_management_token(mgmt_token)

    with engine.begin() as conn:
        court = conn.execute(text("""
            SELECT id, capacity, is_open FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id FOR UPDATE
        """), {"court_id": body.court_id, "event_id": event_id}).mappings().first()
        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada para este evento.")
        if not court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha está cerrada.")

        # Dedup: un contacto por evento entre estados no cancelados.
        dup = conn.execute(text("""
            SELECT 1 FROM public.event_registrations
            WHERE event_id = :event_id AND registration_type = 'EXTERNAL'
              AND contact_fingerprint = :fp AND status <> 'CANCELLED'
            LIMIT 1
        """), {"event_id": event_id, "fp": fingerprint}).first()
        if dup:
            raise HTTPException(status_code=409, detail="DUPLICATE_PARTICIPANT")

        occupied = conn.execute(text("""
            SELECT count(*)::int AS cnt FROM public.event_registrations
            WHERE event_id = :event_id AND court_id = :court_id AND status = 'CONFIRMED'
        """), {"event_id": event_id, "court_id": body.court_id}).mappings().first()["cnt"]

        has_capacity = occupied < court["capacity"]
        status = "CONFIRMED" if has_capacity else "WAITLIST"
        court_to_set = body.court_id if has_capacity else None

        try:
            reg = conn.execute(text("""
                INSERT INTO public.event_registrations (
                    event_id, registration_type, status, court_id,
                    guest_name, position, contact_encrypted, contact_fingerprint,
                    management_token_hash, management_token_expires_at
                )
                VALUES (
                    :event_id, 'EXTERNAL', :status, :court_id,
                    :guest_name, :position, :contact_enc, :fp,
                    :mgmt_hash,
                    GREATEST(now(), (SELECT starts_at FROM public.events WHERE id = :event_id)) + interval '7 days'
                )
                RETURNING id, status, court_id, created_at
            """), {
                "event_id": event_id,
                "status": status,
                "court_id": court_to_set,
                "guest_name": display_name,
                "position": position,
                "contact_enc": contact_enc,
                "fp": fingerprint,
                "mgmt_hash": mgmt_hash,
            }).mappings().first()
        except IntegrityError:
            # Carrera contra el índice único de dedup.
            raise HTTPException(status_code=409, detail="DUPLICATE_PARTICIPANT")

        conn.execute(text("""
            INSERT INTO public.event_audit_log (event_id, actor_user_id, action, target_registration_id, metadata)
            VALUES (:event_id, NULL, 'REGISTER_EXTERNAL', :target_registration_id, CAST(:metadata AS jsonb))
        """), {
            "event_id": event_id,
            "target_registration_id": reg["id"],
            "metadata": json.dumps({"status": status}),
        })

        waitlist_position = None
        if status == "WAITLIST":
            waitlist_position = conn.execute(text("""
                SELECT count(*)::int AS cnt FROM public.event_registrations
                WHERE event_id = :event_id AND status = 'WAITLIST' AND court_id IS NULL
                  AND created_at <= :created_at
            """), {"event_id": event_id, "created_at": reg["created_at"]}).mappings().first()["cnt"]

    if status == "CONFIRMED":
        check_and_auto_close_court(str(event_id), body.court_id, None)

    resp = {
        "participation_id": str(reg["id"]),
        "status": status,
        "waitlist_position": waitlist_position,
        "management_path": f"/g/{mgmt_token}",
    }
    if idem_key:
        _idem_put(idem_key, resp)
    return resp


# =========================
# Gestión de la participación externa (por token)
# =========================

def _load_participation(conn, management_token: str):
    """Devuelve la fila de participación por token (con flag `expired`), o None."""
    return conn.execute(text("""
        SELECT r.id, r.event_id, r.status, r.court_id, r.guest_name, r.position,
               (r.management_token_expires_at IS NOT NULL
                AND r.management_token_expires_at < now()) AS expired,
               e.title, e.starts_at, e.location_name,
               c.name AS court_name
        FROM public.event_registrations r
        JOIN public.events e ON e.id = r.event_id
        LEFT JOIN public.event_courts c ON c.id = r.court_id
        WHERE r.management_token_hash = :h
        LIMIT 1
    """), {"h": hash_management_token(management_token)}).mappings().first()


@router.get("/public/participations/{management_token}")
def get_participation(management_token: str):
    if not (EVENT_ACCESS_ENABLED and EXTERNAL_REGISTRATION_ENABLED):
        raise HTTPException(status_code=404, detail="INVALID_MANAGEMENT_TOKEN")

    with engine.connect() as conn:
        p = _load_participation(conn, management_token)

    if not p or p["expired"]:
        raise HTTPException(status_code=404, detail="INVALID_MANAGEMENT_TOKEN")

    return {
        "participation_id": str(p["id"]),
        "status": p["status"],
        "display_name": p["guest_name"],
        "position": p["position"],
        "court_name": p["court_name"],
        "event": {
            "title": p["title"],
            "starts_at": str(p["starts_at"]),
            "location_name": p["location_name"],
        },
    }


@router.post("/public/participations/{management_token}/cancel")
def cancel_participation(management_token: str):
    if not (EVENT_ACCESS_ENABLED and EXTERNAL_REGISTRATION_ENABLED):
        raise HTTPException(status_code=404, detail="INVALID_MANAGEMENT_TOKEN")

    token_hash = hash_management_token(management_token)
    with engine.begin() as conn:
        p = conn.execute(text("""
            SELECT id, event_id, status, court_id, management_token_expires_at
            FROM public.event_registrations
            WHERE management_token_hash = :h
            FOR UPDATE
        """), {"h": token_hash}).mappings().first()

        if not p:
            raise HTTPException(status_code=404, detail="INVALID_MANAGEMENT_TOKEN")

        expired = conn.execute(text("""
            SELECT (management_token_expires_at IS NOT NULL AND management_token_expires_at < now()) AS expired
            FROM public.event_registrations WHERE id = :id
        """), {"id": p["id"]}).mappings().first()["expired"]
        if expired:
            raise HTTPException(status_code=404, detail="INVALID_MANAGEMENT_TOKEN")

        if p["status"] == "CANCELLED":
            return {"status": "CANCELLED", "promoted": False}

        freed_court_id = p["court_id"]
        conn.execute(text("""
            UPDATE public.event_registrations
            SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
            WHERE id = :id
        """), {"id": p["id"]})

        conn.execute(text("""
            INSERT INTO public.event_audit_log (event_id, actor_user_id, action, target_registration_id, metadata)
            VALUES (:event_id, NULL, 'CANCEL_EXTERNAL', :target_registration_id, CAST(:metadata AS jsonb))
        """), {
            "event_id": p["event_id"],
            "target_registration_id": p["id"],
            "metadata": json.dumps({"source": "self_cancel"}),
        })

        promoted_id = promote_first_waitlist(
            conn, p["event_id"], freed_court_id, None, source="auto_from_external_cancel"
        )

    return {"status": "CANCELLED", "promoted": promoted_id is not None}
