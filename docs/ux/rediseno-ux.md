# Rediseño UX — Tercer Tiempo FC (Canchas)

> Estado: **propuesta de diseño, sin implementar**. Cada iteración va a tener su propio plan antes de tocar código o la DB de producción.
> Alcance: la PWA de canchas (`futbol-mvp-web/`) y su backend (`app/`). **Fuera de alcance:** Copa Proud y `competitions`; Torneos solo se mueve a Gestión y migra sus modales a la primitiva nueva.
> Basado en: relevamiento del código, verificación adversarial de 18 afirmaciones y un panel de diseño (3 propuestas, 2 jueces, 1 síntesis). La evidencia `file:line` está revisada contra `main` @ `cb52be8` (2026-10-17).
> Consultas para validar hipótesis: `docs/ux/consultas-comportamiento.sql` (se entrega aparte; acá no se copia el SQL).

---

## 1. Contexto y método

### 1.1 El pedido

El organizador (que también juega) siente que **"hay que tocar muchos botones para armar partidos"** y que **los menús se siguen viendo mal en el celular**: desplegables tapados, hojas y modales con scroll raro, y "no sé dónde está cada cosa". Pidió un análisis de comportamiento, soluciones de usabilidad y prototipos inspirados en otras apps (Playtomic, Spond/TeamSnap, sorteadores de equipos tipo Fulbito).

Decisiones ya tomadas:

- Priorizamos al organizador y al jugador por igual.
- Los datos de producción los corre el organizador: le pasamos SQL de solo lectura y nos pega los resultados.

### 1.2 Cómo llegamos acá

| Etapa | Qué se hizo | Resultado |
|---|---|---|
| Relevamiento | 3 exploraciones del código: navegación y menús, flujo del partido, datos disponibles | 18 afirmaciones sobre problemas concretos (C1-C18) |
| Verificación adversarial | 5 auditores con la consigna de **refutar** cada afirmación leyendo el código (roles que dejen pasar al dueño, endpoints alternativos, botones ocultos por permisos, migraciones con índices o triggers) | **14 confirmadas y 4 parciales** (C2, C6, C15, C16). Las parciales se usan acá en su versión corregida |
| Panel de diseño | 3 propuestas independientes: **A** "evolución sin romper", **B** "el partido es el centro" (estilo Spond), **C** "agenda + descubrir" (estilo Playtomic). 2 jueces: valor para el usuario y factibilidad. 1 síntesis | **El modelo de B, entregado con el método de A**, con injertos de C |
| Revisión de este documento | Spot-check de las citas del diagnóstico contra el código actual | Todas las citas de la sección 2 coinciden con `cb52be8` |

### 1.3 Por qué ganó "B con el método de A"

- **De B (match hub) tomamos el modelo de producto y el estado final:** una sola pantalla por partido, los equipos dentro de la cancha y, más adelante, el partido fijo. Es lo que resuelve la queja de fondo: hoy el mismo partido está repartido entre la Home, el Panel Admin, el Calendario y la página de votos.
- **De A (incremental) tomamos el método:** patrón strangler, flags en `_flag()`/`/config`, migraciones expand-only con la menor cantidad posible de corridas manuales y medición con `metadata.source`. B solo era arriesgado: proponía reescribir mucho de una vez.
- **De C (agenda) injertamos** la especificación de sheets, el back contextual, el copy de recuperación y las métricas de control. Su IA (feed + descubrir) no encaja en una comunidad cerrada de 1-2 partidos por semana.

### 1.4 Hallazgos que cambiaron el plan

| Hallazgo | Evidencia | Consecuencia |
|---|---|---|
| `check_and_auto_close_court` además de cerrar la cancha hace `UPDATE events SET status='CLOSED'` (`AUTO_CLOSE_EVENT`), y `register` exige `status='OPEN'` | `app/routers/events.py:117-127`, `events.py:550-551` | Apagar solo el cierre de la cancha no alcanza: `AUTO_CLOSE_ON_FULL=false` apaga las dos cosas y el data-fix reabre eventos además de canchas |
| No hay índice único sobre `event_registrations(event_id,user_id)` en `migrations/`, pero el código captura `IntegrityError` | `events.py:6`, `events.py:593` | Puede existir uno en prod (Q0). Además la espera se ordena por `created_at` (`events.py:143`): si re-anotarse hace un UPDATE que conserva el `created_at` viejo, esa persona se cuela |
| `metadata.source` ya existe | `"api"` (`events.py:607`, `:718`), `"auto"` (`events.py:130`), `"auto_from_move"` (`events.py:882`), `"auto_from_cancel"` (`events.py:1020`) | No inventamos la convención: extendemos el vocabulario |
| El acceso con clave solo guarda hash y salt | `migrations/015_event_access.sql:13-14` | Al repetir un partido no podemos mostrar la clave. El copy lo asume |
| Los votos dependen de `finalized_at` (ventana de 7 días) y del opt-in de quien vota y de quien recibe | `app/routers/ratings.py:125-127`, `ratings.py:98-105` | Sin finalización no hay votos, y sin votos el balanceador no tiene datos |
| `cn()` unificado y pull-to-refresh ya existen | `futbol-mvp-web/src/design/cn.js:1`, `App.jsx:626` | Unificar es borrar las otras 5 copias; el refetch reusa `usePullToRefresh` |
| El scoring exige 3 votantes distintos y un prior de 5 | `app/utils/scoring.py:24`, `scoring.py:30` | "Votar a 3" dejaría jugadores sin score: se rechaza |

### 1.5 Conflictos entre propuestas y cómo se resolvieron

| Conflicto | Decisión | Por qué |
|---|---|---|
| IA final | La de B, con etiquetas familiares: **Partido · Calendario · Avisos · Gestión · Perfil** | "Yo", "Agenda" y "Club" se reconocen peor. Se mantienen `/calendar` y `/profile` para tener menos redirects |
| Tab "Votar" (A) | **No va.** Los votos aparecen en el estado post-partido de `/p/:id` y como card en Avisos | Pasa vacía casi toda la semana y no está disponible si no tenés opt-in |
| Header con campana y avatar (A) | **No va.** Una sola superficie de navegación (la barra inferior). La barra superior es propia de cada pantalla | Elimina la doble navegación y el dropdown de la campana |
| Overlay: `<dialog>.showModal()` (B) vs portal (A/C) | **Portal a `#overlay-root` + `inert`**, más el fix de `fill-mode` | En el top layer los toasts con "Deshacer" quedan inertes. Con el fix de raíz y el portal alcanza. Ponemos un test en CI para que no vuelva |
| Lista de espera: reabrir al cancelar (A), `closed_reason` (C) o no auto-cerrar (B) | **B, extendido:** `AUTO_CLOSE_ON_FULL=false` apaga el cierre de cancha y de evento. Se audita `COURT_FULL` y se corre un data-fix único | Es lo más simple y evita la lógica de reapertura |
| Suspender: `CLOSED+cancelled_at` (C) vs `CANCELLED` (A) | **`status='CANCELLED'`** (no hay CHECK) | El auto-finalize nunca lo toma y `open_event` no lo reabre por error |
| Avisos dirigidos: recrear `chk_notifications_kind` (B) | **No se recrea.** `kind='INFO'` y columnas nuevas `audience_event_id` y `audience_user_id` | No se toca una tabla que ya tiene parches legacy (004/006) |
| Swap inmediato (C), con confirmación (A) o como borrador (B) | **Borrador en "Armar equipos" + un solo PUT atómico.** La capacidad se valida al final | Es un único modelo que después sirve para Equilibrar y Publicar. Cada cambio adicional cuesta 2 toques |
| Equipos dentro de la cancha | **Sí (B):** Claro/Oscuro, arquero, juntar/separar y balanceador del lado del server. Va en la iteración 3b | Es el modelo de Fulbito que pidió el organizador |
| Recurrencia | **Primero Repetir (iter 2). Después la serie que solo publica (iter 5)**, condicionada a datos. Los fijos se auto-confirman solo si H3 lo justifica | Cambiar el consentimiento y la semántica de cupo requiere evidencia |
| "Votar a 3" (C) | **Rechazado** | `MIN_DISTINCT_VOTERS=3` y `CONFIDENCE_PRIOR=5` (`scoring.py`): dejaría jugadores sin score |
| "No voy" / `DECLINED` (B) | **Se difiere a la serie v2.** Mientras tanto la asistencia se ve como Van / En espera / Se bajaron | `court_id NULL` ya marca la espera, así que `DECLINED` rompe filtros sin que se note |
| Resultado: tabla propia (C) vs columnas (B) | **Columnas en `event_courts`** | Menos joins, misma utilidad |
| Medición: trigger de DB (C) | **Header `X-UI-Source` + helper `write_audit()`** en los endpoints que se toquen | No agrega lógica oculta en una base de SQL crudo |
| Auditoría de Repetir | Se reutilizan **`CREATE_EVENT` / `CREATE_COURT` con `source='quick_repeat'`** y `duplicated_from` en metadata | Las consultas de "eventos por semana" siguen siendo comparables |
| Finalizar solo | **150 min** después de `starts_at`, configurable | Coinciden A y B. 3 h corta tarde |

---

## 2. Diagnóstico (verificado en el código)

Convenciones: las rutas del frontend son relativas a `futbol-mvp-web/src/`; las del backend y migraciones, a la raíz del repo. La columna **Ver.** dice qué afirmación de la verificación adversarial la respalda (C1-C18) o **R** si se verificó en la revisión de este documento.

### 2.1 Armar el partido semanal cuesta entre 20 y 25 toques

| Afirmación | Evidencia | Ver. |
|---|---|---|
| Son 4 campos tipeados y 3 modales: el evento, cada cancha (una por POST) y el acceso | Formulario de evento `AdminPanel.jsx:1829-1836`; `CreateCourtForm` `AdminPanel.jsx:1955-2052`; ruta de una cancha por POST `admin_events.py:704` | C8 |
| El evento nace `OPEN` y **sin canchas**; no hay duplicar, plantilla ni recurrencia | Un solo INSERT con `'OPEN'` fijo `admin_events.py:106-131` (`:125`); el único INSERT en `event_courts` es `admin_events.py:726`. Grep de `duplicat\|clone\|template\|recurr\|repetir\|plantilla` sin resultados relevantes | C8 |
| El evento recién creado **no queda seleccionado**: "+ Crear Cancha" puede ir al de la semana pasada | `AdminPanel.jsx:202-208` descarta la respuesta, aunque el backend devuelve `event_id` (`admin_events.py:159-160`). `loadEvents` (`AdminPanel.jsx:133-157`) conserva la selección anterior (`:147-148`) o toma `events[0]` de una lista ordenada `starts_at DESC` (`admin_events.py:1338`). El modal de cancha postea a `selectedEventId` (`AdminPanel.jsx:661-663`) | C7 |
| El acceso vuelve a "solo socios" (`MEMBERS_ONLY`) en cada evento | El INSERT de `create_event` no setea `access_mode` (`admin_events.py:106-131`) y queda el default `migrations/015_event_access.sql:10`; el acceso se configura aparte (`admin_events.py:371-449`) | R |
| El "+" (FAB) del Calendario lleva a la tab Calendario (anuncios), no a Eventos | `calendar/AdminCreateMenu.jsx:38-42` navega a `/admin?focus=calendar`; `AdminPanel.jsx:117-120` abre `calendario`. Matiz: la tab Eventos está a un toque | C9 |
| `close_at` se muestra pero no se aplica | Solo se guarda (`migrations/001_init.sql:53`, `admin_events.py:100`, `:112`); el alta solo mira `status` (`events.py:550`, `:652`); se ve solo en el admin (`AdminPanel.jsx:935-937`). No hay scheduler | C10 |

### 2.2 Darse de baja está roto

| Afirmación | Evidencia | Ver. |
|---|---|---|
| El jugador recibe **403** al darse de baja a sí mismo | `cancel_registration` llama a `assert_can_move` sin excepción para el dueño (`events.py:921`). `assert_can_move` (`events.py:20-51`) solo deja pasar `admin`/`super_admin` por código de rol (`:25-32`) o una fila en `event_captains` (`:37-46`); si no, 403 (`:48-51`) | C1 |
| "Baja" y "Mover…" se le muestran **a todos** | `App.jsx:584-611`, solo condicionado a `court.players.length > 0` (`App.jsx:558`). `canManageReg` (`App.jsx:687`) solo habilita el drag (`App.jsx:415`, `:1542`) | C1, C6 |
| Lo mismo pasa con "Cancelar mi lugar" en el Calendario | El CTA se arma en `calendar.py:372-378` y llama al mismo endpoint en `calendar/CalendarItemSheet.jsx:45-55` | C1 |
| El permiso `registrations.manage` no sirve: el front lo usa, el back lo ignora | Front: `App.jsx:687`; permiso definido en `migrations/012_permissions.sql:54`; back: `events.py:25-32` mira códigos de rol | C1, C6 |
| Toda baja termina en un WhatsApp al organizador | Consecuencia de lo anterior: no hay otro endpoint de baja para socios (`events_public.py:420` es solo para externos con token) | C1 (H4 lo mide) |

### 2.3 La lista de espera prácticamente no funciona

Versión corregida de C2 (parcial): en la UI normal de socios la espera es **casi inalcanzable**, aunque hay caminos laterales donde sí aparece.

| Afirmación | Evidencia | Ver. |
|---|---|---|
| Al llenarse por un alta, la cancha pasa a `is_open=false`; si todas están llenas o cerradas, el evento pasa a `CLOSED` | `events.py:78-83` (cancha), `events.py:110-127` (evento, audita `AUTO_CLOSE_EVENT` en `:126`). Se dispara tras un alta (`events.py:611-612`), un invitado (`events.py:722`) o un externo (`events_public.py:361-362`) | C2 |
| `register` responde 400 con evento no abierto o cancha cerrada; solo da `WAITLIST` con cancha **abierta y llena** | `events.py:550-551` ("El evento no está abierto"), `events.py:562-563` ("La cancha está cerrada"), `events.py:573-575` | C2 |
| Cancelar no reabre la cancha y la promoción exige `is_open` | `cancel_registration` (`events.py:895-1027`) solo escribe en `event_registrations` y el audit; promoción con `if court and court["is_open"]` (`events.py:985`) y en `promote_first_waitlist` (`events.py:152`) | C3 |
| Reabrir es manual y **tampoco promueve** a nadie | "Abrir Cancha" `admin_events.py:1070`; "Reabrir Evento" `admin_events.py:575`. Ninguno llama a la promoción | C3 |
| Matiz: hay canchas llenas que quedan abiertas | Si se llenan por un move, una promoción o un cambio de capacidad (`admin_events.py:765`), no hay auto-cierre y `/register` sí devuelve `WAITLIST` | C2 (corrección) |
| La Home no muestra la espera; otras pantallas sí | `App.jsx` no lee `waitlist` aunque `/events/active` la devuelve (`events.py:276-296`). Sí aparece en el Calendario (`calendar/CalendarItem.jsx:42`, `calendar.py:376`) y en el admin (`AdminPanel.jsx:1072-1087`) | C2 (corrección) |

### 2.4 Los menús se rompen por una causa de CSS

| Afirmación | Evidencia | Ver. |
|---|---|---|
| `.page-enter` usa `animation-fill-mode: both` y deja un `transform` en el wrapper: todo `position:fixed` se ubica respecto del wrapper | `index.css:65-66` (`animation: page-enter 0.22s ease-out both`). Afectados: modal del admin `AdminPanel.jsx:43-52`, FAB `calendar/Calendar.jsx:136`, panel de la campana `App.jsx:1338` (`fixed … top-24`), toasts `AdminPanel.jsx:555` y `Profile.jsx:97` | R |
| Falta `viewport-fit=cover`, así que el safe-area queda en 0 en iOS | `index.html:8`; el `padding-bottom` con `env(safe-area-inset-bottom)` de `index.css:55-58` no hace nada sin eso | R |
| Hay modales con `90vh` y 3 sin `max-h` | `AdminPanel.jsx:52` (`max-h-[90vh]`); sin `max-h`: `calendar/AdminAnnouncementForm.jsx:87`, `features/tournaments/admin/CreateTournamentModal.jsx:57`, `features/tournaments/admin/MatchResultModal.jsx:27` | R |
| No hay scroll lock, ni Escape, ni manejo de foco | Grep de `document.body`/`body.style` y de `Escape` en `src/`: sin resultados | R |
| Tocar el backdrop borra formularios | El `Modal` cierra con `onClick={onClose}` en el backdrop (`AdminPanel.jsx:47-50`) y lo usan los formularios de evento y cancha (`AdminPanel.jsx:661`) | R |
| Hay inputs de menos de 16px, que hacen zoom en iOS | Nombre del invitado `text-sm` (`App.jsx:1558-1564`), select de cancha (`App.jsx:1573-1578`), "Mover…" `text-[10px]` (`App.jsx:595`) | R |

### 2.5 "No sé dónde está cada cosa"

| Afirmación | Evidencia | Ver. |
|---|---|---|
| No hay shell: el header de la Home tiene 6-7 controles que se envuelven | `App.jsx:1299-1420`: Mi Calendario (`:1306`), Panel Admin (`:1311-1319`), campana (`:1324`), perfil (`:1386`), Actualizar (`:1407-1417`) | R |
| "Volver" siempre lleva a `/` | `AdminPanel.jsx:520`, `Profile.jsx:304`, `calendar/Calendar.jsx:69`, `RatingsPending.jsx:406` y `:446`, todos `navigate("/")` | R |
| No hay logout | Grep de `logout\|cerrar sesi` en `src/`: sin resultados | R |
| El admin tiene 9 tabs, sin URL, sin badges y sin indicio de scroll | `ADMIN_TABS` en `AdminPanel.jsx:12-22`; barra `overflow-x-auto` en `AdminPanel.jsx:528-543`; tab en `useState('eventos')` (`AdminPanel.jsx:73`) | R |
| Conviven 3 sistemas de overlay | `Modal` centrado (`AdminPanel.jsx:43`), `BottomSheet` (`App.jsx:480`) y overlays ad hoc `fixed inset-0` por componente (`calendar/AdminAnnouncementForm.jsx:87`, `CreateTournamentModal.jsx:57`, `MatchResultModal.jsx:27`); aparte, `PlayerCardModal` (`App.jsx:246`) | R |
| Hay unas 7 implementaciones de tabs | `AdminPanel.jsx:528`, `design/ui/Tabs.jsx`, `calendar/Calendar.jsx`, `features/tournaments/admin/TournamentTabs.jsx`, `LegacyTournamentsAdminTab.jsx`, `admin/RolesPermisosTab.jsx`, `audit/AuditoriaTab.jsx` | R |
| `cn()` está definido 6 veces | `design/cn.js:1`, `App.jsx:62`, `Profile.jsx:28`, `RatingsPending.jsx:24`, `calendar/api.js:60`, `audit/api.js:49` | R |

### 2.6 Anotarse es ambiguo

| Afirmación | Evidencia | Ver. |
|---|---|---|
| La Home abre el partido **más lejano** | `/events/open` ordena `starts_at desc` (`events.py:194-195`) y la Home toma `evts[0]` (`App.jsx:940`). Corrección: pasa en la primera carga sin `?event_id=`; después conserva la selección si sigue en la lista (`App.jsx:939`) y se puede cambiar con los chips (`App.jsx:1441-1467`) | C11 |
| El lugar libre es un círculo sin texto, seguido de "¿Estás seguro?" | Slot `App.jsx:435-443`, con el texto solo en `title` (`:441`); abre la confirmación (`App.jsx:1538`, sheet `App.jsx:1625-1670`, "¿Estás seguro de anotarte?" en `:1633`) | C12 |
| Además hay que elegir cancha | El alta es por slot de una cancha concreta: el `onClick` pasa `courtId` (`App.jsx:439`) | C12 |
| Los invitados se retipean cada semana y no se pueden borrar | Formulario nombre + cancha sin recientes (`App.jsx:1552-1600`); quitar va a `/cancel`, que no mira `created_by_user_id` (`events.py:921`) → 403 | C13 |
| El límite de invitados dice 5 en la UI y 10 en el backend | `App.jsx:1552` ("Máximo 5 invitados por actor") vs `events.py:677-678` (`guest_count >= 10`) | C13 |

### 2.7 Armar equipos no existe

| Afirmación | Evidencia | Ver. |
|---|---|---|
| En el celular se mueve con un select de 10px y un reload por movimiento | Select "Mover…" `App.jsx:584-602` (`text-[10px]` en `:595`); `moveReg` (`App.jsx:1137`) recarga. El drag es HTML5 sin fallback táctil (`App.jsx:405-416`, `:498-516`) dentro de un carrusel scroll-snap de una cancha por pantalla (`index.css:86-100`). Corrección: el select y "Baja" no son un camino móvil; se le muestran a todos en cualquier dispositivo | C6 (corrección) |
| Un swap entre canchas llenas lleva ~15 toques y 4 cambios de pantalla | Mover a cancha cerrada → 400 (`events.py:789-790`); a cancha llena → 409 (`events.py:801-802`). El workaround es subir la capacidad (`admin_events.py:765`) y reabrir (`admin_events.py:1070`); la promoción automática puede robar el lugar en el medio (`events.py:832-869`) | C5 |
| Los capitanes no pueden actuar | El endpoint escribe en `event_court_captains` (`admin_events.py:974`) pero el permiso lee `event_captains` (`events.py:37-43`), que nadie escribe. El helper correcto `require_captain_of_court` (`app/utils/permissions.py:82-128`) no se usa. No hay UI para asignar capitanes | C4 |
| Quitar a alguien no pide confirmación | "Baja" llama a `cancelReg` directo (`App.jsx:603-611` → `App.jsx:1119-1131`), sin `confirm`. Otras pantallas sí confirman (`calendar/CalendarItemSheet.jsx:47`) | C6 |

### 2.8 El post-partido y los avisos dependen de que alguien se acuerde

| Afirmación | Evidencia | Ver. |
|---|---|---|
| Finalizar es manual, y sin `FINALIZED`/`finalized_at` no se abren los votos | Única escritura de `FINALIZED`: `admin_events.py:683` (ruta `:660`). `/ratings/pending` exige `FINALIZED` y `finalized_at` de los últimos 7 días (`ratings.py:125-127`), y opt-in de quien vota (`ratings.py:98-105`). Corrección: si el evento ya se auto-cerró, son 2 toques (Finalizar → Confirmar); si sigue abierto, 4 (`AdminPanel.jsx:850-866`) | C16 (corrección) |
| Votar son ~36 toques, guardados de a uno, aunque `POST /ratings` acepta un lote de 50 | `saveSingleVote` manda un solo ítem (`RatingsPending.jsx:317-356`, POST en `:335`); un "Guardar feedback" por jugador (`RatingsPending.jsx:555`, `:675`); el schema acepta hasta 50 (`app/schemas.py:186`). El link a votar es un `<a>` con recarga (`App.jsx:1437`). Extra: la media estrella manda 0,5 (`RatingsPending.jsx:79`) y el schema exige ≥1 (`schemas.py:173`) | C17 |
| El opt-in de ranking arranca apagado | `migrations/007_ranking_opt_in_attributes.sql:18` | C17 |
| Los finalizados desaparecen del admin | `list_events` excluye `FINALIZED` por defecto (`admin_events.py:1329-1330`) y la tab Eventos no pasa el flag (`AdminPanel.jsx:136`). Corrección: "Reactivar" sigue alcanzable justo después de finalizar y por `?event_id=`; el problema es volver a encontrarlos | C15 (corrección) |
| No existe suspender | Solo hay `/open`, `/close` y `/finalize` (`admin_events.py:575`, `:618`, `:660`); `status` es un `VARCHAR` sin CHECK (`migrations/001_init.sql:52`) | C18 |
| Los avisos son globales para todos | `GET /notifications` filtra solo por activo y fechas (`notifications.py:42-48`); `POST /admin/notifications` no tiene destinatarios (`notifications.py:208-260`) | C18, R |
| Editar no avisa a nadie | `PATCH` del evento (`admin_events.py:172-297`) solo hace UPDATE + audit (`:264-284`) | C18 |
| Los votos no se auditan | `ratings.py` no escribe en `event_audit_log` (0 apariciones) | R |

### 2.9 Resumen de la verificación adversarial

| Id | Tema | Veredicto |
|---|---|---|
| C1 | Baja propia → 403; Baja/Mover visibles para todos | Confirmada |
| C2 | Espera inalcanzable | **Parcial** (ver 2.3) |
| C3 | Cancelar no reabre; promoción exige cancha abierta | Confirmada |
| C4 | Capitanes en tabla equivocada | Confirmada |
| C5 | Swap entre canchas llenas | Confirmada |
| C6 | Drag sin touch; quitar sin confirmación | **Parcial** (ver 2.7) |
| C7 | Evento creado no queda seleccionado | Confirmada |
| C8 | Evento sin canchas, sin duplicar | Confirmada |
| C9 | FAB del calendario a la tab equivocada | Confirmada |
| C10 | `close_at` no se aplica | Confirmada |
| C11 | Home abre el partido más lejano | Confirmada (con detalle) |
| C12 | Slot sin label + confirmación | Confirmada |
| C13 | Límite 5 vs 10; invitado no se puede quitar | Confirmada |
| C14 | Eventos PRIVATE invisibles en el Calendario para no anotados (`calendar.py:186`) | Confirmada |
| C15 | Finalizados fuera del admin | **Parcial** (ver 2.8) |
| C16 | Votos dependen de finalizar a mano | **Parcial** (ver 2.8) |
| C17 | Votar de a uno; opt-in apagado | Confirmada |
| C18 | Sin suspender; editar no avisa | Confirmada |

---

## 3. Principios de diseño

1. **El partido es el centro.** Cada partido tiene una sola pantalla (`/p/:id`) con todas las acciones de todos los roles, y lo que se muestra depende del rol y del estado. Para lo semanal, el organizador casi no necesita entrar a Gestión.
2. **Un toque para lo frecuente; confirmación solo si afecta a otros.**
   - "Deshacer" (5 s) para lo propio y reversible: anotarse, invitar con chip, cambios en el borrador.
   - Diálogo para lo que mueve a terceros: bajarse (promueve a alguien), quitar a otro, suspender, republicar equipos.
3. **Lo que se repite, se copia.** La fecha +7, el lugar, las canchas, el acceso, los invitados recientes y la última cancha vienen precargados. El tipeo es la excepción.
4. **Menús que no se esconden.**
   - En celular no hay dropdowns: todo menú es ActionSheet.
   - Una sola primitiva de overlay, con portal y footer siempre visible.
   - Inputs de 16px.
5. **Todo tiene dirección.** Secciones, partido y sheets viven en la URL (`/gestion/:section`, `/p/:id?sheet=…`). El refresh, el back de Android y los links de WhatsApp funcionan.
6. **El sistema hace lo mecánico.** La espera promueve sola, el partido finaliza solo, los avisos llegan solo a los afectados y el balanceador propone.
7. **Medible y reversible.**
   - Cada escritura nueva lleva `metadata.source` y `ui`.
   - Cada flujo está detrás de un flag.
   - Las migraciones son expand-only y aditivas.
   - Cada iteración tiene una consulta de éxito sobre `event_audit_log`.

---

## 4. Arquitectura de información

### 4.1 Shell por rol (`AppShell`, layout route con `<Outlet/>`)

Las rutas `/e/:code`, `/g/:token` y `/tournaments/*` quedan **fuera** del shell. Solo heredan la primitiva de overlay y el copy nuevo.

| Rol | Barra inferior (64px + `safe-area-inset-bottom`, ítems ≥44px) |
|---|---|
| Jugador | **Partido** · **Calendario** · **Avisos** (badge) · **Perfil** |
| Organizador (`canAccessAdmin` / `PANEL_PERMISSIONS`) | Partido · Calendario · Avisos · **Gestión** (badge = Pendientes) · Perfil |
| Capitán (`event_court_captains`) | Igual que el jugador. En `/p/:id` ve los chips de organizador **acotados a su cancha** |

- **No hay header global.** Cada pantalla tiene su barra superior.
  - En Partido: el título ("Mié 21/10 · 21 hs"), *date pills* si hay más de un partido próximo y `⋯`, que abre un ActionSheet según el rol.
- **Back contextual** solo en pantallas anidadas: `navigate(-1)`, con la ruta padre como fallback. Los tabs de primer nivel no tienen "Volver".
- **"Actualizar" se reemplaza** por refetch en `visibilitychange`, refetch después de cada mutación, pull-to-refresh (se reusa `usePullToRefresh`) y un toast cuando hay una versión nueva de la PWA.
- **El badge de Avisos** suma los votos pendientes y los avisos posteriores a `lastSeenAt` (en localStorage, sin backend).

### 4.2 Dónde va cada cosa

| Hoy | Propuesta |
|---|---|
| Home: canchas, slots, Baja/Mover, invitados, pill "Total" | **`/p/:id` Partido**: hero "14/20 · Quedan 6", mi tarjeta y canchas. "Mover" pasa a Armar equipos |
| Botón "Mi Calendario" | Tab **Calendario** (`/calendar`), con un chip de estado por fila: *Vas / En espera / —* |
| Botón "Panel Admin" | Tab **Gestión** |
| Campana (dropdown `fixed top-24`) | Tab **Avisos** (inbox): card de votos pendientes arriba, después avisos dirigidos y globales |
| Avatar, "Instalar" | Tab **Perfil**: datos, nivel, atributos, opt-in de ranking, "Me gusta atajar" (3b), Instalar app, **Cerrar sesión** |
| `/ratings/pending-ui` (`<a>` con reload) | `/p/:id/votar`. La ruta vieja redirige al último partido con votos pendientes |
| Admin › Eventos (lista y detalle) | Lista: **Gestión › Partidos** (Próximos / Terminados / Suspendidos). Detalle: `/p/:id`. Edición completa: `/p/:id/editar` (datos, canchas, acceso, capitanes) |
| "+ Crear Evento" y "+ Crear Cancha" | **Repetir** (sheet) o **`/crear?desde=:id`** (pantalla completa) |
| EventAccessPanel + WhatsApp | Sheet **Compartir** (`?sheet=compartir`), que se abre solo al crear |
| Usuarios | Gestión › **Personas** (`/gestion/personas?q=`) |
| Solicitudes + Desbloqueos | Gestión › **Pendientes**, una sola bandeja con badge sumado (`/gestion/pendientes`) |
| Auditoría | Gestión › Auditoría (`/gestion/auditoria?event=`), más `⋯ › Historial` dentro del partido |
| Notificaciones (globales) | Gestión › **Avisos generales**. Los avisos de un partido se mandan desde el partido |
| Calendario (anuncios) | Gestión › **Anuncios**, y el FAB de Calendario › "Anuncio" |
| Torneos | Gestión › Torneos. Mismo contenido, un solo segmented y hero no sticky |
| Roles y Permisos | Gestión › Roles |
| FAB Calendario › "Evento de cancha" | Abre **Repetir** si hay plantilla; si no, `/crear` |

### 4.3 Gestión

Es una lista agrupada con badges (en desktop ≥768px, una sidebar):

- Arriba: card **"Próximo partido"**, o **"Repetir el del miércoles"** si no hay uno abierto.
- Partidos: Partidos · Partidos fijos (iter 5)
- Personas: **Pendientes (3)** · Personas · Roles y permisos
- Comunicación: Avisos generales · Anuncios
- Otros: Torneos · Auditoría

### 4.4 Estado en la URL y redirects

- `/` → **próximo partido relevante**. El cliente ordena `/events/open` de forma ascendente y elige el primero con `starts_at ≥ now−3h`. Si no hay, toma el último FINALIZED de los últimos 7 días donde tengo votos pendientes. Si tampoco hay, muestra el estado vacío. En la iter 1 se agrega opcionalmente `GET /me/next`.
- `/p/:id?sheet=compartir|invitar|baja|equipos|anotar|suspender|resultado`. El sheet hace `pushState`: back lo cierra y se puede deep-linkear.
- `/p/:id/votar`, `/p/:id/editar`, `/crear?desde=:id`, `/calendar?view=mes&d=2026-10`, `/avisos`, `/gestion/:section`, `/profile`.
- **Redirects:**

| Ruta vieja | Destino |
|---|---|
| `/admin` | `/gestion` |
| `/admin?tab=x` | `/gestion/x` |
| `/admin?focus=calendar` | `/crear` |
| `/ratings/pending-ui` | `/p/:id/votar` (último partido con votos pendientes) |

- **Login:** conserva el `returnTo`. Un link de WhatsApp a `/p/:id` vuelve a `/p/:id` después de loguearse.

---

## 5. Flujos

### 5.1 Tabla de toques (hoy vs propuesta)

El prototipo clickeable usa **exactamente estos números**.

| # | Flujo | Hoy (verificado) | Propuesta | Iter |
|---|---|---|---|---|
| a1 | Repetir el partido semanal + canchas + acceso + compartir | 20-25 toques, 4 campos, 3 modales, el acceso se resetea | **3 toques + WhatsApp, 0 campos** (4 desde Gestión) | 2 |
| a2 | Partido fijo (serie) | — | **0 por semana + 2** ("Avisar al grupo" › WhatsApp) | 5* |
| a3 | Partido desde cero | 20-25 | ~8 toques, 0-2 campos | 2 |
| a4 | Compartir un partido solo para socios | Imposible | 2 | 1 |
| b1 | Anotarse | 2-3 (y abre el partido equivocado); ~5 desde Calendario | **1** + Deshacer; 2 desde Calendario | 1 |
| b2 | Anotarse en una cancha puntual | Dentro del alta | 1 (tocar "Libre") | 1 |
| b3 | Bajarse | **Roto (403)** | **2** | 0a |
| b4 | Lista de espera | Inalcanzable | **1**, con promoción automática | 0a/1 |
| b5 | Invitado recurrente | ~4 + tipear | **2** (chip reciente + Deshacer) | 2 |
| b6 | Invitado nuevo | ~4 + tipear | 2 + tipear | 1 |
| b7 | Quitar mi invitado | Imposible | 2 | 0a |
| c1 | Mover un jugador (celular) | ~3 + reload + zoom | 2 dentro de Armar (+1 abrir, +1 Guardar) | 3a |
| c2 | Swap entre canchas llenas | ~15 toques, 4 pantallas | **4** (abrir, A, B, Guardar); +2 por cada cambio extra | 3a |
| c3 | Equipos parejos dentro de la cancha (arquero, separar) | No existe (papel/WhatsApp) | **3** (Armar › Equilibrar › Publicar) | 3b |
| c4 | Anotar a un socio | Imposible | 2 + buscar | 2 |
| c5 | Quitar a un jugador | 1, sin confirmación | 2, con diálogo | 0a |
| d1 | Cerrar y finalizar | 2-4 manual; si nadie lo hace, no hay votos | **0** (automático a +150 min); 2 si es manual | 2 |
| d2 | Votar a ~9 compañeros | ~36-38 + reload, de a uno | **29** (1 + 3×9 + 1), un solo POST | 2 |
| d3 | Cargar el resultado | No existe | ~5 (o "Saltar") | 4 |
| e1 | Suspender por lluvia | No existe (aviso global a todos) | **4 + WhatsApp**, solo a los anotados | 4 |
| e2 | Editar con aviso | ~4, nadie se entera | 3 + el cambio, aviso incluido | 4 |
| f1 | Aprobar una solicitud | 3 + deslizar las 9 pestañas hasta encontrar "Solicitudes" | 3 (Gestión con badge › Pendientes › Aprobar): mismos toques, pero se encuentra sola | 1 |
| f2 | Cerrar sesión | Imposible | 3 (en 0a, 2 desde el avatar) | 0a |

\*La iteración 5 está condicionada a H1 y a que ≥70% de los partidos se creen con Repetir.

### 5.2 (a) Crear el partido semanal + compartir (iter 2)

1. El organizador abre la app y cae en **Partido**. Si no hay un partido abierto próximo, ve la card "No hay partido armado. ¿Repetimos el del miércoles?" con el resumen: *Mié 28/10 · 21 hs · Club Norte · 2 canchas × 10 · Con link y clave*. Toca **"Repetir partido"** (1). En un partido FINALIZED, el mismo atajo aparece como chip: "Repetir para el mié 28/10".
2. Se abre el **sheet Repetir** (`dismiss="guarded"`):
   - Chips de fecha: "Mié 28/10" (preseleccionado) · "Otra fecha".
   - Hora y lugar copiados (tocar para editar).
   - Canchas con stepper de capacidad.
   - Acceso en solo lectura con "Cambiar", y la nota "Se usa la misma clave de la semana pasada".
   - Preview del mensaje.
   - Toca **"Crear y compartir"** (2). Se llama a `POST /admin/events/{id}/duplicate`, que copia acceso y canchas y genera un `share_code` nuevo.
3. La app navega a `/p/:nuevo?sheet=compartir`. El evento nuevo queda **seleccionado por construcción** (arregla C7).
4. El **sheet Compartir** se abre solo, con el link y el mensaje que incluye los lugares por cancha. Toca **"Enviar por WhatsApp"** (3): Web Share si está disponible, si no `wa.me`. También hay "Copiar link".
5. **Variante desde cero:** `/crear?desde=:id` es una pantalla completa (no un wizard), con footer sticky. Trae chips de fecha, hora, lugar sugerido, stepper "2 canchas × 10", acceso segmentado preseleccionado con el último usado y "Avanzado" plegado. `close_at` se va del formulario.
6. **Variante serie (iter 5):** desde un partido, "Convertir en fijo" pregunta una sola cosa: "Publicar 3 días antes a las 10". Después, cada semana llega a Avisos "Se publicó el partido del mié 4/11" con **"Avisar al grupo"**, que lleva a WhatsApp.

### 5.3 (b) Anotarse, bajarse, invitado

1. El jugador entra por el link de WhatsApp (`/p/:id`) o por el tab Partido.
   - Hero: "14/20 · Quedan 6 lugares".
   - Barra de acción sticky arriba de la tab bar: **"Me anoto"** (1). Toast: "¡Adentro! Estás en la Cancha 1." con **Deshacer** (5 s). El server asigna la primera cancha con lugar según `sort_order`.
2. **Para elegir cancha** se toca "Libre" en esa cancha (1). Si justo se llenó, el server responde 409 con alternativas y la app ofrece: "¿Te sumamos a la Cancha 1, que tiene 2 lugares?" o "Anotarme en espera".
3. **Partido lleno:** el CTA pasa a **"Anotarme en espera"** (1) y después muestra "Sos el 2.º en la lista de espera." Si alguien se baja, la promoción es automática, y en la pantalla aparece "¡Se liberó un lugar y entraste!". En la iter 4 eso también llega a Avisos.
4. **Bajarse:**
   - **"No puedo ir"** (1) abre el diálogo "¿Liberás tu lugar?". El cuerpo dice quién lo toma. Se confirma con **"Sí, liberar mi lugar"** (2).
   - Si faltan menos de 24 h, el botón principal es **"Liberar y avisar al grupo"**, que abre WhatsApp con un mensaje armado.
   - Si después vuelve a anotarse, entra al final.
5. **Invitado:**
   - **"+ Invitado"** (1) abre el sheet Invitar, con chips de invitados recientes. Tocar un chip (2) lo suma con Deshacer.
   - Un nombre nuevo se escribe en un input de 16px y se confirma con "Sumar".
   - El sheet muestra "Te quedan 3 de 5" y la lista de mis invitados con **Quitar**. Quitar abre un diálogo (2) porque puede promover a alguien de la espera.
6. Los jugadores **no ven** "Mover…" ni "Baja" sobre otros. Solo ven lo que pueden hacer.

### 5.4 (c) Armar equipos

1. El organizador, o el capitán sobre su cancha, toca el chip **"Armar equipos"**. Se abre el sheet de alto completo `?sheet=equipos`, que es un **borrador local**.
2. **3a (canchas):**
   - Columnas por cancha, apiladas en el celular, con un punto de nivel 1-5 por jugador (solo lo ve el organizador) y la suma por cancha.
   - Tocar a Juan lo selecciona y aparece el hint "Tocá con quién lo cambiás o una cancha". Tocar a Pedro hace el swap. Tocar el encabezado de una cancha mueve a Juan ahí.
   - Los cambios quedan resaltados y hay un contador "3 cambios".
   - Footer: [Descartar] **[Guardar cambios]** → `PUT …/lineup`, atómico, con la capacidad validada **al final**. Si cambió algo mientras tanto, responde 409 con el estado nuevo.
3. **3b (Claro/Oscuro):**
   - Cada cancha se divide en Claro y Oscuro.
   - **"Equilibrar"** pide `POST …/lineup/suggest` al server, que respeta un arquero por bando (`prefers_goalkeeper`), los pares a juntar o separar y los candados. Muestra "Diferencia 0,4".
   - Se ajusta con tap-tap.
   - **"Publicar equipos"** guarda con `publish=true` y manda el aviso "Equipos listos". En `/p/:id` los jugadores ven Claro/Oscuro y quién ataja.
   - Opciones secundarias en el `⋯` del sheet: modo Mezclado / Por nivel (entre canchas), "No juntar a…", "Juntar a…".
4. **Anotar a un socio:** chip "Anotar a alguien" › buscar › tocar el nombre.
5. **Quitar a un jugador:** se toca al jugador › "Quitar del partido" › diálogo.

### 5.5 (d) Post-partido

1. A `starts_at + 150 min`, el sweeper lazy finaliza el partido en la primera lectura que llegue: setea `finalized_at` y se abren los votos por 7 días.
2. `/p/:id` pasa al estado **Jugado**. El jugador ve el CTA **"Votar a tus compañeros (9)"** (1), que lleva a `/p/:id/votar`. Si no tiene opt-in, ve arriba la card "Sumate al ranking para votar y que te voten" con un toggle inline. Es un consentimiento explícito y el default sigue en off.
3. **Votar:** una sola lista, con una fila por compañero: estrellas (1) + exactamente 2 chips de atributo (2), o "No lo vi" para saltear. Contador "7 de 9". Footer sticky **"Enviar votos (9)"**, que hace un único POST en lote. Se puede mandar parcial ("Enviar 7 ahora"). Se registra `SUBMIT_RATINGS`.
4. **Resultado (iter 4):** cualquier confirmado de esa cancha, el capitán o el organizador. Chip "Resultado" › steppers Claro [– 5 +] Oscuro [– 3 +] › "Guardar", o "Saltar".
5. **Organizador:** aparece el chip "Repetir para el mié 28/10", que cierra el ciclo con (a). Para finalizar a mano: `⋯` › "Terminar partido" › confirmar. Como válvula de seguridad está "Volver a abrir", que usa el `REOPEN_EVENT` existente.

### 5.6 (e) Suspender / editar + aviso (iter 4)

1. **Suspender:**
   - `⋯` (1) › **Suspender partido** (2) abre el sheet con chips Lluvia / Sin cancha / Faltan jugadores / Otro (3), un mensaje editable y el toggle "Avisar a los 18 anotados y 2 en espera" (ON).
   - **"Suspender y avisar"** (4) → `status='CANCELLED'` + aviso dirigido. Después se abre Compartir con el mensaje de suspensión para WhatsApp.
2. **Partido suspendido:**
   - Muestra el banner "Suspendido · lluvia" hasta `starts_at + 24h`.
   - Inscripciones congeladas.
   - `⋯` › "Reactivar partido" (3).
   - El auto-finalize **nunca** toma un CANCELLED.
3. **Editar:**
   - `⋯` › Editar abre `/p/:id/editar` › hacés el cambio › **"Guardar y avisar"**.
   - El toggle viene ON si cambió la fecha, la hora o el lugar, y OFF si no.
   - El aviso dirigido dice "Cambió el partido: ahora 21:30".

---

## 6. Sistema de menús y overlays

### 6.1 API (`src/design/ui/overlay/`, unas 400 líneas propias, sin dependencias)

```jsx
<Sheet open onClose title footer size="auto|full" dismiss="auto|guarded|locked" dirty initialFocus="title">
<Dialog open tone="default|danger" title confirmLabel cancelLabel onConfirm busy>   // role="alertdialog"
<ActionSheet open onClose title items={[{label, tone, onSelect, disabled, hint}]}>
<Menu trigger items placement="bottom-end">   // <768px: ActionSheet. ≥768px: Popover anclado
toast({ title, action: { label: "Deshacer", onClick }, duration: 5000 })
useSheetParam("invitar")   // sincroniza con ?sheet=
useScrollLock() · useFocusTrap() · useOverlayStack() · useKeyboardInset()
```

### 6.2 Especificación

1. **Montaje:**
   - `<div id="overlay-root">` como hermano de `#root` en `index.html`, con `createPortal`.
   - Mientras hay un overlay modal abierto, `#root` lleva `inert` + `aria-hidden`.
   - El **Toaster** vive en `#overlay-root` con el z más alto. Así queda fuera del subtree inerte y se puede tocar aunque haya un sheet abierto.
2. **Fix de raíz:** `.page-enter` pasa a `animation: page-enter .22s ease-out backwards`. Regla: los wrappers de ruta nunca animan `transform`.
3. **Layout:**
   - Grid header / body / footer.
   - `max-height: calc(100dvh - env(safe-area-inset-top) - 12px)`, con `@supports` fallback a `100vh`.
   - El body tiene `overflow-y:auto; overscroll-behavior:contain`.
   - **Footer sticky** con `padding-bottom: max(16px, env(safe-area-inset-bottom))`: el CTA nunca queda fuera de pantalla.
   - `size="full"` = `100dvh` (para Armar equipos).
   - Desde 640px se renderiza como diálogo centrado `max-w-lg` con `max-height: 85dvh`.
4. **Viewport:** `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.
   - En iOS, `visualViewport` actualiza `--kb-inset` y el footer sube con el teclado.
   - Al enfocar un input se hace `scrollIntoView({block:'nearest'})`.
   - El `padding-bottom` del body se va: el safe-area lo maneja el shell.
5. **Scroll lock** con contador de referencias: `body{position:fixed; top:-scrollY}` y se restaura la posición al cerrar. Soporta overlays anidados.
6. **Reglas de cierre:**

| Modo | Para qué | Cierra con |
|---|---|---|
| `auto` | Menús, sheets de lectura | Backdrop, Esc, swipe y back |
| `guarded` | Formularios | Si hay cambios, el backdrop no cierra. Esc o back muestran en línea "¿Descartás los cambios?" con [Seguir editando] [Descartar] |
| `locked` | Mientras hay un request en curso | Nada |

   Solo el overlay de arriba del stack reacciona.
7. **Historia:** abrir un sheet hace `push` de `?sheet=`; cerrarlo hace `navigate(-1)` si lo pusheamos nosotros y `replace` si vino por deep link.
8. **Foco y accesibilidad:**
   - Los sheets ponen el foco inicial en el **título** (`tabIndex=-1`), así no salta el teclado en iOS.
   - En un `Dialog danger`, el foco va a la acción segura ("Me quedo").
   - Focus trap, y el foco vuelve al trigger al cerrar.
   - `role="dialog"`, `aria-modal`, `aria-labelledby`. Los ActionSheet usan `role="menu"`. Los toasts, `aria-live="polite"`.
9. **Swipe-to-dismiss:** solo sobre el grabber y el header. Cierra si el arrastre supera el 30% del alto o va a más de 0,6 px/ms. Un solo detent + `full`, sin física de detents.
10. **Escala de z-index** (`tokens.css`): `--z-sticky:20 --z-tabbar:30 --z-fab:35 --z-sheet:50 --z-dialog:60 --z-menu:65 --z-toast:70`. Los toasts van en `bottom: calc(64px + env(safe-area-inset-bottom))`.
11. **Menús:**
    - Debajo de 768px, **siempre ActionSheet**.
    - Desde 768px, popover anclado con `getBoundingClientRect`, flip/shift a 8px del borde y `max-height:60dvh`. Cierra con pointerdown afuera, Esc, selección o resize.
12. **Inputs:** las primitivas usan `text-base`, y hay una regla global `input,select,textarea{font-size:max(16px,1em)}`.
13. **Tabs que quedan** (segmented de Torneos, semana/mes del Calendario): `design/ui/Tabs` con `scrollIntoView` del tab activo y fade en los bordes. Como máximo 4 ítems.
14. **Movimiento:** se usan los tokens de `motion.ts`. Con `prefers-reduced-motion`, solo fade.
15. **Guardas en CI:**
    - Un grep que falla si aparece la clase `fixed` fuera de `src/shell/` y `src/design/ui/overlay/`.
    - e2e que verifica que el `transform` computado de `.page-enter` sea `none` a los 300 ms.
    - Proyecto Playwright **WebKit "iPhone 14"** además de Pixel 7. Por cada overlay: scrollear al fondo, abrirlo y verificar que el `boundingBox` del CTA quede dentro del viewport. Más axe.

### 6.3 Bug verificado → arreglo

| Bug | Dónde (hoy) | Arreglo |
|---|---|---|
| Modal de AdminPanel fuera de pantalla en páginas largas | `index.css:66` + `AdminPanel.jsx:43-52` | `fill-mode backwards` + portal |
| FAB del calendario que no flota; sheets del calendario desplazados | `calendar/Calendar.jsx:136` | Ídem; el FAB pasa a ser parte del shell (`--z-fab`) |
| Toasts de Admin y de Profile mal ubicados | `AdminPanel.jsx:555`, `Profile.jsx:97` | Un único Toaster en `#overlay-root` |
| Panel de notificaciones (`fixed top-24`) encimado y que no cierra al tocar afuera | `App.jsx:1338` | Desaparece: pasa a ser el tab Avisos |
| Sheet de PlayerCard parcheado aparte | `App.jsx:246` | Se migra a `Sheet` (un solo sistema en vez de 3) |
| `max-h-[90vh]`; AdminAnnouncementForm, CreateTournamentModal y MatchResultModal sin `max-h` ni overflow | `AdminPanel.jsx:52`; `calendar/AdminAnnouncementForm.jsx:87`; `CreateTournamentModal.jsx:57`; `MatchResultModal.jsx:27` | Layout de `Sheet` (dvh + body con scroll + footer sticky) |
| El fondo scrollea detrás del sheet | Sin scroll lock en `src/` | `useScrollLock` |
| Botones fuera de pantalla con el teclado de iOS | Footers no sticky | Footer sticky + `--kb-inset` |
| `env(safe-area-inset-*)` en 0 en iOS | `index.html:8` | `viewport-fit=cover` |
| Tocar el backdrop borra formularios | `AdminPanel.jsx:47-50` | `dismiss="guarded"` |
| Sin Escape, focus trap ni role | Sin manejo de `Escape` en `src/` | Vienen en las primitivas |
| Zoom de iOS (input de invitado, select de cancha, "Mover…" de 10px) | `App.jsx:1558-1578`, `App.jsx:595` | Mínimo de 16px; el select "Mover…" desaparece (tap-tap en Armar) |
| 9 tabs de admin (~1200px en 343px), sin URL ni badges | `AdminPanel.jsx:12-22`, `:528-543`, `:73` | Hub de Gestión agrupado + `/gestion/:section` + badges |
| Admin › Torneos con 5 scrollers + hero sticky de ~300px | `features/tournaments/admin/` | Un solo segmented y hero no sticky |
| `cn()` definido 6 veces, ~7 implementaciones de tabs | Ver 2.5 | Se importa siempre de `design/cn.js` y `design/ui/Tabs` |

---

## 7. Copy deck (formato /ux-copy)

### 7.0 Reglas para todo el copy

- **Voseo siempre:** "anotate", "tocá", "liberás", "revisá". Nada de "tú" ni de "usted".
- **Sin emojis** en la interfaz ni en los mensajes prearmados. Si el organizador quiere, los agrega él en WhatsApp.
- **Largo de botones en un teléfono de 390px.** Con 16px de gutter, el ancho útil es 358px. A 16px semibold entran cerca de 9 px por carácter:

| Tipo de control | Ancho aprox. | Máximo de caracteres |
|---|---|---|
| Botón a ancho completo (barra sticky, footer de sheet) | 358px | **30** |
| Dos botones en la misma fila (diálogos) | ~171px cada uno | **16**; si alguno pasa, se apilan en vertical |
| Chip | auto | **14**; si pasa, va en su propia fila |
| Toast (título + acción) | 358px | **40** en el título para que entre en una línea junto a "Deshacer" |

- **Términos fijos (glosario):** *partido* (no "evento" para el jugador), *cancha*, *lugar* (no "cupo" ni "slot"), *lista de espera* / *en espera*, *invitado*, *quien organiza* (no "Admin"), *Avisos* (no "Notificaciones").
- **Fechas y horas:** "Mié 28/10" al inicio de línea y "el mié 28/10" en medio de una frase; "21 hs" en títulos y "21:00" en el detalle del mensaje. Ordinales con "2.º", no "2do".
- **Nombres de personas:** nombre de pila, truncado a 20 caracteres con "…". Un invitado se nombra "Fede (invitado de Nico)" solo cuando hace falta desambiguar.

## 7.1 UX Copy: Me anoto

### Recommended Copy
**CTA principal (barra sticky)**: Me anoto
**Subtexto del CTA**: Quedan 6 lugares
**Slot libre en una cancha**: Libre · Anotarme acá
**Toast al anotarse**: ¡Adentro! Estás en la Cancha 1. [Deshacer]
**409, ya anotado**: Ya estás anotado en este partido (Cancha 1).

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Me anoto | Directo, en primera persona | Default: es lo que la gente escribe en el grupo |
| B | Anotarme | Neutro, infinitivo | Si un test muestra que conviene alinear con "Anotarme en espera" |
| C | ¡Voy! | Coloquial, de grupo de WhatsApp | Grupos muy informales; menos claro para quien entra por primera vez |

### Rationale
El jugador ya dice "me anoto" en el grupo; el botón repite su propia frase y no hay nada que interpretar. El subtexto da una urgencia real (lugares que quedan) sin presionar. El toast confirma la cancha que asignó el server, porque ya no hay que elegirla, y "Deshacer" reemplaza al "¿Estás seguro?" de hoy (`App.jsx:1633`): anotarse es propio y reversible, así que no merece un diálogo. "Libre · Anotarme acá" le pone texto al círculo vacío que hoy solo tiene tooltip (`App.jsx:441`).

### Localization Notes
- Voseo implícito ("Me anoto", "Estás"). Evitar "Inscribirme" (formal) y "Registrarme" (suena a crear cuenta).
- "Me anoto" (8) entra hasta en media fila; "Anotarme acá" (12) entra en el slot; el toast tiene 31 caracteres + "Deshacer".
- "¡Adentro!" lleva signo de apertura. Sin emojis.
- "Ya estás anotado" asume masculino; si el grupo es mixto, la variante neutra es "Ya tenés lugar en este partido (Cancha 1)."

## 7.2 UX Copy: Bajarse ("¿Liberás tu lugar?")

### Recommended Copy
**Botón secundario**: No puedo ir
**Título del diálogo**: ¿Liberás tu lugar?
**Cuerpo, con espera**: Lo toma Juan, que está primero en la espera. Si después querés volver, entrás al final.
**Cuerpo, sin espera**: Tu lugar queda libre para otro.
**Botones**: Sí, liberar mi lugar / Me quedo (el foco va a "Me quedo")
**Variante con menos de 24 h**: Falta poco para el partido. Avisale al grupo así no quedan cortos. → **Liberar y avisar al grupo** (abre WhatsApp con el mensaje de la sección 7.7)

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | ¿Liberás tu lugar? · Sí, liberar mi lugar | Directo, centrado en lo que pasa con el lugar | Default |
| B | ¿Te bajás del partido? · Sí, me bajo | Coloquial | Si un test muestra que "liberar" no se entiende a la primera |
| C | ¿Cancelar tu inscripción? · Confirmar | Administrativo | Evitar: "Confirmar" no dice qué pasa; es el patrón actual de `CalendarItemSheet.jsx:47` |

### Rationale
Bajarse afecta a otro (promueve a alguien de la espera), así que va con diálogo, a diferencia de anotarse. El título describe la acción concreta en vez de "¿Estás seguro?", y el cuerpo dice la consecuencia con nombre propio: quién toma el lugar. Eso le saca al organizador la tarea de avisar y le da al jugador una razón positiva para bajarse a tiempo. "Me quedo" es la acción segura y recibe el foco. El botón "No puedo ir" nunca va en rojo: para el jugador no es una acción destructiva. Con menos de 24 h, el CTA principal empuja a avisar al grupo, porque ahí la baja sí deja corto al partido (H4 mide cuántas bajas son tardías).

### Localization Notes
- Voseo: "Liberás", "querés", "Avisale". "Así no quedan cortos" es rioplatense; no traducir a "para que no falten jugadores".
- "Sí, liberar mi lugar" (20) pasa de 16: en 390px los dos botones se apilan, con el principal arriba. "Liberar y avisar al grupo" (25) va a ancho completo. "No puedo ir" (11) y "Me quedo" (8) entran en media fila.
- El nombre de quien toma el lugar va truncado a 20 caracteres. Si es un invitado: "Lo toma Fede (invitado de Nico)".

## 7.3 UX Copy: Lista de espera y promoción

### Recommended Copy
**Partido completo**: Partido completo (20/20). → **Anotarme en espera**
**Ya en espera**: Sos el 2.º en la lista de espera. Si se libera un lugar, entrás solo y te avisamos. [Salir de la espera]
**Promoción (banner en el Partido; en la iter 4 también en Avisos)**: ¡Se liberó un lugar y entraste! Cancha 1 · miércoles 21 hs.

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Sos el 2.º en la lista de espera. Si se libera un lugar, entrás solo y te avisamos. | Informativo y tranquilizador | Default, en la pantalla del partido |
| B | Estás 2.º en la espera. Entrás solo si alguien se baja. | Corto | Espacios chicos: fila del Calendario, card de Avisos |
| C | Te anotamos en espera (puesto 2). | Neutro, de sistema | Toast inmediato después del toque |

### Rationale
La posición concreta baja la ansiedad más que un "estás en espera" genérico. "Entrás solo" explica un comportamiento nuevo: hoy la promoción casi nunca ocurre (sección 2.3) y la gente espera que el organizador lo haga a mano. "Te avisamos" es una promesa: en la iter 1 se cumple con el banner en el Partido; no prometemos push. La promoción celebra sin exagerar y repite cancha, día y hora para que no haga falta abrir nada más.

### Localization Notes
- Ordinal "2.º" con punto y voladita; no "2do" ni "segundo".
- "Sos el 2.º" asume masculino; variante neutra: "Estás en el puesto 2 de la lista de espera."
- "Anotarme en espera" (18) va a ancho completo; "Salir de la espera" (18) es un botón de texto secundario.
- "Entrás solo" es "automáticamente", no "sin compañía"; no cambiar a "automáticamente", que suena a sistema.

## 7.4 UX Copy: 409 por cancha llena

### Recommended Copy
**Mensaje (solo cuando se eligió cancha)**: Justo se llenó la Cancha 2. ¿Te sumamos a la Cancha 1, que tiene 2 lugares?
**Botones**: Sí, a la Cancha 1 / Anotarme en espera

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Justo se llenó la Cancha 2. ¿Te sumamos a la Cancha 1, que tiene 2 lugares? | Empático, con la salida incluida | Default: hay una alternativa |
| B | La Cancha 2 se llenó recién. Quedan lugares en: Cancha 1 (2), Cancha 3 (1). | Informativo | Cuando hay más de una alternativa y se listan como botones |
| C | Te ganaron de mano: la Cancha 2 está completa. | Lúdico | Evitar en un error: puede sonar burlón |

### Rationale
El 409 es una carrera, no un error del jugador: "Justo se llenó" lo dice sin culpa. El mensaje explica qué pasó, por qué y ofrece la salida en el mismo diálogo, así nunca queda un callejón sin salida. El server ya manda `alternatives[]` (iter 1), así que el copy puede nombrar la cancha y cuántos lugares tiene. Si no hay alternativas, queda solo "Anotarme en espera".

### Localization Notes
- "Te sumamos" (primera persona plural: la app ayuda) en vez de "¿Querés anotarte…?".
- "Sí, a la Cancha 1" (17) apenas pasa de 16: los botones se apilan. Con nombres de cancha largos ("Cancha techada"), el botón queda "Sí, a esa cancha".
- Respetar mayúscula en "Cancha 1": es nombre propio de la cancha.

## 7.5 UX Copy: 403 reescrito

### Recommended Copy
**Mensaje**: Esto lo puede hacer quien organiza el partido. Si necesitás un cambio, escribile a {organizador}.
**Botón**: Entendido
**Antes** (`events.py:48-51`): "No tenés permisos para realizar esta acción (solo Admin o Capitán del evento)."

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Esto lo puede hacer quien organiza el partido. Si necesitás un cambio, escribile a {organizador}. | Explicativo, sin culpa | Default (diálogo o banner) |
| B | Solo quien organiza puede hacer este cambio. | Corto | Toast |
| C | No tenés permiso para esto. | Seco, técnico | Evitar: es casi el texto actual |

### Rationale
Después de la iter 0a los jugadores dejan de ver botones que no pueden usar, así que este mensaje queda como red de seguridad. Habla de roles en el idioma del grupo ("quien organiza") y no del sistema ("Admin", "Capitán del evento"), y da el próximo paso concreto con un nombre.

### Localization Notes
- "{organizador}" es el nombre de pila de quien creó el partido; si no se conoce, "escribile a quien organiza".
- "Escribile" es imperativo voseante con clítico: no "escríbele".
- "Quien organiza" es neutro en género; no usar "el organizador" en la interfaz.

## 7.6 UX Copy: Repetir y Compartir

### Recommended Copy
**Card del organizador sin partido**: No hay partido armado. ¿Repetimos el del miércoles? → **Repetir partido**
**Resumen debajo**: Mié 28/10 · 21 hs · Club Norte · 2 canchas × 10 · Con link y clave
**Chip en un partido jugado**: Repetir para el mié 28/10
**Título del sheet**: Repetir partido
**Nota de la clave**: Se usa la misma clave de la semana pasada. [Cambiar]
**CTA del sheet Repetir**: Crear y compartir
**Título del sheet Compartir**: Compartí el partido
**CTAs de Compartir**: Enviar por WhatsApp · Copiar link

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Crear y compartir | Describe las dos cosas que pasan | Default: Compartir se abre solo después de crear |
| B | Repetir partido | Coincide con el título | Si Compartir deja de abrirse solo |
| C | Publicar partido | Más "oficial" | Con la serie (iter 5), para separar crear de publicar |

### Rationale
"¿Repetimos…?" en primera persona plural pone a la app del lado del organizador y nombra el día que ya conoce. El resumen deja confirmar todo de un vistazo, así que el sheet no necesita campos. El CTA dice el resultado completo (crear y compartir), y por eso el sheet Compartir puede abrirse solo sin sorprender. La nota de la clave es honesta: solo guardamos hash y salt (`migrations/015_event_access.sql:13-14`), no podemos mostrarla.

### Localization Notes
- "Compartí" es imperativo voseante (no "Comparte").
- "Crear y compartir" (17) y "Enviar por WhatsApp" (19) van a ancho completo. "Repetir para el mié 28/10" (25) pasa el máximo de un chip: va en su propia fila o se acorta a "Repetir (mié 28/10)".
- "WhatsApp" con W y A mayúsculas. "Link", no "enlace": es la palabra que usa el grupo.

## 7.7 UX Copy: Mensaje de WhatsApp

### Recommended Copy
**Partido con link** (cada línea va separada):
```
*Miércoles 21 hs* · Club Norte
Mié 28/10 · 21:00
Cancha 1: quedan 3 · Cancha 2: quedan 6
Anotate acá: {link}
```
**Línea extra si tiene clave**: La clave es la de siempre; si no la tenés, pedímela por privado.
**Solo socios**: \*Miércoles 21 hs\* · Mié 28/10 · 21:00. Anotate desde la app: {link} (el link `/p/:id` pide login)
**Baja con menos de 24 h**: Me bajo del \*Miércoles 21 hs\*. Se liberó un lugar: {link}

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Anotate acá: {link} | Directo | Default |
| B | ¿Quién juega? Anotate acá: {link} | Convocante | Cuando quedan muchos lugares |
| C | Quedan 2 lugares, entra el que llega primero: {link} | Urgencia | Cuando quedan pocos lugares y falta poco |

### Rationale
Es un mensaje que manda el organizador con su nombre, así que va en primera persona ("pedímela"). Usa el formato de WhatsApp (`*negrita*`) para el título. Los lugares por cancha dan una urgencia que es real. La clave **nunca** va en el texto: los mensajes del grupo se reenvían. El link va al final para que WhatsApp arme la vista previa. Parte del mensaje actual de `features/events/admin/EventAccessPanel.jsx:111-117`.

### Localization Notes
- Voseo: "Anotate", "tenés", "pedímela".
- Sin emojis por regla de producto; el organizador puede sumarlos en WhatsApp antes de enviar.
- Los asteriscos son formato de WhatsApp, no se traducen ni se escapan. "21 hs" en el título y "21:00" en el detalle.
- Mantenerlo en 4-5 líneas: en la vista previa de WhatsApp se cortan los mensajes largos.

## 7.8 UX Copy: Suspender partido

### Recommended Copy
**Título del sheet**: Suspender partido
**Chips de motivo**: Lluvia · Sin cancha · Faltan jugadores · Otro
**Toggle (ON por defecto)**: Avisar a los 18 anotados y 2 en espera
**CTA**: Suspender y avisar
**Aviso a los anotados**: Se suspende el partido del miércoles 21/10 (21 hs) por lluvia. No tenés que hacer nada; si se reprograma, te avisamos por acá.
**Banner en el partido**: Suspendido · lluvia (quien organiza ve [Reactivar])
**Acción para volver atrás**: Reactivar partido

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Se suspende el partido del miércoles 21/10 (21 hs) por lluvia. No tenés que hacer nada; si se reprograma, te avisamos por acá. | Claro y tranquilizador | Default, aviso dirigido en la app |
| B | Sin partido el miércoles 21/10: se suspende por lluvia. Si se reprograma, te avisamos. | Corto | Vista previa del aviso, card de Avisos |
| C | Se cae el partido del miércoles por lluvia. | Coloquial | Mensaje del organizador en el grupo, no aviso del sistema |

### Rationale
El aviso responde las tres preguntas del jugador: qué pasó, por qué y qué tiene que hacer (nada). El toggle dice a cuántas personas les llega, que es la mitigación del riesgo "aviso a la gente equivocada" (sección 8.4). El CTA nombra las dos cosas que hace; con el toggle apagado pasa a "Suspender". Reemplaza el workaround actual: un aviso global que le llega a todos mientras el partido sigue `OPEN` (sección 2.8).

### Localization Notes
- "Se suspende" en presente: más inmediato que "fue suspendido".
- "Suspender y avisar" (18) va a ancho completo. Los chips de motivo entran en 14; "Faltan jugadores" (16) puede ir en una segunda fila.
- El motivo va en minúscula en el banner ("Suspendido · lluvia"). "Otro" abre un input de 16px.
- "Por acá" = en la app. No traducir a "aquí".

## 7.9 UX Copy: Estados vacíos

### Recommended Copy
**Partido, jugador**: Todavía no hay partido esta semana. Cuando se arme, te aparece acá.
**Partido, jugador con serie (iter 5)**: Todavía no hay partido esta semana. Se publica el domingo a las 10.
**Partido, organizador**: No hay partido armado. ¿Repetimos el del miércoles? → **Repetir partido**
**Avisos**: Estás al día.
**Gestión › Pendientes**: Sin pendientes. Todo al día.

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | Todavía no hay partido esta semana. Cuando se arme, te aparece acá. | Informativo | Default para el jugador |
| B | No hay partido por ahora. Te avisamos cuando se arme. | Promete aviso | Solo cuando exista el aviso de publicación (iter 4/5) |
| C | Semana sin fútbol (por ahora). | Lúdico | Evitar como único texto: no dice qué pasa después |

### Rationale
Cada estado vacío dice qué es, por qué está vacío y qué pasa después. El jugador no puede crear un partido, así que no recibe un botón sino una expectativa. El organizador sí, y recibe la acción más probable (Repetir). Avisos y Pendientes vacíos son una buena noticia: el copy lo dice en dos o tres palabras.

### Localization Notes
- "Te aparece acá" es rioplatense; no cambiar a "aparecerá aquí".
- "Repetir partido" (15) entra en media fila.
- "Todavía" en vez de "aún".

## 7.10 UX Copy: Error de red

### Recommended Copy
**Mensaje**: No pudimos conectarnos. Revisá tu conexión y probá de nuevo.
**Botón**: Reintentar
**Versión nueva de la PWA (toast; reemplaza el botón "Actualizar")**: Hay una versión nueva. [Actualizar]

### Alternatives
| Option | Copy | Tone | Best For |
|--------|------|------|----------|
| A | No pudimos conectarnos. Revisá tu conexión y probá de nuevo. | Empático y accionable | Default: inline en el sheet o toast |
| B | Sin conexión. Probá de nuevo en un rato. | Corto | Banner persistente cuando el navegador está offline |
| C | Algo salió mal. | Genérico | Evitar: no dice qué pasó ni qué hacer |

### Rationale
"No pudimos" asume la falla sin culpar al jugador; después vienen la causa probable y la acción. En un sheet `guarded`, el error aparece dentro del sheet y no lo cierra, así que no se pierde lo cargado. El reintento vuelve a mandar exactamente lo mismo.

### Localization Notes
- Voseo: "Revisá", "probá".
- "Reintentar" (10) y "Actualizar" (10) entran en cualquier botón.
- No mostrar códigos HTTP ni el `detail` del backend al jugador.

## 7.11 Tabla completa de microcopy

| Elemento | Copy | Notas |
|---|---|---|
| Tabs | Partido · Calendario · Avisos · Gestión · Perfil | Gestión solo con permisos de panel |
| CTA anotarse | **Me anoto** | Subtexto: "Quedan 6 lugares" |
| Slot libre | Libre · Anotarme acá | Reemplaza el círculo que solo tenía tooltip |
| Toast al anotarse | ¡Adentro! Estás en la Cancha 1. [Deshacer] | 5 s. Deshacer = baja silenciosa |
| Partido completo | Partido completo (20/20). **Anotarme en espera** | |
| Ya en espera | Sos el 2.º en la lista de espera. Si se libera un lugar, entrás solo y te avisamos. | [Salir de la espera] |
| Promoción | ¡Se liberó un lugar y entraste! Cancha 1 · miércoles 21 hs. | Banner en el Partido; en la iter 4 también en Avisos |
| 409 por cancha llena | Justo se llenó la Cancha 2. ¿Te sumamos a la Cancha 1, que tiene 2 lugares? [Sí, a la Cancha 1] [Anotarme en espera] | Solo cuando se eligió cancha |
| 409 ya anotado | Ya estás anotado en este partido (Cancha 1). | |
| CTA de baja | No puedo ir | Secundario, nunca en rojo |
| Diálogo de baja: título | ¿Liberás tu lugar? | |
| Diálogo de baja: cuerpo | Lo toma Juan, que está primero en la espera. Si después querés volver, entrás al final. | Sin espera: "Tu lugar queda libre para otro." |
| Diálogo de baja: botones | **Sí, liberar mi lugar** / Me quedo | El foco va a "Me quedo" |
| Baja con menos de 24 h | Falta poco para el partido. Avisale al grupo así no quedan cortos. **Liberar y avisar al grupo** | Abre WhatsApp con el mensaje armado |
| WhatsApp de baja | Me bajo del *Miércoles 21 hs*. Se liberó un lugar: {link} | |
| Invitar: título | Sumar invitado | |
| Invitar: recientes | Invitados recientes | Chips; tocar = sumar + Deshacer |
| Límite de invitados | Te quedan 3 de 5. | Valor de `/config` (`GUEST_LIMIT_PER_USER`) |
| Quitar invitado | ¿Sacás a Fede del partido? Su lugar queda libre. [Sí, sacar] [Cancelar] | |
| Organizador, sin partido | No hay partido armado. ¿Repetimos el del miércoles? **Repetir partido** | Con el resumen debajo |
| Sheet Repetir: título | Repetir partido | |
| Nota de la clave | Se usa la misma clave de la semana pasada. [Cambiar] | No podemos mostrarla: se guarda cifrada |
| CTA de Repetir | **Crear y compartir** | |
| Sheet Compartir: título | Compartí el partido | |
| CTA de Compartir | **Enviar por WhatsApp** · Copiar link | |
| Mensaje con link | *Miércoles 21 hs* · Club Norte\nMié 28/10 · 21:00\nCancha 1: quedan 3 · Cancha 2: quedan 6\nAnotate acá: {link} | Con clave: "La clave es la de siempre; si no la tenés, pedímela por privado." |
| Mensaje solo socios | *Miércoles 21 hs* · Mié 28/10 · 21:00. Anotate desde la app: {link} | El link `/p/:id` pide login |
| Chip Armar | Armar equipos | |
| Hint de selección | Tocá con quién lo cambiás o una cancha. | |
| Equilibrar | **Equilibrar** · "Diferencia 0,4" | El nivel lo ve solo el organizador |
| Publicar | **Publicar equipos** | Republicar: "Ya publicaste equipos. ¿Los reemplazás? Les avisamos a todos." |
| Aviso de equipos | Equipos listos para el miércoles: jugás en Cancha 1, Claro. | Aviso dirigido |
| 409 del lineup | Alguien cambió los equipos mientras los armabas. Te mostramos la versión nueva. | |
| 403 reescrito | Esto lo puede hacer quien organiza el partido. Si necesitás un cambio, escribile a {organizador}. | Antes: "…(solo Admin o Capitán del evento)" |
| Votar: CTA | **Votar a tus compañeros (9)** | Aparece en el estado Jugado y en Avisos |
| Opt-in inline | Sumate al ranking para votar y que te voten. Podés salir cuando quieras. [toggle] | Default off |
| Votar: fila | Elegí 2 cosas que hizo bien · No lo vi | Siempre exactamente 2 atributos |
| Enviar votos | **Enviar votos (9)** · Enviar 7 ahora | Un solo POST |
| Votos enviados | ¡Gracias! Tus votos ayudan a armar equipos parejos. | |
| Resultado | ¿Cómo salió? Claro [–5+] Oscuro [–3+] · **Guardar** · Saltar | |
| Terminar | Terminar partido | Confirmación: "Se abren los votos por 7 días." |
| Suspender: título | Suspender partido | |
| Suspender: CTA | **Suspender y avisar** | Toggle: "Avisar a los 18 anotados y 2 en espera" |
| Aviso de suspensión | Se suspende el partido del miércoles 21/10 (21 hs) por lluvia. No tenés que hacer nada; si se reprograma, te avisamos por acá. | |
| Banner de suspendido | Suspendido · lluvia | El organizador ve [Reactivar] |
| Editar: CTA | **Guardar y avisar** | Toggle ON si cambió la fecha, la hora o el lugar |
| Aviso de cambio | Cambió el partido del miércoles: ahora a las 21:30 en Club Norte. | |
| Descartar cambios | ¿Descartás los cambios? [Seguir editando] [Descartar] | `dismiss="guarded"` |
| Vacío jugador | Todavía no hay partido esta semana. Cuando se arme, te aparece acá. | Con serie: "…se publica el domingo a las 10." |
| Vacío Avisos | Estás al día. | |
| Vacío Pendientes | Sin pendientes. Todo al día. | |
| Cerrar sesión | ¿Cerrás sesión en este teléfono? [Cerrar sesión] [Cancelar] | |
| Versión nueva | Hay una versión nueva. [Actualizar] | Toast; reemplaza el botón "Actualizar" |
| Error de red | No pudimos conectarnos. Revisá tu conexión y probá de nuevo. [Reintentar] | |

---

## 8. Backend, datos, roadmap y qué no hacemos

### 8.1 Vocabulario de medición

**`metadata.source`.** Se extiende el existente (`api`, `auto`, `auto_from_cancel`, `auto_from_move`) con:
`self`, `guest_owner`, `admin`, `admin_on_behalf`, `one_tap`, `slot_pick`, `quick_repeat`, `create_form`, `lineup`, `suggest`, `batch`, `data_fix`, `series_auto`.

Además, `metadata.ui` ∈ {`legacy`, `shell`} sale del header `X-UI-Source`. Lo lee un middleware que lo guarda en un contextvar, y el helper `write_audit()` lo agrega en los endpoints que se toquen.

### 8.2 Cambios por iteración

> **Nota (17/10/2026):** el roadmap se reordenó con los datos de producción (8.4 y sección 9). El detalle técnico de abajo sigue valiendo; cambia en qué iteración entra cada cosa: `finalize_due_events` y sus flags pasan a la **0c**, junto con el desempate `(sort_order, created_at, id)` y `fill_from_waitlist` en `create_court`; el endpoint `duplicate` pasa a la **0d** (sin la columna de la 022); `GET /me/recent-guests` sale; el aviso de promoción pasa de la 4 a la 2; la 1 se parte en 1a/1b y la 3b en 3b-1 (023 sin columnas de resultado) y 3b-2\* (balanceador). La 3a, la 4 y la 5 quedan condicionadas.

| Iter | Endpoints / lógica | Migración | Flags |
|---|---|---|---|
| **Baseline** | Sin cambios de código. Se corren Q0 y H1-H12 sobre el histórico | **`021_audit_indexes.sql`**, con `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (fuera de transacción): `event_audit_log(event_id, created_at)`, `(action, created_at)`, `(target_registration_id)`; `events(status, starts_at)` | — |
| **0a** | Ver el detalle abajo | Ninguna (salvo el índice parcial opcional) | `AUTO_CLOSE_ON_FULL` (default **false**). B1 es un bug fix: sin flag |
| **0b** | Ninguno (frontend) | — | — |
| **1** | Ver el detalle abajo | — | `NAV_SHELL_ENABLED` (en `/config`), `MATCH_SCREEN_ENABLED` (por rol: admins primero), `ONE_TAP_REGISTER_ENABLED` |
| **2** | Ver el detalle abajo | **`022_ux_partido.sql`** (ver abajo) | `QUICK_MATCH_ENABLED`, `AUTO_FINALIZE_ENABLED`, `AUTO_FINALIZE_AFTER_MINUTES=150`, `TARGETED_NOTIFICATIONS_ENABLED` |
| **3a** | `PUT /admin/events/{id}/lineup` (ver abajo) | — | `TEAM_BUILDER_ENABLED` |
| **3b** | Ver el detalle abajo | **`023_equipos_resultado.sql`** (ver abajo) | `TEAM_SPLIT_ENABLED` |
| **4** | Ver el detalle abajo | — (usa 022 y 023) | `EVENT_CANCEL_ENABLED`, `RESULTS_ENABLED` |
| **5\*** | Ver el detalle abajo | **`024_event_series.sql`** (ver abajo) | `EVENT_SERIES_ENABLED` |

**Iteración 0a**

- **B1:** `assert_can_move` se reemplaza por dos helpers:
  - `can_cancel_registration(conn, reg, actor)`: el propio jugador; el creador de un GUEST (`created_by_user_id`); `registrations.manage` vía `get_effective_permissions`; un capitán en `event_court_captains` de esa cancha; o `event_captains` como OR legacy.
  - `can_move_registration`: el permiso, o capitán de la cancha de origen o de destino.
- **`AUTO_CLOSE_ON_FULL=false`:** `check_and_auto_close_court` deja de poner `is_open=false` y **deja de hacer `AUTO_CLOSE_EVENT`**. Cuando una cancha llega al cupo se registra `COURT_FULL`, una vez por transición.
- **Script `scripts/reopen_auto_closed.sql`** (idempotente, `source='data_fix'`): reabre las canchas y los eventos con `starts_at > now()` cuya última acción fue `AUTO_CLOSE_COURT` / `AUTO_CLOSE_EVENT`, y después corre la promoción.
- **Re-anotarse:**
  - `SELECT … FOR UPDATE` de la fila `(event_id, user_id)`.
  - Si está CANCELLED, UPDATE de `status`, `court_id`, `cancelled_at=NULL`, `updated_at=now()` y **`created_at=now()`**. Así vuelve al final; el timestamp original queda en el audit.
  - Si está activa, 409 con copy amigable.
  - Funciona exista o no un índice único.
- **Índice parcial opcional:** si Q0 da cero duplicados activos, `CREATE UNIQUE INDEX CONCURRENTLY uq_reg_event_user_active ON event_registrations(event_id,user_id) WHERE user_id IS NOT NULL AND status<>'CANCELLED'`. Si en prod existe uno no parcial, se reemplaza (fase contract) después de deployar el UPDATE.
- `GUEST_LIMIT_PER_USER` en `settings.py`, expuesto en `/config`.

**Iteración 1**

- `GET /events/active?event_id=` acepta FINALIZED y CANCELLED cuando el id se pasa explícito.
- `RegisterRequest.court_id` opcional:
  - Sin cancha, asigna la primera con lugar según `sort_order`; si no hay, va a WAITLIST.
  - Con cancha y llena, responde 409 `COURT_FULL` con `alternatives[]`.
  - La respuesta incluye el nombre de la cancha y la posición en la espera.
- `GET /admin/pending-counts` → `{account_requests, pin_unlocks}`.
- Opcional: `GET /me/next`.
- Middleware `X-UI-Source` + helper `write_audit()`.

**Iteración 2**

- `POST /admin/events/{id}/duplicate {starts_at?, copy_access=true}`, en una transacción:
  - Copia título, descripción, lugar, visibilidad, `access_mode`, `allow_external_registration`, `public_roster_visibility` y hash/salt.
  - Genera un `share_code` nuevo con `gen_share_code()`.
  - Copia las canchas (`is_open=true`).
  - Audita `CREATE_EVENT` / `CREATE_COURT` con `source='quick_repeat'`.
- `POST /admin/events` acepta `courts[]` y `access` en una sola transacción.
- `POST /admin/events/{id}/registrations {user_id, court_id?}`.
- `GET /me/recent-guests?limit=6` (últimos 90 días).
- **`finalize_due_events(conn)`:**
  - `pg_try_advisory_xact_lock` + `UPDATE … SET status='FINALIZED', finalized_at=now() WHERE status IN ('OPEN','CLOSED') AND starts_at < now() - interval RETURNING id`.
  - Audita `FINALIZE_EVENT` con `{source:'auto'}` y actor NULL. Requiere `020_audit_actor_nullable.sql`: sin ella, prod tiene `actor_user_id` NOT NULL.
  - Se llama de forma lazy en `/events/open`, `/events/active`, `/ratings/pending` y `/notifications`.
  - Opcional: `POST /internal/tick` con secreto, para un cron de Railway.
- `POST /ratings` registra `SUBMIT_RATINGS {count, court_id, source:'batch'}`.
- `GET /notifications` filtra: `(audience_event_id IS NULL AND audience_user_id IS NULL) OR audience_user_id=actor OR EXISTS(inscripción no cancelada del actor en audience_event_id)`. `kind` sigue siendo `'INFO'`.

**Migración `022_ux_partido.sql`** (todo nullable, se corre una sola vez):

- `events`: `duplicated_from_event_id`, `cancelled_at`, `cancelled_reason`.
- `notifications`: `audience_event_id`, `audience_user_id`, con índices parciales.

**Iteración 3a**

- `PUT /admin/events/{id}/lineup {assignments:[{registration_id, court_id}], expected:[{registration_id, court_id}]}`:
  - Una transacción con `FOR UPDATE`. Si algún `expected` no coincide o la fila dejó de estar CONFIRMED, responde 409.
  - La capacidad se valida al final, así que un swap es neto cero aunque las canchas estén llenas.
  - Audita `MOVE_REGISTRATION` por cada cambio (`source:'lineup'`) más un `SAVE_LINEUP {changes}`.
  - El capitán solo puede tocar su cancha.

**Iteración 3b**

- `POST …/lineup/suggest {mode: MIXED|BY_LEVEL, keep_apart, keep_together, locked}` usa **`app/utils/balancer.py`**:
  - Función pura: snake draft + hill-climbing de swaps.
  - Un arquero por bando y separados como restricción dura.
  - Nivel 1-5: score calibrado si existe; si no, `player_level` (INICIAL=2, RECREATIVO=3, COMPETITIVO=4); invitados y externos = 3.
  - El score crudo nunca llega al cliente.
  - Tests en `tests/`.
- `PUT lineup` suma `team_side`, `is_goalkeeper` y `publish`. Con `publish`, aviso dirigido "Equipos listos".
- `PATCH /me {prefers_goalkeeper}`.

**Migración `023_equipos_resultado.sql`:**

- `event_registrations`: `team_side` (CHECK A/B, NULL), `is_goalkeeper` (default false).
- `events`: `teams_published_at`.
- `users`: `prefers_goalkeeper`.
- `event_courts`: `score_a`, `score_b`, `result_recorded_by`, `result_recorded_at`.

**Iteración 4**

- `POST /admin/events/{id}/cancel {reason, message, notify}` → `CANCELLED` + aviso dirigido. Audita `CANCEL_EVENT`.
- `POST …/reactivate` → OPEN. Audita `REOPEN_EVENT {source:'uncancel'}`.
- `/events/open`, el calendario y `events_public` muestran CANCELLED hasta `starts_at+24h`.
- `PATCH /admin/events/{id} {…, notify}`.
- Aviso de promoción a `audience_user_id`.
- `PUT /events/{id}/courts/{court_id}/result`: lo puede cargar un confirmado de la cancha, el capitán o un manager. Audita `RECORD_RESULT`.

**Iteración 5\***

- CRUD `/admin/series` y `POST /admin/series/{id}/skip {date}`.
- `ensure_due()` (bajo advisory lock) materializa reutilizando el servicio de duplicate, con `ON CONFLICT DO NOTHING`. Avisa al organizador "Se publicó, ¿avisás al grupo?".
- Fijos v2 (miembros REGULAR + `DECLINED`) **solo si H3 lo confirma**.

**Migración `024_event_series.sql`:**

- Tabla `event_series`: title, weekday, start_time, tz, location, `court_template jsonb`, plantilla de acceso, `publish_days_before=3`, `publish_time`, `finalize_after_minutes`, `is_active`.
- `events`: `series_id`, `occurrence_date`, con **UNIQUE(series_id, occurrence_date)**.

### 8.3 Archivos que tocan las iteraciones (referencia)

- **Backend:** `app/routers/events.py` (`assert_can_move` :20, `check_and_auto_close_court` :54, `promote_first_waitlist` :130, register :532-620, cancel :895); `app/routers/admin_events.py` (create :90, capitanes :939, `list_events` :1329); `app/routers/ratings.py`; `app/routers/notifications.py`; `app/settings.py` (flags vía `_flag()` y `/config`).
- **Frontend:** `futbol-mvp-web/index.html` (viewport, `#overlay-root`); `futbol-mvp-web/src/index.css` (`.page-enter`, inputs); `futbol-mvp-web/src/main.jsx` (layout route y redirects); `futbol-mvp-web/src/App.jsx` (1674 líneas) y `futbol-mvp-web/src/AdminPanel.jsx` (2398 líneas), que se reemplazan con el patrón strangler.
- **Reuso:** `src/design/` (`tokens.css`, `motion.ts`, `cn.js`, `ui/Tabs`); `usePullToRefresh` (`App.jsx:626`); mensaje de WhatsApp de `features/events/admin/EventAccessPanel.jsx:111-117`; player cards con puntaje (`events.py:356-528`); `gen_share_code()` en `security.py`.
- **Tests:** `futbol-mvp-web/playwright.config.ts` (agregar WebKit), `tests/`.

### 8.4 Roadmap

> **Reordenado el 17/10/2026** con los datos de producción (sección 9). Las filas con \* están condicionadas: entran solo si se cumple su gate.

**Métrica norte:**

1. **Escrituras del organizador por partido**, medidas con **QN v2** (por acción del organizador, solo partidos jugados, con las exclusiones del SQL; ver 9.3): menos de 5 tras la iter 2 (o −50% sobre la base v2) y como máximo 2 con serie. Base provisoria: mediana 8.
2. **Bajas self-service**: 100%, calculado sobre jugadores **sin** rol admin (hasta la 0a, para ellos la baja propia daba 403).

| Iter (estimado, 1 dev) | Qué entra | Riesgos → mitigación | Métrica de éxito (audit log) | Gate para la siguiente |
|---|---|---|---|---|
| **Baseline** ✓ (corrida el 17/10) | Consultas de solo lectura en Supabase (sección 9). Faltan Q0, H6(b) y las de 9.5 | Definición de QN distinta a la del archivo → congelar QN v2 | Línea de base provisoria (QN, mediana 8) | QN v2 congelada antes de medir la 0a |
| **0a · Hotfix** ✓ **en producción 17/10** (queda medio día de verificación) | **Frontend:** `fill-mode backwards`, `viewport-fit`, inputs de 16px; ocultar Baja/Mover sin permiso; label "Libre"; Home al **próximo** partido (orden ASC); autoselección del evento creado; FAB → crear en Eventos; `<Link>` a votos; logout en el avatar; confirmación al quitar a un jugador. **Backend:** B1, `AUTO_CLOSE_ON_FULL=false` + data-fix, re-anotarse por UPDATE, límite de invitados unificado, borrar mi invitado. **Falta:** correr QN v2, H4 y H5 sobre las primeras 1-2 semanas y confirmar que la 020 y `scripts/reopen_auto_closed.sql` corrieron en prod | Un jugador que saca a otro → el check es estricto por `user_id` / `created_by` y hay tests. 500 por `actor_user_id` NOT NULL → 020 (`f06113b`) | `CANCEL_REGISTRATION` con actor = target pasa de ~0 a >50% de las bajas; `PROMOTE_WAITLIST` >0 por semana (7 en toda la historia); `AUTO_CLOSE_COURT`=0 y aparece `COURT_FULL`; 0 canchas nuevas tipo "espera" o "suplente" | Una semana sin 500 ni 403 en bajas |
| **0c · Finalizar solo + canchas en orden** (3-4 días, backend) | (1) `finalize_due_events` con `pg_try_advisory_xact_lock`, lazy en `/events/open`, `/events/active`, `/ratings/pending` y `/notifications`; `AUTO_FINALIZE_ENABLED` y `AUTO_FINALIZE_AFTER_MINUTES=150`; `FINALIZE_EVENT` con `source='auto'` y actor NULL; "Volver a abrir" sigue en el admin. (2) Desempate `(sort_order, created_at, id)` en `events.py:329`, `admin_events.py:1216` y toda consulta que liste canchas; el formulario propone `max(sort_order)+1`. (3) `create_court` llama a `fill_from_waitlist` si la cancha nace abierta, y arma su metadata con `json.dumps`. No toca la UI de votos | Finalize en medio de una limpieza post-partido → el flag queda apagado hasta contar escrituras entre `starts_at` y `FINALIZE`; si hay limpieza, corregir el roster tiene que seguir siendo posible. Finalize prematuro → `starts_at < now() − 150 min` (hubo 1 finalizado antes de jugarse). Actor NULL → verificar la 020 en prod | ≥90% de finalizaciones con `source='auto'`; mediana `finalized_at − starts_at` de 37,9 h a <3 h; `FINALIZE_EVENT` + `CLOSE_EVENT` del organizador de 1,60 a <0,3 por partido; % que vota entre los que tienen opt-in (hoy 32%), 4 semanas antes contra 4 después; 0 eventos nuevos con `sort_order` repetido; `PROMOTE_WAITLIST` después de un `CREATE_COURT` cuando hay espera | — |
| **0d · Repetir rápido en el admin actual** (3-4 días) | `POST /admin/events/{id}/duplicate {starts_at?, courts?[]}` en una transacción: copia título, lugar, descripción, visibilidad, `access_mode` con hash/salt y `allow_external_registration`; `share_code` nuevo con `gen_share_code()`; canchas con `is_open=true` y `sort_order` de 1 a n. Audita `CREATE_EVENT` / `CREATE_COURT` con `source='quick_repeat'` y `duplicated_from` en metadata (sin migración). En el AdminPanel, "Repetir para el <día +7>" por evento, anclado a la franja, con mini-form (fecha, canchas y cupo con stepper, lugar, título y nombres editables) y al final el mensaje de WhatsApp de `EventAccessPanel`. "Repetir las 3" todavía no | Se copia una clave vieja → la nota "misma clave" con [Cambiar]. Se copia el partido de otra franja → Repetir parte del de hace 7 días de esa franja. Canchas o cupo distintos → stepper obligatorio | ≥60% de los eventos nuevos con `source='quick_repeat'` en 3 semanas; eventos con correcciones en 2 h de 14% a <5%; sin canchas a las 2 h de 9% a <2%; 1-2 lugares normalizados por franja; armado en QN v2 (por acción) de ~2,9 a ~1 | Consulta de agrupamiento de `CREATE_EVENT` antes de "Repetir las 3" |
| **0b · Overlays** (1-1.5 sem) | Primitivas; migración de **todos** los modales, incluido el mini-form de la 0d (AdminPanel, toasts, sheets y FAB del Calendario, PlayerCard, los 3 sin max-h); tokens de z; `cn` unificado; Playwright WebKit iPhone 14 + test de boundingBox + axe; guarda en CI | Regresiones visuales en Torneos y Admin → screenshots e2e en las dos engines | Tests de overlay en verde en WebKit y Chromium; el organizador confirma que los menús no se cortan | Cero overlays fuera de la primitiva |
| **1a · Pantalla del partido `/p/:id`** (1-1.5 sem) | `/p/:id` con barra propia (es lo que abre el link de WhatsApp) y hero "Quedan N". "Me anoto" de 1 toque: `court_id` opcional, primera cancha con lugar según `(sort_order, created_at, id)`, y si está todo lleno, a la espera. Toast con Deshacer. Espera visible con el puesto. "No puedo ir" y, a menos de 24 h, "Liberar y avisar al grupo", con quién entra desde la espera dentro del mensaje. Chip Compartir con los lugares por cancha y "Faltan N". `X-UI-Source` + `write_audit()`. Flags `MATCH_SCREEN_ENABLED` y `ONE_TAP_REGISTER_ENABLED` | Altas accidentales → Deshacer. Mandar a alguien a una pseudo-cancha → se excluyen de la primera libre. Llenar la 1 deja corta la 2 → "Libre" visible por cancha. Rollout admins → todos | ≥60% de `REGISTER_USER` con `source='one_tap'`; **altas accidentales** (baja propia <2 min después de anotarse) <3%; bajas self-service ≥60%; sube el % de partidos que se llenan (antes, al menos 42% por `AUTO_CLOSE_EVENT`; ahora se mide con `COURT_FULL`); baja el lead time de `CREATE_EVENT` al primer `REGISTER_USER` | — |
| **1b · Shell y Gestión** (1 sem) | AppShell, tab bar por rol (Partido · Calendario · Avisos · Gestión · Perfil), Avisos inbox, Perfil con logout, Gestión hub con URL y Pendientes (`GET /admin/pending-counts`), `?sheet=`, redirects. Flag `NAV_SHELL_ENABLED` | Convivencia con la Home vieja → rollback por `NAV_SHELL_ENABLED`; rollout admins → todos | ≥90% de escrituras con `ui='shell'`; baja el tiempo de resolución de pendientes | Dos semanas estables; se borra la Home vieja (contract) |
| **2 · Ciclo semanal, versión corta** (1-1.5 sem) | 022; Repetir desde `/p/:id` y desde Gestión por franja ("Repetir el martes 20:00 para el 27/10"), con "Repetir las 3" solo si el agrupamiento lo justifica; `/crear` con lugar sugerido; compartir para socios; anotar a un socio; votar en lote + "No lo vi" + `SUBMIT_RATINGS` + card de opt-in inline; Terminados en Gestión; avisos dirigidos + **aviso de promoción**. Sale: invitados recientes. Ya hechos: auto-finalize (0c) y el endpoint de Repetir (0d) | Se copia una clave vieja → la nota "misma clave" con [Cambiar]. Aviso a la gente equivocada → preview "Llega a N" | QN v2 con mediana <5 (o −50% sobre la base v2); ≥70% de partidos con `source='quick_repeat'`; % que vota entre los que tienen opt-in de 32% a ≥45%; votos por semana de ~8 a ≥12 | H6(b) y QN v2 posterior a la 0a deciden si entra la 3a; la 3b-1 va primero |
| **3b-1 · Claro/Oscuro manual** (1 sem) | 023 mínima (`team_side`, `is_goalkeeper`, `teams_published_at`, `prefers_goalkeeper`). Sheet "Armar equipos" dentro de la cancha: tap-tap entre Claro y Oscuro, arquero y "Publicar equipos" con aviso dirigido "Equipos listos". Sin balanceador ni resultado | No hay demanda → antes de arrancar, correr H6(b), cruzar los 12 partidos con moves con los que tienen canchas-equipo y preguntarle al organizador cómo arma los equipos hoy | 0 canchas nuevas con nombre de equipo; ≥30% de partidos con `teams_published_at` en 4 semanas | ≥30% publican equipos → entra la 3b-2 |
| **3a\* · Mover entre canchas atómico** (1 sem) | `PUT /admin/events/{id}/lineup` atómico con `expected[]` y capacidad validada al final; tap-tap entre canchas; capitanes funcionando sobre `event_court_captains` | Conflictos de edición → 409 + recarga | Cada ráfaga de ≥3 moves o aperturas → 1 `SAVE_LINEUP`; `MOVE_REGISTRATION` + `UPDATE_COURT` + `CLOSE_COURT` −50%; QN v2 con mediana ≤3 | Entra solo si, con la 0a andando, esas tres acciones siguen en ≥1,5 por partido en QN v2, o si H6(b) muestra ráfagas en ≥15% de los partidos |
| **5\* · Serie que solo publica** (2 sem) | 024; `event_series` por franja reutilizando el duplicate de la 0d; skip de feriados; tick opcional. Sin fijos ni `DECLINED`. Arranca por los martes | Materialización sin tráfico → cron `/internal/tick`; zona horaria → `tz` explícita | % de partidos con `series_id`; QN v2 ≤2 por partido; time-to-fill (`COURT_FULL` − publicación) estable o menor | Solo si ≥70% de los partidos salen de Repetir durante 4 semanas y, en esa franja, ≥70% de las repeticiones no tocan canchas ni cupo. Fijos v2: no (H3 refutada) |
| **3b-2\* · Balanceador** (1 sem) | `lineup/suggest` con `app/utils/balancer.py`: snake draft + hill-climbing, un arquero por bando, juntar/separar, candados; sin score, usa `player_level` | Desconfianza del score → fallback a nivel, candados, ajuste manual. Solo 46 de 105 jugadores reciben votos → más de la mitad por `player_level` | Cambios manuales después de "Equilibrar" ≤3 por cancha; sube el % de partidos con equipos publicados | Solo si la 3b-1 pasa su gate |
| **4\* · Suspender, editar con aviso y resultado** (backlog, 1.5 sem) | Suspender, reactivar, editar con aviso, resultado. El aviso de promoción ya se fue a la 2 | Aviso a la gente equivocada → preview "Llega a N" | Avisos globales usados como "se suspende" → 0; `CANCEL_EVENT` por mes visible; % de canchas con resultado | Solo si un proxy mejor (≥50% de bajas en las 24 h previas) muestra ≥1 suspensión por mes, o si el organizador dice que suspende seguido |

**Por qué cambia el orden** (una línea por movimiento):

- **0a, en producción el 17/10.** H4 (35% de bajas a <24 h) y H12 ("b" en el top 3) confirman que iba primero; ahora falta medirla.
- **Auto-finalize sale de la 2 y arma la 0c.** H7: mediana de 37,9 h; es solo backend y, separado del voto en lote, se puede medir solo. Es una decisión nueva, no la regla original.
- **El orden de canchas y `create_court` entran en la 0c.** Son bugs de hoy: `sort_order` repetido en 46 de 49 eventos con varias canchas, y sumar una cancha no promueve a la espera.
- **El endpoint de Repetir sale de la 2 y arma la 0d.** 3 franjas = 85% de los partidos y "a" es el flujo más pesado (3,71 por partido); el endpoint se reusa tal cual en la 2 y en la serie.
- **La 0d va antes que la 0b.** La 0a ya arregló la causa raíz de los overlays (`fill-mode`); si la 0b ya arrancó, se termina primero.
- **La 1 se parte en 1a (`/p/:id`) y 1b (shell).** El valor medible (H4, H5) está en `/p/:id`; la shell la envuelve después.
- **"Liberar y avisar al grupo" va en la 1a y el aviso de promoción pasa de la 4 a la 2.** H4: la regla adelanta las dos cosas, no solo una.
- **Invitados recientes sale de la 2.** H9: solo el 9% se repite.
- **3b antes que 3a, y la 3b se parte.** H6: 43 de 55 partidos sin moves; Claro/Oscuro manual es la forma barata de medir demanda antes del balanceador.
- **La 3a pasa a condicionada.** H6(b) no se corrió y parte de su problema (subir el cupo y reabrir para un swap) ya lo alivió la 0a.
- **La 4 pasa a backlog.** H11 no concluyente (0 de 64) y `UPDATE_EVENT` tiene 10 usos en total; Suspender no sube a la 2.
- **La 5 sigue condicionada y arranca por los martes.** H1 se cumple solo por día + hora; el jueves va de 1 a 5 canchas.

### 8.5 Qué NO hacemos

- **No hacemos un feed tipo Playtomic ni un marketplace de partidos abiertos.** Es una comunidad cerrada con 1-2 partidos por semana.
- **No hay tab "Votar", ni campana con dropdown, ni avatar en un header global.** Navegación única abajo.
- **No hacemos "Votar a 3", no cambiamos las reglas de voto** (siempre 2 atributos) **y no preseleccionamos atributos.** El opt-in de ranking sigue en off por defecto: se ofrece inline.
- **No usamos `CLOSED` como "suspendido" y no recreamos `chk_notifications_kind`.**
- **No usamos `<dialog>.showModal()` en v1 ni librerías de UI** (Radix, vaul). Tampoco detents con física de velocidad.
- **No hay drag & drop en el celular.** Tap-tap en todos lados; el drag queda solo en desktop.
- **No auto-confirmamos fijos ni agregamos `DECLINED` hasta que H3 lo justifique.** La serie arranca solo publicando.
- **No hacemos web push, API de WhatsApp, pagos ni chat.** El canal es WhatsApp con mensaje prearmado, más el inbox de Avisos.
- **No hay triggers de DB ni listeners de engine para medir.** Usamos un helper explícito y el header.
- **No hacemos una reescritura big-bang de `App.jsx` (1674 líneas) ni de `AdminPanel.jsx` (2398).** Patrón strangler: lo nuevo va en `src/shell/` y `src/features/match/`, y lo viejo se borra en la fase contract.
- **No aplicamos `close_at`.** Sale del formulario; para cerrar se usa "Cerrar inscripción" a mano desde `⋯`.
- **No le mostramos scores crudos a los jugadores.** El balanceador expone solo nivel 1-5 y "diferencia", y solo al organizador.
- **No tocamos Torneos ni Copa Proud** más allá de moverlos a Gestión y migrar sus modales a la primitiva.

---

## 9. Resultados con datos de producción (17/10/2026)

> Consultas de **solo lectura** (todas `SELECT`, ninguna escribe) corridas el 17/10/2026 en el SQL Editor de Supabase, sobre la base de producción. Son versiones compactas de `docs/ux/consultas-comportamiento.sql`; las que se ejecutaron, con su resultado y sus límites, están en `docs/ux/consultas-ejecutadas-2026-10-17.sql`.
> Es la foto **"antes" de la 0a**, que se deployó el mismo 17/10. Ningún número de esta sección mide la 0a.

### 9.1 Método

- **Filtro desde el 27/6** (`created_at >= '2026-06-27'`) en todo lo que depende de quién hizo la acción (H4, H5/H6 y QN): antes de esa fecha el actor del audit era falsificable.
- **Franja** = día + hora, en hora argentina. **Lugar normalizado** = `lower(trim(lugar))`.
- **Organizador** (QN): quien tiene **hoy** rol admin, super_admin, captain o gestion_eventos. Son los roles actuales, no los que tenía en la fecha del partido.
- Contexto: mediana de 47,5 usuarios activos por semana desde el 29/6 (41–58; en feb–jun, 41,5).

| Consulta | Ventana | Universo |
|---|---|---|
| Inventario y roles | Todo el histórico | Audit log, roles y usuarios |
| H1 y parches | Últimos 6 meses | 91 partidos |
| H2 | Todo el histórico; 2 h desde `CREATE_EVENT` | 138 eventos |
| H3 | Últimas 12 semanas, por franja | 15, 12 y 10 partidos |
| H4 | Desde el 27/6 | Bajas de jugadores (`USER`) e invitados |
| H5 / H6 | Desde el 27/6 | 55 partidos jugados |
| QN | Desde el 27/6 | 60 partidos |
| H7 | Últimos 4 meses | 59 finalizados |
| H8 / H9 | Finalizados de los últimos 3 meses | 761 participaciones de 105 jugadores / 116 invitados |
| H10 | Eventos con más de una cancha | 49 eventos; 75 jugadores con ≥4 partidos |
| H11 | Todas las notificaciones | 64 |

### 9.2 Veredictos

Cuando el análisis y la revisión escéptica no coincidieron, nos quedamos con la lectura más conservadora (ver 9.6).

| Hipótesis | Veredicto | Evidencia | Qué cambia en el diseño |
|---|---|---|---|
| **H1** Se repite igual | **Confirmada en parte** (solo día + hora) | El umbral (≥70% en ≤2 combinaciones de día+hora+lugar+canchas) **no se cumple**: las 2 franjas más grandes suman 52 de 91 (57%), y eso contando solo día+hora. Sí hay **3 franjas fijas**: Mar 19:00 (27 partidos en 24 semanas), Jue 19:00 (25 en 25) y Mar 20:00 (25 en 24) = 77 de 91 (85%), con 3 o 4 partidos por semana. Lugar y canchas varían: 5, 9 y 8 lugares normalizados por franja; el jueves va de 1 a 5 canchas y de 10 a 50 lugares | Repetir se ancla a la **franja**, no al "último partido": "Repetir el martes 20:00 para el 27/10" copia el de hace 7 días de esa franja. En el mini-form, el stepper de canchas y cupo es obligatorio, y lugar, título y nombres de cancha son editables (lugar sugerido de los ya usados). "Repetir las 3" queda como acción secundaria hasta saber si se crean juntas. La serie (iter 5) sigue condicionada; si llega, arranca por los martes |
| **H2** Armar cuesta y genera errores | **Confirmada en parte** (por los errores; el costo se refuta) | En las 2 h desde `CREATE_EVENT`: mediana de 2 escrituras (p75 4, máx 7) y 0,6 min (p75 1,2); 1,57 canchas por evento. Errores: 3 canchas creadas en eventos ya jugados, 19 eventos (14%) con correcciones, 13 (9%) sin canchas a las 2 h | La regla decía "si el setup es corto, Repetir baja frente a la iter 3". **No la seguimos, y lo decimos:** el audit no ve el formulario ni los toques (son 20-25, sección 2.1) y la iter 3 tiene menos evidencia (H6). Repetir se justifica por las franjas y el tipeo, no por H2: su endpoint se adelanta a la 0d. El éxito se mide por adopción de `quick_repeat` y QN v2 por acción, no por filas del audit |
| **H3** Núcleo de fijos | **Refutada** | Fijos según el SQL (se anotan en <60 min en ≥75% de sus partidos): 0 en Mar 19, 1 en Jue 19 y 0 en Mar 20. Aun sin exigir rapidez, los que van a ≥75% son 0, 5 y 5, contra cupos de 10 a 18 (martes) y de 10 a 50 (jueves). Sí hay un pool de habituales que rota: 22 socios van a ≥50% de los jueves (10 en Mar 20, 1 en Mar 19) | No se auto-confirman fijos, no hay `DECLINED` y la serie v2 queda afuera. El pool que rota refuerza el link por WhatsApp y el "Me anoto" de 1 toque, no la auto-inscripción |
| **H4** Bajas tardías por el admin | **Confirmada** (lo tardío; lo "por el admin" es efecto del 403) | Desde el 27/6, 133 bajas de jugadores: 95 hechas por otro (71%) y 38 propias. A menos de 24 h: 46 (35%). Hasta el 17/10 la baja propia daba 403 salvo a admins, así que las 38 propias son casi todas de organizadores que juegan. Ninguna baja hecha por otro fue después del inicio. Invitados: 26 bajas | La 0a era la prioridad correcta. La regla adelanta **dos** cosas: "Liberar y avisar al grupo" (<24 h) a la 1a, con el nombre de quien entra desde la espera dentro del mensaje de WhatsApp; y el **aviso de promoción** dirigido, de la iter 4 a la 2 (viaja con la 022) |
| **H5** Se llena rápido, hay demanda | **Confirmada en parte** (por poco y con una medida ruidosa) | Mediana `CREATE_EVENT → AUTO_CLOSE_EVENT` de 45,9 h (p25 25,3 h), pero sobre los 23 de 55 partidos que se auto-cerraron (42%). 73 reaperturas manuales en 20 partidos. 9 partidos con una "cancha" de espera armada a mano | Espera real (0a) + "Faltan N" con los lugares por cancha (chip Compartir, 1a). Arreglo chico en la 0c: `create_court` no promueve a la espera (`admin_events.py:706-764`), a diferencia de `update_court` (`:851`) y `open_court` (`:1127`) |
| **H6** Equipos = ráfagas de moves | **No concluyente** ((a) se refuta; (b) no se corrió) | 43 de 55 partidos sin moves (mediana 0). Donde hay, 12 partidos (22%), con mediana de 4,5 y máximo de 21; `MOVE_REGISTRATION` es la 4.ª acción del organizador (1,35 por partido). Las ráfagas `OPEN_COURT > MOVE > CLOSE_COURT` (H6 b) no se midieron. 5 partidos usaron canchas como equipos | Se aplica la regla (pocos moves → 3b antes que 3a), pero la evidencia es flaca para las dos. La 3b se parte: **3b-1** Claro/Oscuro manual y **3b-2** balanceador, condicionado. La 3a queda condicionada a H6(b) y al QN v2 posterior a la 0a |
| **H7** Se finaliza tarde y se pierden votos | **Confirmada en parte** (tarde sí; perder votos no está medido) | 59 finalizados: mediana de 37,9 h después del inicio (p75 49,3; p90 65,2); 0 colgados; 1 finalizado antes de jugarse. La ventana de 7 días arranca en `finalized_at`, así que los votos no se pierden: arrancan ~1,5 días tarde | Auto-finalizar (solo backend) pasa a una **0c**, separado del voto en lote (iter 2) para medir cada efecto por separado. Es una decisión nueva, no la regla del doc (que solo decía "si ya es rápido, baja a la 4"). Antes de prender el flag: contar escrituras entre `starts_at` y `FINALIZE` (limpieza post-partido) y verificar la 020 en prod. Exigir `starts_at < now() − 150 min` |
| **H8** No votan por el opt-in | **No concluyente** (depende de la unidad) | Por participación, 61% con opt-in (468 de 761): refuta. Por jugador, 45% (47 de 105): confirmaría. Se votó en el 32% de las participaciones con opt-in (152 de 468). Votos: ~8 por semana, 16% de los activos (23% en feb–jun) | Foco en el voto en lote + "No lo vi" (iter 2) y en el momento del voto (0c). La card de opt-in inline se queda en la iter 2 y no baja de prioridad: el opt-in sigue frenando a 58 de 105 jugadores. Solo 46 de 105 recibieron votos (42 con ≥3 votantes): el balanceador dependería de `player_level` para más de la mitad |
| **H9** Invitados repetidos, límite <5 | **Refutada** | 116 invitados distintos (por anfitrión); 11 (9%) aparecen en ≥2 partidos, máximo 3. Por anfitrión y partido: p50 1, p95 3, máximo 6 | Los chips de invitados recientes y `GET /me/recent-guests` salen de la iter 2: no se construyen por ahora. El límite de 5 queda (la 0a dejó `GUEST_LIMIT_PER_USER=5` y `registrations.manage` sin tope) |
| **H10** Eligen cancha a propósito | **No evaluable** (se midió por nombre) | Por nombre de cancha: de 75 jugadores con ≥4 partidos, 0 repiten cancha ≥80% (3 llegan a ≥60%; mediana 0,29). Pero son canchas físicas del predio ("cancha 5" 30, "cancha 13" 19, "cancha 11" 13), y por posición no se puede medir: en 46 de 49 eventos con varias canchas todas tienen el mismo `sort_order` | Se mantiene "primera cancha libre", con desempate por orden de creación (`sort_order, created_at, id`) y **no** por nombre ("cancha 13" queda antes que "cancha 5"). Las pseudo-canchas (espera, equipos) se excluyen o marcan, y el "Libre" por cancha sigue visible. El desempate es un bug de hoy: va en la 0c |
| **H11** Suspender es frecuente | **No concluyente** | 0 avisos de suspensión entre 64 notificaciones en total. El canal casi no se usa y las suspensiones se avisan por WhatsApp | Suspender no sube a la iter 2. La iter 4 pasa a backlog condicionado (editar también es raro: `UPDATE_EVENT`, 10 en toda la historia). Hay que preguntarle al organizador cuántas veces suspendió |
| **H12** Dónde gasta el organizador | **Refutada** (con un proxy: H12 no se corrió tal cual) | Con el QN por acción y las exclusiones del SQL (sin `REGISTER_GUEST` ni `AUTO_*`), el top 3 por partido es `CREATE_COURT` 1,93 (a), `CANCEL_REGISTRATION` 1,58 (b) y `MOVE_REGISTRATION` 1,35 (c). Por flujo: a 3,71 · b 2,60 · c 2,57 · d 0,95 | La rama "si domina b" pide bajas self-service y espera antes que todo: es la 0a, ya en prod. Después, el flujo más pesado es "a" (crear/compartir): Repetir va temprano (0d) |
| **Q0** Índice único | **Sin datos** | No se corrió | No bloquea: la 0a re-anota con un UPDATE y funciona con o sin índice. El índice parcial sigue pendiente de Q0 (a)-(c) |

### 9.3 Línea de base QN: escrituras del organizador por partido

Desde el 27/6, **60 partidos**. Actores con rol admin, super_admin, captain o gestion_eventos; no cuenta cuando se anotan o se bajan ellos mismos.

| Mediana | p75 | p90 | Máximo |
|---|---|---|---|
| **8** | 16,25 | 26 | 56 |

| Acción | Total | Por partido | Flujo (H12) |
|---|---|---|---|
| `CREATE_COURT` | 116 | 1,93 | a |
| `CANCEL_REGISTRATION` | 95 | 1,58 | b |
| `REGISTER_GUEST` | 87 | 1,45 | El SQL la excluye |
| `MOVE_REGISTRATION` | 81 | 1,35 | c |
| `FINALIZE_EVENT` | 57 | 0,95 | d |
| `CREATE_EVENT` | 57 | 0,95 | a |
| `OPEN_COURT` | 55 | 0,92 | c |
| `UPDATE_COURT` | 50 | 0,83 | a |
| `CLOSE_EVENT` | 39 | 0,65 | b |
| `REOPEN_EVENT` | 22 | 0,37 | b |
| `AUTO_CLOSE_COURT` | 22 | 0,37 | El SQL la excluye (automática) |
| `CLOSE_COURT` | 18 | 0,30 | c |

Agrupado por tarea (sobre ~11,7 de promedio, la suma de las 12 acciones):

| Tarea | Por partido | Peso |
|---|---|---|
| Armado (evento + canchas) | 2,88 | ~25% |
| Bajas de terceros + reaperturas manuales (`CANCEL_REGISTRATION` + `OPEN_COURT` + `REOPEN_EVENT`) | 2,87 | ~25% |
| Mover y ajustar cupos (`MOVE_REGISTRATION` + `UPDATE_COURT` + `CLOSE_COURT`) | 2,48 | ~21% |
| Cerrar y finalizar | 1,60 | ~14% |
| Invitados cargados por organizadores | 1,45 | ~12% |

Este agrupamiento no es el de H12: H12 pone `OPEN_COURT` en "c" y `CLOSE_EVENT` en "b". `AUTO_CLOSE_COURT` (0,37) no entra en ninguno.

**Es una base provisoria: no es la QN del archivo.**

1. Incluye `REGISTER_GUEST` y `AUTO_CLOSE_COURT`, que el SQL excluye (invitados propios del admin y efecto automático). Sin ellas quedan ~590 escrituras, ~9,8 de promedio por partido; la mediana sin ellas no se calculó.
2. "Organizador" se define por rol y no por permiso, con los roles de hoy. Solo admin y super_admin ya son 27 personas, y muchas juegan.
3. Deja afuera los partidos con 0 escrituras y mete partidos todavía no jugados (60 contra 55 jugados).
4. Los pesos están calculados sobre el promedio (~11,7), que tiran para arriba los partidos de 26 a 56, y no sobre el partido mediano (8).

**QN v2 (congelarla antes de medir la 0a):** exclusiones del SQL (sin `REGISTER_GUEST`, `AUTO_*`, `COURT_FULL` ni `PROMOTE_WAITLIST`), solo partidos jugados desde el 27/6, y contada por **acción** del organizador, no por fila del audit. Esto último es crítico: Repetir escribe `CREATE_EVENT` + un `CREATE_COURT` por cancha (`source='quick_repeat'`) y contado por filas daría ~2,6, casi lo mismo que hoy (2,88); la 3a escribe un `MOVE_REGISTRATION` por cambio + `SAVE_LINEUP`. Se reporta la mediana y la composición del partido mediano, abierta por franja y por "creador principal vs. otros admins".

**La meta no baja:** se mantiene **<5 tras la iter 2** (o −50% sobre la base v2) y **≤2 con serie**. Un ≤3 tras la iter 2 no sale de la cuenta: lo que la iter 2 no toca (mover y ajustar ~2,5 + invitados 1,45) ya suma ~4 de promedio.

### 9.4 Otros hallazgos

- **Canchas usadas para otra cosa** (6 meses, 91 partidos). Como **equipos** ("equipo blanco", "equipo negro", "equipo azul camiseta tt", "equipo rojo"…): 12 canchas en 5 partidos. Como **lista de espera** manual ("sala de espera", "suplentes", "suplentes | lista de espera", "cancha suplente - sujeta a disp"): 9 canchas en 9 partidos. Son entre 9 y 14 de 91 partidos (~10-15%), según se superpongan, y es un piso porque la búsqueda es por palabras. Métricas: 0 canchas nuevas tipo "espera"/"suplente" después de la 0a y la 0c; 0 con nombre de equipo después de la 3b-1.
- **`sort_order` repetido.** En 46 de 49 eventos con varias canchas, todas tienen el mismo `sort_order`: el formulario arranca siempre en 1 (`AdminPanel.jsx:1975` y `:1984`) y las consultas ordenan solo por `sort_order` (`events.py:329`, `admin_events.py:1216`). El orden del carrusel no está definido entre recargas, y un "Me anoto" de 1 toque asignaría al azar. Bug de hoy: va en la 0c.
- **3 franjas fijas.** Mar 19:00, Jue 19:00 y Mar 20:00 concentran 77 de 91 partidos (85%); hay 16 semanas con 3 partidos y 9 con 4. Lead time mediano entre crear y jugar: 113,8 h (~4,7 días). Mar 19 tiene títulos tipo "Escuelita martes" / "La escuelita de APE" y nadie va a ≥75%: puede ser otro uso (una clase), así que Repetir, la serie y "Faltan N" no tienen que asumir un grupo fijo ahí.
- **Una persona crea el 65% de los partidos** (90 de 138; los siguientes crearon 12, 10, 7, 7, 6, 4, 1 y 1). En total, 9 personas crearon eventos.
- **27 admins.** 16 con rol admin y 11 super_admin, contra 105 jugadores en 3 meses y 9 creadores de eventos. Inflan el QN y ven controles de gestión que no usan: conviene que el organizador revise los roles, y en QN v2 separar al creador principal.
- **`create_court`** no promueve a la espera (ver H5) y arma la metadata del audit con un f-string (`admin_events.py:753`): un nombre de cancha con comillas rompe el `CAST` a jsonb y da 500. Los dos arreglos van en la 0c.
- **Externos.** `REGISTER_EXTERNAL` (`events_public.py:346`, actor NULL) no figura en el inventario: con `actor_user_id` NOT NULL en prod, las altas de externos daban 500 hasta la 020 (`f06113b`). Hipótesis: parte de los `REGISTER_GUEST` de organizadores (1,45 por partido) eran personas sin cuenta. Medir `REGISTER_EXTERNAL` >0 después de la 020.
- **La espera casi no existía:** `PROMOTE_WAITLIST` tiene 7 filas en toda la historia, contra 185 `OPEN_COURT` manuales.

### 9.5 Consultas que faltan (solo lectura)

Antes de la 0c, la 0d y la 3b-1:

- **H6(b):** ráfagas de armado (`OPEN_COURT > MOVE > CLOSE_COURT` del mismo actor).
- **Agrupamiento de `CREATE_EVENT`:** pares del mismo actor con <30 min de diferencia, por franja y desde el 27/6 (quién crea, qué día y a qué hora). Decide "Repetir las 3".
- **Limpieza post-partido:** escrituras entre `starts_at` y `FINALIZE_EVENT` (moves, bajas, canchas nuevas). Decide si auto-finalizar a +150 min necesita permitir correcciones después.
- **% de votos por tramo de demora** de la finalización (<6 h, 6-24 h, 24-48 h, >48 h): base de la 0c.
- **`UPDATE_COURT` por campo** (nombre o cupo) y por momento (armado o días después).
- **H3 por semana**, solo partidos jugados y separando la Escuelita; **H10 por posición** sin pseudo-canchas; **H5 por capacidad** (confirmados ≥ suma de cupos de las canchas reales) y cuántos eventos tenían `allow_external_registration`.
- **Títulos que contienen fechas** y **Q0** (a)-(c).

### 9.5b LIMPIEZA: ¿se corrige el roster después del partido? (corrida el 17/10, después de deployar la 0c)

Consulta LIMPIEZA de `consultas-comportamiento.sql` sobre los 86 partidos finalizados de los últimos 6 meses, más un detalle por tramo y por acción.

- **14 partidos (16,3%)** tuvieron alguna escritura de roster después del inicio. **13 (15,1%)** la tuvieron después de inicio + 150 min: pasa el umbral de 10%, así que **no** se prende directo con 150.
- Fueron 42 escrituras: 0 moves, 24 altas propias (`REGISTER_USER`), 12 bajas (11 cargadas por otro), 4 `CLOSE_COURT`, 1 invitado y 1 cancha nueva. Mediana de la última escritura: 20 h después del inicio; p90: ~56 h. Mediana de finalización: ~26 h. Ningún partido se reabrió después de finalizarse.
- **Por tramo:** 2,5–6 h → 6 escrituras en 5 partidos (casi todas a ~3 h: altas o bajas propias); 6–24 h → 3 en 3; 24–72 h → 22 en 5; más de 72 h → 11 en 1.
- **Dos partidos explican 29 de las 42:** el martes 23/6 20 h (18 escrituras a 43–44 h) y el domingo 7/6 (11 a 26–30 días, con una cancha nueva). Son reorganizaciones fuera de lo normal, no limpieza post-partido.
- Los 4 `CLOSE_COURT` son orden antes de finalizar a mano; con auto-finalizar dejan de hacer falta.
- **Desde el 27/6:** 5 partidos con escrituras después de 150 min, una cada uno: 3 a ~3 h (altas o bajas), 1 alta a 38 h y 1 `CLOSE_COURT` a 38 h.

**Lectura.** La regla del SQL dice: si se confirma y el p90 pasa las 24 h, es un arreglo tardío y no limpieza → prender igual con 150 y corregir con "Reactivar". Los datos agregan un matiz: hay un grupo chico de correcciones a ~3 h (gente que se anota o se baja apenas termina el partido). Con **240 min (4 h)** se cubren esas y los votos igual se abren la misma noche (un partido de las 19 h se finaliza a las 23 h, contra ~38 h de hoy). Lo que queda después de las 4 h, desde el 27/6, es 1 corrección real en ~57 partidos: se resuelve con "Reactivar".

**Recomendación:** `AUTO_FINALIZE_ENABLED=true` y `AUTO_FINALIZE_AFTER_MINUTES=240` en Railway. A las 2 semanas medir: % de `FINALIZE_EVENT` con `source='auto'`, cuántos `REOPEN_EVENT` sobre finalizados (hoy 0) y el % que vota entre los que tienen opt-in (hoy 32%). Si las reaperturas pasan de 1 por semana, subir a 360. Todo esto es de antes de la 0a: con bajas propias, el patrón post-partido puede cambiar.

### 9.6 Cuidado al leer

- **Todo es de antes de la 0a.** Se deployó el 17/10 y ese mismo día hubo un fix por 500 en prod (la 020). Todavía no hay evidencia de que la espera funcione ni de que los jugadores usen la baja propia, y el gate de la 0a (una semana sin 500 ni 403 en bajas) no se cumplió. Nada de "lo arregla la 0a" hasta medirlo en 1-2 semanas. Verificar `is_nullable = YES` en prod.
- **H4:** el 71% de bajas hechas por otro es estructural (el 403). La anticipación mide cuándo el admin **cargó** la baja, no cuándo avisó el jugador, y parte de las bajas >24 h pueden ser correcciones (gente anotada en el partido equivocado porque la Home abría el más lejano, C11). Los que faltan sin avisar no aparecen. El % self-service de la base hay que calcularlo solo sobre jugadores sin rol admin.
- **H5:** `AUTO_CLOSE_EVENT` no es "se llenó". También contaba canchas cerradas a mano, solo corría después de un alta (no de un move, una promoción o un cambio de cupo) y una pseudo-cancha abierta lo impedía: el 42% es un piso ruidoso y el 58% "nunca se llenó" está inflado. Las 73 reaperturas son en buena parte mecánicas (la baja no reabría ni promovía) o del workaround de mover: miden la fricción del auto-cierre más que la demanda. Desde la 0a no hay `AUTO_CLOSE_EVENT`: el llenado se mide con `COURT_FULL` o por capacidad.
- **H7:** "Finalizar" solo aparece con el evento CLOSED, y una vez finalizado no se puede mover a nadie. Como los votos son por cancha, el atraso puede ser a propósito (corregir quién jugó dónde antes de archivar). No está medido que el atraso baje la tasa de voto.
- **H1:** los 5-9 lugares por franja ya están normalizados y mezclan otros predios ("poli cramer" y variantes, "terrazas futbol", "cancha 4"): no es "Pedraza mal escrito". "el poli" puede ser Pedraza o Cramer. Los 17-24 títulos distintos por franja pueden ser a propósito (emojis, "Escuelita") o llevar la fecha. Además, el resto de franjas listado suma 10, así que el desglose cubre 87 de 91 partidos.
- **H2:** los 0,6 min son el lapso entre la primera y la última escritura, no el tiempo de armado: el formulario, los toques y el tipeo no quedan en el audit. Las 3 canchas en eventos ya jugados pueden ser cargas retroactivas legítimas.
- **Pseudo-canchas** (equipos, suplentes) contaminan H1 (cantidad de canchas y cupo), H5, H6, H8 y H10: en las próximas corridas se marcan o se excluyen.
- **H8:** `ranking_opt_in` es el valor de hoy, y el denominador del 32% incluye a gente sin nadie a quien votar en su cancha. No hay que atribuirle todo el no-voto al costo de votar.
- **Dónde elegimos la lectura más conservadora** (el análisis decía otra cosa): H6, H8, H10 y H11 quedan como no concluyentes o no evaluables en vez de refutadas; H7 queda confirmada en parte; H5 se marca como débil; los parches son ~10-15% y no 15%; la meta del QN se mantiene en <5 tras la iter 2 en vez de bajarla a ≤3; la 0c no prende el flag hasta medir la limpieza post-partido; y la iter 4 queda en backlog, pero se le pregunta al organizador antes de descartarla.

---

## 10. Hipótesis a validar con datos de producción

Las consultas (todas de solo lectura, con zona horaria `America/Argentina/Buenos_Aires`) están en **`docs/ux/consultas-comportamiento.sql`**, con el mismo id de cada fila (Q0, H1-H12, Q-N y el control de altas accidentales). Las corre el organizador en la consola Postgres de Railway y nos pega los resultados. **Se corrieron el 17/10/2026 en Supabase:** el detalle está en la sección 9 y el resumen, en la columna "Estado (17/10)".

| H | Hipótesis | Confirma si… | Si se refuta, cambia… | Estado (17/10) |
|---|---|---|---|---|
| Q0 | Puede haber un índice único no parcial en `(event_id,user_id)` | Aparece en `pg_indexes` | Define si va el índice parcial o el reemplazo (0a) | **Sin datos:** no se corrió |
| H1 | El partido semanal se repite igual (día, hora, lugar, canchas) | ≥70% de los eventos caen en ≤2 combinaciones | Si no, `/crear` pasa a ser el camino principal y la serie no se construye | **Confirmada en parte:** 3 franjas = 85% por día + hora, pero ≤2 combinaciones = 57%, y lugar y canchas varían |
| H2 | Armar cuesta escrituras y genera errores (cancha en el evento equivocado) | Mediana >5 escrituras o >3 min de setup; `CREATE_COURT` sobre eventos ya jugados >0 | Si el setup ya es corto, Repetir baja de prioridad frente a la iter 3 | **Confirmada en parte:** errores sí (3 canchas en eventos jugados); costo no (mediana 2 escrituras, 0,6 min) |
| H3 | Hay un núcleo de fijos | ≥50% de la capacidad son personas que se anotan en <60 min en ≥75% de las semanas | Habilita fijos auto-confirmados (serie v2). Si no, la serie solo publica | **Refutada:** fijos según el SQL, 0, 1 y 0 por franja |
| H4 | Las bajas existen y hoy pasan por el admin; muchas son tardías | Bajas con actor ≠ target >0; >30% a menos de 24 h | Si hay muchas tardías, "Liberar y avisar al grupo" y el aviso de promoción se adelantan | **Confirmada:** 35% a <24 h; el 71% hecho por otro es efecto del 403 |
| H5 | Las canchas se llenan rápido y hay demanda insatisfecha | Tiempo de `CREATE_EVENT` a `AUTO_CLOSE_EVENT` <48 h; aparecen `OPEN_COURT` / `REOPEN_EVENT` manuales | Si nunca se llena, se prioriza compartir (lugares por cancha) sobre la espera | **Confirmada en parte**, por poco: 45,9 h sobre el 42% que se auto-cerró; 73 reaperturas en 20 partidos |
| H6 | Armar equipos hoy son ráfagas de moves | Mediana ≥3 moves por partido, o secuencias OPEN_COURT > MOVE > CLOSE_COURT | Si hay pocos moves, los equipos se arman afuera de la app: 3b va antes que 3a | **No concluyente:** (a) se refuta, 43 de 55 sin moves; (b) no se corrió |
| H7 | Los partidos se finalizan tarde o nunca, y se pierden votos | Mediana `finalized_at − starts_at` >24 h o eventos colgados >0 | Si ya se finalizan rápido, auto-finalize baja a la iter 4 | **Confirmada en parte:** mediana 37,9 h y 0 colgados; que se pierdan votos no está medido |
| H8 | Pocos votan por el opt-in, no por el costo | % con opt-in <50% entre participantes | Si el opt-in es alto pero votan poco, el foco es el lote + "No lo vi"; si es bajo, la card inline va arriba | **No concluyente:** 61% por participación (refuta), 45% por jugador (confirmaría) |
| H9 | Los invitados se repiten y el límite real es menor a 5 | ≥30% de los nombres de invitados se repiten en ≥2 semanas; p95 de invitados por persona ≤5 | Define si hay chips recientes y el valor de `GUEST_LIMIT` | **Refutada:** 9% se repite; p95 3 |
| H10 | La gente elige cancha a propósito | ≥40% de los jugadores con ≥4 partidos repiten la misma cancha ≥80% de las veces | Se asigna "tu cancha de siempre" en vez de la primera libre, y "elegir cancha" queda más visible | **No evaluable:** por nombre, 0 de 75; por posición no se puede (`sort_order` repetido en 46 de 49) |
| H11 | Suspender es frecuente | ≥1 aviso de suspensión por mes | Suspender pasa a la iter 2 | **No concluyente:** 0 de 64 avisos, pero el canal casi no se usa |
| H12 / Q-N | Dónde gasta escrituras el organizador | El top 3 de acciones por partido coincide con a/c/d | Reordena el roadmap | H12 **refutada** con un proxy ("b" entra en el top 3). QN: base provisoria, mediana 8 (ver 9.3) |

Cuidados al leer los resultados:

- Antes del 2026-06-27 el actor del audit era falsificable: las consultas de actor (H4, Q-N) traen un filtro opcional desde esa fecha.
- H8 usa el `ranking_opt_in` actual, no el histórico.
- H11 busca "suspend" o "lluvia" en avisos globales: es un proxy, no un conteo exacto.

---

## 11. Pendientes y próximos pasos

| # | Paso | Quién | Resultado esperado |
|---|---|---|---|
| 1 | Correr `docs/ux/consultas-comportamiento.sql` en la consola Postgres de Railway (solo lectura) | Organizador | Resultados de Q0, H1-H12 y Q-N pegados en la conversación |
| 2 | Actualizar la tabla de hipótesis (sección 10) con confirmada / refutada y el número que lo decidió | Nosotros | Columna nueva "Resultado" en la tabla |
| 3 | Reordenar el roadmap (sección 8.4) según los datos: H11 → Suspender a la iter 2; H6 → orden 3a/3b; H1 → serie sí o no; H7 → auto-finalize en la 2 o la 4 | Nosotros | Roadmap y prototipo alineados |
| 4 | Resolver Q0 (índice único en `event_registrations`) | Nosotros, con el resultado de Q0 | Decisión: índice parcial nuevo o reemplazo en fase contract |
| 5 | Escribir el plan de la **iteración 0a** (hotfix de bajas, espera, CSS de raíz y Home al próximo partido) con el mismo formato que `docs/event-access-iteracion-0-1-plan.md` | Nosotros | Plan aprobado antes de tocar código |
| 6 | Arrancar la iteración 0a | Nosotros | Métricas de la fila 0a de la sección 8.4 |

Pendientes abiertos:

- La tabla de toques (sección 5.1) y el prototipo clickeable tienen que seguir coincidiendo número por número: si los datos cambian un flujo, se actualizan los dos.
- El copy de la sección 7 está pensado para un grupo que habla en masculino genérico; cada momento trae una variante neutra para cuando haga falta.
- Extra detectado en la verificación, fuera del alcance de este rediseño pero barato de arreglar en 0a: la media estrella de votos manda 0,5 y el backend la rechaza (`RatingsPending.jsx:79` vs `app/schemas.py:173`).
