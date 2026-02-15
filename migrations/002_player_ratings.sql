-- 002_player_ratings.sql
-- Agrega finalized_at a events y crea tabla player_ratings
-- Ejecutar DESPUÉS de 001_init.sql

-- ============================================================
-- 1) Agregar finalized_at a events
-- ============================================================
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;

-- Backfill: eventos ya finalizados usan updated_at como aproximación
UPDATE public.events
SET finalized_at = updated_at
WHERE status = 'FINALIZED' AND finalized_at IS NULL;

-- ============================================================
-- 2) Tabla player_ratings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.player_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  court_id UUID NOT NULL REFERENCES public.event_courts(id),
  voter_user_id UUID NOT NULL REFERENCES public.users(id),
  target_user_id UUID NOT NULL REFERENCES public.users(id),
  rating NUMERIC(2,1) NOT NULL,
  comment TEXT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un voto por voter-target por cancha
  CONSTRAINT uq_player_ratings_court_voter_target
    UNIQUE (court_id, voter_user_id, target_user_id),

  -- No auto-calificarse
  CONSTRAINT chk_no_self_rating
    CHECK (voter_user_id != target_user_id),

  -- Rating entre 1.0 y 5.0
  CONSTRAINT chk_rating_range
    CHECK (rating >= 1.0 AND rating <= 5.0),

  -- Solo steps de 0.5 (1.0, 1.5, 2.0, ..., 5.0)
  CONSTRAINT chk_rating_step
    CHECK ((rating * 2) = FLOOR(rating * 2))
);

-- ============================================================
-- 3) Índices para queries comunes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_player_ratings_voter
  ON public.player_ratings(voter_user_id);

CREATE INDEX IF NOT EXISTS idx_player_ratings_target
  ON public.player_ratings(target_user_id);

CREATE INDEX IF NOT EXISTS idx_player_ratings_event
  ON public.player_ratings(event_id);