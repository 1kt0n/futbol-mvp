"""
"REVIVÍ TU PARTIDO": las fotos del fotógrafo oficial, directo desde Google Drive.

El fotógrafo sube a UNA carpeta de Drive compartida como "Cualquier persona con el enlace · Lector".
Cada subcarpeta (y cada sub-subcarpeta, p. ej. "Sábado / Cancha 9 11:00") es un ÁLBUM. Nada se copia:
el sitio muestra las miniaturas de Google y el botón "Descargar HD" baja el archivo original.

- Drive se lee con la API oficial (v3) y una API key (`GOOGLE_DRIVE_API_KEY`, variable del servicio en
  Railway). Sin key, el sitio muestra la carpeta embebida de Drive (modo "embed").
- Caché en proceso (uvicorn con un solo worker): Drive se vuelve a leer como mucho cada
  `DRIVE_TTL` segundos y EN SEGUNDO PLANO; mientras tanto se sirve lo último leído. Miles de
  espectadores = unas pocas llamadas a Google por minuto.
- Cada álbum se vincula a un partido (o a un equipo) solo, por el NOMBRE de la carpeta: código del
  partido, cancha + hora, o los nombres de los dos equipos. La mesa de control puede pisarlo a mano
  (`settings.gallery.links[folder_id]`: "M:<código>" · "T:<team_id>" · "G" general · "X" oculto).

Configuración en `competitions.settings.gallery` (sin migración):
  {"folder_id", "folder_name", "credit", "links": {...}}
"""
import datetime as dt
import json
import logging
import os
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

logger = logging.getLogger("uvicorn.error")

DRIVE_API = os.getenv("GOOGLE_DRIVE_API_BASE", "https://www.googleapis.com/drive/v3").rstrip("/")
FOLDER_MIME = "application/vnd.google-apps.folder"
DRIVE_TTL = 60.0          # cada cuánto se vuelve a mirar Drive (s)
MAX_DEPTH = 2             # raíz / carpeta / subcarpeta
MAX_FOLDERS = 300
PHOTO_MIMES = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif")
LINK_RE = re.compile(r"^(M:[A-Za-z0-9-]{2,24}|T:[0-9a-fA-F-]{36}|G|X)$")
ALBUM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,80}$")


class DriveError(Exception):
    """code: DRIVE_NOT_CONFIGURED · DRIVE_FOLDER_NOT_FOUND · DRIVE_FORBIDDEN · DRIVE_UNAVAILABLE."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def api_key() -> str | None:
    return (os.getenv("GOOGLE_DRIVE_API_KEY") or "").strip() or None


_FOLDER_URL = re.compile(r"(?:/folders/|[?&]id=)([A-Za-z0-9_-]{10,})")
_FOLDER_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")


def parse_folder_id(value: str) -> str | None:
    """ID de la carpeta a partir del link de Drive (…/drive/folders/<id>?usp=…, …?id=<id>) o del ID solo."""
    value = (value or "").strip()
    if _FOLDER_ID.match(value):
        return value
    m = _FOLDER_URL.search(value)
    return m.group(1) if m else None


# ============================================================
# Drive (API v3 con API key: solo carpetas públicas)
# ============================================================

def _get(path: str, params: dict) -> dict:
    key = api_key()
    if not key:
        raise DriveError("DRIVE_NOT_CONFIGURED")
    url = f"{DRIVE_API}/{path}?{urlencode({**params, 'key': key})}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        # Nunca loguear la URL: lleva la API key.
        reason = ""
        try:
            reason = (json.loads(e.read()).get("error") or {}).get("errors", [{}])[0].get("reason", "")
        except Exception:
            pass
        logger.warning("Drive %s → HTTP %s %s", path.split("/")[0], e.code, reason)
        if e.code == 404:
            raise DriveError("DRIVE_FOLDER_NOT_FOUND")
        if e.code in (400, 401, 403):
            raise DriveError("DRIVE_FORBIDDEN")
        raise DriveError("DRIVE_UNAVAILABLE")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        logger.warning("Drive %s → %s", path.split("/")[0], type(e).__name__)
        raise DriveError("DRIVE_UNAVAILABLE")


def folder_meta(folder_id: str) -> dict:
    """{"id","name"} de una carpeta pública. DriveError si no existe, no es pública o no es carpeta."""
    data = _get(f"files/{folder_id}", {"fields": "id,name,mimeType", "supportsAllDrives": "true"})
    if data.get("mimeType") != FOLDER_MIME:
        raise DriveError("DRIVE_FOLDER_NOT_FOUND")
    return {"id": data["id"], "name": data.get("name") or ""}


def _children(folder_id: str) -> list[dict]:
    out, token = [], None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,createdTime,"
                      "imageMediaMetadata(width,height,rotation,time))",
            "pageSize": 1000, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
        }
        if token:
            params["pageToken"] = token
        data = _get("files", params)
        out += data.get("files") or []
        token = data.get("nextPageToken")
        if not token or len(out) >= 20000:
            return out


def _exif_time(value: str | None) -> str | None:
    """'2026:10:10 11:23:45' (EXIF, hora de la cámara) → '2026-10-10T11:23:45'."""
    m = re.match(r"^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", value or "")
    return f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}" if m else None


def _photo(f: dict) -> dict:
    meta = f.get("imageMediaMetadata") or {}
    w, h = meta.get("width"), meta.get("height")
    if w and h and (meta.get("rotation") or 0) % 2:
        w, h = h, w
    return {"id": f["id"], "w": w, "h": h, "t": _exif_time(meta.get("time")), "c": f.get("createdTime")}


def _sort_photos(photos: list[dict]) -> list[dict]:
    # Orden en que se sacaron (EXIF); si no hay EXIF, en que se subieron.
    return sorted(photos, key=lambda p: (p["t"] or p["c"] or "", p["id"]))


def fetch_tree(root_id: str) -> dict:
    """
    Lee la carpeta raíz hasta MAX_DEPTH niveles. Devuelve
    {"root": {"id","name"}, "albums": [{"id","name","path","created_at","photos":[…]}], "fetched_at"}.
    Las fotos sueltas en la raíz forman un álbum más (el de la raíz).
    """
    root = folder_meta(root_id)
    albums: list[dict] = []
    level = [(root["id"], root["name"], None, None)]  # (id, nombre, carpeta padre, creada)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for depth in range(MAX_DEPTH + 1):
            listings = list(pool.map(lambda f: _children(f[0]), level))
            nxt = []
            for (fid, name, parent, created), files in zip(level, listings):
                photos = [_photo(f) for f in files if f.get("mimeType") in PHOTO_MIMES]
                albums.append({
                    "id": fid, "name": name, "path": f"{parent} / {name}" if parent else name,
                    "parent": parent, "created_at": created, "is_root": depth == 0,
                    "photos": _sort_photos(photos),
                })
                if depth < MAX_DEPTH:
                    for f in files:
                        if f.get("mimeType") == FOLDER_MIME and len(albums) + len(nxt) < MAX_FOLDERS:
                            nxt.append((f["id"], f.get("name") or "", name if depth else None, f.get("createdTime")))
            level = nxt
            if not level:
                break
    return {"root": root, "albums": albums, "fetched_at": time.time()}


# Caché de Drive: root_id → {"tree", "checked"}. Se refresca en segundo plano (stale-while-revalidate).
_drive_lock = threading.Lock()
_drive: dict[str, dict] = {}
_refreshing: set[str] = set()
_fetch_locks: dict[str, threading.Lock] = {}
RETRY_AFTER_ERROR = 30.0


def _store(root_id: str, tree: dict) -> dict:
    with _drive_lock:
        _drive[root_id] = {"tree": tree, "checked": time.time()}
    return tree


def drive_tree(root_id: str, *, force: bool = False) -> dict:
    """
    Árbol de la carpeta. Si lo cacheado está viejo, lo devuelve igual y lo refresca en segundo plano
    (un solo hilo por carpeta). Sin nada en caché (o con force) lee Drive en el momento: un solo
    request lee y los demás esperan ese resultado. DriveError si esa lectura falla.
    """
    now = time.time()
    with _drive_lock:
        hit = _drive.get(root_id)
        if hit and not force:
            if now - hit["checked"] > DRIVE_TTL and root_id not in _refreshing:
                _refreshing.add(root_id)
                threading.Thread(target=_bg_refresh, args=(root_id,), daemon=True).start()
            return hit["tree"]
        lock = _fetch_locks.setdefault(root_id, threading.Lock())
    with lock:
        if not force:
            with _drive_lock:
                hit = _drive.get(root_id)
            if hit:
                return hit["tree"]  # lo leyó otro request mientras esperábamos
        return _store(root_id, fetch_tree(root_id))


def _bg_refresh(root_id: str) -> None:
    try:
        _store(root_id, fetch_tree(root_id))
    except Exception as e:  # noqa: BLE001 — en segundo plano: se sigue mostrando lo anterior
        logger.warning("Galería: no se pudo refrescar Drive (%s)", getattr(e, "code", type(e).__name__))
        with _drive_lock:
            hit = _drive.get(root_id)
            if hit:  # reintentar en RETRY_AFTER_ERROR s, no en cada request
                hit["checked"] = time.time() - DRIVE_TTL + RETRY_AFTER_ERROR
    finally:
        with _drive_lock:
            _refreshing.discard(root_id)


def forget(root_id: str | None = None) -> None:
    with _drive_lock:
        if root_id is None:
            _drive.clear()
        else:
            _drive.pop(root_id, None)


# ============================================================
# Vinculación álbum → partido / equipo (pura, sin red: tests/test_competition_gallery.py)
# ============================================================

def _fold(s: str) -> str:
    """Sin acentos y en minúscula; conserva la puntuación (hace falta para horas, fechas y códigos)."""
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _norm(s: str) -> str:
    """_fold + solo letras y números separados por un espacio (para comparar nombres)."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", _fold(s)).split())


_CODE_RE = re.compile(r"\b([a-g]-\d+v\d+|(?:oro|plata|bronce)-(?:[ocs]\d+|f))\b")
_COURT_RE = re.compile(r"\b(?:cancha|canc|quadra|court|c)[\s#.-]*(\d{1,2})\b")
_TIME_RE = re.compile(r"\b(\d{1,2})\s*(:|hs|h|\.)\s*(\d{2})\b|\b(\d{1,2})\s*(?:hs|h)\b")
_DATE_RE = re.compile(r"\b(\d{1,2})\s*[/-]\s*(\d{1,2})\b")
_WEEKDAYS = {"sab": 6, "sabado": 6, "sat": 6, "saturday": 6, "dom": 0, "domingo": 0, "sun": 0, "sunday": 0}
_TEAM_NOISE = re.compile(r"\b(fc|f c|futbol club|football club|club)\b")


def link_context(state: dict, utc_offset: str | None) -> dict:
    """Lo mínimo para vincular, a partir de svc.load_state()."""
    tz = _tz(utc_offset)
    venues = {v["id"]: v["number"] for v in state["venues"]}
    matches = []
    for m in state["matches"]:
        local = m["scheduled_at"].astimezone(tz) if m["scheduled_at"] else None
        matches.append({
            "code": m["code"], "venue": venues.get(m["venue_id"]), "status": m["status"],
            "date": local.date().isoformat() if local else None,
            "weekday": (local.isoweekday() % 7) if local else None,  # 0 = domingo … 6 = sábado
            "minute": local.hour * 60 + local.minute if local else None,
            "teams": {m["home_team_id"], m["away_team_id"]} - {None},
            "start": m["scheduled_at"].isoformat() if m["scheduled_at"] else "",
        })
    teams = []
    for t in state["teams"]:
        keys = {_norm(t["name"]), _norm(_TEAM_NOISE.sub(" ", _norm(t["name"])))}
        if t.get("short_name") and len(t["short_name"]) >= 3:
            keys.add(_norm(t["short_name"]))
        teams.append({"id": t["id"], "keys": sorted(k for k in keys if len(k) >= 2)})
    return {"tz": tz, "matches": matches, "teams": teams, "team_ids": {t["id"] for t in state["teams"]},
            "codes": {m["code"] for m in matches}, "code_by_upper": {m["code"].upper(): m["code"] for m in matches}}


def _tz(utc_offset: str | None) -> dt.timezone:
    m = re.fullmatch(r"([+-])(\d{2}):(\d{2})", utc_offset or "")
    if not m:
        return dt.timezone.utc
    delta = dt.timedelta(hours=int(m[2]), minutes=int(m[3]))
    return dt.timezone(-delta if m[1] == "-" else delta)


def _teams_in(name: str, teams: list[dict]) -> list[str]:
    """Equipos nombrados en el texto (ya normalizado). Gana el nombre más largo: "Dogos Seniors" no
    cuenta además como "Dogos", ni "Rayos.cba II" como "Rayos.cba"."""
    hits = []  # (inicio, fin, team_id)
    padded = f" {name} "
    for t in teams:
        for k in t["keys"]:
            for m in re.finditer(rf"(?<= ){re.escape(k)}(?= )", padded):
                hits.append((m.start(), m.end(), t["id"]))
    out, covered = [], []
    for s, e, tid in sorted(hits, key=lambda h: (-(h[1] - h[0]), h[0])):
        if any(s >= cs and e <= ce for cs, ce in covered):
            continue
        covered.append((s, e))
        if tid not in out:
            out.append(tid)
    return out


def _days_in(text_: str, ctx: dict) -> set[str]:
    """Días del torneo nombrados: "Sábado", "dom", "10/10", "11-10"."""
    dates = {m["date"] for m in ctx["matches"] if m["date"]}
    found = set()
    for word in _norm(text_).split():
        wd = _WEEKDAYS.get(word)
        if wd is not None:
            found |= {m["date"] for m in ctx["matches"] if m["weekday"] == wd and m["date"]}
    for d, mo in _DATE_RE.findall(_fold(text_)):
        found |= {x for x in dates if int(x[8:10]) == int(d) and int(x[5:7]) == int(mo)}
    return found


def _times(text_: str, ctx: dict) -> list[int]:
    """Horas nombradas, en minutos desde las 00:00 ("11:00", "11h", "11hs", "11.30"). Las que usan ":"
    o "h" van primero; un "10.10" que coincide con un día del torneo es fecha, no hora."""
    dates = {(int(x[8:10]), int(x[5:7])) for x in (m["date"] for m in ctx["matches"]) if x}
    strong, weak = [], []
    for m in _TIME_RE.finditer(_fold(text_)):
        if m.group(1):
            hh, sep, mm = int(m.group(1)), m.group(2), int(m.group(3))
        else:
            hh, sep, mm = int(m.group(4)), "h", 0
        if not (7 <= hh <= 23 and mm < 60) or (sep == "." and (hh, mm) in dates):
            continue
        (weak if sep == "." else strong).append(hh * 60 + mm)
    return strong + weak


def auto_link(name: str, ctx: dict, *, parent: str | None = None, created_at: str | None = None) -> str | None:
    """
    "M:<código>" · "T:<team_id>" · None, según el NOMBRE de la carpeta (y el de la carpeta padre, que
    suele ser el día). Orden: código del partido → cancha + hora → los dos equipos → un equipo.
    El día sale del nombre ("Sábado", "10/10") o, si no lo dice, de cuándo se creó la carpeta.
    """
    folded = _fold(name)
    code = _CODE_RE.search(folded)
    if code and code.group(1).upper() in ctx["code_by_upper"]:
        return "M:" + ctx["code_by_upper"][code.group(1).upper()]

    days = _days_in(f"{parent or ''} {name}", ctx)
    if not days and created_at:
        try:
            created = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(ctx["tz"]).date().isoformat()
            if any(m["date"] == created for m in ctx["matches"]):
                days = {created}
        except ValueError:
            pass

    court = _COURT_RE.search(folded)
    times = _times(folded[:court.start()] + " " + folded[court.end():], ctx) if court else []
    if court and times:
        minute = times[0]
        cands = [m for m in ctx["matches"]
                 if m["venue"] == int(court.group(1)) and m["minute"] is not None
                 and abs(m["minute"] - minute) <= 25 and (not days or m["date"] in days)]
        if len({m["date"] for m in cands}) == 1:
            return "M:" + min(cands, key=lambda m: abs(m["minute"] - minute))["code"]

    teams = _teams_in(_norm(name), ctx["teams"])
    if len(teams) >= 2:
        pair = set(teams[:2])
        cands = [m for m in ctx["matches"] if pair <= m["teams"] and (not days or m["date"] in days)]
        if cands:
            # Si se cruzaron dos veces: el que ya se jugó más recientemente.
            played = [m for m in cands if m["status"] != "SCHEDULED"] or cands
            return "M:" + max(played, key=lambda m: m["start"])["code"]
    if len(teams) == 1:
        return f"T:{teams[0]}"
    return None


def valid_link(link: str | None, ctx: dict) -> bool:
    if link is None:
        return True
    if not LINK_RE.match(link):
        return False
    if link.startswith("M:"):
        return link[2:] in ctx["codes"]
    if link.startswith("T:"):
        return link[2:] in ctx["team_ids"]
    return True


def link_payload(link: str | None) -> dict | None:
    if not link or link in ("G", "X"):
        return None
    if link.startswith("M:"):
        return {"type": "match", "code": link[2:]}
    return {"type": "team", "team_id": link[2:]}


def resolve_albums(tree: dict, ctx: dict, links: dict) -> list[dict]:
    """Álbumes con su vínculo final (manual > automático). Incluye los ocultos y los vacíos
    (la mesa los ve); al público van solo los visibles con fotos."""
    out = []
    for a in tree["albums"]:
        auto = None if a["is_root"] else auto_link(a["name"], ctx, parent=a["parent"], created_at=a["created_at"])
        manual = links.get(a["id"])
        if manual and not valid_link(manual, ctx):
            manual = None
        final = manual or auto
        out.append({
            "id": a["id"], "name": a["name"], "path": a["path"], "is_root": a["is_root"],
            "auto": auto, "manual": manual, "hidden": final == "X",
            "link": link_payload(final), "photos": a["photos"],
        })
    return out


def album_summary(a: dict) -> dict:
    photos = a["photos"]
    # Portada: la primera foto horizontal (las verticales recortan mal en la tarjeta).
    cover = next((p for p in photos if p["w"] and p["h"] and p["w"] >= p["h"]), photos[0] if photos else None)
    return {
        "id": a["id"], "name": a["name"], "path": a["path"], "is_root": a["is_root"], "link": a["link"],
        "count": len(photos), "cover": {"id": cover["id"], "w": cover["w"], "h": cover["h"]} if cover else None,
        "last_photo_at": max((p["c"] or "" for p in photos), default=None) or None,
    }


def public_photo(p: dict) -> dict:
    return {"id": p["id"], "w": p["w"], "h": p["h"], "t": p["t"]}


def gallery_settings(comp_settings: dict) -> dict:
    g = dict(comp_settings.get("gallery") or {})
    return {
        "folder_id": g.get("folder_id"),
        "folder_name": g.get("folder_name"),
        "credit": g.get("credit"),
        "links": dict(g.get("links") or {}),
    }


# ============================================================
# Galería resuelta (Drive + vínculos) por competencia
# ============================================================

_resolved_lock = threading.Lock()
_resolved: dict[str, dict] = {}


def folder_url(folder_id: str | None) -> str | None:
    return f"https://drive.google.com/drive/folders/{folder_id}" if folder_id else None


def _iso(ts: float | None) -> str | None:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat() if ts else None


def resolved(conn, comp: dict, *, force: bool = False) -> dict | None:
    """
    {"cfg", "tree", "albums", "by_id"} de la competencia, o None si no tiene carpeta.
    Se recalcula solo si cambió el árbol de Drive o la competencia (data_version: vínculos manuales,
    equipos sorteados, horarios). DriveError si Drive no responde y no hay nada en caché.
    """
    from app.utils import competition_service as svc  # import tardío: el servicio no depende de este módulo

    cfg = gallery_settings(svc.effective_settings(comp))
    if not cfg["folder_id"]:
        return None
    tree = drive_tree(cfg["folder_id"], force=force)
    key = (cfg["folder_id"], int(comp["data_version"]), tree["fetched_at"])
    with _resolved_lock:
        hit = _resolved.get(comp["slug"])
        if hit and hit["key"] == key:
            return hit
    ctx = link_context(svc.load_state(conn, comp["id"]), comp["utc_offset"])
    albums = resolve_albums(tree, ctx, cfg["links"])
    entry = {"key": key, "cfg": cfg, "tree": tree, "albums": albums, "by_id": {a["id"]: a for a in albums}}
    with _resolved_lock:
        _resolved[comp["slug"]] = entry
    return entry


def public_payload(conn, comp: dict) -> dict:
    """Lo que ve el sitio. Sin API key (o si Drive no responde y no hay caché): modo "embed",
    la carpeta de Drive embebida tal cual."""
    from app.utils import competition_service as svc

    cfg = gallery_settings(svc.effective_settings(comp))
    base = {"enabled": bool(cfg["folder_id"]), "credit": cfg["credit"], "folder_url": folder_url(cfg["folder_id"]),
            "mode": "gallery", "albums": [], "updated_at": None}
    if not cfg["folder_id"]:
        return base
    if not api_key():
        return {**base, "mode": "embed", "folder_id": cfg["folder_id"]}
    try:
        entry = resolved(conn, comp)
    except DriveError as e:
        return {**base, "mode": "embed", "folder_id": cfg["folder_id"], "error": e.code}
    base["albums"] = [album_summary(a) for a in entry["albums"] if a["photos"] and not a["hidden"]]
    base["updated_at"] = _iso(entry["tree"]["fetched_at"])
    return base


def public_album(conn, comp: dict, album_id: str) -> dict | None:
    if not api_key():
        return None
    try:
        entry = resolved(conn, comp)
    except DriveError:
        return None
    a = entry["by_id"].get(album_id) if entry else None
    if not a or a["hidden"] or not a["photos"]:
        return None
    return {"album": album_summary(a), "photos": [public_photo(p) for p in a["photos"]],
            "folder_url": folder_url(a["id"]), "credit": entry["cfg"]["credit"]}


def control_payload(conn, comp: dict, *, force: bool = False) -> dict:
    """Todo para la mesa de control: también los álbumes ocultos y vacíos, y por qué se vinculó cada uno."""
    from app.utils import competition_service as svc

    cfg = gallery_settings(svc.effective_settings(comp))
    out = {"api_key": bool(api_key()), "folder_id": cfg["folder_id"], "folder_name": cfg["folder_name"],
           "folder_url": folder_url(cfg["folder_id"]), "credit": cfg["credit"], "error": None,
           "fetched_at": None, "albums": []}
    if not cfg["folder_id"] or not api_key():
        return out
    try:
        entry = resolved(conn, comp, force=force)
    except DriveError as e:
        out["error"] = e.code
        return out
    out["folder_name"] = entry["tree"]["root"]["name"] or cfg["folder_name"]
    out["fetched_at"] = _iso(entry["tree"]["fetched_at"])
    out["albums"] = [{**album_summary(a), "auto": a["auto"], "manual": a["manual"], "hidden": a["hidden"]}
                     for a in entry["albums"]]
    return out
