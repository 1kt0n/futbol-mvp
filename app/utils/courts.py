"""
Reglas de canchas para el "Me anoto" de un toque (rediseño UX 1a).

- Orden: (sort_order, created_at, id), el mismo de /events/active.
- Pseudo-canchas: canchas que el organizador armó como lista de espera a mano
  ("sala de espera", "suplentes", "cancha suplente - sujeta a disp", §9.4). No
  entran en la "primera libre": la espera real es la de la app. Las canchas con
  nombre de equipo ("equipo blanco") sí son canchas: tienen jugadores de verdad.
"""

import re

_PSEUDO_RE = re.compile(r"\b(espera|suplente|reserva|banco)", re.IGNORECASE)


def is_pseudo_court(name: str | None) -> bool:
    return bool(_PSEUDO_RE.search(name or ""))


def eligible_courts(courts: list) -> list:
    """Las canchas que cuentan para asignar: sin pseudo, salvo que no haya otras."""
    real = [c for c in courts if not is_pseudo_court(c["name"])]
    return real if real else list(courts)


def pick_first_free(courts: list, occupied: dict, prefer_court_id=None):
    """
    Primera cancha abierta con lugar entre las elegibles, en el orden recibido
    (que tiene que ser (sort_order, created_at, id)). `occupied` va de court_id
    (str) a CONFIRMED. `prefer_court_id` se prueba primero (la cancha de quien
    invita). Devuelve la fila o None.
    """
    candidates = [c for c in eligible_courts(courts) if c["is_open"]]

    def has_space(c):
        return occupied.get(str(c["id"]), 0) < c["capacity"]

    if prefer_court_id:
        for c in candidates:
            if str(c["id"]) == str(prefer_court_id) and has_space(c):
                return c
    return next((c for c in candidates if has_space(c)), None)


def alternatives(courts: list, occupied: dict, exclude_court_id=None) -> list[dict]:
    """Canchas abiertas con lugar para el 409 COURT_FULL: primero las que no son pseudo."""
    out = []
    for c in courts:
        if str(c["id"]) == str(exclude_court_id) or not c["is_open"]:
            continue
        available = c["capacity"] - occupied.get(str(c["id"]), 0)
        if available > 0:
            out.append({
                "court_id": str(c["id"]),
                "name": c["name"],
                "available": available,
                "is_pseudo": is_pseudo_court(c["name"]),
            })
    # sorted es estable: dentro de cada grupo se mantiene el orden de las canchas.
    return sorted(out, key=lambda a: a["is_pseudo"])
