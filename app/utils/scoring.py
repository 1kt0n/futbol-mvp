"""
Scoring de jugadores (Fase 1 de la modernizacion del sistema de puntajes).

Reemplaza el promedio aritmetico simple por un **promedio bayesiano** que tira
hacia la media global hasta acumular suficientes votos, evitando el caso
"4.9 con 1 voto". Tambien define el minimo de votantes distintos para considerar
un score "firme" y el nivel sugerido computado.

    score = (C * m + sum_ratings) / (C + n)

      m = media global de todos los ratings
      C = "votos fantasma" de confianza (peso del prior)
      n = cantidad de votos del jugador

Ver docs/modernizacion-sistema-puntajes.md (M1, M3, M4).
"""

# Peso del prior bayesiano: cuantos "votos fantasma" en la media global hacen
# falta para que el score real empiece a dominar. Mas alto = mas conservador.
CONFIDENCE_PRIOR = 5.0

# Media global por defecto cuando todavia no hay ningun rating en el sistema.
DEFAULT_GLOBAL_MEAN = 3.5

# Votantes DISTINTOS necesarios para mostrar un score "firme" (no "en calibracion").
MIN_DISTINCT_VOTERS = 3

# Umbrales del nivel sugerido (computado), sobre el score bayesiano.
LEVEL_THRESHOLDS = (
    (3.0, "INICIAL"),       # score < 3.0
    (4.2, "RECREATIVO"),    # 3.0 <= score <= 4.2
)
LEVEL_TOP = "COMPETITIVO"   # score > 4.2


def bayesian_score(n, sum_rating, global_mean):
    """Promedio bayesiano. Devuelve None si no hay votos."""
    if not n or n <= 0:
        return None
    m = float(global_mean) if global_mean else DEFAULT_GLOBAL_MEAN
    return (CONFIDENCE_PRIOR * m + float(sum_rating)) / (CONFIDENCE_PRIOR + n)


def suggested_level(score):
    """Nivel sugerido a partir del score bayesiano (o None)."""
    if score is None:
        return None
    for threshold, level in LEVEL_THRESHOLDS:
        if score < threshold:
            return level
    return LEVEL_TOP


def score_payload(n, voters, sum_rating, global_mean):
    """
    Arma el bloque de scoring para las respuestas de la API.

    n            -> cantidad de votos
    voters       -> votantes distintos
    sum_rating   -> suma de los ratings
    global_mean  -> media global del sistema
    """
    n = int(n or 0)
    voters = int(voters or 0)
    score = bayesian_score(n, sum_rating or 0, global_mean)
    calibrating = voters < MIN_DISTINCT_VOTERS
    return {
        "score": round(score, 2) if score is not None else None,
        "votes": n,
        "voters": voters,
        "calibrating": calibrating,
        "min_voters": MIN_DISTINCT_VOTERS,
        # El nivel sugerido solo se expone cuando el score ya es firme.
        "suggested_level": None if (calibrating or score is None) else suggested_level(score),
    }
