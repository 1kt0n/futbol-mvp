"""
"REVIVÍ TU PARTIDO" (público, sin login): las fotos del fotógrafo oficial, leídas de Google Drive.

- `GET /public/competitions/{slug}/gallery`: álbumes visibles (uno por carpeta de Drive) con su
  vínculo al partido o equipo, portada y cantidad de fotos. Sin API key de Drive: modo "embed".
- `GET /public/competitions/{slug}/gallery/{album_id}`: las fotos de un álbum (ids de Drive: el
  sitio arma miniaturas y el link de descarga HD). Solo álbumes de la carpeta configurada.

Drive se lee en caché (app/utils/competition_gallery.py): miles de visitas = pocas llamadas a Google.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.settings import engine
from app.utils import competition_gallery as gal
from app.utils import competition_service as svc
from app.utils.ratelimit import client_ip, rate_limit

router = APIRouter()
_CACHE = {"Cache-Control": "public, max-age=30"}


def _public_comp(conn, slug: str) -> dict:
    comp = svc.get_competition(conn, slug)
    if comp["status"] not in svc.PUBLIC_STATUSES:
        raise HTTPException(status_code=404, detail="COMPETITION_NOT_FOUND")
    return comp


@router.get("/public/competitions/{slug}/gallery")
def public_gallery(slug: str, request: Request):
    # Por IP con margen: en el predio cientos de teléfonos salen por el mismo WiFi.
    rate_limit(f"comp-gallery:{client_ip(request)}", max_hits=3000, window_seconds=60)
    with engine.connect() as conn:
        comp = _public_comp(conn, slug)
        return JSONResponse(gal.public_payload(conn, comp), headers=_CACHE)


@router.get("/public/competitions/{slug}/gallery/{album_id}")
def public_gallery_album(slug: str, album_id: str, request: Request):
    rate_limit(f"comp-gallery:{client_ip(request)}", max_hits=3000, window_seconds=60)
    if not gal.ALBUM_ID_RE.match(album_id):
        raise HTTPException(status_code=404, detail="ALBUM_NOT_FOUND")
    with engine.connect() as conn:
        comp = _public_comp(conn, slug)
        out = gal.public_album(conn, comp, album_id)
    if not out:
        raise HTTPException(status_code=404, detail="ALBUM_NOT_FOUND")
    return JSONResponse(out, headers=_CACHE)
