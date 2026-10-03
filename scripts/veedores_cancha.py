"""
Veedores POR CANCHA (decisión 2026-10-02): lo habitual es un veedor por cancha, el mismo los dos
días o uno distinto por día. Cada veedor tiene un link privado (`/v/<token>`) que abre el modo
veedor con los partidos de su cancha (antes del sorteo se ven igual, con "Zona A · Eq. 1", etc.).

En la base solo queda el hash del token: los links se ven UNA sola vez (al crearlos o renovarlos).
Quedan en un CSV local (ignorado por git) con un mensaje listo para WhatsApp + una hoja de QR.

Uso (pide la URL de la base sin mostrarla, igual que el seed). Con --demo opera sobre la
competencia de ensayo (live.copaproud.com/demo); sin --demo, sobre el torneo real:

  ./.venv/bin/python scripts/veedores_cancha.py crear [--demo] [--archivo veedores.csv] [--reemplazar] [--si]
      → crea los veedores y les asigna todos los partidos de su cancha/día.
        Sin --archivo: uno por cancha ("Veedor Cancha N", los dos días), para renombrar después.
        CSV: columnas cancha,dia,nombre (+ telefono opcional, solo va al CSV de salida); dia = sab |
        dom | ambos (vacío = ambos). Si un nombre se repite (p. ej. cancha 3 el sábado y cancha 5
        el domingo) es UNA persona con UN link.
        Si ya hay veedores activos, aborta. Con --reemplazar los revoca (sus links dejan de andar)
        y borra todas las asignaciones de veedor (por equipo y por cancha) antes de crear.
  ./.venv/bin/python scripts/veedores_cancha.py links [--demo] [--cancha N] [--dia sab|dom] [--si]
      → links NUEVOS para los veedores activos (todos o los de esa cancha/día). Los links
        anteriores dejan de funcionar al instante: hay que mandarles el nuevo.
  ./.venv/bin/python scripts/veedores_cancha.py renombrar [--demo] --cancha N [--dia sab|dom] "Nombre Apellido"
      → cambia el nombre del veedor de esa cancha SIN cambiarle el link.
  ./.venv/bin/python scripts/veedores_cancha.py listar [--demo]
      → veedores, canchas/días y fechas (sin tokens) + partidos que quedaron sin veedor.
  ./.venv/bin/python scripts/veedores_cancha.py qr [--demo]
      → rearma la hoja de QR desde el CSV (no toca la base ni los links). Necesita el paquete qrcode.

`crear` y `links` muestran un resumen y piden escribir APLICAR (con --si no preguntan).
Salida en la raíz del repo (o en $VEEDORES_OUT_DIR): veedores-links.csv + veedores-qr.png (demo:
demo-veedores.csv + demo-veedores-qr.png). La hoja de QR solo se genera si están `qrcode` y Pillow.
"""
import argparse
import csv
import datetime as dt
import os
import re
import sys
import unicodedata

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPTS)
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, ROOT)

from sqlalchemy import text  # noqa: E402

from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402
from app.utils.security import gen_management_token, hash_management_token  # noqa: E402

SITE = os.environ.get("DEMO_SITE_URL", "https://live.copaproud.com")
OUT_DIR = os.environ.get("VEEDORES_OUT_DIR", ROOT)  # dónde quedan el CSV y la hoja de QR (default: raíz del repo)
DAY_KEYS = ("sab", "dom")  # 1er y 2do día con partidos (en la demo pueden ser otros días de la semana)
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
VIA = "scripts/veedores_cancha.py"
BASE_FIELDS = ["veedor", "cancha", "dias", "link", "mensaje", "telefono"]
PLACEHOLDER = re.compile(r"^Veedor( Demo)?( Cancha)? \d+$")


# ============================================================
# Base (conexión diferida: `qr` no la necesita)
# ============================================================

def _db():
    import seed_competition  # noqa: F401  (pide la URL de la base si no está en el entorno)
    from app.settings import engine
    return engine


def _svc():
    from app.utils import competition_service as svc
    return svc


def slug_for(demo: bool) -> str:
    return COPA_PROUD_2026["slug"] + ("-demo" if demo else "")


def link_for(token: str, demo: bool) -> str:
    return f"{SITE}{'/demo' if demo else ''}/v/{token}"


def _tz(offset: str) -> dt.timezone:
    m = re.fullmatch(r"([+-])(\d{2}):(\d{2})", offset or "")
    if not m:
        return dt.timezone.utc
    delta = dt.timedelta(hours=int(m[2]), minutes=int(m[3]))
    return dt.timezone(-delta if m[1] == "-" else delta)


# Fecha LOCAL del predio de un partido (misma expresión que el endpoint admin /staff/{id}/assign).
_LOCAL_DATE = "(m.scheduled_at AT TIME ZONE 'UTC' + CAST(:off AS interval))::date"


def load_context(conn, slug: str, *, lock: bool = False) -> dict:
    """Competencia + sus dos días (fechas locales de los partidos) + canchas + partidos por cancha/día."""
    row = conn.execute(text(
        "SELECT id, slug, name, utc_offset FROM public.competitions WHERE slug = :s"
        + (" FOR UPDATE" if lock else "")
    ), {"s": slug}).mappings().first()
    if not row:
        extra = " Creala con: ./.venv/bin/python scripts/demo_competition.py crear" if slug.endswith("-demo") else ""
        sys.exit(f"No existe la competencia {slug}.{extra}")
    off = row["utc_offset"] or "+00:00"
    counts = conn.execute(text(f"""
        SELECT v.number AS venue, {_LOCAL_DATE} AS d, COUNT(*) AS n
        FROM public.competition_matches m
        JOIN public.competition_venues v ON v.id = m.venue_id
        WHERE m.competition_id = :cid AND m.scheduled_at IS NOT NULL
        GROUP BY 1, 2
    """), {"cid": row["id"], "off": off}).mappings().all()
    dates = sorted({r["d"] for r in counts})
    if len(dates) != len(DAY_KEYS):
        sys.exit(f"{slug}: los partidos caen en {len(dates)} día(s) "
                 f"({', '.join(d.isoformat() for d in dates) or 'ninguno'}); se esperaban 2 (sábado y domingo).")
    venues = [r[0] for r in conn.execute(text("""
        SELECT number FROM public.competition_venues WHERE competition_id = :cid ORDER BY number
    """), {"cid": row["id"]})]
    return {
        "id": row["id"], "slug": row["slug"], "name": row["name"], "offset": off,
        "demo": row["slug"].endswith("-demo"), "venues": venues,
        "day_dates": dict(zip(DAY_KEYS, dates)),
        "counts": {(r["venue"], r["d"]): int(r["n"]) for r in counts},
    }


def active_veedores(conn, ctx: dict) -> list[dict]:
    """Veedores no revocados con sus canchas/días (por partido) y sus equipos (modelo viejo)."""
    p = {"cid": ctx["id"], "off": ctx["offset"]}
    staff = conn.execute(text("""
        SELECT id, full_name, created_at, token_rotated_at, access_token_hash IS NOT NULL AS has_link
        FROM public.competition_staff
        WHERE competition_id = :cid AND role = 'VEEDOR' AND revoked_at IS NULL
    """), p).mappings().all()
    courts = conn.execute(text(f"""
        SELECT m.veedor_staff_id AS sid, v.number AS venue, {_LOCAL_DATE} AS d, COUNT(*) AS n
        FROM public.competition_matches m
        JOIN public.competition_venues v ON v.id = m.venue_id
        WHERE m.competition_id = :cid AND m.veedor_staff_id IS NOT NULL
        GROUP BY 1, 2, 3
    """), p).mappings().all()
    teams = conn.execute(text("""
        SELECT veedor_staff_id AS sid, name FROM public.competition_teams
        WHERE competition_id = :cid AND veedor_staff_id IS NOT NULL
        ORDER BY lower(name)
    """), p).mappings().all()
    out = []
    for s in staff:
        mine = [c for c in courts if c["sid"] == s["id"]]
        out.append({
            **dict(s),
            "courts": sorted((c["venue"], c["d"]) for c in mine),
            "n_matches": sum(int(c["n"]) for c in mine),
            "teams": [t["name"] for t in teams if t["sid"] == s["id"]],
        })
    # Por cancha y día; los que no tienen cancha (veedores por equipo), al final.
    out.sort(key=lambda s: (not s["courts"], min(s["courts"], default=(0, dt.date.min)), s["full_name"].lower()))
    return out


def _on(staff: dict, venue: int | None, date: dt.date | None) -> bool:
    return any((venue is None or v == venue) and (date is None or d == date) for v, d in staff["courts"])


# ============================================================
# Textos
# ============================================================

def day_label(d: dt.date) -> str:
    return f"{WEEKDAYS[d.weekday()]} {d.day}/{d.month}"


def assignment_text(courts) -> tuple[str, str, str]:
    """[(cancha, fecha)] → ("3", "sábado 10/10 y domingo 11/10", "Cancha 3 · sábado 10/10 y domingo 11/10")."""
    by_venue: dict = {}
    for v, d in sorted(courts):
        by_venue.setdefault(v, [])
        if d not in by_venue[v]:
            by_venue[v].append(d)
    if not by_venue:
        return "", "", ""

    def days(ds):
        return " y ".join(day_label(d) for d in ds)

    cancha = " y ".join(str(v) for v in by_venue)
    if len(by_venue) == 1:
        ((v, ds),) = by_venue.items()
        return cancha, days(ds), f"Cancha {v} · {days(ds)}"
    dias = " · ".join(f"cancha {v}: {days(ds)}" for v, ds in by_venue.items())
    return cancha, dias, ", ".join(f"Cancha {v} · {days(ds)}" for v, ds in by_venue.items())


def message(name: str, detalle: str, link: str, demo: bool) -> str:
    hola = "Hola!" if PLACEHOLDER.match(name) else f"Hola {name}!"
    if demo:
        return (f"{hola} Este es tu link de PRÁCTICA de veedor de la Copa Proud ({detalle}): {link} "
                "Es el modo demo: probá todo lo que quieras, nada de lo que cargues cuenta para el torneo. "
                "El link del torneo real te lo mandamos aparte.")
    return f"{hola} Este es tu link de veedor de la Copa Proud ({detalle}). Guardalo, no lo compartas: {link}"


def output_row(name: str, link: str, courts, teams, demo: bool, telefono: str = "") -> dict:
    cancha, dias, detalle = assignment_text(courts)
    if not detalle:
        detalle = f"equipos: {' · '.join(teams)}" if teams else "sin cancha asignada todavía"
    row = {"veedor": name, "cancha": cancha, "dias": dias, "link": link,
           "mensaje": message(name, detalle, link, demo), "telefono": telefono or ""}
    if teams:
        row["equipos"] = " · ".join(teams)
    return row


def describe(staff: dict) -> str:
    """'Cancha 3 · sábado 10/10 y domingo 11/10' (+ equipos si es veedor por equipo)."""
    where = assignment_text(staff["courts"])[2]
    if staff["teams"]:
        where = (where + " + " if where else "") + "equipos: " + " · ".join(staff["teams"])
    return where or "sin asignar"


def courts_summary(courts, ctx: dict) -> str:
    """Para el resumen previo: 'cancha 1 · sábado 10/10 (7 partidos) y domingo 11/10 (6 partidos)'."""
    by_venue: dict = {}
    for v, d in sorted(courts):
        by_venue.setdefault(v, []).append(d)
    return " | ".join(
        f"cancha {v} · " + " y ".join(f"{day_label(d)} ({ctx['counts'].get((v, d), 0)} partidos)" for d in ds)
        for v, ds in by_venue.items()
    ) or "sin cancha"


def print_header(ctx: dict) -> None:
    from sqlalchemy.engine import make_url
    target = make_url(os.environ["DATABASE_URL"])
    kind = "DEMO (ensayo)" if ctx["demo"] else "TORNEO REAL"
    days = " · ".join(f"{k} = {day_label(d)}" for k, d in ctx["day_dates"].items())
    print(f"== {ctx['name']} ({ctx['slug']}) — {kind}")
    print(f"   Base: {target.host}:{target.port or 5432} / {target.database}")
    print(f"   Días: {days} · Canchas: {', '.join(str(v) for v in ctx['venues'])}")


def print_rows(rows: list[dict]) -> None:
    if not rows:
        return
    w = max(len(r["veedor"]) for r in rows)
    for r in rows:
        if r.get("cancha"):
            # Varias canchas: `dias` ya dice cuál es cuál ("cancha 3: sábado 10/10 · cancha 5: …").
            where = r["dias"] if " y " in r["cancha"] else f"Cancha {r['cancha']} · {r['dias']}"
        else:
            where = f"equipos: {r['equipos']}" if r.get("equipos") else "sin cancha asignada"
        print(f"  {r['veedor']:<{w}}  {where}")
        print(f"  {'':<{w}}  {r['link']}")


def confirm(si: bool) -> bool:
    if si:
        return True
    if not sys.stdin.isatty():
        sys.exit("Sin terminal interactiva: para confirmar sin preguntar agregá --si.")
    answer = input("\n¿Aplicar? Escribí APLICAR y Enter (solo Enter = salir): ")
    return answer.strip().upper() == "APLICAR"


# ============================================================
# Entrada: CSV de veedores
# ============================================================

def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().strip().lower()


def _parse_day(raw: str) -> list[str] | None:
    s = " ".join(_norm(raw).replace(".", "").split())
    if s in ("", "ambos", "ambos dias", "los dos", "sab y dom", "sabado y domingo"):
        return list(DAY_KEYS)
    if s in ("sab", "sabado"):
        return ["sab"]
    if s in ("dom", "domingo"):
        return ["dom"]
    return None


def placeholder_people(ctx: dict) -> list[dict]:
    """Un veedor por cancha, los dos días ("Veedor Cancha N"; en la demo "Veedor Demo Cancha N")."""
    prefix = "Veedor Demo Cancha" if ctx["demo"] else "Veedor Cancha"
    return [{"nombre": f"{prefix} {v}", "telefono": "", "slots": [(v, k) for k in DAY_KEYS]}
            for v in ctx["venues"]]


def read_people_csv(path: str, ctx: dict) -> list[dict]:
    """cancha,dia,nombre[,telefono] → personas (un nombre repetido = una persona con varias canchas/días)."""
    if not os.path.exists(path):
        sys.exit(f"No existe el archivo {path}.")
    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        delim = ";" if sample.count(";") > sample.count(",") else ","  # Excel en castellano usa ';'
        reader = csv.DictReader(f, delimiter=delim)
        header = {_norm(h): h for h in (reader.fieldnames or []) if h}
        missing = [c for c in ("cancha", "nombre") if c not in header]
        if missing:
            sys.exit(f"{path}: faltan las columnas {', '.join(missing)} (se esperan: cancha,dia,nombre[,telefono]).")

        def get(row, col):
            return (row.get(header[col]) or "").strip() if col in header else ""

        people: dict = {}
        taken: dict = {}
        errors = []
        for line, row in enumerate(reader, start=2):
            if not any(isinstance(v, str) and v.strip() for v in row.values()):
                continue  # renglón vacío
            nombre = " ".join(get(row, "nombre").split())
            raw_cancha = get(row, "cancha")
            days = _parse_day(get(row, "dia"))
            try:
                cancha = int(raw_cancha)
            except ValueError:
                cancha = None
            if cancha not in ctx["venues"]:
                errors.append(f"fila {line}: cancha '{raw_cancha}' no existe (hay {', '.join(map(str, ctx['venues']))}).")
            if days is None:
                errors.append(f"fila {line}: día '{get(row, 'dia')}' no se entiende (usá sab, dom o ambos).")
            if not 2 <= len(nombre) <= 120:
                errors.append(f"fila {line}: falta el nombre (o es demasiado largo).")
            if cancha not in ctx["venues"] or days is None or not 2 <= len(nombre) <= 120:
                continue
            for k in days:
                if (cancha, k) in taken:
                    errors.append(f"fila {line}: la cancha {cancha} del {k} ya está en la fila {taken[(cancha, k)]} "
                                  "(un partido tiene un solo veedor de cancha).")
                taken[(cancha, k)] = line
            person = people.setdefault(nombre.casefold(), {"nombre": nombre, "telefono": "", "slots": []})
            person["telefono"] = person["telefono"] or get(row, "telefono")
            person["slots"] += [(cancha, k) for k in days if (cancha, k) not in person["slots"]]
    if errors:
        sys.exit(f"{path}: hay errores, no se tocó nada:\n  " + "\n  ".join(errors))
    if not people:
        sys.exit(f"{path}: no tiene veedores.")
    return list(people.values())


def uncovered_slots(people: list[dict], ctx: dict) -> list[tuple]:
    covered = {(v, ctx["day_dates"][k]) for p in people for v, k in p["slots"]}
    return sorted((v, d, n) for (v, d), n in ctx["counts"].items() if (v, d) not in covered)


# ============================================================
# Escrituras (dentro de la transacción del llamador; las reusa demo_competition.py)
# ============================================================

def revoke_all(conn, ctx: dict) -> int:
    """Revoca TODOS los veedores activos y borra las asignaciones (por equipo y por partido)."""
    cid = ctx["id"]
    n = conn.execute(text("""
        UPDATE public.competition_staff SET revoked_at = now()
        WHERE competition_id = :cid AND role = 'VEEDOR' AND revoked_at IS NULL
    """), {"cid": cid}).rowcount
    conn.execute(text("""
        UPDATE public.competition_teams SET veedor_staff_id = NULL
        WHERE competition_id = :cid AND veedor_staff_id IS NOT NULL
    """), {"cid": cid})
    conn.execute(text("""
        UPDATE public.competition_matches SET veedor_staff_id = NULL, updated_at = now()
        WHERE competition_id = :cid AND veedor_staff_id IS NOT NULL
    """), {"cid": cid})
    _svc().audit(conn, cid, "STAFF_REVOKE_ALL", metadata={"via": VIA, "revoked": n})
    return n


def assign_court(conn, ctx: dict, staff_id, venue: int, date: dt.date) -> int:
    """El veedor queda a cargo de TODOS los partidos de esa cancha ese día (fecha local del predio)."""
    return conn.execute(text(f"""
        UPDATE public.competition_matches m
        SET veedor_staff_id = :sid, updated_at = now()
        FROM public.competition_venues v
        WHERE m.competition_id = :cid AND v.id = m.venue_id AND v.number = :venue
          AND {_LOCAL_DATE} = CAST(:d AS date)
    """), {"sid": staff_id, "cid": ctx["id"], "venue": venue, "d": date.isoformat(), "off": ctx["offset"]}).rowcount


def crear_veedores(conn, ctx: dict, people: list[dict], *, reemplazar: bool = False) -> list[dict]:
    """Crea un veedor (con link nuevo) por persona y le asigna sus canchas/días. Devuelve las filas del CSV."""
    svc = _svc()
    active = conn.execute(text("""
        SELECT COUNT(*) FROM public.competition_staff
        WHERE competition_id = :cid AND role = 'VEEDOR' AND revoked_at IS NULL
    """), {"cid": ctx["id"]}).scalar()
    if active and not reemplazar:
        sys.exit(f"Abortado: {ctx['slug']} ya tiene {active} veedor(es) activo(s). Para reemplazarlos usá --reemplazar.")
    if reemplazar:
        revoke_all(conn, ctx)
    rows = []
    for p in people:
        token = gen_management_token()
        sid = conn.execute(text("""
            INSERT INTO public.competition_staff
              (competition_id, full_name, role, access_token_hash, token_rotated_at)
            VALUES (:cid, :name, 'VEEDOR', :h, now()) RETURNING id
        """), {"cid": ctx["id"], "name": p["nombre"], "h": hash_management_token(token)}).scalar()
        courts = sorted((v, ctx["day_dates"][k]) for v, k in p["slots"])
        n = sum(assign_court(conn, ctx, sid, v, d) for v, d in courts)
        svc.audit(conn, ctx["id"], "STAFF_CREATE", metadata={
            "staff_id": str(sid), "role": "VEEDOR", "via": VIA, "matches": n,
            "courts": [{"venue": v, "date": d.isoformat()} for v, d in courts]})
        rows.append(output_row(p["nombre"], link_for(token, ctx["demo"]), courts, [], ctx["demo"], p.get("telefono", "")))
    svc.bump_version(conn, ctx["id"])  # el sitio público muestra el veedor de cada partido
    return rows


def rotar_links(conn, ctx: dict, staff: list[dict]) -> list[dict]:
    """Token nuevo para cada veedor (el anterior deja de andar). Devuelve las filas del CSV."""
    svc = _svc()
    rows = []
    for s in staff:
        token = gen_management_token()
        res = conn.execute(text("""
            UPDATE public.competition_staff
            SET access_token_hash = :h, token_rotated_at = now()
            WHERE id = :sid AND competition_id = :cid AND revoked_at IS NULL
        """), {"h": hash_management_token(token), "sid": s["id"], "cid": ctx["id"]})
        if res.rowcount == 0:
            print(f"  ⚠️  {s['full_name']}: ya no está activo, se saltea.")
            continue
        svc.audit(conn, ctx["id"], "STAFF_ROTATE_TOKEN", metadata={"staff_id": str(s["id"]), "via": VIA})
        rows.append(output_row(s["full_name"], link_for(token, ctx["demo"]), s["courts"], s["teams"], ctx["demo"]))
    return rows


# ============================================================
# Salida: CSV + hoja de QR
# ============================================================

def out_paths(demo: bool) -> tuple[str, str]:
    if demo:
        return os.path.join(OUT_DIR, "demo-veedores.csv"), os.path.join(OUT_DIR, "demo-veedores-qr.png")
    return os.path.join(OUT_DIR, "veedores-links.csv"), os.path.join(OUT_DIR, "veedores-qr.png")


def read_csv_rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [dict(r) for r in csv.DictReader(f)]


def write_outputs(rows: list[dict], demo: bool, *, merge: bool = False) -> tuple[str, str | None]:
    """
    Escribe el CSV (y la hoja de QR si se puede). Con merge=True reemplaza en el CSV existente solo
    las filas de estos veedores (por nombre) y conserva las demás (sus links siguen andando).
    """
    csv_path, png_path = out_paths(demo)
    if merge and os.path.exists(csv_path):
        old = read_csv_rows(csv_path)
        fresh = {r["veedor"].casefold(): r for r in rows}
        for key, r in fresh.items():  # conservar el teléfono que ya estaba
            prev = next((o for o in old if o.get("veedor", "").casefold() == key), None)
            if prev and not r.get("telefono"):
                r["telefono"] = prev.get("telefono", "")
        merged, used = [], set()
        for o in old:
            key = o.get("veedor", "").casefold()
            if key in fresh:
                if key not in used:
                    merged.append(fresh[key])
                    used.add(key)
            else:
                merged.append(o)
        rows = merged + [r for k, r in fresh.items() if k not in used]
    fields = BASE_FIELDS + sorted({k for r in rows for k in r if k} - set(BASE_FIELDS))
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:  # con BOM: Excel respeta los acentos
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    try:
        os.chmod(csv_path, 0o600)  # tiene los links: solo para vos
    except OSError:
        pass
    return csv_path, write_qr_sheet(png_path, rows, demo)


def _font(size: int, bold: bool = False):
    from PIL import ImageFont
    names = (["Arial Bold.ttf", "DejaVuSans-Bold.ttf"] if bold else []) + ["Arial.ttf", "DejaVuSans.ttf"]
    for name in names:
        for folder in ("/System/Library/Fonts/Supplemental", "/Library/Fonts", "/usr/share/fonts/truetype/dejavu", ""):
            try:
                return ImageFont.truetype(os.path.join(folder, name) if folder else name, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _fit(draw, txt: str, font, max_w: float) -> str:
    if draw.textlength(txt, font=font) <= max_w:
        return txt
    while len(txt) > 1 and draw.textlength(txt + "…", font=font) > max_w:
        txt = txt[:-1]
    return txt.rstrip() + "…"


def write_qr_sheet(path: str, rows: list[dict], demo: bool) -> str | None:
    """Hoja imprimible (PNG) con un QR por veedor. Devuelve None si faltan `qrcode`/Pillow."""
    try:
        import qrcode
        from PIL import Image, ImageDraw
    except ImportError:
        return None
    rows = [r for r in rows if r.get("link")]
    if not rows:
        return None
    cols = 2 if len(rows) <= 6 else 3
    cell_w, cell_h, qr_px, margin, head_h = 560, 640, 440, 40, 130
    n_lines = -(-len(rows) // cols)
    img = Image.new("RGB", (margin * 2 + cols * cell_w, margin * 2 + head_h + n_lines * cell_h), "white")
    draw = ImageDraw.Draw(img)
    title = "Copa Proud · Links de veedores" + (" · DEMO (práctica)" if demo else "")
    draw.text((margin, margin), title, fill="black", font=_font(46, bold=True))
    draw.text((margin, margin + 64), "Escaneá tu QR con la cámara del celular y guardá el link. No lo compartas.",
              fill="#444444", font=_font(26))
    for i, r in enumerate(rows):
        x = margin + (i % cols) * cell_w
        y = margin + head_h + (i // cols) * cell_h
        draw.rounded_rectangle([x + 10, y + 10, x + cell_w - 10, y + cell_h - 10], radius=18, outline="#bbbbbb", width=2)
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=1, border=2)
        qr.add_data(r["link"])
        qr.make(fit=True)
        qr.box_size = max(2, qr_px // (qr.modules_count + 2 * qr.border))  # módulos enteros: se escanea mejor
        q = qr.make_image(fill_color="black", back_color="white")
        q = (q.get_image() if hasattr(q, "get_image") else getattr(q, "_img", q)).convert("RGB")
        img.paste(q, (x + (cell_w - q.width) // 2, y + 26 + (qr_px - q.height) // 2))
        ty = y + 26 + qr_px + 12
        place = f"Cancha {r['cancha']}" if r.get("cancha") else r.get("equipos", "")
        for txt, size, bold, color in ((r["veedor"], 34, True, "black"), (place, 30, True, "black"),
                                       (r.get("dias", ""), 24, False, "#333333")):
            if not txt:
                continue
            font = _font(size, bold)
            txt = _fit(draw, txt, font, cell_w - 50)
            draw.text((x + (cell_w - draw.textlength(txt, font=font)) / 2, ty), txt, fill=color, font=font)
            ty += size + 12
    img.save(path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def print_outputs(csv_path: str, png: str | None, demo: bool) -> None:
    print(f"\n  CSV con links y mensajes para WhatsApp: {csv_path}")
    if png:
        print(f"  Hoja de QR para imprimir: {png}")
    else:
        print("  (Hoja de QR: no se generó porque falta el paquete qrcode — con `./.venv/bin/pip install qrcode` "
              f"y `veedores_cancha.py qr{' --demo' if demo else ''}` se arma sin cambiar los links.)")


# ============================================================
# Comandos
# ============================================================

def cmd_crear(args) -> None:
    engine = _db()
    slug = slug_for(args.demo)
    with engine.connect() as conn:
        ctx = load_context(conn, slug)
        active = active_veedores(conn, ctx)
    people = read_people_csv(args.archivo, ctx) if args.archivo else placeholder_people(ctx)
    print_header(ctx)
    if active and not args.reemplazar:
        print(f"\nYa hay {len(active)} veedor(es) activo(s):")
        for s in active:
            print(f"  {s['full_name']}  ({describe(s)})")
        sys.exit("\nAbortado, no se tocó nada. Para reemplazarlos (sus links dejan de andar) agregá --reemplazar.\n"
                 "Para links nuevos sin cambiar a nadie: `links`. Para cambiar un nombre: `renombrar`.")

    origin = f"desde {args.archivo}" if args.archivo else "de prueba, uno por cancha (después se renombran)"
    print(f"\nSe van a crear {len(people)} veedores {origin}, cada uno con su link nuevo:")
    w = max(len(p["nombre"]) for p in people)
    for p in people:
        courts = [(v, ctx["day_dates"][k]) for v, k in p["slots"]]
        print(f"  {p['nombre']:<{w}}  {courts_summary(courts, ctx)}")
    if active:
        print(f"\n⚠️  --reemplazar: se REVOCAN {len(active)} veedor(es) activo(s) (sus links dejan de andar) y se borran "
              "todas las asignaciones de veedor (por equipo y por cancha).")
    for v, d, n in uncovered_slots(people, ctx):
        print(f"⚠️  Sin veedor: cancha {v} · {day_label(d)} ({n} partidos)")
    if not confirm(args.si):
        print("No se guardó nada.")
        return
    with engine.begin() as conn:
        ctx = load_context(conn, slug, lock=True)
        rows = crear_veedores(conn, ctx, people, reemplazar=args.reemplazar)
    csv_path, png = write_outputs(rows, args.demo)
    print(f"\n✓ {len(rows)} veedores creados ({'DEMO' if args.demo else 'torneo real'}):\n")
    print_rows(rows)
    print_outputs(csv_path, png, args.demo)


def cmd_links(args) -> None:
    engine = _db()
    slug = slug_for(args.demo)
    with engine.connect() as conn:
        ctx = load_context(conn, slug)
        active = active_veedores(conn, ctx)
    if args.cancha is not None and args.cancha not in ctx["venues"]:
        sys.exit(f"La cancha {args.cancha} no existe (hay {', '.join(map(str, ctx['venues']))}).")
    date = ctx["day_dates"][args.dia] if args.dia else None
    partial = args.cancha is not None or date is not None
    targets = [s for s in active if _on(s, args.cancha, date)] if partial else active
    where = " · ".join(x for x in (f"cancha {args.cancha}" if args.cancha is not None else "",
                                    day_label(date) if date else "") if x)
    print_header(ctx)
    if not targets:
        sys.exit(f"No hay veedores activos{' en ' + where if where else ''}. Crealos con `crear`.")
    print(f"\nLinks NUEVOS para {len(targets)} veedor(es){' (' + where + ')' if where else ''}:")
    for s in targets:
        print(f"  {s['full_name']}  ({describe(s)})")
    print("\n⚠️  Sus links actuales dejan de funcionar apenas confirmes: hay que mandarles el nuevo.")
    if not confirm(args.si):
        print("No se guardó nada.")
        return
    with engine.begin() as conn:
        ctx = load_context(conn, slug, lock=True)
        rows = rotar_links(conn, ctx, targets)
    csv_path, png = write_outputs(rows, args.demo, merge=partial)
    print(f"\n✓ {len(rows)} link(s) nuevo(s). Los anteriores ya no funcionan:\n")
    print_rows(rows)
    print_outputs(csv_path, png, args.demo)


def cmd_renombrar(args) -> None:
    nombre = " ".join(args.nombre.split())
    if not 2 <= len(nombre) <= 120:
        sys.exit("El nombre tiene que tener entre 2 y 120 caracteres.")
    engine = _db()
    slug = slug_for(args.demo)
    with engine.begin() as conn:
        ctx = load_context(conn, slug, lock=True)
        if args.cancha not in ctx["venues"]:
            sys.exit(f"La cancha {args.cancha} no existe (hay {', '.join(map(str, ctx['venues']))}).")
        date = ctx["day_dates"][args.dia] if args.dia else None
        active = active_veedores(conn, ctx)
        found = [s for s in active if _on(s, args.cancha, date)]
        where = f"cancha {args.cancha}" + (f" · {day_label(date)}" if date else "")
        if not found:
            sys.exit(f"No hay veedor activo en la {where}.")
        if len(found) > 1:
            who = "; ".join(f"{s['full_name']} ({assignment_text(s['courts'])[2]})" for s in found)
            sys.exit(f"La {where} tiene más de un veedor: {who}. Indicá el día con --dia sab|dom.")
        s = found[0]
        if s["full_name"] == nombre:
            print(f"Ya se llama {nombre}. No se cambió nada.")
            return
        if any(o["full_name"].casefold() == nombre.casefold() and o["id"] != s["id"] for o in active):
            sys.exit(f"Ya hay otro veedor activo que se llama {nombre}.")
        conn.execute(text("UPDATE public.competition_staff SET full_name = :n WHERE id = :sid"),
                     {"n": nombre, "sid": s["id"]})
        svc = _svc()
        svc.audit(conn, ctx["id"], "STAFF_RENAME",
                  metadata={"staff_id": str(s["id"]), "from": s["full_name"], "to": nombre, "via": VIA})
        svc.bump_version(conn, ctx["id"])  # el nombre se ve en el sitio público
    detalle = assignment_text(s["courts"])[2] or "sin cancha"
    print(f"✓ {s['full_name']} → {nombre} ({detalle}). El link NO cambia.")
    others = [c for c in s["courts"] if not (c[0] == args.cancha and (date is None or c[1] == date))]
    if others:
        print(f"  (Es la misma persona que en: {assignment_text(others)[2]}; el nombre cambia en todo.)")

    # El CSV de links queda al día (mismo link, nombre y mensaje nuevos).
    csv_path, _ = out_paths(args.demo)
    if os.path.exists(csv_path):
        rows = read_csv_rows(csv_path)
        hit = False
        for r in rows:
            if r.get("veedor", "").casefold() == s["full_name"].casefold() and r.get("link"):
                r.update(output_row(nombre, r["link"], s["courts"], s["teams"], args.demo, r.get("telefono", "")))
                hit = True
        if hit:
            csv_path, png = write_outputs(rows, args.demo)
            print(f"  CSV actualizado: {csv_path}" + (f" · QR: {png}" if png else ""))


def cmd_listar(args) -> None:
    engine = _db()
    slug = slug_for(args.demo)
    with engine.connect() as conn:
        ctx = load_context(conn, slug)
        active = active_veedores(conn, ctx)
        revoked = conn.execute(text("""
            SELECT COUNT(*) FROM public.competition_staff
            WHERE competition_id = :cid AND role = 'VEEDOR' AND revoked_at IS NOT NULL
        """), {"cid": ctx["id"]}).scalar()
        # Partidos que no carga nadie: sin veedor de cancha activo y sin veedor activo de sus equipos.
        uncovered = conn.execute(text(f"""
            SELECT v.number AS venue, {_LOCAL_DATE} AS d, COUNT(*) AS n
            FROM public.competition_matches m
            JOIN public.competition_venues v ON v.id = m.venue_id
            LEFT JOIN public.competition_staff s ON s.id = m.veedor_staff_id AND s.revoked_at IS NULL
            WHERE m.competition_id = :cid AND s.id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM public.competition_teams t
                JOIN public.competition_staff ts ON ts.id = t.veedor_staff_id AND ts.revoked_at IS NULL
                WHERE t.id IN (m.home_team_id, m.away_team_id))
            GROUP BY 1, 2 ORDER BY 2, 1
        """), {"cid": ctx["id"], "off": ctx["offset"]}).mappings().all()
    tz = _tz(ctx["offset"])

    def when(ts):
        return ts.astimezone(tz).strftime("%d/%m %H:%M") if ts else "—"

    print_header(ctx)
    print()
    if not active:
        print("  No hay veedores activos. Crealos con `crear`.")
    else:
        rows = []
        for s in active:
            rows.append((s["full_name"], describe(s), str(s["n_matches"]) if s["courts"] else "—", when(s["created_at"]),
                         when(s["token_rotated_at"]) if s["has_link"] else "sin link"))
        head = ("Veedor", "Cancha · días", "Partidos", "Alta", "Link generado")
        widths = [max(len(r[i]) for r in rows + [head]) for i in range(len(head))]
        print("  " + "  ".join(h.ljust(w) for h, w in zip(head, widths)))
        print("  " + "  ".join("-" * w for w in widths))
        for r in rows:
            print("  " + "  ".join(c.ljust(w) for c, w in zip(r, widths)))
    if revoked:
        print(f"\n  (+{revoked} revocado(s): sus links ya no funcionan)")
    if uncovered:
        print("\n⚠️  Partidos sin veedor:")
        for u in uncovered:
            print(f"  cancha {u['venue']} · {day_label(u['d'])}: {u['n']} partido(s)")
    else:
        print("\n✓ Todos los partidos tienen veedor.")
    print("  (Los links no se pueden volver a mostrar: para uno nuevo, `links --cancha N`.)")


def cmd_qr(args) -> None:
    csv_path, png_path = out_paths(args.demo)
    src = args.archivo or csv_path
    if not os.path.exists(src):
        sys.exit(f"No existe {src}. Primero corré `crear` o `links`.")
    rows = read_csv_rows(src)
    png = write_qr_sheet(png_path, rows, args.demo)
    if not png:
        sys.exit("Falta el paquete qrcode (o Pillow): ./.venv/bin/pip install qrcode")
    print(f"✓ Hoja de QR ({len(rows)} veedores): {png}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--demo", action="store_true", help="competencia de ensayo (copa-proud-2026-demo)")
    sub = ap.add_subparsers(dest="accion", required=True)

    p = sub.add_parser("crear", parents=[common], help="crea los veedores por cancha y sus links")
    p.add_argument("--archivo", help="CSV con columnas cancha,dia,nombre[,telefono]")
    p.add_argument("--reemplazar", action="store_true", help="revoca los veedores activos antes de crear")
    p.add_argument("--si", action="store_true", help="no pedir APLICAR")
    p.set_defaults(func=cmd_crear)

    p = sub.add_parser("links", parents=[common], help="links nuevos (los anteriores dejan de andar)")
    p.add_argument("--cancha", type=int)
    p.add_argument("--dia", choices=DAY_KEYS)
    p.add_argument("--si", action="store_true", help="no pedir APLICAR")
    p.set_defaults(func=cmd_links)

    p = sub.add_parser("renombrar", parents=[common], help="cambia el nombre sin cambiar el link")
    p.add_argument("--cancha", type=int, required=True)
    p.add_argument("--dia", choices=DAY_KEYS)
    p.add_argument("nombre")
    p.set_defaults(func=cmd_renombrar)

    p = sub.add_parser("listar", parents=[common], help="veedores y canchas (sin tokens)")
    p.set_defaults(func=cmd_listar)

    p = sub.add_parser("qr", parents=[common], help="rearma la hoja de QR desde el CSV (sin base)")
    p.add_argument("--archivo", help="CSV de links (default: el de salida)")
    p.set_defaults(func=cmd_qr)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
