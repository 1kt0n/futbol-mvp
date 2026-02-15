from fastapi import APIRouter, HTTPException, Header
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.settings import engine
from app.schemas import RegisterRequest, GuestRequest, MoveRequest, PlayerCardsResponse

router = APIRouter()


# =========================
# Helper Functions
# =========================

def assert_can_move(conn, event_id: str, actor_user_id: str):
    """
    Valida que el actor sea admin/super_admin o capitán del evento.
    Lanza HTTPException si no tiene permisos.
    """
    is_admin = conn.execute(text("""
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = :actor_user_id
          and LOWER(r.code) IN ('admin', 'super_admin')
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


def check_and_auto_close_court(event_id: str, court_id: str, actor_user_id: str):
    """
    Verifica si una cancha específica está llena.
    Si está llena, cierra la cancha (is_open=false).
    Luego verifica si TODAS las canchas del evento están cerradas/llenas.
    Si es así, cierra automáticamente el evento (status=CLOSED).
    """
    with engine.begin() as conn:
        # 1. Chequear si la cancha específica está llena
        court_status = conn.execute(text("""
            SELECT
                ec.capacity,
                ec.is_open,
                COUNT(er.id) FILTER (WHERE er.status = 'CONFIRMED') as occupied
            FROM public.event_courts ec
            LEFT JOIN public.event_registrations er ON er.court_id = ec.id
            WHERE ec.id = :court_id AND ec.event_id = :event_id
            GROUP BY ec.id, ec.capacity, ec.is_open
        """), {"court_id": court_id, "event_id": event_id}).mappings().first()

        if not court_status:
            return

        # Si la cancha está llena y aún abierta, cerrarla
        if court_status["is_open"] and court_status["occupied"] >= court_status["capacity"]:
            conn.execute(text("""
                UPDATE public.event_courts
                SET is_open = false, updated_at = now()
                WHERE id = :court_id
            """), {"court_id": court_id})

            conn.execute(text("""
                INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
                VALUES (:event_id, :actor_user_id, 'AUTO_CLOSE_COURT', CAST(:metadata AS jsonb))
            """), {
                "event_id": event_id,
                "actor_user_id": actor_user_id,
                "metadata": f'{{"court_id": "{court_id}", "reason": "capacity_reached"}}'
            })

        # 2. Verificar si TODAS las canchas están cerradas o llenas
        all_courts = conn.execute(text("""
            SELECT
                ec.id,
                ec.capacity,
                ec.is_open,
                COUNT(er.id) FILTER (WHERE er.status = 'CONFIRMED') as occupied
            FROM public.event_courts ec
            LEFT JOIN public.event_registrations er ON er.court_id = ec.id
            WHERE ec.event_id = :event_id
            GROUP BY ec.id, ec.capacity, ec.is_open
        """), {"event_id": event_id}).mappings().all()

        if not all_courts:
            return

        # Una cancha está "cerrada efectivamente" si is_open=false O si está llena
        all_closed = all(
            not court["is_open"] or court["occupied"] >= court["capacity"]
            for court in all_courts
        )

        if all_closed:
            # Auto-cerrar evento
            conn.execute(text("""
                UPDATE public.events SET status = 'CLOSED', updated_at = now()
                WHERE id = :event_id AND status = 'OPEN'
            """), {"event_id": event_id})

            conn.execute(text("""
                INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
                VALUES (:event_id, :actor_user_id, 'AUTO_CLOSE_EVENT', '{"reason": "all_courts_closed_or_full"}'::jsonb)
            """), {"event_id": event_id, "actor_user_id": actor_user_id})


# =========================
# Endpoints
# =========================

@router.get("/events/open")
def list_open_events(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Devuelve la lista de todos los eventos OPEN o CLOSED (sin FINALIZED).
    Solo metadata básica, sin detalle de canchas/jugadores.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            select id, title, starts_at, location_name, status, close_at
            from public.events
            where status IN ('OPEN', 'CLOSED')
            order by starts_at desc
        """)).mappings().all()

        return {
            "events": [
                {
                    "id": str(r["id"]),
                    "title": r["title"],
                    "starts_at": str(r["starts_at"]),
                    "location_name": r["location_name"],
                    "status": r["status"],
                    "close_at": str(r["close_at"]) if r["close_at"] else None,
                }
                for r in rows
            ]
        }


@router.get("/events/active")
def get_active_event(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    event_id: str | None = None,
):
    """
    Devuelve un evento activo (OPEN o CLOSED), sus canchas, jugadores confirmados y waitlist.
    Si se pasa event_id, devuelve ese evento específico.
    Si no, devuelve el más reciente (por starts_at DESC).
    No incluye eventos FINALIZED.
    """
    with engine.connect() as conn:
        if event_id:
            event = conn.execute(text("""
                select id, title, starts_at, location_name, status, close_at
                from public.events
                where id = :event_id
                  and status IN ('OPEN', 'CLOSED')
            """), {"event_id": event_id}).mappings().first()
        else:
            event = conn.execute(text("""
                select id, title, starts_at, location_name, status, close_at
                from public.events
                where status IN ('OPEN', 'CLOSED')
                order by starts_at desc
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
              u.full_name as user_full_name,
              u.avatar_url as user_avatar_url,
              u.player_level as user_player_level
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
              u.full_name as user_full_name,
              u.avatar_url as user_avatar_url,
              u.player_level as user_player_level
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
                "user_id": str(r["user_id"]) if r["registration_type"] == "USER" and r["user_id"] else None,
                "name": r["user_full_name"] if r["registration_type"] == "USER" else r["guest_name"],
                "avatar_url": r["user_avatar_url"] if r["registration_type"] == "USER" else None,
                "player_level": r["user_player_level"] if r["registration_type"] == "USER" else None,
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
            "user_id": str(r["user_id"]) if r["registration_type"] == "USER" and r["user_id"] else None,
            "name": r["user_full_name"] if r["registration_type"] == "USER" else r["guest_name"],
            "avatar_url": r["user_avatar_url"] if r["registration_type"] == "USER" else None,
            "player_level": r["user_player_level"] if r["registration_type"] == "USER" else None,
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


@router.get("/events/{event_id}/courts/{court_id}/player-cards", response_model=PlayerCardsResponse)
def get_player_cards(
    event_id: str,
    court_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Devuelve cards de jugadores de una cancha, respetando privacy por ranking_opt_in.
    """
    with engine.connect() as conn:
        viewer = conn.execute(text("""
            SELECT id, ranking_opt_in
            FROM public.users
            WHERE id = :actor_user_id
            LIMIT 1
        """), {"actor_user_id": actor_user_id}).mappings().first()

        if not viewer:
            raise HTTPException(status_code=404, detail="Usuario actor no encontrado.")

        court = conn.execute(text("""
            SELECT id
            FROM public.event_courts
            WHERE id = :court_id
              AND event_id = :event_id
            LIMIT 1
        """), {"court_id": court_id, "event_id": event_id}).first()

        if not court:
            raise HTTPException(status_code=404, detail="Cancha no encontrada para el evento.")

        roster = conn.execute(text("""
            SELECT
              r.id                 AS registration_id,
              r.registration_type,
              r.user_id,
              r.guest_name,
              r.created_at,
              u.full_name          AS user_full_name,
              u.player_level       AS user_player_level,
              u.ranking_opt_in     AS target_opt_in
            FROM public.event_registrations r
            LEFT JOIN public.users u
              ON u.id = r.user_id
            WHERE r.event_id = :event_id
              AND r.court_id = :court_id
              AND r.status = 'CONFIRMED'
              AND r.registration_type IN ('USER', 'GUEST')
            ORDER BY r.created_at ASC
        """), {"event_id": event_id, "court_id": court_id}).mappings().all()

        viewer_opt_in = bool(viewer["ranking_opt_in"])
        cards = []
        metrics_user_ids = []

        for row in roster:
            registration_id = str(row["registration_id"])
            subject_type = row["registration_type"]

            if subject_type == "GUEST":
                cards.append({
                    "registration_id": registration_id,
                    "subject_type": "GUEST",
                    "guest_name": row["guest_name"],
                    "participates": False,
                    "reason": "GUEST",
                })
                continue

            user_id = str(row["user_id"])
            card = {
                "registration_id": registration_id,
                "subject_type": "USER",
                "user_id": user_id,
                "full_name": row["user_full_name"],
                "player_level": row["user_player_level"],
            }

            target_opt_in = bool(row["target_opt_in"])
            if not viewer_opt_in:
                card["participates"] = False
                card["reason"] = "VIEWER_OPT_OUT"
            elif not target_opt_in:
                card["participates"] = False
                card["reason"] = "TARGET_OPT_OUT"
            else:
                card["participates"] = True
                metrics_user_ids.append(user_id)

            cards.append(card)

        metrics_user_ids = list(dict.fromkeys(metrics_user_ids))
        ratings_map = {}
        attrs_map = {}

        if metrics_user_ids:
            rating_rows = conn.execute(text("""
                SELECT
                  target_user_id,
                  ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                  COUNT(*)                       AS votes
                FROM public.player_ratings
                WHERE target_user_id = ANY(CAST(:target_ids AS uuid[]))
                  AND is_hidden = false
                GROUP BY target_user_id
            """), {"target_ids": metrics_user_ids}).mappings().all()

            ratings_map = {
                str(r["target_user_id"]): {
                    "avg": float(r["avg_rating"]) if r["avg_rating"] is not None else 0.0,
                    "votes": int(r["votes"] or 0),
                }
                for r in rating_rows
            }

            attr_rows = conn.execute(text("""
                SELECT
                  pr.target_user_id,
                  attr.attribute AS code,
                  COUNT(*)       AS count
                FROM public.player_ratings pr
                JOIN LATERAL jsonb_array_elements_text(pr.attributes) attr(attribute)
                  ON true
                WHERE pr.target_user_id = ANY(CAST(:target_ids AS uuid[]))
                  AND pr.is_hidden = false
                  AND jsonb_typeof(pr.attributes) = 'array'
                GROUP BY pr.target_user_id, attr.attribute
                ORDER BY pr.target_user_id, count DESC, attr.attribute ASC
            """), {"target_ids": metrics_user_ids}).mappings().all()

            for row in attr_rows:
                uid = str(row["target_user_id"])
                attrs_map.setdefault(uid, []).append({
                    "code": str(row["code"]),
                    "count": int(row["count"] or 0),
                })

        for card in cards:
            if card.get("subject_type") != "USER" or not card.get("participates"):
                continue
            uid = card["user_id"]
            card["rating"] = ratings_map.get(uid, {"avg": 0.0, "votes": 0})
            card["top_attributes"] = (attrs_map.get(uid) or [])[:4]

        return {
            "viewer": {
                "user_id": str(viewer["id"]),
                "ranking_opt_in": viewer_opt_in,
            },
            "cards": cards,
        }


@router.post("/events/{event_id}/register")
def register_user(
    event_id: str,
    body: RegisterRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    El actor (header) se auto-anota en el evento.
    Si hay cupo, se confirma; si no, va a waitlist.
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

    # Chequear si la cancha está llena para auto-cerrarla (y el evento si corresponde)
    if reg["status"] == "CONFIRMED":
        check_and_auto_close_court(event_id, body.court_id, actor_user_id)

    return {
        "registration_id": str(reg["id"]),
        "status": reg["status"],
        "court_id": str(reg["court_id"]) if reg["court_id"] else None,
        "created_at": str(reg["created_at"]),
        "message": "Inscripción confirmada" if reg["status"] == "CONFIRMED" else "Agregado a lista de espera",
    }


@router.post("/events/{event_id}/guests")
def register_guest(
    event_id: str,
    body: GuestRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Registra un invitado en una cancha (sin sobrecupo).
    Límite: 10 invitados por actor/evento.
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

        # Límite 10 invitados por actor/evento (no cuenta CANCELLED)
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

    # Chequear si la cancha está llena para auto-cerrarla (y el evento si corresponde)
    check_and_auto_close_court(event_id, body.court_id, actor_user_id)

    return {
        "registration_id": str(reg["id"]),
        "status": reg["status"],
        "court_id": str(reg["court_id"]),
        "created_at": str(reg["created_at"]),
        "guest_name": body.guest_name.strip(),
        "message": "Invitado confirmado"
    }


@router.post("/registrations/{registration_id}/move")
def move_registration(
    registration_id: str,
    body: MoveRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Mueve una inscripción CONFIRMED de una cancha a otra.
    Solo admin/super_admin o capitán del evento.
    Promueve desde waitlist a la cancha liberada si hay cupo.
    """
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

        # Validar que el evento no está finalizado (permitir OPEN y CLOSED)
        event = conn.execute(text("""
            select status
            from public.events
            where id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event or event["status"] == "FINALIZED":
            raise HTTPException(status_code=400, detail="El evento está finalizado. No se pueden realizar cambios.")

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


@router.post("/registrations/{registration_id}/cancel")
def cancel_registration(
    registration_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id")
):
    """
    Cancela una inscripción.
    Solo admin/super_admin o capitán del evento.
    Promueve desde waitlist si se libera un cupo.
    """
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

        # Validar que el evento no está finalizado (permitir OPEN y CLOSED)
        event = conn.execute(text("""
            select status
            from public.events
            where id = :event_id
        """), {"event_id": event_id}).mappings().first()

        if not event or event["status"] == "FINALIZED":
            raise HTTPException(status_code=400, detail="El evento está finalizado. No se pueden cancelar inscripciones.")

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
