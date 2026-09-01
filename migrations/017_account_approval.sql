-- 017_account_approval.sql
-- Iteración 3: estados de cuenta + permiso de revisión.
-- Aditiva y segura: TODOS los usuarios existentes quedan ACTIVE (nadie se bloquea).
-- Correr a mano en la consola Postgres de Railway, como las migraciones previas.

BEGIN;

-- 1) Estado de cuenta (default ACTIVE → los existentes quedan ACTIVE).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS account_reviewed_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS account_reviewed_by   uuid NULL REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS account_rejection_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status') THEN
    ALTER TABLE public.users ADD CONSTRAINT chk_users_status
      CHECK (status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_users_status ON public.users (status);

-- 2) Permiso de revisión de cuentas (mismo patrón que 013 'users.unlock').
INSERT INTO public.permissions (code, category, description) VALUES
  ('accounts.review', 'USUARIO', 'Ver y resolver solicitudes de cuenta (aprobar/rechazar)')
ON CONFLICT (code) DO NOTHING;

-- Asignar a 'admin' (super_admin es comodín en código). OJO: roles.id es smallint.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.code) = 'admin'
  AND p.code = 'accounts.review'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
