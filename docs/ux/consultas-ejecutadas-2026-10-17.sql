-- ============================================================
-- CONSULTAS EJECUTADAS EN PRODUCCIÓN — 17/10/2026
-- Rediseño UX: qué se midió, cómo y qué dio.
-- ============================================================
--
-- Contexto
--   Se corrieron en el SQL Editor de Supabase (proyecto de producción), todas
--   SELECT: ninguna escribe. Son versiones compactas de las de
--   docs/ux/consultas-comportamiento.sql: cada una devuelve UNA fila con un JSON,
--   porque la grilla de Supabase oculta filas y corta el texto largo.
--   Acá están formateadas para leerlas; la lógica es la misma que se ejecutó.
--
-- De dónde salen los datos
--   - event_audit_log: una fila por cada ESCRITURA (anotarse, bajarse, mover,
--     crear evento/cancha, abrir/cerrar, finalizar...), con quién la hizo
--     (actor_user_id) y cuándo (created_at). NO registra lecturas, toques,
--     tiempo en pantalla ni lo que se tipea antes de guardar.
--   - events, event_courts, event_registrations: el estado actual de partidos,
--     canchas e inscripciones.
--   - player_ratings: los votos. users: ranking_opt_in es el valor ACTUAL,
--     no el que tenía cada jugador en la fecha del partido.
--   - Antes del 27/6/2026 el actor se podía falsificar (token sin firmar): las
--     consultas que dependen de "quién lo hizo" usan created_at >= '2026-06-27'.
-- ============================================================


-- ------------------------------------------------------------
-- 1. INVENTARIO · ¿Qué acciones existen y cuánto se usa cada una?
-- ------------------------------------------------------------
-- Mide: cuántas veces aparece cada acción en el audit log y cuánta gente
--   distinta la hizo (todas las fechas y desde el 27/6).
-- Para qué: ver de un vistazo dónde está el trabajo y qué features no se usan.
select json_agg(t) from (
  select a.action,
         count(*)                                         as n,
         count(distinct a.actor_user_id)                  as actores,
         count(*) filter (where a.created_at >= '2026-06-27') as n_desde_jun27
  from public.event_audit_log a
  group by 1
  order by 2 desc
) t;
-- Resultado (todas las fechas): REGISTER_USER 2204 (183 personas) ·
--   CANCEL_REGISTRATION 438 (13) · REGISTER_GUEST 304 (39) · CREATE_COURT 250 (9) ·
--   AUTO_CLOSE_COURT 241 · OPEN_COURT 185 (11) · MOVE_REGISTRATION 163 (7) ·
--   CREATE_EVENT 138 (9) · FINALIZE_EVENT 136 (7) · AUTO_CLOSE_EVENT 125 ·
--   CLOSE_EVENT 98 · REOPEN_EVENT 86 · UPDATE_COURT 84 · CLOSE_COURT 63 ·
--   ... PROMOTE_WAITLIST 7 · UPDATE_EVENT_ACCESS 7.
-- Lectura: las bajas las hacen 13 personas (organizadores), no los jugadores;
--   185 reaperturas manuales de cancha contra 7 promociones desde la espera.

-- 1b. Roles y usuarios (mismo run que el resto del inventario)
select json_build_object(
  'roles',    (select json_agg(json_build_array(ro.code,
                 (select count(*) from public.user_roles ur where ur.role_id = ro.id)))
               from public.roles ro),
  'usuarios', (select json_build_array(count(*),
                 count(*) filter (where is_active),
                 count(*) filter (where ranking_opt_in))
               from public.users)
);
-- Resultado: admin 16 personas, super_admin 11, captain 2, gestion_* 1–3.
--   Usuarios: 1475 registrados, 1462 activos, 59 con ranking_opt_in.


-- ------------------------------------------------------------
-- 2. H1 · ¿El partido se repite igual cada semana?
-- ------------------------------------------------------------
-- Mide: para los partidos de los últimos 6 meses, la "franja" (día de la
--   semana + hora, en hora argentina) y, por franja: cuántos partidos, en
--   cuántas semanas distintas, con cuántos lugares, títulos y cupos distintos.
--   El lugar se normaliza (minúsculas, sin espacios al borde) para no contar
--   "Poli Pedraza " y "poli pedraza" como dos lugares.
-- Para qué: si los partidos son siempre los mismos, conviene "Repetir" (y más
--   adelante un partido fijo que se publique solo) en vez de crear desde cero.
with e as (
  select e.id, e.title, e.starts_at,
         to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'Dy HH24:MI') as s,
         lower(trim(e.location_name)) as l,
         (select count(*)      from public.event_courts c where c.event_id = e.id) as nc,
         (select sum(capacity) from public.event_courts c where c.event_id = e.id) as cap
  from public.events e
  where e.starts_at > now() - interval '6 months'
)
select json_build_object(
  'slots', (select json_agg(json_build_array(s, n, semanas, lugares, titulos, canchas, cupo)) from (
      select s, count(*) n,
             count(distinct date_trunc('week', starts_at)) semanas,
             count(distinct l) lugares, count(distinct title) titulos,
             string_agg(distinct nc::text, '/') canchas,
             string_agg(distinct cap::text, '/') cupo
      from e group by 1 order by 2 desc limit 8) t),
  'titulos_top', (select json_agg(json_build_array(left(title, 28), n)) from (
      select title, count(*) n from e group by 1 order by 2 desc limit 8) t),
  'lugares', (select json_agg(json_build_array(l, n)) from (
      select l, count(*) n from e group by 1 order by 2 desc limit 8) t)
);
-- (Una corrida previa, sin normalizar, agregó: por día martes 54 / jueves 28 /
--  viernes 7 / domingo 2; partidos por semana: 3 en 16 semanas, 4 en 9;
--  mediana entre crear el evento y jugarlo: 113,8 h ≈ 4,7 días.)
-- Resultado: 91 partidos. Mar 19:00 = 27 partidos en 24 semanas · Jue 19:00 = 25
--   en 25 · Mar 20:00 = 25 en 24 → 77 de 91 (85%) en 3 franjas fijas.
--   Pero por franja hubo 17–24 títulos distintos y 5–9 formas de escribir el
--   lugar ("poli pedraza", "el poli", "el poli pedraza", "poli cramer"...).
--   El cupo cambia: el jueves va de 1 a 5 canchas.
-- Límite: no sabemos si el lugar distinto es otro lugar o el mismo mal escrito.


-- ------------------------------------------------------------
-- 3. H2 · ¿Cuánto cuesta armar cada partido en la app?
-- ------------------------------------------------------------
-- Mide: por cada evento, las escrituras de armado (crear evento, crear/editar/
--   borrar cancha, editar evento, acceso/visibilidad, abrir/cerrar cancha) que
--   pasaron en las 2 horas desde CREATE_EVENT: cuántas, cuánto tiempo hubo
--   entre la primera y la última, cuántas canchas y si hubo correcciones.
-- Para qué: dimensionar el ahorro de "Repetir".
with t0 as (
  select event_id, min(created_at) t0
  from public.event_audit_log where action = 'CREATE_EVENT' group by 1
), s as (
  select a.event_id,
         count(*) w,
         extract(epoch from max(a.created_at) - min(a.created_at)) / 60 m,
         count(*) filter (where a.action = 'CREATE_COURT') c,
         count(*) filter (where a.action in ('UPDATE_COURT','DELETE_COURT','UPDATE_EVENT')) f,
         count(*) filter (where a.action in ('UPDATE_EVENT_ACCESS','UPDATE_EVENT_VISIBILITY')) ac
  from public.event_audit_log a join t0 using (event_id)
  where a.created_at < t0.t0 + interval '2 hours'
    and a.action in ('CREATE_EVENT','CREATE_COURT','DELETE_COURT','UPDATE_COURT','UPDATE_EVENT',
                     'UPDATE_EVENT_ACCESS','UPDATE_EVENT_VISIBILITY','OPEN_COURT','CLOSE_COURT')
  group by 1
)
select json_build_object(
  'eventos', count(*),
  'med_escrituras', percentile_cont(.5)  within group (order by w),
  'p75',            percentile_cont(.75) within group (order by w),
  'max', max(w),
  'med_min', round((percentile_cont(.5)  within group (order by m))::numeric, 1),
  'p75_min', round((percentile_cont(.75) within group (order by m))::numeric, 1),
  'prom_canchas', round(avg(c), 2),
  'con_correcciones', count(*) filter (where f > 0),
  'con_acceso',       count(*) filter (where ac > 0),
  'sin_canchas_en_2h', count(*) filter (where c = 0),
  'canchas_en_evento_ya_jugado', (select count(*) from public.event_audit_log a
      join public.events e on e.id = a.event_id
      where a.action = 'CREATE_COURT' and a.created_at > e.starts_at),
  'creadores', (select json_agg(json_build_array(n)) from (
      select count(*) n from public.event_audit_log where action = 'CREATE_EVENT'
      group by actor_user_id order by 1 desc) x)
) from s;
-- Resultado: 138 eventos. Mediana 2 escrituras (p75 4, máx 7) en 0,6 min
--   (p75 1,2 min). 1,57 canchas por evento. 19 con correcciones (14%), 13 sin
--   canchas a las 2 h (9%), 3 canchas creadas en un evento ya jugado. Una sola
--   persona creó 90 de los 138 (65%).
-- Límite importante: el reloj arranca cuando se GUARDA el evento. El tiempo de
--   completar el formulario, los toques y el tipeo no quedan registrados.


-- ------------------------------------------------------------
-- 4. QN · ¿Cuánto trabajo le da cada partido a los organizadores? (métrica norte)
-- ------------------------------------------------------------
-- Mide: desde el 27/6, todas las escrituras hechas por organizadores (roles
--   admin, super_admin, captain, gestion_eventos) que caen en un evento,
--   SIN contar cuando se anotan o se bajan ellos mismos como jugadores.
--   Da la distribución por partido y el promedio por partido de cada acción.
-- Para qué: es la línea de base contra la que medimos el rediseño.
with org as (
  select distinct ur.user_id
  from public.user_roles ur join public.roles ro on ro.id = ur.role_id
  where ro.code in ('admin','super_admin','captain','gestion_eventos')
), x as (
  select a.event_id, a.action
  from public.event_audit_log a
  left join public.event_registrations r on r.id = a.target_registration_id
  where a.actor_user_id in (select user_id from org)
    and a.event_id is not null
    and a.created_at >= '2026-06-27'
    and not (a.action in ('REGISTER_USER','CANCEL_REGISTRATION') and r.user_id = a.actor_user_id)
), w as (
  select event_id, count(*) n from x group by 1
)
select json_build_object(
  'eventos', count(*),
  'med', percentile_cont(.5)  within group (order by n),
  'p75', percentile_cont(.75) within group (order by n),
  'p90', percentile_cont(.9)  within group (order by n),
  'max', max(n),
  'por_accion', (select json_agg(json_build_array(action, n, round(n::numeric / (select count(*) from w), 2)))
                 from (select action, count(*) n from x group by 1 order by 2 desc limit 12) t)
) from w;
-- Resultado: 60 partidos. Mediana 8 escrituras del organizador por partido
--   (p75 16, p90 26, máx 56). Promedio por partido: CREATE_COURT 1,93 ·
--   CANCEL_REGISTRATION 1,58 · REGISTER_GUEST 1,45 · MOVE_REGISTRATION 1,35 ·
--   FINALIZE_EVENT 0,95 · CREATE_EVENT 0,95 · OPEN_COURT 0,92 · UPDATE_COURT 0,83 ·
--   CLOSE_EVENT 0,65 · REOPEN_EVENT 0,37 · AUTO_CLOSE_COURT 0,37 · CLOSE_COURT 0,30.
-- Límite: un admin que además juega cuenta como organizador en todo lo que no
--   sea su propia alta o baja (por ejemplo, si carga un invitado propio).


-- ------------------------------------------------------------
-- 5. H4 + H7 + H11 · bajas, finalización y suspensiones
-- ------------------------------------------------------------
-- H4 mide: cada CANCEL_REGISTRATION desde el 27/6, separado en "propia" (el
--   que la hizo es el inscripto) o "de otro", por tipo (USER/GUEST) y por
--   anticipación respecto del partido (<6 h, 6–24 h, >24 h, después de empezar).
-- H7 mide: para los eventos FINALIZED de los últimos 4 meses, cuántas horas
--   pasaron entre el inicio del partido y la finalización (que es lo que abre
--   los votos), y si quedó alguno sin finalizar.
-- H11 mide: avisos (notifications) cuyo título o texto mencione suspender,
--   lluvia o cancelar.
select json_build_object(
  'h4_bajas', (select json_agg(json_build_array(propia, tipo, ant, n)) from (
      select (a.actor_user_id = r.user_id) propia, r.registration_type tipo,
             case when e.starts_at - a.created_at < interval '0'        then 'despues'
                  when e.starts_at - a.created_at < interval '6 hours'  then '<6h'
                  when e.starts_at - a.created_at < interval '24 hours' then '6-24h'
                  else '>24h' end ant,
             count(*) n
      from public.event_audit_log a
      join public.event_registrations r on r.id = a.target_registration_id
      join public.events e on e.id = a.event_id
      where a.action = 'CANCEL_REGISTRATION' and a.created_at >= '2026-06-27'
      group by 1,2,3 order by 1,2,3) t),
  'h7', (select json_build_object(
      'finalizados', count(*) filter (where status = 'FINALIZED'),
      'med_h', round((percentile_cont(.5)  within group (order by extract(epoch from finalized_at - starts_at)/3600) filter (where status = 'FINALIZED'))::numeric, 1),
      'p75_h', round((percentile_cont(.75) within group (order by extract(epoch from finalized_at - starts_at)/3600) filter (where status = 'FINALIZED'))::numeric, 1),
      'p90_h', round((percentile_cont(.9)  within group (order by extract(epoch from finalized_at - starts_at)/3600) filter (where status = 'FINALIZED'))::numeric, 1),
      'colgados', count(*) filter (where status in ('OPEN','CLOSED') and starts_at < now() - interval '1 day'),
      'antes_de_jugar', count(*) filter (where status = 'FINALIZED' and finalized_at < starts_at))
    from public.events where starts_at > now() - interval '4 months'),
  'h11', (select json_agg(json_build_array(to_char(created_at, 'YYYY-MM'), left(title, 30)))
          from public.notifications
          where title ilike '%suspend%' or message ilike '%suspend%' or message ilike '%lluvia%'
             or title ilike '%lluvia%' or title ilike '%cancel%'),
  'notifs_total', (select count(*) from public.notifications)
);
-- Resultado H4: jugadores (USER) dados de baja por otro = 95 (17 a <6 h, 14 a
--   6–24 h, 64 a >24 h); propias = 38 (5 / 10 / 22 / 1 después). → 71% de las
--   bajas de jugadores las hizo otra persona; 35% fueron a menos de 24 h.
--   Invitados: 26.
--   Ojo: hasta el 17/10 la baja propia daba 403 salvo a admins. Las 38 "propias"
--   son casi todas de organizadores que también juegan.
-- Resultado H7: 59 finalizados; mediana 37,9 h después del partido (p75 49,3 h,
--   p90 65,2 h); 0 colgados; 1 finalizado antes de jugarse.
-- Resultado H11: ningún aviso de suspensión en las 64 notificaciones.
--   Límite: las suspensiones pueden avisarse solo por WhatsApp; la app no lo ve.


-- ------------------------------------------------------------
-- 6. H5 + H6 + H8 · llenado, armado de equipos y votos
-- ------------------------------------------------------------
-- H5 mide: de los partidos jugados desde el 27/6, cuántos se llenaron (tienen
--   AUTO_CLOSE_EVENT) y cuántas horas pasaron desde que se creó el evento.
-- H6 mide: cuántos de esos partidos tuvieron MOVE_REGISTRATION (mover jugadores
--   entre canchas) y cuántos, reaperturas manuales (OPEN_COURT / REOPEN_EVENT).
-- H8 mide: en partidos finalizados de los últimos 3 meses, cada participación
--   confirmada de un socio: si hoy tiene ranking_opt_in y si votó en ese partido.
--   Más: cuántos jugadores recibieron votos y cuántos de ellos llegan al mínimo
--   de 3 votantes distintos que exige el puntaje.
with ev as (
  select e.id, e.created_at, e.starts_at from public.events e
  where e.starts_at > '2026-06-27' and e.starts_at < now()
), mv as (
  select ev.id,
         count(a.id) filter (where a.action = 'MOVE_REGISTRATION') m,
         count(a.id) filter (where a.action in ('OPEN_COURT','REOPEN_EVENT')) ro,
         min(a.created_at) filter (where a.action = 'AUTO_CLOSE_EVENT') full_at
  from ev left join public.event_audit_log a on a.event_id = ev.id
  group by ev.id
), p as (
  select r.event_id, r.user_id, u.ranking_opt_in o
  from public.event_registrations r
  join public.users u on u.id = r.user_id
  join public.events e on e.id = r.event_id
  where e.status = 'FINALIZED' and e.finalized_at > now() - interval '3 months'
    and r.status = 'CONFIRMED' and r.registration_type = 'USER'
)
select json_build_object(
  'h6', (select json_build_object('eventos', count(*), 'con_moves', count(*) filter (where m > 0),
          'med_moves_si_hay', percentile_cont(.5) within group (order by m) filter (where m > 0),
          'p90', percentile_cont(.9) within group (order by m), 'max', max(m),
          'con_reaperturas', count(*) filter (where ro > 0), 'reaperturas', sum(ro)) from mv),
  'h5', (select json_build_object('llenos', count(full_at),
          'med_h_hasta_lleno', round((percentile_cont(.5)  within group (order by extract(epoch from full_at - e.created_at)/3600))::numeric, 1),
          'p25',               round((percentile_cont(.25) within group (order by extract(epoch from full_at - e.created_at)/3600))::numeric, 1))
         from mv join public.events e on e.id = mv.id),
  'h8', (select json_build_object('participaciones', count(*), 'con_optin', count(*) filter (where o),
          'votaron', count(*) filter (where exists (select 1 from public.player_ratings pr
                                                    where pr.event_id = p.event_id and pr.voter_user_id = p.user_id)),
          'jugadores', count(distinct user_id), 'jugadores_optin', count(distinct user_id) filter (where o)) from p),
  'targets', (select json_build_object('con_votos', count(*), 'con_3_o_mas_votantes', count(*) filter (where v >= 3))
              from (select target_user_id, count(distinct voter_user_id) v from public.player_ratings
                    where created_at > now() - interval '3 months' group by 1) x)
);
-- Resultado H5: 23 de 55 partidos se llenaron (42%); mediana 45,9 h desde la
--   creación (p25 25,3 h).
-- Resultado H6: 12 de 55 partidos (22%) tuvieron moves (mediana 4,5 cuando hay;
--   máx 21). 20 partidos con reaperturas manuales, 73 en total.
-- Resultado H8: 761 participaciones de 105 jugadores; 468 (61%) de gente con
--   opt-in (47 jugadores, 45%); votaron en 152 (20% del total; 32% de las que
--   tienen opt-in). 46 jugadores recibieron votos; 42 con ≥3 votantes.
-- Límite H8: el opt-in es el de hoy; alguien pudo activarlo después del partido.


-- ------------------------------------------------------------
-- 7. H3 + H9 + H10 · fijos, invitados y cancha de siempre
-- ------------------------------------------------------------
-- H3 mide: en las últimas 12 semanas y por franja (día + hora), cuántos socios
--   fueron a ≥75% y a ≥50% de los partidos de esa franja, y cuántos se anotan
--   en la primera hora después de publicado en ≥75% de sus partidos.
-- H9 mide: nombres de invitados (normalizados, por anfitrión) en 3 meses:
--   cuántos se repiten en ≥2 partidos, y cuántos invitados carga cada anfitrión
--   por partido (mediana, p95, máximo).
-- H10 mide: si los jugadores repiten cancha. Primero se hizo por sort_order;
--   ver la nota abajo.
with ev as (
  select e.id, e.created_at,
         to_char(e.starts_at at time zone 'America/Argentina/Buenos_Aires', 'Dy HH24') slot
  from public.events e
  where e.starts_at > now() - interval '12 weeks' and e.starts_at < now()
), reg as (
  select r.event_id, r.user_id, min(r.created_at) t
  from public.event_registrations r join ev on ev.id = r.event_id
  where r.registration_type = 'USER' and r.status <> 'CANCELLED'
  group by 1,2
), us as (
  select reg.user_id, ev.slot, count(*) n,
         count(*) filter (where reg.t - ev.created_at < interval '60 minutes') rap
  from reg join ev on ev.id = reg.event_id group by 1,2
), sl as (
  select slot, count(*) partidos from ev group by 1
), g as (
  select created_by_user_id h, lower(trim(guest_name)) gn, count(distinct event_id) n
  from public.event_registrations
  where registration_type = 'GUEST' and created_at > now() - interval '3 months'
  group by 1,2
), gp as (
  select event_id, created_by_user_id, count(*) n
  from public.event_registrations
  where registration_type = 'GUEST' and status <> 'CANCELLED' and created_at > now() - interval '3 months'
  group by 1,2
)
select json_build_object(
  'h3', (select json_agg(json_build_array(sl.slot, sl.partidos,
           (select count(*) from us where us.slot = sl.slot and us.n >= 0.75 * sl.partidos),
           (select count(*) from us where us.slot = sl.slot and us.n >= 0.5  * sl.partidos),
           (select count(*) from us where us.slot = sl.slot and us.n >= 4 and us.rap >= 0.75 * us.n)))
         from sl where sl.partidos >= 4),
  'h9', (select json_build_object('nombres', count(*), 'repetidos_2mas', count(*) filter (where n >= 2), 'top_rep', max(n)) from g),
  'h9_tope', (select json_build_object('max', max(n),
               'p95', percentile_cont(.95) within group (order by n),
               'p50', percentile_cont(.5)  within group (order by n)) from gp)
);
-- Resultado H3 (franja, partidos, socios ≥75%, socios ≥50%, rápidos):
--   Mar 19 → 15 · 0 · 1 · 0   |   Jue 19 → 12 · 5 · 22 · 1   |   Mar 20 → 10 · 5 · 10 · 0
--   → el núcleo de fijos es chico frente a cupos de 10 a 50.
-- Resultado H9: 116 nombres de invitados; solo 11 (9%) aparecen en ≥2 partidos
--   (máx 3). Por anfitrión y partido: mediana 1, p95 3, máx 6.

-- 7b. H10 corregida: por NOMBRE de cancha, y chequeo de sort_order
-- Nota: la primera versión agrupó por sort_order y dio que 74 de 75 jugadores
--   "siempre" van a la misma cancha. Era un artefacto: en 46 de 49 eventos con
--   varias canchas todas tienen sort_order = 1 (el formulario arranca en 1 y no
--   se cambia). Por eso se repitió agrupando por nombre.
with multi as (
  select event_id from public.event_courts group by 1 having count(*) > 1
), cc as (
  select r.user_id, lower(trim(c.name)) cn, count(*) n
  from public.event_registrations r join public.event_courts c on c.id = r.court_id
  where r.registration_type = 'USER' and r.status = 'CONFIRMED'
    and r.event_id in (select event_id from multi)
  group by 1,2
), cu as (
  select user_id, max(n)::numeric / sum(n) s from cc group by 1 having sum(n) >= 4
)
select json_build_object(
  'eventos_multi', (select count(*) from multi),
  'eventos_multi_sort_repetido', (select count(*) from (
      select event_id from public.event_courts where event_id in (select event_id from multi)
      group by 1 having count(distinct sort_order) < count(*)) x),
  'h10_por_nombre', (select json_build_object('jugadores', count(*),
      'misma_80', count(*) filter (where s >= 0.8), 'mas_60', count(*) filter (where s >= 0.6),
      'med', round((percentile_cont(.5) within group (order by s))::numeric, 2)) from cu),
  'nombres_cancha', (select json_agg(json_build_array(cn, n)) from (
      select lower(trim(name)) cn, count(*) n from public.event_courts
      where event_id in (select event_id from multi) group by 1 order by 2 desc limit 8) t)
);
-- Resultado: 49 eventos multi-cancha; 46 con sort_order repetido. 75 jugadores
--   con ≥4 partidos: ninguno repite la misma cancha ≥80% (3 llegan a ≥60%);
--   mediana 0,29. Los nombres son canchas físicas ("cancha 5", "cancha 13"...).
-- Límite: si la cancha física cambia de número de un día a otro, "misma cancha"
--   por nombre subestima la costumbre.


-- ------------------------------------------------------------
-- 8. Workarounds · ¿usan canchas para otra cosa?
-- ------------------------------------------------------------
-- Mide: canchas de los últimos 6 meses cuyo nombre indica que en realidad son
--   un EQUIPO (equipo, blanco, negro, azul, rojo, pechera, titular...) o una
--   LISTA DE ESPERA armada a mano (espera, suplente, reserva, banco, lista).
select json_build_object(
  'por_tipo', (select json_agg(json_build_array(k, courts, eventos)) from (
      select k, count(*) courts, count(distinct event_id) eventos from (
        select c.event_id,
               case when lower(c.name) ~ '(espera|suplente|reserva|banco|lista)' then 'espera_manual'
                    when lower(c.name) ~ '(equipo|blanco|negro|azul|rojo|verde|amarill|claro|oscuro|pechera|titular)' then 'equipo'
                    else 'cancha' end k
        from public.event_courts c join public.events e on e.id = c.event_id
        where e.starts_at > now() - interval '6 months') c
      group by 1) t)
);
-- Resultado: de 91 partidos, 5 usaron 12 "canchas" como equipos ("equipo
--   blanco", "equipo negro", "equipo azul camiseta tt"...) y 9 tuvieron una
--   "cancha" de lista de espera manual ("sala de espera", "suplentes",
--   "suplentes | lista de espera"). ~15% de los partidos con un parche.
-- Límite: es una búsqueda por palabras; puede haber parches con otros nombres.


-- ------------------------------------------------------------
-- ACTIVOS · usuarios activos por semana (la corrió el usuario, del archivo
--   consultas-comportamiento.sql, sección ACTIVOS)
-- ------------------------------------------------------------
-- Mide: personas distintas por semana que ESCRIBIERON algo (audit, votos,
--   descartar avisos, pedir desbloqueo de PIN). No cuenta a quien solo mira.
-- Resultado: mediana 47,5 por semana desde el 29/6 (41–58); 93% solo vía audit;
--   votan ~8 por semana (16% de los activos; 23% en feb–jun).
