-- 015_event_access.sql
-- Event Access v1: modo de acceso, share code y contraseña de evento.
-- Aditiva y compatible: todos los eventos existentes quedan en MEMBERS_ONLY,
-- sin share_code ni clave (comportamiento idéntico al actual).
-- Correr a mano en la consola Postgres de Railway, como las migraciones previas.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'MEMBERS_ONLY',
  ADD COLUMN IF NOT EXISTS allow_external_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_code text NULL,
  ADD COLUMN IF NOT EXISTS password_hash text NULL,
  ADD COLUMN IF NOT EXISTS password_salt text NULL,
  ADD COLUMN IF NOT EXISTS password_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_roster_visibility text NOT NULL DEFAULT 'NONE';

-- CHECK: access_mode válido
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_access_mode') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_access_mode
      CHECK (access_mode IN ('MEMBERS_ONLY','LINK_ACCESS','LINK_PASSWORD'));
  END IF;
END $$;

-- CHECK: roster visibility válido
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_roster_vis') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_roster_vis
      CHECK (public_roster_visibility IN ('NONE','FIRST_NAME','DISPLAY_NAME'));
  END IF;
END $$;

-- CHECK: si es LINK_PASSWORD, tiene que haber hash+salt (coherencia a nivel DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_password_present') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_password_present
      CHECK (access_mode <> 'LINK_PASSWORD' OR (password_hash IS NOT NULL AND password_salt IS NOT NULL));
  END IF;
END $$;

-- Unicidad de share_code (parcial: solo cuando existe)
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_share_code
  ON public.events (share_code)
  WHERE share_code IS NOT NULL;

COMMIT;
