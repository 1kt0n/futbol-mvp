# Plan de implementación — Iteración 2 (External Players)

> Estado: **propuesta para aprobar antes de tocar la DB de producción**.
> Alcance: **inscripción sin cuenta desde el enlace público** (autoservicio), sobre lo ya construido en Iteración 0+1.
> Basado en `event-access-product-docs` (01..11) y aterrizado en el código real (verificado 2026-08-31).

---

## 1. Alcance de esta tanda

**Sí entra:**

- Tipo de participante **`EXTERNAL`** en `event_registrations` (sin `User`, sin anfitrión).
- Formulario de inscripción externa en la landing pública (`/e/:shareCode`): nombre, contacto, posición opcional, aviso de privacidad.
- **Cupo/waitlist atómicos** con auto-ubicación (el externo no elige cancha; el sistema lo coloca).
- **Token de gestión personal** (sin cuenta): ver estado y cancelar.
- **Segmentación en el admin** por `MEMBER` / `HOST_GUEST` / `EXTERNAL` + contacto visible para admins.
- Contacto **cifrado en reposo** (Fernet) + **fingerprint** (HMAC) para deduplicación.
- Controles antiabuso (rate limit, dedup, doble-submit) y auditoría.

**No entra (se difiere):**

- Verificación del contacto (WhatsApp/SMS) → control antiabuso alcanza en v1.
- Guest→Member y vinculación de participaciones previas → **Iteración 4**.
- Aprobación de cuentas → **Iteración 3**.
- Job automático de retención de PII → se deja el campo y la env var; el borrado se documenta como tarea posterior.

---

## 2. Mapeo con el modelo actual

| Concepto | Hoy | Acción en Iter 2 |
|---|---|---|
| `EXTERNAL` participant | `registration_type` = USER/GUEST (VARCHAR libre, sin CHECK) | Agregar valor `EXTERNAL`; `guest_name` = nombre visible, `created_by_user_id`/`user_id` = NULL |
| contacto cifrado + fingerprint | no existe | Columnas nuevas (mig. 016); Fernet (ya disponible) + HMAC |
| token de gestión | no existe | `management_token_hash` + `management_token_expires_at`; token plano se muestra 1 vez |
| cupo por cancha | `event_courts.capacity` + waitlist + promoción (`PROMOTE_WAITLIST`) | **Reusar**; agregar auto-ubicación del externo |
| normalización de contacto | `app/utils/phone.py` (`normalize_phone`) | Reusar para validar + fingerprint |
| lectura/escritura pública | `app/routers/events_public.py` (Iter 1) | Extender con endpoints de externo |
| `allow_external_registration` | columna existe, forzada `false` en Iter 1 | **Habilitar** su edición (admin) cuando el flag y el modo lo permiten |

---

## 3. Decisiones abiertas (defaults propuestos — confirmar)

| # | Decisión | Default propuesto | Alternativa |
|---|---|---|---|
| D1 | Almacenamiento del contacto | **Fernet reversible** (`cryptography`, ya disponible) + fingerprint HMAC. El admin puede ver el teléfono para coordinar. | Solo fingerprint (más privado, el admin no puede contactar) |
| D2 | Qué contacto se pide | **WhatsApp/teléfono** (normalizado con `phone.py`) | Email |
| D3 | Ubicación del externo en cancha | **El externo elige cancha** (se le muestran con cupo); CONFIRMED si hay lugar, si no WAITLIST. Reusa la lógica de `register_user`. | Auto a la primera con cupo |
| D4 | Deduplicación | **`(event_id, contact_fingerprint)` entre estados ≠ CANCELLED** (índice único parcial) | Sin dedup / por nombre |
| D5 | Token de gestión | **En la URL de gestión (`/g/:token`), hasheado en DB, limpieza de URL en el front** | Cookie HttpOnly + intercambio |
| D6 | Vigencia token de gestión | **`starts_at` + 7 días** (configurable por env) | Fin del evento |
| D7 | Idempotencia del alta | **In-memory (doble-submit) + índice de dedup (durable)** | Tabla `idempotency_keys` persistente |
| D8 | ¿Admin excede cupo? | **No (sin sobrecupo)**, como hoy | Permitir override |
| D9 | Retención de PII externa | **Campo + env `EXTERNAL_PII_RETENTION_DAYS`; job de borrado = tarea posterior** | Job automático ya en v1 |

---

## 4. Migración `016_external_participants.sql` (aditiva)

```sql
-- 016_external_participants.sql
-- Iteración 2: participante EXTERNAL (inscripción sin cuenta).
-- Aditiva: no cambia el comportamiento de USER/GUEST existentes.
BEGIN;

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS contact_encrypted text NULL,
  ADD COLUMN IF NOT EXISTS contact_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS management_token_hash text NULL,
  ADD COLUMN IF NOT EXISTS management_token_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS position text NULL;

-- Dedup de externos: un contacto por evento entre estados no cancelados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_dedup
  ON public.event_registrations (event_id, contact_fingerprint)
  WHERE registration_type = 'EXTERNAL'
    AND status <> 'CANCELLED'
    AND contact_fingerprint IS NOT NULL;

-- Lookup por token de gestión.
CREATE INDEX IF NOT EXISTS ix_reg_mgmt_token
  ON public.event_registrations (management_token_hash)
  WHERE management_token_hash IS NOT NULL;

COMMIT;
```

> `registration_type` es VARCHAR libre (sin CHECK), así que `EXTERNAL` no requiere tocar constraints. La query de `player-cards` ya filtra `IN ('USER','GUEST')`, así que los externos quedan naturalmente fuera del ranking.

## 4.1 Flags / env (`settings.py`)

- `EXTERNAL_REGISTRATION_ENABLED` (ya definido en Iter 0) → ahora **se usa**.
- `EXTERNAL_CONTACT_KEY` (Fernet key base64; si falta, se deriva de `AUTH_SECRET`).
- `EXTERNAL_PII_RETENTION_DAYS` (default p.ej. 30; solo documenta la política, el job es posterior).
- `GET /config` agrega `externalRegistrationEnabled`.

---

## 5. Backend

### 5.1 Utilidades nuevas

**`app/utils/contact_crypto.py`**
- `encrypt_contact(plain) -> token` / `decrypt_contact(token) -> plain` (Fernet, key de env o derivada de `AUTH_SECRET`).
- `contact_fingerprint(raw) -> hex` = HMAC-SHA256(clave, `normalize_phone(raw)`), con separación de dominio.

**`app/utils/management_token.py`** (o helpers en `security.py`)
- `gen_management_token() -> str` (`secrets.token_urlsafe(32)`).
- `hash_management_token(tok) -> hex` (sha256; 256 bits de entropía, sin brute-force).

### 5.2 Endpoints públicos (`events_public.py`, sin auth)

- **`POST /public/events/{share_code}/participants`** — alta externa.
  - Gating: `EXTERNAL_REGISTRATION_ENABLED` + `access_mode ∈ (LINK_ACCESS, LINK_PASSWORD)` + `allow_external_registration` + `status = OPEN` + `privacy_accepted`. En `LINK_PASSWORD`, exige grant válido (header `X-Event-Access`).
  - `Idempotency-Key` header (in-memory) + `rate_limit` por IP / share_code / fingerprint.
  - Body: `{ display_name, contact, court_id, position?, privacy_accepted }`.
  - **El externo elige `court_id`** (mostrado con cupo en la landing): misma lógica atómica que el alta de miembro (`register_user`) — lock de la cancha `FOR UPDATE`, si hay cupo → `CONFIRMED` en esa cancha, si no → `WAITLIST` (`court_id NULL`).
  - La lectura pública (`GET /public/events/{code}`) agrega **disponibilidad por cancha** (id, nombre, cupo/available, is_open) para el selector — sin roster/PII.
  - Dedup por `(event_id, contact_fingerprint)`; `409 DUPLICATE_PARTICIPANT` sin filtrar datos ajenos ni el token.
  - Inserta `EXTERNAL` (guest_name=display_name, contact_encrypted, contact_fingerprint, management_token_hash, expires, position). Audita `REGISTER_EXTERNAL`.
  - `201 { status, waitlist_position?, management_path }` (`/g/{token}` mostrado **una sola vez**).
  - Post-commit: si `CONFIRMED`, `check_and_auto_close_court`.
- **`GET /public/participations/{management_token}`** — estado propio (hash→lookup, chequea expiración). Devuelve estado + datos mínimos del evento; nunca datos de terceros.
- **`POST /public/participations/{management_token}/cancel`** — baja propia; libera cupo y **promueve waitlist** (reusa la promoción existente). Audita `CANCEL_EXTERNAL`.

### 5.3 Admin (`admin_events.py`)

- **`POST /admin/events/{id}/participants/{reg_id}/rotate-management-token`** — rota el token ante exposición. Audita `ROTATE_MGMT_TOKEN`.
- **`PATCH .../access`**: dejar de forzar `allow_external_registration=false`; aceptarlo cuando `EXTERNAL_REGISTRATION_ENABLED` y el modo es `LINK_*`.
- **Detalle**: segmentar participantes e incluir `type` (MEMBER/HOST_GUEST/EXTERNAL) y, para externos, el **contacto descifrado** (solo con permiso `events.manage`) + totales por tipo/estado.

### 5.4 Fix de serialización para EXTERNAL (obligatorio)

`created_by_user_id` es NULL para externos → hoy `str(r["created_by_user_id"])` daría `"None"`. Guardar contra NULL en:
- `app/routers/events.py:256` y `:285` (get_active_event: confirmed + waitlist)
- `app/routers/admin_events.py:1186` y `:1213` (get_event_detail: confirmed + waitlist)

Mapear `type`: `USER→MEMBER`-equivalente ya se muestra; agregar rama para `EXTERNAL` (nombre = `guest_name`, sin `created_by`).

---

## 6. Frontend

### 6.1 Landing pública (`PublicEventPage.jsx`)

- Si `allow_external_registration` + `registration_open` → CTA **“Anotarme”** que abre `ExternalRegistrationForm`.
- Si no hay cupo pero hay waitlist → CTA **“Sumarme a la lista de espera”**.

### 6.2 `ExternalRegistrationForm.jsx`

- Campos: nombre + contacto (requeridos), posición (opcional), checkbox de privacidad con enlace.
- Prevención de doble submit; preservar valores ante error recuperable; sin CAPTCHA en v1.
- Al confirmar → pantalla de éxito con estado (`CONFIRMED`/`WAITLISTED`) + **link de gestión** (mostrar 1 vez, “guardá este link”), copiar + WhatsApp.

### 6.3 Página de gestión `/g/:token` (`ExternalParticipationPage.jsx`)

- `GET participations` → estado + evento; botón **Cancelar** (con confirmación).
- Limpieza de URL (`history.replaceState`) para no dejar el token en el historial/referrer.
- Registrar ruta `/g/:token` en `main.jsx` (prefijo PWA-safe, fuera del denylist).

### 6.4 Admin (`EventAccessPanel.jsx` + detalle)

- Toggle **“Permitir inscripción sin cuenta”** (gateado por `externalRegistrationEnabled` + modo `LINK_*`).
- Lista de participantes segmentada con **badge EXTERNAL** + contacto (para admins) + acción “rotar link de gestión”.

### 6.5 PWA (`vite.config.js`)

- `/g/` no colisiona con el denylist. Agregar `runtimeCaching` `NetworkFirst` para `/public/participations/` si hace falta.

---

## 7. Antiabuso, idempotencia y privacidad

- Rate limit por IP + share_code + fingerprint en el alta (reusa `ratelimit.py`).
- Idempotencia in-memory por `Idempotency-Key` (doble-submit) + índice de dedup (durable).
- Nunca loguear contacto/clave/token; el middleware forense ya loguea solo el actor verificado.
- Contacto cifrado en reposo; fingerprint no reversible; token de gestión solo hasheado.
- Roster público sigue respetando `public_roster_visibility` (default `NONE`).

---

## 8. Rollout / retención

1. Migración 016 (aditiva) en Railway.
2. Deploy backend con `EXTERNAL_REGISTRATION_ENABLED=false`.
3. Deploy frontend (form detrás del flag).
4. Canary: habilitar el flag + `allow_external_registration` en 1–2 eventos de prueba, roster oculto, límites conservadores. Observar conversión, spam, duplicados, carreras de cupo, cancelación, waitlist.
5. Ampliar por cohortes.
- **Rollback**: flag off → el form desaparece y el endpoint responde 404; datos intactos.
- **Retención**: documentar `EXTERNAL_PII_RETENTION_DAYS`; el job de anonimización queda como tarea posterior.

---

## 9. Testing / QA (doc 09)

- **Concurrencia**: dos externos por el último cupo (un solo CONFIRMED); cancelación + alta simultáneas; promoción de waitlist; dedup en carrera (índice único gana).
- **Idempotencia**: mismo `Idempotency-Key` → mismo resultado y token.
- **Token**: ver/cancelar solo la propia participación; token expirado → 401; rotación invalida el anterior.
- **Gating**: sin flag / sin `allow_external` / evento cerrado → 404/errores accionables.
- **Cifrado**: round-trip de contacto; fingerprint estable y no reversible; nada de PII en logs.
- **Regresión**: USER/GUEST + waitlist + auto-cierre **sin cambios**; serialización con externos presentes no rompe (fix §5.4).
- Tests backend autónomos (como Iter 1) + a11y smoke en el form.

---

## 10. Checklist de ejecución

- [ ] **0** `migrations/016_external_participants.sql` (revisar → correr en Railway).
- [ ] **1** utils: `contact_crypto.py` + `management_token` + flags/env + `/config`.
- [ ] **2** endpoints públicos: `participants`, `participations` (get/cancel) + auto-ubicación atómica.
- [ ] **3** admin: rotate token, habilitar `allow_external`, segmentación + contacto.
- [ ] **4** fix serialización EXTERNAL (§5.4).
- [ ] **5** frontend: form externo, éxito + management link, página `/g/:token`, toggle admin.
- [ ] **6** tests + a11y.
- [ ] **7** deploy flags off → canary en evento de prueba → validar.

---

*Documento de trabajo. Las decisiones §3 son defaults del spec y pueden ajustarse en la revisión sin rehacer el plan.*
