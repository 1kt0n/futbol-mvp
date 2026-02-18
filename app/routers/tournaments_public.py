from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.routers.tournaments_admin import _match_payload, compute_round_robin_standings
from app.settings import engine

router = APIRouter()


def _build_bracket(matches: list[dict]):
    rounds: dict[int, list[dict]] = {}
    for match in matches:
        round_no = int(match["round"])
        rounds.setdefault(round_no, []).append(match)

    payload = []
    for round_no in sorted(rounds):
        payload.append(
            {
                "round": round_no,
                "matches": sorted(rounds[round_no], key=lambda m: int(m["sort_order"])),
            }
        )
    return payload


@router.get("/public/tournaments/{tournament_id}/live")
def get_tournament_live(
    tournament_id: str,
    token: str = Query(..., min_length=8),
):
    with engine.connect() as conn:
        tournament = conn.execute(
            text(
                """
                SELECT id, title, location_name, starts_at, status, format, minutes_per_match, public_token
                FROM public.tournaments
                WHERE id = :tournament_id
                  AND public_token = :token
                LIMIT 1
                """
            ),
            {"tournament_id": tournament_id, "token": token},
        ).mappings().first()

        if not tournament:
            raise HTTPException(status_code=403, detail="Token publico invalido.")

        _, matches = _match_payload(conn, tournament_id)

        now_match = next((m for m in matches if m["status"] == "LIVE"), None)
        now_payload = (
            {
                "match_id": now_match["id"],
                "round": int(now_match["round"]),
            }
            if now_match
            else None
        )

        standings = []
        bracket = []
        tiebreak_note = None
        if tournament["format"] == "ROUND_ROBIN":
            standings = compute_round_robin_standings(conn, tournament_id)
            tiebreak_note = "Desempate MVP: puntos, diferencia de gol, goles a favor."
        elif tournament["format"] == "KNOCKOUT":
            bracket = _build_bracket(matches)

        return {
            "tournament": {
                "id": str(tournament["id"]),
                "title": tournament["title"],
                "location_name": tournament["location_name"],
                "starts_at": str(tournament["starts_at"]) if tournament["starts_at"] else None,
                "status": tournament["status"],
                "format": tournament["format"],
                "minutes_per_match": int(tournament["minutes_per_match"]),
            },
            "standings": standings,
            "matches": matches,
            "now": now_payload,
            "bracket": bracket,
            "tiebreak_note": tiebreak_note,
        }
