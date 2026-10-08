"""
MESA DE CONTROL: link privado `live.copaproud.com/control/<token>` para la organización, sin login.
Hace lo mismo que la mesa central (/admin/competitions/…): ver todo, corregir resultados y eventos,
W.O., confirmar, penales, sorteos de desempate y cerrar / reabrir la fase de grupos.

Header `X-Control-Token`. En la base solo queda el hash (competitions.settings.control.token_hash),
que genera scripts/control_link.py (cada link nuevo anula el anterior). Cada acción reusa la función
del router admin con `actor_user_id=None`, así las reglas son exactamente las mismas; en la
auditoría queda sin usuario (= mesa de control).
"""
import json

from fastapi import APIRouter, Header, HTTPException, Query, Request

from app.routers import competitions_admin as adm
from app.schemas import (
    CompetitionDrawRequest,
    CompetitionEventPlayerRequest,
    CompetitionEventRequest,
    CompetitionMatchPatchRequest,
    CompetitionMatchStatusRequest,
    CompetitionPenaltiesRequest,
    CompetitionWalkoverRequest,
)
from app.settings import engine
from app.utils import competition_service as svc
from app.utils.ratelimit import client_ip, rate_limit
from app.utils.security import hash_management_token

router = APIRouter()
R = "/public/competitions/{slug}/control"


def _auth(request: Request, slug: str, token: str | None) -> None:
    with engine.connect() as conn:
        comp = svc.get_competition(conn, slug)
    settings = comp.get("settings") or {}
    if isinstance(settings, str):
        settings = json.loads(settings)
    expected = (settings.get("control") or {}).get("token_hash")
    if not token or not expected or hash_management_token(token) != expected:
        rate_limit(f"control-fail:{client_ip(request)}", max_hits=30, window_seconds=60)
        raise HTTPException(status_code=401, detail="INVALID_CONTROL_TOKEN")
    rate_limit(f"control:{slug}", max_hits=600, window_seconds=60)


Tok = Header(None, alias="X-Control-Token")


@router.get(R)
def control_state(slug: str, request: Request, x_control_token: str | None = Tok):
    """Todo el torneo (snapshot con los datos internos: ids de eventos, quién cargó, veedores)."""
    _auth(request, slug, x_control_token)
    return adm.get_competition_admin(slug, actor_user_id=None)


@router.get(R + "/audit")
def control_audit(slug: str, request: Request, limit: int = Query(150, ge=1, le=500), x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.get_audit(slug, limit=limit, actor_user_id=None)


@router.get(R + "/group-stage/preview")
def control_group_preview(slug: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.group_stage_preview(slug, actor_user_id=None)


@router.post(R + "/group-stage/close")
def control_group_close(slug: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.close_group_stage(slug, actor_user_id=None)


@router.post(R + "/group-stage/reopen")
def control_group_reopen(slug: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.reopen_group_stage(slug, actor_user_id=None)


@router.put(R + "/draws")
def control_draws(slug: str, body: CompetitionDrawRequest, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.set_draw(slug, body, actor_user_id=None)


@router.post(R + "/matches/{code}/result")
def control_result(slug: str, code: str, body: CompetitionMatchPatchRequest, request: Request,
                   x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.set_final_result(slug, code, body, actor_user_id=None)


@router.patch(R + "/matches/{code}")
def control_patch_match(slug: str, code: str, body: CompetitionMatchPatchRequest, request: Request,
                        x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.patch_match(slug, code, body, actor_user_id=None)


@router.post(R + "/matches/{code}/status")
def control_status(slug: str, code: str, body: CompetitionMatchStatusRequest, request: Request,
                   x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.admin_match_status(slug, code, body, actor_user_id=None)


@router.post(R + "/matches/{code}/walkover")
def control_walkover(slug: str, code: str, body: CompetitionWalkoverRequest, request: Request,
                     x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.walkover(slug, code, body, actor_user_id=None)


@router.post(R + "/matches/{code}/confirm")
def control_confirm(slug: str, code: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.confirm_match(slug, code, actor_user_id=None)


@router.post(R + "/matches/{code}/unconfirm")
def control_unconfirm(slug: str, code: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.unconfirm_match(slug, code, actor_user_id=None)


@router.post(R + "/matches/{code}/events")
def control_add_event(slug: str, code: str, body: CompetitionEventRequest, request: Request,
                      x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.admin_add_event(slug, code, body, actor_user_id=None)


@router.delete(R + "/matches/{code}/events/{event_id}")
def control_delete_event(slug: str, code: str, event_id: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.admin_delete_event(slug, code, event_id, actor_user_id=None)


@router.patch(R + "/matches/{code}/events/{event_id}")
def control_event_player(slug: str, code: str, event_id: str, body: CompetitionEventPlayerRequest, request: Request,
                         x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.admin_event_player(slug, code, event_id, body, actor_user_id=None)


@router.put(R + "/matches/{code}/penalties")
def control_penalties(slug: str, code: str, body: CompetitionPenaltiesRequest, request: Request,
                      x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.admin_penalties(slug, code, body, actor_user_id=None)
