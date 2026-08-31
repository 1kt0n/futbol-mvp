# Plan de implementación — Iteración 0 + 1 (Event Access v1)

> Estado: **propuesta para aprobar antes de tocar la DB de producción**.
> Alcance: **link para compartir + contraseña de evento, para el modelo actual de miembros**.
> Basado en el paquete `event-access-product-docs` (01..11) y aterrizado en el código real de este repo (verificado 2026-08-30).

---

## 1. Alcance de esta tanda

**Sí entra (Iteración 0 acotada a lo que 1 necesita + Iteración 1):**

- Columnas de acceso en `events` (migración `015`, aditiva, expand/contract).
- Feature flags por env + endpoint público de config para el frontend.
- Generación de `share_code` + link canónico + rotación.
- Contraseña de evento: hash, seteo/rotación/borrado, versión que invalida grants.
- Lectura pública sanitizada del evento (`/public/events/{shareCode}`) + pantalla de unlock + grant firmado con rate limiting.
- UI de admin: bloque **Acceso** + panel **Compartir** (link + QR + WhatsApp).
- Landing pública mínima `/e/:shareCode` (ver evento tras validar clave). Un miembro logueado se anota con el flujo actual.

**No entra (se difiere, con justificación):**

- **Inscripción externa sin cuenta** (formulario público, token de gestión, dedup por contacto) → **Iteración 2**. Por eso `allow_external_registration` se agrega pero queda **forzado en `false`** en v1.
- **Tipo de participante `EXTERNAL`** y renombre `USER/GUEST` → `MEMBER/HOST_GUEST` → **Iteración 2**. La Iteración 1 (miembros) **no lo necesita**: los miembros ya se anotan con el modelo actual. Evitamos un refactor grande y riesgoso (la query de `player-cards` y los torneos dependen de `USER/GUEST`).
- Aprobación de cuentas (`PENDING/ACTIVE`, `AccountRequest`) → **Iteración 3**.
- Outbox de notificaciones/analytics como infra nueva: en v1 reusamos el `event_audit_log` existente y logs de Railway; no montamos outbox todavía.

---

## 2. Mapeo con el modelo actual (resumen)

| Spec | Hoy | Acción en 0+1 |
|---|---|---|
| `EventParticipant` unificado | `event_registrations` (ya unifica `USER`/`GUEST`) | Sin cambios en 0+1 (extensión a `EXTERNAL` en Iter 2) |
| `Event.accessMode / shareCode / passwordHash / passwordVersion / publicRosterVisibility / allowExternalRegistration` | No existen | **Columnas nuevas (mig. 015)** |
| `registrationStatus` OPEN/CLOSED | `events.status` (OPEN/CLOSED/FINALIZED) + `close_at` | **Reusar `status`**, no agregar columna nueva |
| `EventAccessGrant` | No existe | **Token firmado HMAC** (sin tabla), con `password_version` para revocar |
| `AuditLog` | `event_audit_log` (metadata JSONB) | Reusar, nuevas `action` |
| Waitlist atómica + promoción | Ya existe (`PROMOTE_WAITLIST`) | Sin cambios |
| Lectura pública por token | Ya existe en torneos (`tournaments_public.py`) | **Clonar patrón** para eventos |
| Auth | Header `X-Actor-User-Id` = token firmado; sin cookies | Grant de acceso = **bearer en header `X-Event-Access`**, en memoria (no URL, no localStorage) |

Referencias de código: `app/routers/events.py`, `app/routers/admin_events.py`, `app/routers/tournaments_public.py`, `app/utils/auth_token.py`, `app/utils/security.py`, `app/utils/ratelimit.py`, `app/settings.py`, `app/main.py`, `futbol-mvp-web/src/main.jsx`, `futbol-mvp-web/src/AdminPanel.jsx`, `futbol-mvp-web/src/features/tournaments/admin/tabs/ShareTab.jsx`, `futbol-mvp-web/vite.config.js`.

---

## 3. Decisiones abiertas (defaults propuestos — confirmar en la revisión)

| # | Decisión | Default propuesto | Alternativa |
|---|---|---|---|
| D1 | Hash de la clave del evento | **PBKDF2-HMAC-SHA256**, ~200k iter, salt por evento (mismo enfoque que `hash_pin`, sin dependencia nativa nueva) | Agregar `argon2-cffi` (más fuerte, build nativo en Docker/Railway) |
| D2 | Transporte del grant | **Bearer firmado en memoria + header `X-Event-Access`** (no viaja en URL ni en localStorage) | Cookie `HttpOnly` (más segura, pero hoy la app no usa cookies y dev es cross-origin) |
| D3 | Vigencia del grant | **24 h** | Hasta fin del evento |
| D4 | Política mínima de clave | **≥ 8 caracteres** (frase) | Reglas de complejidad adicionales |
| D5 | Roster público por defecto | **`NONE`** | `FIRST_NAME` |
| D6 | `registrationStatus` | **Reusar `events.status`** (no columna nueva) | Columna dedicada |
| D7 | Tipo `EXTERNAL` / renombre participantes | **Diferir a Iteración 2** | Hacerlo ahora |
| D8 | Prefijo de ruta pública | **`/e/:shareCode`** (evita el denylist PWA `/^\/events/`) | `/evento/`, `/acceso/` |

Todos son defaults conservadores del spec; se pueden cambiar sin rehacer el plan.

---

## 4. Iteración 0 — Fundaciones

### 4.1 Migración `015_event_access.sql` (aditiva, correr a mano en Railway)

Sigue el estilo de `014` (transacción + `ADD COLUMN IF NOT EXISTS` + `DO $$` para constraints). **No destructiva**: eventos existentes quedan en `MEMBERS_ONLY`, sin share code, sin clave — comportamiento idéntico al actual.

```sql
-- 015_event_access.sql
-- Event Access v1: modo de acceso, share code y contraseña de evento.
-- Aditiva y compatible: todos los eventos existentes quedan en MEMBERS_ONLY,
-- sin share_code ni clave (comportamiento idéntico al actual).
-- Correr a mano en la consola Postgres de Railway, como las migraciones previas.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'MEMBERS_ONLY',
  ADD COLUMN IF NOT EXISTS allow_external_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_code text NULL,
  ADD COLUMN IF NOT EXISTS password_hash text NULL,
  ADD COLUMN IF NOT EXISTS password_salt text NULL,
  ADD COLUMN IF NOT EXISTS password_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_roster_visibility text NOT NULL DEFAULT 'NONE';

-- CHECK: access_mode válido
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_access_mode') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_access_mode
      CHECK (access_mode IN ('MEMBERS_ONLY','LINK_ACCESS','LINK_PASSWORD'));
  END IF;
END $$;

-- CHECK: roster visibility válido
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_roster_vis') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_roster_vis
      CHECK (public_roster_visibility IN ('NONE','FIRST_NAME','DISPLAY_NAME'));
  END IF;
END $$;

-- CHECK: si es LINK_PASSWORD, tiene que haber hash+salt (coherencia a nivel DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_events_password_present') THEN
    ALTER TABLE public.events ADD CONSTRAINT chk_events_password_present
      CHECK (access_mode <> 'LINK_PASSWORD' OR (password_hash IS NOT NULL AND password_salt IS NOT NULL));
  END IF;
END $$;

-- Unicidad de share_code (parcial: solo cuando existe)
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_share_code
  ON public.events (share_code)
  WHERE share_code IS NOT NULL;

COMMIT;
```

> Nota sobre `event_registrations.registration_type`: hoy es `VARCHAR` libre (sin CHECK), así que agregar `EXTERNAL` en Iteración 2 no requiere tocar constraints ahora.

### 4.2 Feature flags (`app/settings.py`)

Agregar, leídos de env (default `false`):

```python
EVENT_ACCESS_ENABLED    = os.getenv("EVENT_ACCESS_ENABLED", "false").lower() == "true"
EVENT_PASSWORDS_ENABLED = os.getenv("EVENT_PASSWORDS_ENABLED", "false").lower() == "true"
# Reservados para fases futuras (se definen ya, pero no se usan en 0+1):
EXTERNAL_REGISTRATION_ENABLED = os.getenv("EXTERNAL_REGISTRATION_ENABLED", "false").lower() == "true"
ACCOUNT_APPROVAL_ENABLED      = os.getenv("ACCOUNT_APPROVAL_ENABLED", "false").lower() == "true"
```

Documentar en `.env.example`.

### 4.3 Endpoint de config para el frontend

`GET /config` (público, sin auth, en `app/main.py` o router nuevo `config.py`):

```json
{ "eventAccessEnabled": false, "eventPasswordsEnabled": false }
```

El frontend lo consume una vez y decide qué UI mostrar (sin constantes de build).

---

## 5. Iteración 1 — Backend

### 5.1 Utilidades nuevas

**`app/utils/event_access_token.py`** (grant firmado, estilo `auth_token.py`):

- `issue_event_grant(event_id, password_version, ttl_hours=24) -> str`
  `base64url("{event_id}:{password_version}:{exp}:{hmac(AUTH_SECRET, ...)}")`.
- `verify_event_grant(token, event_id, current_password_version) -> bool`
  Valida firma, expiración y que `password_version` del token == la actual del evento (rotar clave invalida grants). Scopeado al `event_id`.

**`app/utils/security.py`** (agregar, sin dependencia nueva — D1):

- `hash_event_password(password, salt_hex) -> str` (PBKDF2-HMAC-SHA256, ~200k iter).
- `verify_event_password(password, salt_hex, expected_hash) -> bool` (`hmac.compare_digest`).
- `assert_event_password(pw) -> str` (valida política mínima D4: ≥ 8 chars, trim).
- Generadores: `gen_share_code()` (≥128 bits, url-safe, no secuencial), `gen_salt()`.

### 5.2 Endpoints de administración (`app/routers/admin_events.py`, prefijo `/admin`)

Todos con `require_permission(conn, actor, 'events.manage')` y audit en `event_audit_log`.

- **`PATCH /admin/events/{event_id}/access`** — configura acceso.
  Body:
  ```json
  {
    "access_mode": "LINK_PASSWORD",
    "public_roster_visibility": "NONE",
    "password": { "action": "set|keep|clear", "value": "frase-secreta" }
  }
  ```
  Reglas:
  - `LINK_PASSWORD` requiere clave existente o `action:"set"` con `value` válido.
  - `action:"set"` / `"clear"` → **incrementa `password_version`** (invalida grants) y audita `UPDATE_EVENT_ACCESS`.
  - Al pasar a `LINK_ACCESS`/`LINK_PASSWORD` sin `share_code`, se **genera** uno.
  - `allow_external_registration` se ignora/forza `false` en v1.
  - Nunca devuelve `password`/`password_hash`. Devuelve `access_mode`, `share_url`, `password_set` (bool), `public_roster_visibility`, `password_version`.
- **`POST /admin/events/{event_id}/rotate-share-code`** — nuevo `share_code`, invalida el link anterior. Audita `ROTATE_SHARE_CODE`.
- **Extender** `GET /admin/events/{id}/detail`, `GET /admin/events` y las respuestas de create/update para incluir los campos de acceso (sin secretos): `access_mode`, `share_url`, `password_set`, `public_roster_visibility`.
- (Rotación de clave = `PATCH .../access` con `password.action:"set"`; no hace falta endpoint aparte.)

Validación de UX (doc 02): advertir en la UI antes de cerrar acceso a un evento ya compartido (el backend igual audita el cambio).

### 5.3 Router público nuevo (`app/routers/events_public.py`, sin auth)

Montado sin prefijo → `/public/events/...`. Espeja `tournaments_public.py`. Registrar en `app/main.py`.

- **`GET /public/events/{share_code}`** — descriptor sanitizado.
  - Lookup por `share_code`; 404 genérico (`EVENT_NOT_FOUND`) si no existe.
  - Si `access_mode = LINK_PASSWORD` y **no** hay grant válido (header `X-Event-Access`): responder mínimo `{ event_id, access_mode, password_required: true }` — **sin** título, lugar, roster ni cupos.
  - Si `LINK_ACCESS` o grant válido: metadata sanitizada — `title`, `starts_at`, `location_name` (según política), `status`, **disponibilidad agregada** (capacidad total vs ocupados; sin roster salvo `public_roster_visibility != NONE`), y flags de CTA. Nunca PII/teléfono.
- **`POST /public/events/{share_code}/unlock`** — body `{ "password": "..." }`.
  - `rate_limit("unlock:{share_code}", 5/60s)` + `rate_limit("unlock-ip:{ip}", 10/60s)`.
  - Éxito → `{ "access_token": "...", "expires_at": "..." }` (grant scopeado a `event_id` + `password_version`). Error → `INVALID_EVENT_PASSWORD` **genérico** (no revela “casi”). Audita `EVENT_UNLOCK` con `result` bucketeado, **sin** la clave.

### 5.4 Registro bajo modos de acceso (semántica v1)

- Los **miembros** siguen anotándose con el flujo autenticado actual (`POST /events/{id}/register`, cupo por cancha). El link/clave **gatea la vista compartida**, no la capacidad del miembro de anotarse (ya está autenticado).
- La **inscripción externa sin cuenta es Iteración 2**; en v1 `allow_external_registration=false` siempre.
- El endpoint de registro no cambia su lógica de cupo/waitlist; solo respeta `status` como hoy.

### 5.5 Códigos de error (doc 04)

`EVENT_NOT_FOUND`, `PASSWORD_REQUIRED`, `INVALID_EVENT_PASSWORD`, `RATE_LIMITED`, `REGISTRATION_CLOSED`, `VERSION_CONFLICT` (para rotaciones concurrentes). Formato de error consistente con el resto de la API.

### 5.6 CORS / logs (`app/main.py`)

- Agregar `X-Event-Access` a `allow_headers` del CORS (dev cross-origin).
- El middleware forense ya loguea solo el actor verificado; **asegurar que el body de `unlock` (la clave) nunca se loguea**.
- Agregar `runtimeCaching` no aplica acá (es del SW, ver 6.4).

---

## 6. Iteración 1 — Frontend

### 6.1 Ruta pública `/e/:shareCode`

- Registrar en `src/main.jsx` (junto a las rutas de torneos, **fuera** de cualquier guard — no hay guard de router).
- **No usar prefijo `/events`** (choca con `navigateFallbackDenylist` del PWA). Usar `/e/` (D8).

### 6.2 `PublicEventPage.jsx` + `EventUnlockForm.jsx`

- Clonar el molde de `src/features/tournaments/public/TournamentPublicPage.jsx` (layout mínimo, sin nav de comunidad).
- Data provider con `fetchPublic` (sin header de auth) + header opcional `X-Event-Access` con el grant en memoria (React state; **no** localStorage — spec 05/06).
- Si `password_required` y sin grant → `EventUnlockForm`: input de clave, error genérico, prevención de doble submit, awareness de rate limit (429). Al validar → guardar grant en estado → refetch.
- Si desbloqueado → landing: nombre, fecha/hora (**TZ del evento + local**), lugar (según política), disponibilidad (cupos como dato no garantizado), estado y CTA. Estados obligatorios: loading/locked/unlocked/error/expired/offline. Accesibilidad (doc 02/09).
- Miembro logueado: mostrar CTA “Ir a la app para anotarte” hacia la vista in-app del evento (auto-registro externo es Iter 2).

### 6.3 UI de admin (`src/AdminPanel.jsx`, `EventosTab`)

- **Bloque Acceso** en el detalle del evento (columna derecha ~L937-954, junto al toggle de visibilidad):
  - Selector de modo: “Solo miembros” / “Con enlace” / “Con enlace + contraseña”.
  - Roster público (default `NONE`).
  - Controles de clave (setear/rotar/borrar) — **solo si `eventPasswordsEnabled`**.
  - **Panel Compartir** cuando hay `share_code`: caja del link + “Copiar” (`navigator.clipboard`) + WhatsApp (patrón `wa.me`, `AdminPanel.jsx` ~L1257-1303) + QR (`QRCodeSVG`, clonando `features/tournaments/admin/tabs/ShareTab.jsx`). **Nunca** incluir la clave en el mensaje de WhatsApp.
- **`EventForm`** (crear, L1710-1824): bloque de acceso con disclosure progresivo (radio “¿Quién puede anotarse?” + checkbox “Pedir contraseña”). “Permitir inscripción sin cuenta” **oculto/deshabilitado** en v1. Validaciones: clave no vacía + política mínima; confirmación al reducir acceso de un evento ya compartido.
- Nuevas llamadas (seguir prefijo `/admin/events`): `PATCH /admin/events/{id}/access`, `POST /admin/events/{id}/rotate-share-code`.
- Reusar `Modal` (L41-67), `Banner` (`App.jsx` L156-211), toast, tokens `design/ui/*`, `.app-card`.
- Gate por flags: consumir `GET /config` (una vez) y mostrar link/clave solo si están habilitados.

### 6.4 PWA (`futbol-mvp-web/vite.config.js`)

- `/e/` no está en el denylist → carga como ruta React sin cambios. **Verificar** que no se agregue accidentalmente bajo `/events`.
- Agregar regla `runtimeCaching` `NetworkFirst` para `/public/events/` (análoga a la de `/public/tournaments/`) para no cachear datos de acceso stale.

---

## 7. Rollout, backfill y rollback

1. **Migración 015** (aditiva) en Railway. Backfill trivial (defaults); validar conteos de eventos antes/después (deben ser idénticos en comportamiento).
2. **Deploy backend** con flags **off**. Tolera frontend viejo (columnas opcionales).
3. **Deploy frontend** con la UI detrás de flags **off**.
4. **Habilitar** `EVENT_ACCESS_ENABLED` para un evento de prueba interno; luego `EVENT_PASSWORDS_ENABLED`. Observar intentos de unlock, latencia del hash, 401/403/429.
5. Ampliar a organizadores seleccionados.

**Rollback**: apagar flags → los eventos vuelven a comportarse como `MEMBERS_ONLY` (default), hashes quedan inertes, **sin** rollback destructivo de esquema. Rotación de `share_code`/clave disponible como runbook ante exposición.

---

## 8. Testing / QA (criterios doc 09 aplicables a v1)

**Backend (unit/integration):**
- Grant: firma inválida, expiración, y **rotación de `password_version` invalida** grants previos; scope por evento (grant de A no sirve para B).
- Clave: hash/verify correctos; política mínima; la clave **nunca** en respuesta ni logs.
- Unlock: rate limit (429), error genérico en clave inválida.
- Lectura pública: bloqueado → sin título/lugar/roster; desbloqueado → roster respeta `NONE`.
- Access PATCH: transiciones de modo + generación de share_code + audit.
- **Regresión**: `register`/`guests`/`move`/`cancel`/waitlist + auto-cierre de cancha/evento **sin cambios**.

**Frontend:**
- `PublicEventPage`: loading/locked/unlocked/error/expired/offline.
- `EventUnlockForm`: error genérico, doble-submit, 429.
- Admin: transiciones de modo, set/rotate/clear clave, copiar/WhatsApp/QR, flags on/off.
- Playwright a11y smoke sobre `/e/:shareCode`.

**Seguridad (doc 06/09):** fuerza bruta de clave (rate limit + genérico), enumeración de share codes (aleatorio 128-bit, 403 genérico), reuso de grant tras rotación (version check), sin PII/token en logs.

---

## 9. Checklist de ejecución (orden sugerido)

- [ ] **0.1** Escribir `migrations/015_event_access.sql` y revisarlo.
- [ ] **0.2** Correr 015 en Railway; validar conteos/comportamiento.
- [ ] **0.3** Flags en `settings.py` + `.env.example` + `GET /config`.
- [ ] **1.1** `event_access_token.py` + helpers en `security.py` (+ tests).
- [ ] **1.2** Endpoints admin de acceso (`PATCH .../access`, `POST .../rotate-share-code`) + extender detail/list/create.
- [ ] **1.3** Router público `events_public.py` (`GET`, `unlock`) + registrar en `main.py` + CORS header.
- [ ] **1.4** Frontend: ruta `/e/:shareCode`, `PublicEventPage`, `EventUnlockForm`.
- [ ] **1.5** Frontend admin: bloque Acceso + Compartir (link/QR/WhatsApp) + `EventForm`.
- [ ] **1.6** PWA runtime caching `/public/events/`.
- [ ] **1.7** Tests backend + frontend + a11y smoke.
- [ ] **1.8** Deploy con flags off → habilitar en evento de prueba → validar.

---

*Documento de trabajo. Las decisiones §3 son defaults del spec y pueden ajustarse en la revisión sin rehacer el plan.*
