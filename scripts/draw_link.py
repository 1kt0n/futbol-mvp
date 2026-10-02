"""
Link privado del PANEL DE PRODUCCIÓN del sorteo en vivo.

  ./.venv/bin/python scripts/draw_link.py --demo     → link para el ensayo (live.copaproud.com/demo/produccion/…)
  ./.venv/bin/python scripts/draw_link.py            → link del sorteo real (live.copaproud.com/produccion/…)

Cada vez que se corre genera un link NUEVO y el anterior deja de funcionar. En la base solo
queda el hash. La pantalla de transmisión no necesita link: es /sorteo (o /demo/sorteo).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402,F401  (pide la URL de la base si no está en el entorno)

from sqlalchemy import text  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402
from app.utils.security import gen_management_token, hash_management_token  # noqa: E402

SITE = os.environ.get("DEMO_SITE_URL", "https://live.copaproud.com")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="link para la competencia de ensayo")
    args = ap.parse_args()
    slug = COPA_PROUD_2026["slug"] + ("-demo" if args.demo else "")
    prefix = "/demo" if args.demo else ""

    token = gen_management_token()
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, settings FROM public.competitions WHERE slug = :s FOR UPDATE"),
                           {"s": slug}).mappings().first()
        if not row:
            sys.exit(f"No existe la competencia {slug}." + (" Creala con demo_competition.py crear." if args.demo else ""))
        settings = row["settings"] if isinstance(row["settings"], dict) else json.loads(row["settings"] or "{}")
        draw = dict(settings.get("live_draw") or {})
        draw["producer_token_hash"] = hash_management_token(token)
        conn.execute(text("""
            UPDATE public.competitions
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{live_draw}', CAST(:d AS jsonb))
            WHERE id = :cid
        """), {"d": json.dumps(draw), "cid": row["id"]})

    print(f"\n✓ Panel de producción ({'DEMO' if args.demo else 'REAL'}) — no lo compartas:")
    print(f"  {SITE}{prefix}/produccion/{token}")
    print("\n  Pantalla de transmisión (para OBS / proyector):")
    print(f"  {SITE}{prefix}/sorteo?tv=1")
    print("  (El link anterior de producción, si había, ya no funciona.)")


if __name__ == "__main__":
    main()
