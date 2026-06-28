-- 013_pin_unlock.sql
-- Bloqueo de PIN tras 3 intentos fallidos (5 min) + flujo de desbloqueo con
-- validación de administradores ("Olvidé mi PIN").
-- Correr a mano en la consola Postgres de Railway, igual que las migraciones previas.

BEGIN;

-- ============================================================
-- 1) Estado de bloqueo en users
-- ============================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS failed_pin_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS must_reset_pin      boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2) Solicitudes de desbloqueo
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pin_unlock_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              varchar NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'APPROVED', 'DENIED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz NULL,
  resolved_by_user_id uuid NULL REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_unlock_req_status
  ON public.pin_unlock_requests (status, created_at);

-- Una sola solicitud PENDING por usuario (evita spam de solicitudes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_unlock_req_pending
  ON public.pin_unlock_requests (user_id)
  WHERE status = 'PENDING';

-- ============================================================
-- 3) Permiso nuevo: ver/resolver solicitudes de desbloqueo
-- ============================================================
INSERT INTO public.permissions (code, category, description) VALUES
  ('users.unlock', 'USUARIO', 'Ver y resolver solicitudes de desbloqueo de PIN')
ON CONFLICT (code) DO NOTHING;

-- Asignar a 'admin' (super_admin es comodín en código).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.code) = 'admin'
  AND p.code = 'users.unlock'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
