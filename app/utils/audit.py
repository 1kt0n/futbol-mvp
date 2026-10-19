"""
Escritura de event_audit_log con la pantalla de origen (rediseño UX §8.1).

El frontend manda `X-UI-Source` en las escrituras: `match` desde la pantalla del
partido (/p/:id) y `legacy` desde la Home y el Panel. Un middleware lo guarda en
un ContextVar y write_audit() lo suma como `metadata.ui`. Sin header (otras
pantallas o un bundle viejo de la PWA) no se escribe `ui`.
"""

import json
from contextvars import ContextVar

from sqlalchemy import text

UI_SOURCES = frozenset({"match", "legacy"})

_ui_source: ContextVar[str | None] = ContextVar("ui_source", default=None)


def parse_ui_source(raw: str | None) -> str | None:
    value = (raw or "").strip().lower()
    return value if value in UI_SOURCES else None


def set_ui_source(raw: str | None):
    """Devuelve el token para restaurar el valor anterior con reset_ui_source."""
    return _ui_source.set(parse_ui_source(raw))


def reset_ui_source(token) -> None:
    _ui_source.reset(token)


def current_ui_source() -> str | None:
    return _ui_source.get()


def write_audit(conn, *, event_id, actor_user_id, action: str,
                target_registration_id=None, metadata: dict | None = None) -> None:
    """INSERT en event_audit_log. La metadata va con json.dumps (nunca f-strings)."""
    meta = dict(metadata or {})
    ui = current_ui_source()
    if ui and "ui" not in meta:
        meta["ui"] = ui
    conn.execute(text("""
        insert into public.event_audit_log (
          event_id, actor_user_id, action, target_registration_id, metadata
        )
        values (
          :event_id, :actor_user_id, :action, :target_registration_id, CAST(:metadata AS jsonb)
        )
    """), {
        "event_id": event_id,
        "actor_user_id": actor_user_id,
        "action": action,
        "target_registration_id": target_registration_id,
        "metadata": json.dumps(meta, default=str),
    })
