
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends, Request
from app.utils.deps import get_actor_user_id
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import settings
from app.settings import engine
from app.schemas import RegisterRequest, GuestRequest, MoveRequest, CancelRequest, PlayerCardsResponse
from app.utils.permissions import get_effective_permissions
from app.utils.scoring import score_payload, attribute_profile, MIN_DISTINCT_VOTERS, RECENCY_DECAY_PER_DAY
from app.utils.ratelimit import rate_limit, client_ip
from app.utils.auto_finalize import auto_finalize_if_due
from app.utils.audit import write_audit
from app.utils.courts import alternatives as court_alternatives, eligible_courts, is_pseudo_court, pick_first_free

router = APIRouter()


# =========================
# Helper Functions
# =========================

def lock_event_occupancy(conn, event_id) -> None:
    """
    Serializa todo lo que cambia la ocupación de un partido: altas, invitados,
    bajas, mover, externos y los cambios de canchas del admin (crear, editar,
    abrir, cerrar, borrar). Va antes que cualquier FOR UPDATE de la transacción.
    Sin esto, una baja y un alta a la vez podían dejar un lugar libre con alguien
    en la espera: el alta contaba la cancha sin ver la baja y la promoción corría
    antes de que existiera la fila en espera.
    """
    try:
        key = str(UUID(str(event_id)))  # mismo lock para "ABC…" que para "abc…"
    except ValueError:
        key = str(event_id)
    conn.execute(text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
                 {"lock_key": f"occupancy:{key}"})


def _event_courts(conn, event_id) -> list:
    """Canchas del partido en el orden de siempre: (sort_order, created_at, id)."""
    return conn.execute(text("""
        select id, name, capacity, is_open
        from public.event_courts
        where event_id = :event_id
        order by sort_order asc, created_at asc, id asc
    """), {"event_id": event_id}).mappings().all()


def _occupied_by_court(conn, event_id) -> dict:
    rows = conn.execute(text("""
        select court_id::text as court_id, count(*)::int as cnt
        from public.event_registrations
        where event_id = :event_id and status = 'CONFIRMED' and court_id is not null
        group by court_id
    """), {"event_id": event_id}).mappings().all()
    return {r["court_id"]: r["cnt"] for r in rows}


def _assert_can_auto_assign(courts: list) -> None:
    """Sin cancha elegida: el flag tiene que estar prendido y tiene que haber dónde anotar."""
    if not settings.ONE_TAP_REGISTER_ENABLED:
        raise HTTPException(status_code=400, detail="Elegí una cancha.")
    if not courts:
        raise HTTPException(status_code=400, detail="El partido todavía no tiene canchas.")
    if not any(c["is_open"] for c in eligible_courts(courts)):
        raise HTTPException(status_code=400, detail="La inscripción está cerrada.")


def _lock_court(conn, event_id, court_id):
    return conn.execute(text("""
        select id, name, capacity, is_open
        from public.event_courts
        where id = :court_id and event_id = :event_id
        for update
    """), {"court_id": court_id, "event_id": event_id}).mappings().first()


def _count_confirmed(conn, event_id, court_id) -> int:
    return conn.execute(text("""
        select count(*)::int as cnt
        from public.event_registrations
        where event_id = :event_id and court_id = :court_id and status = 'CONFIRMED'
    """), {"event_id": event_id, "court_id": court_id}).mappings().first()["cnt"]


def _lock_registration_event(conn, registration_id) -> None:
    """Toma el lock del partido de una inscripción antes de bloquear la fila."""
    event_id = conn.execute(text("""
        select event_id from public.event_registrations where id = :registration_id
    """), {"registration_id": registration_id}).scalar()
    if event_id:
        lock_event_occupancy(conn, event_id)


def _has_manage_permission(conn, actor_user_id: str) -> bool:
    perms = get_effective_permissions(conn, actor_user_id)
    return "*" in perms or "registrations.manage" in perms


def _captain_court_ids(conn, event_id: str, actor_user_id: str) -> set[str]:
    """Canchas del evento donde el actor es capitán (event_court_captains)."""
    rows = conn.execute(text("""
        select court_id::text as court_id
        from public.event_court_captains
        where event_id = :event_id and user_id = :actor_user_id
    """), {"event_id": event_id, "actor_user_id": actor_user_id}).mappings().all()
    return {r["court_id"] for r in rows}


def _is_legacy_event_captain(conn, event_id: str, actor_user_id: str) -> bool:
    """event_captains ya no se escribe; se mantiene como OR por compatibilidad."""
    return bool(conn.execute(text("""
        select 1
        from public.event_captains
        where event_id = :event_id and user_id = :actor_user_id
        limit 1
    """), {"event_id": event_id, "actor_user_id": actor_user_id}).first())


def can_cancel_registration(conn, reg, actor_user_id: str) -> str | None:
    """
    Devuelve por qué el actor puede dar de baja la inscripción (va al audit como
    `source`) o None si no puede. `reg` necesita event_id, court_id,
    registration_type, user_id y created_by_user_id.
    """
    actor = str(actor_user_id)
    event_id = str(reg["event_id"])
    if reg["registration_type"] == "USER" and reg["user_id"] and str(reg["user_id"]) == actor:
        return "self"
    if reg["registration_type"] == "GUEST" and reg["created_by_user_id"] and str(reg["created_by_user_id"]) == actor:
        return "guest_owner"
    if _has_manage_permission(conn, actor):
        return "admin"
    if reg["court_id"] and str(reg["court_id"]) in _captain_court_ids(conn, event_id, actor):
        return "captain"
    if _is_legacy_event_captain(conn, event_id, actor):
        return "legacy_captain"
    return None


def can_move_registration(conn, reg, to_court_id: str, actor_user_id: str) -> str | None:
    """Como can_cancel_registration, pero el capitán puede ser de la cancha de origen o de la de destino."""
    actor = str(actor_user_id)
    event_id = str(reg["event_id"])
    if _has_manage_permission(conn, actor):
        return "admin"
    captain_courts = _captain_court_ids(conn, event_id, actor)
    if str(reg["court_id"]) in captain_courts or str(to_court_id) in captain_courts:
        return "captain"
    if _is_legacy_event_captain(conn, event_id, actor):
        return "legacy_captain"
    return None


def _forbidden(conn, event_id) -> HTTPException:
    """403 para quien no puede tocar la inscripción: dice a quién pedirle el cambio."""
    row = conn.execute(text("""
        select u.full_name
        from public.events e
        join public.users u on u.id = e.created_by_user_id
        where e.id = :event_id
    """), {"event_id": event_id}).mappings().first()
    first_name = ((row["full_name"] if row else "") or "").strip().split(" ")[0][:20]
    return HTTPException(
        status_code=403,
        detail="Esto lo puede hacer quien organiza el partido. Si necesitás un cambio, "
               f"escribile a {first_name or 'quien organiza'}.",
    )


def audit_court_full_if_filled(conn, event_id, court_id, occupied_after: int, capacity: int, actor_user_id, source: str):
    """
    Audita COURT_FULL cuando un alta deja la cancha justo en el cupo. Se llama
    dentro de la transacción del alta, con la cancha bloqueada (FOR UPDATE), así
    que se escribe una sola vez por cada paso de "con lugar" a "llena".
    """
    if occupied_after != capacity:
        return
    write_audit(conn, event_id=event_id, actor_user_id=actor_user_id, action="COURT_FULL",
                metadata={"court_id": str(court_id), "capacity": capacity, "source": source})


def check_and_auto_close_court(event_id: str, court_id: str, actor_user_id: str):
    """
    Verifica si una cancha específica está llena.
    Si está llena, cierra la cancha (is_open=false).
    Luego verifica si TODAS las canchas del evento están cerradas/llenas.
    Si es así, cierra automáticamente el evento (status=CLOSED).
    Solo con AUTO_CLOSE_ON_FULL=true: por default la cancha llena queda abierta
    y las altas siguientes van a la lista de espera.
    """
    if not settings.AUTO_CLOSE_ON_FULL:
        return
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
                VALUES (:event_id, :actor_user_id, 'AUTO_CLOSE_COURT',
                        jsonb_build_object('court_id', CAST(:court_id AS text), 'reason', 'capacity_reached'))
            """), {
                "event_id": event_id,
                "actor_user_id": actor_user_id,
                "court_id": str(court_id),
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


def promote_first_waitlist(conn, event_id, freed_court_id, actor_user_id, source="auto"):
    """
    Promueve la primera inscripción en WAITLIST a la cancha liberada, si hay cupo.
    Devuelve el id promovido o None. Debe llamarse dentro de una transacción.
    Reusa la regla de orden actual (created_at asc). actor_user_id puede ser None
    (acciones del sistema, p.ej. cancelación de un externo).
    """
    if not freed_court_id:
        return None

    wait = conn.execute(text("""
        select id from public.event_registrations
        where event_id = :event_id and status = 'WAITLIST' and court_id is null
        order by created_at asc limit 1 for update
    """), {"event_id": event_id}).mappings().first()
    if not wait:
        return None

    court = conn.execute(text("""
        select capacity, is_open from public.event_courts
        where id = :court_id and event_id = :event_id for update
    """), {"court_id": freed_court_id, "event_id": event_id}).mappings().first()
    if not court or not court["is_open"]:
        return None

    occupied = conn.execute(text("""
        select count(*)::int as cnt from public.event_registrations
        where event_id = :event_id and court_id = :court_id and status = 'CONFIRMED'
    """), {"event_id": event_id, "court_id": freed_court_id}).mappings().first()["cnt"]
    if occupied >= court["capacity"]:
        return None

    conn.execute(text("""
        update public.event_registrations
        set status = 'CONFIRMED', court_id = :court_id, updated_at = now()
        where id = :wait_id
    """), {"court_id": freed_court_id, "wait_id": wait["id"]})

    write_audit(conn, event_id=event_id, actor_user_id=actor_user_id, action="PROMOTE_WAITLIST",
                target_registration_id=wait["id"], metadata={"source": source})
    return wait["id"]


def fill_from_waitlist(conn, event_id, court_id, actor_user_id, source: str) -> list:
    """Promueve de la espera a la cancha mientras tenga lugar. Devuelve los ids promovidos."""
    promoted = []
    while True:
        promoted_id = promote_first_waitlist(conn, event_id, court_id, actor_user_id, source=source)
        if not promoted_id:
            return promoted
        promoted.append(promoted_id)


# =========================
# Endpoints
# =========================

@router.get("/events/open")
def list_open_events(actor_user_id: str = Depends(get_actor_user_id)):
    """
    Devuelve la lista de todos los eventos OPEN o CLOSED (sin FINALIZED), en
    orden cronológico. Solo metadata básica, sin detalle de canchas/jugadores.
    """
    auto_finalize_if_due()
    with engine.connect() as conn:
        rows = conn.execute(text("""
            select id, title, starts_at, location_name, status, close_at
            from public.events
            where status IN ('OPEN', 'CLOSED')
            order by starts_at asc
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
    actor_user_id: str = Depends(get_actor_user_id),
    event_id: UUID | None = None,
    include_finished: bool = False,
):
    """
    Devuelve un evento activo (OPEN o CLOSED), sus canchas, jugadores confirmados y waitlist.
    Si se pasa event_id, devuelve ese evento específico.
    Si no, devuelve el próximo: el primero que empieza desde hace 3 h en adelante
    o, si no hay ninguno, el más reciente.
    No incluye eventos FINALIZED, salvo con event_id + include_finished=1 (la
    pantalla del partido muestra también los ya jugados).
    """
    auto_finalize_if_due()
    with engine.connect() as conn:
        if event_id:
            event = conn.execute(text("""
                select id, title, description, starts_at, location_name, status, close_at
                from public.events
                where id = :event_id
                  and (:include_finished or status IN ('OPEN', 'CLOSED'))
            """), {"event_id": event_id, "include_finished": include_finished}).mappings().first()
        else:
            event = conn.execute(text("""
                select id, title, description, starts_at, location_name, status, close_at
                from public.events
                where status IN ('OPEN', 'CLOSED')
                order by (starts_at < now() - interval '3 hours'),
                         case when starts_at >= now() - interval '3 hours' then starts_at end asc,
                         starts_at desc
                limit 1
            """)).mappings().first()

        if not event:
            return {"event": None, "courts": [], "waitlist": []}

        event_id = event["id"]

        courts = conn.execute(text("""
            select id, name, capacity, is_open, sort_order
            from public.event_courts
            where event_id = :event_id
            order by sort_order asc, created_at asc, id asc
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
              u.player_level as user_player_level,
              cb.full_name as created_by_full_name
            from public.event_registrations r
            left join public.users u on u.id = r.user_id
            left join public.users cb on cb.id = r.created_by_user_id
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
              u.player_level as user_player_level,
              cb.full_name as created_by_full_name
            from public.event_registrations r
            left join public.users u on u.id = r.user_id
            left join public.users cb on cb.id = r.created_by_user_id
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
                "created_by_user_id": str(r["created_by_user_id"]) if r["created_by_user_id"] else None,
                "created_by_name": r["created_by_full_name"],
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
                # Lista de espera armada a mano ("Suplentes"): no entra en la primera libre.
                "is_pseudo": is_pseudo_court(c["name"]),
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
            "created_by_user_id": str(r["created_by_user_id"]) if r["created_by_user_id"] else None,
            "created_by_name": r["created_by_full_name"],
        } for r in waitlist]

        return {
            "event": {
                "id": str(event["id"]),
                "title": event["title"],
                "description": event["description"],
                "starts_at": str(event["starts_at"]),
                "location_name": event["location_name"],
                "status": event["status"],
                "close_at": str(event["close_at"]) if event["close_at"] else None,
            },
            "courts": courts_payload,
            "waitlist": waitlist_payload,
            # Para que la UI muestre Baja/Mover a los capitanes de cada cancha.
            "viewer": {
                "user_id": str(actor_user_id),
                "captain_court_ids": sorted(_captain_court_ids(conn, str(event_id), actor_user_id)),
                "is_event_captain": _is_legacy_event_captain(conn, str(event_id), actor_user_id),
                "registration": _viewer_registration(conn, event_id, actor_user_id, waitlist_payload),
            },
        }


def _viewer_registration(conn, event_id, actor_user_id, waitlist_payload) -> dict | None:
    """
    La inscripción propia (no cancelada) para la pantalla del partido, con el
    puesto en la espera y, si entró desde la espera, cuándo (para el banner
    "¡Se liberó un lugar y entraste!").
    """
    row = conn.execute(text("""
        select r.id, r.status, r.court_id,
               case when r.status = 'CONFIRMED' then
                 (select max(a.created_at)
                    from public.event_audit_log a
                   where a.event_id = r.event_id
                     and a.target_registration_id = r.id
                     and a.action = 'PROMOTE_WAITLIST'
                     and a.created_at >= r.created_at)
               end as promoted_at
        from public.event_registrations r
        where r.event_id = :event_id
          and r.user_id = :actor_user_id
          and r.registration_type = 'USER'
          and r.status <> 'CANCELLED'
        order by r.created_at desc
        limit 1
    """), {"event_id": event_id, "actor_user_id": actor_user_id}).mappings().first()
    if not row:
        return None
    registration_id = str(row["id"])
    position = next((i + 1 for i, w in enumerate(waitlist_payload)
                     if w["registration_id"] == registration_id), None)
    return {
        "registration_id": registration_id,
        "status": row["status"],
        "court_id": str(row["court_id"]) if row["court_id"] else None,
        "waitlist_position": position if row["status"] == "WAITLIST" else None,
        "promoted_at": str(row["promoted_at"]) if row["promoted_at"] and row["status"] == "CONFIRMED" else None,
    }


@router.get("/events/{event_id}/courts/{court_id}/player-cards", response_model=PlayerCardsResponse)
def get_player_cards(
    event_id: str,
    court_id: str,
    actor_user_id: str = Depends(get_actor_user_id),
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
              u.ranking_opt_in     AS target_opt_in,
              cb.full_name         AS created_by_full_name
            FROM public.event_registrations r
            LEFT JOIN public.users u
              ON u.id = r.user_id
            LEFT JOIN public.users cb
              ON cb.id = r.created_by_user_id
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
                    "invited_by_name": row["created_by_full_name"],
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
            global_mean = conn.execute(text("""
                SELECT AVG(rating) FROM public.player_ratings WHERE is_hidden = false
            """)).scalar()

            rating_rows = conn.execute(text("""
                SELECT
                  target_user_id,
                  ROUND(AVG(rating)::numeric, 1)   AS avg_rating,
                  COUNT(*)                         AS votes,
                  COUNT(DISTINCT voter_user_id)    AS voters,
                  COALESCE(SUM(rating * exp(-:decay * EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)), 0) AS weighted_sum,
                  COALESCE(SUM(exp(-:decay * EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)), 0)          AS weight_total
                FROM public.player_ratings
                WHERE target_user_id = ANY(CAST(:target_ids AS uuid[]))
                  AND is_hidden = false
                GROUP BY target_user_id
            """), {"target_ids": metrics_user_ids, "decay": RECENCY_DECAY_PER_DAY}).mappings().all()

            ratings_map = {}
            for r in rating_rows:
                payload = score_payload(
                    r["votes"], r["voters"], r["weighted_sum"],
                    r["weight_total"], r["avg_rating"], global_mean,
                )
                ratings_map[str(r["target_user_id"])] = {
                    "avg": float(r["avg_rating"]) if r["avg_rating"] is not None else 0.0,
                    "votes": int(r["votes"] or 0),
                    **payload,
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
            card["rating"] = ratings_map.get(uid, {
                "avg": 0.0, "votes": 0, "voters": 0,
                "score": None, "calibrating": True,
                "min_voters": MIN_DISTINCT_VOTERS, "suggested_level": None, "form": None,
            })
            card["top_attributes"] = (attrs_map.get(uid) or [])[:4]
            # Perfil de 6 ejes para el radar (M5).
            counts = {a["code"]: a["count"] for a in (attrs_map.get(uid) or [])}
            card["attribute_profile"] = attribute_profile(counts, card["rating"].get("votes", 0))

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
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    El actor (header) se auto-anota en el evento.
    - Sin court_id ("Me anoto", ONE_TAP_REGISTER_ENABLED): entra en la primera
      cancha abierta y con lugar, sin pseudo-canchas, en orden (sort_order,
      created_at, id). Si está todo lleno, va a la espera.
    - Con court_id: si hay cupo, se confirma ahí; si está llena, va a la espera
      (if_full="waitlist", la Home vieja) o responde 409 COURT_FULL con las
      canchas que tienen lugar (if_full="conflict", la pantalla del partido).
    Si ya tenía una fila cancelada en el evento, la reusa con created_at=now():
    vuelve al final de la espera (el timestamp original queda en el audit).
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

        # También serializa dos altas del mismo jugador (p. ej. en canchas
        # distintas): no duplica la fila aunque la base no tenga un índice único.
        lock_event_occupancy(conn, event["id"])

        if body.court_id is None:
            courts = _event_courts(conn, event_id)
            _assert_can_auto_assign(courts)
            picked = pick_first_free(courts, _occupied_by_court(conn, event_id))
            court = _lock_court(conn, event_id, picked["id"]) if picked else None
            if court and not court["is_open"]:
                court = None  # la cerraron recién: va a la espera
            source, assigned = "one_tap", "auto"
        else:
            court = _lock_court(conn, event_id, body.court_id)
            if not court:
                raise HTTPException(status_code=404, detail="Cancha no encontrada para este evento")
            if not court["is_open"]:
                raise HTTPException(status_code=400, detail="La cancha está cerrada")
            source = "slot_pick" if body.if_full == "conflict" else "api"
            assigned = "chosen"

        existing = conn.execute(text("""
            select r.id, r.status, r.created_at, c.name as court_name
            from public.event_registrations r
            left join public.event_courts c on c.id = r.court_id
            where r.event_id = :event_id
              and r.user_id = :user_id
              and r.registration_type = 'USER'
            order by (r.status <> 'CANCELLED') desc,
                     coalesce(r.cancelled_at, r.updated_at, r.created_at) desc
            for update of r
        """), {"event_id": event_id, "user_id": actor_user_id}).mappings().all()

        active = next((r for r in existing if r["status"] != "CANCELLED"), None)
        if active:
            if active["status"] == "WAITLIST":
                detail = "Ya estás en la lista de espera de este partido."
            elif active["court_name"]:
                detail = f"Ya estás anotado en este partido ({active['court_name']})."
            else:
                detail = "Ya estás anotado en este partido."
            raise HTTPException(status_code=409, detail=detail)
        cancelled = existing[0] if existing else None

        occupied = _count_confirmed(conn, event_id, court["id"]) if court else 0
        has_capacity = bool(court) and occupied < court["capacity"]

        if court and not has_capacity and body.court_id is not None and body.if_full == "conflict":
            courts = _event_courts(conn, event_id)
            raise HTTPException(status_code=409, detail={
                "code": "COURT_FULL",
                "message": "Justo se llenó esa cancha.",
                "court_id": str(court["id"]),
                "court_name": court["name"],
                "alternatives": court_alternatives(courts, _occupied_by_court(conn, event_id),
                                                   exclude_court_id=court["id"]),
            })

        status = "CONFIRMED" if has_capacity else "WAITLIST"
        court_id_to_set = court["id"] if has_capacity else None
        audit_metadata = {
            "source": source,
            "assigned": assigned,
            "court_id": str(court_id_to_set) if court_id_to_set else None,
        }

        if cancelled:
            reg = conn.execute(text("""
                update public.event_registrations
                set status = :status,
                    court_id = :court_id,
                    created_by_user_id = :actor_user_id,
                    cancelled_at = null,
                    updated_at = now(),
                    created_at = now()
                where id = :registration_id
                returning id, status, court_id, created_at
            """), {
                "status": status,
                "court_id": court_id_to_set,
                "actor_user_id": actor_user_id,
                "registration_id": cancelled["id"],
            }).mappings().first()
            audit_metadata.update({"rejoin": True, "previous_created_at": str(cancelled["created_at"])})
        else:
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
                raise HTTPException(status_code=409, detail="Ya estás anotado en este partido.")

        write_audit(conn, event_id=event_id, actor_user_id=actor_user_id, action="REGISTER_USER",
                    target_registration_id=reg["id"], metadata=audit_metadata)

        waitlist_position = None
        if reg["status"] == "CONFIRMED":
            audit_court_full_if_filled(conn, event_id, court["id"], occupied + 1, court["capacity"],
                                       actor_user_id, source="register")
        else:
            waitlist_position = conn.execute(text("""
                select count(*)::int as cnt
                from public.event_registrations
                where event_id = :event_id and status = 'WAITLIST' and court_id is null
                  and created_at <= :created_at
            """), {"event_id": event_id, "created_at": reg["created_at"]}).mappings().first()["cnt"]

    # Con AUTO_CLOSE_ON_FULL=true, cierra la cancha llena (y el evento si corresponde)
    if reg["status"] == "CONFIRMED":
        check_and_auto_close_court(event_id, str(court["id"]), actor_user_id)

    confirmed = reg["status"] == "CONFIRMED"
    return {
        "registration_id": str(reg["id"]),
        "status": reg["status"],
        "court_id": str(reg["court_id"]) if reg["court_id"] else None,
        "court_name": court["name"] if confirmed else None,
        "assigned": assigned,
        "created_at": str(reg["created_at"]),
        "waitlist_position": waitlist_position,
        "message": "Inscripción confirmada" if confirmed else "Agregado a lista de espera",
    }


@router.post("/events/{event_id}/guests")
def register_guest(
    event_id: str,
    body: GuestRequest,
    request: Request,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Registra un invitado en una cancha (sin sobrecupo ni espera).
    Sin court_id (ONE_TAP_REGISTER_ENABLED): va a la cancha de quien invita si
    tiene lugar y, si no, a la primera libre (misma regla que "Me anoto").
    Límite: GUEST_LIMIT_PER_USER invitados por actor/evento; quien tiene
    registrations.manage no tiene tope.
    """
    # Anti-ráfaga: máx 15 invitados / minuto por actor e IP (además del tope por evento).
    rate_limit(f"guest:{actor_user_id}", max_hits=15, window_seconds=60)
    rate_limit(f"guest-ip:{client_ip(request)}", max_hits=20, window_seconds=60)

    # Validación de nombre de invitado.
    guest_name = (body.guest_name or "").strip()
    if len(guest_name) < 2 or len(guest_name) > 60:
        raise HTTPException(status_code=400, detail="Nombre de invitado inválido (2 a 60 caracteres).")

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

        lock_event_occupancy(conn, event["id"])

        if body.court_id is None:
            courts = _event_courts(conn, event_id)
            _assert_can_auto_assign(courts)
            host_court = conn.execute(text("""
                select court_id
                from public.event_registrations
                where event_id = :event_id and user_id = :actor_user_id
                  and registration_type = 'USER' and status = 'CONFIRMED'
                limit 1
            """), {"event_id": event_id, "actor_user_id": actor_user_id}).scalar()
            picked = pick_first_free(courts, _occupied_by_court(conn, event_id), prefer_court_id=host_court)
            if not picked:
                raise HTTPException(status_code=409,
                                    detail="El partido está completo: no quedan lugares para invitados.")
            court = _lock_court(conn, event_id, picked["id"])
            if not court or not court["is_open"]:
                raise HTTPException(status_code=409,
                                    detail="El partido está completo: no quedan lugares para invitados.")
            source, assigned = "one_tap", "auto"
        else:
            court = _lock_court(conn, event_id, body.court_id)
            if not court:
                raise HTTPException(status_code=404, detail="Cancha no encontrada para este evento")
            if not court["is_open"]:
                raise HTTPException(status_code=400, detail="La cancha está cerrada")
            source, assigned = "api", "chosen"

        # Tope de invitados por actor/evento (no cuenta CANCELLED)
        guest_limit = settings.GUEST_LIMIT_PER_USER
        if not _has_manage_permission(conn, actor_user_id):
            guest_count = conn.execute(text("""
                select count(*)::int as cnt
                from public.event_registrations
                where event_id = :event_id
                  and registration_type = 'GUEST'
                  and created_by_user_id = :actor_user_id
                  and status != 'CANCELLED'
            """), {"event_id": event_id, "actor_user_id": actor_user_id}).mappings().first()["cnt"]

            if guest_count >= guest_limit:
                raise HTTPException(
                    status_code=400,
                    detail=f"Llegaste al máximo de {guest_limit} invitados para este partido.",
                )

        # Cupo (sin sobrecupo)
        occupied = _count_confirmed(conn, event_id, court["id"])
        if occupied >= court["capacity"]:
            if assigned == "auto":
                raise HTTPException(status_code=409,
                                    detail="El partido está completo: no quedan lugares para invitados.")
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
            "court_id": court["id"],
            "created_by_user_id": actor_user_id,
            "guest_name": guest_name,
        }).mappings().first()

        write_audit(conn, event_id=event_id, actor_user_id=actor_user_id, action="REGISTER_GUEST",
                    target_registration_id=reg["id"],
                    metadata={"source": source, "assigned": assigned, "court_id": str(court["id"])})

        audit_court_full_if_filled(conn, event_id, court["id"], occupied + 1, court["capacity"],
                                   actor_user_id, source="guest")

    # Con AUTO_CLOSE_ON_FULL=true, cierra la cancha llena (y el evento si corresponde)
    check_and_auto_close_court(event_id, str(court["id"]), actor_user_id)

    return {
        "registration_id": str(reg["id"]),
        "status": reg["status"],
        "court_id": str(reg["court_id"]),
        "court_name": court["name"],
        "assigned": assigned,
        "created_at": str(reg["created_at"]),
        "guest_name": guest_name,
        "message": "Invitado confirmado"
    }


@router.post("/registrations/{registration_id}/move")
def move_registration(
    registration_id: str,
    body: MoveRequest,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Mueve una inscripción CONFIRMED de una cancha a otra.
    Puede quien tiene registrations.manage o el capitán de la cancha de origen o
    de destino (ver can_move_registration).
    Promueve desde waitlist a la cancha liberada si hay cupo.
    """
    with engine.begin() as conn:
        _lock_registration_event(conn, registration_id)
        reg = conn.execute(text("""
            select id, event_id, court_id, status, registration_type, user_id, created_by_user_id
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

        source = can_move_registration(conn, reg, body.to_court_id, actor_user_id)
        if not source:
            raise _forbidden(conn, event_id)

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
              :event_id, :actor_user_id, 'MOVE_REGISTRATION', :target_registration_id,
              jsonb_build_object('from_court_id', CAST(:from_court_id AS text), 'to_court_id', CAST(:to_court_id AS text),
                                 'source', CAST(:source AS text))
            )
        """), {
            "event_id": event_id,
            "actor_user_id": actor_user_id,
            "target_registration_id": registration_id,
            "from_court_id": str(from_court_id),
            "to_court_id": str(body.to_court_id),
            "source": source,
        })

        audit_court_full_if_filled(conn, event_id, body.to_court_id, occupied_to + 1, to_court["capacity"],
                                   actor_user_id, source="move")

        # Promover WAITLIST a la cancha liberada
        promoted_id = promote_first_waitlist(conn, event_id, from_court_id, actor_user_id, source="auto_from_move")

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
    body: CancelRequest | None = None,
    actor_user_id: str = Depends(get_actor_user_id)
):
    """
    Cancela una inscripción.
    Puede el propio jugador, quien anotó al invitado, quien tiene
    registrations.manage o el capitán de esa cancha (ver can_cancel_registration).
    Promueve desde waitlist si se libera un cupo.
    El body es opcional: `intent` solo se guarda en el audit (Deshacer, avisar al grupo).
    """
    with engine.begin() as conn:
        _lock_registration_event(conn, registration_id)
        reg = conn.execute(text("""
            select id, event_id, court_id, status, registration_type, user_id, created_by_user_id
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

        source = can_cancel_registration(conn, reg, actor_user_id)
        if not source:
            raise _forbidden(conn, event_id)

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

        # 2) Audit log - cancelación (source: self | guest_owner | admin | captain | legacy_captain)
        metadata = {"reason": "manual_cancel", "source": source}
        if body and body.intent:
            metadata["intent"] = body.intent
        write_audit(conn, event_id=event_id, actor_user_id=actor_user_id, action="CANCEL_REGISTRATION",
                    target_registration_id=registration_id, metadata=metadata)

        # 3) Promover primer WAITLIST si se liberó una cancha
        promoted_id = promote_first_waitlist(conn, event_id, freed_court_id, actor_user_id, source="auto_from_cancel")

        return {
            "cancelled_registration_id": registration_id,
            "promoted_registration_id": str(promoted_id) if promoted_id else None,
            # Para "Lo toma Juan" y el mensaje de WhatsApp aunque la pantalla no lo tuviera cargado.
            "promoted": _registration_brief(conn, promoted_id) if promoted_id else None,
            "message": "Inscripción cancelada correctamente"
        }


def _registration_brief(conn, registration_id) -> dict | None:
    row = conn.execute(text("""
        select r.id, r.registration_type,
               coalesce(u.full_name, r.guest_name) as name,
               cb.full_name as created_by_name
        from public.event_registrations r
        left join public.users u on u.id = r.user_id
        left join public.users cb on cb.id = r.created_by_user_id
        where r.id = :registration_id
    """), {"registration_id": registration_id}).mappings().first()
    if not row:
        return None
    return {
        "registration_id": str(row["id"]),
        "type": row["registration_type"],
        "name": row["name"],
        "created_by_name": row["created_by_name"],
    }
