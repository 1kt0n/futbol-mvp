# Estado del rediseño UX

> Última actualización: **17/10/2026**. Este archivo es el punto de partida para retomar: qué está en producción, cómo se verificó, qué medir y qué sigue. El diseño completo está en [`rediseno-ux.md`](rediseno-ux.md); los datos de producción, en su sección 9.

Prototipo clickeable (privado, se comparte desde su menú *Share*): https://claude.ai/artifact/RwnySzAF5dwFW1i3vFZDky

## Resumen

- **En producción:** 0a (bajas propias, espera, menús), migración 020, 0c (finalizar solo, prendido a 240 min), barra inferior (1b, adelantada) y 0d (Repetir por franja).
- **Lo próximo del plan:** 0b (hojas y menús) → 1a (pantalla del partido) → 2 (ciclo semanal) → 3b-1 (Claro y Oscuro a mano).
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
| Documentación | Diseño, datos de producción, decisión de 240 min, este estado | `7826950`, `5f90294`, `b1ff17f` | — |

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

1. **0b · Hojas y menús** (1-1,5 semanas): una sola pieza para hojas, diálogos y avisos (portal, `dvh`, safe-area, bloqueo de scroll, cierre con cambios sin guardar), migrar todos los modales del Panel y del calendario, y pruebas en iPhone (Playwright WebKit) que verifiquen que el botón principal de cada hoja queda a la vista.
2. **1a · Pantalla del partido `/p/:id`** (1-1,5 semanas): "Me anoto" en un toque con la cancha asignada sola, la espera visible con el puesto, "No puedo ir" y, a menos de 24 h, "Liberar y avisar al grupo"; compartir con los lugares por cancha. Es lo que abre el link de WhatsApp. **Ojo:** la barra ya existe (1b), así que la 1a se monta adentro del shell.
3. **2 · Ciclo semanal** (1-1,5 semanas): Repetir también desde la pantalla del partido, votar en lote con "No lo vi" y la invitación al ranking, avisos dirigidos (incluido el de promoción desde la espera), y Gestión como lista en vez de 9 pestañas.
4. **3b-1 · Claro y Oscuro a mano** (1 semana): armar los equipos dentro de la cancha y publicarlos. Antes de arrancar, preguntar cómo se arman hoy los equipos.

Condicionadas a los datos: **3a** (mover entre canchas), **5** (partido fijo que se publica solo, empezando por los martes), **3b-2** (equilibrar) y **4** (suspender, editar con aviso, resultado).

## Cómo seguir trabajando

- Cada iteración arranca en su propia sesión, en **modo plan**, con su plan escrito en `docs/ux/iteracion-XX-plan.md` (como [`iteracion-0a-plan.md`](iteracion-0a-plan.md)) y aprobado antes de tocar código.
- Tests autónomos en `tests/` (con base local opcional). Revisión independiente del diff antes de commitear.
- Deploy = push a `main` (Railway lo publica en ~1 minuto). Verificar con `/config` y con el bundle publicado.
- Migraciones: a mano en el SQL Editor de Supabase, aditivas (expand-only), **antes** de deployar código que las use.
- Variables en Railway: después de cambiarlas hay que tocar **Deploy** en el banner "Apply N changes"; si no, no se aplican.
- Consultas de análisis: solo `SELECT`, en una consulta nueva del SQL Editor (no pisar las guardadas).

## Deudas y pendientes conocidos

- **`AUTH_SECRET` no está seteada** en Railway: se deriva de `DATABASE_URL`. No cambiarla sin un plan (desloguea a todos y rompe el descifrado de contactos de externos).
- **Q0** (índice único en `event_registrations`) no se corrió todavía.
- **Playwright** no corre en CI ni tiene proyecto WebKit (entra en la 0b).
- **Lint:** 9 errores anteriores al rediseño (`App.jsx`, `AdminPanel.jsx`, `main.jsx`, `RolesPermisosTab.jsx`).
- **Supabase:** durante el análisis quedaron consultas "Untitled query" guardadas en *PRIVATE*; se pueden borrar.
- **Consultas que faltan** (sección 9.5 del diseño): H6(b) ráfagas de armado, agrupamiento de `CREATE_EVENT` (decide "Repetir las 3"), % de votos por tramo de demora.
