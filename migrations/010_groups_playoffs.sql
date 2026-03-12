-- 010_groups_playoffs.sql
-- Add group support for GROUPS_PLAYOFFS tournament format

BEGIN;

-- Group label on teams (A, B, C, D)
ALTER TABLE public.tournament_teams
  ADD COLUMN IF NOT EXISTS group_label text NULL;

-- Group label and stage on matches
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS group_label text NULL;

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS stage text NULL;

ALTER TABLE public.tournament_matches
  ADD CONSTRAINT chk_tournament_match_stage
    CHECK (stage IS NULL OR stage IN ('GROUP', 'PLAYOFF'));

COMMIT;
