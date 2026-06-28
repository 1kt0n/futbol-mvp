-- ============================================================
-- FORENSE — quién creó las notificaciones abusivas
--           y quién anotó a los "Juan Perez" / "JP"
-- Pegar en el psql / query console de Railway (DB de producción).
-- OJO: created_by_user_id / actor_user_id es FALSIFICABLE (ver auditoría).
-- Muestra QUÉ identidad se usó y CUÁNDO, no necesariamente la persona real.
-- ============================================================


-- 1) NOTIFICACIONES ABUSIVAS: quién las creó
SELECT
    n.id,
    n.title,
    n.message,
    n.created_at,
    n.created_by_user_id,
    u.full_name   AS creador,
    u.phone_e164  AS telefono_creador
FROM public.notifications n
LEFT JOIN public.users u ON u.id = n.created_by_user_id
ORDER BY n.created_at DESC;


-- 2) Las notificaciones "Ups" puntuales (filtro por texto)
SELECT
    n.id, n.title, n.message, n.created_at,
    n.created_by_user_id, u.full_name AS creador, u.phone_e164 AS telefono
FROM public.notifications n
LEFT JOIN public.users u ON u.id = n.created_by_user_id
WHERE n.title ILIKE 'ups%'
   OR n.message ILIKE '%estupidos%'
   OR n.message ILIKE '%codo a codo%'
ORDER BY n.created_at DESC;


-- 3) Audit log de creación de notificaciones (actor + timestamp)
SELECT
    eal.created_at,
    eal.actor_user_id,
    u.full_name AS actor,
    u.phone_e164 AS telefono_actor,
    eal.metadata
FROM public.event_audit_log eal
LEFT JOIN public.users u ON u.id = eal.actor_user_id
WHERE eal.action = 'CREATE_NOTIFICATION'
ORDER BY eal.created_at DESC;


-- 4) REGISTROS FALSOS "Juan Perez" / "JP": quién los anotó
SELECT
    r.id,
    r.guest_name,
    r.registration_type,
    r.created_at,
    r.created_by_user_id,
    u.full_name  AS quien_anoto,
    u.phone_e164 AS telefono_quien_anoto,
    r.event_id,
    r.court_id
FROM public.event_registrations r
LEFT JOIN public.users u ON u.id = r.created_by_user_id
WHERE r.guest_name ILIKE '%juan%perez%'
   OR r.guest_name ILIKE 'jp%'
   OR r.guest_name ILIKE '%jp%'
ORDER BY r.created_at DESC;


-- 5) Patrón de ataque: identidades que anotaron muchos invitados en poco tiempo
--    (rotación de header = muchos created_by_user_id distintos en una ráfaga)
SELECT
    r.created_by_user_id,
    u.full_name AS identidad_usada,
    COUNT(*)                       AS cantidad_invitados,
    MIN(r.created_at)              AS primer_registro,
    MAX(r.created_at)              AS ultimo_registro
FROM public.event_registrations r
LEFT JOIN public.users u ON u.id = r.created_by_user_id
WHERE r.registration_type = 'GUEST'
GROUP BY r.created_by_user_id, u.full_name
HAVING COUNT(*) > 5
ORDER BY cantidad_invitados DESC;


-- 6) Audit log de registros (actor + acción + timestamp)
SELECT
    eal.created_at,
    eal.action,
    eal.actor_user_id,
    u.full_name AS actor,
    u.phone_e164 AS telefono_actor,
    eal.target_registration_id,
    eal.metadata
FROM public.event_audit_log eal
LEFT JOIN public.users u ON u.id = eal.actor_user_id
WHERE eal.action IN ('REGISTER_GUEST', 'REGISTER_USER')
ORDER BY eal.created_at DESC
LIMIT 200;


-- 7) ¿Existe una cuenta llamada "Juan Perez" registrada como usuario?
SELECT id, full_name, phone_e164, created_at
FROM public.users
WHERE full_name ILIKE '%juan%perez%'
ORDER BY created_at DESC;
