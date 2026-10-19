# Plan — Iteración 0b (hojas, diálogos, menús y avisos en una sola primitiva)

> **Estado (18/10/2026):** implementado, verificado en local y **en producción** (push `9e5843b..4e82fe3`, verificación en `estado.md`). Abajo el plan aprobado tal cual; al final,
> las desviaciones y cómo se verificó.


## Contexto

`docs/ux/rediseno-ux.md` §6, §8.2 (0b: solo frontend, sin migración ni flags) y §8.4 fila 0b. La 0a ya sacó el
`transform` de `.page-enter`, que era la causa raíz de los menús corridos. Lo que queda, verificado en el código:

- **4 sistemas de overlay:**
  - el `Modal` de `AdminPanel.jsx:74`;
  - `.bottom-sheet-*` de `index.css:124`, que usan `BottomSheet` (`App.jsx:508`), `ConfirmSheet`,
    `CalendarItemSheet` y `AdminCreateMenu`;
  - overlays ad hoc `fixed inset-0` en `AdminAnnouncementForm`, `CreateTournamentModal`, `MatchResultModal` y el
    confirm de `TournamentControlCenter`;
  - 3 toasts distintos (Admin abajo, Profile y Votos arriba, App en línea arriba).
- **Ninguno usa portal**, ni bloqueo de scroll, foco o `role` (salvo `ConfirmSheet`). Hay `max-h-[90vh]` y 3 sin
  `max-h`.
- **El CTA vive al final de un cuerpo que scrollea.** En los 7 formularios del Panel no hay botón "Cancelar".
- **Tocar el fondo borra lo cargado** en todos los formularios menos Repetir (`dismissOnBackdrop` solo ahí).
  `CreateTournamentModal` limpia el form *antes* de que responda la API.
- **8 diálogos nativos** (`confirm` / `prompt` / `alert`).
- **Código muerto:** `LegacyTournamentsAdminTab.jsx` no lo importa nadie.

Meta de la iteración: cero overlays fuera de la primitiva, el botón principal siempre a la vista (Pixel 7 y iPhone 14) y
una guarda para que no vuelva.

## Decisiones (con el usuario, 17/10)

- **Diálogos nativos:** los 8 pasan a la primitiva. La guarda prohíbe `confirm` / `alert` / `prompt`.
- **Atrás de Android (`?sheet=`) y deslizar para cerrar:** van con la **1a**. Queda anotado en `estado.md`.
- **`LegacyTournamentsAdminTab.jsx`:** se borra. `TournamentLive.jsx` también está muerto, pero no tiene overlays: no
  se toca.
- **WebKit de Playwright:** se descarga (`npx playwright install webkit`).
- **Defaults míos:**
  - Se trabaja en este checkout (`main`), con commits locales solo de mis archivos y **sin push**.
  - No hay `Menu` popover de escritorio: hoy no existe ningún dropdown propio (solo `<select>` nativos).
  - No va `interactive-widget=resizes-content` (subiría la barra inferior arriba del teclado en Android). El teclado
    se maneja con `visualViewport` → `--kb-inset`, que anda en iOS y Android.

## 1. Primitivas — `futbol-mvp-web/src/design/ui/overlay/` (sin dependencias nuevas)

| Archivo | Qué hace |
|---|---|
| `stack.js` | Pila de overlays a nivel de módulo: `push(layer)` / `remove(id)`. Con ≥1 capa modal: `#root.inert = true` + `aria-hidden`, y las capas de abajo también inertes. Bloqueo de scroll con **contador**: `body{position:fixed; top:-scrollY; left:0; right:0}` y al llegar a 0 restaura y hace `scrollTo`. Un solo listener de `keydown` que manda Esc y Tab solo a la capa de arriba. Expone `useOverlayDepth()` (para el Toaster) |
| `Layer.jsx` (interno) | `createPortal` a `#overlay-root`, backdrop, registro en la pila, foco inicial, trampa de Tab, devolución del foco al elemento que lo tenía (si sigue en el DOM), animación de entrada (fade + subida; con `prefers-reduced-motion`, solo fade, usando `motion.ts`) |
| `Sheet.jsx` | `<Sheet open onClose title subtitle footer size="auto\|full" width="md\|lg" dismiss="auto\|guarded\|locked" dirty busy testId closeTestId>` |
| `Sheet.jsx` | `<SheetFooter>`: hace portal al slot del footer, así un formulario hijo pone su botón abajo sin subir el estado. El botón usa `form={id}` |
| `Sheet.jsx` | `useSheetDirty(bool)`: el formulario hijo avisa que tiene cambios |
| `Dialog.jsx` | `<Dialog open tone="default\|danger" title confirmLabel cancelLabel busy onConfirm onCancel confirmTestId cancelTestId>`. `role="alertdialog"`. El foco va a la acción segura. Botones apilados si un label pasa de 16 caracteres (§7.0). `children` admite un campo (el motivo de rechazo) |
| `ActionSheet.jsx` | `<ActionSheet open onClose title description items=[{label, hint, tone, onSelect, disabled, testId}]>` con `role="menu"` / `menuitem` y "Cancelar" |
| `toast.js` + `Toaster.jsx` | `toast({title, text, kind, action, duration=4000})` → id; `toast.dismiss(id)`. Store con `useSyncExternalStore`, máximo 3. Región `aria-live` siempre montada (`assertive` para error). Se monta una vez en `main.jsx`. Va **encima de la barra** (`bottom: var(--toast-bottom)`). Con una hoja abierta pasa **arriba** (`top: safe-area + 8px`) para no tapar el footer. Nunca queda inerte |
| `useKeyboardInset.js` | `visualViewport` → `--kb-inset` mientras hay una hoja abierta. `focusin` dentro del cuerpo → `scrollIntoView({block:'nearest'})` después del teclado |
| `overlay.css` | Layout: grid header / body / footer. `max-height: calc(100dvh - var(--kb-inset) - env(safe-area-inset-top) - 12px)` con `@supports not (height:100dvh)` → `100vh`. Body `overflow-y:auto; overscroll-behavior:contain`. Footer `padding-bottom: max(16px, env(safe-area-inset-bottom))`. Desde 640px, diálogo centrado (`max-w-lg`, o `2xl` con `width="lg"`) con `85dvh`. `size="full"` = `100dvh` |
| `index.js` | Exports |

**Reglas de cierre (§6.2.6):**
- `auto`: cierra con el fondo, con Esc y con la cruz.
- `guarded`: con cambios, el fondo no cierra. Esc o la cruz muestran en línea "¿Descartás los cambios?" con
  **[Seguir editando] [Descartar]**, y el foco va a "Seguir editando". Sin cambios, cierra.
- `locked`, o `busy`: no cierra con nada, y la cruz queda deshabilitada.

**Accesibilidad:**
- `role="dialog"`, `aria-modal` y `aria-labelledby` (el id sale de `useId`).
- El foco inicial va al título (`tabIndex=-1`), así no salta el teclado en iOS.
- La cruz lleva `aria-label="Cerrar"`. Los botones miden ≥44px y usan `text-base`.

**Montaje:**
- `index.html` suma `<div id="overlay-root"></div>` hermano de `#root`.
- `Layer` lo crea si falta, para los tests.
- Los eventos sintéticos de React dentro del portal se cortan en la raíz de la capa, para que un clic adentro no
  burbujee a handlers de `#root` por el árbol de React.

## 2. Tokens, shell y `cn`

- **`tokens.css`:** `--z-sticky:20 --z-tabbar:30 --z-fab:35 --z-sheet:50 --z-dialog:60 --z-menu:65 --z-toast:70`.
  Suma `--tabbar-h` (el alto real de la barra; lo mido en el navegador), `--kb-inset:0px` y `--toast-bottom`.
  `:root[data-tabbar]` lo sube a `calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px)`.
- **`tailwind.config.js`:** `extend.zIndex` con esos tokens (`z-tabbar`, `z-sheet`, …).
- **`BottomNav`:**
  - pasa a `z-tabbar` (era z-40);
  - marca `data-tabbar` en `<html>` mientras está montada, así en el login y en las páginas públicas los toasts quedan
    abajo de todo;
  - `AppShell` usa `--tabbar-h` en su `padding-bottom`.
- **FAB:** pasa a `src/shell/Fab.jsx` (`z-fab`, `bottom: calc(var(--tabbar-h) + safe-area + 1rem)`). El Calendario lo
  usa.
- **`TournamentHeaderHero`:** `z-20` → `z-sticky`.
- **`cn` unificado:** `App`, `Profile` y `RatingsPending` importan de `design/cn.js`. `calendar/api.js` y
  `audit/api.js` lo re-exportan.
- **CSS que se borra:** `.bottom-sheet-overlay` / `.bottom-sheet-panel` de `index.css`, y `ConfirmSheet.jsx`, que
  reemplaza `Dialog`.

## 3. Migración (todos los overlays)

| Dónde | Hoy | Pasa a |
|---|---|---|
| `AdminPanel.jsx` · Crear Evento, Editar Evento, Crear Cancha, Editar Cancha, Crear Usuario, Reset PIN, Editar Roles | `Modal` (cierra con el fondo) | `Sheet dismiss="guarded" busy={busy}`. Cada form usa `useSheetDirty` (estado contra el inicial) y lleva el submit en `SheetFooter` con `form={id}`. Se mantienen los testids, incluido `admin-modal-close-btn` vía `closeTestId`. `CreateCourtForm`: se saca el `useEffect` que pisaba lo tipeado y se reemplaza por `key` |
| `AdminPanel.jsx` · Repetir (0d) | `Modal dismissOnBackdrop={!!created}` | `Sheet`: `guarded` en el paso del form, `auto` en el paso Compartir. "Crear y compartir" y "Listo" en el footer. El Enter sigue sin enviar |
| `AdminPanel.jsx` · `confirmModal` (cerrar o reabrir o finalizar evento, cerrar o borrar cancha) y desactivar aviso (`NotificationsTab`) | `Modal` con botones | `Dialog tone="danger"` (`admin-confirm-modal-confirm-btn` se mantiene) |
| `AdminPanel.jsx` · rechazar cuenta (`confirm` + `prompt`), borrar anuncio (`confirm`), PIN inválido (`alert`) | Nativos | `Dialog` con un `<textarea>` opcional "Motivo interno"; `Dialog`; error en línea en el form |
| `AdminPanel.jsx` · toast | `fixed` z-50 dentro de `.page-enter` | `toast()`. Se sacan el estado y el efecto; el prop `setToast` de los hijos queda como `(msg) => toast({title: msg})` |
| `App.jsx` · `PlayerCardModal` | `BottomSheet` | `Sheet dismiss="auto"`: el avatar y el nombre como título, el chip como `subtitle` |
| `App.jsx` · confirmar baja | `ConfirmSheet` | `Dialog` (mismo copy y testids `confirm-sheet-*`) |
| `App.jsx` · "¿Estás seguro de anotarte?" | `BottomSheet` | `Dialog` (copy igual; la 1a lo reemplaza por Deshacer) |
| `App.jsx` · toast en línea arriba | `Banner` + estado | `toast()`. Los errores siguen en el `Banner` en línea |
| `Profile.jsx` / `RatingsPending.jsx` | `Toast` `fixed top-4` + estado | `toast()`. El "Cerrar sesión" pasa a `Dialog` |
| `calendar/CalendarItemSheet.jsx` | `.bottom-sheet-*` + `confirm` + `alert` | `Sheet auto` con las acciones en el footer. "¿Liberás tu lugar?" va en un `Dialog` apilado (copy de §7.2). El error va en un `toast` de error |
| `calendar/AdminCreateMenu.jsx` | `.bottom-sheet-*` | `ActionSheet` |
| `calendar/AdminAnnouncementForm.jsx` (Calendario y Gestión) | `fixed` sin `max-h` | `Sheet guarded`, con "Cancelar" + "Crear anuncio" en el footer y el error adentro |
| `calendar/Calendar.jsx` · FAB | `fixed` z-30 | `<Fab>` del shell |
| `tournaments/admin/CreateTournamentModal.jsx` | `fixed` sin `max-h`; limpia antes de la API | `Sheet guarded`. El estado vive adentro de la hoja: se descarta al cerrar y se conserva si falla. El error de TCC se muestra adentro |
| `tournaments/admin/MatchResultModal.jsx` | `fixed`, cierra aunque esté `busy` | `Sheet guarded busy`, con dirty contra el resultado inicial y Guardar/Finalizar en el footer. Se mantienen los testids `result-*` |
| `TournamentControlCenter.jsx` · borrar torneo | `fixed` | `Dialog danger` (`tournament-confirm-delete-btn`) |
| `admin/RolesPermisosTab.jsx` · borrar rol | `confirm` | `Dialog danger` |
| `features/events/public/ExternalParticipationPage.jsx` (pública) | `confirm` | `Dialog` |
| `LegacyTournamentsAdminTab.jsx` | Código muerto | Se borra |

## 4. Guarda — `futbol-mvp-web/scripts/check-overlays.mjs`

- **Qué recorre:** `src/**/*.{js,jsx,ts,tsx,css}`, sin comentarios.
- **Qué hace fallar:**
  - la clase `fixed` o `position: fixed` fuera de `src/shell/` y `src/design/ui/overlay/`;
  - `window.confirm|alert|prompt` y `confirm(` / `alert(` / `prompt(` sueltos (excepto `deferredPrompt.prompt()`).
- **Scripts de npm:**
  - `"check:overlays"`;
  - `"lint": "node ./scripts/check-overlays.mjs && eslint ."`.
  - No va en el `build`, para no frenar un deploy de Railway.

## 5. Tests

- **`playwright.config.ts`:**
  - Se suma el proyecto `iphone-14` (`devices["iPhone 14"]`, WebKit), con `testMatch` limitado a
    `overlays.spec.ts` y `accessibility-smoke.spec.ts`. Los flujos con capturas siguen solo en Chromium (su manifest
    pide esos dos proyectos).
  - `e2e:install` → `chromium webkit`; se suma `e2e:overlays`.
- **`scripts/e2e_seed_admin.py`** (raíz):
  - crea o actualiza un admin con PIN y `status` activo, con el mismo hash que `app/utils/security.py`;
  - toma teléfono y PIN de `E2E_ADMIN_PHONE` / `E2E_ADMIN_PIN` (valores de prueba documentados en el script);
  - **se niega** si `DATABASE_URL` no es 127.0.0.1 o localhost.
- **`e2e/overlays.spec.ts`:**
  - Login por UI. Datos sembrados por API con el token de `localStorage`: evento con 2 canchas, el admin anotado,
    otro jugador, un anuncio, un aviso y un torneo con fixture (si la API lo permite).
  - **Una tabla de casos:**
    - Gestión: crear, editar y repetir evento; crear y editar cancha; confirm de cerrar; usuarios (crear, PIN,
      roles); rechazar cuenta; desactivar aviso; anuncio; crear torneo; resultado; borrar torneo; borrar rol.
    - Calendario: FAB → ActionSheet, hoja del ítem → "¿Liberás tu lugar?" apilado, y anuncio.
    - Partido: tarjeta del jugador, "¿Estás seguro de anotarte?" y baja.
    - Perfil: cerrar sesión.
  - **Por caso:**
    1. scrollear al fondo;
    2. abrir sin scrollear (`el.click()` en `evaluate`);
    3. el `boundingBox` del botón principal queda dentro del viewport;
    4. `#root` inerte y el scroll del fondo quieto;
    5. axe sobre `#overlay-root` sin violaciones `serious` ni `critical`;
    6. Esc cierra (o pregunta) y el foco vuelve al disparador.
  - **Casos extra:**
    - guarded: tipear, tocar el fondo (sigue abierta), Esc ("¿Descartás los cambios?") y después "Seguir editando" o
      "Descartar";
    - toast: queda arriba de la barra (`bottom ≤ top` de la `nav`);
    - `.page-enter`: el `transform` computado es `none` a los 300 ms (§6.2.15).
- **Vitest:** `toast.test.js` (store: máximo, dismiss, duración) y `check-overlays.test.js` (la guarda detecta y
  permite lo que tiene que detectar y permitir), sin dependencias nuevas.

## 6. Verificación

1. Levantar el entorno local:
   - `.claude/launch.json` suma `canchas-api-0b` (:8778, contra `futbol_test`) y `canchas-web-0b` (:5186). No se
     commitea.
   - Correr `scripts/e2e_seed_admin.py`.
2. `npm run lint`: la guarda en verde y eslint sin errores nuevos (hoy hay 9 anteriores).
3. `npm run build` y `npm test`.
4. `npx playwright install webkit` y después `npm run e2e:overlays` en `mobile-chrome` y `iphone-14`. Además
   `e2e:a11y` y `events-flow` + `tournaments-flow` en Chromium (regresión de testids).
5. A mano, en el panel del navegador a **375×812**:
   - cada hoja después de scrollear;
   - un formulario largo con el CTA abajo;
   - guarded;
   - hojas apiladas (ítem del Calendario → liberar);
   - toast encima de la barra, y arriba con una hoja abierta;
   - foco y Esc;
   - consola sin errores.
   - Captura como prueba.
6. **Revisión independiente** del diff (un agente aparte: bugs, mobile y a11y). Se arreglan los hallazgos y se
   vuelven a correr 2-4.
7. **No verificable acá:** el teclado real de iOS (`--kb-inset`). Queda como prueba para el organizador en un iPhone.

## 7. Entrega

- `docs/ux/iteracion-0b-plan.md`: este plan, en el repo.
- `docs/ux/estado.md`:
  - la 0b como hecha en local, sin push;
  - qué cambió;
  - cómo se verificó;
  - el pendiente de iPhone real;
  - atrás y deslizar → 1a;
  - Playwright WebKit sale de deudas.
- `rediseno-ux.md` §8.4: nota corta de estado.
- **Commits locales en `main`**, solo con mis archivos (`git add` por ruta):
  1. primitivas + migración + guarda + tests;
  2. docs.
- **Sin push:** Railway deploya `main`.
- Nota de entrega en la carpeta compartida: `iteracion-0b.md`.

## Fuera de alcance

- `?sheet=` y el atrás de Android, y deslizar para cerrar (van en la 1a).
- `Menu` popover de escritorio.
- El copy nuevo de anotarse (1a).
- Rehacer los formularios o las pantallas.
- `TournamentLive.jsx`.
- Correr Playwright en un CI, porque no existe; queda como script de npm.

## Desviaciones del plan (las encontraron los tests)

- **Botón de peligro en `rose-600`** (era `rose-500`): el texto blanco sobre `rose-500` no llega al contraste AA (axe).
- **El foco vuelve al último control tocado** (`getReturnFocusTarget` en `stack.js`): Safari no enfoca un botón al
  tocarlo. Sin esto, al cerrar "¿Liberás tu lugar?" el foco quedaba en el título de la hoja y no en el botón.
- **`useSheetBusy`** además de `useSheetDirty`: los formularios con su propio request (anuncio) bloquean la hoja mientras
  guardan.
- **Labels asociados y contraste** en los formularios migrados (`htmlFor`/`id` y `text-white/40` → `/60`), porque axe
  sobre `#overlay-root` los marcaba como serios.
- **Los toasts pasan arriba** con una hoja abierta (estaba en el plan como opción; quedó así).
- **`e2e/tournaments-flow.spec.ts`**: ahora abre la hoja de "Crear torneo" antes de llenarla y usa una fecha válida
  para `datetime-local`. Igual sigue fallando más adelante por un testid duplicado (`tournament-save-config-btn`), que
  ya estaba antes de la 0b.
- **El Calendario no desmonta la lista al refrescar**: "Cargando" solo sin datos (o al cambiar de pestaña). Si no, el
  foco no podía volver al ítem después de liberar el lugar.

## Revisión independiente (10 hallazgos)

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 1 | Los errores del Panel con una hoja o un diálogo abiertos iban al Banner, que queda debajo (inerte) | `showOverlayError`: el error también va en un toast de error (arriba, `role="alert"`, 6 s) |
| 2 | Cerrar la hoja y su diálogo en el mismo commit dejaba el foco en el body | El foco se devuelve en un microtask, al primer destino que sigue en pantalla; una capa que se abre en el mismo commit hereda el destino. Test nuevo |
| 3 | `events-flow` tocaba la cruz deshabilitada mientras guarda | Espera a que la hoja se cierre |
| 4 | `Dialog` no subía con el teclado; centrado (≥640px) lo tapaba el teclado del iPad | `useKeyboardInset` en `Layer` (todas las capas) y `padding-bottom` con `--kb-inset` desde 640px |
| 5 | Toast verde con contraste 3,8:1 y botones de 28-32px | `emerald-700`/`rose-700`, sin opacidad, botones de 44px |
| 6 | "Seguir editando" y el paso a "Compartí el partido" perdían el foco | Vuelve al campo de antes; un título nuevo recibe el foco |
| 7 | La guarda tomaba el `/*` de `accept="image/*"` como comentario y salteaba código | Quita comentarios sin mirar adentro de strings. Test nuevo |
| 8 | El `busy` compartido del Panel bloquea la hoja durante cargas (p. ej. `?create=1`) | **Pendiente** (bajo): un `submitting` propio de las hojas |
| 9 | El orden de la pila podía no coincidir con el visual (diálogo debajo de una hoja) | La pila se ordena por tipo (hoja < diálogo < menú) y después por orden de apertura |
| 10 | Atrás de Android con un formulario con cambios | Decidido: va con la 1a (`?sheet=`) |

## Verificación (18/10, base local `futbol_test`)

- **`e2e/overlays.spec.ts`: 9/9 en Pixel 7 (Chromium) y 9/9 en iPhone 14 (WebKit)**, tres corridas seguidas sin flakes.
  - 27 overlays: los 7 de Eventos, Usuarios (crear, PIN, roles), rechazar solicitud, desactivar aviso, anuncio
    (crear y borrar), borrar rol, Torneos (crear, borrar, resultado), Calendario (menú, anuncio desde el menú, ítem y
    "¿Liberás tu lugar?" apilado), Partido (baja, tarjeta del jugador, "¿Estás seguro de anotarte?") y Perfil
    (cerrar sesión).
  - Por cada uno: scrollea al fondo, abre sin mover la pantalla, el botón principal queda dentro de la pantalla
    (iPhone 14: 390×664), `#root` inerte y body bloqueado, axe sobre `#overlay-root` sin `serious` ni `critical`, Esc
    cierra y el foco vuelve.
  - Además: guarded (el fondo no cierra, Esc pregunta, seguir y descartar), apilado (Esc cierra solo el de arriba y la
    hoja de abajo queda inerte), cerrar dos capas juntas, toast encima de la barra (y arriba con una hoja abierta),
    `.page-enter` sin transform a los 300 ms.
- `npm test`: 15 tests (toast y guarda). `npm run lint`: la guarda en verde y eslint con 8 errores, todos anteriores
  (había 9: el de `CreateCourtForm` se fue con la migración). `npm run build` OK.
- Navegador a 375×812: Crear Evento después de scrollear (CTA en 748-796), guarded, FAB arriba de la barra con la
  página scrolleada, menú del Calendario, hoja del ítem con el diálogo apilado y Esc en cascada, toast "Bienvenido"
  encima de la barra. Consola sin errores en una sesión limpia.
- **Lo que no se pudo verificar acá:** el teclado real de iOS (`--kb-inset`). Playwright no simula el teclado.

## Fuera de la 0b, encontrado al probar

- `accessibility-smoke` › "tournaments admin view" ahora corre (antes se salteaba sin credenciales) y falla por la
  pantalla de Torneos, no por overlays: `role="tab"` sin `tablist` en `design/ui/Tabs`, inputs de configuración sin
  label y un scroller sin foco.
- `tournaments-flow`: testid duplicado `tournament-save-config-btn` (hero y configuración).
- `events-flow`: crea un evento el 13/03/2026; `GET /admin/events` trae los 50 más nuevos por fecha, así que en una
  base con muchos eventos no aparece en la lista. Hay que usar una fecha relativa.
- Los seeds de `overlays.spec.ts` no se borran: en `futbol_test` quedan eventos, anuncios, roles y torneos con sufijo
  `Overlays …`.
