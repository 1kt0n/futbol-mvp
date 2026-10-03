"""
Capa de servicio del módulo `competitions`: I/O contra la DB alrededor del motor puro
(`competition_engine.py`). La usan el router admin (mesa central), el del veedor y el
público.

Reglas de concurrencia: toda escritura abre `engine.begin()` y llama primero a
`lock_competition(...)` (SELECT ... FOR UPDATE sobre la fila de la competencia). Así las
escrituras de una misma competencia se serializan (6 veedores + mesa central en paralelo)
y la propagación de llaves + `data_version` quedan consistentes.
"""
import gzip
import hashlib
import json
import threading
import time

from fastapi import HTTPException
from sqlalchemy import text

from app.utils import competition_engine as ce
from app.utils.competition_formats import FORMATS
from app.utils.contact_crypto import decrypt_contact

PUBLIC_STATUSES = ("PUBLISHED", "LIVE", "FINISHED")


# ============================================================
# Lectura
# ============================================================

_COMP_COLS = """
    id, slug, name, format_code, status, starts_on, ends_on, utc_offset, settings,
    group_stage_closed_at, data_version, created_at, updated_at
"""


def get_competition(conn, slug: str, *, for_update: bool = False):
    sql = f"SELECT {_COMP_COLS} FROM public.competitions WHERE slug = :slug"
    if for_update:
        sql += " FOR UPDATE"
    row = conn.execute(text(sql), {"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="COMPETITION_NOT_FOUND")
    return dict(row)


def lock_competition(conn, slug: str) -> dict:
    return get_competition(conn, slug, for_update=True)


def get_format(comp: dict) -> dict:
    fmt = FORMATS.get(comp["format_code"])
    if not fmt:
        raise HTTPException(status_code=500, detail="Formato de competencia desconocido.")
    return fmt


def effective_settings(comp: dict) -> dict:
    """Settings del formato, pisados por los guardados en la competencia (si hay)."""
    fmt = get_format(comp)
    settings = dict(fmt["settings"])
    stored = comp.get("settings") or {}
    if isinstance(stored, str):
        stored = json.loads(stored)
    settings.update(stored)
    return settings


def broadcast_settings(comp: dict) -> dict:
    """Transmisión del sorteo (YouTube + hora de inicio), con los defaults del formato."""
    b = dict(effective_settings(comp).get("broadcast") or {})
    yid = b.get("youtube_id")
    return {
        "starts_at": b.get("starts_at"),
        "youtube_id": yid,
        "youtube_url": f"https://www.youtube.com/watch?v={yid}" if yid else None,
        "spoiler_delay_s": int(b.get("spoiler_delay_s") or 0),
    }


def _s(v):
    return str(v) if v is not None else None


def load_state(conn, comp_id) -> dict:
    """Todo lo que el motor y el snapshot necesitan, en una pasada."""
    p = {"cid": comp_id}
    teams = [dict(r) for r in conn.execute(text("""
        SELECT id, name, short_name, country_code, city, logo_url, color, veedor_staff_id
        FROM public.competition_teams WHERE competition_id = :cid
        ORDER BY lower(name)
    """), p).mappings().all()]
    players = [dict(r) for r in conn.execute(text("""
        SELECT id, team_id, full_name, shirt_number, is_captain, is_goalkeeper
        FROM public.competition_players WHERE competition_id = :cid
        ORDER BY shirt_number NULLS LAST, lower(full_name)
    """), p).mappings().all()]
    slot_rows = conn.execute(text("""
        SELECT group_code, position, team_id
        FROM public.competition_group_slots WHERE competition_id = :cid
    """), p).mappings().all()
    draw_rows = conn.execute(text("""
        SELECT context, team_id, rank FROM public.competition_draws WHERE competition_id = :cid
    """), p).mappings().all()
    venues = [dict(r) for r in conn.execute(text("""
        SELECT id, number, name FROM public.competition_venues
        WHERE competition_id = :cid ORDER BY number
    """), p).mappings().all()]
    staff = [dict(r) for r in conn.execute(text("""
        SELECT id, full_name, role, contact_encrypted,
               (access_token_hash IS NOT NULL AND revoked_at IS NULL) AS has_active_link,
               token_rotated_at, revoked_at
        FROM public.competition_staff WHERE competition_id = :cid
        ORDER BY lower(full_name)
    """), p).mappings().all()]
    match_rows = conn.execute(text("""
        SELECT m.id, m.code, m.stage, m.cup, m.group_code, m.venue_id, m.scheduled_at,
               m.home_source, m.away_source, m.home_team_id, m.away_team_id, m.status,
               m.home_goals, m.away_goals, m.home_pens, m.away_pens, m.started_at, m.ended_at,
               m.veedor_staff_id, m.referee_name, m.confirmed_at, m.notes, m.updated_at
        FROM public.competition_matches m
        WHERE m.competition_id = :cid
        ORDER BY m.scheduled_at NULLS LAST, m.code
    """), p).mappings().all()
    event_rows = conn.execute(text("""
        SELECT e.id, e.match_id, e.team_id, e.player_id, e.type, e.minute, e.source, e.created_at,
               e.created_by_staff_id
        FROM public.competition_match_events e
        WHERE e.competition_id = :cid
        ORDER BY e.created_at
    """), p).mappings().all()

    matches = []
    code_by_id = {}
    for r in match_rows:
        code_by_id[r["id"]] = r["code"]
        m = dict(r)
        m.update({
            "id": _s(r["id"]),
            "group": r["group_code"],
            "home_team_id": _s(r["home_team_id"]),
            "away_team_id": _s(r["away_team_id"]),
            "venue_id": _s(r["venue_id"]),
            "veedor_staff_id": _s(r["veedor_staff_id"]),
        })
        matches.append(m)

    events = [{
        "id": _s(e["id"]),
        "match_code": code_by_id.get(e["match_id"]),
        "team_id": _s(e["team_id"]),
        "player_id": _s(e["player_id"]),
        "type": e["type"],
        "minute": e["minute"],
        "source": e["source"],
        "created_by_staff_id": _s(e["created_by_staff_id"]),
        "created_at": e["created_at"],
    } for e in event_rows]

    slots: dict = {}
    for r in slot_rows:
        slots.setdefault(r["group_code"], {})[int(r["position"])] = _s(r["team_id"])
    draws: dict = {}
    for r in draw_rows:
        draws.setdefault(r["context"], {})[_s(r["team_id"])] = int(r["rank"])

    for t in teams:
        t["id"] = _s(t["id"])
        t["veedor_staff_id"] = _s(t["veedor_staff_id"])
    for pl in players:
        pl["id"] = _s(pl["id"])
        pl["team_id"] = _s(pl["team_id"])
    for v in venues:
        v["id"] = _s(v["id"])
    for s in staff:
        s["id"] = _s(s["id"])

    return {
        "teams": teams, "players": players, "slots": slots, "draws": draws,
        "venues": venues, "staff": staff, "matches": matches, "events": events,
    }


def compute_standings(comp: dict, state: dict) -> ce.Standings:
    fmt = get_format(comp)
    return ce.compute_standings(
        fmt["groups"], state["slots"], state["matches"], state["events"],
        effective_settings(comp), state["draws"],
    )


# ============================================================
# Escritura
# ============================================================

def bump_version(conn, comp_id) -> None:
    conn.execute(text("""
        UPDATE public.competitions
        SET data_version = data_version + 1, updated_at = now()
        WHERE id = :cid
    """), {"cid": comp_id})


def audit(conn, comp_id, action: str, *, actor_user_id=None, actor_staff_id=None,
          match_id=None, metadata: dict | None = None) -> None:
    conn.execute(text("""
        INSERT INTO public.competition_audit_log
          (competition_id, actor_user_id, actor_staff_id, action, match_id, metadata)
        VALUES (:cid, :uid, :sid, :action, :mid, CAST(:meta AS jsonb))
    """), {
        "cid": comp_id, "uid": actor_user_id, "sid": actor_staff_id, "action": action,
        "mid": match_id, "meta": json.dumps(metadata or {}, default=str),
    })


def sync_bracket(conn, comp: dict, *, actor_user_id=None, actor_staff_id=None) -> dict:
    """
    Recalcula y escribe los equipos de cada partido según sus fuentes (sorteo, tablas,
    ganadores/perdedores). Solo toca partidos SCHEDULED; los conflictos se devuelven.
    Idempotente. Llamar DENTRO de la transacción que tiene el lock de la competencia.
    """
    fmt = get_format(comp)
    state = load_state(conn, comp["id"])
    standings = compute_standings(comp, state)
    plan = ce.plan_updates(
        state["matches"], slots=state["slots"], standings=standings,
        group_stage_closed=comp["group_stage_closed_at"] is not None,
        swap_rules=fmt.get("swap_rules"),
    )
    for u in plan["updates"]:
        col = "home_team_id" if u["side"] == "home" else "away_team_id"
        conn.execute(text(f"""
            UPDATE public.competition_matches
            SET {col} = :team_id, updated_at = now()
            WHERE competition_id = :cid AND code = :code AND status = 'SCHEDULED'
        """), {"team_id": u["team_id"], "cid": comp["id"], "code": u["code"]})
    if plan["updates"]:
        audit(conn, comp["id"], "BRACKET_SYNC", actor_user_id=actor_user_id,
              actor_staff_id=actor_staff_id, metadata={"updates": plan["updates"]})
    return plan


def match_veedor_ids(match: dict, team_veedor: dict) -> list[str]:
    """
    Veedores habilitados en un partido, en orden: el del equipo local, el del visitante y el
    asignado puntualmente al partido (refuerzo/reserva). Sin repetidos.
    `team_veedor`: team_id → staff_id.
    """
    ids = [team_veedor.get(_s(match.get("home_team_id"))), team_veedor.get(_s(match.get("away_team_id"))),
           _s(match.get("veedor_staff_id"))]
    out = []
    for i in ids:
        if i and i not in out:
            out.append(i)
    return out


def staff_can_operate(conn, match: dict, staff_id: str) -> bool:
    if _s(match.get("veedor_staff_id")) == staff_id:
        return True
    team_ids = [t for t in (match.get("home_team_id"), match.get("away_team_id")) if t]
    if not team_ids:
        return False
    row = conn.execute(text("""
        SELECT 1 FROM public.competition_teams
        WHERE id = ANY(CAST(:ids AS uuid[])) AND veedor_staff_id = CAST(:sid AS uuid)
        LIMIT 1
    """), {"ids": [str(t) for t in team_ids], "sid": staff_id}).first()
    return bool(row)


def get_match(conn, comp_id, code: str, *, for_update: bool = False) -> dict:
    sql = """
        SELECT id, code, stage, status, home_team_id, away_team_id, home_goals, away_goals,
               home_pens, away_pens, veedor_staff_id, confirmed_at, started_at
        FROM public.competition_matches
        WHERE competition_id = :cid AND code = :code
    """
    if for_update:
        sql += " FOR UPDATE"
    row = conn.execute(text(sql), {"cid": comp_id, "code": code}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="MATCH_NOT_FOUND")
    return dict(row)


_TRANSITIONS = {
    "SCHEDULED": {"LIVE"},
    "LIVE": {"HALFTIME", "FINISHED"},
    "HALFTIME": {"LIVE", "FINISHED"},
}


def change_status(conn, comp: dict, match: dict, new_status: str, *, allow_reopen: bool,
                  actor_user_id=None, actor_staff_id=None) -> dict:
    """Transición de estado de un partido (veedor o mesa central). Propaga si termina."""
    cur = match["status"]
    reopening = cur in ce.FINISHED_STATUSES and new_status == "LIVE"
    if new_status == cur:
        return {"status": cur}
    if not (new_status in _TRANSITIONS.get(cur, set()) or (reopening and allow_reopen)):
        raise HTTPException(status_code=409, detail=f"INVALID_TRANSITION:{cur}->{new_status}")
    if new_status == "LIVE" and cur == "SCHEDULED":
        if not match["home_team_id"] or not match["away_team_id"]:
            raise HTTPException(status_code=409, detail="TEAMS_NOT_DEFINED")
    if new_status == "FINISHED":
        assert_can_finish(match)

    conn.execute(text("""
        UPDATE public.competition_matches
        SET status = CAST(:st AS text),
            home_goals = COALESCE(home_goals, 0),
            away_goals = COALESCE(away_goals, 0),
            started_at = CASE WHEN CAST(:st AS text) = 'LIVE' THEN COALESCE(started_at, now()) ELSE started_at END,
            ended_at = CASE WHEN CAST(:st AS text) = 'FINISHED' THEN now()
                            WHEN CAST(:st AS text) = 'LIVE' THEN NULL ELSE ended_at END,
            confirmed_at = CASE WHEN CAST(:st AS text) = 'LIVE' THEN NULL ELSE confirmed_at END,
            updated_at = now()
        WHERE id = :mid
    """), {"st": new_status, "mid": match["id"]})

    if new_status == "LIVE" and comp["status"] == "PUBLISHED":
        conn.execute(text("UPDATE public.competitions SET status = 'LIVE' WHERE id = :cid"), {"cid": comp["id"]})

    audit(conn, comp["id"], f"MATCH_{new_status}", actor_user_id=actor_user_id,
          actor_staff_id=actor_staff_id, match_id=match["id"], metadata={"from": cur})
    plan = sync_bracket(conn, comp, actor_user_id=actor_user_id, actor_staff_id=actor_staff_id)
    bump_version(conn, comp["id"])
    return {"status": new_status, "conflicts": plan["conflicts"]}


def assert_can_finish(match: dict) -> None:
    """En eliminación directa un empate necesita penales (reglamento 5.20)."""
    if match["stage"] == "GROUP":
        return
    hg, ag = int(match["home_goals"] or 0), int(match["away_goals"] or 0)
    if hg != ag:
        return
    hp, ap = match["home_pens"], match["away_pens"]
    if hp is None or ap is None or int(hp) == int(ap):
        raise HTTPException(status_code=409, detail="PENALTIES_REQUIRED")


def assert_editable(match: dict) -> None:
    if match["confirmed_at"] is not None:
        raise HTTPException(status_code=409, detail="MATCH_CONFIRMED")


def add_event(conn, comp: dict, match: dict, *, team_id: str, type_: str, player_id=None,
              shirt_number=None, minute=None, client_event_id=None, source: str,
              actor_user_id=None, actor_staff_id=None) -> dict:
    """Agrega gol/tarjeta. Un gol mueve el marcador (+1). Idempotente por client_event_id."""
    if type_ not in ce.EVENT_TYPES:
        raise HTTPException(status_code=400, detail="INVALID_EVENT_TYPE")
    if team_id not in (_s(match["home_team_id"]), _s(match["away_team_id"])):
        raise HTTPException(status_code=400, detail="TEAM_NOT_IN_MATCH")

    if client_event_id:
        existing = conn.execute(text("""
            SELECT id FROM public.competition_match_events
            WHERE match_id = :mid AND client_event_id = :ceid
        """), {"mid": match["id"], "ceid": client_event_id}).mappings().first()
        if existing:
            return {"event_id": _s(existing["id"]), "duplicate": True}

    if player_id is None and shirt_number is not None:
        row = conn.execute(text("""
            SELECT id FROM public.competition_players
            WHERE team_id = :tid AND shirt_number = :n
        """), {"tid": team_id, "n": shirt_number}).mappings().first()
        player_id = _s(row["id"]) if row else None
    elif player_id is not None:
        ok = conn.execute(text("""
            SELECT 1 FROM public.competition_players WHERE id = :pid AND team_id = :tid
        """), {"pid": player_id, "tid": team_id}).first()
        if not ok:
            raise HTTPException(status_code=400, detail="PLAYER_NOT_IN_TEAM")

    ev = conn.execute(text("""
        INSERT INTO public.competition_match_events
          (competition_id, match_id, team_id, player_id, type, minute, client_event_id,
           source, created_by_staff_id, created_by_user_id)
        VALUES (:cid, :mid, :tid, :pid, :type, :minute, :ceid, :source, :sid, :uid)
        RETURNING id
    """), {
        "cid": comp["id"], "mid": match["id"], "tid": team_id, "pid": player_id,
        "type": type_, "minute": minute, "ceid": client_event_id, "source": source,
        "sid": actor_staff_id, "uid": actor_user_id,
    }).mappings().first()

    _apply_goal_delta(conn, match, team_id, type_, +1)
    audit(conn, comp["id"], f"EVENT_ADD_{type_}", actor_user_id=actor_user_id,
          actor_staff_id=actor_staff_id, match_id=match["id"],
          metadata={"event_id": _s(ev["id"]), "team_id": team_id, "player_id": player_id})
    _after_result_change(conn, comp, match, actor_user_id=actor_user_id, actor_staff_id=actor_staff_id)
    return {"event_id": _s(ev["id"]), "duplicate": False}


def delete_event(conn, comp: dict, match: dict, event_id: str, *,
                 actor_user_id=None, actor_staff_id=None) -> None:
    """La mesa central borra cualquier evento; un veedor, solo los que cargó él."""
    if actor_staff_id:
        owner = conn.execute(text("""
            SELECT created_by_staff_id FROM public.competition_match_events
            WHERE id = :eid AND match_id = :mid
        """), {"eid": event_id, "mid": match["id"]}).mappings().first()
        if not owner:
            raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")
        if _s(owner["created_by_staff_id"]) != actor_staff_id:
            raise HTTPException(status_code=403, detail="EVENT_NOT_YOURS")
    ev = conn.execute(text("""
        DELETE FROM public.competition_match_events
        WHERE id = :eid AND match_id = :mid
        RETURNING team_id, type, player_id
    """), {"eid": event_id, "mid": match["id"]}).mappings().first()
    if not ev:
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")
    _apply_goal_delta(conn, match, _s(ev["team_id"]), ev["type"], -1)
    audit(conn, comp["id"], f"EVENT_DELETE_{ev['type']}", actor_user_id=actor_user_id,
          actor_staff_id=actor_staff_id, match_id=match["id"],
          metadata={"event_id": event_id, "team_id": _s(ev["team_id"])})
    _after_result_change(conn, comp, match, actor_user_id=actor_user_id, actor_staff_id=actor_staff_id)


def _apply_goal_delta(conn, match: dict, team_id: str, type_: str, delta: int) -> None:
    if type_ not in ("GOAL", "OWN_GOAL"):
        return
    home = _s(match["home_team_id"]) == team_id
    # OWN_GOAL: team_id es el equipo del jugador → suma para el rival.
    to_home = home if type_ == "GOAL" else not home
    col = "home_goals" if to_home else "away_goals"
    conn.execute(text(f"""
        UPDATE public.competition_matches
        SET {col} = GREATEST(COALESCE({col}, 0) + :d, 0), updated_at = now()
        WHERE id = :mid
    """), {"d": delta, "mid": match["id"]})


def _after_result_change(conn, comp: dict, match: dict, *, actor_user_id=None, actor_staff_id=None) -> None:
    """Si el partido ya estaba terminado, un cambio de resultado re-propaga las llaves."""
    if match["status"] in ce.FINISHED_STATUSES:
        sync_bracket(conn, comp, actor_user_id=actor_user_id, actor_staff_id=actor_staff_id)
    bump_version(conn, comp["id"])


def set_penalties(conn, comp: dict, match: dict, home_pens, away_pens, *,
                  actor_user_id=None, actor_staff_id=None) -> None:
    if match["stage"] == "GROUP":
        raise HTTPException(status_code=400, detail="NO_PENALTIES_IN_GROUP_STAGE")
    conn.execute(text("""
        UPDATE public.competition_matches
        SET home_pens = :hp, away_pens = :ap, updated_at = now()
        WHERE id = :mid
    """), {"hp": home_pens, "ap": away_pens, "mid": match["id"]})
    audit(conn, comp["id"], "MATCH_PENALTIES", actor_user_id=actor_user_id,
          actor_staff_id=actor_staff_id, match_id=match["id"],
          metadata={"home_pens": home_pens, "away_pens": away_pens})
    _after_result_change(conn, comp, match, actor_user_id=actor_user_id, actor_staff_id=actor_staff_id)


# ============================================================
# Snapshot público (una sola respuesta con todo lo que ve el sitio)
# ============================================================

def build_snapshot(conn, comp: dict, *, include_admin: bool = False) -> dict:
    fmt = get_format(comp)
    state = load_state(conn, comp["id"])
    settings = effective_settings(comp)
    standings = compute_standings(comp, state)
    closed = comp["group_stage_closed_at"] is not None

    team_pos = {}
    for g, positions in state["slots"].items():
        for pos, tid in positions.items():
            if tid:
                team_pos[tid] = (g, pos)
    players_by_team: dict = {}
    for pl in state["players"]:
        players_by_team.setdefault(pl["team_id"], []).append({
            "id": pl["id"], "full_name": pl["full_name"], "shirt_number": pl["shirt_number"],
            "is_captain": pl["is_captain"], "is_goalkeeper": pl["is_goalkeeper"],
        })
    venue_by_id = {v["id"]: v for v in state["venues"]}
    staff_by_id = {s["id"]: s for s in state["staff"]}
    team_veedor = {t["id"]: t["veedor_staff_id"] for t in state["teams"] if t["veedor_staff_id"]}
    events_by_match: dict = {}
    for e in state["events"]:
        item = {"id": e["id"], "type": e["type"], "team_id": e["team_id"],
                "player_id": e["player_id"], "minute": e["minute"]}
        if include_admin:
            item["source"] = e["source"]
            loader = staff_by_id.get(e["created_by_staff_id"])
            item["loaded_by"] = loader["full_name"] if loader else None
        events_by_match.setdefault(e["match_code"], []).append(item)

    resolved = ce.resolve_all(
        state["matches"], slots=state["slots"], standings=standings,
        group_stage_closed=closed, swap_rules=fmt.get("swap_rules"),
    )

    matches_out = []
    for m in state["matches"]:
        veedor_ids = match_veedor_ids(m, team_veedor)
        veedor_names = [staff_by_id[i]["full_name"] for i in veedor_ids if i in staff_by_id]
        venue = venue_by_id.get(m["venue_id"])
        item = {
            "code": m["code"], "stage": m["stage"], "cup": m["cup"], "group": m["group"],
            "venue": venue["number"] if venue else None,
            "scheduled_at": m["scheduled_at"].isoformat() if m["scheduled_at"] else None,
            "status": m["status"],
            "home": {"source": m["home_source"], "team_id": m["home_team_id"],
                     "pending_reason": resolved[(m["code"], "home")][1]},
            "away": {"source": m["away_source"], "team_id": m["away_team_id"],
                     "pending_reason": resolved[(m["code"], "away")][1]},
            "home_goals": m["home_goals"], "away_goals": m["away_goals"],
            "home_pens": m["home_pens"], "away_pens": m["away_pens"],
            "started_at": m["started_at"].isoformat() if m["started_at"] else None,
            "confirmed": m["confirmed_at"] is not None,
            "veedor_name": " · ".join(veedor_names) or None,
            "veedor_names": veedor_names,
            "referee_name": m["referee_name"],
            "winner_team_id": ce.match_winner(m),
            "events": events_by_match.get(m["code"], []),
        }
        if include_admin:
            item["veedor_staff_id"] = m["veedor_staff_id"]
            item["veedor_ids"] = veedor_ids
            item["notes"] = m["notes"]
            tally = ce.goal_tally(m, state["events"])
            item["goal_tally"] = list(tally)
            item["goal_detail_mismatch"] = bool(events_by_match.get(m["code"])) and \
                tally != (int(m["home_goals"] or 0), int(m["away_goals"] or 0))
        matches_out.append(item)

    teams_out = []
    for t in state["teams"]:
        g, pos = team_pos.get(t["id"], (None, None))
        team = {**t, "group": g, "position": pos, "players": players_by_team.get(t["id"], [])}
        if not include_admin:
            team.pop("veedor_staff_id", None)
        teams_out.append(team)

    stats_group_only = settings.get("stats_group_stage_only", True)
    snapshot = {
        "competition": {
            "slug": comp["slug"], "name": comp["name"], "status": comp["status"],
            "starts_on": comp["starts_on"].isoformat() if comp["starts_on"] else None,
            "ends_on": comp["ends_on"].isoformat() if comp["ends_on"] else None,
            "utc_offset": comp["utc_offset"],
            "match_minutes": fmt.get("match_minutes"),
            "group_stage_closed": closed,
            "draw_status": ((comp.get("settings") if isinstance(comp.get("settings"), dict)
                             else json.loads(comp.get("settings") or "{}")).get("live_draw") or {}).get("status", "IDLE"),
            "broadcast": broadcast_settings(comp),
            "data_version": int(comp["data_version"]),
            "fair_play_weights": settings["fair_play"],
        },
        "venues": [{"number": v["number"], "name": v["name"]} for v in state["venues"]],
        "groups": [
            {"code": g, "complete": t["complete"], "rows": t["rows"], "unresolved_ties": t["unresolved_ties"]}
            for g, t in standings.tables.items()
        ],
        "thirds": standings.thirds,
        "teams": teams_out,
        "matches": matches_out,
        "stats": {
            "scorers": ce.top_scorers(state["matches"], state["events"], stats_group_only),
            "least_conceded": ce.least_conceded(standings),
            "fair_play": ce.fair_play_table(standings),
            "suspensions": ce.suspensions(state["matches"], state["events"]),
        },
    }
    if include_admin:
        snapshot["fourths"] = standings.fourths
        snapshot["slots"] = {g: {str(k): v for k, v in pos.items()} for g, pos in state["slots"].items()}
        snapshot["draws"] = state["draws"]
        snapshot["staff"] = [
            {"id": s["id"], "full_name": s["full_name"], "role": s["role"],
             "contact": decrypt_contact(s["contact_encrypted"]) if s["contact_encrypted"] else None,
             "has_active_link": s["has_active_link"], "revoked": s["revoked_at"] is not None,
             "team_ids": [t["id"] for t in state["teams"] if t["veedor_staff_id"] == s["id"]]}
            for s in state["staff"]
        ]
        snapshot["close_check"] = ce.group_stage_close_check(
            state["matches"], slots=state["slots"], standings=standings,
            swap_rules=fmt.get("swap_rules"),
        ) if not closed else None
        snapshot["conflicts"] = ce.plan_updates(
            state["matches"], slots=state["slots"], standings=standings,
            group_stage_closed=closed, swap_rules=fmt.get("swap_rules"),
        )["conflicts"]
    return snapshot


# ============================================================
# Caché del snapshot público (proceso único: uvicorn sin --workers)
# ============================================================

_CACHE_TTL = 3.0  # durante este lapso ni siquiera se consulta data_version
_cache_lock = threading.Lock()
_cache: dict[str, dict] = {}


def cached_public_snapshot(conn, slug: str) -> dict:
    """
    {"body", "gzip", "etag"}. Reconstruye solo si cambió `data_version`. El cuerpo se
    guarda ya comprimido: servir 1 000 espectadores no recomprime 100 KB por request.
    """
    now = time.time()
    with _cache_lock:
        hit = _cache.get(slug)
        if hit and now - hit["ts"] < _CACHE_TTL:
            return hit

    row = conn.execute(text("""
        SELECT data_version, status FROM public.competitions WHERE slug = :slug
    """), {"slug": slug}).mappings().first()
    if not row or row["status"] not in PUBLIC_STATUSES:
        raise HTTPException(status_code=404, detail="COMPETITION_NOT_FOUND")

    version = int(row["data_version"])
    with _cache_lock:
        hit = _cache.get(slug)
        if hit and hit["version"] == version:
            hit["ts"] = now
            return hit

    comp = get_competition(conn, slug)
    body = json.dumps(build_snapshot(conn, comp), default=str, separators=(",", ":")).encode("utf-8")
    etag = f'W/"{slug}-{version}-{hashlib.sha256(body).hexdigest()[:12]}"'
    entry = {"version": version, "ts": now, "body": body, "gzip": gzip.compress(body, 6), "etag": etag}
    with _cache_lock:
        _cache[slug] = entry
    return entry


def invalidate_cache(slug: str | None = None) -> None:
    with _cache_lock:
        if slug is None:
            _cache.clear()
        else:
            _cache.pop(slug, None)
