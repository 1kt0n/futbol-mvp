"""
Deja el SORTEO REAL listo en producción (copa-proud-2026), igual que la demo, en un solo paso:

  1. Carga los 28 equipos oficiales con sus escudos y el procedimiento oficial del sorteo
     (tandas, cupo de extranjeros, parejas) — muestra qué cambia y pide escribir APLICAR.
  2. Genera el link PRIVADO del panel de producción del sorteo real (si ya había uno, pregunta
     antes de reemplazarlo: el anterior deja de funcionar).
  3. Imprime todos los links ordenados por computadora y los guarda en links-produccion.txt
     (en la raíz del repo; no se sube a git porque tiene el link privado).

  ./.venv/bin/python scripts/preparar_sorteo_real.py

Pide la URL de la base una sola vez (no se muestra). No toca la demo. Se puede volver a correr:
los equipos se actualizan sin duplicar y el sorteo no se toca si ya salió algún equipo.
"""
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_competition as seedmod  # noqa: E402,F401  (pide la URL de la base una vez)
import draw_link  # noqa: E402
import equipos_oficiales as eq  # noqa: E402

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.settings import engine  # noqa: E402
from app.utils.competition_formats import COPA_PROUD_2026  # noqa: E402

SLUG = COPA_PROUD_2026["slug"]
SITE = os.environ.get("DEMO_SITE_URL", "https://live.copaproud.com")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "links-produccion.txt")


def ask(prompt: str) -> str:
    return input(prompt).strip() if sys.stdin.isatty() else ""


def estado(conn) -> dict:
    row = conn.execute(text("SELECT status, settings FROM public.competitions WHERE slug = :s"), {"s": SLUG}).mappings().first()
    if not row:
        sys.exit(f"No existe la competencia {SLUG}: corré primero scripts/seed_competition.py {SLUG}.")
    settings = row["settings"] if isinstance(row["settings"], dict) else json.loads(row["settings"] or "{}")
    draw = settings.get("live_draw") or {}
    n_teams = conn.execute(text("""
        SELECT count(*) FROM public.competition_teams t JOIN public.competitions c ON c.id = t.competition_id
        WHERE c.slug = :s
    """), {"s": SLUG}).scalar()
    return {"status": row["status"], "draw": draw, "teams": n_teams}


def previous_panel() -> str | None:
    """El link del panel que quedó en links-produccion.txt de una corrida anterior (si hay)."""
    try:
        m = re.search(r"https?://\S+/produccion/[A-Za-z0-9_-]{20,}", open(OUT, encoding="utf-8").read())
        return m.group(0) if m else None
    except OSError:
        return None


def links_text(token: str | None) -> str:
    panel = (f"{SITE}/produccion/{token}" if token
             else previous_panel() or "(no se generó en esta corrida: usá el que ya tenían)")
    when = dt.datetime.now().strftime("%d/%m %H:%M")
    return f"""COPA PROUD SUDAMERICANA 2026 · SORTEO EN VIVO · PRODUCCIÓN
Martes 6/10, 22:15 (ARG) · generado {when}

── SECRETO: solo quien opera el sorteo (computadora 2) ──────────────
Panel de producción:   {panel}

── Computadora 2 · proyector (segunda pantalla, Chrome a pantalla completa) ──
Antes del sorteo:      {SITE}/obs/espera
Durante el sorteo:     {SITE}/obs/tablero
Al final:              {SITE}/obs/cierre
Si hay una pausa:      {SITE}/obs/pausa

── Computadora 1 · OBS ──────────────────────────────────────────────
Escenas (con miniaturas):  {SITE}/obs
Armar OBS para el show real (colección de escenas aparte de la del ensayo):
  node copa-proud-web/obs/setup-obs.mjs --coleccion "Copa Proud - Prod" --conductor "Nombre del conductor"

── Público ──────────────────────────────────────────────────────────
Pestaña Sorteo (video + zonas en vivo):  {SITE}/sorteo
Sitio del torneo:                        {SITE}

── Antes de salir al aire ───────────────────────────────────────────
1. En el panel de producción → "Transmisión": pegar el link del vivo PÚBLICO de YouTube → Guardar.
2. Revisar que el video aparezca en {SITE}/sorteo.
3. NO tocar "Iniciar sorteo" hasta que el conductor diga "¡Empezamos!".
"""


def main():
    target = make_url(os.environ["DATABASE_URL"])
    print(f"Base: {target.host} / {target.database} · competencia REAL: {SLUG}\n")

    with engine.connect() as conn:
        st = estado(conn)
    print(f"Estado actual: {st['status']} · {st['teams']} equipos · sorteo {st['draw'].get('status', 'IDLE')}"
          f" ({len(st['draw'].get('picks') or [])} sorteados) · panel de producción "
          f"{'YA TIENE link' if st['draw'].get('producer_token_hash') else 'sin link'}\n")

    # 1. Equipos + procedimiento oficial
    print("── 1/3 · Equipos oficiales y procedimiento del sorteo")
    eq.show(eq.run_once(SLUG, apply=False), applied=False)
    if ask("\n¿Guardar? Escribí APLICAR y Enter (solo Enter = no tocar los equipos): ").upper() == "APLICAR":
        print()
        eq.show(eq.run_once(SLUG, apply=True), applied=True)
    else:
        print("Equipos sin cambios.")

    # 2. Link del panel de producción
    print("\n── 2/3 · Link privado del panel de producción")
    token = None
    if st["draw"].get("producer_token_hash"):
        if ask("Ya hay un link del panel real. ¿Generar uno NUEVO? El anterior deja de funcionar [s/N]: ").lower() in ("s", "si", "sí"):
            with engine.begin() as conn:
                token = draw_link.generar_link(conn, SLUG)
        else:
            print("Se mantiene el link que ya tenían.")
    else:
        with engine.begin() as conn:
            token = draw_link.generar_link(conn, SLUG)

    # 3. Links ordenados
    body = links_text(token)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(OUT, 0o600)
    print("\n── 3/3 · Links de producción\n")
    print(body)
    print(f"(Guardado en {OUT} — tiene el link privado: no lo publiques ni lo subas a git.)")


if __name__ == "__main__":
    main()
