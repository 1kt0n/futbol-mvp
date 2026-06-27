-- 012_permissions.sql
-- RBAC granular: catalogo de permisos + relacion rol<->permiso.
-- Extiende public.roles con metadata de display y proteccion de roles de sistema.
-- Siembra el catalogo inicial y asigna a 'admin' todos los permisos menos roles.manage.
-- 'super_admin' se trata como comodin en codigo (no necesita filas en role_permissions).
-- Se corre a mano en Supabase (SQL Editor), igual que las migraciones previas.

BEGIN;

-- ============================================================
-- 1) Extender public.roles con metadata
-- ============================================================
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS name        text NULL,
  ADD COLUMN IF NOT EXISTS description text NULL,
  ADD COLUMN IF NOT EXISTS is_system   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();

-- Nombre de display por defecto = code, y marcar roles de sistema (no editables/borrables)
UPDATE public.roles SET name = COALESCE(name, code);
UPDATE public.roles SET is_system = true WHERE LOWER(code) IN ('admin', 'super_admin');

-- ============================================================
-- 2) Catalogo de permisos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar UNIQUE NOT NULL,
  category    varchar NOT NULL,
  description varchar NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3) Relacion rol <-> permiso
-- ============================================================
-- NOTA: roles.id es smallint en esta base (no uuid), por eso role_id es smallint.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       smallint NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions (role_id);

-- ============================================================
-- 4) Seed del catalogo de permisos
-- ============================================================
INSERT INTO public.permissions (code, category, description) VALUES
  ('events.view',               'EVENTO',       'Ver eventos en el panel de administracion'),
  ('events.create',             'EVENTO',       'Crear eventos'),
  ('events.manage',             'EVENTO',       'Abrir, cerrar, finalizar y cambiar visibilidad de eventos'),
  ('registrations.manage',      'EVENTO',       'Mover y dar de baja inscripciones de jugadores'),
  ('courts.manage',             'CANCHA',       'Crear, editar, eliminar, abrir y cerrar canchas'),
  ('courts.captains.manage',    'CANCHA',       'Asignar y quitar capitanes de cancha'),
  ('users.view',               'USUARIO',      'Ver y buscar usuarios'),
  ('users.create',             'USUARIO',      'Crear usuarios manualmente'),
  ('users.manage',             'USUARIO',      'Activar/desactivar usuarios y resetear PIN'),
  ('users.roles.assign',       'USUARIO',      'Asignar roles a usuarios'),
  ('notifications.view',       'NOTIFICACION', 'Ver notificaciones globales (panel admin)'),
  ('notifications.create',     'NOTIFICACION', 'Crear notificaciones globales'),
  ('notifications.delete',     'NOTIFICACION', 'Desactivar notificaciones globales'),
  ('tournaments.view',         'TORNEO',       'Ver torneos en el panel de administracion'),
  ('tournaments.manage',       'TORNEO',       'Crear y configurar torneos, equipos y fixture'),
  ('tournaments.matches.manage','TORNEO',      'Iniciar partidos, cargar resultados y finalizarlos'),
  ('calendar.view',            'CALENDARIO',   'Ver anuncios del calendario (panel admin)'),
  ('calendar.manage',          'CALENDARIO',   'Crear, editar y eliminar anuncios del calendario'),
  ('audit.view',               'AUDITORIA',    'Ver el registro de auditoria'),
  ('roles.manage',             'SISTEMA',      'Crear, editar y eliminar roles y sus permisos')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 5) Asignar a 'admin' todos los permisos EXCEPTO roles.manage
--    (super_admin es comodin en codigo, no se siembra)
-- ============================================================
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.code) = 'admin'
  AND p.code <> 'roles.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
