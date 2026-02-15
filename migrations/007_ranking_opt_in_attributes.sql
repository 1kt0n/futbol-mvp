-- 007_ranking_opt_in_attributes.sql
-- MVP consentimiento de ranking + atributos estructurados de votacion.
-- Idempotente y seguro para ambientes existentes.

BEGIN;

-- ============================================================
-- 1) Users: ranking_opt_in + player_level
-- ============================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ranking_opt_in BOOLEAN;

UPDATE public.users
SET ranking_opt_in = false
WHERE ranking_opt_in IS NULL;

ALTER TABLE public.users
  ALTER COLUMN ranking_opt_in SET DEFAULT false;

ALTER TABLE public.users
  ALTER COLUMN ranking_opt_in SET NOT NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS player_level TEXT;

UPDATE public.users
SET player_level = 'RECREATIVO'
WHERE player_level IS NULL
   OR player_level NOT IN ('INICIAL', 'RECREATIVO', 'COMPETITIVO');

ALTER TABLE public.users
  ALTER COLUMN player_level SET DEFAULT 'RECREATIVO';

ALTER TABLE public.users
  ALTER COLUMN player_level SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.conname = 'chk_users_player_level'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT chk_users_player_level
      CHECK (player_level IN ('INICIAL', 'RECREATIVO', 'COMPETITIVO')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_ranking_opt_in
  ON public.users (ranking_opt_in);

-- ============================================================
-- 2) Player ratings: attributes
-- ============================================================
ALTER TABLE public.player_ratings
  ADD COLUMN IF NOT EXISTS attributes JSONB;

UPDATE public.player_ratings
SET attributes = '[]'::jsonb
WHERE attributes IS NULL;

ALTER TABLE public.player_ratings
  ALTER COLUMN attributes SET DEFAULT '[]'::jsonb;

ALTER TABLE public.player_ratings
  ALTER COLUMN attributes SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'player_ratings'
      AND c.conname = 'chk_player_ratings_attributes_two'
      AND c.contype = 'c'
  ) THEN
    ALTER TABLE public.player_ratings
      ADD CONSTRAINT chk_player_ratings_attributes_two
      CHECK (
        jsonb_typeof(attributes) = 'array'
        AND jsonb_array_length(attributes) = 2
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_player_ratings_target_created
  ON public.player_ratings (target_user_id, created_at DESC);

COMMIT;
