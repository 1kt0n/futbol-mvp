# Plan — Iteración 1a (pantalla del partido `/p/:id`)

> **Estado (19/10/2026):** implementado y verificado en local, **sin pushear** (código en `609e836`), detrás de
> `MATCH_SCREEN_ENABLED` y `ONE_TAP_REGISTER_ENABLED` (apagados por default). Abajo, el plan aprobado tal cual; al
> final, los desvíos, la verificación, la revisión independiente y cómo prenderlo.

## Contexto

`docs/ux/rediseno-ux.md` §4, §5.3 (flujo b), §6.2, §7.1–7.4 y §7.7, §8.2 "Iteración 1" y §8.4 fila 1a; `estado.md`
"Lo que sigue" punto 2. En producción ya están la barra inferior (1b), la espera que promueve sola (0a) y las
primitivas de overlay (0b). Lo que falta, verificado en el código:

- **Anotarse cuesta 2-3 toques y es ambiguo:** hay que elegir un círculo y confirmar "¿Estás seguro?"
  (`App.jsx:1704`). `RegisterRequest.court_id` es obligatorio (`schemas.py:6`) y no hay asignación automática.
- **La cancha llena manda a la espera en silencio** (`events.py:690-692`), y la espera no se ve como un lugar propio.
- **"No puedo ir" no avisa al grupo.** H4: el 35% de las bajas son a menos de 24 h.
- **El link de WhatsApp no tiene dirección propia:** `/?event_id=` funciona de casualidad y, sin sesión, el login
  pierde la ruta (`AppShell.jsx:46,55`).
- **No hay medición por pantalla:** no existen `X-UI-Source` ni `write_audit()`, y todo `REGISTER_USER` dice
  `source='api'`.
- **Carrera que ya existe hoy:** una baja y un alta simultáneos pueden dejar un lugar libre con alguien esperando.
  - La baja bloquea solo la fila (`events.py:1019`); el alta cuenta sin ver esa baja y manda a la espera.
  - La promoción corre antes de que exista esa fila en espera.
  - Con "Me anoto" de un toque pasaría más seguido.
- **De la 0b quedaron:** `?sheet=` con el atrás de Android, deslizar para cerrar y el `Menu` popover de escritorio.

Meta: quien entra por WhatsApp se anota en **1 toque** (con Deshacer), ve su cancha o su puesto en la espera, se baja
en 2 y, a menos de 24 h, avisa al grupo. Todo va detrás de flags y se mide en `event_audit_log`.

## Decisiones

**Con el usuario (19/10):**

- **Link de Compartir:** `/p/:id` para todos. Los externos siguen con el `/e/<código>` que se comparte desde Gestión.
- **Invitados:** entran en la 1a. Hoja "Sumar invitado" (`?sheet=invitar`); la cancha la asigna el servidor.
- **Quien organiza y el capitán:**
  - tocar a un jugador › "Quitar del partido" › diálogo;
  - para mover entre canchas, `⋯` › "Vista clásica" (la Home de hoy);
  - chip "Compartir · Faltan N".

**Defaults míos:**

- Se trabaja en este checkout (`main`), con commits locales solo de mis archivos y **sin push**.
- **Flags**, los dos apagados por default; así producción no cambia al deployar:
  - `MATCH_SCREEN_ENABLED` = `off` | `admins` | `all`;
  - `ONE_TAP_REGISTER_ENABLED`.
- **Pseudo-canchas:** nombre con `espera|suplente|reserva|banco` (las de §9.4).
  - Las canchas-equipo ("equipo blanco") **no** son pseudo: tienen jugadores de verdad.
  - La promoción desde la espera no cambia: entra a la cancha que se liberó.
- **`metadata.ui` ∈ {`match`, `legacy`}**, y se corrige §8.1. "shell" ya no distingue nada: la barra está en todas
  las pantallas desde la 1b.
  - La pantalla nueva manda `match`; el `apiFetch` de la Home y el Panel (`App.jsx:112`) manda `legacy`. Los dos
    solo en escrituras, para no sumar preflights en local.
  - Sin header (otras pantallas o un bundle viejo de la PWA) no se escribe `ui`.
- **El 409 por cancha llena:**
  - con alternativa ofrece **[Sí, a la Cancha 1] [Cancelar]**;
  - sin alternativa, **[Anotarme en espera] [Cancelar]**.
  - Desvío del copy §7.4: la espera es de todo el partido, así que mandar a la espera habiendo lugar en otra cancha no
    tiene sentido.
- **`include_finished=1`** en vez de aceptar FINALIZED con cualquier `event_id` explícito (§8.2): así la Home vieja no
  cambia. Queda anotado como desvío.
- **Qué va en la URL:**
  - `compartir`, `invitar` y `baja` van en `?sheet=`.
  - El menú `⋯`, el menú de cada jugador y los diálogos de respuesta (cancha llena, quitar) no. Con ellos abiertos,
    el atrás sale de la pantalla; queda anotado.
- **"Vista clásica"** es por visita (`/?event_id=X&vista=clasica`): la pestaña Partido vuelve a la pantalla nueva.
- **`?next=` solo para `/p/:id`** (el link de WhatsApp). Así, después de cerrar sesión, quien entra no cae en la
  pantalla del anterior.

## 1. Backend

### 1.1 Un lock por evento para todo lo que cambia la ocupación

- `lock_event_occupancy(conn, event_id)` (`events.py`) hace `pg_advisory_xact_lock(hashtext('occupancy:' || event_id))`.
- Va como **primera** operación de:
  - `register_user` (reemplaza al lock por jugador) y `register_guest`;
  - `cancel_registration` y `move_registration`: primero leen el `event_id` sin bloquear, después toman el lock y
    re-leen la fila `FOR UPDATE`;
  - `register_external` y `cancel_participation` de `events_public.py`.
- Con eso, el alta y la baja de un mismo partido no se pisan, y no hacen falta locks cruzados de canchas: es lo que
  evita el deadlock con mover.
- Las rutas de admin que bloquean canchas (`create_court`, `update_court`, `open_court`) no cambian. Siguen
  compatibles porque nunca piden el lock del evento.

### 1.2 Alta con cancha opcional — `POST /events/{id}/register` (`events.py:618`, `schemas.py:6`)

`RegisterRequest`:
- `court_id: UUID | None`; `""` cuenta como `None`, porque hoy da 500 en el cast;
- `if_full: Literal["waitlist","conflict"] = "waitlist"`.

| Pedido | Qué pasa | `source` |
|---|---|---|
| Sin `court_id`, con `ONE_TAP_REGISTER_ENABLED` | Ver el detalle abajo | `one_tap` |
| Sin `court_id`, con el flag apagado | 400 "Elegí una cancha." | — |
| `court_id` + `conflict`, cancha llena | 409 con `detail = {code:"COURT_FULL", message:"Justo se llenó la Cancha 2.", court_id, court_name, alternatives:[{court_id, name, available, is_pseudo}]}`: las abiertas con lugar, primero las no pseudo | — |
| `court_id` + `conflict`, con lugar | Igual que hoy | `slot_pick` |
| `court_id` sin `if_full` (Home de hoy y bundles viejos) | **Igual que hoy:** cancha llena → WAITLIST. Lo usan `registerSelf` y `joinWaitlist` (`App.jsx:1116,1138`) | `api` |

**Sin `court_id`:**
- Canchas en orden `(sort_order, created_at, id)` y conteo de CONFIRMED, en dos consultas (Postgres no acepta
  `FOR UPDATE` con `GROUP BY`).
- Entra en la primera **abierta, no pseudo y con lugar**, que se bloquea `FOR UPDATE`. Si no hay, va a WAITLIST con
  `court_id NULL`.
- Casos borde:

| Situación | Resultado |
|---|---|
| El evento no tiene canchas | 400 "El partido todavía no tiene canchas." |
| Todas las canchas reales están cerradas | 400 "La inscripción está cerrada." |
| El evento solo tiene pseudo-canchas | Cuentan como canchas normales |

**Resto:**
- La respuesta suma `court_name` y `assigned: "auto" | "chosen"`. Ya traía `waitlist_position`.
- El audit `REGISTER_USER` suma `court_id` y `assigned` (sirve para H10).
- Se mantienen:
  - el re-anotarse por UPDATE (0a);
  - `COURT_FULL` una vez por transición;
  - `check_and_auto_close_court` con la cancha que quedó.
- `app/utils/courts.py` (nuevo) trae dos funciones puras con sus tests:
  - `is_pseudo_court(name)`;
  - `pick_first_free(courts, occupied)`.

### 1.3 Invitados — `POST /events/{id}/guests` (`events.py:773`)

- `GuestRequest.court_id` opcional, detrás del mismo flag.
- **Sin cancha:**
  - entra en la cancha de quien invita, si tiene lugar;
  - si no, en la primera libre con la misma regla;
  - los invitados siguen sin espera: con el partido lleno, 409 "El partido está completo: no quedan lugares para
    invitados.".
- **Con cancha elegida y llena:** el 409 de hoy.
- `source`: `one_tap` sin cancha y `api` con cancha.

### 1.4 Baja — `POST /registrations/{id}/cancel` (`events.py:1007`)

- Body opcional, `CancelRequest | None = None`: hoy se llama sin body (`App.jsx:1176`, `CalendarItemSheet`).
- Trae `{intent: "undo" | "notify_group"}`, que va a `metadata.intent`:
  - "Deshacer" manda `undo`;
  - "Liberar y avisar al grupo" manda `notify_group`.
- `reason` sigue en `manual_cancel`, así no se rompen las consultas existentes.
- La respuesta ya trae `promoted_registration_id`: con eso se arma el mensaje de WhatsApp.

### 1.5 `GET /events/active` (`events.py:291`)

- `event_id` pasa a `UUID | None`: un id inválido da 422 en vez de 500.
- `include_finished=1`: con `event_id`, devuelve el evento en cualquier estado.
- Cada cancha suma `is_pseudo`.
- `viewer` suma:
  - `user_id`;
  - `registration` (la fila USER no cancelada del actor): `registration_id`, `status`, `court_id`,
    `waitlist_position` y `promoted_at`. `promoted_at` es el último `PROMOTE_WAITLIST` de esa fila posterior a su
    `created_at`, para el banner "¡Se liberó un lugar y entraste!".

### 1.6 `X-UI-Source` + `write_audit()`

- **`app/utils/audit.py`** (nuevo):
  - un `ContextVar` que llena un middleware `@app.middleware("http")` con `X-UI-Source` (solo `match` o `legacy`);
  - `write_audit(conn, *, event_id, actor_user_id, action, target_registration_id=None, metadata=None)`, que usa
    `json.dumps(..., default=str)` y suma `ui` si hay.
- **Dónde se usa:**
  - `register_user`, `register_guest` y `cancel_registration`;
  - `promote_first_waitlist` y `audit_court_full_if_filled`.
- **CORS** (`main.py:68`): `allow_headers` suma `X-UI-Source`.

### 1.7 Flags (`app/settings.py`; `/config` en `main.py:121`)

- `MATCH_SCREEN_ENABLED` vale `off` | `admins` | `all`; cualquier otro valor cuenta como `off`. También acepta
  `true` → `all` y `false` → `off`. Va a `/config` como `matchScreen`.
- `ONE_TAP_REGISTER_ENABLED` va a `/config` como `oneTapRegisterEnabled`.
- `/config` lee `settings.X` al momento, así los tests pueden cambiarlos. Hoy `main.py:13-24` los importa por nombre.
- Sin migración.

## 2. Frontend — ruteo y shell

- **`src/features/match/useMatchScreen.js`** (nuevo): un solo hook para la Home y la pantalla, así no rebotan entre
  sí.
  - Pide `/config` y `/me` con un caché de módulo, por actor, que se limpia con `ACTOR_CHANGED_EVENT`.
  - Devuelve `{ready, enabled}`. Con `admins`, `enabled` = `canAccessAdmin`.
- **`main.jsx`:**

| Ruta | Qué hace |
|---|---|
| `/` (`HomeRoute`) | Sin sesión: `<App/>`, que es el login. Con sesión y `?next=/p/…`: navega ahí. Mientras decide, muestra un esqueleto (no monta `<App/>`). Con la pantalla nueva y sin `vista=clasica`: `?event_id=X` → `/p/X`; si no hay id, `MatchHome` busca el próximo partido (`pickNextEvent`, que sale de `App.jsx:90` a un módulo compartido) y navega con replace, o muestra el estado vacío (§7.9; quien organiza ve "Armalo desde Gestión" con el botón). Si no, `<App/>` como hoy |
| `/p/:id` | `MatchPage`. Con el flag apagado para este usuario → `/?event_id=:id` (el link sigue andando si se apaga). Con un id inválido: "No encontramos ese partido." |

- **`AppShell`:** sin sesión en `/p/…`, va a `/?next=<ruta>`. Pasa el `actor` por el contexto del `<Outlet>`.
- **`BottomNav`:** "Partido" también queda activa en `/p/*`.
- **Links:** el de "solo socios" de Repetir (`AdminPanel.jsx:2407`) pasa a `/p/:id`. El Calendario sigue con
  `/?event_id=`, que ya redirige.

## 3. Frontend — pantalla del partido (`src/features/match/`)

| Archivo | Qué hace |
|---|---|
| `MatchPage.jsx` | Datos y acciones. Pide `/events/active?event_id=…&include_finished=1` y `/events/open`, para los chips de fecha. Vuelve a pedir después de cada acción y en `visibilitychange`. Pull-to-refresh con `usePullToRefresh`, que sale de `App.jsx:665` a `src/design/usePullToRefresh.js` |
| `MatchTopBar.jsx` | Sticky (`z-sticky`). Título "Mar 20/10 · 20 hs", chips de fecha si hay más de un partido próximo, y `⋯` con el `Menu` nuevo: Compartir · Sumar invitado · Ver en el calendario. Quien organiza suma Vista clásica y Abrir en Gestión |
| `MatchHero.jsx` | Chip de estado (Abierto / Completo / Inscripción cerrada / Jugado), título, lugar y fecha, "14/20 · Quedan 6 lugares" con barra (sin pseudo-canchas). Quien organiza ve el chip "Compartir · Faltan N". Banner de promoción descartable, guardado por `registration_id + promoted_at` en localStorage |
| `CourtCard.jsx` | Nombre, `n/cap` y "Tu cancha". Jugadores en 2 columnas: "Vos", "Juan R.", invitados con "invitado de Nico". Los lugares libres dicen "Libre · Anotarme acá" (un botón por cancha y "+N libres", así una cancha de 25 no ocupa la pantalla) o "Libre" |
| `WaitlistSection.jsx` | "En espera (N)" con la posición, y yo resaltado |
| `MatchActionBar.jsx` | Ver los estados abajo |
| `ShareSheet.jsx` | `?sheet=compartir`, `auto`. Link `/p/:id` con "Copiar link", vista previa del mensaje y footer **Enviar por WhatsApp** (`<a>` a `wa.me`) |
| `GuestSheet.jsx` | `?sheet=invitar`, `guarded` (con nombre escrito). Input de 16px + **Sumar**, "Te quedan 3 de 5" (quien organiza: sin tope), "Mis invitados" con Quitar (diálogo). Al sumar: toast con Deshacer, la hoja queda abierta y el input vacío. Con el partido lleno, el aviso "El partido está completo: no quedan lugares para invitados." |
| `LeaveDialog.jsx` | `?sheet=baja`. Ver abajo |
| `CourtFullDialog.jsx` | Respuesta al 409 `COURT_FULL` |
| `RemoveDialog.jsx` | Quitar a otro, desde el `Menu` del jugador: managers, capitanes de esa cancha y dueños del invitado. "¿Sacás a Juan del partido?" / "Su lugar queda libre." o "Lo toma Pedro…" · **Sí, sacar** / Cancelar |
| `matchLogic.js` | Funciones puras: conteos, estado propio, quién toma el lugar, menos de 24 h, primera libre del lado del cliente (con ONE_TAP apagado), nombres |
| `messages.js` | Mensajes de WhatsApp de §7.7, sin emojis (no se reusa `shareMessage.js`, que los tiene) |
| `format.js` | Días en castellano fijos ("Mié", "miércoles"), "21 hs" / "21:00", "2.º" |
| `api.js` | Sobre `calendar/api.js`, al que se le agregan la opción `headers` y `Error.status` / `Error.detail`. Manda `X-UI-Source: match` en las escrituras |

**Barra de acción** (`src/shell/ActionBar.jsx`, nueva):
- Va fija arriba de la barra inferior (`z-sticky`).
- Mide su alto con un `ResizeObserver` y lo publica en `--actionbar-h` (con `removeProperty` al desmontar).
- `tokens.css`: `--toast-bottom` suma `var(--actionbar-h, 0px)`, así el toast de Deshacer no tapa la barra.
- `MatchPage` agrega ese padding abajo.

| Estado | Barra |
|---|---|
| Abierto, no estoy, quedan lugares | **Me anoto** · "Quedan 6 lugares" |
| Abierto, no estoy, lleno | "Partido completo (20/20)." · **Anotarme en espera** |
| Confirmado (abierto o cerrado) | "Estás en la Cancha 1" · [+ Invitado] [No puedo ir] (sin invitado si está cerrado) |
| En espera | "Sos el 2.º en la lista de espera. Si se libera un lugar, entrás solo y te avisamos." · [Salir de la espera] (un toque + toast) |
| Cerrado, no estoy | "Inscripción cerrada" |
| Jugado | Si jugué y tengo votos pendientes: **Votar a tus compañeros** → `/ratings/pending-ui` |

**Flujos:**

- **Me anoto:**
  - Con ONE_TAP: `POST register {}`.
  - Sin ONE_TAP: la primera libre del cliente, con `if_full: "conflict"` y un reintento solo con la primera
    alternativa real. Si no hay, `waitlist`.
  - Toast "¡Adentro! Estás en la Cancha 1." o "Te anotamos en espera (puesto 2)." con **Deshacer** (5 s) →
    `cancel {intent:"undo"}` → "Listo: no quedaste anotado.".
  - 409 "ya anotado": toast con el texto del servidor y recarga.
  - Sin red: el copy de §7.10.
- **Libre · Anotarme acá:** `{court_id, if_full:"conflict"}`. Si responde 409, `CourtFullDialog`:
  - con alternativa: "Justo se llenó la Cancha 2. ¿Te sumamos a la Cancha 1, que tiene 2 lugares?";
  - sin alternativa: "Justo se llenó la Cancha 2 y el partido quedó completo." · **Anotarme en espera**.
- **No puedo ir** → `LeaveDialog` "¿Liberás tu lugar?":
  - el cuerpo dice "Lo toma Juan, que está primero en la espera." (la primera de la espera, si la cancha liberada
    está abierta) o "Tu lugar queda libre para otro.", y siempre "Si después querés volver, entrás al final.";
  - el foco va a "Me quedo";
  - **más de 24 h:** **Sí, liberar mi lugar** / Me quedo → toast "Liberaste tu lugar. Lo toma Juan.".
  - **Menos de 24 h:**
    - arriba va "Falta poco para el partido. Avisale al grupo así no quedan cortos." y el botón es **Liberar y
      avisar al grupo**;
    - `cancel {intent:"notify_group"}` → arma "Me bajo del *Martes 20 hs*. Entra Juan desde la espera: {link}" o
      "…Se liberó un lugar: {link}", con `promoted_registration_id` → nombre;
    - `window.open(wa.me…)`. Si el navegador lo bloquea (iOS después de un `await`), el diálogo queda abierto en un
      paso "Listo, liberaste tu lugar" con **Abrir WhatsApp** (un toque real).
- **Compartir:**

```
*Martes 20 hs* · Club Norte
Mar 20/10 · 20:00
Cancha 1: quedan 3 · Cancha 2: completa
Anotate desde la app: {origin}/p/{id}
```

  - Sin pseudo-canchas.
  - Si está lleno, "Partido completo, anotate en la espera: {link}".

## 4. Primitivas de overlay (`src/design/ui/overlay/`)

### 4.1 `useSheetParam()` — `?sheet=` y el atrás de Android

- **El controlador:**
  - Uno por pantalla: `{current, open(name), close(), historyFor(name)}`.
  - `current` es estado propio. Arranca desde la URL (deep link) y se reconcilia en un `useLayoutEffect` atado a
    `location.key`, porque react-router 7 aplica las navegaciones dentro de `startTransition` y otro chequeo daría
    falsos "se fue el param".
- **`open(name)`:** `current = name` y un push con `state.sheetPushed = name`.
- **`close()`:** `current = null` en el momento, y después, en un microtask:
  - `navigate(-1)`, si la entrada es nuestra y `history.state.idx > 0`;
  - si no (deep link), un replace sin el param.
  - Un `open()` en el mismo tick cancela el `-1` y hace replace.
- **Atrás del usuario:** si la URL pierde el param con `current` puesto, se le pregunta al overlay abierto. Lo
  registra `<Sheet history={…}>` / `<Dialog history={…}>`:

| Situación | Qué hace |
|---|---|
| Hay otra capa arriba (por ejemplo, el diálogo "¿Sacás a Fede?" sobre Invitar) | Cierra esa capa (`escapeTop()` nuevo en `stack.js`) y bloquea |
| Busy o `locked` | Bloquea |
| La pregunta "¿Descartás los cambios?" está a la vista | La oculta (seguir editando, como Esc) y bloquea |
| `guarded` con cambios | Muestra la pregunta y bloquea |
| Ninguna de las anteriores | Cierra |

- **"Bloquea"** = vuelve a hacer push de `?sheet=<name>`: la hoja nunca se desmonta y no se pierde lo escrito.
- "Descartar" llama a `close()`. Como pone `current = null` antes del `-1`, ese atrás no pasa por el guard.

### 4.2 Deslizar para cerrar

- **Hook `useSwipeToDismiss`:** en el header y el grabber de `Sheet`, y en el grabber de `Dialog` y `ActionSheet`.
  Solo abajo de 640px (cuando son hojas de abajo).
- **Gesto:**
  - Usa pointer events con `setPointerCapture`; los handlers van en el mismo header, porque `Layer` corta la
    propagación.
  - No arranca sobre botones, y descarta el clic que sigue a un arrastre de más de 5 px.
  - `touch-action: none` en la zona.
- **Cierre:** si el arrastre pasa el 30% del alto o va a más de 0,6 px/ms, `requestClose("swipe")`. Ahora devuelve
  `closed` / `confirm` / `blocked`:
  - `closed`: animación de salida (transición de 160 ms, con timeout por si no llega el `transitionend`; sin animación
    con `prefers-reduced-motion`) y después `onClose`;
  - `confirm` o `blocked` (con cambios u ocupada): vuelve a su lugar y muestra la pregunta.

### 4.3 `Menu`

- `<Menu open onClose anchorRef title items placement="bottom-end">`, controlado.
- **Debajo de 768px:** `ActionSheet`.
- **Desde 768px:** `Layer kind="popover"` (nuevo):
  - sin bloqueo de scroll y con fondo transparente;
  - panel `fixed` calculado con `getBoundingClientRect` (flip/shift a 8 px del borde, `max-height: 60dvh`), sin
    heredar `.ov-panel`;
  - `role="menu"` con flechas (la lista se comparte con `ActionSheet`);
  - cierra con pointerdown afuera, Esc, al elegir, con resize y con scroll.
- `pushLayer` acepta `lockScroll: false`.

## 5. Tests

- **`tests/test_match_1a.py`** (nuevo, patrón de `test_registrations_0a.py`, con `UX_1A_DB_TEST=1` y base local).
  - **Sin DB:**
    - `is_pseudo_court` y `pick_first_free`;
    - el parseo de `MATCH_SCREEN_ENABLED`;
    - `/config` con los dos flags;
    - el CORS con `X-UI-Source` (preflight);
    - el schema (`court_id` vacío → `None`).
  - **Con DB:**
    1. One-tap asigna por `(sort_order, created_at, id)`, con `sort_order` empatados y al revés.
    2. Saltea las canchas llenas, cerradas y pseudo; un evento solo con pseudo-canchas usa la pseudo.
    3. Todo lleno → WAITLIST con su puesto. Sin canchas → 400. Todas las reales cerradas → 400.
    4. Flag apagado → 400.
    5. `conflict` con la cancha llena → 409 `COURT_FULL` con alternativas (las no pseudo primero). Sin `if_full` →
       WAITLIST, como hoy.
    6. Audit: `source` `one_tap` / `slot_pick` / `api`, `assigned` y `court_id`; `ui='match'` con el header, `legacy`
       y sin `ui`.
    7. Baja con `intent` undo y `notify_group`, y la promoción sigue andando. Re-anotarse después de Deshacer va al
       final.
    8. `/events/active`: `is_pseudo`, `viewer.registration` (confirmado, en espera con puesto, y `promoted_at` después
       de una promoción); `include_finished` devuelve FINALIZED y sin él no.
    9. Invitado sin cancha: va con quien invita, si no a la primera libre; lleno → 409.
    10. **Carreras con hilos:** dos one-tap por el último lugar (uno entra y otro va a la espera, sin sobrecupo); una
        baja y un one-tap a la vez (nunca queda un lugar libre con alguien esperando). Se corre 10 veces seguidas.
- **Regresión con DB:** 0a, 0c, 0d, audit, event_access, external y account_approval.
- **Vitest:** `matchLogic`, `messages`, `format`, la posición del `Menu` (función pura) y el reducer de
  `useSheetParam`.
- **Playwright**, Pixel 7 + iPhone 14 WebKit; se suma `match` al `testMatch` del iPhone en `playwright.config.ts:41`:
  - **`e2e/match.spec.ts`** (nuevo), contra la API local con los dos flags prendidos:
    - hero y "Libre · Anotarme acá" a 375 px;
    - Me anoto → toast → Deshacer;
    - Me anoto → No puedo ir → "Lo toma …" (con un invitado en espera);
    - a menos de 24 h, "Liberar y avisar al grupo" abre `wa.me` con "Me bajo del";
    - `?sheet=invitar` con un nombre escrito + `page.goBack()`: aparece la pregunta, la hoja sigue abierta y la URL
      sigue con `?sheet` → Descartar cierra;
    - el atrás cierra Compartir;
    - deslizar el header cierra la hoja;
    - el `Menu` como popover a 1024 px, dentro del viewport, y Esc lo cierra;
    - login con `/p/:id` → vuelve a `/p/:id`.
  - **`e2e/overlays.spec.ts`:** Compartir, Invitar y "¿Liberás tu lugar?" se suman a la tabla de casos (boundingBox
    del CTA + axe). Los casos de la Home vieja (`:381` y `:393`) pasan a `&vista=clasica`.
  - **`scripts/e2e_seed_admin.py`:** suma un jugador de prueba sin permisos ("Jugador E2E"), con la misma guarda de
    base local.
- **No toco** los archivos de la rama sin mergear `claude/amazing-booth-b5c4ac`: `events-flow`, `tournaments-flow`,
  `helpers/dates.ts`, `Tabs`, `Stepper` y Torneos.

## 6. Verificación

1. `python tests/test_match_1a.py` con `UX_1A_DB_TEST=1` contra `futbol_test`, más la regresión.
2. `npm run lint` (guarda de overlays OK y ningún error nuevo sobre los 8 de antes), `npm run build` y `npx vitest run`.
3. `.claude/launch.json` (sin commitear) suma `canchas-api-1a` (:8779, flags prendidos, `futbol_test`) y
   `canchas-web-1a` (:5187).
4. `npm run e2e:overlays` y el spec nuevo, en Pixel 7 y en iPhone 14.
5. **Navegador a 375×812** con el admin y el jugador de prueba:
   - Me anoto, Deshacer, la espera con su puesto y la promoción con el banner;
   - el 409 con dos pestañas, "No puedo ir" en sus dos variantes, Compartir e Invitar;
   - el atrás con una hoja con cambios y deslizar;
   - Quitar como organizador y Vista clásica;
   - con los flags apagados, todo igual que hoy (`/p/:id` → `/?event_id=`);
   - inputs de 16px y consola sin errores.
6. **Revisión independiente del diff** antes de commitear, arreglar lo confirmado y volver a correr todo.
7. **Commits locales** (solo mis archivos, sin push): `feat(ux-1a)` + `docs(ux)` con
   `docs/ux/iteracion-1a-plan.md` (este plan + desvíos + verificación), `estado.md`, la nota en
   `rediseno-ux.md` §8.1 y §8.4, y una sección `PARTIDO (1a)` en `consultas-comportamiento.sql`:
   - % de `REGISTER_USER` por `source` y `ui`;
   - Deshacer en menos de 2 min (`intent='undo'`);
   - bajas propias con `notify_group`;
   - promociones.
8. Nota de entrega en la carpeta compartida.

## Fuera de alcance

- Repetir desde `/p/:id`, anotar a un socio, votar en lote y avisos dirigidos (iteración 2).
- Mover entre canchas o armar equipos (3a/3b; mientras tanto, Vista clásica).
- Fichas de jugador con puntaje en la pantalla nueva (siguen en la Vista clásica).
- Borrar la Home vieja (después de dos semanas estables con `MATCH_SCREEN_ENABLED=all`).
- Prender los flags en Railway: lo decide el usuario después del deploy (primero `admins` + ONE_TAP, después `all`).

---

## Desvíos respecto del plan

- **Componentes:** en vez de un archivo por pieza, quedaron en pocos archivos de `src/features/match/`:
  - `MatchParts.jsx`: barra superior, hero, cancha, espera y banner;
  - `MatchOverlays.jsx`: Compartir, Invitar, la baja, cancha llena y quitar;
  - `MatchStates.jsx`: esqueleto y vacíos;
  - `routes.jsx` (`HomeRoute`, `MatchRoute`);
  - `nextPath.js` (`safeNext`).
- **Primitivas:** las hizo una sesión aparte en paralelo (`?sheet=`, deslizar y `Menu`), con la API del §4.
  - `MenuItems.jsx` es la lista compartida por `ActionSheet` y el popover.
  - El popover sí deja `#root` inerte y atrapa el Tab, pero no bloquea el scroll.
  - Detalle en la nota de entrega de esa sesión.
- **Lock por partido:** después de la revisión, también lo toman las rutas de canchas del admin (crear, editar, abrir, cerrar y borrar), además de las del plan. La clave se normaliza, así un id en mayúsculas toma el mismo lock.
- **La baja devuelve `promoted`** `{registration_id, type, name, created_by_name}`. "Lo toma Juan" y el mensaje de WhatsApp lo usan aunque la pantalla no tuviera cargada a esa persona.
- **`promoted_at`** se calcula solo para confirmados y acotado al partido (`event_id`), para no recorrer el audit en cada lectura.
- **Fases nuevas:** "Armándose" (todavía no hay canchas) e "Inscripción cerrada" cuando todas las canchas están cerradas aunque el partido siga abierto. Antes se veía "Completo · Anotarme en espera" y el botón daba error.
- **Arranque con el flag apagado:** el último modo de `/config` queda en localStorage (`matchScreen:lastMode`). Con `off`, la Home monta `<App/>` enseguida y no espera `/config` + `/me`.
- **Copy:**
  - el 409 con un nombre de cancha largo dice "Sí, a esa cancha" (más de 20 caracteres);
  - la nota de invitados dice "Va a tu cancha o a la primera con lugar", que es la regla real;
  - Deshacer un invitado dice "Listo: sacamos a Gabi.".
- **`test_registrations_0a.py`:** se ajustó una aserción, porque `viewer` ahora trae `user_id` y `registration`.
- **`scripts/e2e_seed_admin.py`:** suma el "Jugador E2E" (sin roles). Los valores de prueba están en el docstring.

## Verificación (19/10, local contra `futbol_test`)

- **`tests/test_match_1a.py`: 20/20**, de los cuales 12 corren con DB, y 5 corridas seguidas en verde.
  - Sin el lock del partido, la carrera baja + "Me anoto" falla en 5 de 5 corridas.
  - Sin el lock en las rutas del admin, el test de "editar cancha espera el lock" falla.
- **Regresión con DB:**
  - 0c 10/10, 0d 15/15, audit 4/4, event_access 8/8, external 6/6, account_approval 5/5.
  - 0a: 8/9. Falla `db_test_home_opens_next_match` porque en `futbol_test` hay un partido abierto de otra sesión ("Miércoles 21 hs", creado el 17/10, empieza el 19/10 a las 17:02) que gana la elección del "próximo". Lo anterior a esa elección no cambió en la 1a. Vuelve a pasar cuando ese partido queda atrás.
- **Front:**
  - `npx vitest run`: 51/51 (incluye `match.test.js`).
  - `npm run lint`: check-overlays OK y los mismos 8 errores de antes, ninguno en archivos de la 1a.
  - `npm run build` OK.
- **Playwright** (API `:8779` con `MATCH_SCREEN_ENABLED=all` y `ONE_TAP_REGISTER_ENABLED=true`):
  - `npm run e2e:match`: 16/16 (Pixel 7 + iPhone 14 WebKit).
  - `npm run e2e:overlays`: 20/20, incluido el caso nuevo de la pantalla del partido.
  - Con los flags apagados: overlays 9/9 en Pixel 7 (el caso nuevo se saltea) y `/p/:id` → `/?event_id=`.
- **Navegador a 375×812**, con el jugador y el admin de prueba:
  - Login con `/p/:id` → vuelve al partido.
  - "Me anoto" asigna la Cancha 2 (la 1 llena, "Suplentes" excluida). El toast con Deshacer queda arriba de la barra de acción.
  - "No puedo ir" sin espera y con espera: "Lo toma Gonza" y la promoción.
  - "Anotarme en espera" con su puesto, y el banner "¡Se liberó un lugar y entraste!".
  - A menos de 24 h: el mensaje "Me bajo del *…*. Se liberó un lugar: …/p/…". Con la ventana frenada aparece el paso "Abrir WhatsApp".
  - Invitar:
    - atrás con un nombre → "¿Descartás los cambios?" y la hoja sigue;
    - el invitado va a la cancha de quien invita;
    - "Quitar" con el diálogo encima de la hoja; el atrás cierra solo el diálogo.
  - Compartir desde el `⋯`, sin "Suplentes" en el mensaje.
  - El `Menu` como popover a 1024 px; Esc devuelve el foco.
  - Admin: "Compartir · Faltan N", quitar a un jugador y la "Vista clásica".
  - Consola sin errores. Los datos de demo se borraron.
- **Consultas `PARTIDO (a)` y `(b)`:** corridas en solo lectura en local.

## Revisión independiente (antes de commitear)

10 hallazgos, todos confirmados y arreglados salvo el 6b y el 10b, que quedan anotados:

| # | Hallazgo | Arreglo |
|---|---|---|
| 1 | Un "Me anoto" a la espera no esperaba a que el organizador subiera el cupo o abriera una cancha: quedaba en espera con un lugar libre. Además, faltaba revalidar la cancha después del lock | Lock del partido en las rutas de canchas del admin; cancha cerrada o borrada después del lock → espera (alta) o 409 (invitado) |
| 2 | Deshacer un invitado decía "no quedaste anotado" | Texto propio: "Listo: sacamos a Gabi." |
| 3 | Sin canchas o con todas cerradas se veía "Completo · Anotarme en espera" | Fases "Armándose" e "Inscripción cerrada" |
| 4 | Los e2e dejaban partidos abiertos a 2 h que rompían el test de la 0a | `afterAll` los finaliza; los que quedaron de antes se finalizaron |
| 5 | `promoted_at` recorría todo el audit | Solo para confirmados y con `event_id`. Queda sugerido el índice de la 021 |
| 6 | Con ONE_TAP apagado, la reserva para la espera podía caer en "Suplentes" | Usa las canchas que cuentan. **6b, queda:** con ONE_TAP apagado, "Me anoto" se registra como `slot_pick` (solo en modo rollback) |
| 7 | El mensaje a menos de 24 h podía decir "Se liberó un lugar" aunque ya lo había tomado alguien | La baja devuelve `promoted` |
| 8 | Clave del lock sin normalizar | `UUID(...)` en `lock_event_occupancy` |
| 9 | La hoja de invitados no se bloqueaba mientras sumaba; el copy no decía la regla real | `busy` + copy |
| 10 | Con el flag apagado, "/" esperaba `/config` + `/me` y `<App/>` se montaba dos veces al loguearse | Modo recordado en localStorage. **10b, queda:** la primera visita sin sesión de un dispositivo sigue esperando una vez |

Menores arreglados:
- el paso "Listo" no vuelve con el adelante;
- `aria-expanded` en el `⋯`;
- el test de re-anotarse verifica que entra al final;
- el e2e verifica el puesto en la espera.

## Cómo prenderlo (Railway, servicio futbol-mvp)

1. **Deploy:** push a `main`. Sin variables nuevas, todo queda apagado y la app se ve igual que hoy. Sin migración.
2. **Verificar:** `/config` tiene que devolver `matchScreen:"off"` y `oneTapRegisterEnabled:false`, y `/p/<id>` tiene que llevar a `/?event_id=<id>`.
3. **Admins primero:** `MATCH_SCREEN_ENABLED=admins` + `ONE_TAP_REGISTER_ENABLED=true`, y después **Deploy** en el banner "Apply 2 changes".
   - Probar en un teléfono: "Me anoto" con Deshacer, "No puedo ir", Compartir, el atrás de Android con una hoja y deslizar para cerrar.
4. **Para todos:** `MATCH_SCREEN_ENABLED=all`.
5. **Rollback:**
   - `MATCH_SCREEN_ENABLED=off` vuelve a la Home de siempre, y los links `/p/:id` siguen andando porque redirigen.
   - `ONE_TAP_REGISTER_ENABLED=false` hace que la pantalla elija la cancha del lado del cliente.
6. **Medir:** consulta `PARTIDO` de `consultas-comportamiento.sql`, una semana después de prenderlo. Metas: `one_tap` ≥ 60% de las altas y Deshacer en menos de 2 min < 3%.

## Pendientes

- **Fichas de jugador con puntaje en la pantalla nueva:** hoy están en la Vista clásica.
- **El atrás con el `⋯` o un diálogo de respuesta abierto** sale de la pantalla: no van en la URL.
- **Probar en un iPhone y un Android reales:**
  - el gesto de deslizar con el dedo (en Playwright se probó con mouse);
  - `window.open` a WhatsApp después de la baja;
  - el atrás del sistema.
- **Índice `event_audit_log(event_id, created_at)` de la 021:** confirmar si corrió en producción.
