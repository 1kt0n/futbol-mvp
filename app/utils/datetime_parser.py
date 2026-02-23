from datetime import datetime
from zoneinfo import ZoneInfo

APP_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
UTC_TZ = ZoneInfo("UTC")


def parse_client_datetime(value: str | None, field_name: str, required: bool = False) -> datetime | None:
    """
    Parsea datetimes ISO enviados por clientes web/mobile.

    Reglas:
    - Soporta ISO con timezone (ej: 2026-03-13T23:00:00Z).
    - Si viene sin timezone (datetime-local), asume America/Argentina/Buenos_Aires.
    - Devuelve siempre datetime timezone-aware en UTC.
    """
    raw = (value or "").strip()
    if not raw:
        if required:
            raise ValueError(f"El campo {field_name} es obligatorio.")
        return None

    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"Formato invalido para {field_name}. Usa ISO 8601.") from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=APP_TZ)

    return parsed.astimezone(UTC_TZ)
