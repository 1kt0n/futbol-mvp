"""
Escenario de prueba en la DEMO: la regla de intercambio de los octavos de BRONCE.

Regla (planilla "Cronograma.xlsx" de la organización, 2026-10-08):
  · Octavo 1: 4°A vs 7° mejor 3°.  Octavo 2: 4°B vs 4°G.
  · Si el 7° mejor 3° es de la Zona A (le tocaría el 4° de su propia zona), se intercambia con el
    4°G: queda Octavo 1 = 4°A vs 4°G y Octavo 2 = 4°B vs 7° mejor 3°.

Qué hace (SOLO en la demo, `copa-proud-2026-demo`; el torneo real no se toca nunca):
  1. Borra los resultados de la demo (igual que "Reiniciar TODO", pero deja el sorteo como está).
  2. Carga por base 41 de los 42 partidos del sábado, ya terminados y confirmados, para que:
       - en cada zona salga 1° > 2° > 3° > 4° sin empates;
       - los terceros de B..G queden ordenados por diferencia de gol (G, F, E, D, C, B: el de la
         Zona B es el más flojo, con diferencia 0);
       - en la Zona A el 3° y el 4° todavía no jugaron entre ellos.
  3. Deja ESE partido (3° vs 4° de la Zona A) sin jugar, para que lo cargues vos (veedor o mesa):
       - el 3° de A gana 1 a 0 → queda 7° mejor 3° (diferencia −1) → SE INTERCAMBIA;
       - el 3° de A gana 3 a 0 → queda 6° (diferencia +1, arriba del de B) → el 7° es el 3° de B →
         NO se intercambia (caso de control).
  4. Después: mesa de control → Zonas y cierre → Revisar → Cerrar fase de grupos, y mirar los
     octavos de Bronce.

Por defecto en la Zona A queda el escenario que se reportó: 1° Sobra Noche, 2° 3F, 3° Alianza Rio FC,
4° Rayos.cba II (si están en esa zona; si no, el orden del sorteo). Se cambian con --tercero/--cuarto.

Uso (pide la URL de la base sin mostrarla, igual que los demás scripts):
  ./.venv/bin/python scripts/escenario_bronce.py            → muestra el plan y pide APLICAR
  ./.venv/bin/python scripts/escenario_bronce.py --si       → sin preguntar
  ./.venv/bin/python scripts/escenario_bronce.py --tercero "Alianza Rio FC" --cuarto "Rayos.cba II"
Se puede correr las veces que haga falta: siempre vuelve al mismo punto de partida.
"""
import argparse
import datetime as dt
import os
import sys

os.environ.setdefault("PGCONNECT_TIMEOUT", "20")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition  # noqa: E402,F401  (pide la URL de la base si no está en el entorno)

from sqlalchemy import text  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402

DEMO_SLUG = "copa-proud-2026-demo"
ZONA = "A"
DEFAULT_A = ["Sobra Noche", "3F", "Alianza Rio FC", "Rayos.cba II"]  # 1°, 2°, 3°, 4° del escenario reportado
# Margen con que el 3° le gana al 4° en cada zona (el 3° pierde 1-0 con el 1° y con el 2°):
# diferencia de gol del 3° = margen − 2  →  G +6, F +5, E +4, D +3, C +2, B 0. Distintos: sin sorteos.
MARGEN_TERCERO = {"B": 2, "C": 4, "D": 5, "E": 6, "F": 7, "G": 8}
# Resultados fijos entre puestos (ganador, perdedor) → goles.
SCORE = {(1, 2): (2, 1), (1, 3): (1, 0), (1, 4): (3, 0), (2, 3): (1, 0), (2, 4): (2, 0)}


def orden_zona(teams_by_pos: dict, names: dict, g: str, tercero: str | None, cuarto: str | None) -> list[str]:
    """team_ids de la zona en el orden en que tienen que terminar (1°..4°)."""
    ids = [teams_by_pos[p] for p in sorted(teams_by_pos)]
    if g != ZONA:
        return ids
    by_name = {names[t].lower(): t for t in ids}
    wanted = [tercero, cuarto] if tercero or cuarto else DEFAULT_A[2:]
    if tercero or cuarto:
        if not (tercero and cuarto):
            sys.exit("--tercero y --cuarto van juntos.")
        missing = [n for n in wanted if n.lower() not in by_name]
        if missing:
            sys.exit(f"No están en la Zona {ZONA}: {', '.join(missing)}. Equipos: {', '.join(names[t] for t in ids)}")
        resto = [t for t in ids if t not in (by_name[tercero.lower()], by_name[cuarto.lower()])]
        return resto + [by_name[tercero.lower()], by_name[cuarto.lower()]]
    if all(n.lower() in by_name for n in DEFAULT_A):
        return [by_name[n.lower()] for n in DEFAULT_A]
    return ids  # otra demo: el orden del sorteo


def plan(conn, cid, tercero, cuarto) -> dict:
    names = {str(r["id"]): r["name"] for r in conn.execute(text(
        "SELECT id, name FROM public.competition_teams WHERE competition_id = :cid"), {"cid": cid}).mappings()}
    slots: dict = {}
    for r in conn.execute(text("""
        SELECT group_code, position, team_id FROM public.competition_group_slots WHERE competition_id = :cid
    """), {"cid": cid}).mappings():
        if not r["team_id"]:
            sys.exit("La demo no tiene el sorteo completo: hacé el sorteo antes (panel de producción).")
        slots.setdefault(r["group_code"], {})[int(r["position"])] = str(r["team_id"])
    finish = {g: orden_zona(slots[g], names, g, tercero, cuarto) for g in sorted(slots)}
    puesto = {t: i + 1 for g in finish for i, t in enumerate(finish[g])}

    results, pendiente = [], None
    for m in conn.execute(text("""
        SELECT code, group_code, home_source, away_source FROM public.competition_matches
        WHERE competition_id = :cid AND stage = 'GROUP' ORDER BY scheduled_at, code
    """), {"cid": cid}).mappings():
        g = m["group_code"]
        home = slots[g][int(m["home_source"].split(":")[2])]
        away = slots[g][int(m["away_source"].split(":")[2])]
        ph, pa = puesto[home], puesto[away]
        if g == ZONA and {ph, pa} == {3, 4}:
            pendiente = {"code": m["code"], "home": names[home], "away": names[away], "tercero_es_local": ph == 3}
            continue
        win, lose = (home, away) if ph < pa else (away, home)
        key = (min(ph, pa), max(ph, pa))
        gw, gl = SCORE.get(key) or (MARGEN_TERCERO[g], 0)  # (3, 4) fuera de la Zona A
        hg, ag = (gw, gl) if win == home else (gl, gw)
        results.append({"code": m["code"], "hg": hg, "ag": ag, "home": names[home], "away": names[away]})
    return {"finish": finish, "names": names, "results": results, "pendiente": pendiente}


def aplicar(conn, cid, p: dict) -> None:
    svc.reset_all_results(conn, cid)
    comp = svc.get_competition(conn, DEMO_SLUG, for_update=True)
    svc.sync_bracket(conn, comp)  # equipos del sábado desde las zonas
    now = dt.datetime.now(dt.timezone.utc)
    for r in p["results"]:
        conn.execute(text("""
            UPDATE public.competition_matches
            SET status = 'FINISHED', home_goals = :hg, away_goals = :ag,
                started_at = COALESCE(scheduled_at, :now), ended_at = COALESCE(scheduled_at, :now) + interval '22 minutes',
                confirmed_at = :now, updated_at = :now
            WHERE competition_id = :cid AND code = :code
        """), {"hg": r["hg"], "ag": r["ag"], "now": now, "cid": cid, "code": r["code"]})
    conn.execute(text("UPDATE public.competitions SET status = 'LIVE' WHERE id = :cid"), {"cid": cid})
    comp = svc.get_competition(conn, DEMO_SLUG, for_update=True)
    svc.sync_bracket(conn, comp)
    svc.audit(conn, cid, "DEMO_SCENARIO", metadata={"escenario": "bronce-7mo-tercero", "pendiente": p["pendiente"]["code"]})
    svc.bump_version(conn, cid)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tercero", help=f"equipo que termina 3° en la Zona {ZONA} (default: Alianza Rio FC)")
    ap.add_argument("--cuarto", help=f"equipo que termina 4° en la Zona {ZONA} (default: Rayos.cba II)")
    ap.add_argument("--si", action="store_true", help="no pedir APLICAR")
    args = ap.parse_args()

    # Primero el plan, sin tomar la competencia: mientras se espera el APLICAR, los veedores y la
    # mesa de la demo siguen pudiendo cargar.
    with engine.connect() as conn:
        comp = svc.get_competition(conn, DEMO_SLUG)
        if not comp["slug"].endswith("-demo"):
            sys.exit("Solo para la demo.")
        p = plan(conn, comp["id"], args.tercero, args.cuarto)
    if not p["pendiente"]:
        sys.exit("No encontré el partido 3° vs 4° de la Zona A.")
    n = p["names"]
    print(f"== Escenario Bronce · {comp['name']}")
    print("  Borra TODOS los resultados de la demo (deja el sorteo, equipos, planteles y veedores) y carga:")
    for g, ids in p["finish"].items():
        extra = "  ← el 3° y el 4° no jugaron entre ellos" if g == ZONA else ""
        print(f"    Zona {g}: " + " · ".join(f"{i + 1}° {n[t]}" for i, t in enumerate(ids)) + extra)
    print(f"  {len(p['results'])} partidos terminados y confirmados; queda 1 sin jugar.")
    if not args.si:
        if input("\n¿Guardar? Escribí APLICAR y Enter: ").strip() != "APLICAR":
            print("No se guardó nada.")
            raise SystemExit(0)
    print("  aplicando…", flush=True)
    with engine.begin() as conn:
        comp = svc.lock_competition(conn, DEMO_SLUG)
        p = plan(conn, comp["id"], args.tercero, args.cuarto)  # de nuevo, ya con la competencia tomada
        aplicar(conn, comp["id"], p)

    pend = p["pendiente"]
    t3 = pend["home"] if pend["tercero_es_local"] else pend["away"]
    t4 = pend["away"] if pend["tercero_es_local"] else pend["home"]
    gana = lambda k: f"{pend['home']} {k if pend['tercero_es_local'] else 0} – {0 if pend['tercero_es_local'] else k} {pend['away']}"  # noqa: E731
    g4 = n[p["finish"]["G"][3]]
    b4 = n[p["finish"]["B"][3]]
    a4 = t4
    b3 = n[p["finish"]["B"][2]]
    print("\n✓ Listo. Ahora cargá vos el partido que falta (como veedor, o en la mesa → Guardar resultado final):")
    print(f"    {pend['code']}: {pend['home']} vs {pend['away']}")
    print(f"\n  A) CON intercambio → {gana(1)}  ({t3} queda 7° mejor 3°, es de la Zona A)")
    print(f"       Bronce Octavo 1: {a4} vs {g4}")
    print(f"       Bronce Octavo 2: {b4} vs {t3}")
    print(f"  B) SIN intercambio (control) → {gana(3)}  (el 7° mejor 3° pasa a ser {b3}, de la Zona B)")
    print(f"       Bronce Octavo 1: {a4} vs {b3}")
    print(f"       Bronce Octavo 2: {b4} vs {g4}")
    print("\n  Después: mesa de control → Zonas y cierre → Revisar → Cerrar fase de grupos.")
    print("  Para repetir la prueba: volvé a correr este script.")


if __name__ == "__main__":
    main()
