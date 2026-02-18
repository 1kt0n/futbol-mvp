-- 009_tournaments.sql
-- Torneos + resultados publicos + modo TV (base schema)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  location_name text NULL,
  starts_at timestamptz NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  format text NOT NULL DEFAULT 'ROUND_ROBIN',
  teams_count int NOT NULL DEFAULT 4,
  minutes_per_match int NOT NULL DEFAULT 20,
  public_token text NOT NULL UNIQUE,
  created_by_user_id uuid NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tournaments_status
    CHECK (status IN ('DRAFT', 'LIVE', 'FINISHED', 'ARCHIVED')),
  CONSTRAINT chk_tournaments_format
    CHECK (format IN ('ROUND_ROBIN', 'KNOCKOUT', 'GROUPS_PLAYOFFS')),
  CONSTRAINT chk_tournaments_teams_count
    CHECK (teams_count >= 2),
  CONSTRAINT chk_tournaments_minutes
    CHECK (minutes_per_match BETWEEN 5 AND 120)
);

CREATE TABLE IF NOT EXISTS public.tournament_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_emoji text NULL,
  is_guest boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tournament_teams_name UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS public.tournament_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.tournament_teams(id) ON DELETE CASCADE,
  member_type text NOT NULL,
  user_id uuid NULL REFERENCES public.users(id),
  guest_name text NULL,
  level_override text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tournament_member_type
    CHECK (member_type IN ('USER', 'GUEST')),
  CONSTRAINT chk_tournament_member_payload
    CHECK (
      (member_type = 'USER' AND user_id IS NOT NULL AND guest_name IS NULL)
      OR
      (member_type = 'GUEST' AND guest_name IS NOT NULL AND user_id IS NULL)
    ),
  CONSTRAINT chk_tournament_level_override
    CHECK (level_override IS NULL OR level_override IN ('INICIAL', 'RECREATIVO', 'COMPETITIVO'))
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round int NOT NULL DEFAULT 1,
  home_team_id uuid NULL REFERENCES public.tournament_teams(id),
  away_team_id uuid NULL REFERENCES public.tournament_teams(id),
  status text NOT NULL DEFAULT 'PENDING',
  home_goals int NOT NULL DEFAULT 0,
  away_goals int NOT NULL DEFAULT 0,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  sort_order int NOT NULL DEFAULT 1,
  next_match_id uuid NULL REFERENCES public.tournament_matches(id),
  next_slot text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tournament_match_status
    CHECK (status IN ('PENDING', 'LIVE', 'FINISHED')),
  CONSTRAINT chk_tournament_match_goals
    CHECK (home_goals >= 0 AND away_goals >= 0),
  CONSTRAINT chk_tournament_match_next_slot
    CHECK (next_slot IS NULL OR next_slot IN ('HOME', 'AWAY')),
  CONSTRAINT uq_tournament_match_round_order UNIQUE (tournament_id, round, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status_created
  ON public.tournaments (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament_id
  ON public.tournament_teams (tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_members_team_id
  ON public.tournament_team_members (team_id);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament_round
  ON public.tournament_matches (tournament_id, round, sort_order);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament_status
  ON public.tournament_matches (tournament_id, status);

COMMIT;
