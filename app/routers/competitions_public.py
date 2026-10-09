"""
API pública de competencias (sitio de la Copa Proud) + modo veedor. SIN login de miembro.

- `GET /public/competitions/{slug}`: snapshot completo (tablas, fixture, llaves, planteles,
  estadísticas) con micro-caché en proceso + ETag → 304. Solo si la competencia está
  PUBLISHED/LIVE/FINISHED (en DRAFT responde 404: la mesa central prepara sin exponer).
- Modo veedor: el link `/v/<token>` del sitio manda el token en el header `X-Staff-Token`
  (nunca en la URL de la API → no queda en logs). El token es opaco (~256 bits) y en la DB
  solo vive su SHA-256. Los veedores ROTAN entre canchas: el que llega TOMA el partido
  (`/claim`) y desde ahí es el único que lo carga; no puede tocar uno ya confirmado por la mesa.
"""
from fastapi import APIRouter, Header, HTTPException, Request, Response
from sqlalchemy import text

from app.schemas import (
    CompetitionClaimRequest,
    CompetitionEventPlayerRequest,
    CompetitionEventRequest,
    CompetitionMatchStatusRequest,
    CompetitionPenaltiesRequest,
)
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
    """
    TODOS los partidos (para elegir la cancha) con quién tiene cada uno (`holder`). Los veedores
    rotan: el que llega a la cancha TOMA el partido (`/claim`) y desde ahí es el único que lo carga.
    Los equipos van una sola vez en `teams` (con planteles); cada partido los referencia por id.
    """
    with engine.connect() as conn:
        comp = svc.get_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        state = svc.load_state(conn, comp["id"])
        server_now = conn.execute(text("SELECT now()")).scalar()

    me = staff["id"]
    team_veedor = {t["id"]: t["veedor_staff_id"] for t in state["teams"] if t["veedor_staff_id"]}
    staff_names = {s["id"]: s["full_name"] for s in state["staff"]}
    my_team_ids = [t["id"] for t in state["teams"] if t["veedor_staff_id"] == me]
    players_by_team: dict = {}
    for p in state["players"]:
        players_by_team.setdefault(p["team_id"], []).append({
            "id": p["id"], "full_name": p["full_name"], "shirt_number": p["shirt_number"],
            "is_captain": p["is_captain"], "is_goalkeeper": p["is_goalkeeper"],
        })
    teams = {
        t["id"]: {"id": t["id"], "name": t["name"], "short_name": t["short_name"],
                  "country_code": t["country_code"], "logo_url": t["logo_url"], "color": t["color"],
                  "players": players_by_team.get(t["id"], [])}
        for t in state["teams"]
    }
    venues = {v["id"]: v for v in state["venues"]}
    events_by_match: dict = {}
    for e in state["events"]:
        events_by_match.setdefault(e["match_code"], []).append(e)

    matches = []
    for m in state["matches"]:
        veedor_ids = svc.match_veedor_ids(m, team_veedor)
        holder_id = m["veedor_staff_id"]
        holder = holder_id == me
        can_operate = me in veedor_ids
        venue = venues.get(m["venue_id"])
        matches.append({
            "code": m["code"], "stage": m["stage"], "cup": m["cup"], "group": m["group"],
            "venue": venue["number"] if venue else None,
            "scheduled_at": m["scheduled_at"].isoformat() if m["scheduled_at"] else None,
            "status": m["status"], "confirmed": m["confirmed_at"] is not None,
            "home_source": m["home_source"], "away_source": m["away_source"],
            "home_team_id": m["home_team_id"], "away_team_id": m["away_team_id"],
            "home_goals": m["home_goals"], "away_goals": m["away_goals"],
            "home_pens": m["home_pens"], "away_pens": m["away_pens"],
            # Quién lo tomó (o se lo asignó la mesa). None = libre.
            "holder": {"name": staff_names.get(holder_id), "me": holder} if holder_id else None,
            # Puede cargarlo: lo tiene él o es veedor de alguno de los dos equipos (modelo anterior).
            "mine": can_operate,
            "my_team_ids": [t for t in (m["home_team_id"], m["away_team_id"]) if t in my_team_ids],
            "other_veedors": [staff_names[i] for i in veedor_ids if i != me and i in staff_names],
            "events": [
                {"id": e["id"], "type": e["type"], "team_id": e["team_id"],
                 "player_id": e["player_id"], "minute": e["minute"],
                 "mine": e["created_by_staff_id"] == me,
                 # Deshacer / asignar jugador: solo en un partido que puede operar (ver svc).
                 "editable": can_operate and svc.staff_can_edit_event(e, me, holder=holder),
                 "loaded_by": staff_names.get(e["created_by_staff_id"]) if e["created_by_staff_id"] else None,
                 "created_at": e["created_at"].isoformat() if e["created_at"] else None}
                for e in events_by_match.get(m["code"], [])
            ],
        })
    return {
        "competition": {"slug": comp["slug"], "name": comp["name"], "utc_offset": comp["utc_offset"]},
        "staff": {"full_name": staff["full_name"], "role": staff["role"],
                  "teams": [teams[t]["name"] for t in my_team_ids]},
        "venues": [v["number"] for v in state["venues"]],
        "teams": teams,
        # Hora del servidor: el teléfono compara la antigüedad de los eventos sin depender de su reloj.
        "server_now": server_now.isoformat() if server_now else None,
        "matches": matches,
    }


def _holder_id(match: dict) -> str | None:
    return str(match["veedor_staff_id"]) if match.get("veedor_staff_id") else None


@router.post("/public/competitions/{slug}/staff/matches/{code}/claim")
def staff_claim(
    slug: str,
    code: str,
    request: Request,
    body: CompetitionClaimRequest | None = None,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    """
    El veedor toma el partido de la cancha donde está: desde ahí es el único que lo carga (así no
    hay dos cargando el mismo). Si lo tiene otro → 409 MATCH_TAKEN; con force=True se lo saca
    (al otro le deja de andar). Con el lock de la competencia dos veedores no lo toman a la vez.
    """
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        current = _holder_id(match)
        if current == staff["id"]:
            return {"claimed": True, "changed": False}
        if current and not (body and body.force):
            raise HTTPException(status_code=409, detail="MATCH_TAKEN")
        conn.execute(text("""
            UPDATE public.competition_matches SET veedor_staff_id = :sid, updated_at = now() WHERE id = :mid
        """), {"sid": staff["id"], "mid": match["id"]})
        svc.audit(conn, comp["id"], "MATCH_TAKEOVER" if current else "MATCH_CLAIM",
                  actor_staff_id=staff["id"], match_id=match["id"],
                  metadata={"from": current, "to": staff["id"]} if current else {"to": staff["id"]})
        svc.bump_version(conn, comp["id"])
        return {"claimed": True, "changed": True, "took_over": bool(current)}


@router.post("/public/competitions/{slug}/staff/matches/{code}/release")
def staff_release(
    slug: str,
    code: str,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    """Soltar un partido tomado por error. Solo antes de empezar; después, lo reasigna la mesa."""
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        if _holder_id(match) != staff["id"]:
            raise HTTPException(status_code=403, detail="MATCH_NOT_ASSIGNED")
        if match["status"] != "SCHEDULED":
            raise HTTPException(status_code=409, detail="MATCH_ALREADY_STARTED")
        conn.execute(text("""
            UPDATE public.competition_matches SET veedor_staff_id = NULL, updated_at = now() WHERE id = :mid
        """), {"mid": match["id"]})
        svc.audit(conn, comp["id"], "MATCH_RELEASE", actor_staff_id=staff["id"], match_id=match["id"])
        svc.bump_version(conn, comp["id"])
        return {"released": True}


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
        svc.delete_event(conn, comp, match, event_id, actor_staff_id=staff["id"],
                         holder=_holder_id(match) == staff["id"])
        return {"deleted": True}


@router.patch("/public/competitions/{slug}/staff/matches/{code}/events/{event_id}")
def staff_event_player(
    slug: str,
    code: str,
    event_id: str,
    body: CompetitionEventPlayerRequest,
    request: Request,
    x_staff_token: str | None = Header(None, alias="X-Staff-Token"),
):
    """Asignar o corregir el jugador de un gol/tarjeta propio. Vale también con el partido
    terminado, hasta que la mesa central lo confirme."""
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        staff = _require_staff(conn, request, comp, x_staff_token)
        match = _staff_match(conn, comp, staff, code)
        return svc.set_event_player(conn, comp, match, event_id, body.player_id, actor_staff_id=staff["id"],
                                    holder=_holder_id(match) == staff["id"])


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
