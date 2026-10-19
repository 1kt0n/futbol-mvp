# Estado del rediseño UX

> Última actualización: **18/10/2026**. Este archivo es el punto de partida para retomar: qué está en producción, cómo se verificó, qué medir y qué sigue. El diseño completo está en [`rediseno-ux.md`](rediseno-ux.md); los datos de producción, en su sección 9.

Prototipo clickeable (privado, se comparte desde su menú *Share*): https://claude.ai/artifact/RwnySzAF5dwFW1i3vFZDky

## Resumen

- **En producción:** 0a (bajas propias, espera, menús), migración 020, 0c (finalizar solo, prendido a 240 min), barra inferior (1b, adelantada), 0d (Repetir por franja) y 0b (hojas, diálogos, menús y avisos en una sola primitiva, desde el 18/10).
- **Lo próximo del plan:** 1a (pantalla del partido) → 2 (ciclo semanal) → 3b-1 (Claro y Oscuro a mano). Antes, probar la 0b en un iPhone real (ver abajo).
- **Medición:** el **31/10** correr la consulta `SEGUIMIENTO` de [`consultas-comportamiento.sql`](consultas-comportamiento.sql) y comparar contra las metas de abajo.

## Qué está en producción

| Iteración | Qué cambia para la gente | Commits en `main` | Configuración |
|---|---|---|---|
| **0a** · Arreglos urgentes | Cada jugador se baja solo y la espera promueve sola; las canchas llenas ya no se cierran; menús y hojas en su lugar (`.page-enter` solo con opacidad, `viewport-fit=cover`, inputs de 16 px); el inicio abre el próximo partido; cerrar sesión en Perfil | `32de448`, `bbec990` | `AUTO_CLOSE_ON_FULL` sin setear (= apagado). Rollback: `AUTO_CLOSE_ON_FULL=true` |
| **020** · Auditoría sin actor | Las altas y bajas de externos y el desbloqueo de eventos con clave dejan de dar 500 | `f06113b` | Migración corrida a mano en Supabase; `scripts/reopen_auto_closed.sql` también |
| **0c** · Finalizar solo | El partido se finaliza solo 4 h después del inicio y abre los votos; las canchas quedan en orden estable; sumar una cancha mete gente de la espera | `537c52e` | `AUTO_FINALIZE_ENABLED=true`, `AUTO_FINALIZE_AFTER_MINUTES=240` (servicio futbol-mvp en Railway) |
| **1b** · Barra inferior | Partido · Calendario · Avisos · Gestión (admins) · Perfil, con contadores; pantalla Avisos nueva; el header del inicio queda limpio | `295fe82` | — |
| **0d** · Repetir por franja | En el Panel, "Repetir para el <día>" copia el partido de la misma franja con un mini-formulario (fecha, canchas, cupo) y deja listo el mensaje para WhatsApp. Si ya hay un partido a esa hora en ese lugar, avisa en vez de duplicarlo | `3e53d6d` (merge `a8cc6df`), arreglos de la revisión `5dd4407` | El acceso con link o clave se copia solo con `events.manage` y `EVENT_ACCESS_ENABLED` prendido |
| Permisos | Quien solo puede desbloquear PINs también entra al Panel y ve Gestión | `87d9c4e` | — |
| **0b** · Hojas y menús | Todas las hojas, diálogos, menús y avisos salen de una sola pieza (`src/design/ui/overlay`). El botón principal queda siempre a la vista (footer fijo con safe-area, alto en `dvh`, sube con el teclado). Los formularios ya no se borran al tocar el fondo: con cambios, Esc o la cruz preguntan "¿Descartás los cambios?". El fondo no scrollea detrás, Esc cierra solo la de arriba y el foco vuelve al botón que la abrió (también en Safari). Los avisos ("Cancha creada", errores) van encima de la barra inferior, o arriba si hay una hoja abierta. Los `confirm`/`prompt`/`alert` del navegador pasan a diálogos propios | `334e232`, docs `4e82fe3` | — (solo frontend). Rollback: revert del commit |
| Documentación | Diseño, datos de producción, decisión de 240 min, este estado | `7826950`, `5f90294`, `b1ff17f` | — |

## Verificación del 18/10 (producción, 0b)

- Push `9e5843b..4e82fe3`; Railway publicó el bundle nuevo (`index-4c4dyxQN.js`) en ~2 min.
- El bundle trae `#overlay-root`, "¿Descartás los cambios?", el Toaster y `data-tabbar`, y ya no trae `window.confirm`. El CSS trae `.ov-panel` con `100dvh` y `--kb-inset`, y `z-tabbar`.
- `/config` sin cambios (`autoCloseOnFull:false`, `guestLimitPerUser:5`, `autoFinalizeEnabled:true`, `autoFinalizeAfterMinutes:240`). `/health`, `/`, `/admin`, `/calendar`, `/avisos` y `/profile` responden 200.
- El login carga sin errores en WebKit (iPhone 14) y Chromium (Pixel 7), con `#overlay-root` y el Toaster montados.
- Detalle de la iteración (plan, revisión, tests): [`iteracion-0b-plan.md`](iteracion-0b-plan.md).

**Probar en el teléfono (organizador):**

1. Gestión › Eventos, scrolleado hasta abajo: "+ Crear Evento" abre la hoja con "Crear Evento" a la vista. Tipear algo y tocar el fondo: no se cierra. La cruz pregunta "¿Descartás los cambios?".
2. Con el teclado abierto en un campo de la hoja (iPhone), el botón principal tiene que quedar arriba del teclado. **No se pudo probar acá:** Playwright no simula el teclado de iOS.
3. Calendario: el "+" flota arriba de la barra; un partido propio › "Cancelar mi lugar" abre "¿Liberás tu lugar?" encima de la hoja.
4. Cualquier acción del Panel muestra el aviso verde arriba de la barra, sin taparla.

## Verificación del 17/10 (producción)

- `/config` devuelve `autoCloseOnFull:false`, `guestLimitPerUser:5`, `autoFinalizeEnabled:true`, `autoFinalizeAfterMinutes:240`.
- El frontend publicado incluye la barra inferior; `/`, `/avisos` y `/admin` responden 200.
- Base de datos (consulta de solo lectura en Supabase):
  - `event_audit_log.actor_user_id` acepta NULL (la 020 corrió).
  - `scripts/reopen_auto_closed.sql` corrió: 3 registros con `source='data_fix'`.
  - Desde el 17/10 hubo **3 bajas hechas por el propio jugador** (antes era imposible) y **ningún auto-cierre** de cancha o partido.
  - Los partidos próximos (mar 20/10, jue 22/10, vie 23/10) están abiertos y sin canchas cerradas.
  - Canchas nuevas sin `sort_order` repetido.
  - Auto-finalizar todavía no actuó: ningún partido terminó desde que se prendió. El primero es el **martes 20/10 a las 20 h** (debería finalizarse solo cerca de la medianoche).
- Tests: 58 tests de backend en verde (0a, 0c, 0d con 15, auditoría, acceso a eventos, externos, aprobación de cuentas), build y tests de frontend en verde, lint sin errores nuevos (los 9 que hay son anteriores).
- Revisiones independientes antes de deployar: la barra (14 hallazgos) y la 0d (10 hallazgos), todos confirmados y arreglados. La 0d se probó además en local: tocar el fondo no cierra el formulario, Enter no crea el partido, "+ Agregar cancha" propone un nombre nuevo y repetir la misma franja muestra el aviso sin duplicar.

## Qué medir el 31/10

Correr `SEGUIMIENTO` (al final de [`consultas-comportamiento.sql`](consultas-comportamiento.sql)). Una fila con:

| Métrica | Antes | Meta | Si no se cumple |
|---|---|---|---|
| `bajas_propias_pct` | ~29% (casi todas de admins) | > 50% | Revisar si el botón "No puedo ir" se ve; adelantar la 1a |
| `promociones` | 7 en toda la historia | > 0 por semana con partidos llenos | Revisar `AUTO_CLOSE_ON_FULL` y la espera |
| `auto_cierres` | — | 0 | Alguien prendió `AUTO_CLOSE_ON_FULL` |
| `finalize_auto_pct` / `mediana_h_finalizacion` | 0% / 37,9 h | ≥ 90% / < 5 h | Ver si hay tráfico con sesión después de los partidos |
| `reabiertos_tras_finalizar` | 0 | ≤ 1 por semana | Subir `AUTO_FINALIZE_AFTER_MINUTES` a 360 |
| `votaron_pct_optin` | 32% | sube | Adelantar votar en lote (iter 2) |
| `repetir_pct` | 0% | ≥ 60% en 3 semanas | Mostrar mejor el botón Repetir |
| `sort_repetido` / `pseudo_canchas` | 46 de 49 / ~10-15% | 0 / tiende a 0 | — |
| `qn_mediana` (QN v2) | 8 | < 5 tras la iter 2 | Reordenar el roadmap |

## Lo que sigue (plan establecido)

Detalle de cada iteración en [`rediseno-ux.md` §8.2 y §8.4](rediseno-ux.md).

1. **0b · Hojas y menús**: en producción desde el 18/10. Falta probarla en un iPhone real (sobre todo con el teclado abierto).
2. **1a · Pantalla del partido `/p/:id`** (1-1,5 semanas): "Me anoto" en un toque con la cancha asignada sola, la espera visible con el puesto, "No puedo ir" y, a menos de 24 h, "Liberar y avisar al grupo"; compartir con los lugares por cancha. Es lo que abre el link de WhatsApp. **Ojo:** la barra ya existe (1b), así que la 1a se monta adentro del shell. **Suma lo que quedó fuera de la 0b** (decidido el 17/10):
   - `?sheet=` en la URL, para que el atrás de Android cierre la hoja (y pregunte si hay cambios) en vez de salir de la pantalla;
   - deslizar para cerrar;
   - el `Menu` popover de escritorio (hoy no hay dropdowns propios).
   - Las hojas de la 1a usan `Sheet`/`Dialog`/`toast` de `src/design/ui/overlay`; `toast` ya acepta `action` para el "Deshacer".
3. **2 · Ciclo semanal** (1-1,5 semanas): Repetir también desde la pantalla del partido, votar en lote con "No lo vi" y la invitación al ranking, avisos dirigidos (incluido el de promoción desde la espera), y Gestión como lista en vez de 9 pestañas.
4. **3b-1 · Claro y Oscuro a mano** (1 semana): armar los equipos dentro de la cancha y publicarlos. Antes de arrancar, preguntar cómo se arman hoy los equipos.

Condicionadas a los datos: **3a** (mover entre canchas), **5** (partido fijo que se publica solo, empezando por los martes), **3b-2** (equilibrar) y **4** (suspender, editar con aviso, resultado).

## Cómo seguir trabajando

- Cada iteración arranca en su propia sesión, en **modo plan**, con su plan escrito en `docs/ux/iteracion-XX-plan.md` (como [`iteracion-0a-plan.md`](iteracion-0a-plan.md)) y aprobado antes de tocar código.
- Tests autónomos en `tests/` (con base local opcional). Revisión independiente del diff antes de commitear.
- **Overlays (0b):** con la API y el front locales contra `futbol_test`:
  1. `scripts/e2e_seed_admin.py` (admin de prueba y una solicitud pendiente; solo corre contra una base local);
  2. `E2E_WEB_URL=… E2E_API_URL=… E2E_ADMIN_PHONE=1100000099 E2E_ADMIN_PIN=4826 npm run e2e:overlays` (Pixel 7 + iPhone 14).
  - Cualquier hoja o diálogo nuevo va con las primitivas y se suma a la tabla de casos del spec.
  - Con el mismo setup pasan `npm run e2e:a11y`, `e2e:events:screenshots` y `e2e:tournaments:screenshots`. Cada
    corrida de eventos da de alta 2 usuarios por proyecto y la API deja 5 altas por IP por hora (en memoria): para
    repetirla dentro de la hora hay que reiniciar la API local.
- Deploy = push a `main` (Railway lo publica en ~1 minuto). Verificar con `/config` y con el bundle publicado.
- Migraciones: a mano en el SQL Editor de Supabase, aditivas (expand-only), **antes** de deployar código que las use.
- Variables en Railway: después de cambiarlas hay que tocar **Deploy** en el banner "Apply N changes"; si no, no se aplican.
- Consultas de análisis: solo `SELECT`, en una consulta nueva del SQL Editor (no pisar las guardadas).

## Deudas y pendientes conocidos

- **`AUTH_SECRET` no está seteada** en Railway: se deriva de `DATABASE_URL`. No cambiarla sin un plan (desloguea a todos y rompe el descifrado de contactos de externos).
- **Q0** (índice único en `event_registrations`) no se corrió todavía.
- **Playwright** no corre en CI (no hay CI). Desde la 0b tiene el proyecto WebKit "iPhone 14" y `e2e/overlays.spec.ts` (ver abajo cómo correrlo).
- **Lint:** 8 errores anteriores al rediseño (`App.jsx`, `main.jsx`, `TournamentTvPage.jsx`). `npm run lint` corre antes la guarda de overlays (`scripts/check-overlays.mjs`), que tiene que dar OK.
- **0b, pendientes chicos:**
  - El `busy` compartido del Panel bloquea la hoja mientras recarga (p. ej. al llegar con `?create=1`).
  - Los seeds de `overlays.spec.ts` y los flujos de eventos/torneos no se borran: quedan en `futbol_test`.
- **Supabase:** durante el análisis quedaron consultas "Untitled query" guardadas en *PRIVATE*; se pueden borrar.
- **Consultas que faltan** (sección 9.5 del diseño): H6(b) ráfagas de armado, agrupamiento de `CREATE_EVENT` (decide "Repetir las 3"), % de votos por tramo de demora.
