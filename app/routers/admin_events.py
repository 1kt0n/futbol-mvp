from fastapi import APIRouter, HTTPException, Header
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine
from app.schemas import (
    CreateEventRequest,
    CreateCourtRequest,
    UpdateCourtRequest,
    AssignCaptainRequest
)
from app.utils.permissions import require_admin

router = APIRouter()


@router.post("/events")
def create_event(body: CreateEventRequest, actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Crea un nuevo evento. Solo admin/super_admin.
    El evento arranca con status='OPEN' siempre.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    # Convertir string vacío a None para close_at
    close_at_value = body.close_at if body.close_at and body.close_at.strip() else None

    with engine.begin() as conn:
        # Crear evento
        event = conn.execute(text("""
            INSERT INTO public.events (
                title,
                starts_at,
                location_name,
                close_at,
                status,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                :title,
                :starts_at,
                :location_name,
                :close_at,
                'OPEN',
                :created_by_user_id,
                now(),
                now()
            )
            RETURNING id, title, starts_at, location_name, status, close_at
        """), {
            "title": body.title,
            "starts_at": body.starts_at,
            "location_name": body.location_name,
            "close_at": close_at_value,
            "created_by_user_id": actor_user_id
        }).mappings().first()

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'CREATE_EVENT', '{}'::jsonb
            )
        """), {
            "event_id": event["id"],
            "actor_user_id": actor_user_id
        })

        return {
            "event_id": str(event["id"]),
            "title": event["title"],
            "starts_at": str(event["starts_at"]),
            "location_name": event["location_name"],
            "status": event["status"],
            "close_at": str(event["close_at"]) if event["close_at"] else None,
            "message": f"Evento '{event['title']}' creado exitosamente con estado OPEN."
        }


@router.post("/events/{event_id}/open")
def open_event(event_id: str, actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Abre un evento cerrado o finalizado. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar estado actual
        event = conn.execute(text("""
            SELECT status FROM public.events WHERE id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")

        if event["status"] == "OPEN":
            raise HTTPException(status_code=400, detail="El evento ya está abierto.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.events
            SET status = 'OPEN', finalized_at = NULL, updated_at = now()
            WHERE id = :event_id
        """), {"event_id": event_id})

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'REOPEN_EVENT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"previous_status": "{event["status"]}"}}'
        })

    return {"event_id": event_id, "status": "OPEN", "message": "Evento reabierto exitosamente."}


@router.post("/events/{event_id}/close")
def close_event(event_id: str, actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Cierra un evento. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar estado actual
        event = conn.execute(text("""
            SELECT status FROM public.events WHERE id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")

        if event["status"] == "CLOSED":
            raise HTTPException(status_code=400, detail="El evento ya está cerrado.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.events
            SET status = 'CLOSED', updated_at = now()
            WHERE id = :event_id
        """), {"event_id": event_id})

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'CLOSE_EVENT', '{}'::jsonb
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id
        })

    return {"event_id": event_id, "status": "CLOSED", "message": "Evento cerrado exitosamente."}


@router.post("/events/{event_id}/finalize")
def finalize_event(event_id: str, actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Finaliza un evento (lo archiva). Solo admin/super_admin.
    Un evento finalizado no aparece en la lista principal y no se puede gestionar.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar estado actual
        event = conn.execute(text("""
            SELECT status FROM public.events WHERE id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")

        if event["status"] == "FINALIZED":
            raise HTTPException(status_code=400, detail="El evento ya está finalizado.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.events
            SET status = 'FINALIZED', finalized_at = now(), updated_at = now()
            WHERE id = :event_id
        """), {"event_id": event_id})

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'FINALIZE_EVENT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"previous_status": "{event["status"]}"}}'
        })

    return {"event_id": event_id, "status": "FINALIZED", "message": "Evento finalizado (archivado) exitosamente."}


@router.post("/events/{event_id}/courts")
def create_court(
    event_id: str,
    body: CreateCourtRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Crea una nueva cancha en un evento. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar que el evento existe
        event = conn.execute(text("""
            SELECT id FROM public.events WHERE id = :event_id
        """), {"event_id": event_id}).first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")

    with engine.begin() as conn:
        court = conn.execute(text("""
            INSERT INTO public.event_courts (
                event_id, name, capacity, is_open, sort_order, created_at, updated_at
            )
            VALUES (
                :event_id, :name, :capacity, :is_open, :sort_order, now(), now()
            )
            RETURNING id, name, capacity, is_open, sort_order
        """), {
            "event_id": event_id,
            "name": body.name,
            "capacity": body.capacity,
            "is_open": body.is_open,
            "sort_order": body.sort_order
        }).mappings().first()

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'CREATE_COURT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_name": "{body.name}", "capacity": {body.capacity}}}'
        })

        return {
            "court_id": str(court["id"]),
            "name": court["name"],
            "capacity": court["capacity"],
            "is_open": court["is_open"],
            "sort_order": court["sort_order"],
            "message": f"Cancha '{court['name']}' creada exitosamente."
        }


@router.patch("/events/{event_id}/courts/{court_id}")
def update_court(
    event_id: str,
    court_id: str,
    body: UpdateCourtRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Actualiza una cancha. Solo admin/super_admin.
    Si se reduce capacity, valida que no haya más jugadores CONFIRMED que la nueva capacidad.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar que la cancha existe y pertenece al evento
        court = conn.execute(text("""
            SELECT id, name, capacity FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada en este evento.")

        # Si se reduce capacity, validar que no haya overflow
        if body.capacity is not None and body.capacity < court["capacity"]:
            occupied = conn.execute(text("""
                SELECT COUNT(*) as count
                FROM public.event_registrations
                WHERE court_id = :court_id AND status = 'CONFIRMED'
            """), {"court_id": court_id}).mappings().first()

            if occupied["count"] > body.capacity:
                raise HTTPException(
                    status_code=400,
                    detail=f"No se puede reducir la capacidad a {body.capacity}. "
                           f"Hay {occupied['count']} jugadores confirmados."
                )

    # Construir update dinámico solo con campos no-null
    updates = []
    params = {"court_id": court_id, "event_id": event_id, "actor_user_id": actor_user_id}

    if body.name is not None:
        updates.append("name = :name")
        params["name"] = body.name

    if body.capacity is not None:
        updates.append("capacity = :capacity")
        params["capacity"] = body.capacity

    if body.sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = body.sort_order

    if body.is_open is not None:
        updates.append("is_open = :is_open")
        params["is_open"] = body.is_open

    if not updates:
        raise HTTPException(status_code=400, detail="No se especificaron campos para actualizar.")

    updates.append("updated_at = now()")
    update_sql = f"UPDATE public.event_courts SET {', '.join(updates)} WHERE id = :court_id AND event_id = :event_id"

    with engine.begin() as conn:
        conn.execute(text(update_sql), params)

        # Audit log
        changes = {k: v for k, v in params.items() if k not in ["court_id", "event_id", "actor_user_id"]}
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'UPDATE_COURT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": str(changes).replace("'", '"')
        })

    return {"court_id": court_id, "message": "Cancha actualizada exitosamente.", "changes": changes}


@router.delete("/events/{event_id}/courts/{court_id}")
def delete_court(
    event_id: str,
    court_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Elimina una cancha de un evento. Solo admin/super_admin.
    Solo se permite si no tiene inscripciones ni ratings asociados.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        court = conn.execute(text("""
            SELECT id, name
            FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada en este evento.")

        registrations_count = conn.execute(text("""
            SELECT COUNT(*) AS count
            FROM public.event_registrations
            WHERE court_id = :court_id
        """), {"court_id": court_id}).mappings().first()["count"]

        if registrations_count > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    "No se puede eliminar la cancha porque tiene inscripciones asociadas. "
                    "Mové o eliminá esas inscripciones primero."
                ),
            )

        ratings_table_exists = conn.execute(text("""
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'player_ratings'
        """)).first() is not None

        ratings_count = 0
        if ratings_table_exists:
            ratings_count = conn.execute(text("""
                SELECT COUNT(*) AS count
                FROM public.player_ratings
                WHERE court_id = :court_id
            """), {"court_id": court_id}).mappings().first()["count"]

        if ratings_count > 0:
            raise HTTPException(
                status_code=409,
                detail="No se puede eliminar la cancha porque tiene ratings asociados.",
            )

    with engine.begin() as conn:
        conn.execute(text("""
            DELETE FROM public.event_court_captains
            WHERE event_id = :event_id AND court_id = :court_id
        """), {"event_id": event_id, "court_id": court_id})

        conn.execute(text("""
            DELETE FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id})

        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'DELETE_COURT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_id":"{court_id}"}}'
        })

    return {
        "event_id": event_id,
        "court_id": court_id,
        "message": f"Cancha '{court['name']}' eliminada exitosamente."
    }


@router.post("/events/{event_id}/courts/{court_id}/captains")
def assign_captain(
    event_id: str,
    court_id: str,
    body: AssignCaptainRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Asigna un capitán a una cancha específica. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Validar que el usuario existe y está activo
        user = conn.execute(text("""
            SELECT id, full_name, is_active FROM public.users WHERE id = :user_id
        """), {"user_id": body.user_id}).mappings().first()

        if not user:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        if not user["is_active"]:
            raise HTTPException(status_code=400, detail="El usuario está inactivo.")

        # Validar que la cancha pertenece al evento
        court = conn.execute(text("""
            SELECT id FROM public.event_courts WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id}).first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada en este evento.")

    with engine.begin() as conn:
        try:
            conn.execute(text("""
                INSERT INTO public.event_court_captains (event_id, court_id, user_id, created_at)
                VALUES (:event_id, :court_id, :user_id, now())
            """), {
                "event_id": event_id,
                "court_id": court_id,
                "user_id": body.user_id
            })
        except IntegrityError:
            raise HTTPException(
                status_code=409,
                detail="El usuario ya es capitán de esta cancha."
            )

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'ASSIGN_CAPTAIN', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_id": "{court_id}", "captain_user_id": "{body.user_id}"}}'
        })

    return {
        "event_id": event_id,
        "court_id": court_id,
        "captain_user_id": body.user_id,
        "message": f"Capitán {user['full_name']} asignado exitosamente."
    }


@router.delete("/events/{event_id}/courts/{court_id}/captains/{user_id}")
def remove_captain(
    event_id: str,
    court_id: str,
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Quita un capitán de una cancha. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar que el capitán existe
        captain = conn.execute(text("""
            SELECT 1 FROM public.event_court_captains
            WHERE event_id = :event_id AND court_id = :court_id AND user_id = :user_id
        """), {
            "event_id": event_id,
            "court_id": court_id,
            "user_id": user_id
        }).first()

        if not captain:
            raise HTTPException(
                status_code=404,
                detail="El usuario no es capitán de esta cancha."
            )

    with engine.begin() as conn:
        conn.execute(text("""
            DELETE FROM public.event_court_captains
            WHERE event_id = :event_id AND court_id = :court_id AND user_id = :user_id
        """), {
            "event_id": event_id,
            "court_id": court_id,
            "user_id": user_id
        })

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'REMOVE_CAPTAIN', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_id": "{court_id}", "captain_user_id": "{user_id}"}}'
        })

    return {
        "event_id": event_id,
        "court_id": court_id,
        "captain_user_id": user_id,
        "message": "Capitán removido exitosamente."
    }


@router.post("/events/{event_id}/courts/{court_id}/open")
def open_court(
    event_id: str,
    court_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Abre una cancha cerrada. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar que la cancha existe
        court = conn.execute(text("""
            SELECT is_open FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada.")

        if court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha ya está abierta.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.event_courts
            SET is_open = true, updated_at = now()
            WHERE id = :court_id
        """), {"court_id": court_id})

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'OPEN_COURT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_id": "{court_id}"}}'
        })

    return {
        "event_id": event_id,
        "court_id": court_id,
        "is_open": True,
        "message": "Cancha abierta exitosamente."
    }


@router.post("/events/{event_id}/courts/{court_id}/close")
def close_court(
    event_id: str,
    court_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Cierra una cancha manualmente. Solo admin/super_admin.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        # Verificar que la cancha existe
        court = conn.execute(text("""
            SELECT is_open FROM public.event_courts
            WHERE id = :court_id AND event_id = :event_id
        """), {"court_id": court_id, "event_id": event_id}).mappings().first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada.")

        if not court["is_open"]:
            raise HTTPException(status_code=400, detail="La cancha ya está cerrada.")

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE public.event_courts
            SET is_open = false, updated_at = now()
            WHERE id = :court_id
        """), {"court_id": court_id})

        # Audit log
        conn.execute(text("""
            INSERT INTO public.event_audit_log (
                event_id, actor_user_id, action, metadata
            )
            VALUES (
                :event_id, :actor_user_id, 'CLOSE_COURT', CAST(:metadata AS jsonb)
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "metadata": f'{{"court_id": "{court_id}"}}'
        })

    return {
        "event_id": event_id,
        "court_id": court_id,
        "is_open": False,
        "message": "Cancha cerrada exitosamente."
    }


@router.get("/events/{event_id}/detail")
def get_event_detail(
    event_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Devuelve el detalle completo de un evento: evento + canchas + jugadores + waitlist.
    Solo admin/super_admin. Mismo formato que /events/active pero para cualquier evento.
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        event = conn.execute(text("""
            SELECT id, title, starts_at, location_name, status, close_at
            FROM public.events
            WHERE id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")

        courts = conn.execute(text("""
            SELECT id, name, capacity, is_open, sort_order
            FROM public.event_courts
            WHERE event_id = :event_id
            ORDER BY sort_order ASC
        """), {"event_id": event_id}).mappings().all()

        confirmed = conn.execute(text("""
            SELECT
              r.id AS registration_id,
              r.court_id,
              r.registration_type,
              r.status,
              r.created_at,
              r.created_by_user_id,
              r.user_id,
              r.guest_name,
              u.full_name AS user_full_name
            FROM public.event_registrations r
            LEFT JOIN public.users u ON u.id = r.user_id
            WHERE r.event_id = :event_id
              AND r.status = 'CONFIRMED'
              AND r.court_id IS NOT NULL
            ORDER BY r.created_at ASC
        """), {"event_id": event_id}).mappings().all()

        waitlist = conn.execute(text("""
            SELECT
              r.id AS registration_id,
              r.registration_type,
              r.status,
              r.created_at,
              r.created_by_user_id,
              r.user_id,
              r.guest_name,
              u.full_name AS user_full_name
            FROM public.event_registrations r
            LEFT JOIN public.users u ON u.id = r.user_id
            WHERE r.event_id = :event_id
              AND r.status = 'WAITLIST'
              AND r.court_id IS NULL
            ORDER BY r.created_at ASC
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
                "sort_order": c["sort_order"],
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


@router.get("/events")
def list_events(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    status: str | None = None,
    include_finalized: bool = False,
    limit: int = 50
):
    """
    Lista todos los eventos. Solo admin/super_admin.
    Opcionalmente filtra por status.
    Por defecto excluye eventos FINALIZED (salvo que se pida explícitamente).
    """
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        where_conditions = []
        params = {"limit": limit}

        if status:
            where_conditions.append("status = :status")
            params["status"] = status
        elif not include_finalized:
            where_conditions.append("status != 'FINALIZED'")

        where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""

        query = f"""
            SELECT id, title, starts_at, location_name, status, close_at, created_at
            FROM public.events
            {where_clause}
            ORDER BY starts_at DESC
            LIMIT :limit
        """

        events = conn.execute(text(query), params).mappings().all()

        return {
            "events": [
                {
                    "id": str(e["id"]),
                    "title": e["title"],
                    "starts_at": str(e["starts_at"]),
                    "location_name": e["location_name"],
                    "status": e["status"],
                    "close_at": str(e["close_at"]) if e["close_at"] else None,
                    "created_at": str(e["created_at"])
                }
                for e in events
            ],
            "count": len(events)
        }
