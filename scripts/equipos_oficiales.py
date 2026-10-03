"""
Carga los 28 equipos OFICIALES (scripts/copa_proud_teams.json: nombre, país, escudo) en la
competencia y deja configurado el sorteo con el procedimiento oficial (tandas, cupo de
extranjeros y parejas del mismo club; ver "draw_procedure" en competition_formats.py).

  ./.venv/bin/python scripts/equipos_oficiales.py            → competencia REAL (copa-proud-2026)
  ./.venv/bin/python scripts/equipos_oficiales.py --demo     → competencia de ensayo

Es IDEMPOTENTE: busca cada equipo por nombre (sin tildes ni mayúsculas) y solo inserta los que
faltan y actualiza país / escudo de los existentes. Nunca borra: si en la base hay equipos que no
están en el JSON, los lista. La configuración del sorteo solo se toca si todavía no salió ningún
equipo. Pide la URL de la base (no se muestra), hace la prueba en seco y pide escribir APLICAR.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402,F401  (pide la URL de la base si no está en el entorno)

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_draw as draw_logic  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402

TEAMS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "copa_proud_teams.json")


def cargar(conn, slug: str) -> dict:
    comp = svc.get_competition(conn, slug, for_update=True)
    wanted = json.load(open(TEAMS_JSON, encoding="utf-8"))
    rows = conn.execute(text("""
        SELECT id, name, country_code, logo_url FROM public.competition_teams WHERE competition_id = :cid
    """), {"cid": comp["id"]}).mappings().all()
    existing = {draw_logic._norm(r["name"]): r for r in rows}
    report = {"inserted": [], "updated": [], "extra": [], "draw": None}

    for t in wanted:
        cur = existing.pop(draw_logic._norm(t["name"]), None)
        if cur is None:
            conn.execute(text("""
                INSERT INTO public.competition_teams (competition_id, name, country_code, logo_url)
                VALUES (:cid, :name, :cc, :logo)
            """), {"cid": comp["id"], "name": t["name"], "cc": t["country_code"], "logo": t["logo_url"]})
            report["inserted"].append(t["name"])
        elif (cur["country_code"], cur["logo_url"], cur["name"]) != (t["country_code"], t["logo_url"], t["name"]):
            conn.execute(text("""
                UPDATE public.competition_teams SET name = :name, country_code = :cc, logo_url = :logo
                WHERE id = :id
            """), {"id": cur["id"], "name": t["name"], "cc": t["country_code"], "logo": t["logo_url"]})
            report["updated"].append(t["name"])
    report["extra"] = sorted(r["name"] for r in existing.values())

    # Sorteo: procedimiento oficial (solo si todavía no salió nadie).
    settings = comp["settings"] if isinstance(comp["settings"], dict) else json.loads(comp["settings"] or "{}")
    draw = dict(settings.get("live_draw") or {})
    if draw.get("picks"):
        report["draw"] = "sin cambios (el sorteo ya tiene equipos sorteados)"
    else:
        teams = [{**dict(r), "id": str(r["id"])} for r in conn.execute(text("""
            SELECT id, name, country_code FROM public.competition_teams WHERE competition_id = :cid
        """), {"cid": comp["id"]}).mappings().all()]
        preset = draw_logic.build_tandas_preset(teams, COPA_PROUD_2026["draw_procedure"])
        draw.update(mode="TANDAS", pots=preset["pots"], tandas=preset["tandas"], rules=preset["rules"])
        conn.execute(text("""
            UPDATE public.competitions
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{live_draw}', CAST(:d AS jsonb))
            WHERE id = :cid
        """), {"d": json.dumps(draw), "cid": comp["id"]})
        counts = [sum(1 for v in preset["pots"].values() if v == n) for n in range(1, 6)]
        report["draw"] = f"procedimiento oficial cargado · tandas {counts}"
        report["problems"] = preset["problems"]
    svc.audit(conn, comp["id"], "TEAMS_OFFICIAL_LOAD", metadata={k: v for k, v in report.items() if k != "draw"})
    svc.bump_version(conn, comp["id"])
    return report


def run_once(slug: str, *, apply: bool) -> dict:
    conn = engine.connect()
    trans = conn.begin()
    try:
        report = cargar(conn, slug)
        trans.commit() if apply else trans.rollback()
    except Exception:
        trans.rollback()
        raise
    finally:
        conn.close()
    return report


def show(report: dict, *, applied: bool) -> None:
    print(f"== {'APLICADO ✓' if applied else 'PRUEBA EN SECO (no se guardó nada)'}")
    print(f"  equipos nuevos: {len(report['inserted'])}  actualizados: {len(report['updated'])}")
    for name in report["inserted"]:
        print(f"    + {name}")
    for name in report["updated"]:
        print(f"    ~ {name}")
    if report["extra"]:
        print(f"  ⚠️  en la base pero no en la lista oficial (no se borran): {', '.join(report['extra'])}")
    print(f"  sorteo: {report['draw']}")
    for p in report.get("problems") or []:
        print(f"  ⚠️  {p}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="competencia de ensayo (copa-proud-2026-demo)")
    ap.add_argument("--si", action="store_true", help="aplicar sin preguntar (pruebas locales)")
    args = ap.parse_args()
    slug = COPA_PROUD_2026["slug"] + ("-demo" if args.demo else "")
    target = make_url(os.environ["DATABASE_URL"])
    print(f"Base: {target.host} / {target.database} · competencia: {slug}")

    if args.si:
        show(run_once(slug, apply=True), applied=True)
        return
    show(run_once(slug, apply=False), applied=False)
    if sys.stdin.isatty():
        answer = input("\n¿Guardar? Escribí APLICAR y Enter (solo Enter = salir): ")
        if answer.strip().upper() == "APLICAR":
            print()
            show(run_once(slug, apply=True), applied=True)
        else:
            print("No se guardó nada.")


if __name__ == "__main__":
    main()
