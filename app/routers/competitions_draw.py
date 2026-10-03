"""
Sorteo de zonas EN VIVO: pantalla de transmisión (pública) + panel de producción (link privado).

- `GET  /public/competitions/{slug}/draw`                → estado para la pantalla /sorteo (público).
- `GET  /public/competitions/{slug}/draw/control`        → mismo estado + config (producción).
- `POST /public/competitions/{slug}/draw/control/{acción}` con header `X-Draw-Token`:
    config · preset (procedimiento oficial) · start · preview · pick · undo · finish · reset ·
    broadcast (link de YouTube + hora de inicio, se puede cambiar en cualquier momento)

El estado vive en `competitions.settings.live_draw` (sin migración): status, modo, bombos/tandas,
reglas, la lista de equipos que fueron saliendo (`picks`, con la bolilla y el salto si hubo, para
la animación y el deshacer) y el hash del token de producción. La transmisión, en
`competitions.settings.broadcast`. El RESULTADO real se escribe en `competition_group_slots`, así el
fixture y las zonas del sitio se completan solos a medida que salen los equipos.
"""
import datetime as dt
import json
import re
import threading
import time
from typing import Any

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
    mode: str | None = Field(None, pattern="^(ROUND_ROBIN|BY_GROUP|TANDAS)$")
    pots: dict[str, int] | None = None     # {team_id: n° de bombo / tanda}; {} = sin bombos
    rules: dict[str, Any] | None = None    # {"separate_country": bool} | {"max_foreign", "home_country", "pairs"}
    tandas: dict[str, dict] | None = None  # {"1": {"label": "Brasil", "ball": "GROUP"|"SLOT"}}


class DrawPickRequest(BaseModel):
    team_id: str | None = None            # None = sorteo digital (al azar)
    group: str | None = Field(None, max_length=2)   # bolilla de zona (o zona del casillero)
    position: int | None = Field(None, ge=1, le=8)  # posición del casillero
    force: bool = False                   # ubicación manual: zona + posición exactas, sin reglas


class BroadcastRequest(BaseModel):
    youtube_url: str | None = Field(None, max_length=300)  # "" = sacar el video
    starts_at: str | None = Field(None, max_length=40)     # ISO con zona: 2026-10-06T22:15:00-03:00
    spoiler_delay_s: int | None = Field(None, ge=0, le=120)


_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_URL = re.compile(
    r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|live/|embed/|shorts/|v/))([A-Za-z0-9_-]{11})")


def parse_youtube_id(value: str) -> str | None:
    """ID del video a partir de cualquier link de YouTube (watch, youtu.be, live, embed) o del ID solo."""
    value = (value or "").strip()
    if _YT_ID.match(value):
        return value
    m = _YT_URL.search(value)
    return m.group(1) if m else None


# ============================================================
# Estado
# ============================================================

def _settings(comp: dict) -> dict:
    s = comp.get("settings") or {}
    return json.loads(s) if isinstance(s, str) else dict(s)


def _draw(comp: dict) -> dict:
    return dict(_settings(comp).get("live_draw") or {})


def _save_key(conn, comp_id, key: str, value: dict) -> None:
    conn.execute(text("""
        UPDATE public.competitions
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), CAST(:path AS text[]), CAST(:d AS jsonb)),
            updated_at = now()
        WHERE id = :cid
    """), {"path": [key], "d": json.dumps(value), "cid": comp_id})


def _save_draw(conn, comp_id, draw: dict) -> None:
    _save_key(conn, comp_id, "live_draw", draw)


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
    mode = draw.get("mode", "ROUND_ROBIN")
    pots = draw.get("pots") or None
    rules = draw.get("rules") or {}
    picks = draw.get("picks", [])
    home = rules.get("home_country")
    state = {
        "competition": {"slug": comp["slug"], "name": comp["name"]},
        "status": draw.get("status", "IDLE"),
        "mode": mode,
        "rules": rules,
        "groups": fmt["groups"],
        "group_size": fmt["group_size"],
        "slots": {g: {str(p): t for p, t in pos.items()} for g, pos in slots.items()},
        "teams": [{**t, "pot": (pots or {}).get(t["id"]), "foreign": draw_logic.is_foreign(t, home)} for t in teams],
        "picks": picks,
        "placed": len(draw_logic.placed_ids(slots)),
        "broadcast": svc.broadcast_settings(comp),
        "has_official_procedure": bool(fmt.get("draw_procedure")),
        "version": int(comp["data_version"]),
    }
    if mode == "TANDAS":
        cfg = draw.get("tandas") or {}
        cur = draw_logic.current_tanda(teams, slots, pots)
        kind = draw_logic.ball_kind(cfg, cur)
        numbers = sorted({int(n) for n in cfg} | {int(v) for v in (pots or {}).values()})
        state.update({
            "next_slot": None,
            "eligible_team_ids": [t["id"] for t in draw_logic.tanda_teams(teams, slots, pots)],
            "current_tanda": ({"n": cur, "label": (cfg.get(str(cur)) or {}).get("label") or f"Tanda {cur}",
                               "ball": kind} if cur is not None else None),
            "balls_left": draw_logic.balls_left(fmt["groups"], slots, picks, cur, kind),
            "balls_drawn": draw_logic.balls_drawn(picks, cur),
            "tandas": [{"n": n, "label": (cfg.get(str(n)) or {}).get("label") or f"Tanda {n}",
                        "ball": draw_logic.ball_kind(cfg, n),
                        "team_ids": [t["id"] for t in teams if (pots or {}).get(t["id"]) == n]} for n in numbers],
        })
    else:
        order = draw_logic.slot_order(fmt["groups"], fmt["group_size"], mode)
        nxt = draw_logic.next_slot(order, slots)
        state.update({
            "next_slot": {"group": nxt[0], "position": nxt[1]} if nxt else None,
            "eligible_team_ids": [t["id"] for t in draw_logic.eligible_teams(teams, slots, order, pots)],
        })
    return state


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


def _clean_rules(rules: dict) -> dict:
    out: dict = {}
    if "separate_country" in rules:
        out["separate_country"] = bool(rules["separate_country"])
    if rules.get("max_foreign") is not None:
        out["max_foreign"] = max(0, int(rules["max_foreign"]))
    if rules.get("home_country"):
        out["home_country"] = str(rules["home_country"]).upper()[:2]
    if rules.get("pairs"):
        out["pairs"] = [[str(a), str(b)] for a, b in rules["pairs"]]
    return out


def _commit_slots(conn, comp: dict, action: str, metadata: dict) -> None:
    comp = svc.get_competition(conn, comp["slug"])
    svc.sync_bracket(conn, comp)
    svc.audit(conn, comp["id"], action, metadata=metadata)
    svc.bump_version(conn, comp["id"])


def _compute_pick(draw: dict, fmt: dict, teams: list[dict], slots: dict, req: DrawPickRequest) -> dict:
    """Qué pasaría con este pick (equipo, lugar, bolilla, salto). No escribe nada."""
    by_id = {t["id"]: t for t in teams}
    mode = draw.get("mode", "ROUND_ROBIN")
    pots = draw.get("pots") or None
    picks = draw.get("picks", [])
    digital = req.team_id is None
    team = None
    if not digital:
        team = by_id.get(req.team_id)
        if not team:
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
        if team["id"] in draw_logic.placed_ids(slots):
            raise HTTPException(status_code=409, detail="TEAM_ALREADY_DRAWN")
    if req.force and not (req.group and req.position):
        raise HTTPException(status_code=400, detail="INVALID_SLOT")
    if (req.group and req.group not in slots) or (req.group and req.position and req.position not in slots[req.group]):
        raise HTTPException(status_code=400, detail="INVALID_SLOT")

    if mode == "TANDAS":
        rules = draw.get("rules") or {}
        cfg = draw.get("tandas") or {}
        cur = draw_logic.current_tanda(teams, slots, pots)
        if cur is None:
            raise HTTPException(status_code=409, detail="POT_EMPTY")
        kind = draw_logic.ball_kind(cfg, cur)
        if digital:
            got = draw_logic.digital_tanda_pick(teams, slots, fmt["groups"], picks, pots, cfg)
            if not got:
                raise HTTPException(status_code=409, detail="POT_EMPTY")
            team, ball = got
        else:
            if draw_logic.tanda_of(team["id"], pots) != cur and not req.force:
                raise HTTPException(status_code=409, detail="TEAM_NOT_IN_TANDA")
            ball = None
            if not req.force:
                if kind == "SLOT":
                    if not (req.group and req.position):
                        raise HTTPException(status_code=400, detail="BALL_REQUIRED")
                    ball = draw_logic.slot_ball(req.group, req.position)
                else:
                    if not req.group:
                        raise HTTPException(status_code=400, detail="BALL_REQUIRED")
                    ball = req.group
        foreign_ids = {t["id"] for t in teams if draw_logic.is_foreign(t, rules.get("home_country"))}
        res = draw_logic.place_tandas(
            team, slots, fmt["groups"], ball=ball or "", kind=kind, foreign_ids=foreign_ids,
            max_foreign=rules.get("max_foreign"), pairs=rules.get("pairs"),
            force_slot=(req.group, req.position) if req.force else None)
        if res["error"]:
            raise HTTPException(status_code=409, detail=res["error"])
        warnings = list(res["warnings"])
        if ball and kind == "GROUP" and ball in draw_logic.balls_drawn(picks, cur):
            warnings.append("BALL_ALREADY_DRAWN")
        return {"team": team, "slot": res["slot"], "digital": digital, "warnings": warnings,
                "tanda": draw_logic.tanda_of(team["id"], pots), "ball": ball, "jump": res["jump"]}

    order = draw_logic.slot_order(fmt["groups"], fmt["group_size"], mode)
    if digital:
        team = draw_logic.digital_pick(teams, slots, order, pots)
        if not team:
            raise HTTPException(status_code=409, detail="POT_EMPTY")
    requested = None
    if req.group or req.position:
        if not (req.group and req.position):
            raise HTTPException(status_code=400, detail="INVALID_SLOT")
        requested = (req.group, req.position)
    slot, warnings = draw_logic.place(
        team, slots, order, pots=pots, rules=draw.get("rules"),
        country={t["id"]: t["country_code"] for t in teams}, requested=requested)
    if not slot:
        raise HTTPException(status_code=409, detail=warnings[0] if warnings else "NO_FREE_SLOT")
    return {"team": team, "slot": slot, "digital": digital, "warnings": warnings,
            "tanda": None, "ball": None, "jump": None}


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
                draw["rules"] = _clean_rules(cfg.rules)
            if cfg.tandas is not None:
                draw["tandas"] = {str(int(n)): {"label": str(v.get("label") or f"Tanda {n}")[:60],
                                                "ball": "SLOT" if v.get("ball") == "SLOT" else "GROUP"}
                                  for n, v in cfg.tandas.items()}
            _save_draw(conn, comp["id"], draw)
            svc.bump_version(conn, comp["id"])

        elif action == "preset":
            # Procedimiento oficial del reglamento: tandas, cupo de extranjeros y parejas.
            if draw.get("picks"):
                raise HTTPException(status_code=409, detail="DRAW_ALREADY_HAS_PICKS")
            fmt, teams, _ = _load(conn, comp)
            if not fmt.get("draw_procedure"):
                raise HTTPException(status_code=404, detail="NO_OFFICIAL_PROCEDURE")
            preset = draw_logic.build_tandas_preset(teams, fmt["draw_procedure"])
            draw.update(mode="TANDAS", pots=preset["pots"], tandas=preset["tandas"], rules=preset["rules"])
            _save_draw(conn, comp["id"], draw)
            svc.audit(conn, comp["id"], "DRAW_PRESET", metadata={"problems": preset["problems"]})
            svc.bump_version(conn, comp["id"])
            result = {"problems": preset["problems"]}

        elif action == "broadcast":
            req = BroadcastRequest(**(body or {}))
            current = svc.broadcast_settings(comp)
            out = {"starts_at": current["starts_at"], "youtube_id": current["youtube_id"],
                   "spoiler_delay_s": current["spoiler_delay_s"]}
            if req.youtube_url is not None:
                if req.youtube_url.strip():
                    yid = parse_youtube_id(req.youtube_url)
                    if not yid:
                        raise HTTPException(status_code=400, detail="INVALID_YOUTUBE_URL")
                    out["youtube_id"] = yid
                else:
                    out["youtube_id"] = None
            if req.starts_at is not None:
                try:
                    when = dt.datetime.fromisoformat(req.starts_at.strip())
                except ValueError:
                    raise HTTPException(status_code=400, detail="INVALID_START")
                if when.tzinfo is None:
                    raise HTTPException(status_code=400, detail="INVALID_START")
                out["starts_at"] = when.isoformat()
            if req.spoiler_delay_s is not None:
                out["spoiler_delay_s"] = req.spoiler_delay_s
            _save_key(conn, comp["id"], "broadcast", out)
            svc.audit(conn, comp["id"], "DRAW_BROADCAST", metadata=out)
            svc.bump_version(conn, comp["id"])
            svc.invalidate_cache(slug)

        elif action == "preview":
            fmt, teams, slots = _load(conn, comp)
            req = DrawPickRequest(**(body or {}))
            if req.team_id is None:
                raise HTTPException(status_code=400, detail="TEAM_REQUIRED")
            got = _compute_pick(draw, fmt, teams, slots, req)
            result = {"preview": {"team_id": got["team"]["id"], "group": got["slot"][0], "position": got["slot"][1],
                                  "ball": got["ball"], "jump": got["jump"], "warnings": got["warnings"]}}

        elif action == "start":
            _assert_no_group_match_started(conn, comp["id"])
            if draw.get("mode") == "TANDAS" and not draw.get("pots"):
                raise HTTPException(status_code=409, detail="TANDAS_NOT_CONFIGURED")
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
            got = _compute_pick(draw, fmt, teams, slots, req)
            team, slot = got["team"], got["slot"]
            conn.execute(text("""
                UPDATE public.competition_group_slots SET team_id = :tid
                WHERE competition_id = :cid AND group_code = :g AND position = :p
            """), {"tid": team["id"], "cid": comp["id"], "g": slot[0], "p": slot[1]})
            pick = {"seq": len(draw.get("picks", [])) + 1, "team_id": team["id"], "group": slot[0],
                    "position": slot[1], "digital": got["digital"], "warnings": got["warnings"],
                    "at": dt.datetime.now(dt.timezone.utc).isoformat()}
            if draw.get("mode") == "TANDAS":
                pick.update(tanda=got["tanda"], ball=got["ball"], jump=got["jump"])
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
