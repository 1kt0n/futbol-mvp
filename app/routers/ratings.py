from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Header, Query
from sqlalchemy import text

from app.settings import engine
from app.schemas import SaveRatingsRequest

router = APIRouter()
VOTING_WINDOW_DAYS = 7
VOTING_WINDOW = timedelta(days=VOTING_WINDOW_DAYS)


# ============================================================
# GET /ratings/pending — votos pendientes del usuario actual
# ============================================================

@router.get("/ratings/pending")
def get_pending_ratings(actor_user_id: str = Header(..., alias="X-Actor-User-Id")):
    """
    Devuelve los votos pendientes agrupados por cancha.
    Incluye solo eventos FINALIZED recientes (ultimos 7 dias)
    donde el usuario estuvo CONFIRMED.
    """
    with engine.connect() as conn:
        # Canchas donde el actor estuvo CONFIRMED en eventos FINALIZED
        courts = conn.execute(text("""
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
        """), {"actor": actor_user_id}).mappings().all()

        items = []
        total_pending = 0

        for row in courts:
            finalized_at = row["finalized_at"]
            if finalized_at and finalized_at.tzinfo is None:
                finalized_at = finalized_at.replace(tzinfo=timezone.utc)

            is_locked = datetime.now(timezone.utc) > finalized_at + VOTING_WINDOW

            # Peers: users CONFIRMED en la misma cancha (excluye al voter y guests)
            peers = conn.execute(text("""
                SELECT
                    er.user_id,
                    u.full_name,
                    u.nickname,
                    u.avatar_url
                FROM public.event_registrations er
                JOIN public.users u ON u.id = er.user_id
                WHERE er.event_id = :event_id
                  AND er.court_id = :court_id
                  AND er.status = 'CONFIRMED'
                  AND er.registration_type = 'USER'
                  AND er.user_id != :actor
            """), {
                "event_id": row["event_id"],
                "court_id": row["court_id"],
                "actor": actor_user_id,
            }).mappings().all()

            if not peers:
                continue

            # Votos existentes del actor para esta cancha
            existing = conn.execute(text("""
                SELECT target_user_id, rating, comment
                FROM public.player_ratings
                WHERE event_id = :event_id
                  AND court_id = :court_id
                  AND voter_user_id = :actor
            """), {
                "event_id": row["event_id"],
                "court_id": row["court_id"],
                "actor": actor_user_id,
            }).mappings().all()

            existing_map = {str(r["target_user_id"]): r for r in existing}

            targets = []
            unrated = 0
            for p in peers:
                uid = str(p["user_id"])
                ex = existing_map.get(uid)
                targets.append({
                    "user_id": uid,
                    "full_name": p["full_name"],
                    "nickname": p["nickname"],
                    "avatar_url": p["avatar_url"],
                    "existing_vote": {
                        "rating": float(ex["rating"]),
                        "comment": ex["comment"],
                    } if ex else None,
                })
                if not ex:
                    unrated += 1

            total_pending += unrated

            items.append({
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
            })

        return {"total_pending": total_pending, "items": items}


# ============================================================
# POST /ratings — guardar votos (parcial, upsert)
# ============================================================

@router.post("/ratings")
def save_ratings(
    body: SaveRatingsRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """
    Guarda calificaciones (parcial). Upsert por unique constraint.
    """
    with engine.begin() as conn:
        # Validar evento FINALIZED y dentro de ventana
        event = conn.execute(text("""
            SELECT status, finalized_at
            FROM public.events
            WHERE id = :event_id
        """), {"event_id": body.event_id}).mappings().first()

        if not event:
            raise HTTPException(status_code=404, detail="Evento no encontrado.")
        if event["status"] != "FINALIZED":
            raise HTTPException(status_code=400, detail="El evento no está finalizado.")
        if not event["finalized_at"]:
            raise HTTPException(status_code=400, detail="El evento no tiene fecha de finalización.")

        finalized_at = event["finalized_at"]
        if finalized_at.tzinfo is None:
            finalized_at = finalized_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > finalized_at + VOTING_WINDOW:
            raise HTTPException(
                status_code=400,
                detail=f"El plazo de votacion ({VOTING_WINDOW_DAYS} dias) ya vencio.",
            )

        # Validar voter CONFIRMED en la cancha
        voter_reg = conn.execute(text("""
            SELECT 1 FROM public.event_registrations
            WHERE event_id = :event_id
              AND court_id = :court_id
              AND user_id = :actor
              AND status = 'CONFIRMED'
              AND registration_type = 'USER'
            LIMIT 1
        """), {
            "event_id": body.event_id,
            "court_id": body.court_id,
            "actor": actor_user_id,
        }).first()

        if not voter_reg:
            raise HTTPException(
                status_code=403,
                detail="No estás confirmado en esa cancha de este evento.",
            )

        # Targets válidos en la cancha
        valid_targets = conn.execute(text("""
            SELECT user_id FROM public.event_registrations
            WHERE event_id = :event_id
              AND court_id = :court_id
              AND status = 'CONFIRMED'
              AND registration_type = 'USER'
              AND user_id != :actor
        """), {
            "event_id": body.event_id,
            "court_id": body.court_id,
            "actor": actor_user_id,
        }).mappings().all()

        valid_ids = {str(r["user_id"]) for r in valid_targets}

        # Validar cada rating
        for r in body.ratings:
            if r.target_user_id == actor_user_id:
                raise HTTPException(status_code=400, detail="No podés calificarte a vos mismo.")
            if r.target_user_id not in valid_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"El jugador {r.target_user_id} no está confirmado en esa cancha.",
                )
            if (r.rating * 2) != int(r.rating * 2):
                raise HTTPException(
                    status_code=400,
                    detail=f"Rating {r.rating} inválido. Usá incrementos de 0.5.",
                )

        # Upsert
        saved = 0
        for r in body.ratings:
            conn.execute(text("""
                INSERT INTO public.player_ratings (
                    event_id, court_id, voter_user_id, target_user_id,
                    rating, comment, created_at, updated_at
                )
                VALUES (
                    :event_id, :court_id, :voter, :target,
                    :rating, :comment, now(), now()
                )
                ON CONFLICT (court_id, voter_user_id, target_user_id)
                DO UPDATE SET
                    rating = :rating,
                    comment = :comment,
                    updated_at = now()
            """), {
                "event_id": body.event_id,
                "court_id": body.court_id,
                "voter": actor_user_id,
                "target": r.target_user_id,
                "rating": r.rating,
                "comment": r.comment.strip() if r.comment else None,
            })
            saved += 1

        # Calcular pendientes restantes
        total_targets = len(valid_ids)
        rated_count = conn.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM public.player_ratings
            WHERE event_id = :event_id
              AND court_id = :court_id
              AND voter_user_id = :actor
        """), {
            "event_id": body.event_id,
            "court_id": body.court_id,
            "actor": actor_user_id,
        }).mappings().first()["cnt"]

        pending_after = total_targets - int(rated_count)

    return {"saved": saved, "pending_after": max(pending_after, 0)}


# ============================================================
# GET /users/{user_id}/rating — rating agregado
# ============================================================

@router.get("/users/{user_id}/rating")
def get_user_rating(
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    """Rating promedio y total de votos recibidos."""
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT
                COALESCE(AVG(rating), 0) AS avg_rating,
                COUNT(*) AS total_votes
            FROM public.player_ratings
            WHERE target_user_id = :user_id
              AND is_hidden = false
        """), {"user_id": user_id}).mappings().first()

        return {
            "user_id": user_id,
            "avg_rating": round(float(result["avg_rating"]), 1),
            "total_votes": int(result["total_votes"]),
        }


# ============================================================
# GET /users/{user_id}/ratings/comments — comentarios recibidos
# ============================================================

@router.get("/users/{user_id}/ratings/comments")
def get_user_comments(
    user_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    """Comentarios públicos recibidos, paginados, con autor visible."""
    offset = (page - 1) * page_size

    with engine.connect() as conn:
        total = conn.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM public.player_ratings
            WHERE target_user_id = :user_id
              AND is_hidden = false
              AND comment IS NOT NULL
              AND comment != ''
        """), {"user_id": user_id}).mappings().first()["cnt"]

        rows = conn.execute(text("""
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
            JOIN public.users u        ON u.id = pr.voter_user_id
            JOIN public.events e       ON e.id = pr.event_id
            JOIN public.event_courts ec ON ec.id = pr.court_id
            WHERE pr.target_user_id = :user_id
              AND pr.is_hidden = false
              AND pr.comment IS NOT NULL
              AND pr.comment != ''
            ORDER BY pr.created_at DESC
            LIMIT :limit OFFSET :offset
        """), {
            "user_id": user_id,
            "limit": page_size,
            "offset": offset,
        }).mappings().all()

        return {
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
