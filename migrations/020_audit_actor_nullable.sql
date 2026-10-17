-- 020_audit_actor_nullable.sql
-- En producción public.event_audit_log.actor_user_id quedó NOT NULL, aunque 001 no lo declara
-- así. Las acciones sin usuario logueado auditan con actor NULL, y la UI de auditoría muestra
-- esos registros como "Sistema". Estas son:
--   - EVENT_UNLOCK: se perdía en silencio.
--   - REGISTER_EXTERNAL y CANCEL_EXTERNAL: daban 500 y deshacían el alta o la baja.
--   - COURT_FULL y PROMOTE_WAITLIST, cuando los dispara un externo.
--   - AUTO_CLOSE_COURT y AUTO_CLOSE_EVENT, con AUTO_CLOSE_ON_FULL=true.
-- Solo afloja una restricción. No reescribe la tabla y no cambia ningún dato. Es idempotente.
-- No requiere deploy: el código ya inserta NULL. Correr a mano en la consola Postgres de
-- Railway, como las migraciones previas.

BEGIN;

-- El ALTER toma un lock exclusivo de la tabla. Si otra transacción lo retiene, falla a los 5 s
-- en vez de quedar en cola bloqueando las lecturas del audit. En ese caso, reintentar.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.event_audit_log
  ALTER COLUMN actor_user_id DROP NOT NULL;

COMMIT;

-- Verificación: tiene que devolver YES.
-- SELECT is_nullable FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'event_audit_log' AND column_name = 'actor_user_id';
