# Copa Proud Sudamericana 2026: resumen de todo lo realizado

> **Estado al 8/10/2026.** El torneo se juega el **sábado 10 y el domingo 11 de octubre**, de 11 a 19 hs, en el **Polideportivo Cramer** (Av. Crámer 3249, Núñez, CABA). El **sorteo oficial de zonas** ya se hizo en vivo el **martes 6/10 a las 22:15**.
> Este documento no incluye links privados (panel, mesa de control, veedores): en la sección 10 se indica dónde está cada uno.

---

## 1. Qué hay hoy

| Pieza | Para qué | Dónde |
|---|---|---|
| **Sitio del torneo** | Fixture, zonas, copas, equipos, estadísticas, sorteo, mapa (ES / PT / EN) | `live.copaproud.com` |
| **App del veedor** | Carga en vivo de goles, tarjetas, estado y penales desde el celular | `live.copaproud.com/v/<link privado>` |
| **Mesa de control** | Ver y corregir todos los resultados, confirmar con la planilla, cerrar la fase de grupos | `live.copaproud.com/control/<link privado>` |
| **Sorteo en vivo** | Panel de producción + pantallas para OBS y proyector (ya usado el 6/10) | `live.copaproud.com/produccion/<link privado>` |
| **Escenas de OBS** | 11 gráficas de transmisión (páginas web 1920×1080) | `live.copaproud.com/obs` |
| **API** | Backend compartido con la app futbol-mvp (FastAPI + Postgres en Supabase) | `api.copaproud.com` |
| **Demo** | Copia escondida para ensayar (no indexada, cartel "MODO DEMO") | `live.copaproud.com/demo` |

---

## 2. Arquitectura e infraestructura

- **Monorepo `futbol-mvp`**. El sitio nuevo vive en `copa-proud-web/` (Vite + React 19 + Tailwind, sin service worker).
- **Backend compartido.** Es el FastAPI de la app, con un **módulo nuevo `competitions`** (tablas `competition_*`, migraciones **018** y **019**, corridas en producción). No toca los "Torneos" de la app.
- **Railway, dos servicios:**
  - `futbol-mvp` (API + app) → `api.copaproud.com`
  - `copa-proud-web` (sitio, Caddy en el puerto 8080) → `live.copaproud.com`
- **DNS en Hostinger:** CNAME `api` y `live` hacia Railway. El WordPress de `copaproud.com` quedó como estaba.
- **Base de datos:** Supabase. Su URL es la `DATABASE_URL` del servicio futbol-mvp en Railway.
- **Deploy:** cada push a `main` despliega los dos servicios.
- **Rendimiento:**
  - El sitio público consume un solo endpoint de snapshot, con caché en memoria, ETag y gzip.
  - Actualización cada 15 s con partidos en vivo y cada 60 s si no hay.
  - Una prueba de carga dio unas 570 req/s sostenidas.
- **Seguridad:**
  - Los links privados son tokens aleatorios. En la base solo se guarda su hash.
  - Los scripts piden la URL de la base sin mostrarla y la vuelven a pedir si se pega mal.
  - Los cambios importantes piden escribir **APLICAR** después de una prueba en seco.

---

## 3. Sitio público (`live.copaproud.com`)

Pestañas: **Inicio · Sorteo · Fixture · Zonas · Copas · Equipos · Estadísticas · Mapa**. Selector de idioma ES / PT / EN.

- **Inicio:**
  - Cuenta regresiva en vivo.
  - Aviso del sorteo (hasta que termina).
  - Tarjeta "¿Dónde se juega?".
  - Cancha por cancha: lo que se juega ahora o lo próximo.
  - Próximos partidos y últimos resultados.
- **Sorteo:**
  - Fecha y hora en Argentina, más la hora del visitante si es otra, y la cuenta regresiva.
  - Botón "Agendar" (Google Calendar).
  - **Video de YouTube embebido** y botón "Ver en YouTube".
  - Tablero de zonas en vivo, con **demora anti-spoiler** para no adelantarse al stream.
  - "Cómo es el sorteo" (tandas y reglas) y los **sponsors**.
- **Fixture / Zonas / Copas:**
  - Grilla por horario y cancha.
  - Tablas con fair play y la de mejores terceros.
  - Llaves de Oro, Plata y Bronce.
- **Equipos:** los 28 con escudo y país. Cada equipo con su **plantel público** (decisión de la organización) y sus partidos.
- **Estadísticas:** goleadores (solo fase de grupos), valla menos vencida y fair play.
- **Mapa:**
  - El diseño "Mapa de canchas" de la organización.
  - Sede con "Cómo llegar" (Google Maps).
  - Canchas del torneo **9, 10, 11, 13, 14 y 15** y los días y el horario.
- **Marca:**
  - Paleta, tipografías y logos tomados del archivo oficial (ver `copa-proud-web/BRAND.md`).
  - Sponsors **Nutrishop** y **American Top Underwear**, preparados para fondo oscuro.

---

## 4. El torneo cargado

### Equipos (28) y planteles
- **Lista oficial** en `scripts/copa_proud_teams.json`, cargada en real y en demo.
- **Países:** 16 de Argentina, 5 de Brasil, 3 de Uruguay y uno de Paraguay, Colombia, Chile y Venezuela.
- **Escudos:** los 28 equipos tienen escudo. El de Real Players lo mandó la organización. Rayos.cba II usa el de Rayos.cba con un distintivo "II".
  - Asignaciones a confirmar: Zorros = escudo "MDP", Beescats = "Soccer Boys", 3F = "3 Deporte Inclusivo".
- **Planteles:** **265 jugadores**, de la planilla de inscriptos del 6/10, cargados en real y en demo.
  - Solo nombre y apellido: no se guardaron emails ni edades.
  - Sin número de camiseta: el veedor elige al jugador por nombre.

### Canchas
La grilla del cronograma usa las columnas 1 a 6, que corresponden a las canchas reales **9, 10, 11, 13, 14 y 15**. Cada cancha conserva sus partidos y su veedor; solo cambió el número que se ve.

### Formato y cruces (`app/utils/competition_formats.py`)
- **Sábado:** 42 partidos de grupos (7 zonas de 4), de 11:00 a 17:30.
- **Domingo:** 33 cruces, de 11:00 a 19:00.
- **Desempate en las zonas:** puntos → diferencia de gol → goles a favor → fair play (amarilla 1, roja 3) → sorteo. El W.O. vale 3-0.

**Copa de Oro (15 partidos):**
- Octavos: 1°A vs 1° mejor 3° · 1°B vs 2° mejor 3° · 1°C vs 2°G · 1°D vs 2°F · 1°E vs 2°C · 1°F vs 2°D · 1°G vs 2°E · 2°A vs 2°B.
- Si un mejor 3° cae contra el 1° de su propia zona, se intercambia con el 2°G o el 2°F.
- Cuartos, semis y final en secuencia.

**Copa de Plata (7):** cuartos con los perdedores de los octavos de Oro (1 vs 2, 3 vs 4, 5 vs 6, 7 vs 8), después semis y final.

**Copa de Bronce (11)**, según la planilla de la organización del 8/10:
- **Octavos:** 4°A vs 7° mejor 3° · 4°B vs 4°G · 4°C vs 4°F · 4°D vs 4°E. Si el 7° mejor 3° es de la Zona A, se intercambia con el 4°G.
- **Cuartos:** 3° mejor 3° vs ganador del octavo 1 · 4° vs ganador del 2 · 5° vs ganador del 3 · 6° vs ganador del 4.
- Semis y final en secuencia.

> **Supuestos que siguen abiertos:**
> - Los cruces de **Oro** no se compararon con las filas 1–44 de la planilla de la organización.
> - Zona E a las 13:30: se cargó **2 vs 4** porque el PDF repetía 2 vs 3.

---

## 5. Sorteo oficial de zonas (realizado el 6/10)

- **Procedimiento oficial** ("Reglamento y Procedimiento del Sorteo Oficial"):
  - Doble bombo por tanda.
  - **Tanda 1:** Brasil (5) · **Tanda 2:** Uruguay (3) · **Tanda 3:** resto de extranjeros (4) · **Tanda 4:** parejas del mismo club (6) · **Tanda 5:** resto de Argentina (10), con bolillas de casillero.
- **Reglas que el sistema aplica solo:**
  - Máximo **2 extranjeros por zona**.
  - Tercer Tiempo y Cuarto Tiempo, Rayos.cba y Rayos.cba II, y Dogos y Dogos Seniors, siempre en zonas distintas.
  - **Regla de salto:** si la zona que sale no se puede usar, el equipo pasa a la siguiente, A → B … G → A.
- **Panel de producción:**
  - Se escribe el equipo + Enter, después la letra de la bolilla. La **vista previa** avisa si hay salto antes de revelar.
  - También permite deshacer, sorteo digital de respaldo y ubicación manual.
- **Pantallas:** tablero a pantalla completa, overlay sobre la cámara (zócalo de revelación) y la pestaña Sorteo del sitio.
- **Resultado:** 28 de 28 equipos ubicados (estado DONE).
  - El video quedó en YouTube (`youtube.com/watch?v=QTwAEppkSkc`) y se ve embebido en `/sorteo`.
  - Al cierre de este resumen YouTube todavía estaba procesando la repetición.
  - Hay una grabación local de OBS en `~/Movies/2026-10-06 22-34-32.mov`.
- **Pruebas:** 16 tests del sorteo, incluida una simulación de 1000 sorteos oficiales que siempre cumplen el reglamento.

---

## 6. Transmisión y OBS

- **Escenas** (`copa-proud-web/src/obs/ObsApp.jsx`), todas páginas de 1920×1080. Las transparentes van encima de la cámara:

| # | Escena | Qué muestra |
|---|---|---|
| 1 | Espera | Cuenta regresiva, escudos pasando y sponsors |
| 2 | Conductor | Cámara + zócalo con el nombre + marca y EN VIVO |
| 3 | Reglamento | Tandas y reglas del sorteo |
| 4 | Equipos | Conductor de pie a la izquierda + los 28 equipos por tanda |
| 5 | Sorteo · Cámara | Cámara + revelación en zócalo + bolillas |
| 6 | Sorteo · Tablero | Las 7 zonas en grande + revelación al centro |
| 7 | Sorteo · Cámara + Tablero | Cámara a la izquierda, zonas a la derecha |
| 8 | Pausa | "Volvemos enseguida" |
| 9 | Cierre | Así quedaron las zonas + fechas del torneo |
| 10 | Canción oficial | Ventana vertical para el video del Short + sponsors |
| 11 | Ya arrancamos | Cartel de inicio |

- **Script `copa-proud-web/obs/setup-obs.mjs`** (obs-websocket, sin dependencias):
  - Arma todas las escenas solo.
  - Opciones: `--demo`, `--coleccion "<nombre>"` (ensayo y real en colecciones separadas), `--conductor`, `--rol` y `--cancion "<ruta del video>"`.
  - No cambia la escena al aire ni la colección si OBS está transmitiendo, y sin `--conductor` no pisa el nombre del zócalo.
- **Colecciones en la Mac de OBS:** "Copa Proud Sorteo - Ensayo" y "Copa Proud - Prod".
- **Equipo técnico del show:**
  - iPhone como cámara (Cámara de Continuidad, por cable).
  - Micrófono corbatero USB ("USBAudio1.0") en Mic/Aux.
  - Dos computadoras: una con OBS y otra con el panel y el proyector.
  - Proyector con `/obs/tablero` para el público de la sala.
- **YouTube:**
  - La inserción en otros sitios tiene que estar **permitida**, si no `/sorteo` muestra "Video no disponible".
  - Para ensayar, vivos **No listados**.
- **Guía:** `docs/copa-proud-obs.md`. Guion técnico compartido: "Guion técnico · Sorteo Copa Proud 2026" (Claude Docs).

---

## 7. Veedores

- **Con nombre y rotativos** (decisión del 8/10). Los veedores no tienen una cancha fija: el que llega a una cancha **toma el partido** y desde ahí es el único que lo carga. Así nunca hay dos personas cargando el mismo partido.
- **Alta:** desde la **mesa de control → Veedores**. Se pone el nombre y aparece su link (una sola vez) con botones Copiar y WhatsApp. Desde ahí también se genera un link nuevo o se da de baja.
- **App del veedor** (`/v/<link>`):
  - **Inicio:** "Mis partidos" (los que tomó, primero los en vivo) y las **6 canchas**. Cada cancha muestra el partido de ahora y quién lo tiene: **Libre**, **Tuyo** o **Lo tiene Ana**.
  - **Cancha → partido → "Tomar este partido".** Si lo tiene otro, aparece "Lo está cargando Ana" y **"Tomarlo igual"**, con confirmación: Ana deja de poder cargarlo. Sirve si a alguien se le apaga el celular.
  - **"Soltar partido"** si lo tomó por error, solo antes de empezarlo.
  - Permite iniciar, entretiempo y finalizar, goles, goles en contra, amarillas, rojas y penales.
  - Funciona **sin señal**: guarda una cola y la reintenta sin duplicar. Si mientras tanto otro tomó el partido, avisa.
  - **"Asignar jugador" / "Cambiar"** en lo que cargó "sin identificar", también con el partido terminado, hasta que la mesa lo confirme. No toca el marcador.
  - Puede deshacer o corregir lo que cargó él y, si tiene el partido, también lo que cargó el veedor anterior. Lo que cargó la mesa, nunca.
- **Desde la mesa:** en cada partido, el selector **"Veedor"** sirve para pasárselo a otro o dejarlo libre.
- **Modelo anterior** (veedores por cancha con `scripts/veedores_cancha.py`): sigue andando. Un partido preasignado es simplemente un partido ya tomado.
- **Demo:** los 6 "Veedor Demo Cancha N" siguen activos. Se dan de baja desde la mesa y se agregan los veedores con nombre.
- **Torneo real:** todavía no hay veedores. Se crean desde la mesa de control real, cuando se genere su link.

---

## 8. Mesa de control (`/control/<link privado>`)

Pantalla para la organización en el predio, sin login:

- **Partidos:** filtros por día, cancha, en juego, para confirmar, confirmados y "marcador ≠ goles cargados".
- **Editar un partido:**
  - **Resultado final** (lo deja terminado) o **solo corregir el marcador**.
  - Estado y reabrir.
  - **W.O.** y penales.
  - Goles y tarjetas: agregar, borrar o asignar jugador.
  - **✓ Confirmar** contra la planilla firmada: bloquea las ediciones hasta "Desconfirmar".
- **Zonas y cierre:**
  - Tablas de las 7 zonas.
  - **Sorteo de desempate** cuando una zona termina empatada: se ordena a mano y se guarda.
  - **"Cerrar fase de grupos"**, que arma los cruces del domingo, con la vista de cómo quedan. También permite reabrir.
- **Veedores:**
  - Alta con nombre: el link se muestra una vez, con Copiar y WhatsApp.
  - Qué partido tiene cada uno.
  - Link nuevo y dar de baja.
  - En cada partido, el selector "Veedor" lo reasigna o lo deja libre.
- **Planteles (lista de buena fe):** para la acreditación. Muestra el avance ("N de 265 con número") y cada equipo con su contador.
  - Se carga el **número de camiseta** de cada jugador: se escribe y se aprieta Enter, se guarda y pasa al siguiente. No deja repetir números dentro del equipo.
  - También se corrige el nombre, se **agrega** a alguien que no estaba en la lista o se lo **quita**. Si tenía goles o tarjetas, esos eventos quedan "sin identificar".
  - Los veedores ven los números al instante en el selector de jugador.
- **Historial:** quién cambió qué y a qué hora, incluido quién tomó, soltó o se llevó cada partido y los cambios de planteles. Lo hecho desde esta pantalla figura como "Mesa de control".
- **Backend:** reusa exactamente las reglas de la mesa central (`app/routers/competitions_control.py`).
- **Link:** se genera con `scripts/control_link.py [--demo]`; cada link nuevo anula el anterior.

---

## 9. Scripts (se corren desde la carpeta del proyecto; piden la URL de la base)

| Comando | Qué hace |
|---|---|
| `./.venv/bin/python scripts/seed_competition.py copa-proud-2026` | Crea o actualiza la competencia desde el formato. Idempotente, no toca partidos empezados. |
| `scripts/preparar_sorteo_real.py` | Carga los 28 equipos + el procedimiento oficial, genera el link del panel real y deja los links en `links-produccion.txt` |
| `scripts/equipos_oficiales.py [--demo]` | Carga o actualiza los 28 equipos oficiales y el procedimiento del sorteo |
| `scripts/planteles.py <planilla.xlsx> [--demo]` | Carga los planteles desde la planilla de inscriptos (solo atletas, solo nombre y apellido) |
| `scripts/actualizar_cruces.py [--demo]` | Renumera las canchas (9–15) y aplica los cruces nuevos **sin tocar la fase de grupos** |
| `scripts/draw_link.py [--demo]` | Link del panel de producción del sorteo |
| `scripts/control_link.py [--demo]` | Link de la mesa de control |
| `scripts/veedores_cancha.py crear\|links\|renombrar\|listar\|qr [--demo]` | Veedores **por cancha** (modelo anterior). Ahora los veedores se crean desde la mesa de control. |
| `scripts/demo_competition.py crear\|reiniciar\|borrar` | Arma, limpia o borra la demo. `reiniciar` borra los resultados pero deja el sorteo. Para hacer también el sorteo desde cero: **"Reiniciar TODO (demo)"** en el panel de producción de la demo. |
| `scripts/escenario_bronce.py [--tercero "…" --cuarto "…"] [--si]` | **Solo demo.** Deja 41 de los 42 partidos del sábado cargados para probar el intercambio de los octavos de Bronce. El que falta (3° vs 4° de la Zona A) lo cargás vos: 1-0 → se intercambia, 3-0 → no. Se puede repetir. |
| `node copa-proud-web/obs/setup-obs.mjs [...]` | Arma OBS (ver sección 6) |

---

## 10. Links

**Públicos:**
- Sitio: `https://live.copaproud.com`
- Sorteo: `https://live.copaproud.com/sorteo`
- Mapa: `https://live.copaproud.com/mapa`
- Escenas de OBS: `https://live.copaproud.com/obs`
- Para el proyector: `/obs/espera`, `/obs/tablero`, `/obs/cierre` y `/obs/pausa`
- Demo: lo mismo con `/demo` adelante (por ejemplo `https://live.copaproud.com/demo/sorteo`)

**Privados** (no van en este documento):
- **Panel del sorteo real:** en `links-produccion.txt`, en la carpeta del proyecto.
- **Mesa de control:**
  - Demo: el último link que imprimió `control_link.py --demo`.
  - Real: falta generarlo.
- **Veedores:** se generan desde la mesa de control (pestaña Veedores). El link se ve una sola vez; si se pierde, "Link nuevo". Los 6 de prueba de la demo están en `demo-veedores.csv`.

---

## 11. Estado actual: real y demo

| | Torneo real (`copa-proud-2026`) | Demo (`copa-proud-2026-demo`) |
|---|---|---|
| Equipos y escudos | 28 ✓ | 28 ✓ |
| Planteles | 265 jugadores ✓ | 265 jugadores ✓ |
| Sorteo | Hecho (28/28) ✓ | Hecho (ensayos) |
| Canchas 9–15 | ✓ | **Pendiente**: correr `actualizar_cruces.py --demo` + APLICAR |
| Cruces de Bronce nuevos | ✓ | **Pendiente** (mismo comando) |
| Video en `/sorteo` | Repetición del sorteo (procesándose en YouTube) | Vivo de prueba |
| Mesa de control | **Falta generar el link** | Link generado ✓ |
| Veedores | **Faltan crear** (desde la mesa) | 6 de prueba por cancha: dar de baja y crear con nombre |

---

## 12. Pendientes antes del sábado

- [ ] **Demo:** `./.venv/bin/python scripts/actualizar_cruces.py --demo` → APLICAR (canchas 9–15 y Bronce nuevo).
- [ ] **Mesa de control real:** `./.venv/bin/python scripts/control_link.py` y pasar el link solo a la mesa.
- [ ] **Veedores reales:** mesa de control real → Veedores → agregar a cada uno con su nombre → mandar el link por WhatsApp.
- [ ] **Confirmar los cruces de la Copa de Oro** contra las filas 1–44 de la planilla de la organización.
- [ ] **Ensayo con veedores en la demo:**
  1. Panel de producción demo → **Reiniciar TODO (demo)** → volver a hacer el sorteo.
  2. Mesa de control demo → Veedores: dar de baja a los "Veedor Demo Cancha N" y agregar a los veedores con nombre.
  3. Que cada uno tome un partido en su cancha, lo cargue (también "Tomarlo igual" y asignar jugador) y lo finalice.
  4. Que la mesa confirme y cierre la fase de grupos.
- [ ] **Sábado a la noche:** en la mesa de control, sortear los empates si los hay → **Cerrar fase de grupos**.
- [ ] **Seguridad:** cambiar la contraseña de la base, que quedó expuesta en un chat:
  1. Antes, revisar que `AUTH_SECRET` esté definida en Railway.
  2. Reset en Supabase.
  3. Actualizar `DATABASE_URL` en Railway.
  4. Deploy.
- [ ] **WordPress** (`copaproud.com`): actualizaciones de seguridad y botón "Seguí el torneo en vivo" hacia `live.copaproud.com`.

---

## 13. Pruebas

- `tests/test_competition_engine.py`: 23 tests del motor (tablas, desempates, terceros, cruces, intercambios), con 200 torneos simulados.
- `tests/test_competition_draw.py`: 16 tests del sorteo, con 1000 sorteos oficiales simulados.
- `copa-proud-web/src/draw/drawView.test.js`: 6 tests del tablero (vitest).
- `tests/e2e_competition_sim.py`: torneo completo por HTTP contra un Postgres local, con 970 a 990 verificaciones según la semilla.
  - Cubre veedores, idempotencia sin señal, confirmación, W.O., penales, sorteos de desempate, cierre de fase, asignar jugador y cruces de Bronce.
  - Sobre una demo local cubre "Reiniciar TODO" (y que el torneo real lo rechace), volver a sortear, veedores con nombre desde la mesa, tomar, conflicto, tomarlo igual, soltar, reasignar y dar de baja.

---

## 14. Historial de cambios (commits en `main`)

| Commit | Cambio |
|---|---|
| `1e9a196` | Backend `competitions`: motor, formato, API pública, veedor y mesa central (API) |
| `fa6578d` | Sitio público + modo veedor |
| `f10305f` · `57965f0` | Seed interactivo (URL oculta, APLICAR), textos para Supabase |
| `e3308aa` | Estados "antes del sorteo" en Equipos y Zonas |
| `8c151cd` | Modo demo escondido |
| `32eb404` | Cuenta regresiva en vivo |
| `37dc86b` · `b1ecb95` | Sorteo en vivo: pantalla + panel de producción |
| `f37952b` | Sorteo oficial por tandas, transmisión y veedores por cancha |
| `d1d6660` | Pestaña Sorteo con YouTube, tablero por tandas y escenas de OBS |
| `9a2e818` · `823d680` | Escudos de Rayos.cba II y Real Players |
| `425d148` | Escena "Equipos" con el conductor |
| `64de550` | Sponsors (Nutrishop y American Top) en la página y en OBS |
| `a3d8f8f` | Preparar el sorteo real en un paso + OBS por colección |
| `0a898c7` | Escudos con versión en la URL (caché vieja) |
| `f9473df` | Escena "Canción oficial" |
| `5d3d9fa` | Planteles desde la planilla + elegir jugador por nombre |
| `ef26d2b` | Escena "Ya arrancamos" + OBS seguro durante el vivo |
| `7baaf1e` | Cruces de Bronce oficiales + canchas 9–15 |
| `4da5388` | Los scripts vuelven a pedir la URL si se pega mal |
| `ce294d6` | Pestaña "Mapa" |
| `6973989` | El veedor asigna o corrige el jugador de sus eventos |
| `723da75` | Mesa de control |

---

## 15. Documentos relacionados

- `docs/copa-proud-plan.md`: plan y decisiones técnicas por etapa (secciones 10 a 20).
- `docs/copa-proud-obs.md`: guía de OBS y checklist de transmisión.
- `copa-proud-web/BRAND.md`: marca, paleta y assets.
- Guion técnico del sorteo (Claude Docs): roles, minuto a minuto, secuencia de bolillas y contingencias.
