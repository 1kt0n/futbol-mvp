-- 005_notifications_global_nullable_event.sql
-- Permite notificaciones globales (sin event_id) en schemas legacy.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'event_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications
      ALTER COLUMN event_id DROP NOT NULL;
  END IF;
END $$;

COMMIT;

