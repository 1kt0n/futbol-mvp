-- 016_external_participants.sql
-- Iteración 2: participante EXTERNAL (inscripción sin cuenta desde el enlace público).
-- Aditiva y compatible: no cambia el comportamiento de USER/GUEST existentes.
-- Correr a mano en la consola Postgres de Railway, como las migraciones previas.

BEGIN;

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS contact_encrypted text NULL,
  ADD COLUMN IF NOT EXISTS contact_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS management_token_hash text NULL,
  ADD COLUMN IF NOT EXISTS management_token_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS position text NULL;

-- Deduplicación de externos: un contacto por evento entre estados no cancelados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_dedup
  ON public.event_registrations (event_id, contact_fingerprint)
  WHERE registration_type = 'EXTERNAL'
    AND status <> 'CANCELLED'
    AND contact_fingerprint IS NOT NULL;

-- Lookup por token de gestión (hash).
CREATE INDEX IF NOT EXISTS ix_reg_mgmt_token
  ON public.event_registrations (management_token_hash)
  WHERE management_token_hash IS NOT NULL;

COMMIT;
