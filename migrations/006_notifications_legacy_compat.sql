-- 006_notifications_legacy_compat.sql
-- Compatibilidad para schemas legacy donde notifications tenia campos de ratings/evento
-- con NOT NULL que rompen notificaciones globales.

BEGIN;

DO $$
DECLARE
  col_name TEXT;
BEGIN
  FOREACH col_name IN ARRAY ARRAY[
    'event_id',
    'user_id',
    'channel',
    'type',
    'court_id',
    'voter_user_id',
    'target_user_id',
    'rating',
    'status'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
        AND column_name = col_name
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.notifications ALTER COLUMN %I DROP NOT NULL',
        col_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
