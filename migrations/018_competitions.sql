-- 018_competitions.sql
-- Módulo `competitions` (Copa Proud Sudamericana 2026 y futuras competencias grandes).
-- 100% ADITIVA: tablas nuevas `competition_*` + permisos nuevos. No toca `tournaments`
-- ni ninguna tabla existente → cero impacto en la app actual.
-- La estructura (zonas, canchas, 75 partidos y sus fuentes) NO se siembra acá: la carga
-- `scripts/seed_competition.py` desde `app/utils/competition_formats.py`.
-- Correr a mano en la consola Postgres de Railway, como las migraciones previas.

BEGIN;

-- ============================================================
-- 1) Competencia
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL UNIQUE,
  name                   text NOT NULL,
  format_code            text NOT NULL,             -- clave en competition_formats.FORMATS
  status                 text NOT NULL DEFAULT 'DRAFT',
  starts_on              date NULL,
  ends_on                date NULL,
  utc_offset             text NOT NULL DEFAULT '-03:00',
  settings               jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_stage_closed_at  timestamptz NULL,
  group_stage_closed_by  uuid NULL REFERENCES public.users(id),
  data_version           bigint NOT NULL DEFAULT 1, -- sube en cada escritura → invalida caché/ETag público
  created_by_user_id     uuid NULL REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_competitions_status CHECK (status IN ('DRAFT','PUBLISHED','LIVE','FINISHED'))
);

-- ============================================================
-- 2) Equipos, planteles (opcionales) y sorteo de posiciones
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competition_teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  name            text NOT NULL,
  short_name      text NULL,
  country_code    char(2) NULL,     -- ISO 3166-1 alpha-2 (bandera)
  city            text NULL,
  logo_url        text NULL,
  color           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_teams_name
  ON public.competition_teams (competition_id, lower(name));

-- Lista de buena fe (reglamento 4.1: 5 a 15 jugadores). NO se vincula con users.
CREATE TABLE IF NOT EXISTS public.competition_players (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES public.competition_teams(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  shirt_number    smallint NULL,
  is_captain      boolean NOT NULL DEFAULT false,
  is_goalkeeper   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_competition_players_shirt CHECK (shirt_number IS NULL OR shirt_number BETWEEN 0 AND 999)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_players_shirt
  ON public.competition_players (team_id, shirt_number)
  WHERE shirt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_competition_players_team ON public.competition_players (team_id);

-- Posición de cada equipo en su zona (resultado del sorteo, reglamento 1.6).
CREATE TABLE IF NOT EXISTS public.competition_group_slots (
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  group_code      text NOT NULL,
  position        smallint NOT NULL,
  team_id         uuid NULL REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  PRIMARY KEY (competition_id, group_code, position)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_group_slots_team
  ON public.competition_group_slots (competition_id, team_id)
  WHERE team_id IS NOT NULL;

-- Desempate por sorteo (reglamento 1.5 criterio 5). context = 'GROUP:A' | 'THIRD' | 'FOURTH'.
CREATE TABLE IF NOT EXISTS public.competition_draws (
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  context         text NOT NULL,
  team_id         uuid NOT NULL REFERENCES public.competition_teams(id) ON DELETE CASCADE,
  rank            smallint NOT NULL,
  PRIMARY KEY (competition_id, context, team_id)
);

-- ============================================================
-- 3) Canchas y staff (veedores / árbitros)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competition_venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  number          smallint NOT NULL,
  name            text NOT NULL,
  UNIQUE (competition_id, number)
);

CREATE TABLE IF NOT EXISTS public.competition_staff (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  role                text NOT NULL DEFAULT 'VEEDOR',
  contact_encrypted   text NULL,          -- Fernet (app/utils/contact_crypto.py)
  access_token_hash   text NULL,          -- SHA-256 del link del veedor; el plano se muestra 1 vez
  token_rotated_at    timestamptz NULL,
  revoked_at          timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_competition_staff_role CHECK (role IN ('VEEDOR','REFEREE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_staff_token
  ON public.competition_staff (access_token_hash)
  WHERE access_token_hash IS NOT NULL;

-- ============================================================
-- 4) Partidos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competition_matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id        uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  code                  text NOT NULL,           -- 'A-1v2', 'ORO-O1', 'PLATA-C3', ...
  stage                 text NOT NULL,
  cup                   text NULL,
  group_code            text NULL,
  venue_id              uuid NULL REFERENCES public.competition_venues(id) ON DELETE SET NULL,
  scheduled_at          timestamptz NULL,
  home_source           text NOT NULL,           -- gramática en competition_formats.py
  away_source           text NOT NULL,
  home_team_id          uuid NULL REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  away_team_id          uuid NULL REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'SCHEDULED',
  home_goals            smallint NULL,
  away_goals            smallint NULL,
  home_pens             smallint NULL,
  away_pens             smallint NULL,
  started_at            timestamptz NULL,
  ended_at              timestamptz NULL,
  veedor_staff_id       uuid NULL REFERENCES public.competition_staff(id) ON DELETE SET NULL,
  referee_name          text NULL,
  confirmed_at          timestamptz NULL,        -- ✓ oficial (mesa central vs planilla firmada)
  confirmed_by_user_id  uuid NULL REFERENCES public.users(id),
  notes                 text NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, code),
  CONSTRAINT chk_competition_matches_stage CHECK (stage IN ('GROUP','R16','QF','SF','F')),
  CONSTRAINT chk_competition_matches_cup CHECK (cup IS NULL OR cup IN ('ORO','PLATA','BRONCE')),
  CONSTRAINT chk_competition_matches_status CHECK (status IN ('SCHEDULED','LIVE','HALFTIME','FINISHED','WALKOVER')),
  CONSTRAINT chk_competition_matches_goals CHECK (
    (home_goals IS NULL OR home_goals >= 0) AND (away_goals IS NULL OR away_goals >= 0) AND
    (home_pens IS NULL OR home_pens >= 0) AND (away_pens IS NULL OR away_pens >= 0)
  )
);
CREATE INDEX IF NOT EXISTS ix_competition_matches_schedule
  ON public.competition_matches (competition_id, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_competition_matches_veedor
  ON public.competition_matches (veedor_staff_id)
  WHERE veedor_staff_id IS NOT NULL;

-- Goles y tarjetas. player_id es OPCIONAL (el detalle por jugador no es obligatorio).
-- team_id es SIEMPRE el equipo del jugador; un OWN_GOAL suma para el rival.
CREATE TABLE IF NOT EXISTS public.competition_match_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id       uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  match_id             uuid NOT NULL REFERENCES public.competition_matches(id) ON DELETE CASCADE,
  team_id              uuid NOT NULL REFERENCES public.competition_teams(id) ON DELETE CASCADE,
  player_id            uuid NULL REFERENCES public.competition_players(id) ON DELETE SET NULL,
  type                 text NOT NULL,
  minute               smallint NULL,
  client_event_id      text NULL,     -- idempotencia de reintentos del veedor (mala señal)
  source               text NOT NULL DEFAULT 'ADMIN',
  created_by_staff_id  uuid NULL REFERENCES public.competition_staff(id) ON DELETE SET NULL,
  created_by_user_id   uuid NULL REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_competition_events_type CHECK (type IN ('GOAL','OWN_GOAL','YELLOW','RED')),
  CONSTRAINT chk_competition_events_source CHECK (source IN ('VEEDOR','ADMIN'))
);
CREATE INDEX IF NOT EXISTS ix_competition_events_match ON public.competition_match_events (match_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_events_client
  ON public.competition_match_events (match_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- ============================================================
-- 5) Auditoría (quién cambió qué: mesa central o veedor)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competition_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  actor_user_id   uuid NULL REFERENCES public.users(id),
  actor_staff_id  uuid NULL REFERENCES public.competition_staff(id) ON DELETE SET NULL,
  action          text NOT NULL,
  match_id        uuid NULL REFERENCES public.competition_matches(id) ON DELETE SET NULL,
  metadata        jsonb NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_competition_audit_comp
  ON public.competition_audit_log (competition_id, created_at DESC);

-- ============================================================
-- 6) Permisos (super_admin es comodín en código; se asignan a 'admin')
-- ============================================================
INSERT INTO public.permissions (code, category, description) VALUES
  ('competitions.view',    'COMPETENCIA', 'Ver competencias grandes (Copa Proud) en el panel'),
  ('competitions.manage',  'COMPETENCIA', 'Configurar competencias: equipos, planteles, sorteo, veedores, cierre de fase'),
  ('competitions.results', 'COMPETENCIA', 'Cargar, corregir y confirmar resultados de competencias')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.code) = 'admin'
  AND p.code IN ('competitions.view', 'competitions.manage', 'competitions.results')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
