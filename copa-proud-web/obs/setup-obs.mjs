#!/usr/bin/env node
/**
 * setup-obs.mjs — Arma OBS Studio para el sorteo EN VIVO de la Copa Proud Sudamericana 2026.
 *
 * Habla con OBS por obs-websocket v5 (viene incluido en OBS ≥ 28). Sin dependencias: Node ≥ 22.
 *
 * Antes, en OBS: Herramientas → Configuración del servidor WebSocket → "Habilitar servidor
 * WebSocket" (puerto 4455) y copiá la contraseña ("Mostrar información de conexión").
 *
 * Uso:
 *   node copa-proud-web/obs/setup-obs.mjs --demo            # ensayo → live.copaproud.com/demo
 *   node copa-proud-web/obs/setup-obs.mjs                   # show real → live.copaproud.com
 *   OBS_WS_PASSWORD=xxx node copa-proud-web/obs/setup-obs.mjs --host 192.168.0.20
 *   node copa-proud-web/obs/setup-obs.mjs --dry-run         # muestra el plan sin conectarse
 *
 * Es idempotente: si lo corrés de nuevo actualiza URLs y ajustes de lo que ya existe en vez de
 * duplicar (pasar del ensayo al show real = correrlo otra vez sin --demo). No toca la cámara que
 * elegiste ni el servicio/clave de emisión de YouTube. Guía completa: docs/copa-proud-obs.md
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// ─── Constantes ──────────────────────────────────────────────────────────────

const PROD_BASE = 'https://live.copaproud.com';
const DEMO_BASE = 'https://live.copaproud.com/demo';
const CANVAS = { w: 1920, h: 1080, fps: 30 };

// Ventana de la cámara en la escena 7. DEBE coincidir con copa-proud-web/src/obs/: la página
// /obs/split deja un hueco transparente exactamente en x=64 y=208 w=896 h=504 sobre un lienzo
// de 1920×1080. Si cambia allá, cambiala acá (y viceversa).
const SPLIT_WINDOW = { x: 64, y: 208, w: 896, h: 504 };
// Ventana VERTICAL del conductor en la escena 4 (/obs/equipos?camara=1): mismo acuerdo que arriba
// (EQUIPOS_WINDOW en copa-proud-web/src/obs/ObsApp.jsx). La cámara 16:9 se recorta a lo alto.
const EQUIPOS_WINDOW = { x: 64, y: 196, w: 540, h: 820 };
const FULL_FRAME = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };

const CAMERA_SCENE = '[Fuente] Cámara';
const CAMERA_INPUT = 'CP · Cámara';
// Tipos de captura de video por orden de preferencia: macOS (OBS 30+ y anteriores), Windows, Linux.
const CAMERA_KINDS = ['macos-avcapture', 'av_capture_input_v2', 'av_capture_input', 'dshow_input', 'v4l2_input'];
const BROWSER_KIND = 'browser_source';

const VIDEO_KBPS = '6000';
const AUDIO_KBPS = '160';
const CONNECT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 15000;

const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 };
const CLOSE_REASONS = {
  4009: 'la contraseña no es correcta',
  4010: 'OBS no soporta la versión 1 del protocolo (¿OBS anterior a 28?)',
  4011: 'OBS cerró la sesión',
};

// En OBS, `alignment` es qué punto de la fuente cae en positionX/Y (5 = arriba-izquierda) y
// `boundsAlignment` cómo se acomoda el contenido dentro del recuadro (0 = centrado).
const ALIGN_TOP_LEFT = 5;
const ALIGN_CENTER = 0;
const NO_CROP = { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 };

/** Llena el recuadro manteniendo proporción (escala exterior) y centrado; lo que sobra se recorta. */
const fillBox = ({ x, y, w, h }) => ({
  positionX: x, positionY: y, rotation: 0, alignment: ALIGN_TOP_LEFT, ...NO_CROP,
  boundsType: 'OBS_BOUNDS_SCALE_OUTER', boundsAlignment: ALIGN_CENTER, boundsWidth: w, boundsHeight: h,
});
/** Las páginas ya miden 1920×1080: van a escala 1, sin recuadro, en la esquina. */
const PAGE_TRANSFORM = {
  positionX: 0, positionY: 0, rotation: 0, alignment: ALIGN_TOP_LEFT, ...NO_CROP,
  scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE',
};

// restart_when_active: el zócalo vuelve a cargarse (y entra animado) cada vez que su escena sale al aire.
const browserSettings = (url, restart = false) => ({
  url, width: CANVAS.w, height: CANVAS.h, fps: CANVAS.fps,
  reroute_audio: false, shutdown: false, restart_when_active: restart,
  css: 'body { margin: 0; overflow: hidden; }',
});

const HELP = `Uso: node copa-proud-web/obs/setup-obs.mjs [opciones]

Arma en OBS (obs-websocket v5) las escenas y fuentes del sorteo EN VIVO de la Copa Proud.

Opciones:
  --demo               Apunta al ensayo escondido (${DEMO_BASE}).
  --base <url>         Otra base para las páginas (ej. http://localhost:5174 para probar local).
  --host <ip>          Dónde corre OBS (por defecto 127.0.0.1).
  --port <n>           Puerto del servidor WebSocket de OBS (por defecto 4455).
  --conductor "<txt>"  Nombre del zócalo (por defecto "Conducción").
  --rol "<txt>"        Segunda línea del zócalo (por defecto "Copa Proud Sudamericana 2026").
  --coleccion "<txt>"  Colección de escenas donde armar todo (tiene que existir: en OBS,
                       Colección de escenas → Duplicar). Así el ensayo y el show real quedan
                       en colecciones separadas. Sin esto, usa la colección abierta.
  --dry-run            Muestra el plan completo sin conectarse a OBS.
  -h, --help           Esta ayuda.

Contraseña: variable OBS_WS_PASSWORD; si falta y OBS la pide, te la pregunto sin mostrarla.
Se puede correr las veces que haga falta: actualiza lo que ya existe, no duplica.`;

// ─── Argumentos y plan ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    demo: false, base: null, host: '127.0.0.1', port: 4455, coleccion: null,
    conductor: 'Conducción', rol: 'Copa Proud Sudamericana 2026', dryRun: false, help: false,
  };
  const withValue = { '--base': 'base', '--host': 'host', '--port': 'port', '--conductor': 'conductor', '--rol': 'rol', '--coleccion': 'coleccion' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === '--demo') opts.demo = true;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--help' || flag === '-h') opts.help = true;
    else if (flag in withValue) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new Error(`Falta el valor de ${flag}.`);
      opts[withValue[flag]] = value;
    } else throw new Error(`Opción desconocida: ${arg} (probá --help).`);
  }
  opts.port = Number(opts.port);
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error('--port tiene que ser un número entre 1 y 65535.');
  if (opts.base) {
    let parsed;
    try { parsed = new URL(opts.base); } catch { throw new Error(`--base no es una URL válida: ${opts.base}`); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('--base tiene que empezar con http:// o https://');
    opts.base = opts.base.replace(/\/+$/, '');
  }
  return opts;
}

function buildPlan(opts) {
  const base = opts.base ?? (opts.demo ? DEMO_BASE : PROD_BASE);
  const label = opts.base ? 'una base personalizada' : opts.demo ? 'el ENSAYO (demo)' : 'el SHOW REAL';
  const zocalo = `nombre=${encodeURIComponent(opts.conductor)}&rol=${encodeURIComponent(opts.rol)}`;
  const sources = [
    ['CP · Espera', '/obs/espera', false, 'cuenta regresiva antes del show'],
    ['CP · Reglamento', '/obs/reglas', false, 'reglamento del sorteo'],
    ['CP · Equipos', '/obs/equipos?camara=1', true, 'los 28 equipos por tanda, con hueco vertical para el conductor'],
    ['CP · Overlay sorteo', '/obs/overlay', true, 'sobre la cámara: logo, EN VIVO, tanda y revelación'],
    ['CP · Zócalo conductor', `/obs/zocalo?${zocalo}`, true, 'zócalo de quien conduce'],
    ['CP · Tablero', '/obs/tablero', false, 'tablero completo de zonas'],
    ['CP · Cámara + Tablero', '/obs/split', true, 'hueco para la cámara a la izquierda, tablero a la derecha'],
    ['CP · Pausa', '/obs/pausa', false, 'pausa'],
    ['CP · Cierre', '/obs/cierre', false, 'cierre'],
  ].map(([name, path, transparent, desc]) => ({ name, url: base + path, transparent, desc }));

  const urlOf = Object.fromEntries(sources.map((s) => [s.name, s.url]));
  const page = (name) => ({ source: name, kind: BROWSER_KIND, settings: browserSettings(urlOf[name], name === 'CP · Zócalo conductor'), transform: PAGE_TRANSFORM });
  const camera = (box) => ({ source: CAMERA_SCENE, transform: fillBox(box), crop: true });
  const scenes = [
    { name: '1 · Espera', items: [page('CP · Espera')] },
    { name: '2 · Conductor', items: [camera(FULL_FRAME), page('CP · Overlay sorteo'), page('CP · Zócalo conductor')] },
    { name: '3 · Reglamento', items: [page('CP · Reglamento')] },
    { name: '4 · Equipos', items: [camera(EQUIPOS_WINDOW), page('CP · Equipos')] },
    { name: '5 · Sorteo · Cámara', items: [camera(FULL_FRAME), page('CP · Overlay sorteo')] },
    { name: '6 · Sorteo · Tablero', items: [page('CP · Tablero')] },
    { name: '7 · Sorteo · Cámara + Tablero', items: [camera(SPLIT_WINDOW), page('CP · Cámara + Tablero')] },
    { name: '8 · Pausa', items: [page('CP · Pausa')] },
    { name: '9 · Cierre', items: [page('CP · Cierre')] },
  ];
  return { base, label, sources, scenes, startScene: scenes[0].name, wantedCollection: opts.coleccion };
}

function describeItem(item) {
  if (item.kind === BROWSER_KIND) return 'página a pantalla completa (escala 1)';
  const t = item.transform;
  const where = t.positionX === 0 && t.positionY === 0 && t.boundsWidth === CANVAS.w && t.boundsHeight === CANVAS.h
    ? `llena ${CANVAS.w}×${CANVAS.h}`
    : `ventana x=${t.positionX} y=${t.positionY} ${t.boundsWidth}×${t.boundsHeight}`;
  return `${where} (escala exterior, centrada${item.crop ? ', recortada al recuadro' : ''})`;
}

function printPlan(plan, opts) {
  console.log(`Plan para ${plan.label} (simulación: no me conecto a OBS)`);
  console.log(`  Sitio: ${plan.base}`);
  console.log(`  OBS:   ws://${opts.host}:${opts.port}`);
  console.log(`  Colección de escenas: ${plan.wantedCollection ? `"${plan.wantedCollection}" (tiene que existir)` : 'la que esté abierta'}`);
  console.log(`  Video: base y salida ${CANVAS.w}×${CANVAS.h} @ ${CANVAS.fps} fps · salida Simple: video ${VIDEO_KBPS} kbps, audio ${AUDIO_KBPS} kbps`);
  console.log(`\nFuentes de navegador (${CANVAS.w}×${CANVAS.h}, ${CANVAS.fps} fps; se crean una vez y se reusan):`);
  for (const s of plan.sources) {
    console.log(`  ${s.name.padEnd(22)} ${(s.transparent ? 'transparente' : 'opaca').padEnd(12)} ${s.url}`);
    console.log(`  ${''.padEnd(22)} ${''.padEnd(12)} ↳ ${s.desc}`);
  }
  console.log(`\nCámara: escena auxiliar "${CAMERA_SCENE}" con "${CAMERA_INPUT}" (primer tipo disponible de: ${CAMERA_KINDS.join(', ')}),`);
  console.log(`  ${describeItem({ transform: fillBox(FULL_FRAME), crop: true })}. El dispositivo lo elegís en OBS.`);
  console.log('\nEscenas (capas de abajo hacia arriba):');
  for (const scene of plan.scenes) {
    console.log(`  ${scene.name}`);
    scene.items.forEach((item, i) => console.log(`    ${i + 1}. ${item.source} — ${describeItem(item)}`));
  }
  console.log(`\nAl terminar: escena al aire "${plan.startScene}". No toco la emisión ni la clave de YouTube.`);
}

// ─── Protocolo obs-websocket v5 ─────────────────────────────────────────────

/** Autenticación v5: secret = base64(sha256(password + salt)); auth = base64(sha256(secret + challenge)). */
export function obsAuth(password, salt, challenge) {
  const sha256b64 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
  return sha256b64(sha256b64(password + salt) + challenge);
}

class ObsRequestError extends Error {
  constructor(requestType, status = {}) {
    super(`${requestType} falló (código ${status.code ?? '?'})${status.comment ? `: ${status.comment}` : ''}`);
    this.code = status.code;
  }
}

function openSession(host, port, password) {
  const where = `${host}:${port}`;
  const url = `ws://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const pending = new Map();
  let seq = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ya estaba cerrado */ }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`OBS no respondió en ${where} a tiempo: ¿está abierto OBS y habilitado Herramientas → Configuración del servidor WebSocket?`)), CONNECT_TIMEOUT_MS);
    let ws;
    try {
      ws = new WebSocket(url, 'obswebsocket.json');
    } catch (err) {
      return fail(new Error(`Dirección de OBS inválida (${where}): ${err.message}`));
    }

    const client = {
      call(requestType, requestData = {}) {
        if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('La conexión con OBS está cerrada.'));
        const requestId = `cp-${++seq}`;
        return new Promise((ok, ko) => {
          const t = setTimeout(() => { pending.delete(requestId); ko(new Error(`OBS no respondió a ${requestType} en ${REQUEST_TIMEOUT_MS / 1000} s.`)); }, REQUEST_TIMEOUT_MS);
          pending.set(requestId, { ok, ko, t });
          ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }));
        });
      },
      close() { try { ws.close(1000); } catch { /* nada */ } },
    };

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const d = msg.d ?? {};
      if (msg.op === OP.Hello) {
        const identify = { rpcVersion: 1, eventSubscriptions: 0 }; // sin eventos: solo pedidos
        if (d.authentication) {
          if (!password) return fail(Object.assign(new Error('OBS pide contraseña.'), { needsPassword: true }));
          identify.authentication = obsAuth(password, d.authentication.salt, d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: OP.Identify, d: identify }));
      } else if (msg.op === OP.Identified) {
        settled = true;
        clearTimeout(timer);
        resolve(client);
      } else if (msg.op === OP.RequestResponse) {
        const p = pending.get(d.requestId);
        if (!p) return;
        pending.delete(d.requestId);
        clearTimeout(p.t);
        if (d.requestStatus?.result) p.ok(d.responseData ?? {});
        else p.ko(new ObsRequestError(d.requestType, d.requestStatus));
      }
    });
    ws.addEventListener('error', () => { /* el detalle llega en 'close' */ });
    ws.addEventListener('close', (event) => {
      const why = CLOSE_REASONS[event.code] ?? `código ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
      for (const p of pending.values()) { clearTimeout(p.t); p.ko(new Error(`Se cortó la conexión con OBS (${why}).`)); }
      pending.clear();
      if (event.code === 4009) fail(new Error('OBS rechazó la contraseña. Revisala en Herramientas → Configuración del servidor WebSocket → Mostrar información de conexión.'));
      else if (event.code >= 4000) fail(new Error(`OBS cortó la conexión: ${why}.`));
      else fail(new Error(`No pude conectar a OBS en ${where}: ¿está abierto OBS y habilitado Herramientas → Configuración del servidor WebSocket?${host === '127.0.0.1' ? '' : ' (si está en otra compu, revisá la IP y el firewall)'}`));
    });
  });
}

/** Pregunta en la terminal sin mostrar lo que se tipea. */
function askHidden(question) {
  return new Promise((resolve) => {
    const out = new Writable({ write(chunk, _enc, cb) { if (!out.muted) process.stdout.write(chunk); cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
    rl.on('SIGINT', () => { rl.close(); process.stdout.write('\n'); process.exit(130); });
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    out.muted = true; // la pregunta ya salió; desde acá no se hace eco de nada
  });
}

async function connect({ host, port }) {
  try {
    return await openSession(host, port, process.env.OBS_WS_PASSWORD || '');
  } catch (err) {
    if (!err.needsPassword) throw err;
    if (!process.stdin.isTTY) throw new Error('OBS pide contraseña: definí OBS_WS_PASSWORD (Herramientas → Configuración del servidor WebSocket → Mostrar información de conexión).');
    const password = await askHidden('Contraseña del servidor WebSocket de OBS: ');
    if (!password) throw new Error('No ingresaste la contraseña.');
    return openSession(host, port, password);
  }
}

// ─── Configuración ───────────────────────────────────────────────────────────

function makeLog() {
  const counts = { created: 0, updated: 0, same: 0, warnings: 0 };
  const line = (key, mark) => (msg) => { counts[key]++; console.log(`  ${mark} ${msg}`); };
  return {
    counts, created: line('created', '+'), updated: line('updated', '~'), same: line('same', '='), warn: line('warnings', '!'),
    info: (msg) => console.log(msg),
  };
}

async function configureVideo(obs, log) {
  const want = { fpsNumerator: CANVAS.fps, fpsDenominator: 1, baseWidth: CANVAS.w, baseHeight: CANVAS.h, outputWidth: CANVAS.w, outputHeight: CANVAS.h };
  const cur = await obs.call('GetVideoSettings');
  const label = `video ${CANVAS.w}×${CANVAS.h} @ ${CANVAS.fps} fps (base y salida)`;
  if (Object.keys(want).every((k) => cur[k] === want[k])) return log.same(label);
  try {
    await obs.call('SetVideoSettings', want);
    log.updated(`${label} — antes: base ${cur.baseWidth}×${cur.baseHeight}, salida ${cur.outputWidth}×${cur.outputHeight}, ${+(cur.fpsNumerator / cur.fpsDenominator).toFixed(2)} fps`);
  } catch (err) {
    log.warn(`No pude cambiar el ${label}: ${err.message.replace(/\.$/, '')}. Si estás emitiendo o grabando, cortá y corré el script de nuevo (o cambialo en Ajustes → Video).`);
  }
}

async function configureBitrates(obs, log) {
  for (const [name, value, what] of [['VBitrate', VIDEO_KBPS, 'video'], ['ABitrate', AUDIO_KBPS, 'audio']]) {
    const param = { parameterCategory: 'SimpleOutput', parameterName: name };
    try {
      const cur = await obs.call('GetProfileParameter', param);
      if (cur.parameterValue === value) { log.same(`bitrate de ${what} ${value} kbps (salida Simple)`); continue; }
      await obs.call('SetProfileParameter', { ...param, parameterValue: value });
      log.updated(`bitrate de ${what} ${value} kbps (salida Simple; antes ${cur.parameterValue ?? 'por defecto'})`);
    } catch (err) {
      log.warn(`No pude fijar el bitrate de ${what} (${err.message}). Ponelo a mano en Ajustes → Salida.`);
    }
  }
  const mode = await obs.call('GetProfileParameter', { parameterCategory: 'Output', parameterName: 'Mode' }).catch(() => ({}));
  if (mode.parameterValue === 'Advanced') log.warn('OBS está en modo de salida "Avanzado": los bitrates de arriba solo valen en "Simple". Pasalo a Simple o cargá 6000/160 kbps en Ajustes → Salida.');
  else log.info('    (los bitrates aplican al modo de salida "Simple" de OBS, el que viene por defecto)');
}

async function getItems(obs, sceneName) {
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  return [...sceneItems].sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
}

const defaultsCache = new Map();
async function syncBrowserSettings(obs, spec, ctx) {
  const kind = ctx.inputs.get(spec.source);
  if (kind !== spec.kind) throw new Error(`Ya existe "${spec.source}" pero es de tipo ${kind}, no Navegador. Renombrala o borrala en OBS y corré de nuevo.`);
  if (!defaultsCache.has(kind)) defaultsCache.set(kind, (await obs.call('GetInputDefaultSettings', { inputKind: kind })).defaultInputSettings ?? {});
  const { inputSettings } = await obs.call('GetInputSettings', { inputName: spec.source });
  const cur = { ...defaultsCache.get(kind), ...inputSettings };
  const changed = Object.keys(spec.settings).filter((k) => cur[k] !== spec.settings[k]);
  if (!changed.length) return ctx.log.same(`fuente "${spec.source}"`);
  await obs.call('SetInputSettings', { inputName: spec.source, inputSettings: spec.settings, overlay: true });
  ctx.log.updated(`fuente "${spec.source}" (${changed.join(', ')})${changed.includes('url') ? ` → ${spec.settings.url}` : ''}`);
}

async function applyTransform(obs, sceneName, sceneItemId, spec, ctx) {
  const sceneItemTransform = { ...spec.transform };
  if (spec.crop) {
    // "Recortar al recuadro" existe desde OBS 30.x; el nombre del campo lo leo de lo que devuelve OBS.
    if (ctx.cropKey === undefined) {
      const cur = (await obs.call('GetSceneItemTransform', { sceneName, sceneItemId })).sceneItemTransform ?? {};
      ctx.cropKey = ['cropToBounds', 'boundsCrop'].find((k) => k in cur) ?? null;
      if (!ctx.cropKey) ctx.log.warn('Este OBS no tiene "recortar al recuadro": si la cámara no es 16:9 puede asomar fuera de su ventana. Usá una resolución 16:9 (ej. 1920×1080).');
    }
    if (ctx.cropKey) sceneItemTransform[ctx.cropKey] = true;
  }
  await obs.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform });
}

/** Deja la escena con sus capas (crea lo que falta, actualiza lo que existe) en el orden pedido. */
async function syncScene(obs, scene, ctx) {
  const items = await getItems(obs, scene.name);
  for (const spec of scene.items) {
    let item = items.find((i) => i.sourceName === spec.source);
    if (spec.kind && !ctx.inputs.has(spec.source)) {
      // La fuente no existe en OBS: se crea directamente dentro de esta escena.
      const { sceneItemId } = await obs.call('CreateInput', {
        sceneName: scene.name, inputName: spec.source, inputKind: spec.kind, inputSettings: spec.settings ?? {}, sceneItemEnabled: true,
      });
      ctx.inputs.set(spec.source, spec.kind);
      ctx.synced.add(spec.source);
      ctx.log.created(`fuente "${spec.source}" (${spec.kind}) en "${scene.name}"`);
      item = { sceneItemId, sceneItemEnabled: true };
    } else {
      if (spec.settings && !ctx.synced.has(spec.source)) {
        await syncBrowserSettings(obs, spec, ctx);
        ctx.synced.add(spec.source);
      }
      if (!item) {
        const { sceneItemId } = await obs.call('CreateSceneItem', { sceneName: scene.name, sourceName: spec.source, sceneItemEnabled: true });
        ctx.log.created(`"${spec.source}" dentro de "${scene.name}"`);
        item = { sceneItemId, sceneItemEnabled: true };
      }
    }
    if (!item.sceneItemEnabled) {
      await obs.call('SetSceneItemEnabled', { sceneName: scene.name, sceneItemId: item.sceneItemId, sceneItemEnabled: true });
      ctx.log.updated(`"${spec.source}" visible otra vez en "${scene.name}"`);
    }
    await applyTransform(obs, scene.name, item.sceneItemId, spec, ctx);
  }

  // Orden de capas: si alguien las movió (o se agregó una que faltaba arriba), se reacomodan abajo de todo.
  const now = await getItems(obs, scene.name);
  const wanted = scene.items.map((s) => s.source).filter((name) => now.some((i) => i.sourceName === name));
  const actual = [...new Set(now.map((i) => i.sourceName).filter((name) => wanted.includes(name)))];
  if (actual.join('\n') !== wanted.join('\n')) {
    for (const [index, name] of wanted.entries()) {
      const it = now.find((i) => i.sourceName === name);
      await obs.call('SetSceneItemIndex', { sceneName: scene.name, sceneItemId: it.sceneItemId, sceneItemIndex: index });
    }
    ctx.log.updated(`orden de capas en "${scene.name}"`);
  }
}

async function setup(obs, plan, log) {
  const version = await obs.call('GetVersion');
  log.info(`Conectado a OBS ${version.obsVersion} (obs-websocket ${version.obsWebSocketVersion}).`);
  plan.collection = await useCollection(obs, plan.wantedCollection, log);
  log.info('\nVideo y salida:');
  await configureVideo(obs, log);
  await configureBitrates(obs, log);

  const kinds = new Set((await obs.call('GetInputKindList', { unversioned: false })).inputKinds);
  if (!kinds.has(BROWSER_KIND)) throw new Error('Este OBS no tiene la fuente "Navegador" (browser_source). Instalá OBS desde obsproject.com, que la trae incluida.');
  const cameraKind = CAMERA_KINDS.find((k) => kinds.has(k));

  const scenes = new Set((await obs.call('GetSceneList')).scenes.map((s) => s.sceneName));
  const inputs = new Map((await obs.call('GetInputList')).inputs.map((i) => [i.inputName, i.inputKind]));
  const ctx = { log, inputs, synced: new Set(), cropKey: undefined };

  // 1) Escenas: primero las del show (así quedan en orden en la lista) y al final la auxiliar.
  log.info('\nEscenas:');
  for (const name of [...plan.scenes.map((s) => s.name), CAMERA_SCENE]) {
    if (scenes.has(name)) { log.same(`escena "${name}"`); continue; }
    if (inputs.has(name)) throw new Error(`Ya existe una fuente llamada "${name}" y choca con la escena. Renombrala en OBS y corré de nuevo.`);
    await obs.call('CreateScene', { sceneName: name });
    log.created(`escena "${name}"`);
  }

  // 2) Cámara: una sola captura, dentro de la escena auxiliar; las demás escenas anidan esa escena.
  log.info('\nCámara:');
  const cameraSpec = { source: CAMERA_INPUT, kind: inputs.get(CAMERA_INPUT) ?? cameraKind, transform: fillBox(FULL_FRAME), crop: true };
  if (inputs.has(CAMERA_INPUT)) log.same(`fuente "${CAMERA_INPUT}" (no toco el dispositivo elegido)`);
  if (cameraSpec.kind) await syncScene(obs, { name: CAMERA_SCENE, items: [cameraSpec] }, ctx);
  else log.warn(`No encontré captura de video (${CAMERA_KINDS.join(', ')}). Agregá tu cámara a mano dentro de "${CAMERA_SCENE}": todas las escenas la toman de ahí.`);

  // 3) Escenas del show, con sus capas de abajo hacia arriba.
  log.info('\nFuentes y capas:');
  for (const scene of plan.scenes) await syncScene(obs, scene, ctx);

  await obs.call('SetCurrentProgramScene', { sceneName: plan.startScene });
}

/** Colección de escenas: la pedida con --coleccion (si existe) o la que está abierta. */
async function useCollection(obs, wanted, log) {
  const list = async () => obs.call('GetSceneCollectionList');
  let { currentSceneCollectionName: current, sceneCollections } = await list();
  if (wanted && wanted !== current) {
    if (!sceneCollections.includes(wanted)) {
      throw new Error(`No existe la colección de escenas "${wanted}". En OBS: menú Colección de escenas → Duplicar → llamala "${wanted}" y volvé a correr esto. (Hay: ${sceneCollections.join(', ')})`);
    }
    await obs.call('SetCurrentSceneCollection', { sceneCollectionName: wanted });
    // OBS cambia de colección en segundo plano: esperar a que la reporte como abierta.
    for (let i = 0; i < 40 && current !== wanted; i++) {
      await new Promise((r) => setTimeout(r, 250));
      current = (await list()).currentSceneCollectionName;
    }
    if (current !== wanted) throw new Error(`OBS no terminó de abrir la colección "${wanted}". Abrila a mano (menú Colección de escenas) y volvé a correr esto.`);
    await new Promise((r) => setTimeout(r, 1500));
    log.info(`Colección de escenas: "${current}" (la abrí recién).`);
  } else {
    log.info(`Colección de escenas: "${current}".`);
  }
  return current;
}

function printSummary(plan, log) {
  const { created, updated, same, warnings } = log.counts;
  console.log(`\nListo: OBS quedó armado para ${plan.label}${plan.collection ? ` en la colección "${plan.collection}"` : ''}.`);
  console.log(`  ${created} creados · ${updated} actualizados · ${same} sin cambios${warnings ? ` · ${warnings} avisos (mirá arriba)` : ''}`);
  console.log(`  Escena al aire: "${plan.startScene}".`);
  console.log('\nPáginas cargadas:');
  for (const s of plan.sources) console.log(`  ${s.name.padEnd(22)} ${s.url}`);
  console.log('\nTe falta hacer a mano en OBS:');
  [
    `Elegir la cámara: escena "${CAMERA_SCENE}" → doble clic en "${CAMERA_INPUT}" → Dispositivo (mejor en 1920×1080). Se actualiza en todas las escenas.`,
    'Revisar el micrófono en el Mezclador de audio: la barra se tiene que mover al hablar sin llegar al rojo. Silenciá lo que no uses.',
    'Conectar YouTube en Ajustes → Emisión (servicio YouTube - RTMPS: "Conectar cuenta" o pegar la clave de transmisión).',
    'Activar el Modo Estudio para preparar cada escena en la vista previa antes de mandarla al aire.',
  ].forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log('\nGuía y checklist: docs/copa-proud-obs.md');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const plan = buildPlan(opts);
  if (opts.dryRun) return printPlan(plan, opts);
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error(`Necesito Node 22 o más nuevo (este es ${process.version}): no encuentro WebSocket. Instalá Node LTS desde nodejs.org.`);
  }
  console.log(`Configurando OBS en ${opts.host}:${opts.port} para ${plan.label} → ${plan.base}`);
  const obs = await connect(opts);
  const log = makeLog();
  try {
    await setup(obs, plan, log);
  } finally {
    obs.close();
  }
  printSummary(plan, log);
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  });
}
