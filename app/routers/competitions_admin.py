"""
Mesa central de competencias (Copa Proud): `/admin/competitions/...` con login PIN + permisos.

Permisos (migración 018):
  competitions.view     → ver el detalle, vista previa del cierre y auditoría
  competitions.manage   → equipos, planteles, sorteo, veedores, cierre/reapertura de fase
  competitions.results  → cargar/corregir/confirmar resultados, eventos y W.O.

Toda escritura toma el lock de la competencia (`svc.lock_competition`) y termina con
`svc.bump_version` para que el snapshot público se refresque.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.schemas import (
    CompetitionDrawRequest,
    CompetitionEventPlayerRequest,
    CompetitionEventRequest,
    CompetitionMatchPatchRequest,
    CompetitionMatchStatusRequest,
    CompetitionPenaltiesRequest,
    CompetitionPlayerBulkRequest,
    CompetitionPlayerRequest,
    CompetitionPlayerUpdateRequest,
    CompetitionSlotsRequest,
    CompetitionStaffAssignRequest,
    CompetitionStaffRequest,
    CompetitionStaffTeamsRequest,
    CompetitionTeamBulkRequest,
    CompetitionTeamRequest,
    CompetitionTeamUpdateRequest,
    CompetitionUpdateRequest,
    CompetitionWalkoverRequest,
)
from app.settings import engine
from app.utils import competition_engine as ce
from app.utils import competition_service as svc
from app.utils.contact_crypto import encrypt_contact
from app.utils.deps import get_actor_user_id
from app.utils.permissions import require_permission
from app.utils.security import gen_management_token, hash_management_token

router = APIRouter()

VIEW, MANAGE, RESULTS = "competitions.view", "competitions.manage", "competitions.results"


def _authorize(conn, actor_user_id, perm) -> None:
    """
    Usuario logueado con el permiso. `actor_user_id=None` = la MESA DE CONTROL
    (competitions_control.py), que llama a estas funciones después de validar su link privado.
    Por HTTP este router nunca recibe None: get_actor_user_id exige sesión válida (401/422 si no).
    """
    if actor_user_id is None:
        return
    require_permission(conn, actor_user_id, perm)


def _integrity_detail(exc: IntegrityError) -> str:
    msg = str(exc.orig)
    if "uq_competition_teams_name" in msg:
        return "TEAM_NAME_TAKEN"
    if "uq_competition_players_shirt" in msg:
        return "SHIRT_NUMBER_TAKEN"
    if "uq_competition_group_slots_team" in msg:
        return "TEAM_ALREADY_IN_A_SLOT"
    return "CONFLICT"


# ============================================================
# Competencia
# ============================================================

@router.get("/competitions")
def list_competitions(actor_user_id: str = Depends(get_actor_user_id)):
    with engine.connect() as conn:
        _authorize(conn, actor_user_id, VIEW)
        rows = conn.execute(text("""
            SELECT c.slug, c.name, c.status, c.starts_on, c.ends_on, c.group_stage_closed_at,
                   (SELECT COUNT(*) FROM public.competition_teams t WHERE t.competition_id = c.id) AS teams,
                   (SELECT COUNT(*) FROM public.competition_matches m WHERE m.competition_id = c.id) AS matches
            FROM public.competitions c
            ORDER BY c.starts_on DESC NULLS LAST, c.created_at DESC
        """)).mappings().all()
    return [
        {**dict(r), "starts_on": r["starts_on"].isoformat() if r["starts_on"] else None,
         "ends_on": r["ends_on"].isoformat() if r["ends_on"] else None,
         "group_stage_closed": r["group_stage_closed_at"] is not None}
        for r in rows
    ]


@router.get("/competitions/{slug}")
def get_competition_admin(slug: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.connect() as conn:
        _authorize(conn, actor_user_id, VIEW)
        comp = svc.get_competition(conn, slug)
        return svc.build_snapshot(conn, comp, include_admin=True)


@router.patch("/competitions/{slug}")
def update_competition(slug: str, body: CompetitionUpdateRequest, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        conn.execute(text("""
            UPDATE public.competitions
            SET name = COALESCE(:name, name), status = COALESCE(:status, status)
            WHERE id = :cid
        """), {"name": body.name, "status": body.status, "cid": comp["id"]})
        svc.audit(conn, comp["id"], "COMPETITION_UPDATE", actor_user_id=actor_user_id,
                  metadata=body.model_dump(exclude_none=True))
        svc.bump_version(conn, comp["id"])
    return {"updated": True}


@router.get("/competitions/{slug}/audit")
def get_audit(slug: str, limit: int = Query(100, ge=1, le=500), actor_user_id: str = Depends(get_actor_user_id)):
    with engine.connect() as conn:
        _authorize(conn, actor_user_id, VIEW)
        comp = svc.get_competition(conn, slug)
        rows = conn.execute(text("""
            SELECT a.created_at, a.action, a.metadata, m.code AS match_code,
                   u.full_name AS user_name, s.full_name AS staff_name
            FROM public.competition_audit_log a
            LEFT JOIN public.competition_matches m ON m.id = a.match_id
            LEFT JOIN public.users u ON u.id = a.actor_user_id
            LEFT JOIN public.competition_staff s ON s.id = a.actor_staff_id
            WHERE a.competition_id = :cid
            ORDER BY a.created_at DESC
            LIMIT :lim
        """), {"cid": comp["id"], "lim": limit}).mappings().all()
    return [{**dict(r), "created_at": r["created_at"].isoformat()} for r in rows]


@router.post("/competitions/{slug}/sync")
def sync(slug: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Recalcula llaves (idempotente). Útil tras resolver un conflicto a mano."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return plan


# ============================================================
# Equipos y planteles
# ============================================================

def _insert_team(conn, comp_id, t) -> str:
    row = conn.execute(text("""
        INSERT INTO public.competition_teams
          (competition_id, name, short_name, country_code, city, logo_url, color)
        VALUES (:cid, :name, :short_name, :cc, :city, :logo_url, :color)
        RETURNING id
    """), {
        "cid": comp_id, "name": t.name.strip(), "short_name": t.short_name,
        "cc": t.country_code.upper() if t.country_code else None,
        "city": t.city, "logo_url": t.logo_url, "color": t.color,
    }).mappings().first()
    return str(row["id"])


@router.post("/competitions/{slug}/teams")
def create_team(slug: str, body: CompetitionTeamRequest, actor_user_id: str = Depends(get_actor_user_id)):
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            team_id = _insert_team(conn, comp["id"], body)
            svc.audit(conn, comp["id"], "TEAM_CREATE", actor_user_id=actor_user_id,
                      metadata={"team_id": team_id, "name": body.name})
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"team_id": team_id}


@router.post("/competitions/{slug}/teams/bulk")
def create_teams_bulk(slug: str, body: CompetitionTeamBulkRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Alta masiva (pegar las 28 filas). Si traen zona+posición, también carga el sorteo."""
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            fmt = svc.get_format(comp)
            created = []
            for t in body.teams:
                team_id = _insert_team(conn, comp["id"], t)
                created.append(team_id)
                if t.group and t.position:
                    _assign_slot(conn, comp, fmt, t.group.upper(), t.position, team_id)
            svc.audit(conn, comp["id"], "TEAM_BULK_CREATE", actor_user_id=actor_user_id,
                      metadata={"count": len(created)})
            plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"created": created, "conflicts": plan["conflicts"]}


@router.patch("/competitions/{slug}/teams/{team_id}")
def update_team(slug: str, team_id: str, body: CompetitionTeamUpdateRequest,
                actor_user_id: str = Depends(get_actor_user_id)):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"updated": False}
    if fields.get("country_code"):
        fields["country_code"] = fields["country_code"].upper()
    allowed = ("name", "short_name", "country_code", "city", "logo_url", "color")
    sets = ", ".join(f"{k} = :{k}" for k in fields if k in allowed)
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            res = conn.execute(text(f"""
                UPDATE public.competition_teams SET {sets}
                WHERE id = :tid AND competition_id = :cid
            """), {**fields, "tid": team_id, "cid": comp["id"]})
            if res.rowcount == 0:
                raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
            svc.audit(conn, comp["id"], "TEAM_UPDATE", actor_user_id=actor_user_id,
                      metadata={"team_id": team_id, **fields})
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"updated": True}


@router.delete("/competitions/{slug}/teams/{team_id}")
def delete_team(slug: str, team_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        played = conn.execute(text("""
            SELECT 1 FROM public.competition_matches
            WHERE competition_id = :cid AND status <> 'SCHEDULED'
              AND (home_team_id = :tid OR away_team_id = :tid)
            LIMIT 1
        """), {"cid": comp["id"], "tid": team_id}).first()
        if played:
            raise HTTPException(status_code=409, detail="TEAM_HAS_PLAYED")
        res = conn.execute(text("""
            DELETE FROM public.competition_teams WHERE id = :tid AND competition_id = :cid
        """), {"tid": team_id, "cid": comp["id"]})
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
        svc.audit(conn, comp["id"], "TEAM_DELETE", actor_user_id=actor_user_id, metadata={"team_id": team_id})
        svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"deleted": True}


def _team_in_comp(conn, comp_id, team_id) -> None:
    ok = conn.execute(text("""
        SELECT 1 FROM public.competition_teams WHERE id = :tid AND competition_id = :cid
    """), {"tid": team_id, "cid": comp_id}).first()
    if not ok:
        raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")


def _insert_player(conn, comp_id, team_id, p) -> str:
    row = conn.execute(text("""
        INSERT INTO public.competition_players
          (competition_id, team_id, full_name, shirt_number, is_captain, is_goalkeeper)
        VALUES (:cid, :tid, :name, :n, :cap, :gk)
        RETURNING id
    """), {"cid": comp_id, "tid": team_id, "name": p.full_name.strip(), "n": p.shirt_number,
           "cap": p.is_captain, "gk": p.is_goalkeeper}).mappings().first()
    return str(row["id"])


@router.post("/competitions/{slug}/teams/{team_id}/players")
def create_player(slug: str, team_id: str, body: CompetitionPlayerRequest,
                  actor_user_id: str = Depends(get_actor_user_id)):
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            _team_in_comp(conn, comp["id"], team_id)
            player_id = _insert_player(conn, comp["id"], team_id, body)
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"player_id": player_id}


@router.post("/competitions/{slug}/teams/{team_id}/players/bulk")
def create_players_bulk(slug: str, team_id: str, body: CompetitionPlayerBulkRequest,
                        actor_user_id: str = Depends(get_actor_user_id)):
    """Lista de buena fe completa (reglamento 4.1: hasta 15). El front parsea el CSV."""
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            _team_in_comp(conn, comp["id"], team_id)
            ids = [_insert_player(conn, comp["id"], team_id, p) for p in body.players]
            svc.audit(conn, comp["id"], "PLAYER_BULK_CREATE", actor_user_id=actor_user_id,
                      metadata={"team_id": team_id, "count": len(ids)})
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"created": ids}


@router.patch("/competitions/{slug}/players/{player_id}")
def update_player(slug: str, player_id: str, body: CompetitionPlayerUpdateRequest,
                  actor_user_id: str = Depends(get_actor_user_id)):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {"updated": False}
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            res = conn.execute(text(f"""
                UPDATE public.competition_players SET {sets}
                WHERE id = :pid AND competition_id = :cid
            """), {**fields, "pid": player_id, "cid": comp["id"]})
            if res.rowcount == 0:
                raise HTTPException(status_code=404, detail="PLAYER_NOT_FOUND")
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"updated": True}


@router.delete("/competitions/{slug}/players/{player_id}")
def delete_player(slug: str, player_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        res = conn.execute(text("""
            DELETE FROM public.competition_players WHERE id = :pid AND competition_id = :cid
        """), {"pid": player_id, "cid": comp["id"]})
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="PLAYER_NOT_FOUND")
        svc.bump_version(conn, comp["id"])
    return {"deleted": True}


# ============================================================
# Sorteo (posiciones en zona) y desempates por sorteo
# ============================================================

def _assign_slot(conn, comp: dict, fmt: dict, group: str, position: int, team_id) -> None:
    if group not in fmt["groups"] or not 1 <= position <= fmt["group_size"]:
        raise HTTPException(status_code=400, detail=f"INVALID_SLOT:{group}{position}")
    started = conn.execute(text("""
        SELECT 1 FROM public.competition_matches
        WHERE competition_id = :cid AND stage = 'GROUP' AND group_code = :g AND status <> 'SCHEDULED'
        LIMIT 1
    """), {"cid": comp["id"], "g": group}).first()
    if started:
        raise HTTPException(status_code=409, detail=f"GROUP_ALREADY_STARTED:{group}")
    if team_id:
        _team_in_comp(conn, comp["id"], team_id)
        # Un equipo ocupa un solo slot: si estaba en otro, se libera.
        conn.execute(text("""
            UPDATE public.competition_group_slots SET team_id = NULL
            WHERE competition_id = :cid AND team_id = :tid
        """), {"cid": comp["id"], "tid": team_id})
    conn.execute(text("""
        INSERT INTO public.competition_group_slots (competition_id, group_code, position, team_id)
        VALUES (:cid, :g, :pos, :tid)
        ON CONFLICT (competition_id, group_code, position) DO UPDATE SET team_id = EXCLUDED.team_id
    """), {"cid": comp["id"], "g": group, "pos": position, "tid": team_id})


@router.put("/competitions/{slug}/slots")
def assign_slots(slug: str, body: CompetitionSlotsRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Carga el resultado del sorteo: el fixture del sábado se completa solo."""
    try:
        with engine.begin() as conn:
            _authorize(conn, actor_user_id, MANAGE)
            comp = svc.lock_competition(conn, slug)
            if comp["group_stage_closed_at"] is not None:
                raise HTTPException(status_code=409, detail="GROUP_STAGE_CLOSED")
            fmt = svc.get_format(comp)
            for a in body.assignments:
                _assign_slot(conn, comp, fmt, a.group.upper(), a.position, a.team_id)
            svc.audit(conn, comp["id"], "SLOTS_ASSIGN", actor_user_id=actor_user_id,
                      metadata={"assignments": [a.model_dump() for a in body.assignments]})
            plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
            svc.bump_version(conn, comp["id"])
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail=_integrity_detail(exc))
    return {"updated": len(body.assignments), "conflicts": plan["conflicts"]}


@router.put("/competitions/{slug}/draws")
def set_draw(slug: str, body: CompetitionDrawRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Resultado de un sorteo de desempate (reglamento 1.5 criterio 5). Reemplaza el contexto."""
    ranks = [r.rank for r in body.ranks]
    if len(set(ranks)) != len(ranks):
        raise HTTPException(status_code=400, detail="DUPLICATE_RANKS")
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        for r in body.ranks:
            _team_in_comp(conn, comp["id"], r.team_id)
        conn.execute(text("""
            DELETE FROM public.competition_draws WHERE competition_id = :cid AND context = :ctx
        """), {"cid": comp["id"], "ctx": body.context})
        for r in body.ranks:
            conn.execute(text("""
                INSERT INTO public.competition_draws (competition_id, context, team_id, rank)
                VALUES (:cid, :ctx, :tid, :rank)
            """), {"cid": comp["id"], "ctx": body.context, "tid": r.team_id, "rank": r.rank})
        svc.audit(conn, comp["id"], "DRAW_SET", actor_user_id=actor_user_id,
                  metadata={"context": body.context, "ranks": [r.model_dump() for r in body.ranks]})
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"updated": True, "conflicts": plan["conflicts"]}


# ============================================================
# Cierre de fase de grupos
# ============================================================

@router.get("/competitions/{slug}/group-stage/preview")
def group_stage_preview(slug: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.connect() as conn:
        _authorize(conn, actor_user_id, VIEW)
        comp = svc.get_competition(conn, slug)
        state = svc.load_state(conn, comp["id"])
        standings = svc.compute_standings(comp, state)
        return ce.group_stage_close_check(
            state["matches"], slots=state["slots"], standings=standings,
            swap_rules=svc.get_format(comp).get("swap_rules"),
        )


@router.post("/competitions/{slug}/group-stage/close")
def close_group_stage(slug: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        if comp["group_stage_closed_at"] is not None:
            raise HTTPException(status_code=409, detail="GROUP_STAGE_ALREADY_CLOSED")
        state = svc.load_state(conn, comp["id"])
        standings = svc.compute_standings(comp, state)
        check = ce.group_stage_close_check(
            state["matches"], slots=state["slots"], standings=standings,
            swap_rules=svc.get_format(comp).get("swap_rules"),
        )
        if not check["can_close"]:
            raise HTTPException(status_code=409, detail={"code": "CANNOT_CLOSE_GROUP_STAGE", "check": check})
        conn.execute(text("""
            UPDATE public.competitions
            SET group_stage_closed_at = now(), group_stage_closed_by = :uid
            WHERE id = :cid
        """), {"uid": actor_user_id, "cid": comp["id"]})
        comp = svc.get_competition(conn, slug)
        svc.audit(conn, comp["id"], "GROUP_STAGE_CLOSE", actor_user_id=actor_user_id,
                  metadata={"preview": check["preview"]})
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"closed": True, "updates": len(plan["updates"]), "conflicts": plan["conflicts"]}


@router.post("/competitions/{slug}/group-stage/reopen")
def reopen_group_stage(slug: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Solo mientras ningún partido eliminatorio haya empezado (vacía los cruces del domingo)."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        started = conn.execute(text("""
            SELECT 1 FROM public.competition_matches
            WHERE competition_id = :cid AND stage <> 'GROUP' AND status <> 'SCHEDULED'
            LIMIT 1
        """), {"cid": comp["id"]}).first()
        if started:
            raise HTTPException(status_code=409, detail="KNOCKOUT_ALREADY_STARTED")
        conn.execute(text("""
            UPDATE public.competitions
            SET group_stage_closed_at = NULL, group_stage_closed_by = NULL
            WHERE id = :cid
        """), {"cid": comp["id"]})
        comp = svc.get_competition(conn, slug)
        svc.audit(conn, comp["id"], "GROUP_STAGE_REOPEN", actor_user_id=actor_user_id)
        svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"closed": False}


# ============================================================
# Veedores
# ============================================================

@router.post("/competitions/{slug}/staff")
def create_staff(slug: str, body: CompetitionStaffRequest, actor_user_id: str = Depends(get_actor_user_id)):
    """Crea el veedor y devuelve su link UNA sola vez (en la DB queda solo el hash)."""
    token = gen_management_token()
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        row = conn.execute(text("""
            INSERT INTO public.competition_staff
              (competition_id, full_name, role, contact_encrypted, access_token_hash, token_rotated_at)
            VALUES (:cid, :name, :role, :contact, :h, now())
            RETURNING id
        """), {
            "cid": comp["id"], "name": body.full_name.strip(), "role": body.role,
            "contact": encrypt_contact(body.contact) if body.contact else None,
            "h": hash_management_token(token),
        }).mappings().first()
        if body.team_ids:
            _set_staff_teams(conn, comp, str(row["id"]), body.team_ids)
        svc.audit(conn, comp["id"], "STAFF_CREATE", actor_user_id=actor_user_id,
                  metadata={"staff_id": str(row["id"]), "role": body.role, "team_ids": body.team_ids})
        svc.bump_version(conn, comp["id"])
    return {"staff_id": str(row["id"]), "token": token}


def _set_staff_teams(conn, comp: dict, staff_id: str, team_ids: list[str]) -> dict:
    """Deja a `staff_id` a cargo exactamente de `team_ids` (los que tenía y no están, quedan sin veedor)."""
    team_ids = list(dict.fromkeys(team_ids))
    if team_ids:
        found = conn.execute(text("""
            SELECT COUNT(*) FROM public.competition_teams
            WHERE competition_id = :cid AND id = ANY(CAST(:ids AS uuid[]))
        """), {"cid": comp["id"], "ids": team_ids}).scalar()
        if found != len(team_ids):
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
    released = conn.execute(text("""
        UPDATE public.competition_teams SET veedor_staff_id = NULL
        WHERE competition_id = :cid AND veedor_staff_id = CAST(:sid AS uuid)
          AND NOT (id = ANY(CAST(:ids AS uuid[])))
    """), {"cid": comp["id"], "sid": staff_id, "ids": team_ids}).rowcount
    assigned = conn.execute(text("""
        UPDATE public.competition_teams SET veedor_staff_id = CAST(:sid AS uuid)
        WHERE competition_id = :cid AND id = ANY(CAST(:ids AS uuid[]))
    """), {"cid": comp["id"], "sid": staff_id, "ids": team_ids}).rowcount
    return {"assigned": assigned, "released": released}


@router.put("/competitions/{slug}/staff/{staff_id}/teams")
def set_staff_teams(slug: str, staff_id: str, body: CompetitionStaffTeamsRequest,
                    actor_user_id: str = Depends(get_actor_user_id)):
    """Equipos a cargo de un veedor: puede cargar todos los partidos de esos equipos (también el domingo)."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        ok = conn.execute(text("""
            SELECT 1 FROM public.competition_staff WHERE id = :sid AND competition_id = :cid
        """), {"sid": staff_id, "cid": comp["id"]}).first()
        if not ok:
            raise HTTPException(status_code=404, detail="STAFF_NOT_FOUND")
        result = _set_staff_teams(conn, comp, staff_id, body.team_ids)
        svc.audit(conn, comp["id"], "STAFF_SET_TEAMS", actor_user_id=actor_user_id,
                  metadata={"staff_id": staff_id, "team_ids": body.team_ids, **result})
        svc.bump_version(conn, comp["id"])
    return result


@router.post("/competitions/{slug}/staff/{staff_id}/rotate-token")
def rotate_staff_token(slug: str, staff_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    """Nuevo link (el anterior deja de funcionar al instante). También reactiva un revocado."""
    token = gen_management_token()
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        res = conn.execute(text("""
            UPDATE public.competition_staff
            SET access_token_hash = :h, token_rotated_at = now(), revoked_at = NULL
            WHERE id = :sid AND competition_id = :cid
        """), {"h": hash_management_token(token), "sid": staff_id, "cid": comp["id"]})
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="STAFF_NOT_FOUND")
        svc.audit(conn, comp["id"], "STAFF_ROTATE_TOKEN", actor_user_id=actor_user_id,
                  metadata={"staff_id": staff_id})
    return {"staff_id": staff_id, "token": token}


@router.post("/competitions/{slug}/staff/{staff_id}/revoke")
def revoke_staff(slug: str, staff_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        res = conn.execute(text("""
            UPDATE public.competition_staff SET revoked_at = now()
            WHERE id = :sid AND competition_id = :cid
        """), {"sid": staff_id, "cid": comp["id"]})
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="STAFF_NOT_FOUND")
        svc.audit(conn, comp["id"], "STAFF_REVOKE", actor_user_id=actor_user_id, metadata={"staff_id": staff_id})
    return {"revoked": True}


@router.post("/competitions/{slug}/staff/{staff_id}/assign")
def assign_staff_to_venue(slug: str, staff_id: str, body: CompetitionStaffAssignRequest,
                          actor_user_id: str = Depends(get_actor_user_id)):
    """Asigna el veedor a TODOS los partidos de una cancha en un día (atajo de la grilla)."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, MANAGE)
        comp = svc.lock_competition(conn, slug)
        ok = conn.execute(text("""
            SELECT 1 FROM public.competition_staff WHERE id = :sid AND competition_id = :cid
        """), {"sid": staff_id, "cid": comp["id"]}).first()
        if not ok:
            raise HTTPException(status_code=404, detail="STAFF_NOT_FOUND")
        res = conn.execute(text("""
            UPDATE public.competition_matches m
            SET veedor_staff_id = :sid, updated_at = now()
            FROM public.competition_venues v
            WHERE m.competition_id = :cid
              AND v.id = m.venue_id AND v.number = :venue
              AND (m.scheduled_at AT TIME ZONE 'UTC' + CAST(:off AS interval))::date = CAST(:d AS date)
        """), {"sid": staff_id, "cid": comp["id"], "venue": body.venue, "d": body.date,
               "off": comp["utc_offset"]})
        svc.audit(conn, comp["id"], "STAFF_ASSIGN_VENUE", actor_user_id=actor_user_id,
                  metadata={"staff_id": staff_id, "venue": body.venue, "date": body.date,
                            "matches": res.rowcount})
        svc.bump_version(conn, comp["id"])
    return {"assigned": res.rowcount}


# ============================================================
# Partidos (mesa central)
# ============================================================

@router.patch("/competitions/{slug}/matches/{code}")
def patch_match(slug: str, code: str, body: CompetitionMatchPatchRequest,
                actor_user_id: str = Depends(get_actor_user_id)):
    """Corrige marcador/penales/veedor/árbitro/notas. Un partido confirmado hay que desconfirmarlo antes."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        fields = body.model_dump(exclude_unset=True)
        touches_result = any(k in fields for k in ("home_goals", "away_goals", "home_pens", "away_pens", "clear_penalties"))
        if touches_result:
            svc.assert_editable(match)
            if match["status"] == "SCHEDULED":
                raise HTTPException(status_code=409, detail="MATCH_NOT_STARTED")

        sets, params = [], {"mid": match["id"]}
        for k in ("home_goals", "away_goals", "home_pens", "away_pens", "referee_name", "notes"):
            if k in fields:
                sets.append(f"{k} = :{k}")
                params[k] = fields[k]
        if fields.get("clear_penalties"):
            sets += ["home_pens = NULL", "away_pens = NULL"]
        if "veedor_staff_id" in fields and fields["veedor_staff_id"]:
            ok = conn.execute(text("""
                SELECT 1 FROM public.competition_staff WHERE id = :sid AND competition_id = :cid
            """), {"sid": fields["veedor_staff_id"], "cid": comp["id"]}).first()
            if not ok:
                raise HTTPException(status_code=404, detail="STAFF_NOT_FOUND")
            sets.append("veedor_staff_id = :veedor")
            params["veedor"] = fields["veedor_staff_id"]
        if fields.get("clear_veedor"):
            sets.append("veedor_staff_id = NULL")
        if not sets:
            return {"updated": False}

        conn.execute(text(f"""
            UPDATE public.competition_matches SET {", ".join(sets)}, updated_at = now() WHERE id = :mid
        """), params)
        if touches_result and match["status"] in ce.FINISHED_STATUSES:
            updated = svc.get_match(conn, comp["id"], code)
            svc.assert_can_finish(updated)
        svc.audit(conn, comp["id"], "MATCH_PATCH", actor_user_id=actor_user_id, match_id=match["id"],
                  metadata={k: v for k, v in fields.items()})
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id) if touches_result else {"conflicts": []}
        svc.bump_version(conn, comp["id"])
    return {"updated": True, "conflicts": plan["conflicts"]}


@router.post("/competitions/{slug}/matches/{code}/result")
def set_final_result(slug: str, code: str, body: CompetitionMatchPatchRequest,
                     actor_user_id: str = Depends(get_actor_user_id)):
    """
    Atajo de la mesa central para cargar desde la planilla: marcador (y penales) finales
    y el partido queda FINISHED, sin pasar por LIVE.
    """
    if body.home_goals is None or body.away_goals is None:
        raise HTTPException(status_code=400, detail="SCORE_REQUIRED")
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        if not match["home_team_id"] or not match["away_team_id"]:
            raise HTTPException(status_code=409, detail="TEAMS_NOT_DEFINED")
        candidate = {**match, "home_goals": body.home_goals, "away_goals": body.away_goals,
                     "home_pens": body.home_pens, "away_pens": body.away_pens}
        svc.assert_can_finish(candidate)
        conn.execute(text("""
            UPDATE public.competition_matches
            SET status = 'FINISHED', home_goals = :hg, away_goals = :ag,
                home_pens = :hp, away_pens = :ap,
                started_at = COALESCE(started_at, now()), ended_at = COALESCE(ended_at, now()),
                updated_at = now()
            WHERE id = :mid
        """), {"hg": body.home_goals, "ag": body.away_goals, "hp": body.home_pens,
               "ap": body.away_pens, "mid": match["id"]})
        if comp["status"] == "PUBLISHED":
            conn.execute(text("UPDATE public.competitions SET status = 'LIVE' WHERE id = :cid"), {"cid": comp["id"]})
        svc.audit(conn, comp["id"], "MATCH_RESULT", actor_user_id=actor_user_id, match_id=match["id"],
                  metadata={"home_goals": body.home_goals, "away_goals": body.away_goals,
                            "home_pens": body.home_pens, "away_pens": body.away_pens,
                            "from_status": match["status"]})
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"status": "FINISHED", "conflicts": plan["conflicts"]}


@router.post("/competitions/{slug}/matches/{code}/status")
def admin_match_status(slug: str, code: str, body: CompetitionMatchStatusRequest,
                       actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        # La mesa central SÍ puede reabrir un partido terminado (FINISHED → LIVE).
        return svc.change_status(conn, comp, match, body.status, allow_reopen=True, actor_user_id=actor_user_id)


@router.post("/competitions/{slug}/matches/{code}/walkover")
def walkover(slug: str, code: str, body: CompetitionWalkoverRequest,
             actor_user_id: str = Depends(get_actor_user_id)):
    """W.O. (reglamento 5.5 / 7.4): 3-0 para el equipo presente."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        if not match["home_team_id"] or not match["away_team_id"]:
            raise HTTPException(status_code=409, detail="TEAMS_NOT_DEFINED")
        goals = int(svc.effective_settings(comp).get("walkover_goals", 3))
        hg, ag = (goals, 0) if body.winner == "HOME" else (0, goals)
        conn.execute(text("""
            UPDATE public.competition_matches
            SET status = 'WALKOVER', home_goals = :hg, away_goals = :ag,
                home_pens = NULL, away_pens = NULL, ended_at = now(), updated_at = now()
            WHERE id = :mid
        """), {"hg": hg, "ag": ag, "mid": match["id"]})
        svc.audit(conn, comp["id"], "MATCH_WALKOVER", actor_user_id=actor_user_id, match_id=match["id"],
                  metadata={"winner": body.winner})
        plan = svc.sync_bracket(conn, comp, actor_user_id=actor_user_id)
        svc.bump_version(conn, comp["id"])
    return {"status": "WALKOVER", "conflicts": plan["conflicts"]}


@router.post("/competitions/{slug}/matches/{code}/confirm")
def confirm_match(slug: str, code: str, actor_user_id: str = Depends(get_actor_user_id)):
    """✓ Resultado oficial (cotejado con la planilla firmada). Bloquea ediciones del veedor."""
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        if match["status"] not in ce.FINISHED_STATUSES:
            raise HTTPException(status_code=409, detail="MATCH_NOT_FINISHED")
        conn.execute(text("""
            UPDATE public.competition_matches
            SET confirmed_at = now(), confirmed_by_user_id = :uid, updated_at = now()
            WHERE id = :mid
        """), {"uid": actor_user_id, "mid": match["id"]})
        svc.audit(conn, comp["id"], "MATCH_CONFIRM", actor_user_id=actor_user_id, match_id=match["id"])
        svc.bump_version(conn, comp["id"])
    return {"confirmed": True}


@router.post("/competitions/{slug}/matches/{code}/unconfirm")
def unconfirm_match(slug: str, code: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        conn.execute(text("""
            UPDATE public.competition_matches
            SET confirmed_at = NULL, confirmed_by_user_id = NULL, updated_at = now()
            WHERE id = :mid
        """), {"mid": match["id"]})
        svc.audit(conn, comp["id"], "MATCH_UNCONFIRM", actor_user_id=actor_user_id, match_id=match["id"])
        svc.bump_version(conn, comp["id"])
    return {"confirmed": False}


@router.post("/competitions/{slug}/matches/{code}/events")
def admin_add_event(slug: str, code: str, body: CompetitionEventRequest,
                    actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        if match["status"] == "SCHEDULED":
            raise HTTPException(status_code=409, detail="MATCH_NOT_STARTED")
        return svc.add_event(
            conn, comp, match, team_id=body.team_id, type_=body.type, player_id=body.player_id,
            shirt_number=body.shirt_number, minute=body.minute,
            client_event_id=body.client_event_id, source="ADMIN", actor_user_id=actor_user_id,
        )


@router.delete("/competitions/{slug}/matches/{code}/events/{event_id}")
def admin_delete_event(slug: str, code: str, event_id: str, actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        svc.delete_event(conn, comp, match, event_id, actor_user_id=actor_user_id)
    return {"deleted": True}


@router.patch("/competitions/{slug}/matches/{code}/events/{event_id}")
def admin_event_player(slug: str, code: str, event_id: str, body: CompetitionEventPlayerRequest,
                       actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        return svc.set_event_player(conn, comp, match, event_id, body.player_id, actor_user_id=actor_user_id)


@router.put("/competitions/{slug}/matches/{code}/penalties")
def admin_penalties(slug: str, code: str, body: CompetitionPenaltiesRequest,
                    actor_user_id: str = Depends(get_actor_user_id)):
    with engine.begin() as conn:
        _authorize(conn, actor_user_id, RESULTS)
        comp = svc.lock_competition(conn, slug)
        match = svc.get_match(conn, comp["id"], code, for_update=True)
        svc.assert_editable(match)
        svc.set_penalties(conn, comp, match, body.home_pens, body.away_pens, actor_user_id=actor_user_id)
    return {"home_pens": body.home_pens, "away_pens": body.away_pens}
