"""
Scoring de jugadores (modernizacion del sistema de puntajes).

Fase 1 (M1/M3/M4): promedio **bayesiano** que tira hacia la media global hasta
acumular votos (evita "4.9 con 1 voto"), minimo de votantes distintos para un
score "firme", y nivel sugerido computado.

Fase 2 (M2): **recencia**. Cada voto pesa segun su antiguedad con decaimiento
exponencial (half-life configurable), y se expone una indicacion de "forma"
(comparando el score reciente-ponderado contra el promedio crudo).

    score = (C * m + Σ wᵢ·rᵢ) / (C + Σ wᵢ)
      wᵢ = 0.5 ^ (edad_dias / HALF_LIFE_DAYS)   (=1 sin recencia)
      m  = media global de todos los ratings
      C  = "votos fantasma" de confianza (peso del prior)

Ver docs/modernizacion-sistema-puntajes.md (M1, M2, M3, M4).
"""

import math

# Peso del prior bayesiano: cuantos "votos fantasma" en la media global hacen
# falta para que el score real empiece a dominar. Mas alto = mas conservador.
CONFIDENCE_PRIOR = 5.0

# Media global por defecto cuando todavia no hay ningun rating en el sistema.
DEFAULT_GLOBAL_MEAN = 3.5

# Votantes DISTINTOS necesarios para mostrar un score "firme" (no "en calibracion").
MIN_DISTINCT_VOTERS = 3

# Recencia (M2): a los HALF_LIFE_DAYS dias, un voto pesa la mitad.
HALF_LIFE_DAYS = 75.0
# Constante de decaimiento por dia para usar en SQL: peso = exp(-RATE * edad_dias).
RECENCY_DECAY_PER_DAY = math.log(2) / HALF_LIFE_DAYS

# "Forma": margen minimo entre score reciente y promedio crudo para marcar tendencia.
FORM_MARGIN = 0.15
FORM_MIN_VOTES = 5

# Umbrales del nivel sugerido (computado), sobre el score bayesiano.
LEVEL_THRESHOLDS = (
    (3.0, "INICIAL"),       # score < 3.0
    (4.2, "RECREATIVO"),    # 3.0 <= score <= 4.2
)
LEVEL_TOP = "COMPETITIVO"   # score > 4.2

# Orden canonico de los 6 atributos para el perfil tipo radar (M5).
ALL_ATTRIBUTES = ("EQUIPO", "VISION", "INTENSIDAD", "DEFENSA", "ATAQUE", "FAIRPLAY")


def attribute_profile(counts_by_code, votes):
    """
    Perfil de 6 ejes para el radar. value = fraccion de votos que marcaron el atributo
    (cada voto elige 2 de 6, asi que value va de 0 a 1).
    counts_by_code: dict {code -> count}. votes: total de votos del jugador.
    """
    v = max(int(votes or 0), 1)
    return [
        {
            "code": code,
            "count": int(counts_by_code.get(code, 0)),
            "value": round(int(counts_by_code.get(code, 0)) / v, 3),
        }
        for code in ALL_ATTRIBUTES
    ]


def bayesian_score(weight_total, weighted_sum, global_mean):
    """Promedio bayesiano (ponderado por recencia). None si no hay peso/votos."""
    wt = float(weight_total or 0)
    if wt <= 0:
        return None
    m = float(global_mean) if global_mean else DEFAULT_GLOBAL_MEAN
    return (CONFIDENCE_PRIOR * m + float(weighted_sum or 0)) / (CONFIDENCE_PRIOR + wt)


def suggested_level(score):
    """Nivel sugerido a partir del score bayesiano (o None)."""
    if score is None:
        return None
    for threshold, level in LEVEL_THRESHOLDS:
        if score < threshold:
            return level
    return LEVEL_TOP


def form_indicator(votes, weighted_avg, simple_avg):
    """'up' | 'down' | 'flat' | None — tendencia reciente vs historico."""
    if votes < FORM_MIN_VOTES or weighted_avg is None or simple_avg is None:
        return None
    diff = float(weighted_avg) - float(simple_avg)
    if diff > FORM_MARGIN:
        return "up"
    if diff < -FORM_MARGIN:
        return "down"
    return "flat"


def score_payload(votes, voters, weighted_sum, weight_total, simple_avg, global_mean):
    """
    Arma el bloque de scoring para las respuestas de la API.

    votes        -> cantidad total de votos (para mostrar "X votos")
    voters       -> votantes distintos (define "en calibracion")
    weighted_sum -> Σ wᵢ·rᵢ (ratings ponderados por recencia)
    weight_total -> Σ wᵢ (suma de pesos de recencia)
    simple_avg   -> promedio crudo (para calcular la "forma")
    global_mean  -> media global del sistema
    """
    votes = int(votes or 0)
    voters = int(voters or 0)
    score = bayesian_score(weight_total, weighted_sum, global_mean)
    calibrating = voters < MIN_DISTINCT_VOTERS
    weighted_avg = (float(weighted_sum) / float(weight_total)) if weight_total else None
    return {
        "score": round(score, 2) if score is not None else None,
        "votes": votes,
        "voters": voters,
        "calibrating": calibrating,
        "min_voters": MIN_DISTINCT_VOTERS,
        "suggested_level": None if (calibrating or score is None) else suggested_level(score),
        "form": None if calibrating else form_indicator(votes, weighted_avg, simple_avg),
    }
