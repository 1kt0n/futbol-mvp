-- 011_calendar.sql
-- Mi Calendario: marca de eventos visibles para todos + tabla de anuncios informativos.

BEGIN;

-- ============================================================
-- 1) Visibilidad de eventos: PRIVATE (default) vs GLOBAL
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'PRIVATE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_events_visibility'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT chk_events_visibility
      CHECK (visibility IN ('PRIVATE', 'GLOBAL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_global_starts_at
  ON public.events (starts_at)
  WHERE visibility = 'GLOBAL';

-- ============================================================
-- 2) Tabla de anuncios informativos del calendario
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calendar_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NULL,
  location_name text NULL,
  action_url text NULL,
  action_label text NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_calendar_announcements_title_len
    CHECK (char_length(title) BETWEEN 3 AND 160),
  CONSTRAINT chk_calendar_announcements_ends_at
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_calendar_announcements_starts_at
  ON public.calendar_announcements (starts_at);

-- ============================================================
-- 3) Indice para acelerar lookup de partidos de torneo del jugador
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tournament_team_members_user_id
  ON public.tournament_team_members (user_id)
  WHERE member_type = 'USER';

COMMIT;
