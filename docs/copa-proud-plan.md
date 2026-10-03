# Plan — Copa Proud Sudamericana 2026 (módulo `competitions` + sitio público)

> **Estado:** APROBADO 2026-09-30. **Backend COMPLETO y verificado** (ver §10). Falta: frontend (sitio público + modo veedor + tab mesa central) y deploy. Migración 018 aún NO corrida en Railway.
> **Basado en:** Reglamento (borrador), Cronograma (PDF, 2 págs.) y el código en `main` al 2026-09-30 (`ac4aba8`).
> **Fecha dura:** el torneo es el **sáb 10 y dom 11 de octubre**. Hoy es 30/09, así que quedan **10 días**.

## 0. Contexto

Copa Proud es un torneo internacional de fútbol 5:

- 28 equipos, 7 zonas de 4 y 6 canchas.
- Sábado: 42 partidos de grupos.
- Domingo: 33 partidos eliminatorios, repartidos en 3 copas (Oro 15, Plata 7, Bronce 11). En total son **75 partidos**.

Se busca un **sitio público con marca y dominio propios**, separado de la app a nivel host pero usando el mismo motor y la misma DB. Tiene que mostrar:

- equipos, zonas y tablas
- fixture con horario, cancha y veedor
- resultados en vivo y llaves
- planteles y estadísticas, completos pero **opcionales**

Hay dos formas de cargar resultados que conviven: el **veedor desde el celular** y la **mesa central**, que corrige y confirma. Idiomas: **ES, PT y EN**.

## 1. Alternativas analizadas

| # | Opción | A favor | En contra | Veredicto |
|---|---|---|---|---|
| A | Ruta pública dentro de la app actual (`/copa-proud`) | Lo más rápido; reusa todo | Misma marca, PWA y dominio que la app. Va contra "algo aparte" | ❌ |
| B | **Frontend nuevo en su propio dominio + mismo backend y DB (módulo nuevo)** | Marca y dominio propios. El tráfico estático queda aislado. Reusa auth, permisos, patrones públicos y deploy | El pico de tráfico pega en la API compartida, así que hace falta caché | ✅ **Recomendada** |
| C | Backend y DB separados (fork del motor) | Aislamiento total | Código duplicado y doble mantenimiento; no llega en 10 días | ❌ |
| D | Sitio 100% estático (JSON snapshot o SSG) | Escala infinito | Sin veedores ni tiempo real, y la carga queda afuera | Solo como **idea de caché** dentro de B |
| E | Plataforma de terceros (Copa Fácil, Challonge, Sheets+Glide) | Inmediato | No soporta 3 copas con mejores terceros, no hay marca propia y los datos no son nuestros | ❌ Plan Z |

### ¿Por qué un módulo nuevo y no extender "Torneos"?

El módulo actual (`migrations/009`–`010`, `app/routers/tournaments_admin.py`) está pensado para torneos chicos internos:

- Tiene un tope de 16 equipos y 4 grupos (`schemas.py:250`, `GROUPS_PLAYOFFS_CONFIG` L24).
- Permite **un solo partido LIVE** por torneo (L1180), y el sábado se juegan 6 en paralelo.
- No modela canchas, horarios, veedores, goles por jugador, tarjetas, penales, varias llaves por torneo ni mejores terceros.
- Los miembros de los equipos están atados a `users` de la app.
- Los desempates no incluyen fair play ni sorteo.

Adaptarlo significa tocar una feature que está en uso a 10 días del evento. Por eso conviene un **módulo nuevo `competitions`**, aditivo y sin tocar `tournaments`, que reuse los patrones que ya funcionan:

- `require_permission` (`app/utils/permissions.py`)
- token hasheado estilo `management_token` (`app/utils/security.py:80`)
- router público con rate limit (`app/routers/events_public.py`)
- polling de `TournamentPublicDataProvider.jsx`
- design tokens (`src/design/tokens.css`)

## 2. Arquitectura recomendada

```
copaproud.<dominio>        ──►  Railway servicio #2 "copa-proud-web" (Vite estático + SPA fallback)
   (sitio público ES/PT/EN,        │  fetch cross-origin (CORS)
    modo veedor por link)          ▼
api.copaproud.<dominio> ─┐  Railway servicio #1 actual (FastAPI, single worker)
futbol-mvp...railway.app ─┘   ├─ /public/competitions/{slug}         (snapshot cacheado + ETag)
                              ├─ /public/competitions/staff/{token}/… (modo veedor)
                              └─ /admin/competitions/…              (mesa central, login + permisos)
                                     ▼
                              Postgres actual (tablas competition_*)
app actual /admin ──► tab nuevo "Competencias" (mesa central: equipos, sorteo, veedores, corrección)
```

- **Repo:** el frontend nuevo vive en la carpeta `copa-proud-web/` del mismo repo (monorepo) y se despliega como un segundo servicio de Railway con root dir propio, con auto-deploy igual que hoy. No importa nada de `futbol-mvp-web/App.jsx`, que tiene 1674 líneas y mucho acoplamiento; los tokens de diseño se copian.
- **Stack:** Vite, React 19, react-router, Tailwind (el mismo stack que ya conocen) y un i18n liviano con diccionario ES/PT/EN. **Sin service worker**, para no repetir el bug de versión vieja cacheada (`822d846`).
- **Dominio:** `copaproud.xxx` apunta al servicio #2 y `api.copaproud.xxx` al servicio #1 (Railway admite varios custom domains). El orden de CORS es el siguiente:
  1. Agregar el origen a `CORS_ORIGINS`.
  2. Sumar el header nuevo `X-Staff-Token` a `allow_headers` en `app/main.py:58`.
  3. Opcional: poner Cloudflare como proxy DNS para tener una CDN gratis.
- **Performance:**
  - El sitio público consume **un solo endpoint snapshot** (unos 75 partidos, 28 equipos y planteles, más o menos 20 KB con gzip).
  - Ese endpoint usa un micro-caché en proceso de unos 5 s, invalidado con un `version` que sube en cada escritura, más `ETag` → 304. Como uvicorn corre con un solo worker (`Dockerfile:34`), el caché es coherente.
  - Se agrega `GZipMiddleware`.
  - El polling es cada 15 s cuando hay partidos en vivo y cada 60 s el resto del tiempo.
  - Con 3000 espectadores eso da unos 150 req/s, casi todos 304 servidos desde memoria.

## 3. Modelo de datos: migración `018_competitions.sql` (aditiva)

| Tabla | Clave |
|---|---|
| `competitions` | `slug`, nombre, fechas, estado (DRAFT/PUBLISHED/LIVE/FINISHED), `settings` JSONB (puntos 3/1/0, pesos fair play 1/3), `data_version` |
| `competition_teams` | nombre, país (bandera), ciudad, logo_url, color, `draw_rank` (desempate por sorteo) |
| `competition_players` *(opcional)* | team_id, nombre, dorsal, es_capitán, es_arquero. **No** se vinculan con `users` |
| `competition_groups` + `competition_group_slots` | zonas A–G; el slot (zona, posición 1–4) apunta a un team_id que se asigna **después del sorteo** |
| `competition_venues` | Cancha 1–6 |
| `competition_staff` + token hasheado | veedores y árbitros (nombre, rol, contacto cifrado reutilizando `contact_crypto.py`) |
| `competition_matches` | `code` (`A-1v2`, `ORO-O1`, `PLATA-C3`…), `cup` (NULL/ORO/PLATA/BRONCE), `stage` (GROUP/R16/QF/SF/F), `venue_id`, `scheduled_at`, `home/away_source` (ver §4), `home/away_team_id`, goles, **penales**, `status` (SCHEDULED/LIVE/HALFTIME/FINISHED/WALKOVER), `veedor_id`, `referee_name`, `confirmed_at/by` |
| `competition_match_events` *(opcional)* | GOAL / OWN_GOAL / YELLOW / RED, `team_id`, **`player_id` nullable** (así el detalle es opcional), minuto, `client_event_id` UNIQUE (idempotencia para reintentos del veedor), origen VEEDOR/ADMIN |
| `competition_audit_log` | quién cambió qué (JSONB, con los casts ya aprendidos de `af7bbce`) |

Permisos nuevos: `competitions.manage` y `competitions.results`, asignados a admin (super_admin ya pasa como comodín).

**El cronograma completo se carga desde un script de seed** (`scripts/seed_copa_proud.py`), no con un editor de UI. Crea zonas, canchas y los 75 partidos con horario, cancha y *fuentes*. El sitio puede publicarse **antes del sorteo** mostrando "Zona A · Eq. 1 vs Eq. 2".

## 4. Motor de competencia (`app/utils/competition_engine.py`, puro y testeable)

1. **Tabla por zona:** Pts → DG → GF → Fair Play (Amarilla 1, Roja 3, el menor gana) → `draw_rank` (sorteo cargado a mano). El walkover cuenta 3-0.
2. **Tabla de terceros y cuartos** entre zonas, con los mismos criterios.
3. **Resolución de fuentes** para cada slot eliminatorio:
   - `GROUP:A:1`
   - `THIRD:1` (ranking de terceros)
   - `FOURTH:C`
   - `WINNER:ORO-O1`
   - `LOSER:ORO-O1`
   - Ganador por goles o, si hay empate, por penales.
4. **"Cerrar fase de grupos"** es una acción **explícita de la mesa central**, no automática:
   - Calcula las tablas.
   - Si hay empate que requiere sorteo, **bloquea** y pide cargar `draw_rank`.
   - Muestra la vista previa de cruces y, al confirmar, puebla el domingo.
   - Los ganadores y perdedores del domingo avanzan al finalizar cada partido, y se puede revertir mientras el siguiente no haya empezado.
5. **Stats** (si hay eventos con jugador): goleador y valla menos vencida (**solo fase de grupos**, regla 7.9) y fair play.

## 5. API

- **Público** (sin login, con rate limit):
  - `GET /public/competitions/{slug}` devuelve el snapshot completo, con caché + ETag.
- **Veedor** (link `copaproud.xxx/v/<token>`, token hasheado y revocable, acotado a sus partidos asignados):
  - `GET …/staff/{token}` → mis partidos
  - `POST …/matches/{code}/status` → iniciar, entretiempo o finalizar
  - `POST …/matches/{code}/events` → gol o tarjeta; el jugador es opcional y se identifica por dorsal
  - `DELETE …/events/{id}` → deshacer
  - `POST …/penalties`
- **Mesa central** (`/admin/competitions/…`, login PIN + permisos):
  - CRUD de equipos y planteles, con **import CSV** de listas de buena fe
  - asignar el sorteo a slots
  - veedores: generar o rotar el link y asignarlos a partidos
  - editar cualquier resultado o evento
  - confirmar el partido (✓ "resultado oficial" contra la planilla firmada)
  - cerrar la fase de grupos
  - marcar walkover

## 6. Frontend

**Sitio público (`copa-proud-web/`)**, mobile-first, con selector de idioma:

- **Inicio:** "En juego ahora" por cancha, próximos partidos y últimos resultados.
- **Fixture:** grilla horario × cancha igual a la del PDF y vista de lista; filtro por día, cancha o equipo. Cada partido muestra horario, cancha, veedor, estado y resultado.
- **Zonas:** las 7 tablas más la **tabla de mejores terceros**, con la zona de clasificación coloreada (Oro/Bronce).
- **Copas:** llaves de Oro, Plata y Bronce, con placeholders ("1°A", "Perdedor Oct. Oro 3") hasta que se resuelven.
- **Equipo:** país/bandera, plantel (si está cargado) y sus partidos.
- **Estadísticas** (si hay datos): goleadores, valla menos vencida y fair play.
- **Reglamento y sedes.** El texto se traduce como contenido; también se puede linkear un PDF por idioma.
- *(nice-to-have)* Modo TV para pantallas en el predio.

**Modo veedor** (`/v/:token`, dentro del mismo sitio):

- Lista de sus partidos y una pantalla del partido con botones grandes: ⚽ Gol (equipo → dorsal opcional), 🟨, 🟥, iniciar/entretiempo/fin y penales si el partido eliminatorio termina empatado.
- Cola local de reintentos con `client_event_id`, porque en las canchas puede haber mala señal.

**Mesa central:** un tab nuevo "Competencias" en `AdminPanel.jsx` de la app actual, que reusa login y permisos.

## 7. Definiciones pendientes con la organización

**Estas bloquean la carga del seed, así que hay que cerrarlas cuanto antes:**

1. **Error en el cronograma:** sábado 13:30, Cancha 6 dice "Eq. 2 vs 3 (Zona E)", pero ese cruce se repite a las 16:40 y a la Zona E le falta **"2 vs 4"**. Lo más probable es que 13:30 sea 2 vs 4.
2. **Octavos de Oro 1–4 ambiguos:** Oct 1 y Oct 3 dicen los dos "Mejor 3°/2°G", y Oct 2 y Oct 4 dicen los dos "2° Mejor 3°/2°F". Falta definir quién enfrenta a quién entre 2°F, 2°G, el 1° mejor tercero y el 2° mejor tercero. También hay que definir qué pasa si un mejor tercero cae contra el 1° de su propia zona.
3. **Octavos de Bronce 1–4:** no hay cruces definidos para el 7° mejor tercero + los 7 cuartos.
4. **Cuartos de Bronce C3/C4** ("Clasificado Directo A/B"): hay 4 equipos directos (3°–6° mejores terceros) y falta definir cómo se cruzan (¿3° vs 6° y 4° vs 5°?).
5. **Cruces de cuartos, semis y finales** de cada copa (¿Cuartos Oro 1 = ganador Oct 1 vs ganador Oct 2?). No están escritos; se asume que son secuenciales.
6. **Reglamento 5.2:** el tercer punto dice "Partido empatado: o puntos" y debería decir "Partido perdido: 0 puntos". Además falta el 5.3.
7. **Suspensiones** (6.4: una roja = al menos 1 fecha) y **elegibilidad** (4.2: jugó al menos 1 partido de grupos). ¿El sistema las muestra o las controla? Propuesta: solo **mostrar** los suspendidos en v1.

## 8. Cronograma (10 días) y alcance

| Días | Entregable |
|---|---|
| 30/09–01/10 | Cerrar §7 con la organización. Comprar y configurar el dominio. Escribir el plan detallado en `docs/copa-proud-plan.md` (estilo de los planes de iteraciones anteriores). |
| 01–03/10 | Backend: migración 018, motor + tests, seed, endpoint snapshot, admin y veedor. **Correr la migración a mano en Railway** (como siempre). |
| 02–06/10 | Sitio público (ES/PT/EN) + modo veedor + tab de mesa central. Deploy del servicio #2 + dominio + CORS. |
| 07–08/10 | **Simulacro completo:** un script simula los 75 partidos (empates, sorteo, penales, walkover). Prueba de carga. Capacitación de veedores con sus links. |
| 09/10 | Freeze. Cargar equipos y planteles reales y el sorteo. Publicar el link. |
| 10–11/10 | Torneo. La mesa central monitorea y confirma. |

**MVP innegociable:**

- fixture, zonas, terceros, llaves y equipo
- ES/PT/EN
- carga por la mesa central y cierre de la fase de grupos

**Si hay tiempo:**

- planteles y estadísticas completas
- modo TV
- imágenes OG para compartir

**Plan B:** si el modo veedor no llega estable al 08/10, se carga solo desde la mesa central y el sitio público funciona igual, con unos minutos de demora.

## 9. Verificación

- Tests del motor (estilo autónomo de `tests/test_*.py`):
  - tablas con los 5 criterios
  - ranking de terceros
  - resolución de las 33 fuentes
  - penales
  - walkover
  - reversión
- Script de simulación end-to-end contra una DB local: seed → sorteo → 42 resultados → cierre → 33 resultados. Verificar que las 3 finales queden con equipos correctos y que ningún equipo aparezca dos veces.
- Pruebas manuales en el browser:
  - sitio en móvil a 375px en los 3 idiomas
  - modo veedor con red lenta y cortes (reintentos sin duplicar)
  - una corrección desde la mesa que se refleja en el sitio en menos de 20 s
- Carga con `hey`/`k6` contra el snapshot: alrededor de 150 req/s sostenidos, con la app principal respondiendo normal.

## 10. Estado de ejecución (2026-09-30)

**Backend terminado** (sin commitear todavía):

| Pieza | Archivo |
|---|---|
| Formato como datos (75 partidos, fuentes, supuestos ⚠️ marcados) | `app/utils/competition_formats.py` |
| Motor puro (tablas, terceros, fuentes, cierre, propagación, stats) | `app/utils/competition_engine.py` |
| Servicio (I/O, lock por competencia, snapshot + caché gzip/ETag) | `app/utils/competition_service.py` |
| API pública + modo veedor (`X-Staff-Token`) | `app/routers/competitions_public.py` |
| Mesa central (`/admin/competitions/...`) | `app/routers/competitions_admin.py` |
| Migración aditiva | `migrations/018_competitions.sql` |
| Seed idempotente (dry-run por defecto) | `scripts/seed_competition.py` |
| Schemas | `app/schemas.py` (sección COMPETITIONS) |
| `main.py` | routers montados, `X-Staff-Token` en CORS, `GZipMiddleware` |

**Verificación:**
- `tests/test_competition_engine.py`: 23 tests + simulación de 200 torneos (sorteos, swaps, W.O., penales).
- `tests/e2e_competition_sim.py`: torneo completo por HTTP contra Postgres local (~680 verificaciones, 9 semillas OK): permisos, veedor por cancha, idempotencia de reintentos, confirmación que bloquea al veedor, penales obligatorios, corrección con re-propagación, sorteo de desempate, cierre de fase.
- Migración 018 corrida sobre schema equivalente a prod (001→017) + re-ejecución idempotente.
- Carga contra uvicorn (1 worker, como prod): **~570 req/s** sostenidos, p95 27 ms; snapshot 110 KB → 16 KB gzip.

**Decisiones tomadas en la implementación:**
- Rate limit del veedor **por veedor** (no por IP) y del snapshot público alto (6000/min/IP): en el predio todos salen por la misma IP del WiFi.
- Marcador: el veedor lo mueve con eventos de gol (±1); la mesa central puede fijarlo directo (`/result` o PATCH) y el admin ve `goal_detail_mismatch` si no coincide con los eventos.
- Un partido **confirmado** bloquea al veedor; la mesa central desconfirma para editar.

**Cómo levantar la base local de prueba:**
```
brew install postgresql@17   # ya instalado
initdb -D <dir> -U postgres -A trust && LC_ALL=en_US.UTF-8 pg_ctl -D <dir> -o "-p 55432 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" start
# aplicar migrations/001..018 (en base nueva: roles.id debe ser smallint como en prod, ver 012)
COMPETITION_E2E_DB=1 DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/futbol_test ./.venv/bin/python tests/e2e_competition_sim.py
```

**Deploy del backend (cuando se apruebe):** 1) correr `018` a mano en Railway; 2) push (auto-deploy); 3) `DATABASE_URL=<prod> python scripts/seed_competition.py copa-proud-2026` (dry-run) y luego `--apply`. Todo es aditivo: sin la migración, la app actual no se ve afectada salvo que se llame a los endpoints nuevos.

## 11. Hosting real (relevado 2026-09-30)

- `copaproud.com` ya existe: **WordPress en Hostinger** (tema Hello Elementor, CDN Hostinger en `www`, mail en Hostinger).
- Registrador: Wild West Domains. **DNS administrado en Hostinger** (NS `aurora/nebula.dns-parking.com`) → todos los registros se cargan en hPanel.
- Sin registros CAA (Let's Encrypt de Railway no tiene trabas). Sin comodín `*` (los subdominios están libres).

**Decisión:** NO se toca la raíz ni `www` (sigue el WordPress). El sitio del torneo vive en un **subdominio**:

| Registro en Hostinger | Tipo | Apunta a | Cuándo |
|---|---|---|---|
| `api` | CNAME | destino que da Railway al agregar `api.copaproud.com` al servicio actual | ya |
| `live` | CNAME | destino que da Railway al agregar `live.copaproud.com` al servicio nuevo `copa-proud-web` | cuando exista el servicio |

- En Railway (servicio actual): variable `CORS_ORIGINS` debe incluir `https://live.copaproud.com` (sumar, no reemplazar).
- El build del sitio usa `VITE_API_URL=https://api.copaproud.com`.
- El WordPress suma un botón/banner "Seguí el torneo en vivo" → `https://live.copaproud.com`.
- Marca extraída a `copa-proud-web/public/` (ver `copa-proud-web/BRAND.md`).

## 12. Sitio público + modo veedor (2026-10-01)

**Hecho (sin commitear):** `copa-proud-web/` — Vite + React 19 + Tailwind 3, fuentes autoalojadas
(Montserrat 800 como el logo, Big Shoulders Display para marcadores, Kaushan Script para la bajada).

| Pieza | Archivo |
|---|---|
| Snapshot + polling (15 s en vivo / 60 s idle, pausa en pestaña oculta, conserva datos sin red) | `src/lib/CompetitionProvider.jsx` |
| Modelo puro (hora local del predio por offset, etiquetas de fuentes, rondas) | `src/lib/model.js` |
| i18n ES/PT/EN (diccionario propio, detecta idioma del navegador, recuerda la elección) | `src/i18n/` |
| Inicio (hero, cancha por cancha, próximos, últimos, campeones) | `src/pages/Home.jsx` |
| Fixture: grilla horario × cancha como el PDF + lista + filtros; receso detectado solo | `src/pages/Fixture.jsx` |
| Zonas + tabla de terceros con destino por copa | `src/pages/Groups.jsx`, `src/components/StandingsTable.jsx` |
| Llaves Oro/Plata/Bronce con layout por "padres" (Bronce no es árbol perfecto) | `src/components/Bracket.jsx` |
| Equipos, ficha de equipo con plantel, estadísticas | `src/pages/` |
| Modo veedor `/v/<token>`: cola offline con reintento + client_event_id, marcador optimista, selector por dorsal, penales, deshacer | `src/veedor/` |
| Deploy: Dockerfile (Vite → Caddy), Caddyfile (SPA + caché), railway.toml | raíz de `copa-proud-web/` |

**Verificado en el navegador** (escritorio y 375 px) contra la API local con datos de la simulación:
grilla, zonas, llaves, veedor completo (2° tiempo, gol con dorsal) y **corte de señal real** (API apagada →
gol en cola con marcador optimista → API arriba → se envió solo, sin duplicar: 4 eventos = 1-3).

**Falta:** tab "Competencias" de la mesa central en `futbol-mvp-web` (hoy la mesa central solo tiene la API);
deploy del servicio #2 + DNS `live`; commit.

Dev local: `tests/e2e_competition_sim.py` con `E2E_DEMO_STOP=24` deja el sábado a mitad con el turno de 15:00
en vivo e imprime los links de veedor; `.claude/launch.json` levanta el sitio (`copa-site`). La API local se
levanta por terminal (el panel no puede leer `.venv` en ~/Desktop por permisos de macOS).

## 13. Veedores por equipo (decisión 2026-10-01)

- **Cada veedor tiene varios equipos** (la organización arma los grupos). Puede cargar **todos los partidos de
  sus equipos**, también los cruces del domingo: cuando un equipo avanza, su veedor ve el partido solo.
- **En un partido cargan los dos veedores** (el de cada equipo). Resguardos para no duplicar:
  1. cada evento queda firmado ("cargado por X") y el teléfono refresca cada 5 s con el partido en vivo;
  2. si el otro veedor cargó el mismo tipo de evento del mismo equipo hace < 90 s → "¿Es otro?" antes de cargar;
  3. un veedor solo puede **deshacer lo propio** (`EVENT_NOT_YOURS`); la mesa central borra cualquiera.
- La asignación por partido/cancha (`veedor_staff_id` del partido) queda como **refuerzo** (veedor de reserva).
- El sitio público muestra los nombres completos de los veedores del partido ("Veedor 01 · Veedor 04").
- Migración **`019_competition_team_veedor.sql`** (aditiva: `competition_teams.veedor_staff_id`). Correr después de 018.
- API: `PUT /admin/competitions/{slug}/staff/{id}/teams` y `team_ids` opcional al crear el veedor.
- Verificado: E2E (~800 verificaciones, 5 semillas) + prueba en navegador de dos veedores en el mismo partido.

## 14. Producción (2026-10-01)

- `api.copaproud.com` → servicio actual (CNAME + TXT en Hostinger, SSL Let's Encrypt OK).
- Migraciones **018 y 019 corridas** en la base de producción.
- Deploy: commits `1e9a196` (backend) y `fa6578d` (sitio) en `main`; verificado en producción.
- **`live.copaproud.com` ACTIVO (2/10)**: servicio Railway del sitio (root `copa-proud-web`, `VITE_API_URL=https://api.copaproud.com`, puerto 8080) + CNAME/TXT en Hostinger + SSL. Verificado: rutas SPA, caché, gzip, CORS. Muestra "todavía no está publicado" hasta publicar.
- Pendiente: seed en producción (corriendo en la terminal del usuario), pantalla de mesa central, publicar.

## 15. Modo demo para ensayar con veedores (2026-10-02)

- `live.copaproud.com/demo` (y `/demo/v/<token>` para los veedores) usa la competencia aparte
  `copa-proud-2026-demo`: mismo formato, 28 equipos reales con escudo, sorteo al azar, planteles de prueba
  (#1 arquero, #2 capitán) y 14 veedores de prueba con 2 equipos cada uno. Franja "MODO DEMO" siempre visible,
  `noindex`, no enlazado. Nada toca el torneo real (verificado).
- `scripts/demo_competition.py crear [--fecha AAAA-MM-DD]` → (re)crea con links nuevos (`demo-veedores.csv`, ignorado por git).
  `reiniciar` → borra solo resultados (links intactos). `borrar` → elimina la demo. Solo opera sobre slugs `-demo`.
- Frontend: `src/lib/mode.js` (basename `/demo` del router + slug `-demo`), `DemoBanner`.

## 16. Sorteo de zonas EN VIVO (2026-10-02, desplegado)

- Pantalla de transmisión: `live.copaproud.com/sorteo?tv=1` (ensayo: `/demo/sorteo?tv=1`) para OBS/proyector.
  Bolillero + 7 zonas + revelación animada (cola si salen varios). El sitio muestra "Sorteo EN VIVO".
- Panel de producción: `/produccion/<token>` (ensayo `/demo/produccion/<token>`). Link con
  `scripts/draw_link.py [--demo]` (cada corrida invalida el anterior). Buscar + Enter elige, Enter revela.
- Versátil (bolillero/reglas no definidos aún): orden ronda o zona por zona, bombos opcionales,
  regla opcional "separar mismo país", lugar a mano. Estado en `competitions.settings.live_draw` (sin migración);
  resultado en `competition_group_slots` → el fixture del sábado se completa solo.
- Pendiente para el sorteo REAL: cargar los 28 equipos reales en la competencia real (mesa central) antes del sorteo.

## 17. Veedores por cancha (2026-10-02)

- **Decisión:** los veedores se asignan **por cancha** (uno por cancha; puede ser otra persona cada día). Reemplaza a §13
  como camino principal; el modelo por equipo sigue andando (el E2E lo usa). Sin migración: usa
  `competition_matches.veedor_staff_id`, que `staff_can_operate`/`match_veedor_ids` ya respetaban.
- `staff/me` suma `staff.courts = [{venue, date (local del predio), matches}]`. El modo veedor muestra arriba
  "Tu cancha · Cancha 3 · Sáb y Dom", agrupa los partidos por día (un día ya terminado queda plegado) y no repite
  la cancha en cada partido si tiene una sola.
- Script `scripts/veedores_cancha.py` (pide la URL como el seed; `--demo` = competencia de ensayo):

| Comando | Qué hace |
|---|---|
| `crear [--archivo veedores.csv] [--reemplazar]` | crea los veedores y les asigna todos los partidos de su cancha/día. Sin archivo: "Veedor Cancha N" (ambos días). CSV `cancha,dia,nombre[,telefono]`, `dia` = sab/dom/ambos; un nombre repetido = una persona con un link. Si ya hay veedores activos aborta; `--reemplazar` los revoca y borra las asignaciones (equipo y cancha). |
| `links [--cancha N] [--dia sab\|dom]` | links NUEVOS (todos o esa cancha); los anteriores dejan de andar. |
| `renombrar --cancha N [--dia sab\|dom] "Nombre"` | cambia el nombre sin tocar el link. |
| `listar` | veedores, canchas/días, fechas (sin tokens) y partidos sin veedor. |
| `qr` | rearma la hoja de QR desde el CSV (sin base; necesita `pip install qrcode`). |

- `crear`/`links` muestran resumen y piden APLICAR (`--si` para no preguntar). Salida en la raíz del repo (ignorada
  por git): `veedores-links.csv` + `veedores-qr.png` (demo: `demo-veedores.csv` + `demo-veedores-qr.png`), con un
  mensaje listo para WhatsApp por veedor. Los días sab/dom salen de las fechas de los partidos (sirve para la demo).
- `demo_competition.py crear` ahora crea 6 "Veedor Demo Cancha N" (ambos días); `--por-equipo N` = modelo anterior.
- El teléfono del CSV solo va al CSV de salida (no se guarda cifrado: la clave de cifrado es la del servidor).

## 18. Sorteo oficial + transmisión por YouTube + escenas de OBS (2026-10-02)

**Reglamento y Procedimiento del Sorteo Oficial** (PDF recibido 2/10) implementado como modo `TANDAS`
(`app/utils/competition_draw.py`, config en `draw_procedure` de `competition_formats.py`):
- Doble bombo por tanda. T1 Brasil (5) · T2 Uruguay (3) · T3 resto de extranjeros (4) · T4 parejas
  de agrupaciones (6) · T5 resto de Argentina (10). T1–T4: bolilla de **zona** A–G (va a la primera
  posición libre; las bolillas no vuelven al bombo dentro de la tanda, se avisa si se repite).
  T5: bolilla de **casillero** (zona + posición) entre los libres.
- Máx. **2 extranjeros** por zona; parejas Tercer/Cuarto Tiempo, Rayos.cba/Rayos.cba II, Dogos/Dogos
  Seniors en zonas distintas. **Regla de salto**: zona siguiente A→B…G→A que cumpla; queda en la pick
  (`jump: {from, to, reason, partner_id}`) y se muestra en todas las pantallas.
- ⚠️ SUPUESTO: posición dentro de la zona en T1–T4 = la primera libre (el PDF no lo dice).
- `scripts/equipos_oficiales.py [--demo]`: carga los 28 equipos oficiales (`copa_proud_teams.json`,
  países corregidos: Guatemala IyD es AR; Zorros = escudo MDP, Beescats = escudo Soccer Boys, 3F = 3
  Deporte Inclusivo; Real Players sin escudo; Rayos.cba II usa el de Rayos) y deja el sorteo en modo
  oficial. El panel también tiene "Cargar procedimiento oficial" (acción `preset`).
- Panel: equipo + Enter → letra de la bolilla (T5: letra + número) → vista previa (acción `preview`,
  muestra el salto) → Enter revela. "Ubicar a mano (sin reglas)" = `force`.
- Tests: 10 nuevos en `tests/test_competition_draw.py` (incl. 1000 sorteos oficiales al azar que
  siempre cumplen el reglamento).

**Transmisión** (`settings.broadcast` = `{starts_at, youtube_id, spoiler_delay_s}`, default del
formato: martes 6/10 22:15 −03:00). Se cambia desde el panel de producción (sección "Transmisión",
acción `broadcast`). Pestaña nueva **Sorteo** (`/sorteo`): fecha/hora ARG + hora del visitante,
cuenta regresiva, "Agendar" (Google Calendar), YouTube embebido + link, tablero en vivo con demora
anti-spoiler (`spoiler_delay_s`, 10 s por defecto) y "Cómo es el sorteo". La demo tiene su propia
config → **ensayo secreto**: vivo "No listado" pegado solo en el panel de la demo.
`/sorteo?tv=1` sigue abriendo el tablero.

**Escenas de OBS** (`copa-proud-web/src/obs/ObsApp.jsx`, índice con miniaturas en `/obs`): espera,
reglas, equipos, overlay (transparente), zocalo?nombre=&rol= (transparente), split (ventana
transparente 896×504 en 64,208), tablero, pausa, cierre. Escenario fijo 1920×1080, siempre en español,
"ENSAYO" en una esquina en la demo. `copa-proud-web/obs/setup-obs.mjs` arma OBS solo por obs-websocket
(guía: `docs/copa-proud-obs.md`).

`scripts/demo_competition.py crear` ahora sortea la demo con el procedimiento oficial, deja las tandas
listas para ensayar y conserva el link de producción y la transmisión al recrearla.
