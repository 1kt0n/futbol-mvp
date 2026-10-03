# OBS para el sorteo EN VIVO — Copa Proud Sudamericana 2026

Guía práctica para quien produce la transmisión por YouTube. El script
`copa-proud-web/obs/setup-obs.mjs` arma solo las escenas y fuentes de OBS; acá está cómo
correrlo y lo que queda a mano.

## 1. Instalar OBS y habilitar el control remoto

1. Instalá **OBS Studio** (mínimo 28; mejor 30 o más nuevo) desde https://obsproject.com, o en Mac:
   `brew install --cask obs`. En Mac, la primera vez dale permiso de cámara y micrófono
   (Ajustes del Sistema → Privacidad y seguridad).
2. En OBS: **Herramientas → Configuración del servidor WebSocket** → tildá **Habilitar servidor
   WebSocket**, puerto **4455**, autenticación activada con una contraseña.
   **Mostrar información de conexión** te da la IP y la contraseña.
3. En la compu donde corrés el script hace falta **Node 22 o más nuevo** (`node --version`).

## 2. Correr el script

Desde la raíz del repo, con OBS abierto:

```bash
# Ensayo secreto → live.copaproud.com/demo
node copa-proud-web/obs/setup-obs.mjs --demo --conductor "Nombre Apellido"

# Show real → live.copaproud.com
node copa-proud-web/obs/setup-obs.mjs --conductor "Nombre Apellido"
```

- Te pide la contraseña del WebSocket sin mostrarla. También se puede pasar en la variable
  `OBS_WS_PASSWORD` (ojo que queda en el historial de la terminal).
- **OBS en otra compu de la red:** agregá `--host 192.168.0.20` (la IP de "Mostrar información de
  conexión") y permití el puerto 4455 en el firewall de esa compu.
- `--rol "..."` cambia la segunda línea del zócalo, `--dry-run` muestra el plan sin tocar nada,
  `--base http://localhost:5174` apunta al sitio local, `--help` lista todo.
- **Se puede correr las veces que haga falta:** no duplica nada, actualiza URLs y ajustes.
  **Pasar del ensayo al show = correrlo de nuevo sin `--demo`.** No toca la cámara elegida ni la
  conexión con YouTube.
- Deja el video en 1920×1080 a 30 fps y la salida Simple en 6000/160 kbps. Si OBS está emitiendo
  o grabando no puede cambiar la resolución: avisa y sigue (cortá y volvé a correrlo).

## 3. Escenas

| Escena | Qué se ve | Para qué |
|---|---|---|
| **1 · Espera** | Cuenta regresiva a pantalla completa | Antes de arrancar |
| **2 · Conductor** | Cámara + overlay (logo, EN VIVO) + zócalo con el nombre | Bienvenida, charla, despedida |
| **3 · Reglamento** | Reglas del sorteo | Explicar cómo se sortea |
| **4 · Equipos** | Los 28 equipos por tanda | Presentar a los participantes |
| **5 · Sorteo · Cámara** | Cámara + overlay con la tanda y la revelación de cada equipo | Plano principal del sorteo |
| **6 · Sorteo · Tablero** | Tablero completo de zonas | Repasar cómo van quedando |
| **7 · Sorteo · Cámara + Tablero** | Cámara en ventana a la izquierda, tablero a la derecha | Alternar con la 5 durante el sorteo |
| **8 · Pausa** | Placa de pausa | Imprevistos |
| **9 · Cierre** | Placa de cierre | Final |

- **`[Fuente] Cámara`** es auxiliar: tiene la cámara una sola vez y las escenas 2, 5 y 7 la
  anidan. El dispositivo se elige ahí y cambia en todas. No la mandes al aire.
- Los gráficos son páginas del sitio (`/obs/...`): se actualizan solas con lo que se carga en el
  panel de producción. Desde OBS solo se cambia de escena.
- Usá la cámara en una resolución 16:9 (ideal 1920×1080) para que llene bien la ventana de la 7.

### Orden sugerido del show

1. **1 · Espera** al aire 10–15 min antes: arrancá la transmisión acá.
2. **2 · Conductor**: bienvenida.
3. **3 · Reglamento** → **4 · Equipos** (volviendo a la 2 cuando se conversa).
4. Sorteo: **5 · Sorteo · Cámara** mientras se saca cada equipo y se revela; alterná con
   **7 · Cámara + Tablero**; al cerrar cada tanda, **6 · Tablero** para repasar.
5. Si algo falla: **8 · Pausa** (y de vuelta a la 2 al retomar).
6. Final: **6 · Tablero** con las zonas completas → **2 · Conductor** para despedir →
   **9 · Cierre** 30–60 s → Detener transmisión.

## 4. Salida recomendada para YouTube

- **Video:** 1920×1080 (base y salida) a **30 fps**. El script ya lo deja así.
- **Bitrate de video:** ~**6000 kbps**, control de tasa **CBR**. En modo de salida Simple el
  script ya carga los bitrates; si usás modo Avanzado, cargalos a mano en Ajustes → Salida.
- **Intervalo de fotogramas clave:** **2 s** (en Avanzado ponelo a mano: el 0 "automático" no sirve para YouTube).
- **Codificador:** en Mac, **Apple VT H264 Hardware Encoder** (por hardware, deja la CPU libre
  para las páginas del navegador). En Windows, NVENC o QuickSync si hay; si no, x264 "veryfast".
- **Audio:** AAC **160 kbps**, **48 kHz** (Ajustes → Audio → Frecuencia de muestreo).
- **Internet:** subida estable de 10 Mbps o más, mejor por cable.

## 5. YouTube

- El canal necesita la **transmisión en vivo habilitada** (YouTube Studio → Crear → Emitir en
  vivo; pide verificar el teléfono). **La primera activación puede tardar hasta 24 h**: hacelo
  con días de anticipación.
- **Ensayo secreto:** creá la transmisión como **No listado** y con **Permitir inserción**
  activado (así se puede embeber en el sitio de demo sin aparecer en el canal).
- **Latencia:** elegí **Latencia baja** en la configuración de la transmisión.
- **Conectar OBS:** Ajustes → Emisión → servicio **YouTube - RTMPS** → "Conectar cuenta" o
  "Usar clave de transmisión" y pegás la clave de YouTube Studio. Si ensayo y show usan claves
  distintas, revisá cuál está cargada antes de salir.
- **Show real:** creá otra transmisión (pública, o programada para poder difundir el link antes).

## 6. Modo Estudio

Activá **Modo Estudio** (botón abajo a la derecha). A la izquierda queda la **Vista previa**
(lo que preparás) y a la derecha el **Programa** (lo que está al aire). Clic en una escena →
aparece en la vista previa → botón **Transición** la manda al aire. Recomendado: transición
"Fundido" de 300 ms. Se pueden asignar teclas a cada escena en Ajustes → Atajos.

## 7. Checklist antes de salir al aire

- [ ] Script corrido **sin `--demo`** para el show (las fuentes dicen `live.copaproud.com/obs/...`,
      sin `/demo/`). Para el ensayo, al revés.
- [ ] Cámara elegida en `[Fuente] Cámara`; encuadre revisado en las escenas 2, 5 y 7 (en la 7, la
      cara tiene que caer dentro de la ventana).
- [ ] Micrófono en el Mezclador de audio: la barra se mueve al hablar sin llegar al rojo;
      "Audio del escritorio" silenciado si no hay música.
- [ ] Todas las escenas vistas en la vista previa: corre la cuenta regresiva, el zócalo tiene el
      nombre bien escrito, el overlay y el tablero cargan.
- [ ] Si una página quedó vieja: clic derecho en la fuente → Propiedades → "Actualizar caché de la
      página actual".
- [ ] Panel de producción abierto (otra compu o pestaña) con el link vigente.
- [ ] YouTube: transmisión creada, latencia baja, OBS conectado. Iniciar transmisión en
      **1 · Espera** y confirmar en YouTube Studio que llega la señal.
- [ ] Ver → Estadísticas: 0 % de fotogramas perdidos u omitidos en una prueba de 5 minutos.
- [ ] Compu enchufada, sin notificaciones ni suspensión, internet por cable.
