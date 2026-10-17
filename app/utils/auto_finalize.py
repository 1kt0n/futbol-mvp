"""
Auto-finalizar partidos ya jugados (rediseño UX 0c).

No hay cron: se dispara de forma lazy desde los GET que abre la app (/events/open,
/events/active, /ratings/pending y /notifications). Con AUTO_FINALIZE_ENABLED=false
(default) no hace nada.
"""
import json
import logging
import time

from sqlalchemy import text

from app import settings
from app.settings import engine

logger = logging.getLogger("uvicorn.error")

_LOCK_KEY = "finalize_due_events"
# Como mucho una corrida por minuto y por proceso: /notifications llama además a
# get_pending_ratings, y la app pide varios de estos GET juntos.
_MIN_INTERVAL_SECONDS = 60
_last_run = 0.0


def finalize_due_events(conn, after_minutes: int) -> list[str]:
    """
    Finaliza los eventos OPEN/CLOSED vencidos y devuelve sus ids. Debe llamarse
    dentro de una transacción. Un evento está vencido cuando su inicio, su alta y
    su última reapertura son todos anteriores a now() - after_minutes:
    - "Reactivar" en el admin vuelve a correr el reloj (si no, se re-finalizaría
      en el próximo GET);
    - un evento cargado con fecha pasada no se finaliza mientras lo arman.
    Si otra corrida tiene el lock, no hace nada.
    """
    got_lock = conn.execute(
        text("select pg_try_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": _LOCK_KEY},
    ).scalar()
    if not got_lock:
        return []

    rows = conn.execute(text("""
        with due as (
            select ev.id, ev.status
            from public.events ev
            where ev.status in ('OPEN', 'CLOSED')
              and ev.starts_at < now() - make_interval(mins => CAST(:after_minutes AS int))
              and coalesce(ev.created_at, ev.starts_at) < now() - make_interval(mins => CAST(:after_minutes AS int))
              and not exists (
                  select 1
                  from public.event_audit_log a
                  where a.event_id = ev.id
                    and a.action = 'REOPEN_EVENT'
                    and a.created_at >= now() - make_interval(mins => CAST(:after_minutes AS int))
              )
            for update skip locked
        )
        update public.events e
        set status = 'FINALIZED', finalized_at = now(), updated_at = now()
        from due
        where e.id = due.id
        returning e.id::text as id, due.status as previous_status
    """), {"after_minutes": after_minutes}).mappings().all()

    for r in rows:
        conn.execute(text("""
            insert into public.event_audit_log (event_id, actor_user_id, action, metadata)
            values (:event_id, NULL, 'FINALIZE_EVENT', CAST(:metadata AS jsonb))
        """), {
            "event_id": r["id"],
            "metadata": json.dumps({
                "source": "auto",
                "previous_status": r["previous_status"],
                "after_minutes": after_minutes,
            }),
        })
    return [r["id"] for r in rows]


def auto_finalize_if_due() -> None:
    """
    Hook lazy de los GET. Best-effort: si falla (p. ej. falta la 020 y el audit con
    actor NULL no entra), se deshace la transacción y el GET responde igual.
    """
    global _last_run
    if not settings.AUTO_FINALIZE_ENABLED:
        return
    now = time.monotonic()
    if now - _last_run < _MIN_INTERVAL_SECONDS:
        return
    _last_run = now
    try:
        with engine.begin() as conn:
            finalized = finalize_due_events(conn, settings.AUTO_FINALIZE_AFTER_MINUTES)
        if finalized:
            logger.info("auto-finalize: %d evento(s) finalizado(s): %s", len(finalized), ", ".join(finalized))
    except Exception:
        logger.exception("auto-finalize falló; se reintenta en la próxima corrida")
