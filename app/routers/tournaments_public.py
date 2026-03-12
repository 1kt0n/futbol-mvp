from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.routers.tournaments_admin import (
    _match_payload,
    compute_group_standings,
    compute_round_robin_standings,
    GROUPS_PLAYOFFS_CONFIG,
)
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
        group_standings = None
        tiebreak_note = None
        fmt = tournament["format"]
        if fmt == "ROUND_ROBIN":
            standings = compute_round_robin_standings(conn, tournament_id)
            tiebreak_note = "Desempate MVP: puntos, diferencia de gol, goles a favor."
        elif fmt == "KNOCKOUT":
            bracket = _build_bracket(matches)
        elif fmt == "GROUPS_PLAYOFFS":
            # Group standings
            group_labels = sorted(set(m["group_label"] for m in matches if m.get("group_label")))
            if group_labels:
                group_standings = {}
                for g in group_labels:
                    group_standings[g] = compute_group_standings(conn, tournament_id, g)
            # Playoff bracket
            playoff_matches = [m for m in matches if m.get("stage") == "PLAYOFF"]
            if playoff_matches:
                bracket = _build_bracket(playoff_matches)
            tiebreak_note = "Fase de grupos: todos contra todos. Los mejores avanzan a eliminacion directa."

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
            "group_standings": group_standings,
            "tiebreak_note": tiebreak_note,
        }