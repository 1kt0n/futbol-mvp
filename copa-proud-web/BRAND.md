# Marca — Copa Proud Sudamericana 2026

Fuentes: logos oficiales `copa1.png` (texto negro) y `copa2.png` (texto blanco), 1200×1294 con transparencia,
entregados el 2026-10-01; el resto (paleta, copa sola, imagen para compartir, escudos) se extrajo de
`CopaProud-Elementos.ai` (Illustrator 29.1, 2 mesas de trabajo) el 2026-09-30.
Los originales en alta resolución NO están en el repo (pesan ~120 MB); pedirlos a la organización.

## Paleta (muestreada del archivo, no inventada)

| Token | Hex | Origen |
|---|---|---|
| `--cp-night` | `#04011e` | fondo texturado, zona más oscura |
| `--cp-indigo-900` | `#0d012e` | fondo |
| `--cp-indigo-800` | `#120236` | fondo (tono dominante) |
| `--cp-indigo-700` | `#1b0246` | fondo, zonas claras |
| `--cp-violet-glow` | `#360777` | brillo violeta del fondo |
| `--cp-gold` | `#ffc000` | relleno vectorial de "Compití con pasión" |
| `--cp-gold-deep` | `#e49f2b` | arcos dorados del póster |
| `--cp-gold-shadow` | `#c06b08` | sombra de los arcos |
| `--cp-gold-light` | `#f6d381` | brillo de los arcos |
| `--cp-ink` | `#000000` | texto del logo sobre fondo claro (`copa1.png`) |
| `--cp-white` | `#ffffff` | texto del logo sobre fondo oscuro |

Arcoíris pride (anillo y base de la copa, franjas junto a "2026"): rojo, naranja, amarillo, verde, azul, violeta.
Para UI usar la bandera estándar: `#e40303 #ff8c00 #ffed00 #008026 #004dff #750787`.

## Tipografía (aproximaciones — el .ai no embebe fuentes, el texto está en curvas)

- Logo "COPA PROUD / SUDAMERICANA / 2026": sans geométrica de peso extra-bold → **Montserrat 800**.
- "Jugá con orgullo": sans semibold → **Montserrat 600** o Inter 600.
- "Compití con pasión": script de pincel en dorado → **Kaushan Script** (o similar) solo para acentos.
- ⚠️ Confirmar con quien diseñó si usaron otras familias.

## Archivos (`public/`)

| Archivo | Uso |
|---|---|
| `brand/logo-dark-bg.{webp,png}` | logo con texto blanco, para fondos oscuros (default del sitio) ← `copa2.png` |
| `brand/logo-light-bg.{webp,png}` | logo con texto negro, para fondos claros ← `copa1.png` |
| `brand/mark.webp`, `brand/mark-{32,192,512}.png` | la copa sola: favicon, íconos |
| `brand/apple-touch-icon.png` | ícono iOS (fondo índigo, iOS no respeta transparencia) |
| `brand/og-image.jpg` | 1200×630 para compartir en WhatsApp/redes |
| `teams/<slug>.webp` | 26 escudos con transparencia, 384 px |

El listado de equipos con su escudo está en `scripts/copa_proud_teams.json` (sirve para el alta masiva).

## ⚠️ Avisos

- En la mesa de trabajo 2 (póster) el logo raster dice **"COPA PRIDE"**; en el póster está tapado con un
  parche "COPA PROUD". **No usar ese raster.** Los logos de este repo salen de la mesa de trabajo 1 (correcta).
- El póster tiene **26 escudos** y el torneo es de **28 equipos**: faltan 2.
- Nombres leídos del escudo, a confirmar: **"MDP"** (zorro rojo con corona) y **"Soccer Boys"** (avispa).
- País cargado solo donde el escudo lo muestra (bandera o ciudad): PY, BR, VE, UY, GT, AR. El resto, a confirmar.
