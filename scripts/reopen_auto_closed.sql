-- scripts/reopen_auto_closed.sql — data fix de la iteración 0a (rediseño UX)
--
-- Con AUTO_CLOSE_ON_FULL=false las canchas llenas ya no se cierran solas. Este
-- script deshace los cierres automáticos que quedaron en partidos FUTUROS:
--   1. Reabre las canchas cuyo último cambio de estado fue AUTO_CLOSE_COURT.
--   2. Reabre los eventos cuyo último cambio de estado fue AUTO_CLOSE_EVENT.
--   3. Pasa gente de la lista de espera a las canchas abiertas con lugar.
-- No toca nada que haya cerrado una persona a mano (CLOSE_COURT, CLOSE_EVENT o un
-- UPDATE_COURT con is_open posterior al cierre automático).
--
-- Cómo correrlo (consola Postgres de Railway o psql), DESPUÉS del deploy:
--   a) Sección 1: solo lectura. Muestra qué se reabriría y a quién se promovería.
--   b) Sección 2: aplica el arreglo en una transacción. Todo queda en
--      event_audit_log con metadata.source = 'data_fix' y system = true. En
--      producción actor_user_id es NOT NULL: el actor es quien creó el partido
--      o, si el evento no lo tiene, el primer super_admin/admin.
-- Es idempotente: una segunda corrida no cambia nada.


-- ============================================================
-- SECCIÓN 1 · Preview (solo lectura)
-- ============================================================

-- 1a) Canchas que se reabrirían
with last_court_action as (
  select distinct on (l.metadata->>'court_id')
         l.metadata->>'court_id' as court_id, l.action, l.created_at
  from public.event_audit_log l
  where l.action in ('AUTO_CLOSE_COURT', 'OPEN_COURT', 'CLOSE_COURT')
    and l.metadata ? 'court_id'
  order by l.metadata->>'court_id', l.created_at desc
)
select e.title, e.starts_at, c.name as cancha, c.capacity,
       (select count(*) from public.event_registrations r
         where r.court_id = c.id and r.status = 'CONFIRMED') as confirmados,
       lca.created_at as cerrada_el
from public.event_courts c
join public.events e on e.id = c.event_id
join last_court_action lca on lca.court_id = c.id::text
where c.is_open = false
  and e.starts_at > now()
  and e.status <> 'FINALIZED'
  and lca.action = 'AUTO_CLOSE_COURT'
  and not exists (
    select 1 from public.event_audit_log u
    where u.event_id = e.id and u.action = 'UPDATE_COURT'
      and u.metadata ? 'is_open' and u.created_at > lca.created_at
  )
order by e.starts_at, c.sort_order;

-- 1b) Eventos que se reabrirían
with last_event_action as (
  select distinct on (l.event_id) l.event_id, l.action, l.created_at
  from public.event_audit_log l
  where l.action in ('AUTO_CLOSE_EVENT', 'CLOSE_EVENT', 'REOPEN_EVENT')
  order by l.event_id, l.created_at desc
)
select e.title, e.starts_at, e.status, lea.created_at as cerrado_el
from public.events e
join last_event_action lea on lea.event_id = e.id
where e.status = 'CLOSED'
  and e.starts_at > now()
  and lea.action = 'AUTO_CLOSE_EVENT'
order by e.starts_at;

-- 1c) Lista de espera de los partidos futuros (en orden de promoción)
select e.title, e.starts_at,
       row_number() over (partition by e.id order by r.created_at) as puesto,
       coalesce(u.full_name, r.guest_name) as nombre, r.registration_type, r.created_at
from public.event_registrations r
join public.events e on e.id = r.event_id
left join public.users u on u.id = r.user_id
where r.status = 'WAITLIST' and r.court_id is null
  and e.starts_at > now()
  and e.status in ('OPEN', 'CLOSED')
order by e.starts_at, r.created_at;


-- ============================================================
-- SECCIÓN 2 · Aplicar
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_court record;
  v_event record;
  v_wait record;
  v_target record;
  v_fallback uuid;
  v_actor uuid;
  n_courts int := 0;
  n_events int := 0;
  n_promoted int := 0;
BEGIN
  -- Actor de respaldo para eventos sin created_by_user_id.
  SELECT ur.user_id INTO v_fallback
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE LOWER(r.code) IN ('super_admin', 'admin')
  ORDER BY (LOWER(r.code) = 'super_admin') DESC, ur.created_at
  LIMIT 1;

  -- 1) Canchas cerradas por el sistema (y no tocadas después por una persona)
  FOR v_court IN
    WITH last_court_action AS (
      SELECT DISTINCT ON (l.metadata->>'court_id')
             l.metadata->>'court_id' AS court_id, l.action, l.created_at
      FROM public.event_audit_log l
      WHERE l.action IN ('AUTO_CLOSE_COURT', 'OPEN_COURT', 'CLOSE_COURT')
        AND l.metadata ? 'court_id'
      ORDER BY l.metadata->>'court_id', l.created_at DESC
    )
    SELECT c.id, c.event_id, e.created_by_user_id
    FROM public.event_courts c
    JOIN public.events e ON e.id = c.event_id
    JOIN last_court_action lca ON lca.court_id = c.id::text
    WHERE c.is_open = false
      AND e.starts_at > now()
      AND e.status <> 'FINALIZED'
      AND lca.action = 'AUTO_CLOSE_COURT'
      AND NOT EXISTS (
        SELECT 1 FROM public.event_audit_log u
        WHERE u.event_id = e.id AND u.action = 'UPDATE_COURT'
          AND u.metadata ? 'is_open' AND u.created_at > lca.created_at
      )
    FOR UPDATE OF c
  LOOP
    v_actor := COALESCE(v_court.created_by_user_id, v_fallback);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'reopen_auto_closed: el evento % no tiene creador y no hay ningún admin para registrar el audit', v_court.event_id;
    END IF;
    UPDATE public.event_courts SET is_open = true, updated_at = now() WHERE id = v_court.id;
    INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
    VALUES (v_court.event_id, v_actor, 'OPEN_COURT',
            jsonb_build_object('court_id', v_court.id::text, 'source', 'data_fix', 'system', true));
    n_courts := n_courts + 1;
  END LOOP;

  -- 2) Eventos cerrados por el sistema
  FOR v_event IN
    WITH last_event_action AS (
      SELECT DISTINCT ON (l.event_id) l.event_id, l.action
      FROM public.event_audit_log l
      WHERE l.action IN ('AUTO_CLOSE_EVENT', 'CLOSE_EVENT', 'REOPEN_EVENT')
      ORDER BY l.event_id, l.created_at DESC
    )
    SELECT e.id, e.created_by_user_id
    FROM public.events e
    JOIN last_event_action lea ON lea.event_id = e.id
    WHERE e.status = 'CLOSED'
      AND e.starts_at > now()
      AND lea.action = 'AUTO_CLOSE_EVENT'
    FOR UPDATE OF e
  LOOP
    v_actor := COALESCE(v_event.created_by_user_id, v_fallback);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'reopen_auto_closed: el evento % no tiene creador y no hay ningún admin para registrar el audit', v_event.id;
    END IF;
    UPDATE public.events SET status = 'OPEN', updated_at = now() WHERE id = v_event.id;
    INSERT INTO public.event_audit_log (event_id, actor_user_id, action, metadata)
    VALUES (v_event.id, v_actor, 'REOPEN_EVENT',
            jsonb_build_object('previous_status', 'CLOSED', 'source', 'data_fix', 'system', true));
    n_events := n_events + 1;
  END LOOP;

  -- 3) Promoción: primero de la espera (created_at) a la primera cancha abierta
  --    con lugar (sort_order), en los partidos futuros abiertos. Misma regla que
  --    promote_first_waitlist en app/routers/events.py.
  FOR v_event IN
    SELECT e.id, e.created_by_user_id FROM public.events e
    WHERE e.status = 'OPEN' AND e.starts_at > now()
    ORDER BY e.starts_at
  LOOP
    v_actor := COALESCE(v_event.created_by_user_id, v_fallback);
    LOOP
      SELECT r.id INTO v_wait
      FROM public.event_registrations r
      WHERE r.event_id = v_event.id AND r.status = 'WAITLIST' AND r.court_id IS NULL
      ORDER BY r.created_at
      LIMIT 1
      FOR UPDATE;
      EXIT WHEN NOT FOUND;

      SELECT c.id INTO v_target
      FROM public.event_courts c
      WHERE c.event_id = v_event.id
        AND c.is_open = true
        AND (SELECT count(*) FROM public.event_registrations r2
              WHERE r2.court_id = c.id AND r2.status = 'CONFIRMED') < c.capacity
      ORDER BY c.sort_order, c.created_at
      LIMIT 1;
      EXIT WHEN NOT FOUND;

      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'reopen_auto_closed: el evento % no tiene creador y no hay ningún admin para registrar el audit', v_event.id;
      END IF;
      UPDATE public.event_registrations
      SET status = 'CONFIRMED', court_id = v_target.id, updated_at = now()
      WHERE id = v_wait.id;
      INSERT INTO public.event_audit_log (event_id, actor_user_id, action, target_registration_id, metadata)
      VALUES (v_event.id, v_actor, 'PROMOTE_WAITLIST', v_wait.id,
              jsonb_build_object('source', 'data_fix', 'system', true));
      n_promoted := n_promoted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'reopen_auto_closed: % canchas reabiertas, % eventos reabiertos, % promovidos de la espera',
    n_courts, n_events, n_promoted;
END $$;

COMMIT;
