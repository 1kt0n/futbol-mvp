"""
API pública de competencias (sitio de la Copa Proud) + modo veedor. SIN login de miembro.

- `GET /public/competitions/{slug}`: snapshot completo (tablas, fixture, llaves, planteles,
  estadísticas) con micro-caché en proceso + ETag → 304. Solo si la competencia está
  PUBLISHED/LIVE/FINISHED (en DRAFT responde 404: la mesa central prepara sin exponer).
- Modo veedor: el link `/v/<token>` del sitio manda el token en el header `X-Staff-Token`
  (nunca en la URL de la API → no queda en logs). El token es opaco (~256 bits) y en la DB
  solo vive su SHA-256. Cada veedor opera únicamente sus partidos asignados y no puede
  tocar un partido ya confirmado por la mesa central.
"""
from fastapi import APIRouter, Header, HTTPException, Request, Response
from sqlalchemy import text

from app.schemas import CompetitionEventRequest, CompetitionMatchStatusRequest, CompetitionPenaltiesRequest
from app.settings import engine
from app.utils import competition_service as svc
from app.utils.ratelimit import client_ip, rate_limit
from app.utils.security import hash_management_token

router = APIRouter()


# ============================================================
# Snapshot público
# ============================================================

@router.get("/public/competitions/{slug}")
def get_public_competition(
    slug: str,
    request: Request,
    if_none_match: str | None = Header(None, alias="If-None-Match"),
):
    # Solo freno anti-abuso: en el predio cientos de teléfonos salen por la MISMA IP del WiFi
    # (750 teléfonos polleando cada 15 s ≈ 50 req/s). El snapshot sale de caché, es barato.
    rate_limit(f"comp-public:{client_ip(request)}", max_hits=6000, window_seconds=60)
    with engine.connect() as conn:
        snap = svc.cached_public_snapshot(conn, slug)
    headers = {"ETag": snap["etag"], "Cache-Control": "public, max-age=5", "Vary": "Accept-Encoding"}
    if if_none_match and if_none_match == snap["etag"]:
        return Response(status_code=304, headers=headers)
    if "gzip" in request.headers.get("accept-encoding", ""):
        # Ya comprimido en caché; GZipMiddleware lo deja pasar por traer Content-Encoding.
        return Response(content=snap["gzip"], media_type="application/json",
                        headers={**headers, "Content-Encoding": "gzip"})
    return Response(content=snap["body"], media_type="application/json", headers=headers)


# ============================================================
# Modo veedor
# ============================================================

def _require_staff(conn, request: Request, comp: dict, token: str | None) -> dict:
    row = None
    if token and len(token) >= 20:
        row = conn.execute(text("""
            SELECT id, full_name, role
            FROM public.competition_staff
            WHERE competition_id = :cid
              AND access_token_hash = :h
              AND revoked_at IS NULL
        """), {"cid": comp["id"], "h": hash_management_token(token)}).mappings().first()
    if not row:
        # Solo los intentos fallidos cuentan por IP (freno a fuerza bruta).
        rate_limit(f"comp-staff-fail:{client_ip(request)}", max_hits=30, window_seconds=60)
        raise HTTPException(status_code=401, detail="INVALID_STAFF_TOKEN")
    # Límite por veedor, NO por IP: en el predio los 6 veedores pueden salir por el mismo WiFi.
    rate_limit(f"comp-staff:{row['id']}", max_hits=120, window_seconds=60)
    return {"id": str(row["id"]), "full_name": row["full_name"], "role": row["role"]}


def _staff_match(conn, comp: dict, staff: dict, code: str) -> dict:
    """Partido que el veedor puede operar: asignado al partido o veedor de alguno de los dos equipos."""
    match = svc.get_match(conn, comp["id"], code, for_update=True)
    if not svc.staff_can_operate(conn, match, staff["id"]):
        raise HTTPException(status_code=403, detail="MATCH_NOT_ASSIGNED")
    svc.assert_editable(match)
    return match


@router.get("/public/competitions/{slug}/staff/me")
def staff_me(
    slug: str,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    with engine.connect() as conn:
        comp = svc.get_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        state = svc.load_state(conn, comp["id"])
        server_now = conn.execute(text("SELECT now()")).scalar()

    teams = {t["id"]: t for t in state["teams"]}
    team_veedor = {t["id"]: t["veedor_staff_id"] for t in state["teams"] if t["veedor_staff_id"]}
    staff_names = {s["id"]: s["full_name"] for s in state["staff"]}
    my_team_ids = [t["id"] for t in state["teams"] if t["veedor_staff_id"] == staff["id"]]
    players_by_team: dict = {}
    for p in state["players"]:
        players_by_team.setdefault(p["team_id"], []).append({
            "id": p["id"], "full_name": p["full_name"], "shirt_number": p["shirt_number"],
            "is_captain": p["is_captain"], "is_goalkeeper": p["is_goalkeeper"],
        })
    venues = {v["id"]: v for v in state["venues"]}

    def team_payload(tid):
        if not tid or tid not in teams:
            return None
        t = teams[tid]
        return {"id": tid, "name": t["name"], "short_name": t["short_name"],
                "country_code": t["country_code"], "logo_url": t["logo_url"], "color": t["color"],
                "players": players_by_team.get(tid, [])}

    mine = []
    for m in state["matches"]:
        veedor_ids = svc.match_veedor_ids(m, team_veedor)
        if staff["id"] not in veedor_ids:
            continue
        venue = venues.get(m["venue_id"])
        mine.append({
            "code": m["code"], "stage": m["stage"], "cup": m["cup"], "group": m["group"],
            "venue": venue["number"] if venue else None,
            "scheduled_at": m["scheduled_at"].isoformat() if m["scheduled_at"] else None,
            "status": m["status"], "confirmed": m["confirmed_at"] is not None,
            "home_source": m["home_source"], "away_source": m["away_source"],
            "home": team_payload(m["home_team_id"]), "away": team_payload(m["away_team_id"]),
            "home_goals": m["home_goals"], "away_goals": m["away_goals"],
            "home_pens": m["home_pens"], "away_pens": m["away_pens"],
            # Cuáles de los dos equipos son de este veedor (los dos pueden cargar; se resaltan los suyos).
            "my_team_ids": [t for t in (m["home_team_id"], m["away_team_id"]) if t in my_team_ids],
            "other_veedors": [staff_names[i] for i in veedor_ids if i != staff["id"] and i in staff_names],
            "events": [
                {"id": e["id"], "type": e["type"], "team_id": e["team_id"],
                 "player_id": e["player_id"], "minute": e["minute"],
                 "mine": e["created_by_staff_id"] == staff["id"],
                 "loaded_by": staff_names.get(e["created_by_staff_id"]) if e["created_by_staff_id"] else None,
                 "created_at": e["created_at"].isoformat() if e["created_at"] else None}
                for e in state["events"] if e["match_code"] == m["code"]
            ],
        })
    return {
        "competition": {"slug": comp["slug"], "name": comp["name"], "utc_offset": comp["utc_offset"]},
        "staff": {"full_name": staff["full_name"], "role": staff["role"],
                  "teams": [teams[t]["name"] for t in my_team_ids]},
        # Hora del servidor: el teléfono compara la antigüedad de los eventos sin depender de su reloj.
        "server_now": server_now.isoformat() if server_now else None,
        "matches": mine,
    }


@router.post("/public/competitions/{slug}/staff/matches/{code}/status")
def staff_match_status(
    slug: str,
    code: str,
    body: CompetitionMatchStatusRequest,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = _staff_match(conn, comp, staff, code)
        # El veedor no puede reabrir un partido terminado: eso es de la mesa central.
        return svc.change_status(conn, comp, match, body.status, allow_reopen=False,
                                 actor_staff_id=staff["id"])


@router.post("/public/competitions/{slug}/staff/matches/{code}/events")
def staff_add_event(
    slug: str,
    code: str,
    body: CompetitionEventRequest,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = _staff_match(conn, comp, staff, code)
        if match["status"] not in ("LIVE", "HALFTIME", "FINISHED"):
            raise HTTPException(status_code=409, detail="MATCH_NOT_STARTED")
        return svc.add_event(
            conn, comp, match, team_id=body.team_id, type_=body.type, player_id=body.player_id,
            shirt_number=body.shirt_number, minute=body.minute,
            client_event_id=body.client_event_id, source="VEEDOR", actor_staff_id=staff["id"],
        )


@router.delete("/public/competitions/{slug}/staff/matches/{code}/events/{event_id}")
def staff_delete_event(
    slug: str,
    code: str,
    event_id: str,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = _staff_match(conn, comp, staff, code)
        svc.delete_event(conn, comp, match, event_id, actor_staff_id=staff["id"])
        return {"deleted": True}


@router.put("/public/competitions/{slug}/staff/matches/{code}/penalties")
def staff_penalties(
    slug: str,
    code: str,
    body: CompetitionPenaltiesRequest,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = _staff_match(conn, comp, staff, code)
        svc.set_penalties(conn, comp, match, body.home_pens, body.away_pens, actor_staff_id=staff["id"])
        return {"home_pens": body.home_pens, "away_pens": body.away_pens}
