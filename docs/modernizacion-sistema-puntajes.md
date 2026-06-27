# Modernización del sistema de puntajes

> Documento de análisis y propuesta. Objetivo del sistema (según la propia UI):
> **"armar partidos más parejos y divertidos"**. Todo lo que sigue se ordena
> alrededor de ese norte: que el puntaje sea **justo**, **difícil de inflar** y
> **útil para balancear equipos**.

---

## 1. Cómo funciona hoy (baseline)

- **Voto:** después de un evento **FINALIZADO**, cada jugador puede puntuar a sus
  compañeros **de la misma cancha** con **1–5 estrellas (pasos de 0.5)** + elegir
  **exactamente 2 atributos** de 6 (Equipo, Visión, Intensidad, Defensa, Ataque, Fair Play).
  Opcionalmente un comentario. Ventana de **7 días**. Todo gateado por `ranking_opt_in`.
  → `migrations/002_player_ratings.sql`, `migrations/007_ranking_opt_in_attributes.sql`, `app/routers/ratings.py`
- **Score del jugador:** **promedio aritmético simple** de todas sus estrellas
  (`AVG(rating)`), más el conteo de votos. → `app/routers/ratings.py:434`
- **Atributos:** se cuentan crudos (cuántas veces le marcaron cada uno) y se muestran
  los top. → `app/routers/ratings.py:470`
- **Nivel:** `player_level` (INICIAL/RECREATIVO/COMPETITIVO) es **autodeclarado**, no
  se calcula con los votos. → `Profile.jsx`
- **Dónde se ve:** tarjeta de jugador (`App.jsx`) y perfil propio (`Profile.jsx`).

**Único anti-abuso hoy:** no podés auto-votarte (constraint en DB) y 1 voto por
votante→objetivo por cancha.

---

## 2. Problemas del modelo actual

| # | Problema | Consecuencia |
|---|----------|--------------|
| P1 | **Promedio simple sin confianza** | "4.9 ⭐ con 1 voto" pesa igual que "4.2 con 80 votos". Ranking injusto. |
| P2 | **Sin recencia** | Un voto de hace un año vale igual que uno de ayer. No refleja el "momento" del jugador. |
| P3 | **Inflación recíproca** | A↔B se inflan mutuamente. No hay detección ni amortiguación. |
| P4 | **Todos los votantes pesan igual** | El voto de alguien con 2 partidos vale igual que el de un referente. |
| P5 | **Atributos solo se cuentan** | No se ponderan por la nota ni se muestran como perfil (radar). Poco accionable. |
| P6 | **Nivel autodeclarado** | Cualquiera se pone COMPETITIVO. No refleja la realidad. |
| P7 | **No hay ranking/leaderboard** | No se puede comparar ni motivar. |
| P8 | **No se usa para balancear equipos** | El dato existe pero el armado de canchas es manual. **Es la oportunidad más grande.** |
| P9 | **Moderación incompleta** | `is_hidden` existe pero no hay UI para reportar/ocultar comentarios. |
| P10 | **Engagement bajo** | Votar 7 jugadores con estrellas+2 atributos es fricción. Pocos completan. |

---

## 3. Mejoras propuestas

Ordenadas por **impacto / esfuerzo**. Cada una es independiente: se pueden hacer de a una.

### 🟢 Quick wins (poco esfuerzo, alto impacto)

#### M1 — Score bayesiano (confianza) — *resuelve P1*
Reemplazar el `AVG` simple por un **promedio bayesiano** que "tira" hacia la media
global hasta que haya suficientes votos:

```
score = (C * m + Σ(ratings)) / (C + n)
   m = media global de todos los ratings (ej. 3.8)
   C = "votos fantasma" de confianza (ej. 5)
   n = cantidad de votos reales del jugador
```

Así "1 voto de 5★" da ~3.95 (no 5.0), y converge al promedio real a medida que
suman votos. Es un cambio chico en la query de `app/routers/ratings.py:434` + mostrar
un badge **"provisional"** mientras `n < C`.

#### M2 — Recencia / "forma" — *resuelve P2*
Ponderar por antigüedad con decaimiento exponencial (half-life ~60–90 días) y mostrar
una mini-tendencia ("forma": últimos N partidos ↑/↓). Cambio acotado en la agregación.

#### M3 — Mínimo de votantes distintos + ocultar score bajo muestra
No mostrar score "firme" hasta `n >= 3` votantes **distintos**; antes, mostrar
"En calibración". Evita rankings basura y da un objetivo ("te faltan 2 votos").

#### M4 — Nivel sugerido (computado) — *resuelve P6*
Mantener el autodeclarado, pero **mostrar al lado un nivel sugerido** derivado del
score bayesiano (ej. <3.0 Inicial, 3.0–4.2 Recreativo, >4.2 Competitivo). No fuerza
nada, pero alinea expectativas.

### 🟡 Medianas (esfuerzo medio, alto valor)

#### M5 — Perfil de atributos como radar — *resuelve P5*
Pasar de "lista de tags contados" a un **perfil normalizado de 6 ejes** (Equipo,
Visión, Intensidad, Defensa, Ataque, Fair Play) renderizado como **gráfico radar**
en la tarjeta del jugador. Cada eje = % de votos que mencionaron ese atributo
(ponderado por la nota). Es el cambio visual que más "moderniza" la sensación.

#### M6 — Leaderboard / ranking — *resuelve P7*
Endpoint `GET /rankings` (respetando `opt_in` y `n >= 3`) + pantalla con **tiers/divisiones**
(Top 10%, etc.) y filtros (general, por atributo: "mejores en Defensa"). Motiva participación.

#### M7 — MVP del partido (voto liviano) — *resuelve P10*
Además del rating completo, un voto **rápido de 1 toque**: "¿Quién fue el MVP?" al
finalizar. Mucho menos fricción → más participación, y alimenta un contador de MVPs
(gamificación). Se apoya en la tabla de ratings o una tabla nueva chica.

#### M8 — Anti-inflación recíproca — *resuelve P3, P4*
- **Amortiguar reciprocidad:** si A y B se votan mutuamente muy alto de forma
  sistemática, bajar el peso de ese par.
- **Peso por confiabilidad del votante:** el voto de un jugador con buen historial
  y muchos partidos pesa un poco más (PageRank-lite / EigenTrust simplificado).
- **Cap por votante repetido** y detección de outliers (un voto que se aleja mucho
  del consenso pesa menos).

### 🔴 Grandes (más esfuerzo, máximo impacto)

#### M9 — ⭐ Balanceador automático de equipos — *resuelve P8 (el norte del producto)*
Usar score + atributos para **sugerir canchas/equipos parejos** al armar un evento:
repartir jugadores minimizando la diferencia de fuerza total y equilibrando perfiles
(que no queden todos los "Ataque" en una cancha). Algoritmo: snake draft por score,
o un balanceo greedy/optimización. Esto convierte el sistema de puntajes de
"vanidad" a **herramienta operativa real** y cierra el loop con la promesa del producto.

#### M10 — Gamificación (badges, logros, rachas)
Medallas por atributo ("Muralla" = top en Defensa, racha de Fair Play), niveles de
participación, progreso visible. Sube engagement y retención. Se apoya en M5/M7.

#### M11 — Moderación de feedback — *resuelve P9*
UI para **reportar** un comentario y cola de moderación que usa el `is_hidden` ya
existente. Importante para que el sistema sea sano y la gente se anime a participar.

---

## 4. Roadmap sugerido por fases

| Fase | Incluye | Por qué primero |
|------|---------|-----------------|
| **Fase 1 — Justicia del score** | M1 (bayesiano), M3 (mín. votantes), M4 (nivel sugerido) | Arregla la base: que el número sea **creíble**. Bajo esfuerzo. |
| **Fase 2 — Experiencia** | M5 (radar), M2 (recencia/forma), M7 (MVP 1-toque) | Moderniza la UI y sube participación. |
| **Fase 3 — Competencia** | M6 (leaderboard + tiers), M10 (gamificación) | Una vez que el score es justo y hay datos, motivar. |
| **Fase 4 — Núcleo del producto** | M9 (balanceador automático) | Es el mayor valor; necesita scores confiables (Fase 1) para funcionar bien. |
| **Transversal** | M8 (anti-abuso), M11 (moderación) | Acompañan a medida que crece el uso. |

---

## 5. Notas técnicas

- **Cambios de schema mínimos para Fase 1:** ninguno obligatorio (M1/M2/M3 son cambios
  de query/agregación). Para guardar el score computado y no recalcular en cada lectura,
  conviene una **vista materializada** o tabla `player_scores` (refrescada al cerrar
  evento o por cron) — recomendable junto con M6.
- **Reutilizar lo que ya existe:**
  - Agregación de rating: `app/routers/ratings.py:434` (cambiar el `AVG` por bayesiano).
  - Agregación de atributos: `app/routers/ratings.py:470` (base para el radar M5).
  - Tarjeta de jugador: `futbol-mvp-web/src/App.jsx` (acá va el radar y el badge de confianza).
  - El sistema de **notificaciones** ya existente sirve para los recordatorios de votar (M7/engagement).
- **Privacidad:** mantener `ranking_opt_in` como gate en todo lo nuevo (leaderboard,
  balanceador, radar).
- **Anti-abuso (M8):** empezar simple (mín. votantes distintos + cap por par recíproco)
  antes de meter pesos por confiabilidad, que requiere iteración.

---

## 6. Recomendación

Arrancar por **Fase 1 (M1 + M3 + M4)**: es poco código, no toca el schema y de inmediato
hace que el puntaje sea **justo y creíble** — condición necesaria para todo lo demás
(sin un score confiable, el leaderboard y el balanceador heredan la basura). Después
**M5 (radar)** por el golpe visual, y apuntar a **M9 (balanceador)** como el feature
estrella que cumple la promesa "partidos más parejos".
