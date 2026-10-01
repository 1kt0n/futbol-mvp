-- 019_competition_team_veedor.sql
-- Veedores asignados por EQUIPO (decisión 2026-10-01): cada veedor tiene uno o varios equipos y
-- puede cargar todos los partidos donde juegue alguno de ellos (incluidos los cruces del domingo,
-- que se habilitan solos cuando el equipo avanza). En un partido pueden cargar los dos veedores.
-- La asignación por partido (competition_matches.veedor_staff_id) sigue existiendo como refuerzo
-- (p.ej. un veedor de reserva cubriendo una cancha).
-- Aditiva. Requiere 018. Correr a mano en la consola Postgres de Railway.

BEGIN;

ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS veedor_staff_id uuid NULL
    REFERENCES public.competition_staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_competition_teams_veedor
  ON public.competition_teams (veedor_staff_id)
  WHERE veedor_staff_id IS NOT NULL;

COMMIT;
