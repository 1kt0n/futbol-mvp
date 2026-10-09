"""
MESA DE CONTROL: link privado `live.copaproud.com/control/<token>` para la organización, sin login.
Hace lo mismo que la mesa central (/admin/competitions/…): ver todo, corregir resultados y eventos,
W.O., confirmar, penales, sorteos de desempate y cerrar / reabrir la fase de grupos. También la
carpeta de fotos de "Reviví tu partido" y a qué partido va cada álbum, los veedores (alta, link,
baja) y los planteles (número de camiseta en la acreditación, nombre, agregar / quitar).

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
    CompetitionGalleryLinkRequest,
    CompetitionGalleryRequest,
    CompetitionMatchPatchRequest,
    CompetitionMatchStatusRequest,
    CompetitionPenaltiesRequest,
    CompetitionPlayerRequest,
    CompetitionPlayerUpdateRequest,
    CompetitionStaffRequest,
    CompetitionWalkoverRequest,
)
from app.settings import engine
from app.utils import competition_gallery as gal
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


# ------------------------------------------------------------------ fotos ("Reviví tu partido")

def _gallery_cfg(comp: dict) -> dict:
    settings = comp.get("settings") or {}
    if isinstance(settings, str):
        settings = json.loads(settings)
    return gal.gallery_settings(settings)


@router.get(R + "/gallery")
def control_gallery(slug: str, request: Request, refresh: bool = Query(False), x_control_token: str | None = Tok):
    """Carpeta, álbumes (también ocultos y vacíos) y su vínculo. ?refresh=1 vuelve a leer Drive ya."""
    _auth(request, slug, x_control_token)
    with engine.connect() as conn:
        comp = svc.get_competition(conn, slug)
        return gal.control_payload(conn, comp, force=refresh)


@router.put(R + "/gallery")
def control_gallery_config(slug: str, body: CompetitionGalleryRequest, request: Request,
                           x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    folder = None
    if body.folder_url is not None and body.folder_url.strip():
        fid = gal.parse_folder_id(body.folder_url)
        if not fid:
            raise HTTPException(status_code=400, detail="INVALID_FOLDER_URL")
        folder = {"id": fid, "name": None}
        if gal.api_key():
            # Antes de abrir la transacción: Drive puede tardar unos segundos.
            try:
                folder = gal.folder_meta(fid)
            except gal.DriveError as e:
                raise HTTPException(status_code=400, detail=e.code)
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        cfg = _gallery_cfg(comp)
        if body.folder_url is not None:
            cfg["folder_id"] = folder["id"] if folder else None
            cfg["folder_name"] = folder["name"] if folder else None
        if body.credit is not None:
            cfg["credit"] = body.credit.strip() or None
        svc.save_setting(conn, comp["id"], "gallery", cfg)
        svc.audit(conn, comp["id"], "GALLERY_CONFIG",
                  metadata={"folder_id": cfg["folder_id"], "credit": cfg["credit"]})
        svc.bump_version(conn, comp["id"])
    svc.invalidate_cache(slug)
    with engine.connect() as conn:
        return gal.control_payload(conn, svc.get_competition(conn, slug), force=bool(folder))


@router.put(R + "/gallery/albums/{album_id}")
def control_gallery_link(slug: str, album_id: str, body: CompetitionGalleryLinkRequest, request: Request,
                         x_control_token: str | None = Tok):
    """Vincula un álbum a mano (partido / equipo / general / oculto); link=None vuelve al automático."""
    _auth(request, slug, x_control_token)
    if not gal.ALBUM_ID_RE.match(album_id):
        raise HTTPException(status_code=404, detail="ALBUM_NOT_FOUND")
    link = (body.link or "").strip() or None
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, slug)
        ctx = gal.link_context(svc.load_state(conn, comp["id"]), comp["utc_offset"])
        if not gal.valid_link(link, ctx):
            raise HTTPException(status_code=400, detail="INVALID_LINK")
        cfg = _gallery_cfg(comp)
        if link:
            cfg["links"][album_id] = link
        else:
            cfg["links"].pop(album_id, None)
        svc.save_setting(conn, comp["id"], "gallery", cfg)
        svc.audit(conn, comp["id"], "GALLERY_LINK", metadata={"album_id": album_id, "link": link})
        svc.bump_version(conn, comp["id"])
    svc.invalidate_cache(slug)
    with engine.connect() as conn:
        return gal.control_payload(conn, svc.get_competition(conn, slug))


# ------------------------------------------------------------------ veedores (con nombre, rotativos)

@router.post(R + "/staff")
def control_create_staff(slug: str, body: CompetitionStaffRequest, request: Request,
                         x_control_token: str | None = Tok):
    """Alta de un veedor con su nombre. El link (token) se devuelve UNA sola vez."""
    _auth(request, slug, x_control_token)
    return adm.create_staff(slug, body, actor_user_id=None)


@router.post(R + "/staff/{staff_id}/rotate-token")
def control_rotate_staff(slug: str, staff_id: str, request: Request, x_control_token: str | None = Tok):
    """Link nuevo (el anterior deja de andar al instante). También reactiva a uno dado de baja."""
    _auth(request, slug, x_control_token)
    return adm.rotate_staff_token(slug, staff_id, actor_user_id=None)


@router.post(R + "/staff/{staff_id}/revoke")
def control_revoke_staff(slug: str, staff_id: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.revoke_staff(slug, staff_id, actor_user_id=None)


# ------------------------------------------------------------------ planteles (lista de buena fe)

@router.post(R + "/teams/{team_id}/players")
def control_create_player(slug: str, team_id: str, body: CompetitionPlayerRequest, request: Request,
                          x_control_token: str | None = Tok):
    """Jugador que aparece en la acreditación y no estaba en la lista."""
    _auth(request, slug, x_control_token)
    return adm.create_player(slug, team_id, body, actor_user_id=None)


@router.patch(R + "/players/{player_id}")
def control_update_player(slug: str, player_id: str, body: CompetitionPlayerUpdateRequest, request: Request,
                          x_control_token: str | None = Tok):
    """Número de camiseta (acreditación) o nombre. shirt_number=null lo borra."""
    _auth(request, slug, x_control_token)
    return adm.update_player(slug, player_id, body, actor_user_id=None)


@router.delete(R + "/players/{player_id}")
def control_delete_player(slug: str, player_id: str, request: Request, x_control_token: str | None = Tok):
    _auth(request, slug, x_control_token)
    return adm.delete_player(slug, player_id, actor_user_id=None)
