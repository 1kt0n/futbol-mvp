import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import text

from app.schemas import SaveRatingsRequest
from app.settings import engine

router = APIRouter()

VOTING_WINDOW_DAYS = 7
VOTING_WINDOW = timedelta(days=VOTING_WINDOW_DAYS)

ALLOWED_ATTRIBUTES = {
    "EQUIPO",
    "VISION",
    "INTENSIDAD",
    "DEFENSA",
    "ATAQUE",
    "FAIRPLAY",
}


def _as_utc(value):
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _get_user_ranking_state(conn, user_id: str):
    row = conn.execute(
        text(
            """
            SELECT id, ranking_opt_in
            FROM public.users
            WHERE id = :user_id
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    return bool(row["ranking_opt_in"])


def _normalize_attributes(attributes: list[str] | None):
    if attributes is None:
        raise HTTPException(
            status_code=400,
            detail="Debes enviar exactamente 2 atributos por voto.",
        )

    if len(attributes) != 2:
        raise HTTPException(
            status_code=400,
            detail="Debes seleccionar exactamente 2 atributos.",
        )

    normalized = []
    for raw in attributes:
        attr = str(raw or "").strip().upper()
        if attr not in ALLOWED_ATTRIBUTES:
            raise HTTPException(
                status_code=400,
                detail=f"Atributo invalido: {raw}.",
            )
        normalized.append(attr)

    if len(set(normalized)) != 2:
        raise HTTPException(
            status_code=400,
            detail="Debes seleccionar 2 atributos distintos.",
        )

    return normalized


def _parse_attributes(value):
    if isinstance(value, list):
        return [str(v) for v in value]
    return []


@router.get("/ratings/pending")
def get_pending_ratings(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Devuelve los votos pendientes agrupados por cancha.
    Incluye solo eventos FINALIZED recientes (ultimos 7 dias)
    donde el usuario estuvo CONFIRMED.
    """
    with engine.connect() as conn:
        actor_opt_in = _get_user_ranking_state(conn, actor_user_id)
        if not actor_opt_in:
            return {
                "locked": True,
                "reason": "RANKING_OPT_OUT",
                "total_pending": 0,
                "items": [],
            }

        courts = conn.execute(
            text(
                """
                SELECT
                    e.id        AS event_id,
                    e.title     AS event_title,
                    e.starts_at AS event_starts_at,
                    e.finalized_at,
                    ec.id       AS court_id,
                    ec.name     AS court_name
                FROM public.events e
                JOIN public.event_registrations er
                    ON er.event_id = e.id
                    AND er.user_id = :actor
                    AND er.status = 'CONFIRMED'
                    AND er.registration_type = 'USER'
                JOIN public.event_courts ec
                    ON ec.id = er.court_id
                WHERE e.status = 'FINALIZED'
                  AND e.finalized_at IS NOT NULL
                  AND e.finalized_at >= (now() - interval '7 days')
                ORDER BY e.finalized_at DESC
                """
            ),
            {"actor": actor_user_id},
        ).mappings().all()

        items = []
        total_pending = 0

        for row in courts:
            finalized_at = _as_utc(row["finalized_at"])
            is_locked = datetime.now(timezone.utc) > finalized_at + VOTING_WINDOW

            peers = conn.execute(
                text(
                    """
                    SELECT
                        er.user_id,
                        u.full_name,
                        u.nickname,
                        u.avatar_url,
                        u.player_level
                    FROM public.event_registrations er
                    JOIN public.users u ON u.id = er.user_id
                    WHERE er.event_id = :event_id
                      AND er.court_id = :court_id
                      AND er.status = 'CONFIRMED'
                      AND er.registration_type = 'USER'
                      AND er.user_id != :actor
                      AND u.ranking_opt_in = true
                    """
                ),
                {
                    "event_id": row["event_id"],
                    "court_id": row["court_id"],
                    "actor": actor_user_id,
                },
            ).mappings().all()

            if not peers:
                continue

            existing = conn.execute(
                text(
                    """
                    SELECT target_user_id, rating, comment, attributes
                    FROM public.player_ratings
                    WHERE event_id = :event_id
                      AND court_id = :court_id
                      AND voter_user_id = :actor
                    """
                ),
                {
                    "event_id": row["event_id"],
                    "court_id": row["court_id"],
                    "actor": actor_user_id,
                },
            ).mappings().all()

            existing_map = {str(r["target_user_id"]): r for r in existing}

            targets = []
            unrated = 0
            for p in peers:
                uid = str(p["user_id"])
                ex = existing_map.get(uid)
                targets.append(
                    {
                        "user_id": uid,
                        "full_name": p["full_name"],
                        "nickname": p["nickname"],
                        "avatar_url": p["avatar_url"],
                        "player_level": p["player_level"],
                        "existing_vote": {
                            "rating": float(ex["rating"]),
                            "comment": ex["comment"],
                            "attributes": _parse_attributes(ex.get("attributes")),
                        }
                        if ex
                        else None,
                    }
                )
                if not ex:
                    unrated += 1

            total_pending += unrated

            items.append(
                {
                    "event_id": str(row["event_id"]),
                    "event_title": row["event_title"],
                    "event_starts_at": str(row["event_starts_at"]) if row["event_starts_at"] else None,
                    "finalized_at": str(row["finalized_at"]),
                    "voting_window_days": VOTING_WINDOW_DAYS,
                    "court_id": str(row["court_id"]),
                    "court_name": row["court_name"],
                    "targets": targets,
                    "targets_total": len(targets),
                    "targets_pending": unrated,
                    "is_locked": is_locked,
                }
            )

        return {
            "locked": False,
            "reason": None,
            "total_pending": total_pending,
            "items": items,
        }


@router.post("/ratings")
def save_ratings(
    body: SaveRatingsRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Guarda calificaciones (parcial). Upsert por unique constraint.
    """
    ratings = body.ratings or []

    with engine.begin() as conn:
        actor_opt_in = _get_user_ranking_state(conn, actor_user_id)
        if not actor_opt_in:
            raise HTTPException(
                status_code=403,
                detail="No participas del ranking. Activalo desde tu perfil para votar.",
            )

        event = conn.execute(
            text(
                """
                SELECT status, finalized_at
                FROM public.events
                WHERE id = :event_id
                """
            ),
            {"event_id": body.event_id},
        ).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")
        if event["status"] != "FINALIZED":
            raise HTTPException(status_code=400, detail="El evento no esta finalizado.")
        if not event["finalized_at"]:
            raise HTTPException(status_code=400, detail="El evento no tiene fecha de finalizacion.")

        finalized_at = _as_utc(event["finalized_at"])
        if datetime.now(timezone.utc) > finalized_at + VOTING_WINDOW:
            raise HTTPException(
                status_code=400,
                detail=f"El plazo de votacion ({VOTING_WINDOW_DAYS} dias) ya vencio.",
            )

        voter_reg = conn.execute(
            text(
                """
                SELECT 1 FROM public.event_registrations
                WHERE event_id = :event_id
                  AND court_id = :court_id
                  AND user_id = :actor
                  AND status = 'CONFIRMED'
                  AND registration_type = 'USER'
                LIMIT 1
                """
            ),
            {
                "event_id": body.event_id,
                "court_id": body.court_id,
                "actor": actor_user_id,
            },
        ).first()

        if not voter_reg:
            raise HTTPException(
                status_code=403,
                detail="No estas confirmado en esa cancha de este evento.",
            )

        target_rows = conn.execute(
            text(
                """
                SELECT er.user_id, u.ranking_opt_in
                FROM public.event_registrations er
                JOIN public.users u ON u.id = er.user_id
                WHERE er.event_id = :event_id
                  AND er.court_id = :court_id
                  AND er.status = 'CONFIRMED'
                  AND er.registration_type = 'USER'
                  AND er.user_id != :actor
                """
            ),
            {
                "event_id": body.event_id,
                "court_id": body.court_id,
                "actor": actor_user_id,
            },
        ).mappings().all()

        target_opt_in = {str(r["user_id"]): bool(r["ranking_opt_in"]) for r in target_rows}

        prepared_votes = []
        for rating in ratings:
            target_id = rating.target_user_id

            if target_id == actor_user_id:
                raise HTTPException(status_code=400, detail="No podes calificarte a vos mismo.")

            if target_id not in target_opt_in:
                raise HTTPException(
                    status_code=400,
                    detail=f"El jugador {target_id} no esta confirmado en esa cancha.",
                )

            if not target_opt_in[target_id]:
                raise HTTPException(
                    status_code=400,
                    detail="El jugador no participa del ranking.",
                )

            if (rating.rating * 2) != int(rating.rating * 2):
                raise HTTPException(
                    status_code=400,
                    detail=f"Rating {rating.rating} invalido. Usa incrementos de 0.5.",
                )

            attrs = _normalize_attributes(rating.attributes)
            prepared_votes.append(
                {
                    "target": target_id,
                    "rating": rating.rating,
                    "comment": rating.comment.strip() if rating.comment else None,
                    "attributes": json.dumps(attrs),
                }
            )

        saved = 0
        for vote in prepared_votes:
            conn.execute(
                text(
                    """
                    INSERT INTO public.player_ratings (
                        event_id, court_id, voter_user_id, target_user_id,
                        rating, comment, attributes, created_at, updated_at
                    )
                    VALUES (
                        :event_id, :court_id, :voter, :target,
                        :rating, :comment, CAST(:attributes AS jsonb), now(), now()
                    )
                    ON CONFLICT (court_id, voter_user_id, target_user_id)
                    DO UPDATE SET
                        rating = :rating,
                        comment = :comment,
                        attributes = CAST(:attributes AS jsonb),
                        updated_at = now()
                    """
                ),
                {
                    "event_id": body.event_id,
                    "court_id": body.court_id,
                    "voter": actor_user_id,
                    "target": vote["target"],
                    "rating": vote["rating"],
                    "comment": vote["comment"],
                    "attributes": vote["attributes"],
                },
            )
            saved += 1

        total_targets = sum(1 for is_opted in target_opt_in.values() if is_opted)

        rated_count = conn.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM public.player_ratings pr
                JOIN public.users u ON u.id = pr.target_user_id
                WHERE pr.event_id = :event_id
                  AND pr.court_id = :court_id
                  AND pr.voter_user_id = :actor
                  AND u.ranking_opt_in = true
                """
            ),
            {
                "event_id": body.event_id,
                "court_id": body.court_id,
                "actor": actor_user_id,
            },
        ).mappings().first()["cnt"]

        pending_after = total_targets - int(rated_count)

    return {"saved": saved, "pending_after": max(pending_after, 0)}


@router.get("/users/{user_id}/rating")
def get_user_rating(
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """Rating promedio y total de votos recibidos."""
    with engine.connect() as conn:
        participates = _get_user_ranking_state(conn, user_id)
        if not participates:
            if actor_user_id == user_id:
                return {"participates": False, "message": "No participas del ranking"}
            return {"participates": False}

        result = conn.execute(
            text(
                """
                SELECT
                    COALESCE(AVG(rating), 0) AS avg_rating,
                    COUNT(*) AS total_votes
                FROM public.player_ratings
                WHERE target_user_id = :user_id
                  AND is_hidden = false
                """
            ),
            {"user_id": user_id},
        ).mappings().first()

        return {
            "participates": True,
            "user_id": user_id,
            "avg_rating": round(float(result["avg_rating"]), 1),
            "total_votes": int(result["total_votes"]),
        }


@router.get("/users/{user_id}/ratings/attributes")
def get_user_attributes(
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    limit: int = Query(6, ge=1, le=20),
):
    """Top de atributos recibidos para un usuario."""
    with engine.connect() as conn:
        participates = _get_user_ranking_state(conn, user_id)
        if not participates:
            if actor_user_id == user_id:
                return {"participates": False, "message": "No participas del ranking"}
            return {"participates": False}

        rows = conn.execute(
            text(
                """
                SELECT
                    attr.attribute,
                    COUNT(*) AS cnt
                FROM (
                    SELECT jsonb_array_elements_text(pr.attributes) AS attribute
                    FROM public.player_ratings pr
                    WHERE pr.target_user_id = :user_id
                      AND pr.is_hidden = false
                      AND jsonb_typeof(pr.attributes) = 'array'
                ) attr
                GROUP BY attr.attribute
                ORDER BY cnt DESC, attr.attribute ASC
                LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        ).mappings().all()

        return {
            "participates": True,
            "top": [
                {"attribute": str(r["attribute"]), "count": int(r["cnt"])}
                for r in rows
            ],
        }


@router.get("/users/{user_id}/ratings/comments")
def get_user_comments(
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    """Comentarios publicos recibidos, paginados, con autor visible."""
    offset = (page - 1) * page_size

    with engine.connect() as conn:
        participates = _get_user_ranking_state(conn, user_id)
        if not participates:
            base = {
                "participates": False,
                "items": [],
                "page": page,
                "page_size": page_size,
                "total": 0,
            }
            if actor_user_id == user_id:
                base["message"] = "No participas del ranking"
            return base

        total = conn.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM public.player_ratings
                WHERE target_user_id = :user_id
                  AND is_hidden = false
                  AND comment IS NOT NULL
                  AND comment != ''
                """
            ),
            {"user_id": user_id},
        ).mappings().first()["cnt"]

        rows = conn.execute(
            text(
                """
                SELECT
                    pr.rating,
                    pr.comment,
                    pr.created_at,
                    pr.voter_user_id,
                    u.full_name  AS author_name,
                    u.nickname   AS author_nickname,
                    u.avatar_url AS author_avatar_url,
                    e.title      AS event_title,
                    ec.name      AS court_name
                FROM public.player_ratings pr
                JOIN public.users u         ON u.id = pr.voter_user_id
                JOIN public.events e        ON e.id = pr.event_id
                JOIN public.event_courts ec ON ec.id = pr.court_id
                WHERE pr.target_user_id = :user_id
                  AND pr.is_hidden = false
                  AND pr.comment IS NOT NULL
                  AND pr.comment != ''
                ORDER BY pr.created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {
                "user_id": user_id,
                "limit": page_size,
                "offset": offset,
            },
        ).mappings().all()

        return {
            "participates": True,
            "items": [
                {
                    "rating": float(r["rating"]),
                    "comment": r["comment"],
                    "created_at": str(r["created_at"]),
                    "event_title": r["event_title"],
                    "court_name": r["court_name"],
                    "author": {
                        "user_id": str(r["voter_user_id"]),
                        "full_name": r["author_name"],
                        "nickname": r["author_nickname"],
                        "avatar_url": r["author_avatar_url"],
                    },
                }
                for r in rows
            ],
            "page": page,
            "page_size": page_size,
            "total": int(total),
        }
