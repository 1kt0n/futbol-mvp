-- 003_notifications.sql
-- Sistema de notificaciones informativas + descartes por usuario

-- ============================================================
-- 1) Tabla de notificaciones globales
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR NOT NULL DEFAULT 'INFO',
  title VARCHAR NOT NULL,
  message TEXT NOT NULL,
  action_url VARCHAR NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_notifications_kind
    CHECK (kind IN ('INFO'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_active_window
  ON public.notifications (is_active, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);

-- ============================================================
-- 2) Descartes por usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_notification_dismissals (
  user_id UUID NOT NULL REFERENCES public.users(id),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_dismissals_user
  ON public.user_notification_dismissals (user_id);
