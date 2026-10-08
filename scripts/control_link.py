"""
Link privado de la MESA DE CONTROL (resultados, correcciones, confirmación y cierre de la fase de
grupos), sin login:

  ./.venv/bin/python scripts/control_link.py --demo     → live.copaproud.com/demo/control/…
  ./.venv/bin/python scripts/control_link.py            → live.copaproud.com/control/…

Cada vez que se corre genera un link NUEVO y el anterior deja de funcionar. En la base solo queda el
hash. Quien tenga el link puede cambiar resultados: compartilo solo con la mesa de control.
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


def generar_link(conn, slug: str) -> str:
    token = gen_management_token()
    row = conn.execute(text("SELECT id, settings FROM public.competitions WHERE slug = :s FOR UPDATE"),
                       {"s": slug}).mappings().first()
    if not row:
        sys.exit(f"No existe la competencia {slug}.")
    settings = row["settings"] if isinstance(row["settings"], dict) else json.loads(row["settings"] or "{}")
    control = dict(settings.get("control") or {})
    control["token_hash"] = hash_management_token(token)
    conn.execute(text("""
        UPDATE public.competitions
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{control}', CAST(:c AS jsonb))
        WHERE id = :cid
    """), {"c": json.dumps(control), "cid": row["id"]})
    return token


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", action="store_true", help="link para la competencia de ensayo")
    args = ap.parse_args()
    slug = COPA_PROUD_2026["slug"] + ("-demo" if args.demo else "")
    prefix = "/demo" if args.demo else ""
    with engine.begin() as conn:
        token = generar_link(conn, slug)
    print(f"\n✓ Mesa de control ({'DEMO' if args.demo else 'REAL'}) — no lo compartas fuera de la mesa:")
    print(f"  {SITE}{prefix}/control/{token}")
    print("  (El link anterior, si había, ya no funciona.)")


if __name__ == "__main__":
    main()
