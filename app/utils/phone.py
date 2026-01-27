import re 

def normalize_phone(raw: str) -> str:
    """
    MVP: normaliza a formato tipo +54911....
    - saca espacios/guiones
    - si empieza con 00 -> lo convierte a +
    - si arranca con 549... -> +549...
    - si arranca con 54... -> +54...
    - si arranca con 11... -> +54911...
    """
    if raw is None:
        return ""

    s = raw.strip()
    if s.startswith("00"):
        s = "+" + s[2:]

    # dejamos solo + y dígitos
    s = re.sub(r"[^\d+]", "", s)

    if s.startswith("+"):
        out = s
    else:
        digits = re.sub(r"\D", "", s)
        if digits.startswith("549"):
            out = "+" + digits
        elif digits.startswith("54"):
            out = "+" + digits
        elif digits.startswith("11"):
            out = "+549" + digits
        else:
            out = "+" + digits

    # guard-rails mínimos
    digits_only = re.sub(r"\D", "", out)
    if len(digits_only) < 8:   # demasiado corto => inválido
        return ""
    return out
