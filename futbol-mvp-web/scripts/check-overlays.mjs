#!/usr/bin/env node
// Guarda de overlays (rediseño UX §6.2.15, iteración 0b).
//
// Todo lo que flota sobre la pantalla sale de las primitivas de
// src/design/ui/overlay (hojas, diálogos, menús, toasts) o del shell (barra
// inferior, FAB). Este script falla si aparece:
//   - la clase `fixed` (o `position: fixed`) fuera de src/shell/ y src/design/ui/overlay/;
//   - un diálogo nativo del navegador: confirm(), alert() o prompt().
//
// Uso: node ./scripts/check-overlays.mjs   (lo corre `npm run lint`)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".css"]);
const FIXED_ALLOWED = ["src/shell/", "src/design/ui/overlay/"];

const FIXED_CLASS = /(?<![\w-])fixed(?![\w-])/;
const FIXED_CSS = /position\s*:\s*fixed/;
// window.confirm( / confirm( sueltos; no `algo.prompt(` (p. ej. deferredPrompt.prompt()).
const NATIVE_DIALOG = /(?:\bwindow\.|(?<![.\w$/]))(confirm|alert|prompt)\s*\(/;

// Saca los comentarios (los reemplaza por espacios, conservando los saltos de
// línea para no correr los números) sin confundir un "/*" o "//" adentro de un
// string (p. ej. accept="image/*" o "https://"). Las comillas simples y dobles
// cortan en el fin de línea, así un apóstrofo en texto JSX no se come el archivo.
function stripComments(text, isCss) {
  let out = "";
  let i = 0;
  let quote = null; // ' " `
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) quote = null;
      i += 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (!isCss && c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      if (c === "'" || c === '"' || (!isCss && c === "`")) quote = c;
      out += c;
      i += 1;
    }
  }
  return out;
}

// Devuelve [{ line, rule, text }] para un archivo. `relPath` relativo a futbol-mvp-web/.
export function scanSource(relPath, text) {
  const normalized = relPath.split(path.sep).join("/");
  const isCss = normalized.endsWith(".css");
  const fixedAllowed = FIXED_ALLOWED.some((dir) => normalized.startsWith(dir));
  const lines = stripComments(text, isCss).split("\n");
  const found = [];
  lines.forEach((line, i) => {
    if (!fixedAllowed && (isCss ? FIXED_CSS.test(line) : FIXED_CLASS.test(line) || FIXED_CSS.test(line))) {
      found.push({ line: i + 1, rule: "fixed", text: line.trim() });
    }
    if (!isCss && NATIVE_DIALOG.test(line)) {
      found.push({ line: i + 1, rule: "native-dialog", text: line.trim() });
    }
  });
  return found;
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return listFiles(full);
      return EXTENSIONS.has(path.extname(e.name)) ? [full] : [];
    })
  );
  return files.flat();
}

const MESSAGES = {
  fixed: "`fixed` fuera del shell y de las primitivas: usá Sheet/Dialog/ActionSheet/toast (src/design/ui/overlay) o un componente de src/shell.",
  "native-dialog": "diálogo nativo: usá <Dialog> (o toast) de src/design/ui/overlay.",
};

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = await listFiles(path.join(root, "src"));
  const problems = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    if (/\.test\.[jt]sx?$/.test(rel)) continue;
    const text = await fs.readFile(file, "utf8");
    for (const p of scanSource(rel, text)) problems.push({ file: rel, ...p });
  }
  if (problems.length === 0) {
    console.log(`check-overlays: OK (${files.length} archivos)`);
    return;
  }
  for (const p of problems) {
    console.error(`${p.file}:${p.line}  ${MESSAGES[p.rule]}\n    ${p.text}`);
  }
  console.error(`\ncheck-overlays: ${problems.length} problema(s).`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
