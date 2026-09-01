# Plan de implementación — Iteración 3 (Account Approval)

> Estado: **propuesta para aprobar antes de tocar la DB de producción**.
> Alcance: **solicitud de cuenta + aprobación admin + estados de cuenta**, sin romper el login actual.
> Basado en `event-access-product-docs` (01/02/03/06/09) y aterrizado en el código real (verificado 2026-09-01).

---

## 1. Alcance de esta tanda

**Sí entra:**

- Estado de cuenta `PENDING / ACTIVE / REJECTED / SUSPENDED` en `users`.
- Registro nuevo (bajo flag) queda **PENDING**: no entra a la comunidad, no recibe sesión.
- Pantalla "Solicitud en revisión" + mensajes neutrales para rechazado/suspendido.
- Bandeja de administración: listar pendientes, **aprobar/rechazar** con auditoría.
- Permiso dedicado `accounts.review` (rol revisor).
- Suspensión revoca la sesión y bloquea nuevas autenticaciones.

**No entra (se difiere):**

- Guest→Member (vinculación de participaciones previas) → **Iteración 4**.
- Verificación de contacto / notificaciones por WhatsApp → no en v1.
- SLA operativo del backlog → se documenta, no se automatiza.

**Invariantes de seguridad (no negociables):**

- Todos los usuarios existentes migran a **`ACTIVE`**. **Nadie queda bloqueado.**
- Con el flag **apagado**, el comportamiento es **idéntico al de hoy** (registro entra directo, sesión sin chequeo extra).
- Toda la feature vive detrás de `ACCOUNT_APPROVAL_ENABLED`.

---

## 2. Mapeo con el modelo actual

| Concepto del spec | Hoy en el código | Acción |
|---|---|---|
| `User.status` PENDING/ACTIVE/REJECTED/SUSPENDED | `users.is_active` (boolean) | **Agregar `status`**; `is_active` sigue siendo el gate operativo |
| Solicitud + aprobación | `pin_unlock_requests` (PENDING/APPROVED/DENIED + bandeja admin) | **Espejar ese patrón** para la bandeja de cuentas |
| Permiso de revisor | RBAC en `permissions`/`role_permissions` (super_admin = comodín) | **Nuevo permiso `accounts.review`** asignado a `admin` |
| Registro | `POST /auth/pin/register` crea User is_active=true + emite token | Bajo flag: crea `PENDING` (is_active=false) y **no** emite token |
| Login/gates | `is_active` chequeado en login, `/me`, asignar capitán; **NO** en `get_actor_user_id` | Agregar chequeo en `get_actor_user_id` (bajo flag) para revocar sesiones |
| Auditoría | `event_audit_log` (actor, acción, metadata) | Reusar: `APPROVE_ACCOUNT` / `REJECT_ACCOUNT` |

> Ojo DB: `roles.id` es **smallint** (no uuid); `super_admin` no se siembra (comodín en código). Las migraciones se corren a mano en Railway.

---

## 3. Decisión de arquitectura + decisiones abiertas

### ADR — dónde vive la identidad pendiente: **`User.status` (recomendado)** vs tabla `AccountRequest` separada

**Recomendado: `User.status` con `is_active` como gate operativo.** Un registro pendiente crea el User con **`is_active = false` + `status = 'PENDING'`**. Ventaja clave: **todos los gates de hoy (`is_active`) ya lo excluyen** (login, `/me`, asignar capitán, rosters) — no hay que agregar filtros por todos lados. Reusa login/lockout/PIN tal cual. Aprobar = `is_active=true, status='ACTIVE'`.

Alternativa (tabla `AccountRequest` separada, sin crear User hasta aprobar): más "pura" respecto a no crear credenciales antes de aprobar, pero obliga a que login y `/auth/pin/status` consulten **dos** tablas y a materializar el User en la aprobación. Más superficie y más riesgo para este stack (phone+PIN). Se descarta para v1 salvo que se pida.

| # | Decisión | Default propuesto | Alternativa |
|---|---|---|---|
| D1 | Modelo | **`User.status` + is_active=false para pending** | Tabla `AccountRequest` separada |
| D2 | Re-registro de un teléfono `REJECTED`/`PENDING` | **Reabrir como PENDING** (update de la fila, no 409) | Bloquear (queda rechazado) |
| D3 | Revocación de sesión al suspender | **Chequear estado en `get_actor_user_id` (bajo flag)** → corta sesión ya | Solo front (logout al fallar `/me`) |
| D4 | ¿Quién aprueba? | **Permiso `accounts.review`** (a `admin` + super_admin comodín) | Rol separado dedicado |
| D5 | Comunicación de rechazo | **Mensaje neutral** al solicitante; motivo interno categorizado | Sin motivo |
| D6 | Estados administrativos previos | Todos los existentes → **ACTIVE**; el toggle activar/desactivar sincroniza ACTIVE↔SUSPENDED | Mapear is_active=false → SUSPENDED |

---

## 4. Migración `017_account_approval.sql` (aditiva)

```sql
-- 017_account_approval.sql
-- Iteración 3: estados de cuenta + permiso de revisión.
-- Aditiva y segura: todos los usuarios existentes quedan ACTIVE.
BEGIN;

-- 1) Estado de cuenta (default ACTIVE; los existentes quedan ACTIVE).
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

-- 2) Permiso de revisión de cuentas (mismo patrón que 013 users.unlock).
INSERT INTO public.permissions (code, category, description) VALUES
  ('accounts.review', 'USUARIO', 'Ver y resolver solicitudes de cuenta (aprobar/rechazar)')
ON CONFLICT (code) DO NOTHING;

-- Asignar a 'admin' (super_admin es comodín en código). role_id es smallint.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.code) = 'admin'
  AND p.code = 'accounts.review'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
```

## 4.1 Flag (`settings.py` + `/config`)

- `ACCOUNT_APPROVAL_ENABLED` (ya definido en Iter 0) → ahora **se usa**.
- `GET /config` agrega `accountApprovalEnabled`.

---

## 5. Backend

### 5.1 Registro (`auth.py` → `pin_register`)

- Flag **off**: comportamiento actual (is_active=true, emite token).
- Flag **on**:
  - Crea/actualiza User con `is_active=false`, `status='PENDING'`. **No emite token.**
  - Re-registro (D2): si ya existe un User con ese teléfono y está `PENDING`/`REJECTED` → **update** (nuevo nombre/PIN, `status='PENDING'`). Si está `ACTIVE`/`SUSPENDED` → `409`.
  - Responde `{ status: 'PENDING', message: 'Tu solicitud quedó en revisión.' }`.
  - Audita `ACCOUNT_REQUEST_SUBMITTED`.

### 5.2 Login / status (`auth.py`)

- `pin_login`: tras cargar el user, mapear por `status` **antes** del chequeo genérico de `is_active`:
  - `PENDING` → `403 ACCOUNT_PENDING` ("Tu solicitud está en revisión.")
  - `REJECTED` → `403 ACCOUNT_REJECTED` (neutral)
  - `SUSPENDED` → `403 ACCOUNT_SUSPENDED`
  - `ACTIVE` + is_active=false (baja administrativa legacy) → "Usuario inactivo" (como hoy).
  - Validación de PIN/lockout **igual que hoy** para los ACTIVE.
- `pin_status`: agregar estados `pending` / `rejected` / `suspended`.

### 5.3 Gate de sesión (`utils/deps.py` → `get_actor_user_id`) (D3)

- Con `ACCOUNT_APPROVAL_ENABLED`: además de verificar el token HMAC, hacer un lookup PK `SELECT is_active, status FROM users WHERE id=:id` y **bloquear** si `status != 'ACTIVE'` o `is_active=false` → `401`. Esto revoca sesiones al suspender y **cierra el hueco actual** (hoy un desactivado con token viejo pega a endpoints que no son `/me`).
- Flag **off**: chequeo puro de token, idéntico a hoy (cero lookups extra).
- Fail-closed consistente (si la DB está caída, ya no anda nada).

### 5.4 Bandeja de administración (`admin_users.py`, permiso `accounts.review`)

Espeja `unlock-requests`:
- `GET /admin/account-requests?status=PENDING&limit=…` — lista usuarios `PENDING` (nombre, teléfono, created_at, y posibles coincidencias de teléfono/nombre).
- `POST /admin/account-requests/{user_id}/approve` — `FOR UPDATE` + chequeo de estado; `status='ACTIVE', is_active=true, account_reviewed_at/by`. Audita `APPROVE_ACCOUNT`. Idempotente (si ya no está PENDING → `409` con estado vigente).
- `POST /admin/account-requests/{user_id}/reject` — `status='REJECTED', is_active=false`, `account_rejection_reason` (motivo interno categorizado). Audita `REJECT_ACCOUNT`.
- El toggle actual `PATCH /admin/users/{id}` (activar/desactivar) sincroniza `ACTIVE↔SUSPENDED` (sin tocar PENDING/REJECTED).

### 5.5 Códigos de error

`ACCOUNT_PENDING`, `ACCOUNT_REJECTED`, `ACCOUNT_SUSPENDED`, `VERSION_CONFLICT`. Respuestas neutrales (no enumerar cuentas).

---

## 6. Frontend

### 6.1 Registro / login (`App.jsx`)

- Consumir `accountApprovalEnabled` de `/config`.
- Registro con flag on: la respuesta `{status:'PENDING'}` no loguea → mostrar **pantalla "Solicitud en revisión"** (`AccountPendingState`) en vez de entrar.
- Login: manejar `ACCOUNT_PENDING` (revisión), `ACCOUNT_REJECTED` (mensaje neutral + contacto si existe), `ACCOUNT_SUSPENDED` (sin acceso). Un `401` por sesión revocada → logout normal (ya existe `handleAuthFailure`).

### 6.2 Bandeja admin (`AdminPanel.jsx`)

- Nueva tab **"Solicitudes"** (perm `accounts.review`), `AccountRequestsTab` clonando `UnlockRequestsTab`: lista pendientes, **Aprobar/Rechazar** con modal de confirmación; rechazo pide motivo interno categorizado (no se envía al solicitante).
- Datos mínimos, paginación simple, y aviso de coincidencias posibles.

---

## 7. Rollout / rollback

1. Migración 017 (aditiva) en Railway → todos ACTIVE.
2. Deploy backend con `ACCOUNT_APPROVAL_ENABLED=false` (comportamiento idéntico a hoy).
3. Deploy frontend (pantallas detrás del flag).
4. Activar primero la **bandeja + auditoría** (interno); confirmar capacidad operativa.
5. Recién ahí enrutar registros nuevos a PENDING (flag on).
- **Rollback**: flag off → registro entra directo otra vez, `get_actor_user_id` vuelve al chequeo puro; datos intactos. Los `PENDING` existentes quedan a la espera (no se pierden).

---

## 8. Testing / QA (doc 09)

- Todo registro nuevo bajo flag empieza `PENDING`; `PENDING/REJECTED/SUSPENDED` no acceden.
- Solo `accounts.review` (o super_admin) puede revisar.
- Aprobar activa **exactamente una** cuenta; rechazar no la activa.
- Decisiones simultáneas → un único resultado (`FOR UPDATE`) y conflicto controlado.
- Suspender revoca la sesión (get_actor_user_id) y bloquea login.
- **Regresión crítica**: con flag off, registro/login/lockout/PIN reset **idénticos**; usuarios existentes entran normal.
- Auditoría registra actor, momento y decisión; mensajes neutrales (sin enumeración).
- Tests backend autónomos (mapa de estados, gating) + a11y del pending state.

---

## 9. Checklist de ejecución

- [ ] **0** `migrations/017_account_approval.sql` (revisar → correr en Railway).
- [ ] **1** flag + `/config` (`accountApprovalEnabled`).
- [ ] **2** `pin_register` bajo flag → PENDING (sin token) + re-registro.
- [ ] **3** `pin_login` + `pin_status`: estados PENDING/REJECTED/SUSPENDED.
- [ ] **4** `get_actor_user_id`: gate de estado bajo flag.
- [ ] **5** bandeja admin: list/approve/reject + sync del toggle activar/desactivar.
- [ ] **6** frontend: pending state, mensajes de login, `AccountRequestsTab` + tab.
- [ ] **7** tests + a11y.
- [ ] **8** deploy flag off → activar bandeja → enrutar a PENDING → validar.

---

*Documento de trabajo. Las decisiones §3 son defaults conservadores y pueden ajustarse en la revisión sin rehacer el plan.*
