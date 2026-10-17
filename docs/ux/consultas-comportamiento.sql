-- ============================================================
-- CONSULTAS DE COMPORTAMIENTO — Tercer Tiempo FC (Canchas)
-- Rediseño UX: validar las hipótesis H1–H12 con datos reales
-- antes de reordenar el roadmap (ver docs/ux/rediseno-ux.md).
-- ============================================================
--
-- PARA QUÉ SIRVE
--   Cada sección responde una pregunta concreta sobre cómo se usa hoy la app
--   (cómo se arma el partido, quién da las bajas, si se llena, si se vota…).
--   Según lo que salga, el roadmap del rediseño cambia de orden. Cada sección
--   dice qué pregunta responde, cómo leer el resultado, qué umbral confirma la
--   hipótesis y qué cambia en el diseño si se refuta.
--
-- CÓMO CORRERLO
--   1. Railway → servicio Postgres → pestaña "Data" → consola de consultas.
--   2. Copiá UNA consulta por vez: desde el comentario "(a)", "(b)"… (o desde el
--      encabezado de la sección si tiene una sola) hasta el punto y coma, y
--      ejecutala. Las secciones con varias consultas se corren por separado.
--   3. Opcional, si tu consola mantiene la sesión entre consultas: corré antes
--      `set default_transaction_read_only = on;` y queda blindado.
--
-- ES TODO SOLO LECTURA
--   Solo hay SELECT y WITH. Nada escribe, borra ni cambia la estructura.
--   Tampoco se lee ningún dato sensible: ni PIN, ni claves de evento, ni
--   contactos de externos, ni teléfonos, ni tokens. Los jugadores aparecen por
--   user_id (uuid), sin nombre.
--
-- QUÉ PEGARNOS DE VUELTA
--   - El nombre de la consulta (ej. "H4 (a)").
--   - El resultado completo si son pocas filas; si son muchas, las primeras
--     ~30 filas (ya vienen ordenadas para que lo importante quede arriba).
--   - Si activaste el filtro de fecha (ver abajo).
--
-- FILTRO DE FECHA (2026-06-27)
--   Antes del 2026-06-27 el actor del audit log (actor_user_id) y el
--   created_by_user_id de las inscripciones se podían falsificar con un header
--   (ver scripts/forense.sql: los invitados falsos "Juan Perez" / "JP").
--   Cada consulta histórica trae una línea comentada lista para activar:
--       -- AND <tabla>.created_at >= '2026-06-27'
--   Para activarla, borrá los dos guiones del principio. En las que dependen
--   del actor (H2, H3, H4, H6, H9, H12, QN, CONTROL, ACTIVOS) conviene correrlas
--   también CON el filtro y pegarnos las dos versiones.
--
-- ZONA HORARIA
--   Todo lo que se agrupa o se muestra por día, hora, semana o mes se pasa a
--   America/Argentina/Buenos_Aires.
--
-- VALIDACIÓN
--   Tablas y columnas chequeadas contra migrations/001, 002, 003, 004, 007, 011,
--   012, 013, 014, 015, 016 y 017, y contra lo que escribe hoy el backend
--   (app/routers/*.py). Datos que conviene tener presentes al leer:
--   - Acciones del audit log que existen hoy: CREATE_EVENT, UPDATE_EVENT,
--     UPDATE_EVENT_VISIBILITY, UPDATE_EVENT_ACCESS, ROTATE_SHARE_CODE,
--     CLOSE_EVENT, REOPEN_EVENT, FINALIZE_EVENT, AUTO_CLOSE_EVENT, CREATE_COURT,
--     UPDATE_COURT, DELETE_COURT, OPEN_COURT, CLOSE_COURT, AUTO_CLOSE_COURT,
--     ASSIGN_CAPTAIN, REMOVE_CAPTAIN, REGISTER_USER, REGISTER_GUEST,
--     REGISTER_EXTERNAL, MOVE_REGISTRATION, CANCEL_REGISTRATION, CANCEL_EXTERNAL,
--     PROMOTE_WAITLIST, ROTATE_MGMT_TOKEN, EVENT_UNLOCK, CREATE_NOTIFICATION,
--     DEACTIVATE_NOTIFICATION y las de gestión de usuarios (CREATE_USER_MANUAL,
--     RESET_PIN, UPDATE_USER_ROLES, UPDATE_USER_STATUS, APPROVE_PIN_UNLOCK,
--     DENY_PIN_UNLOCK, APPROVE_ACCOUNT, REJECT_ACCOUNT, ACCOUNT_REQUEST_SUBMITTED).
--     No hay acción de "suspender" ni de votos: los votos se miran en player_ratings.
--   - REGISTER_USER: el actor es siempre el propio jugador (solo se anota uno
--     mismo). Hoy metadata.source = 'api'.
--   - CANCEL_REGISTRATION: hoy solo la puede hacer un admin o un capitán de
--     event_captains (el jugador recibe 403). Las bajas "propias" de hoy son
--     casi todas de admins que se bajan a sí mismos.
--   - Lista de espera: status = 'WAITLIST' y court_id NULL.
--   - Estados de evento: OPEN, CLOSED, FINALIZED. De inscripción: CONFIRMED,
--     WAITLIST, CANCELLED. Tipos: USER, GUEST, EXTERNAL.
--   - roles.id es smallint en producción; el código del rol está en roles.code
--     ('admin', 'super_admin'), igual que en app/utils/permissions.py.
--   - Crear un evento NO crea canchas: cada cancha es un CREATE_COURT aparte.
-- ============================================================



-- ============================================================
-- Q0 · ¿Hay un índice único sobre event_registrations(event_id, user_id)?
-- ============================================================
-- Pregunta: el backend atrapa IntegrityError al anotarse (events.py), pero en
--   migrations/ no hay ningún índice único sobre (event_id, user_id). ¿Existe en
--   producción? ¿Es parcial (con WHERE) o total?
-- Cómo leerlo:
--   (a) Lista los índices de la tabla. Buscá uno UNIQUE sobre (event_id, user_id)
--       y fijate si su definición termina en un WHERE (parcial) o no (total).
--   (b) Duplicados activos. Si devuelve filas, hay gente anotada dos veces en el
--       mismo evento y hay que limpiar antes de crear cualquier índice.
--   (c) Pares repetidos contando también las bajas. Si da > 0, en producción NO
--       puede haber un índice único total.
-- Confirma si: aparece en pg_indexes un UNIQUE no parcial sobre (event_id, user_id).
-- Si se refuta (o si se confirma): define la 0a. Con índice total, re-anotarse
--   después de una baja tiene que reutilizar la fila cancelada (o reemplazar el
--   índice por uno parcial); sin índice, la 020 crea uno parcial
--   (status <> 'CANCELLED'). Ojo: la espera se ordena por created_at.
-- (Es una foto del estado actual: no lleva filtro de fecha.)

-- Q0 (a) índices de la tabla
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'event_registrations'
order by indexname;

-- Q0 (b) duplicados activos
select r.event_id, r.user_id, count(*) as filas_activas
from public.event_registrations r
where r.user_id is not null
  and r.status <> 'CANCELLED'
group by 1, 2
having count(*) > 1
order by 3 desc;

-- Q0 (c) pares (evento, usuario) con más de una fila, incluidas las bajas
select count(*) as pares_con_mas_de_una_fila,
       coalesce(sum(n), 0) as filas_involucradas
from (
  select r.event_id, r.user_id, count(*) as n
  from public.event_registrations r
  where r.user_id is not null
  group by 1, 2
  having count(*) > 1
) t;



-- ============================================================
-- H1 · ¿El partido semanal se repite igual (día, hora, lugar, canchas)?
-- ============================================================
-- Pregunta: si casi todos los eventos son "el mismo partido de siempre", tiene
--   sentido "Repetir" y, más adelante, la serie.
-- Cómo leerlo: cada fila es una combinación de día+hora (ID = día ISO: 1 lunes …
--   7 domingo), lugar y canchas (nombre:capacidad). Mirá "pct_acumulado" en el
--   puesto 2. El título no entra porque suele llevar la fecha.
-- Confirma si: ≥70% de los eventos caen en ≤2 combinaciones (pct_acumulado del
--   puesto 2 ≥ 70).
-- Si se refuta: "/crear" pasa a ser el camino principal y la serie (iter 5) no
--   se construye.
with e as (
  select e.id,
         to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'ID HH24:MI') as dia_hora,
         lower(trim(e.location_name)) as lugar,
         (select string_agg(c.name || ':' || c.capacity, ', ' order by c.sort_order, c.created_at)
            from public.event_courts c
           where c.event_id = e.id) as canchas
  from public.events e
  where e.starts_at > now() - interval '6 months'
  -- AND e.created_at >= '2026-06-27'
),
combos as (
  select dia_hora, lugar, canchas, count(*) as n
  from e
  group by 1, 2, 3
)
select row_number() over (order by n desc, dia_hora, lugar, canchas) as puesto,
       dia_hora, lugar, canchas, n,
       round(100.0 * n / sum(n) over (), 1) as pct,
       round(100.0 * sum(n) over (order by n desc, dia_hora, lugar, canchas rows unbounded preceding)
             / sum(n) over (), 1) as pct_acumulado
from combos
order by puesto;



-- ============================================================
-- H2 · ¿Armar el partido cuesta escrituras y genera errores?
-- ============================================================
-- Pregunta: cuántas escrituras y cuánto tiempo lleva el setup (desde el
--   CREATE_EVENT hasta la última escritura de armado dentro de las 2 h), y si se
--   crean canchas en el evento equivocado (uno que ya se jugó).
-- Cómo leerlo:
--   (a) Resumen: mediana y p90 de escrituras y de duración del setup.
--   (b) Detalle por evento (los más recientes arriba).
--   (c) Errores: canchas creadas en eventos ya jugados, y canchas borradas menos
--       de 10 min después de crear una en el mismo evento (corrección rápida).
-- Confirma si: mediana > 5 escrituras o > 3 min de setup; o
--   canchas_creadas_en_eventos_ya_jugados > 0.
-- Si se refuta: si el setup ya es corto, "Repetir" (iter 2) baja de prioridad
--   frente a "Armar equipos" (iter 3).

-- H2 (a) resumen del setup
with t0 as (
  select a.event_id, min(a.created_at) as t0
  from public.event_audit_log a
  where a.action = 'CREATE_EVENT'
    and a.created_at > now() - interval '6 months'
  -- AND a.created_at >= '2026-06-27'
  group by 1
),
s as (
  select a.event_id,
         count(*) as escrituras,
         max(a.created_at) - min(a.created_at) as duracion_setup,
         count(*) filter (where a.action = 'CREATE_COURT') as canchas_creadas,
         count(*) filter (where a.action = 'DELETE_COURT') as canchas_borradas,
         count(*) filter (where a.action in ('UPDATE_EVENT_ACCESS', 'ROTATE_SHARE_CODE')) as cambios_de_acceso
  from public.event_audit_log a
  join t0 on t0.event_id = a.event_id
  where a.created_at < t0.t0 + interval '2 hours'
    and a.action in ('CREATE_EVENT', 'CREATE_COURT', 'DELETE_COURT', 'UPDATE_COURT', 'UPDATE_EVENT',
                     'UPDATE_EVENT_ACCESS', 'ROTATE_SHARE_CODE', 'UPDATE_EVENT_VISIBILITY',
                     'OPEN_COURT', 'CLOSE_COURT')
  group by 1
)
select count(*) as eventos,
       percentile_cont(0.5) within group (order by escrituras) as mediana_escrituras,
       percentile_cont(0.9) within group (order by escrituras) as p90_escrituras,
       percentile_cont(0.5) within group (order by duracion_setup) as mediana_setup,
       percentile_cont(0.9) within group (order by duracion_setup) as p90_setup,
       sum(canchas_borradas) as canchas_borradas_en_el_setup,
       count(*) filter (where cambios_de_acceso > 0) as eventos_con_cambio_de_acceso
from s;

-- H2 (b) detalle por evento
with t0 as (
  select a.event_id, min(a.created_at) as t0
  from public.event_audit_log a
  where a.action = 'CREATE_EVENT'
    and a.created_at > now() - interval '6 months'
  -- AND a.created_at >= '2026-06-27'
  group by 1
)
select a.event_id,
       to_char(t0.t0 at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as creado,
       count(*) as escrituras,
       max(a.created_at) - min(a.created_at) as duracion_setup,
       count(*) filter (where a.action = 'CREATE_COURT') as canchas_creadas,
       count(*) filter (where a.action = 'DELETE_COURT') as canchas_borradas,
       count(*) filter (where a.action in ('UPDATE_EVENT_ACCESS', 'ROTATE_SHARE_CODE')) as cambios_de_acceso,
       string_agg(a.action, ' > ' order by a.created_at) as secuencia
from public.event_audit_log a
join t0 on t0.event_id = a.event_id
where a.created_at < t0.t0 + interval '2 hours'
  and a.action in ('CREATE_EVENT', 'CREATE_COURT', 'DELETE_COURT', 'UPDATE_COURT', 'UPDATE_EVENT',
                   'UPDATE_EVENT_ACCESS', 'ROTATE_SHARE_CODE', 'UPDATE_EVENT_VISIBILITY',
                   'OPEN_COURT', 'CLOSE_COURT')
group by a.event_id, t0.t0
order by t0.t0 desc;

-- H2 (c) errores de armado
with x as (
  select a.event_id,
         a.action = 'CREATE_COURT' and a.created_at > e.starts_at as cancha_en_evento_ya_jugado,
         a.action = 'DELETE_COURT'
           and exists (select 1
                         from public.event_audit_log c
                        where c.event_id = a.event_id
                          and c.action = 'CREATE_COURT'
                          and c.created_at between a.created_at - interval '10 minutes'
                                               and a.created_at) as borrada_al_toque
  from public.event_audit_log a
  join public.events e on e.id = a.event_id
  where a.action in ('CREATE_COURT', 'DELETE_COURT')
  -- AND a.created_at >= '2026-06-27'
)
select count(*) filter (where cancha_en_evento_ya_jugado) as canchas_creadas_en_eventos_ya_jugados,
       count(distinct event_id) filter (where cancha_en_evento_ya_jugado) as eventos_afectados,
       count(*) filter (where borrada_al_toque) as canchas_borradas_a_menos_de_10_min_de_crear
from x;



-- ============================================================
-- H3 · ¿Hay un núcleo de fijos?
-- ============================================================
-- Pregunta: ¿hay un grupo de personas que se anota casi siempre y enseguida?
--   "Rápido" = su REGISTER_USER llega menos de 60 min después del CREATE_EVENT
--   (ojo: si el link se comparte más tarde por WhatsApp, esto subestima).
--   "Fijo" = se anotó rápido en ≥75% de los partidos de los últimos 3 meses.
-- Cómo leerlo:
--   (a) Resumen: cuántos fijos hay y qué % de la capacidad mediana de un partido
--       (suma de cupos de sus canchas) cubren.
--   (b) Detalle por jugador (user_id), ordenado por cantidad de altas rápidas.
-- Confirma si: pct_capacidad_cubierta_por_fijos ≥ 50.
-- Si se refuta: la serie (iter 5) solo publica el partido; si se confirma,
--   habilita fijos auto-confirmados (serie v2).

-- H3 (a) resumen
with pub as (
  select a.event_id, min(a.created_at) as t0
  from public.event_audit_log a
  where a.action = 'CREATE_EVENT'
    and a.created_at > now() - interval '3 months'
  -- AND a.created_at >= '2026-06-27'
  group by 1
),
cap as (
  select pub.event_id, coalesce(sum(c.capacity), 0) as capacidad
  from pub
  left join public.event_courts c on c.event_id = pub.event_id
  group by 1
),
fr as (
  select a.event_id, r.user_id, min(a.created_at) as t
  from public.event_audit_log a
  join public.event_registrations r on r.id = a.target_registration_id
  where a.action = 'REGISTER_USER'
    and r.user_id is not null
  group by 1, 2
),
por_jugador as (
  select fr.user_id,
         count(*) as partidos_anotado,
         count(*) filter (where fr.t - pub.t0 < interval '60 minutes') as rapidas,
         100.0 * count(*) filter (where fr.t - pub.t0 < interval '60 minutes')
               / (select count(*) from pub) as pct_partidos_rapido
  from fr
  join pub using (event_id)
  group by 1
)
select (select count(*) from pub) as partidos,
       (select percentile_cont(0.5) within group (order by capacidad) from cap where capacidad > 0) as capacidad_mediana,
       count(*) filter (where pct_partidos_rapido >= 75) as fijos,
       count(*) filter (where pct_partidos_rapido >= 50) as casi_fijos_50,
       round((100.0 * count(*) filter (where pct_partidos_rapido >= 75)
              / nullif((select percentile_cont(0.5) within group (order by capacidad) from cap where capacidad > 0), 0)
             )::numeric, 1) as pct_capacidad_cubierta_por_fijos
from por_jugador;

-- H3 (b) detalle por jugador
with pub as (
  select a.event_id, min(a.created_at) as t0
  from public.event_audit_log a
  where a.action = 'CREATE_EVENT'
    and a.created_at > now() - interval '3 months'
  -- AND a.created_at >= '2026-06-27'
  group by 1
),
fr as (
  select a.event_id, r.user_id, min(a.created_at) as t
  from public.event_audit_log a
  join public.event_registrations r on r.id = a.target_registration_id
  where a.action = 'REGISTER_USER'
    and r.user_id is not null
  group by 1, 2
)
select fr.user_id,
       count(*) as partidos_anotado,
       count(*) filter (where fr.t - pub.t0 < interval '60 minutes') as rapidas,
       round(100.0 * count(*) filter (where fr.t - pub.t0 < interval '60 minutes')
             / (select count(*) from pub), 1) as pct_partidos_rapido,
       percentile_cont(0.5) within group (order by fr.t - pub.t0) as mediana_demora_en_anotarse
from fr
join pub using (event_id)
group by 1
order by rapidas desc, partidos_anotado desc;



-- ============================================================
-- H4 · ¿Las bajas existen, pasan por el admin y muchas son tardías?
-- ============================================================
-- Pregunta: quién da de baja a los jugadores (el propio jugador u otro) y con
--   cuánta anticipación respecto del inicio del partido.
-- Cómo leerlo:
--   (a) Desde el audit log: cruza quién dio la baja con la anticipación.
--       "pct_del_total" suma 100 entre todas las filas.
--   (b) Control desde las inscripciones (no depende del audit log): bajas por
--       tipo de inscripción y % de tardías (< 24 h antes del partido).
-- Confirma si: hay bajas con quien_da_la_baja = 'otro (admin/capitán)' (> 0) y
--   más del 30% son a menos de 24 h (filas "1." y "2." sumadas).
-- Si se refuta / si hay muchas tardías: con muchas tardías se adelantan
--   "Liberar y avisar al grupo" y el aviso de promoción desde la espera.

-- H4 (a) bajas según el audit log
select case when a.actor_user_id is null then 'sin actor'
            when a.actor_user_id = r.user_id then 'el propio jugador'
            else 'otro (admin/capitán)' end as quien_da_la_baja,
       case when a.created_at >= e.starts_at then '0. después de empezar'
            when e.starts_at - a.created_at < interval '6 hours' then '1. <6 h'
            when e.starts_at - a.created_at < interval '24 hours' then '2. 6–24 h'
            else '3. >24 h' end as anticipacion,
       count(*) as bajas,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_del_total
from public.event_audit_log a
join public.event_registrations r on r.id = a.target_registration_id
join public.events e on e.id = a.event_id
where a.action = 'CANCEL_REGISTRATION'
  and r.registration_type = 'USER'
-- AND a.created_at >= '2026-06-27'
group by 1, 2
order by 1, 2;

-- H4 (b) bajas según las inscripciones
select r.registration_type,
       count(*) as bajas,
       count(*) filter (where e.starts_at - r.cancelled_at < interval '24 hours') as tardias_menos_24h,
       round(100.0 * count(*) filter (where e.starts_at - r.cancelled_at < interval '24 hours')
             / nullif(count(*), 0), 1) as pct_tardias
from public.event_registrations r
join public.events e on e.id = r.event_id
where r.status = 'CANCELLED'
  and r.cancelled_at is not null
-- AND r.created_at >= '2026-06-27'
group by 1
order by 2 desc;



-- ============================================================
-- H5 · ¿Las canchas se llenan rápido y hay demanda insatisfecha?
-- ============================================================
-- Pregunta: cuánto tarda un partido en llenarse (CREATE_EVENT → primer
--   AUTO_CLOSE_EVENT), si el organizador reabre a mano (OPEN_COURT /
--   REOPEN_EVENT) y cuánta gente queda en espera.
-- Cómo leerlo:
--   (a) Resumen de los últimos 6 meses.
--   (b) Detalle por evento (los más recientes arriba).
--   Ojo: OPEN_COURT también aparece cuando se abre/cierra una cancha para armar
--   equipos (ver H6); cruzalo con las secuencias de H6 (b).
-- Confirma si: mediana_hasta_llenarse < 48 h y hay reaperturas manuales (> 0).
-- Si se refuta: si nunca se llena, se prioriza compartir (lugares por cancha)
--   sobre la lista de espera.

-- H5 (a) resumen
with ev as (
  select e.id as event_id,
         min(a.created_at) filter (where a.action = 'AUTO_CLOSE_EVENT')
           - min(a.created_at) filter (where a.action = 'CREATE_EVENT') as tiempo_hasta_llenarse,
         count(*) filter (where a.action = 'AUTO_CLOSE_COURT') as canchas_llenas,
         count(*) filter (where a.action in ('OPEN_COURT', 'REOPEN_EVENT')) as reaperturas_manuales,
         count(*) filter (where a.action = 'PROMOTE_WAITLIST') as promociones_desde_espera
  from public.events e
  join public.event_audit_log a on a.event_id = e.id
  where e.starts_at > now() - interval '6 months'
  -- AND a.created_at >= '2026-06-27'
  group by e.id
),
espera as (
  select r.event_id, count(*) as quedaron_en_espera
  from public.event_registrations r
  where r.status = 'WAITLIST'
  group by 1
)
select count(*) as eventos,
       count(ev.tiempo_hasta_llenarse) as se_llenaron,
       percentile_cont(0.5) within group (order by ev.tiempo_hasta_llenarse) as mediana_hasta_llenarse,
       count(*) filter (where ev.tiempo_hasta_llenarse < interval '48 hours') as llenos_en_menos_de_48h,
       sum(ev.reaperturas_manuales) as reaperturas_manuales,
       count(*) filter (where ev.reaperturas_manuales > 0) as eventos_con_reapertura,
       sum(ev.promociones_desde_espera) as promociones_desde_espera,
       coalesce(sum(w.quedaron_en_espera), 0) as personas_que_quedaron_en_espera,
       count(*) filter (where w.quedaron_en_espera > 0) as eventos_con_gente_en_espera
from ev
left join espera w using (event_id);

-- H5 (b) detalle por evento
select e.id as event_id,
       to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as cuando,
       min(a.created_at) filter (where a.action = 'AUTO_CLOSE_EVENT')
         - min(a.created_at) filter (where a.action = 'CREATE_EVENT') as tiempo_hasta_llenarse,
       count(*) filter (where a.action = 'AUTO_CLOSE_COURT') as canchas_llenas,
       count(*) filter (where a.action in ('OPEN_COURT', 'REOPEN_EVENT')) as reaperturas_manuales,
       count(*) filter (where a.action = 'PROMOTE_WAITLIST') as promociones_desde_espera,
       (select count(*)
          from public.event_registrations w
         where w.event_id = e.id
           and w.status = 'WAITLIST') as quedaron_en_espera
from public.events e
join public.event_audit_log a on a.event_id = e.id
where e.starts_at > now() - interval '6 months'
-- AND a.created_at >= '2026-06-27'
group by e.id, e.starts_at
order by e.starts_at desc;



-- ============================================================
-- H6 · ¿Armar equipos hoy son ráfagas de moves?
-- ============================================================
-- Pregunta: ¿los equipos se arman dentro de la app (muchos MOVE_REGISTRATION,
--   o el truco de abrir/cerrar canchas) o afuera?
-- Cómo leerlo:
--   (a) Resumen por partido ya jugado: mediana y p90 de moves, y cuántos
--       partidos no tuvieron ningún move.
--   (b) Ráfagas: mismo actor, mismo evento, misma hora local, ≥3 acciones de
--       armado. "secuencia" muestra el orden (buscá OPEN_COURT > MOVE > CLOSE_COURT).
-- Confirma si: mediana_moves ≥ 3, o aparecen secuencias OPEN_COURT > … > CLOSE_COURT.
-- Si se refuta: con pocos moves, los equipos se arman afuera de la app y la
--   3b (Claro/Oscuro) va antes que la 3a (Armar canchas).

-- H6 (a) moves por partido
with ev as (
  select e.id,
         count(a.id) filter (where a.action = 'MOVE_REGISTRATION') as moves,
         count(a.id) filter (where a.action in ('OPEN_COURT', 'CLOSE_COURT')) as abrir_cerrar
  from public.events e
  left join public.event_audit_log a on a.event_id = e.id
  -- AND a.created_at >= '2026-06-27'
  where e.starts_at > now() - interval '6 months'
    and e.starts_at < now()
  group by e.id
)
select count(*) as partidos_jugados,
       percentile_cont(0.5) within group (order by moves) as mediana_moves,
       percentile_cont(0.9) within group (order by moves) as p90_moves,
       count(*) filter (where moves = 0) as partidos_sin_moves,
       count(*) filter (where moves >= 3) as partidos_con_3_o_mas_moves,
       percentile_cont(0.5) within group (order by abrir_cerrar) as mediana_abrir_cerrar_canchas
from ev;

-- H6 (b) ráfagas de armado
select a.event_id,
       a.actor_user_id,
       date_trunc('hour', a.created_at at time zone 'America/Argentina/Buenos_Aires') as hora_local,
       count(*) as n,
       string_agg(a.action, ' > ' order by a.created_at) as secuencia
from public.event_audit_log a
where a.action in ('MOVE_REGISTRATION', 'OPEN_COURT', 'CLOSE_COURT', 'CANCEL_REGISTRATION', 'UPDATE_COURT')
-- AND a.created_at >= '2026-06-27'
group by 1, 2, 3
having count(*) >= 3
order by 3 desc;



-- ============================================================
-- H7 · ¿Los partidos se finalizan tarde o nunca (y se pierden votos)?
-- ============================================================
-- Pregunta: cuánto pasa entre el inicio y la finalización, y cuántos partidos
--   quedan colgados (OPEN/CLOSED más de un día después de jugarse). Sin
--   FINALIZED/finalized_at no se abren los votos.
-- Cómo leerlo:
--   (a) Resumen de los últimos 6 meses (solo partidos ya empezados).
--   (b) Lo mismo por mes, para ver si mejora o empeora.
--   Ojo: en los eventos viejos finalized_at se rellenó con updated_at (002), así
--   que el lag de esos meses es aproximado. Un partido suspendido que nunca se
--   finalizó también cuenta como colgado (cruzalo con H11).
-- Confirma si: mediana_lag > 24 h, o colgados > 0.
-- Si se refuta: si ya se finalizan rápido, el auto-finalize baja a la iter 4.

-- H7 (a) resumen
select count(*) as partidos_jugados,
       count(*) filter (where e.status = 'FINALIZED') as finalizados,
       percentile_cont(0.5) within group (order by e.finalized_at - e.starts_at) as mediana_lag,
       percentile_cont(0.9) within group (order by e.finalized_at - e.starts_at) as p90_lag,
       count(*) filter (where e.status in ('OPEN', 'CLOSED')
                          and e.starts_at < now() - interval '1 day') as colgados
from public.events e
where e.starts_at > now() - interval '6 months'
  and e.starts_at < now()
-- AND e.created_at >= '2026-06-27'
;

-- H7 (b) por mes
select date_trunc('month', e.starts_at at time zone 'America/Argentina/Buenos_Aires')::date as mes,
       count(*) as partidos_jugados,
       count(*) filter (where e.status = 'FINALIZED') as finalizados,
       percentile_cont(0.5) within group (order by e.finalized_at - e.starts_at) as mediana_lag,
       count(*) filter (where e.status in ('OPEN', 'CLOSED')
                          and e.starts_at < now() - interval '1 day') as colgados
from public.events e
where e.starts_at > now() - interval '6 months'
  and e.starts_at < now()
-- AND e.created_at >= '2026-06-27'
group by 1
order by 1;



-- ============================================================
-- LIMPIEZA · ¿Se corrige el roster entre el partido y la finalización?
-- ============================================================
-- Pregunta: cuántas escrituras de roster (moves, bajas, altas, canchas nuevas o
--   editadas) hay entre el inicio del partido y su FINALIZE_EVENT. Con la 0c
--   (AUTO_FINALIZE_ENABLED) el partido se finaliza solo a starts_at + 150 min y,
--   una vez finalizado, no se puede mover ni dar de baja a nadie: lo que hoy se
--   corrige después de ese punto pasaría a necesitar "Reactivar". Decide si se
--   prende el flag y con cuántos minutos.
-- Cómo leerlo:
--   (a) Resumen sobre los finalizados de los últimos 6 meses ya jugados:
--       - pct_con_limpieza: partidos con alguna escritura después del inicio.
--       - pct_despues_de_150: con alguna escritura después de inicio + 150 min.
--         Es la cifra que decide.
--       - moves, bajas y canchas nuevas en la ventana.
--       - mediana y p90 de la última escritura, contada desde el inicio.
--       - reabiertos_tras_finalizar y con_escrituras_tras_finalizar: correcciones
--         que ya hoy necesitan reabrir un partido finalizado.
--   (b) Detalle por partido con limpieza, lo más tardío arriba.
--   La ventana termina en el primer FINALIZE_EVENT después del inicio (si no
--   hay, en finalized_at, que en los eventos viejos se rellenó con updated_at).
--   No cuentan las acciones automáticas (PROMOTE_WAITLIST, COURT_FULL, AUTO_*)
--   ni CLOSE_EVENT / REOPEN_EVENT / FINALIZE_EVENT, que son el cierre en sí.
--   Si AUTO_FINALIZE_AFTER_MINUTES no es 150, cambiá el '150 minutes'.
-- Confirma si (hay limpieza que el auto-finalize cortaría): pct_despues_de_150 ≥ 10.
-- Si se refuta (< 10): prender AUTO_FINALIZE_ENABLED=true con los 150 min por defecto.
--   Si se confirma: AUTO_FINALIZE_AFTER_MINUTES ≈ p90_ultima_escritura (mínimo
--   150). Si ese p90 pasa las 24 h, es un arreglo tardío y no limpieza: prender
--   igual con 150 y corregir con "Reactivar" (el reloj vuelve a correr desde la
--   reapertura).

-- LIMPIEZA (a) resumen
with fin as (
  select e.id as event_id, e.starts_at,
         coalesce(min(a.created_at) filter (where a.action = 'FINALIZE_EVENT'
                                              and a.created_at > e.starts_at),
                  e.finalized_at) as fin_at
  from public.events e
  left join public.event_audit_log a on a.event_id = e.id
  where e.status = 'FINALIZED'
    and e.starts_at > now() - interval '6 months'
    and e.starts_at < now()
  -- AND e.created_at >= '2026-06-27'
  group by e.id, e.starts_at, e.finalized_at
),
w as (
  select f.event_id, a.action, a.created_at, a.created_at < f.fin_at as antes_de_finalizar
  from fin f
  join public.event_audit_log a on a.event_id = f.event_id
  where a.created_at > f.starts_at
    and a.action in ('MOVE_REGISTRATION', 'CANCEL_REGISTRATION', 'CANCEL_EXTERNAL',
                     'REGISTER_USER', 'REGISTER_GUEST', 'REGISTER_EXTERNAL',
                     'CREATE_COURT', 'UPDATE_COURT', 'DELETE_COURT', 'OPEN_COURT',
                     'CLOSE_COURT', 'UPDATE_EVENT')
),
por_partido as (
  select f.event_id,
         count(w.action) filter (where w.antes_de_finalizar) as escrituras,
         count(w.action) filter (where w.antes_de_finalizar
                                   and w.action = 'MOVE_REGISTRATION') as moves,
         count(w.action) filter (where w.antes_de_finalizar
                                   and w.action in ('CANCEL_REGISTRATION', 'CANCEL_EXTERNAL')) as bajas,
         count(w.action) filter (where w.antes_de_finalizar
                                   and w.action = 'CREATE_COURT') as canchas_nuevas,
         count(w.action) filter (where w.antes_de_finalizar
                                   and w.created_at > f.starts_at + interval '150 minutes') as despues_de_150,
         count(w.action) filter (where not w.antes_de_finalizar) as tras_finalizar,
         max(w.created_at) filter (where w.antes_de_finalizar) - f.starts_at as ultima_escritura
  from fin f
  left join w on w.event_id = f.event_id
  where f.fin_at > f.starts_at
  group by f.event_id, f.starts_at
),
reaperturas as (
  select count(distinct a.event_id) as n
  from fin f
  join public.event_audit_log a on a.event_id = f.event_id
  where a.action = 'REOPEN_EVENT'
    and a.metadata->>'previous_status' = 'FINALIZED'
)
select count(*) as partidos_finalizados,
       count(*) filter (where escrituras > 0) as con_limpieza,
       round(100.0 * count(*) filter (where escrituras > 0) / nullif(count(*), 0), 1) as pct_con_limpieza,
       count(*) filter (where despues_de_150 > 0) as con_limpieza_despues_de_150,
       round(100.0 * count(*) filter (where despues_de_150 > 0) / nullif(count(*), 0), 1) as pct_despues_de_150,
       sum(escrituras) as escrituras,
       sum(moves) as moves,
       sum(bajas) as bajas,
       sum(canchas_nuevas) as canchas_nuevas,
       percentile_cont(0.5) within group (order by ultima_escritura) as mediana_ultima_escritura,
       percentile_cont(0.9) within group (order by ultima_escritura) as p90_ultima_escritura,
       (select n from reaperturas) as reabiertos_tras_finalizar,
       count(*) filter (where tras_finalizar > 0) as con_escrituras_tras_finalizar
from por_partido;

-- LIMPIEZA (b) detalle por partido
with fin as (
  select e.id as event_id, e.starts_at,
         coalesce(min(a.created_at) filter (where a.action = 'FINALIZE_EVENT'
                                              and a.created_at > e.starts_at),
                  e.finalized_at) as fin_at
  from public.events e
  left join public.event_audit_log a on a.event_id = e.id
  where e.status = 'FINALIZED'
    and e.starts_at > now() - interval '6 months'
    and e.starts_at < now()
  -- AND e.created_at >= '2026-06-27'
  group by e.id, e.starts_at, e.finalized_at
),
w as (
  select f.event_id, a.action, a.created_at, a.created_at < f.fin_at as antes_de_finalizar
  from fin f
  join public.event_audit_log a on a.event_id = f.event_id
  where a.created_at > f.starts_at
    and a.action in ('MOVE_REGISTRATION', 'CANCEL_REGISTRATION', 'CANCEL_EXTERNAL',
                     'REGISTER_USER', 'REGISTER_GUEST', 'REGISTER_EXTERNAL',
                     'CREATE_COURT', 'UPDATE_COURT', 'DELETE_COURT', 'OPEN_COURT',
                     'CLOSE_COURT', 'UPDATE_EVENT')
)
select f.event_id,
       to_char(f.starts_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as cuando,
       f.fin_at - f.starts_at as finalizado_tras,
       count(w.action) filter (where w.antes_de_finalizar) as escrituras,
       count(w.action) filter (where w.antes_de_finalizar
                                 and w.created_at > f.starts_at + interval '150 minutes') as despues_de_150,
       count(w.action) filter (where not w.antes_de_finalizar) as tras_finalizar,
       max(w.created_at) filter (where w.antes_de_finalizar) - f.starts_at as ultima_escritura,
       string_agg(distinct w.action, ', ') as acciones
from fin f
left join w on w.event_id = f.event_id
where f.fin_at > f.starts_at
group by f.event_id, f.starts_at, f.fin_at
having count(w.action) > 0
order by despues_de_150 desc, escrituras desc, f.starts_at desc;



-- ============================================================
-- REPETIR · ¿Se arma el partido con "Repetir"? (adopción de la 0d)
-- ============================================================
-- Pregunta: desde la 0d, el admin puede repetir un partido en la misma franja
--   +7 días ("Repetir para el jue 29/10", POST /admin/events/{id}/duplicate).
--   Ese CREATE_EVENT lleva metadata.source = 'quick_repeat' y
--   metadata.duplicated_from = el evento original; crear a mano no trae source.
--   Mide qué parte de los eventos nuevos sale de Repetir.
-- Cómo leerlo:
--   (a) Una fila por semana (lunes a domingo, hora argentina) según cuándo se
--       CREÓ el evento: total, cuántos con Repetir y el %. Antes de la 0d da 0%.
--   (b) Lo mismo abierto por franja del partido (día ISO + hora: "2 20:00" =
--       martes 20:00, "4 19:00" = jueves 19:00). Muestra en qué franja se adopta
--       y en cuál se sigue creando a mano.
--   Cada Repetir escribe además un CREATE_COURT por cancha con el mismo source:
--   para la métrica norte (QN v2) cuenta como UNA acción del organizador.
-- Confirma si (la 0d funciona): pct_repetir ≥ 60 en las 3 semanas siguientes al
--   deploy (fila 0d de la sección 8.4 de rediseno-ux.md).
-- Si se refuta: mirar (b). Si una franja no adopta (p. ej. la Escuelita de los
--   martes 19:00), preguntarle al organizador qué cambia de una semana a otra
--   antes de pensar en "Repetir las 3" o en la serie.

-- REPETIR (a) por semana
select to_char(date_trunc('week', a.created_at at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD') as semana,
       count(*) as eventos_creados,
       count(*) filter (where a.metadata->>'source' = 'quick_repeat') as con_repetir,
       round(100.0 * count(*) filter (where a.metadata->>'source' = 'quick_repeat') / count(*), 1) as pct_repetir
from public.event_audit_log a
where a.action = 'CREATE_EVENT'
  and a.created_at > now() - interval '12 weeks'
group by 1
order by 1 desc;

-- REPETIR (b) por semana y franja
select to_char(date_trunc('week', a.created_at at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD') as semana,
       to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'ID HH24:MI') as franja,
       count(*) as eventos_creados,
       count(*) filter (where a.metadata->>'source' = 'quick_repeat') as con_repetir,
       round(100.0 * count(*) filter (where a.metadata->>'source' = 'quick_repeat') / count(*), 1) as pct_repetir
from public.event_audit_log a
join public.events e on e.id = a.event_id
where a.action = 'CREATE_EVENT'
  and a.created_at > now() - interval '12 weeks'
group by 1, 2
order by 1 desc, eventos_creados desc, franja;



-- ============================================================
-- H8 · ¿Pocos votan por el opt-in y no por el costo de votar?
-- ============================================================
-- Pregunta: entre los que jugaron partidos finalizados en los últimos 3 meses,
--   cuántos tienen ranking_opt_in y cuántos votaron. Para votar hace falta el
--   opt-in (de quien vota y de quien recibe).
-- Cómo leerlo: una sola fila. Comparar pct_opt_in con pct_votaron_entre_opt_in.
--   Ojo: ranking_opt_in es el valor ACTUAL del usuario, no el que tenía en
--   ese partido.
-- Confirma si: pct_opt_in < 50.
-- Si se refuta: si el opt-in es alto pero votan poco, el foco va al voto en
--   lote + "No lo vi"; si el opt-in es bajo, la card inline de opt-in va arriba.
with p as (
  select r.event_id,
         r.user_id,
         u.ranking_opt_in,
         exists (select 1
                   from public.player_ratings pr
                  where pr.event_id = r.event_id
                    and pr.voter_user_id = r.user_id) as voto
  from public.event_registrations r
  join public.users u on u.id = r.user_id
  join public.events e on e.id = r.event_id
  where e.status = 'FINALIZED'
    and e.finalized_at > now() - interval '3 months'
    and r.status = 'CONFIRMED'
    and r.registration_type = 'USER'
  -- AND r.created_at >= '2026-06-27'
)
select count(*) as participaciones,
       count(distinct user_id) as jugadores,
       count(*) filter (where ranking_opt_in) as participaciones_con_opt_in,
       round(100.0 * count(*) filter (where ranking_opt_in) / nullif(count(*), 0), 1) as pct_opt_in,
       count(*) filter (where voto) as votaron,
       round(100.0 * count(*) filter (where voto) / nullif(count(*), 0), 1) as pct_votaron,
       round(100.0 * count(*) filter (where voto and ranking_opt_in)
             / nullif(count(*) filter (where ranking_opt_in), 0), 1) as pct_votaron_entre_opt_in
from p;



-- ============================================================
-- H9 · ¿Los invitados se repiten y el límite real es menor a 5?
-- ============================================================
-- Pregunta: ¿la misma persona trae al mismo invitado varias semanas (chips de
--   "recientes")? ¿Cuántos invitados trae alguien en un mismo partido?
--   "Quién invita" = created_by_user_id (el chip usa eso). Se excluyen los
--   invitados falsos del ataque ("Juan Perez" / "JP", ver scripts/forense.sql).
--   Antes del 2026-06-27 created_by_user_id era falsificable: corré también
--   con el filtro de fecha activado.
-- Cómo leerlo:
--   (a) % de invitados (par quién-invita + nombre) que aparecen en ≥2 partidos.
--   (b) Invitados activos por persona y partido: máximo, mediana, p95.
--   (c) Opcional: los nombres repetidos (muestra nombres de pila de invitados;
--       pegalo solo si te parece bien).
-- Confirma si: pct_repetidos ≥ 30 y p95 ≤ 5.
-- Si se refuta: define si hay chips de invitados recientes y el valor de
--   GUEST_LIMIT (hoy la UI dice 5 y el backend 10).

-- H9 (a) invitados repetidos
with g as (
  select r.created_by_user_id, lower(trim(r.guest_name)) as invitado, r.event_id
  from public.event_registrations r
  where r.registration_type = 'GUEST'
    and r.created_at > now() - interval '3 months'
    and coalesce(r.guest_name, '') <> ''
    and r.guest_name not ilike '%juan%perez%'
    and r.guest_name not ilike '%jp%'
  -- AND r.created_at >= '2026-06-27'
),
pares as (
  select created_by_user_id, invitado, count(distinct event_id) as partidos
  from g
  group by 1, 2
)
select count(*) as invitados_distintos,
       count(*) filter (where partidos >= 2) as repetidos_en_2_o_mas_partidos,
       round(100.0 * count(*) filter (where partidos >= 2) / nullif(count(*), 0), 1) as pct_repetidos,
       count(distinct created_by_user_id) as personas_que_invitan
from pares;

-- H9 (b) tope real de invitados por persona y partido
select count(*) as casos_persona_partido,
       max(n) as maximo,
       percentile_cont(0.5) within group (order by n) as mediana,
       percentile_cont(0.95) within group (order by n) as p95,
       count(*) filter (where n > 5) as veces_que_superaron_5
from (
  select r.event_id, r.created_by_user_id, count(*) as n
  from public.event_registrations r
  where r.registration_type = 'GUEST'
    and r.status <> 'CANCELLED'
    and coalesce(r.guest_name, '') not ilike '%juan%perez%'
    and coalesce(r.guest_name, '') not ilike '%jp%'
  -- AND r.created_at >= '2026-06-27'
  group by 1, 2
) t;

-- H9 (c) opcional: nombres repetidos
select r.created_by_user_id,
       lower(trim(r.guest_name)) as invitado,
       count(distinct r.event_id) as partidos
from public.event_registrations r
where r.registration_type = 'GUEST'
  and r.created_at > now() - interval '3 months'
  and coalesce(r.guest_name, '') <> ''
  and r.guest_name not ilike '%juan%perez%'
  and r.guest_name not ilike '%jp%'
-- AND r.created_at >= '2026-06-27'
group by 1, 2
having count(distinct r.event_id) >= 2
order by 3 desc;



-- ============================================================
-- H10 · ¿La gente elige cancha a propósito?
-- ============================================================
-- Pregunta: entre los que jugaron ≥4 partidos, ¿cuántos caen casi siempre en la
--   misma cancha? Como cada evento tiene sus propias filas de cancha, "la misma
--   cancha" = la misma posición dentro del evento (1ª, 2ª, 3ª…, según
--   sort_order y luego orden de creación).
-- Cómo leerlo: una fila. Con 2 canchas, el azar daría ~50% de share; mirá
--   pct_repiten_80. Ojo: court_id es la cancha final (después de los moves del
--   admin), no necesariamente la que eligió el jugador.
-- Confirma si: pct_repiten_80 ≥ 40.
-- Si se refuta: si se confirma, se asigna "tu cancha de siempre" en vez de la
--   primera libre y "elegir cancha" queda más visible; si no, primera libre.
with pos as (
  select c.id as court_id,
         row_number() over (partition by c.event_id order by c.sort_order, c.created_at, c.id) as posicion
  from public.event_courts c
),
x as (
  select r.user_id, pos.posicion, count(*) as n
  from public.event_registrations r
  join pos on pos.court_id = r.court_id
  where r.registration_type = 'USER'
    and r.status = 'CONFIRMED'
  -- AND r.created_at >= '2026-06-27'
  group by 1, 2
),
j as (
  select user_id, sum(n) as partidos, max(n)::numeric / sum(n) as share_misma_cancha
  from x
  group by 1
  having sum(n) >= 4
)
select count(*) as jugadores_con_4_o_mas_partidos,
       count(*) filter (where share_misma_cancha >= 0.8) as repiten_cancha_80,
       round(100.0 * count(*) filter (where share_misma_cancha >= 0.8) / nullif(count(*), 0), 1) as pct_repiten_80,
       round(avg(share_misma_cancha), 2) as share_promedio
from j;



-- ============================================================
-- H11 · ¿Suspender es frecuente?
-- ============================================================
-- Pregunta: hoy no existe "suspender"; se avisa con una notificación global.
--   ¿Cuántos avisos de suspensión hay por mes?
-- Cómo leerlo:
--   (a) Por mes: total de avisos y cuántos parecen de suspensión (por texto).
--       Se excluyen los automáticos "Nuevo en el calendario".
--   (b) La lista de esos avisos, para descartar falsos positivos a ojo.
--   Ojo: las suspensiones avisadas solo por WhatsApp no aparecen acá.
-- Confirma si: ≥1 aviso de suspensión por mes.
-- Si se refuta: si se confirma, "Suspender" pasa de la iter 4 a la iter 2.

-- H11 (a) por mes
select date_trunc('month', n.created_at at time zone 'America/Argentina/Buenos_Aires')::date as mes,
       count(*) as avisos_totales,
       count(*) filter (where n.title ilike '%suspend%' or n.message ilike '%suspend%'
                           or n.title ilike '%lluvia%' or n.message ilike '%lluvia%'
                           or n.title ilike '%se cancela%' or n.message ilike '%se cancela%'
                           or n.title ilike '%cancelad%' or n.message ilike '%cancelad%'
                           or n.message ilike '%no se juega%') as avisos_de_suspension
from public.notifications n
where n.title <> 'Nuevo en el calendario'
-- AND n.created_at >= '2026-06-27'
group by 1
order by 1;

-- H11 (b) lista para revisar
select to_char(n.created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as creado,
       n.title,
       left(n.message, 120) as mensaje
from public.notifications n
where n.title <> 'Nuevo en el calendario'
  and (n.title ilike '%suspend%' or n.message ilike '%suspend%'
       or n.title ilike '%lluvia%' or n.message ilike '%lluvia%'
       or n.title ilike '%se cancela%' or n.message ilike '%se cancela%'
       or n.title ilike '%cancelad%' or n.message ilike '%cancelad%'
       or n.message ilike '%no se juega%')
-- AND n.created_at >= '2026-06-27'
order by n.created_at desc;



-- ============================================================
-- H12 · ¿Dónde gasta escrituras el organizador?
-- ============================================================
-- Pregunta: de todo lo que escribe el organizador (admins, super_admins y quien
--   tenga permisos de eventos/inscripciones/canchas), ¿qué acciones pesan más?
--   Cada acción se agrupa por flujo del rediseño:
--     a · crear el partido y compartir   b · anotar/bajar/espera
--     c · armar equipos                  d · post-partido
--     e · avisos / suspender             otros (usuarios, roles, cuentas)
--   Se excluye lo que no es un toque del organizador: los efectos automáticos
--   (AUTO_CLOSE_COURT, AUTO_CLOSE_EVENT, PROMOTE_WAITLIST), cuando se anota o
--   se baja a sí mismo como jugador, y sus propios invitados (REGISTER_GUEST).
--   Ojo: "organizador" se calcula con los roles ACTUALES.
-- Cómo leerlo: "por_partido" = escrituras de esa acción / partidos del período.
--   Mirá las 3 primeras filas y su "flujo".
-- Confirma si: el top 3 de acciones por partido cae en los flujos a, c y d.
-- Si se refuta: reordena el roadmap (por ejemplo, si domina "b", el hotfix de
--   bajas self-service y la espera visible pasan adelante de todo).
with org as (
  select distinct ur.user_id
  from public.user_roles ur
  join public.roles ro on ro.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = ur.role_id
  left join public.permissions p on p.id = rp.permission_id
  where lower(ro.code) in ('admin', 'super_admin')
     or p.code in ('events.create', 'events.manage', 'registrations.manage', 'courts.manage')
),
w as (
  select a.event_id, a.action
  from public.event_audit_log a
  left join public.event_registrations r on r.id = a.target_registration_id
  where a.actor_user_id in (select user_id from org)
    and a.created_at > now() - interval '6 months'
    and a.action not in ('AUTO_CLOSE_COURT', 'AUTO_CLOSE_EVENT', 'PROMOTE_WAITLIST', 'REGISTER_GUEST')
    and not (a.action in ('REGISTER_USER', 'CANCEL_REGISTRATION') and r.user_id = a.actor_user_id)
  -- AND a.created_at >= '2026-06-27'
)
select w.action,
       case
         when w.action in ('CREATE_EVENT', 'CREATE_COURT', 'UPDATE_COURT', 'DELETE_COURT', 'UPDATE_EVENT',
                           'UPDATE_EVENT_VISIBILITY', 'UPDATE_EVENT_ACCESS', 'ROTATE_SHARE_CODE')
           then 'a · crear/compartir'
         when w.action in ('CANCEL_REGISTRATION', 'REGISTER_USER', 'CLOSE_EVENT', 'REOPEN_EVENT', 'ROTATE_MGMT_TOKEN')
           then 'b · anotar/bajar/espera'
         when w.action in ('MOVE_REGISTRATION', 'OPEN_COURT', 'CLOSE_COURT', 'ASSIGN_CAPTAIN', 'REMOVE_CAPTAIN')
           then 'c · armar equipos'
         when w.action in ('FINALIZE_EVENT')
           then 'd · post-partido'
         when w.action in ('CREATE_NOTIFICATION', 'DEACTIVATE_NOTIFICATION')
           then 'e · avisos/suspender'
         else 'otros (usuarios, roles, cuentas)'
       end as flujo,
       count(*) as escrituras,
       count(distinct w.event_id) as partidos_con_esta_accion,
       round(count(*)::numeric / nullif((select count(distinct event_id) from w), 0), 2) as por_partido,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from w
group by 1, 2
order by 3 desc;



-- ============================================================
-- QN · Métrica norte: escrituras del organizador por partido + bajas self-service
-- ============================================================
-- Pregunta: la línea de base de la métrica norte del rediseño:
--   (1) escrituras del organizador por partido (meta: < 5 en la iter 2 y ≤ 2
--       con la serie), con las mismas exclusiones que H12;
--   (2) % de bajas de jugadores hechas por el propio jugador (meta: 100%).
-- Cómo leerlo:
--   (a) Por semana (lunes a domingo, hora argentina, según la fecha del
--       partido): partidos, mediana y máximo de escrituras del organizador, bajas
--       y % self-service. Es la línea de base que guardamos.
--   (b) Detalle por partido con las acciones que hizo el organizador.
-- Confirma si: no hay umbral; es la foto "antes" contra la que se mide cada
--   iteración. Esperable hoy: mediana alta y % self-service cerca de 0.
-- Si se refuta: si la mediana ya es baja, el argumento de "Repetir" y de la
--   serie se debilita (ver H2) y conviene priorizar bajas/espera.

-- QN (a) línea de base por semana
with org as (
  select distinct ur.user_id
  from public.user_roles ur
  join public.roles ro on ro.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = ur.role_id
  left join public.permissions p on p.id = rp.permission_id
  where lower(ro.code) in ('admin', 'super_admin')
     or p.code in ('events.create', 'events.manage', 'registrations.manage', 'courts.manage')
),
w as (
  select a.event_id, a.action
  from public.event_audit_log a
  left join public.event_registrations r on r.id = a.target_registration_id
  where a.actor_user_id in (select user_id from org)
    and a.event_id is not null
    and a.action not in ('AUTO_CLOSE_COURT', 'AUTO_CLOSE_EVENT', 'PROMOTE_WAITLIST', 'REGISTER_GUEST')
    and not (a.action in ('REGISTER_USER', 'CANCEL_REGISTRATION') and r.user_id = a.actor_user_id)
  -- AND a.created_at >= '2026-06-27'
),
por_partido as (
  select e.id,
         date_trunc('week', e.starts_at at time zone 'America/Argentina/Buenos_Aires') as semana,
         count(w.event_id) as escrituras_org
  from public.events e
  left join w on w.event_id = e.id
  where e.starts_at > now() - interval '6 months'
  group by 1, 2
),
bajas as (
  select date_trunc('week', e.starts_at at time zone 'America/Argentina/Buenos_Aires') as semana,
         count(*) as bajas,
         count(*) filter (where a.actor_user_id = r.user_id) as bajas_self_service
  from public.event_audit_log a
  join public.event_registrations r on r.id = a.target_registration_id
  join public.events e on e.id = a.event_id
  where a.action = 'CANCEL_REGISTRATION'
    and r.registration_type = 'USER'
    and e.starts_at > now() - interval '6 months'
  -- AND a.created_at >= '2026-06-27'
  group by 1
)
select p.semana::date as semana,
       count(*) as partidos,
       percentile_cont(0.5) within group (order by p.escrituras_org) as mediana_escrituras_org,
       max(p.escrituras_org) as max_escrituras_org,
       coalesce(b.bajas, 0) as bajas,
       round(100.0 * b.bajas_self_service / nullif(b.bajas, 0), 1) as pct_bajas_self_service
from por_partido p
left join bajas b on b.semana = p.semana
group by p.semana, b.bajas, b.bajas_self_service
order by p.semana desc;

-- QN (b) detalle por partido
with org as (
  select distinct ur.user_id
  from public.user_roles ur
  join public.roles ro on ro.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = ur.role_id
  left join public.permissions p on p.id = rp.permission_id
  where lower(ro.code) in ('admin', 'super_admin')
     or p.code in ('events.create', 'events.manage', 'registrations.manage', 'courts.manage')
),
w as (
  select a.event_id, a.action
  from public.event_audit_log a
  left join public.event_registrations r on r.id = a.target_registration_id
  where a.actor_user_id in (select user_id from org)
    and a.event_id is not null
    and a.action not in ('AUTO_CLOSE_COURT', 'AUTO_CLOSE_EVENT', 'PROMOTE_WAITLIST', 'REGISTER_GUEST')
    and not (a.action in ('REGISTER_USER', 'CANCEL_REGISTRATION') and r.user_id = a.actor_user_id)
  -- AND a.created_at >= '2026-06-27'
)
select e.id as event_id,
       to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as cuando,
       count(w.event_id) as escrituras_org,
       string_agg(distinct w.action, ', ') as acciones
from public.events e
left join w on w.event_id = e.id
where e.starts_at > now() - interval '6 months'
group by e.id, e.starts_at
order by e.starts_at desc;



-- ============================================================
-- CONTROL · Altas accidentales (baja propia < 2 min después de anotarse)
-- ============================================================
-- Pregunta: cuando llegue "Me anoto" de 1 toque (iter 1), ¿cuánta gente se
--   anota sin querer y se baja enseguida? Se mide por metadata.source del alta:
--   hoy todas dicen 'api'; desde la iter 1 aparecerá 'one_tap'.
-- Cómo leerlo: una fila por source. "tasa_pct" = % de altas seguidas de una baja
--   del mismo actor en menos de 2 min. Hoy el jugador no puede darse de baja
--   solo (403), así que la línea de base sale ~0 y casi toda de admins.
-- Confirma si: (control de la iter 1) tasa_pct < 3 en la fila 'one_tap'.
-- Si se refuta: con ≥3% hay que reforzar el "Deshacer" del toast o volver a
--   pedir confirmación antes de anotar.
select coalesce(a.metadata->>'source', '(sin source)') as source,
       count(*) as altas,
       count(*) filter (where c.created_at - a.created_at < interval '2 minutes') as bajas_propias_menos_2_min,
       round(100.0 * count(*) filter (where c.created_at - a.created_at < interval '2 minutes')
             / nullif(count(*), 0), 2) as tasa_pct
from public.event_audit_log a
left join public.event_audit_log c
  on c.target_registration_id = a.target_registration_id
 and c.action = 'CANCEL_REGISTRATION'
 and c.actor_user_id = a.actor_user_id
where a.action = 'REGISTER_USER'
-- AND a.created_at >= '2026-06-27'
group by 1
order by 2 desc;



-- ============================================================
-- INVENTARIO · ¿Qué features se usan de verdad?
-- ============================================================
-- Pregunta: qué partes de la app tienen uso real y cuáles casi nadie toca
--   (para saber qué mantener visible, qué esconder en "⋯" y qué sacar).
-- Cómo leerlo:
--   (a) Una fila por feature con su conteo (foto actual, sin filtro de fecha).
--       Para eventos con clave se mira access_mode, nunca la clave.
--   (b) Todas las acciones del audit log: cuántas veces, cuántos actores
--       distintos y primera/última vez (hora argentina).
-- Confirma si: no hay umbral. Un conteo en 0 o casi 0 (ej. GLOBAL, close_at,
--   LINK_PASSWORD, EXTERNAL, capitanes) es candidato a salir del camino
--   principal del rediseño.
-- Si se refuta: si algo que pensábamos sacar (ej. close_at, avisos del
--   calendario) tiene uso, se mantiene visible en el rediseño.

-- INVENTARIO (a) uso de features
select 'events · total' as feature, count(*) as n from public.events
union all select 'events · visibility GLOBAL', count(*) from public.events where visibility = 'GLOBAL'
union all select 'events · con description', count(*) from public.events where coalesce(trim(description), '') <> ''
union all select 'events · con close_at', count(*) from public.events where close_at is not null
union all select 'events · access_mode distinto de MEMBERS_ONLY', count(*) from public.events where access_mode <> 'MEMBERS_ONLY'
union all select 'events · access_mode LINK_ACCESS', count(*) from public.events where access_mode = 'LINK_ACCESS'
union all select 'events · access_mode LINK_PASSWORD', count(*) from public.events where access_mode = 'LINK_PASSWORD'
union all select 'events · allow_external_registration', count(*) from public.events where allow_external_registration
union all select 'registrations · total', count(*) from public.event_registrations
union all select 'registrations · GUEST', count(*) from public.event_registrations where registration_type = 'GUEST'
union all select 'registrations · EXTERNAL', count(*) from public.event_registrations where registration_type = 'EXTERNAL'
union all select 'registrations · en espera ahora (WAITLIST)', count(*) from public.event_registrations where status = 'WAITLIST'
union all select 'event_captains · filas', count(*) from public.event_captains
union all select 'event_court_captains · filas', count(*) from public.event_court_captains
union all select 'calendar_announcements · filas', count(*) from public.calendar_announcements
union all select 'notifications · filas', count(*) from public.notifications
union all select 'notifications · automáticas "Nuevo en el calendario"', count(*) from public.notifications where title = 'Nuevo en el calendario'
union all select 'user_notification_dismissals · filas', count(*) from public.user_notification_dismissals
union all select 'users · total', count(*) from public.users
union all select 'users · status ACTIVE', count(*) from public.users where status = 'ACTIVE'
union all select 'users · status PENDING', count(*) from public.users where status = 'PENDING'
union all select 'users · con avatar_url', count(*) from public.users where coalesce(trim(avatar_url), '') <> ''
union all select 'users · con nickname', count(*) from public.users where coalesce(trim(nickname), '') <> ''
union all select 'users · ranking_opt_in', count(*) from public.users where ranking_opt_in
union all select 'users · player_level distinto de RECREATIVO', count(*) from public.users where player_level <> 'RECREATIVO'
union all select 'player_ratings · total', count(*) from public.player_ratings
union all select 'player_ratings · con comment', count(*) from public.player_ratings where coalesce(trim(comment), '') <> ''
union all select 'player_ratings · ocultos (is_hidden)', count(*) from public.player_ratings where is_hidden
union all select 'player_ratings · editados (updated_at > created_at)', count(*) from public.player_ratings where updated_at > created_at
union all select 'pin_unlock_requests · filas', count(*) from public.pin_unlock_requests;

-- INVENTARIO (b) acciones del audit log
select a.action,
       count(*) as n,
       count(distinct a.actor_user_id) as actores_distintos,
       min(a.created_at) at time zone 'America/Argentina/Buenos_Aires' as primera_vez,
       max(a.created_at) at time zone 'America/Argentina/Buenos_Aires' as ultima_vez
from public.event_audit_log a
where a.action is not null
-- AND a.created_at >= '2026-06-27'
group by 1
order by 2 desc;



-- ============================================================
-- ACTIVOS · Usuarios activos por semana
-- ============================================================
-- Pregunta: cuánta gente distinta hace algo en la app cada semana, y por dónde
--   (escrituras del audit log, votos, descartar avisos, pedir desbloqueo de PIN).
-- Cómo leerlo: una fila por semana (lunes a domingo, hora argentina), las más
--   recientes arriba. "usuarios_activos" no es la suma de las columnas: una
--   persona puede aparecer en varias. Ojo: mide gente que ESCRIBE algo; la que
--   solo mira la app no deja rastro. Las acciones sin actor (externos,
--   desbloqueo de evento con clave) no cuentan.
--   user_notification_dismissals no tiene created_at: se usa dismissed_at.
-- Confirma si: no hay umbral. Sirve para dimensionar el rollout (iter 1) y
--   como denominador de las otras métricas (% que vota, % que se anota solo…).
-- Si se refuta: si los activos semanales son muchos menos que los anotados,
--   la gente se anota por otro canal (el admin por WhatsApp) y eso refuerza el
--   "Me anoto" de 1 toque y el link compartible.
with actividad as (
  select a.actor_user_id as user_id, a.created_at as cuando, 'audit' as fuente
  from public.event_audit_log a
  where a.actor_user_id is not null
  -- AND a.created_at >= '2026-06-27'
  union all
  select pr.voter_user_id, pr.created_at, 'votos'
  from public.player_ratings pr
  where pr.voter_user_id is not null
  -- AND pr.created_at >= '2026-06-27'
  union all
  select pr.voter_user_id, pr.updated_at, 'votos'
  from public.player_ratings pr
  where pr.updated_at > pr.created_at   -- votos editados: cuenta la semana de la edición
  -- AND pr.updated_at >= '2026-06-27'
  union all
  select d.user_id, d.dismissed_at, 'avisos'
  from public.user_notification_dismissals d
  where d.dismissed_at is not null
  -- AND d.dismissed_at >= '2026-06-27'
  union all
  select pu.user_id, pu.created_at, 'pin'
  from public.pin_unlock_requests pu
  where pu.user_id is not null
  -- AND pu.created_at >= '2026-06-27'
)
select date_trunc('week', cuando at time zone 'America/Argentina/Buenos_Aires')::date as semana,
       count(distinct user_id) as usuarios_activos,
       count(distinct user_id) filter (where fuente = 'audit') as escribieron_en_audit,
       count(distinct user_id) filter (where fuente = 'votos') as votaron,
       count(distinct user_id) filter (where fuente = 'avisos') as descartaron_avisos,
       count(distinct user_id) filter (where fuente = 'pin') as pidieron_desbloqueo_pin,
       count(*) as acciones
from actividad
group by 1
order by 1 desc;
