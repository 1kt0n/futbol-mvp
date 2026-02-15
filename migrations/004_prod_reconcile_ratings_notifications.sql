-- 004_prod_reconcile_ratings_notifications.sql
-- Reconcilia schema para ratings + notifications en ambientes existentes.
-- Objetivo: idempotente y seguro para productivo (sin drops ni truncates).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 0) Roles base (idempotente)
-- ============================================================
INSERT INTO public.roles (code)
VALUES ('user'), ('admin'), ('super_admin'), ('captain')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 1) Events: finalized_at (ratings depende de esto)
-- ============================================================
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

UPDATE public.events
SET finalized_at = updated_at
WHERE status = 'FINALIZED' AND finalized_at IS NULL;

-- ============================================================
-- 2) Player ratings (tabla + columnas + constraints + indices)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  court_id UUID NOT NULL REFERENCES public.event_courts(id),
  voter_user_id UUID NOT NULL REFERENCES public.users(id),
  target_user_id UUID NOT NULL REFERENCES public.users(id),
  rating NUMERIC NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
  comment TEXT,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.player_ratings ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE public.player_ratings ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN;
ALTER TABLE public.player_ratings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.player_ratings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.player_ratings SET is_hidden = false WHERE is_hidden IS NULL;
UPDATE public.player_ratings SET created_at = now() WHERE created_at IS NULL;
UPDATE public.player_ratings SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE public.player_ratings ALTER COLUMN is_hidden SET DEFAULT false;
ALTER TABLE public.player_ratings ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.player_ratings ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'player_ratings'
      AND c.conname = 'chk_no_self_rating'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.player_ratings
      ADD CONSTRAINT chk_no_self_rating
      CHECK (voter_user_id <> target_user_id) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'player_ratings'
      AND c.conname = 'chk_rating_range'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.player_ratings
      ADD CONSTRAINT chk_rating_range
      CHECK (rating >= 1.0 AND rating <= 5.0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'player_ratings'
      AND c.conname = 'chk_rating_step'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.player_ratings
      ADD CONSTRAINT chk_rating_step
      CHECK ((rating * 2) = floor(rating * 2)) NOT VALID;
  END IF;
END $$;

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT court_id, voter_user_id, target_user_id
    FROM public.player_ratings
    GROUP BY 1,2,3
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'No se puede crear constraint de unicidad en player_ratings: % grupos duplicados (court_id, voter_user_id, target_user_id).',
      dup_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'player_ratings'
      AND c.conname = 'uq_player_ratings_court_voter_target'
      AND c.contype = 'u'
  ) THEN
    ALTER TABLE public.player_ratings
      ADD CONSTRAINT uq_player_ratings_court_voter_target
      UNIQUE (court_id, voter_user_id, target_user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_player_ratings_voter
  ON public.player_ratings(voter_user_id);

CREATE INDEX IF NOT EXISTS idx_player_ratings_target
  ON public.player_ratings(target_user_id);

CREATE INDEX IF NOT EXISTS idx_player_ratings_event
  ON public.player_ratings(event_id);

-- ============================================================
-- 3) Notifications (tabla + columnas + constraints + indices)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR NOT NULL DEFAULT 'INFO' CHECK (kind = 'INFO'),
  title VARCHAR NOT NULL,
  message TEXT NOT NULL,
  action_url VARCHAR,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind VARCHAR;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title VARCHAR;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_by_user_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.notifications SET kind = 'INFO' WHERE kind IS NULL;
UPDATE public.notifications SET starts_at = now() WHERE starts_at IS NULL;
UPDATE public.notifications SET expires_at = now() + interval '7 days' WHERE expires_at IS NULL;
UPDATE public.notifications SET is_active = true WHERE is_active IS NULL;
UPDATE public.notifications SET created_at = now() WHERE created_at IS NULL;
UPDATE public.notifications SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE public.notifications ALTER COLUMN kind SET DEFAULT 'INFO';
ALTER TABLE public.notifications ALTER COLUMN starts_at SET DEFAULT now();
ALTER TABLE public.notifications ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
ALTER TABLE public.notifications ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.notifications ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.notifications ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'notifications'
      AND c.conname = 'chk_notifications_kind'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT chk_notifications_kind
      CHECK (kind = 'INFO') NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_active_window
  ON public.notifications (is_active, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);

-- ============================================================
-- 4) User notification dismissals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_notification_dismissals (
  user_id UUID NOT NULL REFERENCES public.users(id),
  notification_id UUID NOT NULL REFERENCES public.notifications(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

ALTER TABLE public.user_notification_dismissals
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

UPDATE public.user_notification_dismissals
SET dismissed_at = now()
WHERE dismissed_at IS NULL;

ALTER TABLE public.user_notification_dismissals
  ALTER COLUMN dismissed_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_notification_dismissals'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE public.user_notification_dismissals
      ADD CONSTRAINT user_notification_dismissals_pkey
      PRIMARY KEY (user_id, notification_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_notification_dismissals_user
  ON public.user_notification_dismissals (user_id);

COMMIT;

-- ============================================================
-- Verificacion rapida post-migracion
-- ============================================================
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('player_ratings', 'notifications', 'user_notification_dismissals');
--
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conname IN (
--   'uq_player_ratings_court_voter_target',
--   'chk_no_self_rating',
--   'chk_rating_range',
--   'chk_rating_step',
--   'chk_notifications_kind'
-- );
