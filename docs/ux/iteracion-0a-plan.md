# Plan — Iteración 0a (hotfix de bajas, espera, CSS de raíz y Home al próximo partido)

## Contexto

`docs/ux/rediseno-ux.md` (§2, §6, §8.2 → 0a, §8.4) verificó contra el código bugs que hoy rompen el uso básico:
el jugador recibe 403 al bajarse (también desde "Cancelar mi lugar" del Calendario), los capitanes asignados no pueden
actuar (se escribe `event_court_captains` y se lee `event_captains`), la lista de espera casi nunca funciona porque la
cancha y el evento se auto-cierran al llenarse, re-anotarse después de una baja puede chocar con la fila CANCELLED, el
límite de invitados dice 5 en la UI y 10 en el backend, y un `transform` que deja `.page-enter` rompe todos los
`position:fixed` (modales fuera de pantalla, FAB que no flota, campana encimada). La 0a lo arregla sin migraciones,
antes del rediseño grande. Métricas de éxito (§8.4): `CANCEL_REGISTRATION` con actor = target >50% de las bajas,
`PROMOTE_WAITLIST` >0, `AUTO_CLOSE_COURT` = 0 y aparece `COURT_FULL`.

Decisiones tomadas con el usuario: **`GUEST_LIMIT_PER_USER=5`, y quien tiene `registrations.manage` no tiene tope**.
Extras sumados: **media estrella de votos** y **"Abrir cancha"/subir cupo promueven la espera**.

> Estado: implementado y verificado en local (ver "Tests y verificación"). Única desviación del plan: F1 quedó con
> `.page-enter` **solo de opacidad** (además de `backwards`). En una pestaña en segundo plano la animación queda
> congelada en el primer cuadro y el `translateY` volvía a desubicar los `fixed`; sin transform no puede pasar
> (§6.2.2: "los wrappers de ruta nunca animan transform").

Q0 (índice único en `event_registrations`) sigue sin resolver: en `migrations/` no hay ninguno. El re-anotarse por
UPDATE funciona con o sin índice, así que la 0a no depende de Q0. El índice parcial opcional queda fuera.

## Backend

### B1 · Permisos de baja y movimiento — `app/routers/events.py`
Reemplazar `assert_can_move` (`events.py:20-51`) por:
- `can_cancel_registration(conn, reg, actor) -> str | None`: devuelve el motivo (que va al audit como `source`) o
  `None`. En orden: `self` (USER con `user_id == actor`), `guest_owner` (GUEST con `created_by_user_id == actor`),
  `admin` (`registrations.manage` o `*` vía `get_effective_permissions`, `app/utils/permissions.py:18`), `captain`
  (`require_captain_of_court`, `permissions.py:82`, sobre `reg.court_id`), `legacy_captain` (fila en `event_captains`).
  Las comparaciones son estrictas por `str(uuid)`: un jugador nunca puede bajar a otro.
- `can_move_registration(conn, reg, to_court_id, actor) -> str | None`: permiso, capitán de la cancha de origen o de
  destino, o `event_captains` legacy.
- `_forbidden(conn, event_id)` arma el 403 con el copy de §7.5: "Esto lo puede hacer quien organiza el partido. Si
  necesitás un cambio, escribile a {nombre de pila de `events.created_by_user_id`}" (sin nombre: "a quien organiza").
- `cancel_registration` (`:894`) y `move_registration` (`:734`) usan los helpers. El SELECT de la inscripción suma
  `registration_type, user_id, created_by_user_id`. El audit de baja pasa a `{"reason":"manual_cancel","source":<motivo>}`.
- Admin por **permiso** y no por código de rol, como ya hace el front (`App.jsx:687`). El rol `admin` tiene
  `registrations.manage` desde `migrations/012_permissions.sql:74-81`.

### B2 · Flags y `/config` — `app/settings.py`, `app/main.py:117`
- `AUTO_CLOSE_ON_FULL = _flag("AUTO_CLOSE_ON_FULL")` (default false).
- `GUEST_LIMIT_PER_USER` con un `_int()` que sigue el patrón de `AVATAR_MAX_MB`: default 5 y mínimo 1.
- `/config` suma `autoCloseOnFull` y `guestLimitPerUser`.
- `events.py` lee `settings.AUTO_CLOSE_ON_FULL` en tiempo de llamada (con `from app import settings`), así los tests pueden cambiarlo.

### B3 · Sin auto-cierre y `COURT_FULL` exacto
- `check_and_auto_close_court` (`events.py:54`): con el flag en false sale enseguida. Con el flag en true se mantiene el
  comportamiento legacy (sirve de rollback).
- `COURT_FULL` se audita una vez por transición, **dentro de la misma transacción del alta** y con la cancha bloqueada
  (`FOR UPDATE`). Se escribe cuando `occupied_antes + 1 == capacity`. Lo hace un helper nuevo,
  `audit_court_full_if_filled(conn, event_id, court_id, occupied_after, capacity, actor, source)`, que se llama desde
  `register_user`, `register_guest`, el alta de externos (`events_public.py:~305`) y la cancha destino de `move_registration`.
  Las promociones no lo disparan: liberar y promover pasan en la misma transacción, así que la cancha nunca llegó a
  quedar con lugar. Se audita también con el flag en true, porque es solo medición.
- `app/routers/admin_audit.py:25-68`: `COURT_FULL` va en la categoría CANCHA y en `SYSTEM_ACTIONS`.
- `src/audit/actionTemplates.jsx`: template "Se llenó la cancha X".

### B4 · Re-anotarse — `register_user` (`events.py:531`)
- Antes de insertar, `pg_advisory_xact_lock(hashtext(event_id || ':' || user_id))`. Así dos altas simultáneas del
  mismo jugador en canchas distintas no duplican la fila, aunque no haya índice único.
- Después, `SELECT … FOR UPDATE` de las filas USER de `(event_id, user_id)`:
  - Si hay una activa: **409** "Ya estás anotado en este partido (Cancha 1)." Si está en espera: "Ya estás en la
    lista de espera de este partido."
  - Si hay una CANCELLED: UPDATE de la más reciente con `status`, `court_id`, `cancelled_at=NULL`, `updated_at=now()`,
    `created_at=now()` y `created_by_user_id=actor`. Así vuelve al final de la espera. El audit `REGISTER_USER` lleva
    `{"source":"api","rejoin":true,"previous_created_at":…}`.
  - Si no hay ninguna: INSERT como hoy, y se mantiene el `except IntegrityError` → 409.

### B5 · Invitados — `register_guest` (`events.py:623`)
- El tope sale de `settings.GUEST_LIMIT_PER_USER` y no aplica a quien tiene `registrations.manage`.
- Copy: "Llegaste al máximo de 5 invitados para este partido."
- Quitar el invitado propio ya lo cubre B1 (`guest_owner`).

### B6 · Próximo partido y datos para la UI — `events.py`
- `/events/open` (`:184`) ordena `starts_at asc`, así los chips quedan en orden cronológico.
- `/events/active` sin `event_id` (`:233`) devuelve el **próximo**: el primero con `starts_at >= now() - 3 h`, en orden
  ascendente. Si no hay ninguno, el más reciente.
- `/events/active` suma `viewer: {captain_court_ids: [...], is_event_captain: bool}` para el actor. Lo leen de
  `event_court_captains` y `event_captains`, y le sirven al front para mostrar Baja/Mover a los capitanes.

### B7 · Abrir cancha o subir el cupo promueve la espera (extra) — `app/routers/admin_events.py`
- `fill_from_waitlist(conn, event_id, court_id, actor, source)` en `events.py` llama a `promote_first_waitlist`
  (`events.py:130`) en loop mientras haya lugar.
- Se llama en `open_court` (`admin_events.py:1070`, `source='auto_from_open_court'`) y en el PATCH de cancha (`:765`)
  cuando cambia `capacity` o `is_open=true` (`source='auto_from_court_update'`), dentro de la misma transacción.

### B8 · `scripts/reopen_auto_closed.sql` (lo corre el usuario a mano, es idempotente)
- **Sección 1, preview:** solo SELECT. Lista canchas y eventos futuros que se reabrirían y la espera que se promovería.
- **Sección 2:** `BEGIN; … COMMIT;` con un bloque `DO $$ … $$` (plpgsql):
  - **Canchas:** se reabren las que cumplen todo esto:
    - `is_open=false` y el evento tiene `starts_at > now()` y no está `FINALIZED`;
    - su última acción entre `AUTO_CLOSE_COURT`/`OPEN_COURT`/`CLOSE_COURT` (por `metadata->>'court_id'`) es `AUTO_CLOSE_COURT`;
    - no hay un `UPDATE_COURT` con `metadata ? 'is_open'` posterior en el evento. Esa metadata no trae `court_id`, así
      que se toma la opción conservadora.

    Se audita `OPEN_COURT {court_id, source:'data_fix'}` con actor NULL.
  - **Eventos:** se reabren los que tienen `status='CLOSED'`, `starts_at > now()` y cuya última acción entre
    `AUTO_CLOSE_EVENT`/`CLOSE_EVENT`/`REOPEN_EVENT` es `AUTO_CLOSE_EVENT`. Pasan a `OPEN` y se audita `REOPEN_EVENT
    {previous_status:'CLOSED', source:'data_fix'}`.
  - **Promoción:** en los eventos futuros `OPEN`, mientras haya espera (`created_at asc`) y una cancha abierta con lugar
    (`sort_order`, `created_at`), se promueve y se audita `PROMOTE_WAITLIST {source:'data_fix'}`.
  - Al final, un `RAISE NOTICE` con los conteos.
- Una segunda corrida no hace nada.

### Calendario — `app/routers/calendar.py`
Sin cambios. El CTA "Cancelar mi lugar" / "Bajarme de la espera" (`calendar.py:372-378`) llama al mismo `/cancel`,
que pasa a funcionar con B1. El badge "lleno" ya cuenta solo las canchas abiertas, y con B3 las llenas siguen abiertas.

## Frontend (`futbol-mvp-web/`)

| # | Cambio | Dónde |
|---|---|---|
| F1 | `.page-enter` pasa a `animation: page-enter .22s ease-out backwards` y anima solo la opacidad. Arregla de raíz el modal de AdminPanel, el FAB del Calendario, la campana y los toasts | `src/index.css:65-67` |
| F2 | En `@media (pointer: coarse)`: `input,select,textarea{font-size:max(16px,1em)}`, más `:is(input,select,textarea):is(.text-xs,.text-sm,[class*="text-[1"]){font-size:16px}`. Tiene que ganarle por especificidad a las utilidades de Tailwind 3 y no achica los campos grandes. En el escritorio no cambia nada | `src/index.css` |
| F3 | `viewport-fit=cover` en el meta, y `padding-left/right: env(safe-area-inset-*)` en el body (en landscape el contenido queda bajo el notch) | `index.html:8`, `src/index.css:55-59` |
| F4 | Acciones por fila según quién mira. `viewerId = currentUser.id` (no `actorUserId`, que es el token). `canManageCourt(c) = canManageReg \|\| viewer.captain_court_ids.includes(c) \|\| viewer.is_event_captain`. **"Mover…"** solo con `canManageCourt` (sube a `text-base` y gana ancho). **Baja:** "No puedo ir" en la fila propia, "Quitar" en el invitado propio, "Quitar" en otros solo con `canManageCourt`. Sin permiso no se muestra nada | `App.jsx` `CourtCard` (`:493-618`) y llamada (`:1542`) |
| F5 | Confirmaciones con un `ConfirmSheet` chico (usa `.bottom-sheet-*`, que con F1 queda en su lugar). **Baja propia:** "¿Liberás tu lugar?", con el cuerpo "Lo toma {1.º de la espera}, que está primero en la espera. Si después querés volver, entrás al final." o, sin espera, "Tu lugar queda libre para otro.", y los botones [Sí, liberar mi lugar] [Me quedo]. **Quitar a otro o a un invitado:** "¿Sacás a {nombre} del partido? Su lugar queda libre." con [Sí, sacar] [Cancelar]. `cancelReg` deja de llamarse directo | `src/design/ui/ConfirmSheet.jsx` (nuevo), `App.jsx:1119` |
| F6 | Slot libre con texto visible: el círculo muestra "+" y "Libre". Debajo de la grilla va un botón "Libre · Anotarme acá" si la cancha tiene lugar y el jugador no está anotado. Se conserva `court-register-*` | `App.jsx:435-443`, `SlotGrid` |
| F7 | **Lista de espera visible** en la Home: "Lista de espera (N)" con los nombres en orden. Si el jugador está: "Estás 2.º en la espera. Entrás solo si alguien se baja." + [Salir de la espera]. Si todas las canchas abiertas están llenas y no está anotado: "Partido completo (20/20)." + **Anotarme en espera** (POST `/register` a una cancha llena, que devuelve WAITLIST). Quien organiza ve "Quitar" en cada fila | `App.jsx` (lee `data.waitlist`) |
| F8 | La Home abre el **próximo** partido con `pickNextEvent(evts)`: el primero con `starts_at >= ahora − 3 h` en orden ascendente; si no hay, el más reciente. Se conservan las prioridades de `?event_id` y de la selección vigente | `App.jsx:936-940` |
| F9 | Invitados: el texto sale de `/config`. Para el jugador: "Podés sumar hasta 5 invitados. Te quedan 3." Para quien organiza: "Sin sobrecupo." El input de nombre y el select pasan a `text-base` | `App.jsx:1548-1606` |
| F10 | `<a href="/ratings/pending-ui">` pasa a `<Link to=…>` | `App.jsx:1437` |
| F11 | Autoselección del evento creado: `handleCreateEvent` usa el `event_id` de la respuesta y `loadEvents({ preferEventId })` lo selecciona y carga el detalle. Así se evita el closure viejo de `selectedEventId` | `AdminPanel.jsx:132-157`, `:191-213` |
| F12 | El "+" del Calendario va a `/admin?focus=eventos&create=1`. AdminPanel abre la tab Eventos y el formulario de alta si hay `events.create` | `calendar/AdminCreateMenu.jsx:38-42`, `AdminPanel.jsx:115-121` |
| F13 | **Cerrar sesión** al pie de Perfil (al que se llega tocando el avatar). Abre un `ConfirmSheet` "¿Cerrás sesión en este teléfono?" con [Cerrar sesión] [Cancelar]. Confirmar hace `clearSession()` (`src/authSession.js:9`) + `window.location.assign("/")` | `src/Profile.jsx` |
| F14 | Copy del confirm del Calendario: "¿Liberás tu lugar?" | `calendar/CalendarItemSheet.jsx:47` |
| F15 | Media estrella (extra): la mitad izquierda de la 1.ª estrella manda 1 y no 0,5 (`Math.max(1, star - 0.5)`) | `RatingsPending.jsx:79` |

Fuera de la 0a (va en 0b/1): portal `#overlay-root`, scroll lock, Esc/focus trap, `interactive-widget`, sacar el
"¿Estás seguro?" de anotarse (lo reemplaza el "Deshacer" de la iter 1), la Home sin la campana.

## Tests y verificación

1. **Antes de tocar nada:** guardar la línea de base de `npm run lint` y `npm run build`.
2. **Base local descartable** en el scratchpad, como en `docs/copa-proud-plan.md:236-240`:
   - `initdb` + `pg_ctl` en `127.0.0.1:55432`;
   - aplicar `migrations/001…019` (en una base nueva, `roles.id` va `smallint`, ver 012).
3. **`tests/test_registrations_0a.py`**, con el patrón autónomo de `tests/test_event_access.py` (`_run_all`):
   - **Parte sin DB:** `/config` expone `autoCloseOnFull=false` y `guestLimitPerUser=5`.
   - **Parte con DB:** exige `REGISTRATIONS_DB_TEST=1` y `DATABASE_URL` en localhost, como `e2e_competition_sim.py`.
     Crea sus propios usuarios, rol, evento y canchas, y los borra al terminar. Va por HTTP con `TestClient` y tokens
     de `issue_token`. Casos:
     - baja propia → 200 y audit `source=self`; bajar a otro jugador → 403 con el copy nuevo;
     - quitar el invitado propio → 200; el de otro → 403;
     - capitán de la cancha A: baja en A → 200, en B → 403, mover de A a B → 200;
     - `registrations.manage` → 200; `event_captains` legacy → 200;
     - **flag en false:** llenar la cancha la deja abierta y el evento OPEN, con un solo `COURT_FULL`; el siguiente alta
       queda en WAITLIST, y una baja **promueve** (`PROMOTE_WAITLIST auto_from_cancel`);
     - **flag en true:** comportamiento legacy (`AUTO_CLOSE_COURT` y evento CLOSED);
     - re-anotarse reusa la fila, actualiza `created_at` y lo manda al final de la espera; con la inscripción activa → 409;
     - tope de invitados: el 6.º → 400; quien organiza no tiene tope;
     - "Abrir cancha" y subir el cupo promueven;
     - `/events/open` en orden ascendente y `/events/active` devolviendo el próximo partido.
4. **`scripts/reopen_auto_closed.sql`** con `psql` contra la base local: armar un evento futuro auto-cerrado con espera,
   correrlo y verificar que se reabre y promueve; correrlo de nuevo y verificar que no cambia nada.
5. **Front:** `npm run build` y `npm run lint` sin errores nuevos respecto de la línea de base.
6. **Mobile** (navegador integrado, 375×812, backend local + base local, token de prueba generado en local):
   - `.page-enter` con `transform` computado `none` a los 300 ms;
   - modal de AdminPanel dentro del viewport con la página scrolleada;
   - FAB fijo y campana en su lugar;
   - acciones por fila según quién mira (jugador, capitán, admin);
   - baja con confirmación, espera visible y "Anotarme en espera";
   - Home en el próximo partido;
   - el evento creado queda seleccionado;
   - Cerrar sesión.

   Además se corre `e2e/accessibility-smoke.spec.ts` en `mobile-chrome` si levanta sin credenciales de prod.
7. **Cierre:**
   - commit local solo de los archivos propios: nada de `docs/ux/` ni `.claude/`, que son de otras sesiones;
   - copia de este plan en `docs/ux/iteracion-0a-plan.md`;
   - **sin push**.

## Lo que el usuario hace en Railway (va en el resumen final)

1. Push a `main` cuando lo apruebes. Railway auto-deploya.
   - Sin tocar variables, `AUTO_CLOSE_ON_FULL` queda en false: las canchas dejan de cerrarse solas desde el deploy.
   - `GUEST_LIMIT_PER_USER` es opcional (default 5).
   - Rollback inmediato: `AUTO_CLOSE_ON_FULL=true`.
2. **Después del deploy**, en la consola Postgres: correr la sección 1 de `scripts/reopen_auto_closed.sql` para
   revisar y la sección 2 para aplicar. Si se corre antes, el código viejo podría volver a cerrar canchas.
3. Una semana después, mirar las métricas de la 0a (§8.4): bajas con actor = target, `PROMOTE_WAITLIST` y `COURT_FULL`.
