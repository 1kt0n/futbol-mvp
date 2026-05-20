"""
Mi Calendario: vista unificada cronologica para el jugador.

Junta en un solo endpoint:
- Eventos de cancha donde el jugador esta anotado
- Eventos marcados como GLOBAL (visibles para todos)
- Partidos de torneo donde el jugador es miembro de un equipo
- Anuncios informativos del admin

Estrategia: una sola query con UNION ALL de sub-queries tipadas, ordenada por starts_at.
day_label se calcula en TZ Buenos Aires para que el agrupamiento por dia sea consistente
independientemente del browser del usuario.
"""

from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import text

from app.settings import engine
from app.utils.datetime_parser import parse_client_datetime, APP_TZ, UTC_TZ
from app.utils.permissions import require_admin

router = APIRouter()
logger = logging.getLogger(__name__)


def _fmt_ts(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC_TZ)
        return value.astimezone(UTC_TZ).isoformat()
    return str(value)


SPANISH_WEEKDAYS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"]
SPANISH_MONTHS = [
    "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
    "JUL", "AGO", "SEP", "OCT", "NOV", "DIC",
]


def _day_label(starts_at_utc: datetime, today_ar: datetime) -> str:
    """Devuelve etiqueta corta en TZ Buenos Aires: HOY / MANANA / JUE 21 MAY."""
    local = starts_at_utc.astimezone(APP_TZ)
    delta_days = (local.date() - today_ar.date()).days
    if delta_days == 0:
        return "HOY"
    if delta_days == 1:
        return "MANANA"
    if delta_days == -1:
        return "AYER"
    wd = SPANISH_WEEKDAYS[local.weekday()]
    mo = SPANISH_MONTHS[local.month - 1]
    return f"{wd} {local.day} {mo}"


def _is_admin(conn, user_id: str) -> bool:
    row = conn.execute(text("""
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :uid
          AND LOWER(r.code) IN ('admin', 'super_admin')
        LIMIT 1
    """), {"uid": user_id}).first()
    return bool(row)


@router.get("/me/calendar")
def get_my_calendar(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    include_past: bool = Query(False, description="Si true, devuelve eventos pasados en lugar de proximos."),
    from_: str | None = Query(None, alias="from", description="ISO 8601 limite inferior opcional."),
    to: str | None = Query(None, description="ISO 8601 limite superior opcional."),
    limit: int = Query(100, ge=1, le=300),
):
    """
    Devuelve la agenda del jugador agrupada cronologicamente.

    Por defecto (include_past=false): desde el comienzo del dia AR hasta +90 dias.
    Si include_past=true: ultimos 90 dias hasta ahora (excluyente).
    """
    try:
        from_dt = parse_client_datetime(from_, "from") if from_ else None
        to_dt = parse_client_datetime(to, "to") if to else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now_ar = datetime.now(APP_TZ)
    today_start_ar = now_ar.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start_ar.astimezone(UTC_TZ)
    now_utc = now_ar.astimezone(UTC_TZ)

    if include_past:
        window_from = from_dt or (now_utc - timedelta(days=90))
        window_to = to_dt or now_utc
    else:
        window_from = from_dt or today_start_utc
        window_to = to_dt or (now_utc + timedelta(days=90))

    if window_from >= window_to:
        raise HTTPException(status_code=400, detail="Rango invalido: 'from' debe ser anterior a 'to'.")

    params = {
        "uid": actor_user_id,
        "win_from": window_from,
        "win_to": window_to,
        "limit": limit,
    }

    # Una sola query con UNION ALL.
    # Cada sub-query produce el mismo set de columnas tipadas.
    # Notas:
    # - Para eventos, usamos starts_at del evento. Excluimos FINALIZED.
    # - Para partidos de torneo, usamos COALESCE(started_at, tournaments.starts_at).
    #   Excluimos torneos DRAFT/ARCHIVED y matches sin ninguna fecha.
    # - Para anuncios, usamos starts_at directo.
    sql = text("""
        WITH my_teams AS (
            SELECT team_id
            FROM public.tournament_team_members
            WHERE user_id = :uid
              AND member_type = 'USER'
        ),
        my_event_regs AS (
            -- Eventos donde el jugador esta anotado o en waitlist (no cancelados)
            SELECT
                'event'::text AS item_type,
                e.id::text AS source_id,
                e.title AS title,
                COALESCE(c.name, '') AS subtitle,
                e.starts_at AS starts_at,
                NULL::timestamptz AS ends_at,
                e.location_name AS location_name,
                e.status AS raw_status,
                r.id::text AS registration_id,
                r.status AS registration_status,
                c.id::text AS court_id,
                c.name AS court_name,
                e.visibility AS visibility,
                NULL::text AS tournament_id,
                NULL::text AS tournament_name,
                NULL::text AS team_id,
                NULL::text AS team_name,
                NULL::text AS description,
                NULL::text AS action_url,
                NULL::text AS action_label
            FROM public.event_registrations r
            JOIN public.events e ON e.id = r.event_id
            LEFT JOIN public.event_courts c ON c.id = r.court_id
            WHERE r.user_id = :uid
              AND r.registration_type = 'USER'
              AND r.status IN ('CONFIRMED', 'WAITLIST')
              AND e.starts_at >= :win_from
              AND e.starts_at < :win_to
        ),
        global_events AS (
            -- Eventos GLOBAL visibles para todos los que NO esten ya en my_event_regs
            SELECT
                'event'::text AS item_type,
                e.id::text AS source_id,
                e.title AS title,
                ''::text AS subtitle,
                e.starts_at AS starts_at,
                NULL::timestamptz AS ends_at,
                e.location_name AS location_name,
                e.status AS raw_status,
                NULL::text AS registration_id,
                NULL::text AS registration_status,
                NULL::text AS court_id,
                NULL::text AS court_name,
                e.visibility AS visibility,
                NULL::text AS tournament_id,
                NULL::text AS tournament_name,
                NULL::text AS team_id,
                NULL::text AS team_name,
                NULL::text AS description,
                NULL::text AS action_url,
                NULL::text AS action_label
            FROM public.events e
            WHERE e.visibility = 'GLOBAL'
              AND e.starts_at >= :win_from
              AND e.starts_at < :win_to
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.event_registrations r2
                  WHERE r2.event_id = e.id
                    AND r2.user_id = :uid
                    AND r2.registration_type = 'USER'
                    AND r2.status IN ('CONFIRMED', 'WAITLIST')
              )
        ),
        my_tournament_matches AS (
            SELECT
                'tournament_match'::text AS item_type,
                m.id::text AS source_id,
                CONCAT(COALESCE(ht.name, '?'), ' vs ', COALESCE(at.name, '?')) AS title,
                t.title AS subtitle,
                COALESCE(m.started_at, t.starts_at) AS starts_at,
                m.ended_at AS ends_at,
                t.location_name AS location_name,
                m.status AS raw_status,
                NULL::text AS registration_id,
                NULL::text AS registration_status,
                NULL::text AS court_id,
                NULL::text AS court_name,
                NULL::text AS visibility,
                t.id::text AS tournament_id,
                t.title AS tournament_name,
                CASE
                    WHEN ht.id IN (SELECT team_id FROM my_teams) THEN ht.id::text
                    WHEN at.id IN (SELECT team_id FROM my_teams) THEN at.id::text
                    ELSE NULL
                END AS team_id,
                CASE
                    WHEN ht.id IN (SELECT team_id FROM my_teams) THEN ht.name
                    WHEN at.id IN (SELECT team_id FROM my_teams) THEN at.name
                    ELSE NULL
                END AS team_name,
                NULL::text AS description,
                NULL::text AS action_url,
                NULL::text AS action_label
            FROM public.tournament_matches m
            JOIN public.tournaments t ON t.id = m.tournament_id
            LEFT JOIN public.tournament_teams ht ON ht.id = m.home_team_id
            LEFT JOIN public.tournament_teams at ON at.id = m.away_team_id
            WHERE t.status IN ('LIVE', 'FINISHED')
              AND m.home_team_id IS NOT NULL
              AND m.away_team_id IS NOT NULL
              AND (
                   m.home_team_id IN (SELECT team_id FROM my_teams)
                OR m.away_team_id IN (SELECT team_id FROM my_teams)
              )
              AND COALESCE(m.started_at, t.starts_at) IS NOT NULL
              AND COALESCE(m.started_at, t.starts_at) >= :win_from
              AND COALESCE(m.started_at, t.starts_at) < :win_to
        ),
        announcements AS (
            SELECT
                'announcement'::text AS item_type,
                a.id::text AS source_id,
                a.title AS title,
                ''::text AS subtitle,
                a.starts_at AS starts_at,
                a.ends_at AS ends_at,
                a.location_name AS location_name,
                NULL::text AS raw_status,
                NULL::text AS registration_id,
                NULL::text AS registration_status,
                NULL::text AS court_id,
                NULL::text AS court_name,
                NULL::text AS visibility,
                NULL::text AS tournament_id,
                NULL::text AS tournament_name,
                NULL::text AS team_id,
                NULL::text AS team_name,
                a.description AS description,
                a.action_url AS action_url,
                a.action_label AS action_label
            FROM public.calendar_announcements a
            WHERE a.starts_at >= :win_from
              AND a.starts_at < :win_to
        )
        SELECT *
        FROM (
            SELECT * FROM my_event_regs
            UNION ALL
            SELECT * FROM global_events
            UNION ALL
            SELECT * FROM my_tournament_matches
            UNION ALL
            SELECT * FROM announcements
        ) u
        ORDER BY starts_at ASC, item_type ASC
        LIMIT :limit
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

        # Capacidades de eventos en una sola query auxiliar (para badge "cupo lleno").
        event_ids = {r["source_id"] for r in rows if r["item_type"] == "event"}
        counts_by_event: dict[str, dict] = {}
        if event_ids:
            cap_rows = conn.execute(text("""
                SELECT
                    e.id::text AS event_id,
                    COALESCE(SUM(c.capacity), 0)::int AS capacity_total,
                    COALESCE((
                        SELECT COUNT(*) FROM public.event_registrations r
                        WHERE r.event_id = e.id AND r.status = 'CONFIRMED' AND r.court_id IS NOT NULL
                    ), 0)::int AS occupied_total
                FROM public.events e
                LEFT JOIN public.event_courts c ON c.event_id = e.id AND c.is_open = true
                WHERE e.id = ANY(CAST(:ids AS uuid[]))
                GROUP BY e.id
            """), {"ids": list(event_ids)}).mappings().all()
            for cr in cap_rows:
                counts_by_event[cr["event_id"]] = {
                    "capacity_total": cr["capacity_total"],
                    "occupied_total": cr["occupied_total"],
                }

        # Captaincias (badge "Capitan") para los eventos del usuario.
        captain_event_ids: set[str] = set()
        if event_ids:
            cap_event_rows = conn.execute(text("""
                SELECT DISTINCT event_id::text AS event_id
                FROM public.event_court_captains
                WHERE user_id = :uid
                  AND event_id = ANY(CAST(:ids AS uuid[]))
            """), {"uid": actor_user_id, "ids": list(event_ids)}).mappings().all()
            captain_event_ids = {r["event_id"] for r in cap_event_rows}

        is_admin = _is_admin(conn, actor_user_id)

    items = []
    for r in rows:
        item_type = r["item_type"]
        starts_at = r["starts_at"]
        if starts_at and starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=UTC_TZ)

        day_label = _day_label(starts_at, now_ar) if starts_at else ""

        item: dict = {
            "type": item_type,
            "source_id": r["source_id"],
            "title": r["title"],
            "subtitle": r["subtitle"] or "",
            "starts_at": _fmt_ts(starts_at),
            "ends_at": _fmt_ts(r["ends_at"]),
            "location_name": r["location_name"],
            "day_label": day_label,
            "status": r["raw_status"],
            "participation": {"role": None},
            "cta": {"kind": None, "url": None, "label": None, "disabled_reason": None},
        }

        if item_type == "event":
            event_id = r["source_id"]
            counts = counts_by_event.get(event_id) or {"capacity_total": 0, "occupied_total": 0}
            item["counts"] = counts
            item["is_global"] = (r["visibility"] == "GLOBAL")

            is_registered = bool(r["registration_id"])
            is_waitlist = (r["registration_status"] == "WAITLIST")
            is_captain = event_id in captain_event_ids
            event_open = (r["raw_status"] == "OPEN")
            event_finalized = (r["raw_status"] == "FINALIZED")

            role = None
            if is_captain:
                role = "captain"
            elif is_registered:
                role = "registered"
            item["participation"] = {
                "role": role,
                "registration_id": r["registration_id"],
                "court_id": r["court_id"],
                "court_name": r["court_name"],
                "registration_status": r["registration_status"],
            }

            # CTA: priorizamos accion sobre navegacion
            if is_registered and not event_finalized:
                item["cta"] = {
                    "kind": "unregister",
                    "url": f"/?event_id={event_id}",
                    "label": "Cancelar mi lugar" if not is_waitlist else "Bajarme de la espera",
                    "disabled_reason": None,
                }
            elif not is_registered and event_open:
                full = counts["capacity_total"] > 0 and counts["occupied_total"] >= counts["capacity_total"]
                item["cta"] = {
                    "kind": "register" if not full else "view_event",
                    "url": f"/?event_id={event_id}",
                    "label": "Anotarme" if not full else "Ver evento (lleno)",
                    "disabled_reason": "Cupo lleno" if full else None,
                }
            else:
                item["cta"] = {
                    "kind": "view_event",
                    "url": f"/?event_id={event_id}",
                    "label": "Ver evento",
                    "disabled_reason": None,
                }

        elif item_type == "tournament_match":
            item["participation"] = {
                "role": "team_member",
                "team_id": r["team_id"],
                "team_name": r["team_name"],
            }
            item["tournament"] = {"id": r["tournament_id"], "name": r["tournament_name"]}
            item["cta"] = {
                "kind": "view_tournament",
                "url": f"/tournaments/{r['tournament_id']}",
                "label": "Ver torneo",
                "disabled_reason": None,
            }

        elif item_type == "announcement":
            item["description"] = r["description"]
            if r["action_url"]:
                item["cta"] = {
                    "kind": "external",
                    "url": r["action_url"],
                    "label": r["action_label"] or "Abrir",
                    "disabled_reason": None,
                }

        items.append(item)

    return {
        "items": items,
        "is_admin": is_admin,
        "window": {
            "from": _fmt_ts(window_from),
            "to": _fmt_ts(window_to),
            "include_past": include_past,
        },
    }
