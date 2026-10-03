"""
Competencia DEMO para ensayar con los veedores: `live.copaproud.com/demo`.

Es una competencia aparte (slug `copa-proud-2026-demo`) con el mismo formato que la real,
los 28 equipos con sus escudos, un sorteo al azar HECHO CON EL PROCEDIMIENTO OFICIAL (tandas,
cupo de extranjeros, parejas y regla de salto), planteles de prueba y veedores de prueba con
sus links. El sorteo en vivo queda configurado con las tandas oficiales: para ensayarlo, en el
panel de producción "Reiniciar sorteo" (antes, `reiniciar` si ya hay resultados cargados).
Al recrearla se conservan el link de producción del sorteo y la transmisión (YouTube / hora). Nada de lo que se cargue acá toca el torneo real. Solo opera sobre slugs que
terminan en "-demo".

Veedores POR CANCHA (como en el torneo real): 6 de prueba, "Veedor Demo Cancha N", cada uno con
todos los partidos de su cancha los dos días. Para ponerles los nombres reales sin rehacer la
demo: `veedores_cancha.py renombrar --demo ...` o `veedores_cancha.py crear --demo --archivo ... --reemplazar`.

Uso (pide la URL de la base sin mostrarla, igual que el seed):
  ./.venv/bin/python scripts/demo_competition.py crear  [--fecha 2026-10-04] [--por-equipo N]
      → (re)crea la demo completa con fechas sábado=--fecha (default: hoy) y domingo=día siguiente.
        Genera links NUEVOS para los veedores y los guarda en demo-veedores.csv (+ demo-veedores-qr.png
        si está instalado `qrcode`), con un mensaje listo para mandar por WhatsApp.
        --por-equipo N: modelo anterior, N veedores con equipos a cargo en vez de canchas.
  ./.venv/bin/python scripts/demo_competition.py reiniciar
      → borra SOLO los resultados (goles, tarjetas, estados, cruces del domingo). Equipos,
        veedores y links quedan iguales: se puede volver a ensayar sin reenviar nada.
  ./.venv/bin/python scripts/demo_competition.py borrar
      → elimina la demo entera.
"""
import argparse
import datetime as dt
import json
import os
import random
import sys

# Reusa la resolución de la URL (getpass) y el seed del formato.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402  (pide la URL si no está en el entorno)
import veedores_cancha as vc  # noqa: E402

from sqlalchemy import text  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils import competition_draw as draw_logic  # noqa: E402
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


def _settings(conn) -> dict:
    row = conn.execute(text("SELECT settings FROM public.competitions WHERE slug = :s"), {"s": DEMO_SLUG}).first()
    if not row or not row[0]:
        return {}
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


def sorteo_oficial(teams: list[dict], rng: random.Random) -> list[tuple[str, int]]:
    """Lugar (zona, posición) de cada equipo, sorteado al azar con el procedimiento oficial."""
    sim = [{**t, "id": str(i)} for i, t in enumerate(teams)]
    preset = draw_logic.build_tandas_preset(sim, BASE["draw_procedure"])
    pots, tandas, rules = preset["pots"], preset["tandas"], preset["rules"]
    foreign = {t["id"] for t in sim if draw_logic.is_foreign(t, rules["home_country"])}
    groups = BASE["groups"]
    slots = {g: {p: None for p in range(1, BASE["group_size"] + 1)} for g in groups}
    picks = []
    while True:
        got = draw_logic.digital_tanda_pick(sim, slots, groups, picks, pots, tandas, rng)
        if not got:
            break
        team, ball = got
        n = draw_logic.tanda_of(team["id"], pots)
        res = draw_logic.place_tandas(team, slots, groups, ball=ball, kind=draw_logic.ball_kind(tandas, n),
                                      foreign_ids=foreign, max_foreign=rules["max_foreign"], pairs=rules["pairs"])
        g, p = res["slot"]
        slots[g][p] = team["id"]
        picks.append({"tanda": n, "ball": ball})
    where = {tid: (g, p) for g in groups for p, tid in slots[g].items()}
    return [where[str(i)] for i in range(len(teams))]


def crear(conn, sat: str, rng: random.Random, por_equipo: int | None = None) -> list[dict]:
    sun = (dt.date.fromisoformat(sat) + dt.timedelta(days=1)).isoformat()
    # Lo que se conserva al recrear: el link del panel de producción y la transmisión.
    old = _settings(conn)
    keep_hash = (old.get("live_draw") or {}).get("producer_token_hash")
    keep_broadcast = old.get("broadcast")
    borrar(conn)
    fmt = demo_format(sat, sun)
    seedmod.seed(conn, fmt)
    cid = _comp_id(conn)

    # Equipos reales (con escudo); si faltan para llenar las zonas, "Equipo por confirmar k".
    teams = json.load(open(TEAMS_JSON, encoding="utf-8"))
    n_slots = len(BASE["groups"]) * BASE["group_size"]
    if len(teams) > n_slots:
        sys.exit(f"{TEAMS_JSON} tiene {len(teams)} equipos y las zonas tienen lugar para {n_slots}.")
    teams += [{"name": f"Equipo por confirmar {k}", "country_code": None, "logo_url": None}
              for k in range(1, n_slots - len(teams) + 1)]
    # Sorteo de zonas de la demo con las reglas oficiales; se cargan en orden de zona/posición.
    places = sorteo_oficial(teams, rng)
    order = sorted(range(len(teams)), key=lambda i: places[i])
    teams = [teams[i] for i in order]
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

    if por_equipo:
        links = _veedores_por_equipo(conn, cid, team_ids, teams, por_equipo)
    else:
        # Veedores por cancha (el modelo del torneo): uno por cancha, los dos días.
        ctx = vc.load_context(conn, DEMO_SLUG)
        links = vc.crear_veedores(conn, ctx, vc.placeholder_people(ctx))

    # Sorteo en vivo: tandas oficiales listas (las zonas ya están llenas: para ensayar, reiniciar).
    real_teams = [{"id": str(tid), "name": t["name"], "country_code": t["country_code"]} for tid, t in zip(team_ids, teams)]
    preset = draw_logic.build_tandas_preset(real_teams, BASE["draw_procedure"])
    live_draw = {"status": "IDLE", "picks": [], "mode": "TANDAS", "pots": preset["pots"],
                 "tandas": preset["tandas"], "rules": preset["rules"]}
    if keep_hash:
        live_draw["producer_token_hash"] = keep_hash
    extra = {"live_draw": live_draw, **({"broadcast": keep_broadcast} if keep_broadcast else {})}
    conn.execute(text("""
        UPDATE public.competitions
        SET status = 'PUBLISHED', settings = COALESCE(settings, '{}'::jsonb) || CAST(:extra AS jsonb)
        WHERE id = :cid
    """), {"cid": cid, "extra": json.dumps(extra)})
    comp = svc.get_competition(conn, DEMO_SLUG, for_update=True)
    svc.sync_bracket(conn, comp)  # completa el fixture del sábado con el sorteo
    svc.bump_version(conn, cid)
    return links


def _veedores_por_equipo(conn, cid, team_ids: list, teams: list[dict], n_veedores: int) -> list[dict]:
    """
    Modelo anterior (--por-equipo N): el equipo i (en orden de zona/posición) va al veedor i % n.
    Con 14 veedores, cada uno tiene el equipo k y el k+14: siempre de zonas distintas (A..D vs D..G).
    """
    links = []
    names = {tid: t["name"] for tid, t in zip(team_ids, teams)}
    n_veedores = max(1, min(n_veedores, len(team_ids)))
    for k in range(n_veedores):
        mine = [tid for i, tid in enumerate(team_ids) if i % n_veedores == k]
        token = gen_management_token()
        name = f"Veedor Demo {k + 1:02d}"
        sid = conn.execute(text("""
            INSERT INTO public.competition_staff
              (competition_id, full_name, role, access_token_hash, token_rotated_at)
            VALUES (:cid, :name, 'VEEDOR', :h, now()) RETURNING id
        """), {"cid": cid, "name": name, "h": hash_management_token(token)}).scalar()
        conn.execute(text("""
            UPDATE public.competition_teams SET veedor_staff_id = :sid
            WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"sid": sid, "ids": [str(t) for t in mine]})
        links.append(vc.output_row(name, vc.link_for(token, demo=True), [], [names[t] for t in mine], demo=True))
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
    ap.add_argument("--por-equipo", type=int, metavar="N",
                    help="modelo anterior: N veedores con equipos a cargo (default: uno por cancha)")
    args = ap.parse_args()

    with engine.begin() as conn:
        if args.accion == "crear":
            sat = args.fecha or dt.date.today().isoformat()
            links = crear(conn, sat, random.Random(), por_equipo=args.por_equipo)
        elif args.accion == "reiniciar":
            n = reiniciar(conn)
        else:
            ok = borrar(conn)

    if args.accion == "crear":
        csv_path, png = vc.write_outputs(links, demo=True)
        print(f"\n✓ Demo creada: {SITE}/demo  (sábado {sat}, domingo siguiente)")
        print(f"  {len(links)} veedores de prueba:\n")
        vc.print_rows(links)
        vc.print_outputs(csv_path, png, demo=True)
    elif args.accion == "reiniciar":
        print(f"✓ Resultados de la demo borrados ({n} partidos vuelven a 'programado'). Equipos, veedores y links intactos.")
    else:
        print("✓ Demo eliminada." if ok else "No había demo para borrar.")


if __name__ == "__main__":
    main()
