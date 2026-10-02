"""
Sorteo de zonas EN VIVO: pantalla de transmisión (pública) + panel de producción (link privado).

- `GET  /public/competitions/{slug}/draw`                → estado para la pantalla /sorteo (público).
- `GET  /public/competitions/{slug}/draw/control`        → mismo estado + config (producción).
- `POST /public/competitions/{slug}/draw/control/{acción}` con header `X-Draw-Token`:
    config · start · pick · undo · finish · reset

El estado vive en `competitions.settings.live_draw` (sin migración): status, modo, bombos,
reglas, la lista de equipos que fueron saliendo (`picks`, para la animación y el deshacer) y el
hash del token de producción. El RESULTADO real se escribe en `competition_group_slots`, así el
fixture y las zonas del sitio se completan solos a medida que salen los equipos.
"""
import datetime as dt
import json
import threading
import time

from fastapi import APIRouter, Body, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.settings import engine
from app.utils import competition_draw as draw_logic
from app.utils import competition_service as svc
from app.utils.ratelimit import client_ip, rate_limit
from app.utils.security import hash_management_token

router = APIRouter()


class DrawConfigRequest(BaseModel):
    mode: str | None = Field(None, pattern="^(ROUND_ROBIN|BY_GROUP)$")
    pots: dict[str, int] | None = None   # {team_id: número de bombo}; {} = sin bombos
    rules: dict[str, bool] | None = None  # {"separate_country": true}


class DrawPickRequest(BaseModel):
    team_id: str | None = None            # None = sorteo digital (al azar)
    group: str | None = Field(None, max_length=2)
    position: int | None = Field(None, ge=1, le=8)


# ============================================================
# Estado
# ============================================================

def _settings(comp: dict) -> dict:
    s = comp.get("settings") or {}
    return json.loads(s) if isinstance(s, str) else dict(s)


def _draw(comp: dict) -> dict:
    return dict(_settings(comp).get("live_draw") or {})


def _save_draw(conn, comp_id, draw: dict) -> None:
    conn.execute(text("""
        UPDATE public.competitions
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{live_draw}', CAST(:d AS jsonb)),
            updated_at = now()
        WHERE id = :cid
    """), {"d": json.dumps(draw), "cid": comp_id})


def _load(conn, comp: dict):
    teams = [dict(r) for r in conn.execute(text("""
        SELECT id, name, short_name, country_code, logo_url, color
        FROM public.competition_teams WHERE competition_id = :cid ORDER BY lower(name)
    """), {"cid": comp["id"]}).mappings().all()]
    for t in teams:
        t["id"] = str(t["id"])
    fmt = svc.get_format(comp)
    slots = {g: {p: None for p in range(1, fmt["group_size"] + 1)} for g in fmt["groups"]}
    for r in conn.execute(text("""
        SELECT group_code, position, team_id FROM public.competition_group_slots WHERE competition_id = :cid
    """), {"cid": comp["id"]}).mappings().all():
        slots.setdefault(r["group_code"], {})[int(r["position"])] = str(r["team_id"]) if r["team_id"] else None
    return fmt, teams, slots


def _state(conn, comp: dict) -> dict:
    fmt, teams, slots = _load(conn, comp)
    draw = _draw(comp)
    pots = draw.get("pots") or None
    order = draw_logic.slot_order(fmt["groups"], fmt["group_size"], draw.get("mode", "ROUND_ROBIN"))
    nxt = draw_logic.next_slot(order, slots)
    return {
        "competition": {"slug": comp["slug"], "name": comp["name"]},
        "status": draw.get("status", "IDLE"),
        "mode": draw.get("mode", "ROUND_ROBIN"),
        "rules": draw.get("rules", {}),
        "groups": fmt["groups"],
        "group_size": fmt["group_size"],
        "slots": {g: {str(p): t for p, t in pos.items()} for g, pos in slots.items()},
        "teams": [{**t, "pot": (pots or {}).get(t["id"])} for t in teams],
        "picks": draw.get("picks", []),
        "next_slot": {"group": nxt[0], "position": nxt[1]} if nxt else None,
        "eligible_team_ids": [t["id"] for t in draw_logic.eligible_teams(teams, slots, order, pots)],
        "placed": len(draw_logic.placed_ids(slots)),
        "version": int(comp["data_version"]),
    }


# Micro-caché del estado público (la pantalla y los espectadores consultan cada 1–2 s).
_cache_lock = threading.Lock()
_cache: dict = {}


@router.get("/public/competitions/{slug}/draw")
def public_draw(slug: str, request: Request, if_none_match: str | None = Header(None, alias="If-None-Match")):
    rate_limit(f"draw-public:{client_ip(request)}", max_hits=3000, window_seconds=60)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(slug)
    if not hit or now - hit["ts"] > 1.0:
        with engine.connect() as conn:
            comp = svc.get_competition(conn, slug)
            if comp["status"] not in svc.PUBLIC_STATUSES:
                raise HTTPException(status_code=404, detail="COMPETITION_NOT_FOUND")
            if hit and hit["version"] == comp["data_version"]:
                hit["ts"] = now
            else:
                body = json.dumps(_state(conn, comp), default=str, separators=(",", ":")).encode()
                hit = {"ts": now, "version": comp["data_version"], "body": body,
                       "etag": f'W/"draw-{slug}-{comp["data_version"]}"'}
            with _cache_lock:
                _cache[slug] = hit
    headers = {"ETag": hit["etag"], "Cache-Control": "no-cache"}
    if if_none_match == hit["etag"]:
        return Response(status_code=304, headers=headers)
    return Response(content=hit["body"], media_type="application/json", headers=headers)


# ============================================================
# Producción
# ============================================================

def _require_producer(request: Request, comp: dict, token: str | None) -> None:
    expected = _draw(comp).get("producer_token_hash")
    if not token or not expected or hash_management_token(token) != expected:
        rate_limit(f"draw-fail:{client_ip(request)}", max_hits=30, window_seconds=60)
        raise HTTPException(status_code=401, detail="INVALID_DRAW_TOKEN")


def _assert_no_group_match_started(conn, comp_id) -> None:
    started = conn.execute(text("""
        SELECT 1 FROM public.competition_matches
        WHERE competition_id = :cid AND stage = 'GROUP' AND status <> 'SCHEDULED' LIMIT 1
    """), {"cid": comp_id}).first()
    if started:
        raise HTTPException(status_code=409, detail="GROUP_STAGE_ALREADY_STARTED")


def _commit_slots(conn, comp: dict, action: str, metadata: dict) -> None:
    comp = svc.get_competition(conn, comp["slug"])
    svc.sync_bracket(conn, comp)
    svc.audit(conn, comp["id"], action, metadata=metadata)
    svc.bump_version(conn, comp["id"])


@router.get("/public/competitions/{slug}/draw/control")
def control_state(slug: str, request: Request, x_draw_token: str | None = Header(None, alias="X-Draw-Token")):
    with engine.connect() as conn:
        comp = svc.get_competition(conn, slug)
        _require_producer(request, comp, x_draw_token)
        state = _state(conn, comp)
    state["competition"]["status"] = comp["status"]
    return state


@router.post("/public/competitions/{slug}/draw/control/{action}")
def control_action(slug: str, action: str, request: Request,
                   x_draw_token: str | None = Header(None, alias="X-Draw-Token"),
                   body: dict | None = Body(None)):
    rate_limit(f"draw-ctl:{client_ip(request)}", max_hits=240, window_seconds=60)
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        _require_producer(request, comp, x_draw_token)
        draw = _draw(comp)
        status = draw.get("status", "IDLE")
        result: dict = {}

        if action == "config":
            cfg = DrawConfigRequest(**(body or {}))
            if draw.get("picks"):
                raise HTTPException(status_code=409, detail="DRAW_ALREADY_HAS_PICKS")
            if cfg.mode:
                draw["mode"] = cfg.mode
            if cfg.pots is not None:
                draw["pots"] = {k: int(v) for k, v in cfg.pots.items() if v}
            if cfg.rules is not None:
                draw["rules"] = {k: bool(v) for k, v in cfg.rules.items()}
            _save_draw(conn, comp["id"], draw)
            svc.bump_version(conn, comp["id"])

        elif action == "start":
            _assert_no_group_match_started(conn, comp["id"])
            draw["status"] = "LIVE"
            draw.setdefault("picks", [])
            draw["started_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            _save_draw(conn, comp["id"], draw)
            svc.audit(conn, comp["id"], "DRAW_START")
            svc.bump_version(conn, comp["id"])

        elif action == "pick":
            if status != "LIVE":
                raise HTTPException(status_code=409, detail="DRAW_NOT_LIVE")
            req = DrawPickRequest(**(body or {}))
            fmt, teams, slots = _load(conn, comp)
            order = draw_logic.slot_order(fmt["groups"], fmt["group_size"], draw.get("mode", "ROUND_ROBIN"))
            pots = draw.get("pots") or None
            by_id = {t["id"]: t for t in teams}
            digital = req.team_id is None
            if digital:
                team = draw_logic.digital_pick(teams, slots, order, pots)
                if not team:
                    raise HTTPException(status_code=409, detail="POT_EMPTY")
            else:
                team = by_id.get(req.team_id)
                if not team:
                    raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
                if team["id"] in draw_logic.placed_ids(slots):
                    raise HTTPException(status_code=409, detail="TEAM_ALREADY_DRAWN")
            requested = None
            if req.group or req.position:
                if not (req.group and req.position) or req.group not in slots or req.position not in slots[req.group]:
                    raise HTTPException(status_code=400, detail="INVALID_SLOT")
                requested = (req.group, req.position)
            slot, warnings = draw_logic.place(
                team, slots, order, pots=pots, rules=draw.get("rules"),
                country={t["id"]: t["country_code"] for t in teams}, requested=requested)
            if not slot:
                raise HTTPException(status_code=409, detail=warnings[0] if warnings else "NO_FREE_SLOT")
            conn.execute(text("""
                UPDATE public.competition_group_slots SET team_id = :tid
                WHERE competition_id = :cid AND group_code = :g AND position = :p
            """), {"tid": team["id"], "cid": comp["id"], "g": slot[0], "p": slot[1]})
            pick = {"seq": len(draw.get("picks", [])) + 1, "team_id": team["id"], "group": slot[0],
                    "position": slot[1], "digital": digital, "warnings": warnings,
                    "at": dt.datetime.now(dt.timezone.utc).isoformat()}
            draw.setdefault("picks", []).append(pick)
            _save_draw(conn, comp["id"], draw)
            _commit_slots(conn, comp, "DRAW_PICK", pick)
            result = {"pick": pick}

        elif action == "undo":
            picks = draw.get("picks", [])
            if not picks:
                raise HTTPException(status_code=409, detail="NOTHING_TO_UNDO")
            last = picks.pop()
            conn.execute(text("""
                UPDATE public.competition_group_slots SET team_id = NULL
                WHERE competition_id = :cid AND group_code = :g AND position = :p AND team_id = :tid
            """), {"cid": comp["id"], "g": last["group"], "p": last["position"], "tid": last["team_id"]})
            _save_draw(conn, comp["id"], draw)
            _commit_slots(conn, comp, "DRAW_UNDO", last)
            result = {"undone": last}

        elif action == "finish":
            _, teams, slots = _load(conn, comp)
            if any(t is None for pos in slots.values() for t in pos.values()):
                raise HTTPException(status_code=409, detail="DRAW_INCOMPLETE")
            draw["status"] = "DONE"
            draw["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            _save_draw(conn, comp["id"], draw)
            svc.audit(conn, comp["id"], "DRAW_FINISH")
            svc.bump_version(conn, comp["id"])

        elif action == "reset":
            _assert_no_group_match_started(conn, comp["id"])
            conn.execute(text("UPDATE public.competition_group_slots SET team_id = NULL WHERE competition_id = :cid"),
                         {"cid": comp["id"]})
            draw.update(status="IDLE", picks=[])
            draw.pop("started_at", None)
            draw.pop("finished_at", None)
            _save_draw(conn, comp["id"], draw)
            _commit_slots(conn, comp, "DRAW_RESET", {})

        else:
            raise HTTPException(status_code=404, detail="UNKNOWN_ACTION")

        comp = svc.get_competition(conn, slug)
        state = _state(conn, comp)
    with _cache_lock:
        _cache.pop(slug, None)
    return {**result, "state": state}
