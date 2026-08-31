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

from fastapi import APIRouter, HTTPException, Header, Request
from sqlalchemy import text

from app.settings import engine, EVENT_ACCESS_ENABLED
from app.schemas import EventUnlockRequest
from app.utils.event_access_token import issue_event_grant, verify_event_grant
from app.utils.security import verify_event_password
from app.utils.ratelimit import rate_limit, client_ip

router = APIRouter()


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
