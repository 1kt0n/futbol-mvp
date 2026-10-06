"""
Carga los PLANTELES (jugadores de cada equipo) desde la planilla de inscriptos de la organización
(.xlsx, hoja "Inscriptos": Equipo · País · Rol · Nombre · Apellido · Edad · Email).

  ./.venv/bin/python scripts/planteles.py ~/Downloads/Inscriptos_equipos_06-10.xlsx --demo   → ensayo
  ./.venv/bin/python scripts/planteles.py ~/Downloads/Inscriptos_equipos_06-10.xlsx          → torneo real

- Solo entran las filas con Rol "Atleta …"; el staff (referente, DT, preparador) no.
- Solo se guarda NOMBRE Y APELLIDO: la planilla tiene emails y edades que NO se cargan.
- La planilla no trae dorsales: los jugadores quedan sin número (el veedor los elige por nombre).
- Por cada equipo de la planilla REEMPLAZA su plantel. Los goles/tarjetas ya cargados con un
  jugador quedan, sin jugador (la base los pone en NULL). Un equipo que en la planilla no tiene
  atletas conserva lo que tenga.
- Muestra qué va a hacer y pide escribir APLICAR (o --si para pruebas). Pide la URL de la base.
- La planilla no se copia al repo: tiene datos personales.
"""
import argparse
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402,F401  (pide la URL de la base si no está en el entorno)

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402

# Nombre del equipo en la planilla → nombre oficial cargado (scripts/copa_proud_teams.json).
ALIAS = {
    "3f deporte inclusivo": "3F",
    "alianza rio": "Alianza Rio FC",
    "zorros mar del plata": "Zorros",
    "lux futbol club": "Lux Fútbol Club I",
    "dogos f5": "Dogos",
    "guatemala i&d": "Guatemala IyD",
    "te sobra noche": "Sobra Noche",
    "rayos cordoba club": "Rayos.cba",
    "rayos cordoba club equipo 2": "Rayos.cba II",
    "beescats david miranda": "Beescats",
    "futbolx": "Fútbol X",
    "vino tinto": "Vino Tinto FC",
    "kariocas fc": "Kariocas",
    "cobras": "Cobras FC",
}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", norm(s))


def read_sheet(path: str, sheet: str = "Inscriptos") -> list[list]:
    """Lector mínimo de .xlsx (solo stdlib): filas de la hoja como listas de valores."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = None
        for sh in wb.find("m:sheets", NS):
            if sh.get("name") == sheet:
                rid = sh.get(REL)
                target = next(r.get("Target") for r in rels if r.get("Id") == rid)
        if not target:
            sys.exit(f'La planilla no tiene la hoja "{sheet}".')
        target = target.lstrip("/")
        xml = ET.fromstring(z.read(target if target.startswith("xl/") else f"xl/{target}"))
    rows = []
    for row in xml.iter(f"{{{NS['m']}}}row"):
        vals = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            idx = 0
            for ch in col:
                idx = idx * 26 + (ord(ch) - 64)
            t, v = c.get("t"), c.find("m:v", NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
            else:
                val = v.text if v is not None else None
            vals[idx - 1] = val
        if vals:
            rows.append([vals.get(i) for i in range(max(vals) + 1)])
    return rows


def pretty(name: str) -> str:
    """Nombre prolijo: si vino TODO EN MAYÚSCULAS o todo en minúsculas, se capitaliza."""
    name = re.sub(r"\s+", " ", (name or "").strip())
    if name and (name.isupper() or name.islower()):
        name = " ".join(w[:1].upper() + w[1:].lower() for w in name.split(" "))
    return name


def leer_planteles(path: str) -> dict[str, list[str]]:
    rows = read_sheet(path)
    head = [norm(str(h or "")) for h in rows[0]]
    col = {name: head.index(name) for name in ("equipo", "rol", "nombre", "apellido")}
    out: dict[str, list[str]] = {}
    for r in rows[1:]:
        r = r + [None] * (len(head) - len(r))
        team = (r[col["equipo"]] or "").strip()
        if not team:
            continue
        out.setdefault(team, [])
        if not norm(str(r[col["rol"]] or "")).startswith("atleta"):
            continue
        full = pretty(f"{r[col['nombre']] or ''} {r[col['apellido']] or ''}")
        if full and key(full) not in {key(x) for x in out[team]}:
            out[team].append(full)
    return out


def plan(conn, slug: str, planteles: dict[str, list[str]]) -> dict:
    comp = svc.get_competition(conn, slug, for_update=True)
    teams = conn.execute(text("""
        SELECT t.id, t.name, count(p.id) AS n
        FROM public.competition_teams t LEFT JOIN public.competition_players p ON p.team_id = t.id
        WHERE t.competition_id = :cid GROUP BY t.id, t.name
    """), {"cid": comp["id"]}).mappings().all()
    by_key = {key(t["name"]): t for t in teams}
    rep = {"comp": comp, "load": [], "empty": [], "unknown": [], "missing": []}
    used = set()
    for sheet_name, players in sorted(planteles.items(), key=lambda kv: norm(kv[0])):
        official = ALIAS.get(norm(sheet_name), sheet_name)
        t = by_key.get(key(official))
        if not t:
            rep["unknown"].append(sheet_name)
            continue
        used.add(t["id"])
        if players:
            rep["load"].append((t, sheet_name, sorted(players, key=norm)))
        else:
            rep["empty"].append((t, sheet_name))
    rep["missing"] = [t["name"] for t in teams if t["id"] not in used]
    return rep


def aplicar(conn, rep: dict) -> int:
    cid = rep["comp"]["id"]
    total = 0
    for t, _, players in rep["load"]:
        conn.execute(text("DELETE FROM public.competition_players WHERE team_id = :tid"), {"tid": t["id"]})
        for name in players:
            conn.execute(text("""
                INSERT INTO public.competition_players (competition_id, team_id, full_name) VALUES (:cid, :tid, :n)
            """), {"cid": cid, "tid": t["id"], "n": name})
        total += len(players)
    svc.audit(conn, cid, "ROSTERS_LOAD", metadata={"teams": len(rep["load"]), "players": total})
    svc.bump_version(conn, cid)
    return total


def mostrar(rep: dict, applied: bool) -> None:
    print(f"== {'APLICADO ✓' if applied else 'PRUEBA EN SECO (no se guardó nada)'} · {rep['comp']['name']}")
    for t, sheet_name, players in rep["load"]:
        alias = f"  (planilla: {sheet_name})" if key(sheet_name) != key(t["name"]) else ""
        print(f"  {t['name']:<20} {len(players):>2} jugadores · reemplaza {t['n']}{alias}")
    for t, sheet_name in rep["empty"]:
        print(f"  ⚠️  {t['name']:<17} sin atletas en la planilla: se deja como está ({t['n']} jugadores)")
    for name in rep["unknown"]:
        print(f"  ⚠️  equipo de la planilla que no reconozco: {name!r} (no se carga; avisame para sumarlo)")
    for name in rep["missing"]:
        print(f"  ⚠️  {name}: no está en la planilla")
    print(f"  Total: {sum(len(p) for _, _, p in rep['load'])} jugadores en {len(rep['load'])} equipos")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("planilla", help="ruta al .xlsx de inscriptos")
    ap.add_argument("--demo", action="store_true", help="competencia de ensayo (copa-proud-2026-demo)")
    ap.add_argument("--si", action="store_true", help="aplicar sin preguntar (pruebas locales)")
    args = ap.parse_args()
    path = os.path.expanduser(args.planilla)
    if not os.path.exists(path):
        sys.exit(f"No encuentro la planilla: {path}")
    slug = COPA_PROUD_2026["slug"] + ("-demo" if args.demo else "")
    planteles = leer_planteles(path)
    target = make_url(os.environ["DATABASE_URL"])
    print(f"Base: {target.host} / {target.database} · competencia: {slug}\n")

    with engine.begin() as conn:
        rep = plan(conn, slug, planteles)
    mostrar(rep, applied=False)
    if rep["unknown"]:
        print("\nHay equipos de la planilla que no reconozco: se cargan los demás igual.")
    if not args.si:
        if not sys.stdin.isatty() or input("\n¿Guardar? Escribí APLICAR y Enter: ").strip().upper() != "APLICAR":
            print("No se guardó nada.")
            return
    with engine.begin() as conn:
        rep = plan(conn, slug, planteles)
        aplicar(conn, rep)
    print()
    mostrar(rep, applied=True)


if __name__ == "__main__":
    main()
