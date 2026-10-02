"""
Competencia DEMO para ensayar con los veedores: `live.copaproud.com/demo`.

Es una competencia aparte (slug `copa-proud-2026-demo`) con el mismo formato que la real,
los 28 equipos con sus escudos, sorteo al azar, planteles de prueba y veedores de prueba con
sus links. Nada de lo que se cargue acá toca el torneo real. Solo opera sobre slugs que
terminan en "-demo".

Uso (pide la URL de la base sin mostrarla, igual que el seed):
  ./.venv/bin/python scripts/demo_competition.py crear  [--fecha 2026-10-04] [--veedores 14]
      → (re)crea la demo completa con fechas sábado=--fecha (default: hoy) y domingo=día siguiente.
        Genera links NUEVOS para los veedores y los guarda en demo-veedores.csv.
  ./.venv/bin/python scripts/demo_competition.py reiniciar
      → borra SOLO los resultados (goles, tarjetas, estados, cruces del domingo). Equipos,
        veedores y links quedan iguales: se puede volver a ensayar sin reenviar nada.
  ./.venv/bin/python scripts/demo_competition.py borrar
      → elimina la demo entera.
"""
import argparse
import csv
import datetime as dt
import json
import os
import random
import sys

# Reusa la resolución de la URL (getpass) y el seed del formato.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402  (pide la URL si no está en el entorno)

from sqlalchemy import text  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_service as svc  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402
from app.utils.security import gen_management_token, hash_management_token  # noqa: E402

BASE = COPA_PROUD_2026
DEMO_SLUG = f"{BASE['slug']}-demo"
SITE = os.environ.get("DEMO_SITE_URL", "https://live.copaproud.com")
TEAMS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "copa_proud_teams.json")


def demo_format(sat: str, sun: str) -> dict:
    """El formato real con otras fechas, otro slug y otro nombre (mismo format_code)."""
    date_map = {BASE["starts_on"]: sat, BASE["ends_on"]: sun}
    fmt = dict(BASE)
    fmt.update(slug=DEMO_SLUG, format_code=BASE["slug"], name=f"{BASE['name']} · DEMO",
               starts_on=sat, ends_on=sun)
    fmt["matches"] = [{**m, "date": date_map[m["date"]]} for m in BASE["matches"]]
    return fmt


def _comp_id(conn):
    row = conn.execute(text("SELECT id FROM public.competitions WHERE slug = :s"), {"s": DEMO_SLUG}).first()
    return row[0] if row else None


def borrar(conn) -> bool:
    assert DEMO_SLUG.endswith("-demo")
    return conn.execute(text("DELETE FROM public.competitions WHERE slug = :s"), {"s": DEMO_SLUG}).rowcount > 0


def crear(conn, sat: str, n_veedores: int, rng: random.Random) -> list[dict]:
    sun = (dt.date.fromisoformat(sat) + dt.timedelta(days=1)).isoformat()
    borrar(conn)
    fmt = demo_format(sat, sun)
    seedmod.seed(conn, fmt)
    cid = _comp_id(conn)

    # Equipos reales (con escudo) + los 2 que faltan confirmar
    teams = json.load(open(TEAMS_JSON, encoding="utf-8"))
    teams += [{"name": f"Equipo por confirmar {k}", "country_code": None, "logo_url": None} for k in (1, 2)]
    rng.shuffle(teams)  # sorteo de zonas de la demo
    team_ids = []
    for i, t in enumerate(teams):
        tid = conn.execute(text("""
            INSERT INTO public.competition_teams (competition_id, name, country_code, logo_url)
            VALUES (:cid, :name, :cc, :logo) RETURNING id
        """), {"cid": cid, "name": t["name"], "cc": t["country_code"], "logo": t["logo_url"]}).scalar()
        team_ids.append(tid)
        group, pos = BASE["groups"][i // 4], i % 4 + 1
        conn.execute(text("""
            UPDATE public.competition_group_slots SET team_id = :tid
            WHERE competition_id = :cid AND group_code = :g AND position = :p
        """), {"tid": tid, "cid": cid, "g": group, "p": pos})
        # Plantel de prueba: 10 jugadores (#1 arquero, #2 capitán)
        for n in range(1, 11):
            conn.execute(text("""
                INSERT INTO public.competition_players
                  (competition_id, team_id, full_name, shirt_number, is_captain, is_goalkeeper)
                VALUES (:cid, :tid, :name, :n, :cap, :gk)
            """), {"cid": cid, "tid": tid, "name": f"Jugador {n}", "n": n, "cap": n == 2, "gk": n == 1})

    # Veedores de prueba: el equipo i (en orden de zona/posición) va al veedor i % n. Con 14
    # veedores, cada uno tiene el equipo k y el k+14: siempre de zonas distintas (A..D vs D..G).
    links = []
    names = {tid: t["name"] for tid, t in zip(team_ids, teams)}
    n_veedores = max(1, min(n_veedores, len(team_ids)))
    for k in range(n_veedores):
        mine = [tid for i, tid in enumerate(team_ids) if i % n_veedores == k]
        token = gen_management_token()
        sid = conn.execute(text("""
            INSERT INTO public.competition_staff
              (competition_id, full_name, role, access_token_hash, token_rotated_at)
            VALUES (:cid, :name, 'VEEDOR', :h, now()) RETURNING id
        """), {"cid": cid, "name": f"Veedor Demo {k + 1:02d}", "h": hash_management_token(token)}).scalar()
        conn.execute(text("""
            UPDATE public.competition_teams SET veedor_staff_id = :sid
            WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"sid": sid, "ids": [str(t) for t in mine]})
        links.append({"veedor": f"Veedor Demo {k + 1:02d}", "equipos": " · ".join(names[t] for t in mine),
                      "link": f"{SITE}/demo/v/{token}"})

    conn.execute(text("UPDATE public.competitions SET status = 'PUBLISHED' WHERE id = :cid"), {"cid": cid})
    comp = svc.get_competition(conn, DEMO_SLUG, for_update=True)
    svc.sync_bracket(conn, comp)  # completa el fixture del sábado con el sorteo
    svc.bump_version(conn, cid)
    return links


def reiniciar(conn) -> int:
    cid = _comp_id(conn)
    if not cid:
        sys.exit("No hay demo creada. Corré primero: demo_competition.py crear")
    conn.execute(text("DELETE FROM public.competition_match_events WHERE competition_id = :cid"), {"cid": cid})
    conn.execute(text("DELETE FROM public.competition_draws WHERE competition_id = :cid"), {"cid": cid})
    n = conn.execute(text("""
        UPDATE public.competition_matches
        SET status = 'SCHEDULED', home_goals = NULL, away_goals = NULL, home_pens = NULL, away_pens = NULL,
            started_at = NULL, ended_at = NULL, confirmed_at = NULL, confirmed_by_user_id = NULL,
            home_team_id = CASE WHEN stage = 'GROUP' THEN home_team_id END,
            away_team_id = CASE WHEN stage = 'GROUP' THEN away_team_id END,
            updated_at = now()
        WHERE competition_id = :cid
    """), {"cid": cid}).rowcount
    conn.execute(text("""
        UPDATE public.competitions SET status = 'PUBLISHED', group_stage_closed_at = NULL,
               group_stage_closed_by = NULL WHERE id = :cid
    """), {"cid": cid})
    svc.bump_version(conn, cid)
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["crear", "reiniciar", "borrar"])
    ap.add_argument("--fecha", help="día del 'sábado' de la demo (YYYY-MM-DD); default: hoy")
    ap.add_argument("--veedores", type=int, default=14)
    args = ap.parse_args()

    with engine.begin() as conn:
        if args.accion == "crear":
            sat = args.fecha or dt.date.today().isoformat()
            links = crear(conn, sat, args.veedores, random.Random())
        elif args.accion == "reiniciar":
            n = reiniciar(conn)
        else:
            ok = borrar(conn)

    if args.accion == "crear":
        out = os.path.abspath("demo-veedores.csv")
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["veedor", "equipos", "link"])
            w.writeheader()
            w.writerows(links)
        print(f"\n✓ Demo creada: {SITE}/demo  (sábado {sat}, domingo siguiente)")
        print(f"  {len(links)} veedores de prueba. Links guardados en: {out}\n")
        for row in links:
            print(f"  {row['veedor']}  ←  {row['equipos']}\n     {row['link']}")
    elif args.accion == "reiniciar":
        print(f"✓ Resultados de la demo borrados ({n} partidos vuelven a 'programado'). Equipos, veedores y links intactos.")
    else:
        print("✓ Demo eliminada." if ok else "No había demo para borrar.")


if __name__ == "__main__":
    main()
