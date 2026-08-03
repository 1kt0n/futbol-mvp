-- 014_events_description.sql
-- Descripcion opcional en eventos de cancha, para poder editarlos despues de creados
-- junto con titulo, fecha, lugar y cierre (PATCH /admin/events/{id}).
-- Correr a mano en la consola Postgres de Railway, igual que las migraciones previas.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS description text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_events_description_len'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT chk_events_description_len
      CHECK (description IS NULL OR char_length(description) <= 1200);
  END IF;
END $$;

COMMIT;
