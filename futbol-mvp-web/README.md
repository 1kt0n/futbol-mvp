# Futbol MVP Web

## Requisitos
- Node 18+
- API backend corriendo (por defecto en `http://127.0.0.1:8000` o la URL que uses)

## Desarrollo local
```bash
cd futbol-mvp-web
npm install
npm run dev
```

Si necesitas apuntar a otra API:
```bash
# futbol-mvp-web/.env.local
VITE_API_URL=http://127.0.0.1:8011
```

## Nuevo UX Torneos + Publico/TV + Auth

### Rutas canónicas
- Publico: `/tournaments/:id?token=...`
- TV: `/tournaments/:id/tv?token=...`

### Compatibilidad legacy
- `/tournaments/:id/live?token=...` redirige a `/tournaments/:id?token=...`
- `/tournaments/:id/live/tv?token=...` redirige a `/tournaments/:id/tv?token=...`

### Feature flag
- `VITE_NEW_TOURNAMENT_UX=true` (default) habilita el nuevo control center de torneos.

## E2E de torneos con screenshots (Playwright)
Este flujo ejecuta un recorrido completo de torneos (`ROUND_ROBIN` + `KNOCKOUT`) y guarda capturas en carpeta local timestamp.

### 1) Instalar navegador de Playwright
```bash
npm run e2e:install
```

### 2) Variables requeridas
```bash
# admin existente en tu entorno
E2E_ADMIN_PHONE=54911XXXXXXXX
E2E_ADMIN_PIN=1234
```

Variables opcionales:
```bash
# default: http://127.0.0.1:5173
E2E_WEB_URL=http://127.0.0.1:5173

# default: futbol-mvp-web/e2e-artifacts/tournaments
E2E_CAPTURE_ROOT=C:/ruta/a/mis-capturas
```

### 3) Ejecutar recorrido + capturas
```bash
npm run e2e:tournaments:screenshots
```

### 4) Resultado esperado
Se crea una carpeta por corrida:
```text
e2e-artifacts/tournaments/<YYYYMMDD-HHmmss>/
  desktop-chrome/
  mobile-chrome/
  manifest.json
```

`manifest.json` incluye:
- estado final de la corrida
- lista de screenshots generados
- validación de artefactos obligatorios por viewport

## Notas
- El test crea torneos de prueba reales y los deja en `ARCHIVED` al final.
- Si falta una variable o la web no está reachable, el runner falla en preflight.

## E2E de creación de partido/evento con screenshots
Este flujo cubre end-to-end la creación y gestión de evento (crear evento, canchas, editar, abrir/cerrar cancha, registros, invitados, waitlist, mover, baja, cerrar/reabrir/finalizar evento).

### Ejecutar recorrido + capturas
```bash
npm run e2e:events:screenshots
```

### Resultado esperado
Se crea una carpeta por corrida:
```text
e2e-artifacts/events/<YYYYMMDD-HHmmss>/
  desktop-chrome/
  mobile-chrome/
  manifest.json
```

## Testing adicional
```bash
# unit/UI
npm run test

# smoke accesibilidad (axe + playwright)
npm run e2e:a11y
```

## PWA
- Manifest: `public/manifest.webmanifest`
- Fallback offline: `public/offline.html`
- Iconos: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`
- Registro SW: automático via `vite-plugin-pwa`
