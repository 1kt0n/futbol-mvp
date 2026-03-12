import math
import secrets
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.schemas import (
    TournamentCreateMemberRequest,
    TournamentCreateRequest,
    TournamentCreateTeamRequest,
    TournamentScorePatchRequest,
    TournamentUpdateRequest,
    TournamentUpdateStatusRequest,
)
from app.settings import engine
from app.utils.datetime_parser import parse_client_datetime
from app.utils.permissions import require_admin

router = APIRouter()

GROUPS_PLAYOFFS_CONFIG = {
    4:  {"groups": 2, "per_group": 2, "advance": 1},
    6:  {"groups": 2, "per_group": 3, "advance": 2},
    8:  {"groups": 2, "per_group": 4, "advance": 2},
    10: {"groups": 2, "per_group": 5, "advance": 2},
    12: {"groups": 4, "per_group": 3, "advance": 2},
    16: {"groups": 4, "per_group": 4, "advance": 2},
}


def _is_power_of_two(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def _generate_round_robin(team_ids: list[str]):
    teams = list(team_ids)
    bye = None
    if len(teams) % 2 == 1:
        bye = "__BYE__"
        teams.append(bye)

    rounds = len(teams) - 1
    items = []
    lineup = list(teams)

    for round_no in range(1, rounds + 1):
        sort_order = 1
        for i in range(len(lineup) // 2):
            a = lineup[i]
            b = lineup[-(i + 1)]
            if a == bye or b == bye:
                continue

            if round_no % 2 == 1:
                home, away = a, b
            else:
                home, away = b, a

            items.append(
                {
                    "id": str(uuid4()),
                    "round": round_no,
                    "sort_order": sort_order,
                    "home_team_id": home,
                    "away_team_id": away,
                    "next_match_id": None,
                    "next_slot": None,
                }
            )
            sort_order += 1

        lineup = [lineup[0]] + [lineup[-1]] + lineup[1:-1]

    return items


def _generate_knockout(team_ids: list[str]):
    rounds: list[list[dict]] = []
    total_teams = len(team_ids)
    rounds_count = int(math.log2(total_teams))

    first_round = []
    for idx in range(total_teams // 2):
        first_round.append(
            {
                "id": str(uuid4()),
                "round": 1,
                "sort_order": idx + 1,
                "home_team_id": team_ids[idx * 2],
                "away_team_id": team_ids[idx * 2 + 1],
                "next_match_id": None,
                "next_slot": None,
            }
        )
    rounds.append(first_round)

    prev_matches = len(first_round)
    for r in range(2, rounds_count + 1):
        current = []
        curr_matches = prev_matches // 2
        for idx in range(curr_matches):
            current.append(
                {
                    "id": str(uuid4()),
                    "round": r,
                    "sort_order": idx + 1,
                    "home_team_id": None,
                    "away_team_id": None,
                    "next_match_id": None,
                    "next_slot": None,
                }
            )
        rounds.append(current)
        prev_matches = curr_matches

    for r in range(len(rounds) - 1):
        src_round = rounds[r]
        target_round = rounds[r + 1]
        for i in range(0, len(src_round), 2):
            target = target_round[i // 2]
            src_round[i]["next_match_id"] = target["id"]
            src_round[i]["next_slot"] = "HOME"
            src_round[i + 1]["next_match_id"] = target["id"]
            src_round[i + 1]["next_slot"] = "AWAY"

    return [m for rnd in rounds for m in rnd]


def _generate_groups_playoffs(team_ids: list[str]):
    """Generate group-stage round-robin + playoff knockout bracket."""
    total = len(team_ids)
    cfg = GROUPS_PLAYOFFS_CONFIG.get(total)
    if not cfg:
        raise ValueError(f"GROUPS_PLAYOFFS no soporta {total} equipos.")

    num_groups = cfg["groups"]
    group_labels = [chr(ord("A") + i) for i in range(num_groups)]

    # Snake-draft assignment: A,B,C,D,D,C,B,A,...
    team_group_map: dict[str, str] = {}
    groups: dict[str, list[str]] = {g: [] for g in group_labels}
    order = list(group_labels)
    for i, tid in enumerate(team_ids):
        cycle = i // num_groups
        idx = i % num_groups
        if cycle % 2 == 1:
            idx = num_groups - 1 - idx
        g = order[idx]
        groups[g].append(tid)
        team_group_map[tid] = g

    # Generate round-robin within each group
    all_matches = []
    max_group_round = 0
    for g in group_labels:
        group_matches = _generate_round_robin(groups[g])
        for m in group_matches:
            m["group_label"] = g
            m["stage"] = "GROUP"
        # Offset sort_order to avoid unique constraint collision across groups
        g_idx = group_labels.index(g)
        per_group_max_sort = len(groups[g]) // 2 + 1  # max matches per round in group
        for m in group_matches:
            m["sort_order"] = m["sort_order"] + g_idx * per_group_max_sort
            if m["round"] > max_group_round:
                max_group_round = m["round"]
        all_matches.extend(group_matches)

    # Generate playoff bracket
    playoff_team_count = num_groups * cfg["advance"]
    # Use placeholder IDs for playoff first-round teams (will be filled by _seed_playoffs)
    placeholder_ids = [str(uuid4()) for _ in range(playoff_team_count)]
    playoff_matches = _generate_knockout(placeholder_ids)

    # Offset playoff rounds and clear placeholder team IDs
    for m in playoff_matches:
        m["round"] = m["round"] + max_group_round
        m["group_label"] = None
        m["stage"] = "PLAYOFF"
        m["home_team_id"] = None
        m["away_team_id"] = None

    all_matches.extend(playoff_matches)
    return all_matches, team_group_map


def _seed_playoffs(conn, tournament_id: str):
    """Compute group standings, pick qualifiers, and seed the playoff bracket."""
    tournament = _get_tournament(conn, tournament_id)
    total = int(tournament["teams_count"])
    cfg = GROUPS_PLAYOFFS_CONFIG.get(total)
    if not cfg:
        return

    # Get groups
    teams = conn.execute(
        text("SELECT id, group_label FROM public.tournament_teams WHERE tournament_id = :tid ORDER BY group_label, created_at"),
        {"tid": tournament_id},
    ).mappings().all()

    group_labels = sorted(set(t["group_label"] for t in teams if t["group_label"]))
    advance = cfg["advance"]

    # Compute standings per group and pick qualifiers
    qualifiers: list[tuple[str, str, int]] = []  # (team_id, group, position)
    for g in group_labels:
        standings = compute_group_standings(conn, tournament_id, g)
        for pos, row in enumerate(standings[:advance]):
            qualifiers.append((row["team_id"], g, pos + 1))

    # Build seeding order based on number of groups
    # 2 groups: A1 vs B2, B1 vs A2
    # 4 groups: A1 vs B2, C1 vs D2, B1 vs A2, D1 vs C2
    seeded: list[tuple[str, str]] = []  # (home_team_id, away_team_id) pairs
    if len(group_labels) == 2:
        a_q = [q for q in qualifiers if q[1] == "A"]
        b_q = [q for q in qualifiers if q[1] == "B"]
        a_q.sort(key=lambda x: x[2])
        b_q.sort(key=lambda x: x[2])
        if advance == 1:
            seeded.append((a_q[0][0], b_q[0][0]))
        else:
            seeded.append((a_q[0][0], b_q[1][0]))
            seeded.append((b_q[0][0], a_q[1][0]))
    elif len(group_labels) == 4:
        by_group = {}
        for q in qualifiers:
            by_group.setdefault(q[1], []).append(q)
        for g in by_group:
            by_group[g].sort(key=lambda x: x[2])
        seeded.append((by_group["A"][0][0], by_group["B"][1][0]))
        seeded.append((by_group["C"][0][0], by_group["D"][1][0]))
        seeded.append((by_group["B"][0][0], by_group["A"][1][0]))
        seeded.append((by_group["D"][0][0], by_group["C"][1][0]))

    # Get first-round playoff matches (lowest playoff round)
    playoff_matches = conn.execute(
        text(
            """
            SELECT id, round, sort_order
            FROM public.tournament_matches
            WHERE tournament_id = :tid AND stage = 'PLAYOFF'
            ORDER BY round ASC, sort_order ASC
            """
        ),
        {"tid": tournament_id},
    ).mappings().all()

    if not playoff_matches:
        return

    first_round = playoff_matches[0]["round"]
    first_round_matches = [m for m in playoff_matches if m["round"] == first_round]
    first_round_matches.sort(key=lambda m: m["sort_order"])

    for i, (home_id, away_id) in enumerate(seeded):
        if i < len(first_round_matches):
            conn.execute(
                text(
                    """
                    UPDATE public.tournament_matches
                    SET home_team_id = CAST(:home AS uuid), away_team_id = CAST(:away AS uuid)
                    WHERE id = :match_id
                    """
                ),
                {"home": home_id, "away": away_id, "match_id": first_round_matches[i]["id"]},
            )


def compute_group_standings(conn, tournament_id: str, group_label: str):
    """Compute standings for a single group within a GROUPS_PLAYOFFS tournament."""
    teams = conn.execute(
        text(
            """
            SELECT id, name, logo_emoji
            FROM public.tournament_teams
            WHERE tournament_id = :tid AND group_label = :group_label
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"tid": tournament_id, "group_label": group_label},
    ).mappings().all()

    stats = {
        str(t["id"]): {
            "team_id": str(t["id"]),
            "team_name": t["name"],
            "emoji": t["logo_emoji"],
            "pts": 0, "pj": 0, "pg": 0, "pe": 0, "pp": 0,
            "gf": 0, "gc": 0, "dg": 0,
        }
        for t in teams
    }

    matches = conn.execute(
        text(
            """
            SELECT home_team_id, away_team_id, home_goals, away_goals
            FROM public.tournament_matches
            WHERE tournament_id = :tid
              AND stage = 'GROUP'
              AND group_label = :group_label
              AND status = 'FINISHED'
              AND home_team_id IS NOT NULL
              AND away_team_id IS NOT NULL
            """
        ),
        {"tid": tournament_id, "group_label": group_label},
    ).mappings().all()

    for m in matches:
        home_id = str(m["home_team_id"])
        away_id = str(m["away_team_id"])
        if home_id not in stats or away_id not in stats:
            continue
        hg = int(m["home_goals"] or 0)
        ag = int(m["away_goals"] or 0)
        home = stats[home_id]
        away = stats[away_id]
        home["pj"] += 1
        away["pj"] += 1
        home["gf"] += hg
        home["gc"] += ag
        away["gf"] += ag
        away["gc"] += hg
        if hg > ag:
            home["pg"] += 1
            away["pp"] += 1
            home["pts"] += 3
        elif ag > hg:
            away["pg"] += 1
            home["pp"] += 1
            away["pts"] += 3
        else:
            home["pe"] += 1
            away["pe"] += 1
            home["pts"] += 1
            away["pts"] += 1

    for row in stats.values():
        row["dg"] = row["gf"] - row["gc"]

    return sorted(
        stats.values(),
        key=lambda x: (-x["pts"], -x["dg"], -x["gf"], x["team_name"].lower()),
    )


def _get_tournament(conn, tournament_id: str):
    row = conn.execute(
        text(
            """
            SELECT id, title, location_name, starts_at, status, format,
                   teams_count, minutes_per_match, public_token, created_at, updated_at
            FROM public.tournaments
            WHERE id = :tournament_id
            """
        ),
        {"tournament_id": tournament_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Torneo no encontrado.")
    return row


def _team_map(conn, tournament_id: str):
    teams = conn.execute(
        text(
            """
            SELECT id, tournament_id, name, logo_emoji, is_guest, group_label, created_at
            FROM public.tournament_teams
            WHERE tournament_id = :tournament_id
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"tournament_id": tournament_id},
    ).mappings().all()
    return teams, {str(t["id"]): t for t in teams}


def _match_payload(conn, tournament_id: str):
    teams, team_by_id = _team_map(conn, tournament_id)
    matches = conn.execute(
        text(
            """
            SELECT id, tournament_id, round, sort_order, home_team_id, away_team_id,
                   status, home_goals, away_goals, started_at, ended_at, next_match_id, next_slot,
                   group_label, stage
            FROM public.tournament_matches
            WHERE tournament_id = :tournament_id
            ORDER BY round ASC, sort_order ASC
            """
        ),
        {"tournament_id": tournament_id},
    ).mappings().all()

    payload = []
    for m in matches:
        home = team_by_id.get(str(m["home_team_id"])) if m["home_team_id"] else None
        away = team_by_id.get(str(m["away_team_id"])) if m["away_team_id"] else None
        payload.append(
            {
                "id": str(m["id"]),
                "tournament_id": str(m["tournament_id"]),
                "round": int(m["round"]),
                "sort_order": int(m["sort_order"]),
                "status": m["status"],
                "home_goals": int(m["home_goals"]),
                "away_goals": int(m["away_goals"]),
                "home": {
                    "id": str(home["id"]) if home else None,
                    "name": home["name"] if home else "TBD",
                    "emoji": home["logo_emoji"] if home else None,
                },
                "away": {
                    "id": str(away["id"]) if away else None,
                    "name": away["name"] if away else "TBD",
                    "emoji": away["logo_emoji"] if away else None,
                },
                "started_at": str(m["started_at"]) if m["started_at"] else None,
                "ended_at": str(m["ended_at"]) if m["ended_at"] else None,
                "next_match_id": str(m["next_match_id"]) if m["next_match_id"] else None,
                "next_slot": m["next_slot"],
                "group_label": m["group_label"],
                "stage": m["stage"],
            }
        )

    return teams, payload


def compute_round_robin_standings(conn, tournament_id: str):
    teams = conn.execute(
        text(
            """
            SELECT id, name, logo_emoji
            FROM public.tournament_teams
            WHERE tournament_id = :tournament_id
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"tournament_id": tournament_id},
    ).mappings().all()

    stats = {
        str(t["id"]): {
            "team_id": str(t["id"]),
            "team_name": t["name"],
            "emoji": t["logo_emoji"],
            "pts": 0,
            "pj": 0,
            "pg": 0,
            "pe": 0,
            "pp": 0,
            "gf": 0,
            "gc": 0,
            "dg": 0,
        }
        for t in teams
    }

    matches = conn.execute(
        text(
            """
            SELECT home_team_id, away_team_id, home_goals, away_goals
            FROM public.tournament_matches
            WHERE tournament_id = :tournament_id
              AND status = 'FINISHED'
              AND home_team_id IS NOT NULL
              AND away_team_id IS NOT NULL
            """
        ),
        {"tournament_id": tournament_id},
    ).mappings().all()

    for m in matches:
        home_id = str(m["home_team_id"])
        away_id = str(m["away_team_id"])
        if home_id not in stats or away_id not in stats:
            continue

        home_goals = int(m["home_goals"] or 0)
        away_goals = int(m["away_goals"] or 0)

        home = stats[home_id]
        away = stats[away_id]

        home["pj"] += 1
        away["pj"] += 1
        home["gf"] += home_goals
        home["gc"] += away_goals
        away["gf"] += away_goals
        away["gc"] += home_goals

        if home_goals > away_goals:
            home["pg"] += 1
            away["pp"] += 1
            home["pts"] += 3
        elif away_goals > home_goals:
            away["pg"] += 1
            home["pp"] += 1
            away["pts"] += 3
        else:
            home["pe"] += 1
            away["pe"] += 1
            home["pts"] += 1
            away["pts"] += 1

    for row in stats.values():
        row["dg"] = row["gf"] - row["gc"]

    return sorted(
        stats.values(),
        key=lambda x: (-x["pts"], -x["dg"], -x["gf"], x["team_name"].lower()),
    )


@router.post("/tournaments")
def create_tournament(
    body: TournamentCreateRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

    if body.format == "KNOCKOUT" and not _is_power_of_two(body.teams_count):
        raise HTTPException(status_code=400, detail="KNOCKOUT requiere teams_count 4, 8 o 16.")
    if body.format == "GROUPS_PLAYOFFS" and body.teams_count not in GROUPS_PLAYOFFS_CONFIG:
        valid = ", ".join(str(k) for k in sorted(GROUPS_PLAYOFFS_CONFIG))
        raise HTTPException(status_code=400, detail=f"GROUPS_PLAYOFFS requiere teams_count: {valid}.")

    location_name = body.location_name.strip() if body.location_name else None
    try:
        starts_at = parse_client_datetime(body.starts_at, "starts_at")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with engine.begin() as conn:
        created = None
        for _ in range(8):
            token = secrets.token_urlsafe(18)
            try:
                created = conn.execute(
                    text(
                        """
                        INSERT INTO public.tournaments (
                          title, location_name, starts_at, status, format,
                          teams_count, minutes_per_match, public_token,
                          created_by_user_id, created_at, updated_at
                        )
                        VALUES (
                          :title, :location_name, :starts_at, 'DRAFT', :format,
                          :teams_count, :minutes_per_match, :public_token,
                          :created_by_user_id, now(), now()
                        )
                        RETURNING id, title, location_name, starts_at, status, format,
                                  teams_count, minutes_per_match, public_token, created_at, updated_at
                        """
                    ),
                    {
                        "title": body.title,
                        "location_name": location_name,
                        "starts_at": starts_at,
                        "format": body.format,
                        "teams_count": body.teams_count,
                        "minutes_per_match": body.minutes_per_match,
                        "public_token": token,
                        "created_by_user_id": actor_user_id,
                    },
                ).mappings().first()
                break
            except IntegrityError:
                created = None
                continue

        if not created:
            raise HTTPException(status_code=500, detail="No se pudo generar un token publico unico.")

        public_url = f"/tournaments/{created['id']}/live?token={created['public_token']}"
        return {
            "id": str(created["id"]),
            "title": created["title"],
            "location_name": created["location_name"],
            "starts_at": str(created["starts_at"]) if created["starts_at"] else None,
            "status": created["status"],
            "format": created["format"],
            "teams_count": int(created["teams_count"]),
            "minutes_per_match": int(created["minutes_per_match"]),
            "public_token": created["public_token"],
            "public_url": public_url,
            "created_at": str(created["created_at"]),
            "updated_at": str(created["updated_at"]),
        }


@router.get("/tournaments")
def list_tournaments(
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
    status: str | None = None,
    limit: int = Query(50, ge=1, le=500),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)

        where = []
        params = {"limit": limit}
        if status:
            where.append("status = :status")
            params["status"] = status
        else:
            where.append("status != 'ARCHIVED'")

        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = conn.execute(
            text(
                f"""
                SELECT id, title, location_name, starts_at, status, format,
                       teams_count, minutes_per_match, public_token, created_at, updated_at
                FROM public.tournaments
                {where_clause}
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()

        items = []
        for r in rows:
            items.append(
                {
                    "id": str(r["id"]),
                    "title": r["title"],
                    "location_name": r["location_name"],
                    "starts_at": str(r["starts_at"]) if r["starts_at"] else None,
                    "status": r["status"],
                    "format": r["format"],
                    "teams_count": int(r["teams_count"]),
                    "minutes_per_match": int(r["minutes_per_match"]),
                    "public_token": r["public_token"],
                    "public_url": f"/tournaments/{r['id']}/live?token={r['public_token']}",
                    "created_at": str(r["created_at"]),
                    "updated_at": str(r["updated_at"]),
                }
            )
        return {"items": items, "count": len(items)}


@router.get("/tournaments/{tournament_id}")
def get_tournament_detail(
    tournament_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        teams, matches = _match_payload(conn, tournament_id)
        members = conn.execute(
            text(
                """
                SELECT id, tournament_id, team_id, member_type, user_id, guest_name, level_override, created_at
                FROM public.tournament_team_members
                WHERE tournament_id = :tournament_id
                ORDER BY created_at ASC
                """
            ),
            {"tournament_id": tournament_id},
        ).mappings().all()

        members_by_team: dict[str, list[dict]] = {}
        for m in members:
            members_by_team.setdefault(str(m["team_id"]), []).append(
                {
                    "id": str(m["id"]),
                    "tournament_id": str(m["tournament_id"]),
                    "team_id": str(m["team_id"]),
                    "member_type": m["member_type"],
                    "user_id": str(m["user_id"]) if m["user_id"] else None,
                    "guest_name": m["guest_name"],
                    "level_override": m["level_override"],
                    "created_at": str(m["created_at"]),
                }
            )

        team_payload = []
        for t in teams:
            team_payload.append(
                {
                    "id": str(t["id"]),
                    "tournament_id": str(t["tournament_id"]),
                    "name": t["name"],
                    "logo_emoji": t["logo_emoji"],
                    "is_guest": bool(t["is_guest"]),
                    "group_label": t.get("group_label"),
                    "created_at": str(t["created_at"]),
                    "members": members_by_team.get(str(t["id"]), []),
                }
            )

        # Compute standings based on format
        standings = []
        group_standings = None
        fmt = tournament["format"]
        if fmt == "ROUND_ROBIN":
            standings = compute_round_robin_standings(conn, tournament_id)
        elif fmt == "GROUPS_PLAYOFFS":
            group_labels = sorted(set(t.get("group_label") for t in teams if t.get("group_label")))
            if group_labels:
                group_standings = {}
                for g in group_labels:
                    group_standings[g] = compute_group_standings(conn, tournament_id, g)

        return {
            "tournament": {
                "id": str(tournament["id"]),
                "title": tournament["title"],
                "location_name": tournament["location_name"],
                "starts_at": str(tournament["starts_at"]) if tournament["starts_at"] else None,
                "status": tournament["status"],
                "format": tournament["format"],
                "teams_count": int(tournament["teams_count"]),
                "minutes_per_match": int(tournament["minutes_per_match"]),
                "public_token": tournament["public_token"],
                "public_url": f"/tournaments/{tournament['id']}/live?token={tournament['public_token']}",
                "created_at": str(tournament["created_at"]),
                "updated_at": str(tournament["updated_at"]),
            },
            "teams": team_payload,
            "matches": matches,
            "standings": standings,
            "group_standings": group_standings,
        }


@router.patch("/tournaments/{tournament_id}")
def update_tournament_config(
    tournament_id: str,
    body: TournamentUpdateRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "DRAFT":
            raise HTTPException(status_code=400, detail="Solo se puede editar config en DRAFT.")

        updates = []
        params = {"tournament_id": tournament_id}

        if body.title is not None:
            updates.append("title = :title")
            params["title"] = body.title
        if body.location_name is not None:
            updates.append("location_name = :location_name")
            params["location_name"] = body.location_name.strip() or None
        if body.starts_at is not None:
            try:
                starts_at_value = parse_client_datetime(body.starts_at, "starts_at")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            updates.append("starts_at = :starts_at")
            params["starts_at"] = starts_at_value
        if body.format is not None:
            updates.append("format = :format")
            params["format"] = body.format
        if body.teams_count is not None:
            updates.append("teams_count = :teams_count")
            params["teams_count"] = body.teams_count
        if body.minutes_per_match is not None:
            updates.append("minutes_per_match = :minutes_per_match")
            params["minutes_per_match"] = body.minutes_per_match

        if not updates:
            raise HTTPException(status_code=400, detail="No se enviaron cambios.")

        next_format = body.format or tournament["format"]
        next_teams_count = body.teams_count if body.teams_count is not None else int(tournament["teams_count"])
        if next_format == "KNOCKOUT" and next_teams_count not in (4, 8, 16):
            raise HTTPException(status_code=400, detail="KNOCKOUT requiere teams_count 4, 8 o 16.")
        if next_format == "GROUPS_PLAYOFFS" and next_teams_count not in GROUPS_PLAYOFFS_CONFIG:
            valid = ", ".join(str(k) for k in sorted(GROUPS_PLAYOFFS_CONFIG))
            raise HTTPException(status_code=400, detail=f"GROUPS_PLAYOFFS requiere teams_count: {valid}.")

        updates.append("updated_at = now()")
        conn.execute(text(f"UPDATE public.tournaments SET {', '.join(updates)} WHERE id = :tournament_id"), params)
        return {"ok": True}


@router.post("/tournaments/{tournament_id}/status")
def update_tournament_status(
    tournament_id: str,
    body: TournamentUpdateStatusRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        current = tournament["status"]
        requested = body.status

        valid = {"DRAFT": {"LIVE"}, "LIVE": {"FINISHED"}, "FINISHED": {"ARCHIVED"}, "ARCHIVED": set()}
        if requested not in valid.get(current, set()):
            raise HTTPException(status_code=400, detail=f"Transicion invalida: {current} -> {requested}.")

        if current == "DRAFT" and requested == "LIVE":
            fixture_count = conn.execute(
                text("SELECT COUNT(*) AS cnt FROM public.tournament_matches WHERE tournament_id = :id"),
                {"id": tournament_id},
            ).mappings().first()["cnt"]
            if int(fixture_count) == 0:
                raise HTTPException(status_code=400, detail="No se puede pasar a LIVE sin fixture generado.")

        conn.execute(
            text("UPDATE public.tournaments SET status = :status, updated_at = now() WHERE id = :id"),
            {"status": requested, "id": tournament_id},
        )
        return {"tournament_id": tournament_id, "status": requested}


@router.post("/tournaments/{tournament_id}/teams")
def create_team(
    tournament_id: str,
    body: TournamentCreateTeamRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "DRAFT":
            raise HTTPException(status_code=400, detail="Solo se pueden crear equipos en DRAFT.")

        try:
            team = conn.execute(
                text(
                    """
                    INSERT INTO public.tournament_teams (tournament_id, name, logo_emoji, is_guest, created_at)
                    VALUES (:tournament_id, :name, :logo_emoji, :is_guest, now())
                    RETURNING id, tournament_id, name, logo_emoji, is_guest, created_at
                    """
                ),
                {
                    "tournament_id": tournament_id,
                    "name": body.name.strip(),
                    "logo_emoji": body.logo_emoji,
                    "is_guest": body.is_guest,
                },
            ).mappings().first()
        except IntegrityError:
            raise HTTPException(status_code=409, detail="Ya existe un equipo con ese nombre en el torneo.")

        return {
            "id": str(team["id"]),
            "tournament_id": str(team["tournament_id"]),
            "name": team["name"],
            "logo_emoji": team["logo_emoji"],
            "is_guest": bool(team["is_guest"]),
            "created_at": str(team["created_at"]),
        }


@router.get("/tournaments/{tournament_id}/teams")
def list_teams(
    tournament_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)
        _get_tournament(conn, tournament_id)
        teams, _ = _team_map(conn, tournament_id)
        return {
            "items": [
                {
                    "id": str(t["id"]),
                    "tournament_id": str(t["tournament_id"]),
                    "name": t["name"],
                    "logo_emoji": t["logo_emoji"],
                    "is_guest": bool(t["is_guest"]),
                    "created_at": str(t["created_at"]),
                }
                for t in teams
            ],
            "count": len(teams),
        }


@router.delete("/tournaments/{tournament_id}/teams/{team_id}")
def delete_team(
    tournament_id: str,
    team_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "DRAFT":
            raise HTTPException(status_code=400, detail="Solo se pueden eliminar equipos en DRAFT.")

        team = conn.execute(
            text("SELECT id FROM public.tournament_teams WHERE id = :team_id AND tournament_id = :tournament_id"),
            {"team_id": team_id, "tournament_id": tournament_id},
        ).first()
        if not team:
            raise HTTPException(status_code=404, detail="Equipo no encontrado en el torneo.")

        matches_count = conn.execute(
            text("SELECT COUNT(*) AS cnt FROM public.tournament_matches WHERE tournament_id = :tournament_id"),
            {"tournament_id": tournament_id},
        ).mappings().first()["cnt"]
        if int(matches_count) > 0:
            raise HTTPException(status_code=400, detail="No se puede eliminar equipo con fixture ya generado.")

        conn.execute(
            text("DELETE FROM public.tournament_teams WHERE id = :team_id AND tournament_id = :tournament_id"),
            {"team_id": team_id, "tournament_id": tournament_id},
        )
        return {"ok": True}


@router.post("/tournaments/{tournament_id}/teams/{team_id}/members")
def add_member(
    tournament_id: str,
    team_id: str,
    body: TournamentCreateMemberRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "DRAFT":
            raise HTTPException(status_code=400, detail="Solo se pueden editar miembros en DRAFT.")

        team = conn.execute(
            text("SELECT id FROM public.tournament_teams WHERE id = :team_id AND tournament_id = :tournament_id"),
            {"team_id": team_id, "tournament_id": tournament_id},
        ).first()
        if not team:
            raise HTTPException(status_code=404, detail="Equipo no encontrado en el torneo.")

        if body.member_type == "USER":
            user = conn.execute(text("SELECT id FROM public.users WHERE id = :user_id"), {"user_id": body.user_id}).first()
            if not user:
                raise HTTPException(status_code=404, detail="Usuario no encontrado.")

        created = conn.execute(
            text(
                """
                INSERT INTO public.tournament_team_members (
                  tournament_id, team_id, member_type, user_id, guest_name, level_override, created_at
                )
                VALUES (:tournament_id, :team_id, :member_type, :user_id, :guest_name, :level_override, now())
                RETURNING id, tournament_id, team_id, member_type, user_id, guest_name, level_override, created_at
                """
            ),
            {
                "tournament_id": tournament_id,
                "team_id": team_id,
                "member_type": body.member_type,
                "user_id": body.user_id,
                "guest_name": body.guest_name,
                "level_override": body.level_override,
            },
        ).mappings().first()

        return {
            "id": str(created["id"]),
            "tournament_id": str(created["tournament_id"]),
            "team_id": str(created["team_id"]),
            "member_type": created["member_type"],
            "user_id": str(created["user_id"]) if created["user_id"] else None,
            "guest_name": created["guest_name"],
            "level_override": created["level_override"],
            "created_at": str(created["created_at"]),
        }


@router.get("/tournaments/{tournament_id}/teams/{team_id}/members")
def list_members(
    tournament_id: str,
    team_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.connect() as conn:
        require_admin(conn, actor_user_id)
        _get_tournament(conn, tournament_id)
        team = conn.execute(
            text("SELECT id FROM public.tournament_teams WHERE id = :team_id AND tournament_id = :tournament_id"),
            {"team_id": team_id, "tournament_id": tournament_id},
        ).first()
        if not team:
            raise HTTPException(status_code=404, detail="Equipo no encontrado en el torneo.")

        rows = conn.execute(
            text(
                """
                SELECT id, tournament_id, team_id, member_type, user_id, guest_name, level_override, created_at
                FROM public.tournament_team_members
                WHERE tournament_id = :tournament_id AND team_id = :team_id
                ORDER BY created_at ASC
                """
            ),
            {"tournament_id": tournament_id, "team_id": team_id},
        ).mappings().all()

        return {
            "items": [
                {
                    "id": str(r["id"]),
                    "tournament_id": str(r["tournament_id"]),
                    "team_id": str(r["team_id"]),
                    "member_type": r["member_type"],
                    "user_id": str(r["user_id"]) if r["user_id"] else None,
                    "guest_name": r["guest_name"],
                    "level_override": r["level_override"],
                    "created_at": str(r["created_at"]),
                }
                for r in rows
            ],
            "count": len(rows),
        }


@router.post("/tournaments/{tournament_id}/generate-fixture")
def generate_fixture(
    tournament_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "DRAFT":
            raise HTTPException(status_code=400, detail="Solo se puede generar fixture en DRAFT.")

        teams, _ = _team_map(conn, tournament_id)
        team_ids = [str(t["id"]) for t in teams]
        if len(team_ids) != int(tournament["teams_count"]):
            raise HTTPException(
                status_code=400,
                detail=f"La cantidad de equipos reales ({len(team_ids)}) no coincide con teams_count ({tournament['teams_count']}).",
            )

        existing_finished_or_live = conn.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM public.tournament_matches
                WHERE tournament_id = :tournament_id
                  AND status IN ('LIVE', 'FINISHED')
                """
            ),
            {"tournament_id": tournament_id},
        ).mappings().first()["cnt"]
        if int(existing_finished_or_live) > 0:
            raise HTTPException(status_code=400, detail="No se puede regenerar fixture: ya hay partidos LIVE/FINISHED.")

        conn.execute(text("DELETE FROM public.tournament_matches WHERE tournament_id = :tournament_id"), {"tournament_id": tournament_id})

        fmt = tournament["format"]
        team_group_map = None
        if fmt == "GROUPS_PLAYOFFS":
            if len(team_ids) not in GROUPS_PLAYOFFS_CONFIG:
                valid = ", ".join(str(k) for k in sorted(GROUPS_PLAYOFFS_CONFIG))
                raise HTTPException(status_code=400, detail=f"GROUPS_PLAYOFFS requiere {valid} equipos.")
            matches, team_group_map = _generate_groups_playoffs(team_ids)
        elif fmt == "ROUND_ROBIN":
            matches = _generate_round_robin(team_ids)
        elif fmt == "KNOCKOUT":
            if len(team_ids) not in (4, 8, 16) or not _is_power_of_two(len(team_ids)):
                raise HTTPException(status_code=400, detail="KNOCKOUT requiere 4, 8 o 16 equipos.")
            matches = _generate_knockout(team_ids)
        else:
            raise HTTPException(status_code=400, detail="Formato no soportado.")

        for m in matches:
            conn.execute(
                text(
                    """
                    INSERT INTO public.tournament_matches (
                      id, tournament_id, round, home_team_id, away_team_id,
                      status, home_goals, away_goals, sort_order,
                      group_label, stage, created_at
                    )
                    VALUES (
                      CAST(:id AS uuid), :tournament_id, :round,
                      CAST(:home_team_id AS uuid), CAST(:away_team_id AS uuid),
                      'PENDING', 0, 0, :sort_order,
                      :group_label, :stage, now()
                    )
                    """
                ),
                {
                    "id": m["id"],
                    "tournament_id": tournament_id,
                    "round": m["round"],
                    "home_team_id": m["home_team_id"],
                    "away_team_id": m["away_team_id"],
                    "sort_order": m["sort_order"],
                    "group_label": m.get("group_label"),
                    "stage": m.get("stage"),
                },
            )

        for link in [x for x in matches if x["next_match_id"] and x["next_slot"]]:
            conn.execute(
                text(
                    """
                    UPDATE public.tournament_matches
                    SET next_match_id = CAST(:next_match_id AS uuid),
                        next_slot = :next_slot
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"id": link["id"], "next_match_id": link["next_match_id"], "next_slot": link["next_slot"]},
            )

        # Update team group assignments for GROUPS_PLAYOFFS
        if team_group_map:
            for tid, glabel in team_group_map.items():
                conn.execute(
                    text("UPDATE public.tournament_teams SET group_label = :gl WHERE id = CAST(:tid AS uuid)"),
                    {"gl": glabel, "tid": tid},
                )

        conn.execute(text("UPDATE public.tournaments SET updated_at = now() WHERE id = :id"), {"id": tournament_id})

        _, payload = _match_payload(conn, tournament_id)
        return {"items": payload, "count": len(payload)}


@router.post("/tournaments/{tournament_id}/matches/{match_id}/start")
def start_match(
    tournament_id: str,
    match_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        if tournament["status"] != "LIVE":
            raise HTTPException(status_code=400, detail="Solo se puede iniciar partido cuando el torneo esta LIVE.")

        match = conn.execute(
            text(
                """
                SELECT id, status, home_team_id, away_team_id
                FROM public.tournament_matches
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {"match_id": match_id, "tournament_id": tournament_id},
        ).mappings().first()
        if not match:
            raise HTTPException(status_code=404, detail="Partido no encontrado.")
        if match["status"] != "PENDING":
            raise HTTPException(status_code=400, detail="Solo se puede iniciar un partido en estado PENDING.")
        if not match["home_team_id"] or not match["away_team_id"]:
            raise HTTPException(status_code=400, detail="Este partido aun no tiene ambos equipos definidos.")

        live_count = conn.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM public.tournament_matches
                WHERE tournament_id = :tournament_id
                  AND status = 'LIVE'
                  AND id != :match_id
                """
            ),
            {"tournament_id": tournament_id, "match_id": match_id},
        ).mappings().first()["cnt"]
        if int(live_count) > 0:
            raise HTTPException(status_code=400, detail="Ya hay un partido LIVE en este torneo.")

        conn.execute(
            text(
                """
                UPDATE public.tournament_matches
                SET status = 'LIVE', started_at = now()
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {"match_id": match_id, "tournament_id": tournament_id},
        )
        conn.execute(text("UPDATE public.tournaments SET updated_at = now() WHERE id = :id"), {"id": tournament_id})
        return {"match_id": match_id, "status": "LIVE"}


@router.patch("/tournaments/{tournament_id}/matches/{match_id}/score")
def patch_score(
    tournament_id: str,
    match_id: str,
    body: TournamentScorePatchRequest,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        _get_tournament(conn, tournament_id)
        match = conn.execute(
            text(
                """
                SELECT id, status
                FROM public.tournament_matches
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {"match_id": match_id, "tournament_id": tournament_id},
        ).mappings().first()
        if not match:
            raise HTTPException(status_code=404, detail="Partido no encontrado.")
        if match["status"] not in ("LIVE", "FINISHED"):
            raise HTTPException(
                status_code=400,
                detail="Solo se puede actualizar marcador en partidos LIVE o FINISHED.",
            )

        conn.execute(
            text(
                """
                UPDATE public.tournament_matches
                SET home_goals = :home_goals, away_goals = :away_goals
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {
                "home_goals": body.home_goals,
                "away_goals": body.away_goals,
                "match_id": match_id,
                "tournament_id": tournament_id,
            },
        )
        conn.execute(text("UPDATE public.tournaments SET updated_at = now() WHERE id = :id"), {"id": tournament_id})
        return {"match_id": match_id, "home_goals": body.home_goals, "away_goals": body.away_goals}


@router.post("/tournaments/{tournament_id}/matches/{match_id}/finish")
def finish_match(
    tournament_id: str,
    match_id: str,
    actor_user_id: str = Header(..., alias="X-Actor-User-Id"),
):
    with engine.begin() as conn:
        require_admin(conn, actor_user_id)
        tournament = _get_tournament(conn, tournament_id)
        match = conn.execute(
            text(
                """
                SELECT id, status, home_team_id, away_team_id, home_goals, away_goals,
                       next_match_id, next_slot, stage
                FROM public.tournament_matches
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {"match_id": match_id, "tournament_id": tournament_id},
        ).mappings().first()
        if not match:
            raise HTTPException(status_code=404, detail="Partido no encontrado.")
        if match["status"] != "LIVE":
            raise HTTPException(status_code=400, detail="Solo se puede finalizar un partido LIVE.")

        fmt = tournament["format"]
        is_knockout_match = fmt == "KNOCKOUT" or (fmt == "GROUPS_PLAYOFFS" and match["stage"] == "PLAYOFF")

        if is_knockout_match and int(match["home_goals"]) == int(match["away_goals"]):
            raise HTTPException(status_code=400, detail="En eliminacion directa no se puede finalizar con empate.")

        conn.execute(
            text(
                """
                UPDATE public.tournament_matches
                SET status = 'FINISHED', ended_at = now()
                WHERE id = :match_id AND tournament_id = :tournament_id
                """
            ),
            {"match_id": match_id, "tournament_id": tournament_id},
        )

        # Winner propagation for knockout / playoff matches
        if is_knockout_match and match["next_match_id"]:
            winner_id = match["home_team_id"] if int(match["home_goals"]) > int(match["away_goals"]) else match["away_team_id"]
            if winner_id:
                if match["next_slot"] == "HOME":
                    conn.execute(
                        text("UPDATE public.tournament_matches SET home_team_id = :winner_id WHERE id = :next_match_id"),
                        {"winner_id": winner_id, "next_match_id": match["next_match_id"]},
                    )
                elif match["next_slot"] == "AWAY":
                    conn.execute(
                        text("UPDATE public.tournament_matches SET away_team_id = :winner_id WHERE id = :next_match_id"),
                        {"winner_id": winner_id, "next_match_id": match["next_match_id"]},
                    )

        # Auto-seed playoffs when all group matches are finished
        if fmt == "GROUPS_PLAYOFFS" and match["stage"] == "GROUP":
            pending_group = conn.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt FROM public.tournament_matches
                    WHERE tournament_id = :tid AND stage = 'GROUP' AND status != 'FINISHED'
                    """
                ),
                {"tid": tournament_id},
            ).mappings().first()["cnt"]
            if int(pending_group) == 0:
                _seed_playoffs(conn, tournament_id)

        conn.execute(text("UPDATE public.tournaments SET updated_at = now() WHERE id = :id"), {"id": tournament_id})
        return {"match_id": match_id, "status": "FINISHED"}
