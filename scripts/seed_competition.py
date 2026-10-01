"""
Seed / re-sync de una competencia desde su formato (`app/utils/competition_formats.py`).

Crea (o actualiza) la competencia, las canchas, los slots vacíos de cada zona y los 75
partidos con horario, cancha y fuentes. Es IDEMPOTENTE: se puede volver a correr cuando la
organización confirme los cruces pendientes; solo reescribe partidos que siguen SCHEDULED
y reporta los que ya empezaron (no los toca). Nunca borra nada.

Uso (requiere haber corrido migrations/018 y 019):
  ./.venv/bin/python scripts/seed_competition.py copa-proud-2026
    → pide la URL de la base (no se muestra), hace la prueba en seco, muestra el resumen y
      pregunta si aplicar (hay que escribir APLICAR). Un solo comando, en una terminal.
  DATABASE_URL=... ./.venv/bin/python scripts/seed_competition.py copa-proud-2026 [--apply]
    → modo no interactivo (dry-run salvo --apply).
"""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Railway entrega la URL como postgresql://… (o postgres://…); la app usa el driver psycopg 3.
_url = os.environ.get("DATABASE_URL", "").strip()
if (not _url or "<" in _url) and sys.stdin.isatty():
    _url = getpass.getpass("Pegá la DATABASE_PUBLIC_URL de Railway (no se va a ver) y apretá Enter: ").strip()
if not _url or "<" in _url:
    sys.exit("Falta DATABASE_URL real (copiá DATABASE_PUBLIC_URL del servicio Postgres en Railway).")
for _prefix in ("postgres://", "postgresql://"):
    if _url.startswith(_prefix):
        _url = "postgresql+psycopg://" + _url[len(_prefix):]
os.environ["DATABASE_URL"] = _url

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402
from app.utils.competition_formats import FORMATS  # noqa: E402


def _scheduled_at(fmt: dict, m: dict) -> str:
    return f"{m['date']}T{m['time']}:00{fmt['utc_offset']}"


def seed(conn, fmt: dict) -> dict:
    report = {"created": False, "venues": 0, "slots": 0, "inserted": [], "updated": [],
              "skipped_started": [], "orphans": []}

    comp = conn.execute(text("SELECT id FROM public.competitions WHERE slug = :slug"),
                        {"slug": fmt["slug"]}).mappings().first()
    if not comp:
        comp = conn.execute(text("""
            INSERT INTO public.competitions (slug, name, format_code, starts_on, ends_on, utc_offset)
            VALUES (:slug, :name, :fc, :s, :e, :off)
            RETURNING id
        """), {"slug": fmt["slug"], "name": fmt["name"], "fc": fmt["slug"],
               "s": fmt["starts_on"], "e": fmt["ends_on"], "off": fmt["utc_offset"]}).mappings().first()
        report["created"] = True
    else:
        conn.execute(text("""
            UPDATE public.competitions
            SET starts_on = :s, ends_on = :e, utc_offset = :off, updated_at = now()
            WHERE id = :cid
        """), {"s": fmt["starts_on"], "e": fmt["ends_on"], "off": fmt["utc_offset"], "cid": comp["id"]})
    cid = comp["id"]

    venue_ids = {}
    for number, name in enumerate(fmt["venues"], start=1):
        row = conn.execute(text("""
            INSERT INTO public.competition_venues (competition_id, number, name)
            VALUES (:cid, :n, :name)
            ON CONFLICT (competition_id, number) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        """), {"cid": cid, "n": number, "name": name}).mappings().first()
        venue_ids[number] = row["id"]
        report["venues"] += 1

    for g in fmt["groups"]:
        for pos in range(1, fmt["group_size"] + 1):
            res = conn.execute(text("""
                INSERT INTO public.competition_group_slots (competition_id, group_code, position)
                VALUES (:cid, :g, :pos)
                ON CONFLICT DO NOTHING
            """), {"cid": cid, "g": g, "pos": pos})
            report["slots"] += res.rowcount

    existing = {r["code"]: r for r in conn.execute(text("""
        SELECT code, status FROM public.competition_matches WHERE competition_id = :cid
    """), {"cid": cid}).mappings().all()}

    params_common = {"cid": cid}
    for m in fmt["matches"]:
        params = {
            **params_common, "code": m["code"], "stage": m["stage"], "cup": m["cup"],
            "g": m["group"], "vid": venue_ids[m["venue"]], "at": _scheduled_at(fmt, m),
            "hs": m["home_source"], "as_": m["away_source"],
        }
        cur = existing.get(m["code"])
        if cur is None:
            conn.execute(text("""
                INSERT INTO public.competition_matches
                  (competition_id, code, stage, cup, group_code, venue_id, scheduled_at, home_source, away_source)
                VALUES (:cid, :code, :stage, :cup, :g, :vid, CAST(:at AS timestamptz), :hs, :as_)
            """), params)
            report["inserted"].append(m["code"])
        elif cur["status"] == "SCHEDULED":
            res = conn.execute(text("""
                UPDATE public.competition_matches
                SET stage = :stage, cup = :cup, group_code = :g, venue_id = :vid,
                    scheduled_at = CAST(:at AS timestamptz), home_source = :hs, away_source = :as_,
                    updated_at = now()
                WHERE competition_id = :cid AND code = :code
                  AND (stage, COALESCE(cup, ''), COALESCE(group_code, ''), venue_id, scheduled_at, home_source, away_source)
                      IS DISTINCT FROM
                      (CAST(:stage AS text), COALESCE(CAST(:cup AS text), ''), COALESCE(CAST(:g AS text), ''),
                       CAST(:vid AS uuid), CAST(:at AS timestamptz), CAST(:hs AS text), CAST(:as_ AS text))
            """), params)
            if res.rowcount:
                report["updated"].append(m["code"])
        else:
            report["skipped_started"].append(m["code"])

    format_codes = {m["code"] for m in fmt["matches"]}
    report["orphans"] = sorted(set(existing) - format_codes)

    comp_row = svc.get_competition(conn, fmt["slug"], for_update=True)
    plan = svc.sync_bracket(conn, comp_row)
    report["bracket_updates"] = len(plan["updates"])
    report["conflicts"] = plan["conflicts"]
    svc.bump_version(conn, cid)
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("format_code", choices=sorted(FORMATS))
    ap.add_argument("--apply", action="store_true", help="escribe en la DB (sin esto: dry-run con rollback)")
    args = ap.parse_args()
    fmt = FORMATS[args.format_code]
    target = make_url(os.environ["DATABASE_URL"])
    print(f"Base: {target.host}:{target.port or 5432} / {target.database} (usuario {target.username})")

    report = run_once(fmt, apply=args.apply)
    print_report(fmt, report, applied=args.apply)
    # Interactivo: tras la prueba en seco, ofrecer aplicar (en una transacción nueva).
    if not args.apply and sys.stdin.isatty():
        answer = input("\n¿Guardar estos cambios en la base? Escribí APLICAR y Enter (solo Enter = salir): ")
        if answer.strip().upper() == "APLICAR":
            report = run_once(fmt, apply=True)
            print()
            print_report(fmt, report, applied=True)
        else:
            print("No se guardó nada.")


def run_once(fmt: dict, *, apply: bool) -> dict:
    conn = engine.connect()
    trans = conn.begin()
    try:
        report = seed(conn, fmt)
        if apply:
            trans.commit()
        else:
            trans.rollback()
    except Exception:
        trans.rollback()
        raise
    finally:
        conn.close()
    return report


def print_report(fmt: dict, report: dict, *, applied: bool) -> None:
    mode = "APLICADO ✓" if applied else "PRUEBA EN SECO (no se guardó nada)"
    print(f"== {fmt['name']} — {mode}")
    print(f"  competencia creada: {report['created']}")
    print(f"  canchas: {report['venues']}  slots nuevos: {report['slots']}")
    print(f"  partidos insertados: {len(report['inserted'])}  actualizados: {len(report['updated'])}")
    if report["updated"]:
        print(f"    actualizados: {', '.join(report['updated'])}")
    if report["skipped_started"]:
        print(f"  ⚠️  ya empezados (no se tocaron): {', '.join(report['skipped_started'])}")
    if report["orphans"]:
        print(f"  ⚠️  en DB pero no en el formato (no se borran): {', '.join(report['orphans'])}")
    print(f"  equipos escritos en partidos: {report['bracket_updates']}  conflictos: {len(report['conflicts'])}")


if __name__ == "__main__":
    main()
