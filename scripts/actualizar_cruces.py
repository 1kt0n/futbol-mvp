"""
Aplica a una competencia YA CREADA (y ya sorteada) los cambios del formato
(app/utils/competition_formats.py) SIN tocar la fase de grupos:

  1. Renumera las canchas (columna 1..6 de la grilla → 9, 10, 11, 13, 14, 15). Cada cancha conserva
     su identidad: sus partidos y sus veedores no cambian, solo el número que se muestra.
  2. Reescribe las fuentes de los cruces eliminatorios que cambiaron (solo partidos sin empezar).

  ./.venv/bin/python scripts/actualizar_cruces.py --demo     → competencia de ensayo
  ./.venv/bin/python scripts/actualizar_cruces.py            → torneo real

Muestra todo en una prueba en seco y pide escribir APLICAR. Se NIEGA (y no guarda nada) si algún
partido de la fase de grupos fuera a cambiar en cualquier dato (equipos, horario, cancha). Pide la
URL de la base. Idempotente: correrlo de nuevo no cambia nada.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402  (pide la URL de la base si no está en el entorno)

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402

FIELDS = ("venue_id", "scheduled_at", "home_source", "away_source", "home_team_id", "away_team_id", "status")


class Abort(Exception):
    pass


def fuente(src: str) -> str:
    kind, *rest = (src or "").split(":")
    if kind == "GROUP":
        return f"{rest[1]}° Zona {rest[0]}"
    if kind == "THIRD":
        return f"{rest[0]}° mejor 3°"
    if kind == "FOURTH":
        return f"{rest[0]}° mejor 4°"
    if kind in ("WINNER", "LOSER"):
        return f"{'Ganador' if kind == 'WINNER' else 'Perdedor'} {rest[0]}"
    if kind == "SLOT":
        return f"Zona {rest[0]} · Eq. {rest[1]}"
    return src


def formato(comp: dict) -> dict:
    if not comp["slug"].endswith("-demo"):
        return COPA_PROUD_2026
    import demo_competition  # mismo formato con las fechas de la demo
    return demo_competition.demo_format(comp["starts_on"].isoformat(), comp["ends_on"].isoformat())


def partidos(conn, cid) -> dict:
    rows = conn.execute(text(f"""
        SELECT m.code, m.stage, v.number AS venue, {", ".join("m." + f for f in FIELDS)}
        FROM public.competition_matches m LEFT JOIN public.competition_venues v ON v.id = m.venue_id
        WHERE m.competition_id = :cid
    """), {"cid": cid}).mappings().all()
    return {r["code"]: dict(r) for r in rows}


def renumerar(conn, cid, fmt: dict) -> list[tuple[int, int]]:
    """Canchas existentes (en orden) → números del formato. Devuelve [(antes, después)] si cambia algo."""
    targets = fmt.get("venue_numbers") or list(range(1, len(fmt["venues"]) + 1))
    rows = conn.execute(text("""
        SELECT id, number FROM public.competition_venues WHERE competition_id = :cid ORDER BY number
    """), {"cid": cid}).mappings().all()
    if [r["number"] for r in rows] == targets:
        return []
    if len(rows) != len(targets):
        raise Abort(f"La competencia tiene {len(rows)} canchas y el formato {len(targets)}: no las renumero.")
    # Dos pasos (números negativos de paso) para no chocar con la restricción de número único.
    for i, r in enumerate(rows):
        conn.execute(text("UPDATE public.competition_venues SET number = :n WHERE id = :id"), {"n": -1 - i, "id": r["id"]})
    for r, n, name in zip(rows, targets, fmt["venues"]):
        conn.execute(text("UPDATE public.competition_venues SET number = :n, name = :name WHERE id = :id"),
                     {"n": n, "name": name, "id": r["id"]})
    return [(r["number"], n) for r, n in zip(rows, targets)]


def correr(slug: str, *, apply: bool) -> dict:
    conn = engine.connect()
    trans = conn.begin()
    try:
        comp = conn.execute(text("""
            SELECT id, slug, name, starts_on, ends_on FROM public.competitions WHERE slug = :s FOR UPDATE
        """), {"s": slug}).mappings().first()
        if not comp:
            raise Abort(f"No existe la competencia {slug}.")
        fmt = formato(comp)
        antes = partidos(conn, comp["id"])
        canchas = renumerar(conn, comp["id"], fmt)
        report = seedmod.seed(conn, fmt)
        despues = partidos(conn, comp["id"])

        grupos = [c for c, m in antes.items() if m["stage"] == "GROUP"
                  and any(m[f] != despues[c][f] for f in FIELDS)]
        if grupos:
            raise Abort(f"Cambiarían partidos de la fase de grupos ({', '.join(sorted(grupos))}): no se guarda nada.")
        if report["inserted"]:
            raise Abort(f"Aparecerían partidos nuevos ({', '.join(report['inserted'])}): no se guarda nada.")
        cambios = []
        for code, m in sorted(antes.items()):
            d = despues[code]
            if (m["home_source"], m["away_source"]) != (d["home_source"], d["away_source"]):
                cambios.append((code, m, d))
        out = {"comp": comp, "canchas": canchas, "cambios": cambios,
               "empezados": report["skipped_started"], "conflictos": report["conflicts"]}
        trans.commit() if apply else trans.rollback()
        return out
    except Exception:
        trans.rollback()
        raise
    finally:
        conn.close()


def mostrar(r: dict, applied: bool) -> None:
    print(f"== {'APLICADO ✓' if applied else 'PRUEBA EN SECO (no se guardó nada)'} · {r['comp']['name']}")
    if r["canchas"]:
        print("  Canchas: " + " · ".join(f"{a} → {b}" for a, b in r["canchas"]))
    else:
        print("  Canchas: ya estaban numeradas 9, 10, 11, 13, 14, 15")
    if r["cambios"]:
        print(f"  Cruces que cambian ({len(r['cambios'])}):")
        for code, a, d in r["cambios"]:
            print(f"    {code:<10} {fuente(a['home_source'])} vs {fuente(a['away_source'])}")
            print(f"    {'':<10} → {fuente(d['home_source'])} vs {fuente(d['away_source'])}")
    else:
        print("  Cruces: sin cambios")
    print("  Fase de grupos (sábado): sin cambios ✓")
    if r["empezados"]:
        print(f"  ⚠️  ya empezados, no se tocaron: {', '.join(r['empezados'])}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="competencia de ensayo (copa-proud-2026-demo)")
    ap.add_argument("--si", action="store_true", help="aplicar sin preguntar (pruebas locales)")
    args = ap.parse_args()
    slug = COPA_PROUD_2026["slug"] + ("-demo" if args.demo else "")
    target = make_url(os.environ["DATABASE_URL"])
    print(f"Base: {target.host} / {target.database} · competencia: {slug}\n")
    try:
        mostrar(correr(slug, apply=False), applied=False)
        if not args.si:
            if not sys.stdin.isatty() or input("\n¿Guardar? Escribí APLICAR y Enter: ").strip().upper() != "APLICAR":
                print("No se guardó nada.")
                return
        print()
        mostrar(correr(slug, apply=True), applied=True)
    except Abort as e:
        sys.exit(f"✗ {e}")


if __name__ == "__main__":
    main()
