-- 001_init.sql
-- Schema completo de tablas base para futbol-mvp
-- Ejecutar en el SQL Editor de Supabase para inicializar un ambiente nuevo

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR NOT NULL,
  email VARCHAR,
  phone_e164 VARCHAR UNIQUE NOT NULL,
  phone_login VARCHAR UNIQUE NOT NULL,
  nickname VARCHAR,
  avatar_url VARCHAR,
  is_active BOOLEAN DEFAULT true,
  pin_salt VARCHAR(32),
  pin_hash VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR UNIQUE NOT NULL
);

INSERT INTO public.roles (code) VALUES ('admin'), ('super_admin')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- ASIGNACIÓN DE ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID NOT NULL REFERENCES public.users(id),
  role_id UUID NOT NULL REFERENCES public.roles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ============================================================
-- EVENTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  location_name VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'OPEN',
  close_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CANCHAS POR EVENTO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  name VARCHAR NOT NULL,
  capacity INT NOT NULL CHECK (capacity >= 1 AND capacity <= 50),
  is_open BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INSCRIPCIONES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  registration_type VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'CONFIRMED',
  court_id UUID REFERENCES public.event_courts(id),
  created_by_user_id UUID REFERENCES public.users(id),
  user_id UUID REFERENCES public.users(id),
  guest_name VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

-- ============================================================
-- CAPITANES DE EVENTO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_captains (
  event_id UUID NOT NULL REFERENCES public.events(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  PRIMARY KEY (event_id, user_id)
);

-- ============================================================
-- CAPITANES POR CANCHA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_court_captains (
  event_id UUID NOT NULL REFERENCES public.events(id),
  court_id UUID NOT NULL REFERENCES public.event_courts(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, court_id, user_id)
);

-- ============================================================
-- AUDITORÍA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id),
  actor_user_id UUID REFERENCES public.users(id),
  action VARCHAR NOT NULL,
  target_registration_id UUID REFERENCES public.event_registrations(id),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
