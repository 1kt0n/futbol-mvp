import { describe, expect, it } from "vitest";
import { scanSource } from "../../../../scripts/check-overlays.mjs";

const rules = (path, text) => scanSource(path, text).map((p) => `${p.line}:${p.rule}`);

describe("check-overlays", () => {
  it("detecta la clase fixed fuera del shell y de las primitivas", () => {
    expect(rules("src/AdminPanel.jsx", '<div className="fixed inset-0 z-50">')).toEqual(["1:fixed"]);
    expect(rules("src/x.jsx", "const cls = `fixed bottom-0`;")).toEqual(["1:fixed"]);
    expect(rules("src/x.jsx", 'style={{ position: "fixed" }}')).toEqual(["1:fixed"]);
    expect(rules("src/index.css", ".x {\n  position: fixed;\n}")).toEqual(["2:fixed"]);
  });

  it("permite fixed en src/shell y en src/design/ui/overlay", () => {
    expect(rules("src/shell/BottomNav.jsx", '<nav className="fixed inset-x-0 bottom-0">')).toEqual([]);
    expect(rules("src/design/ui/overlay/overlay.css", ".ov-layer { position: fixed; }")).toEqual([]);
  });

  it("no confunde palabras parecidas ni comentarios", () => {
    expect(rules("src/x.jsx", '<div className="sticky top-0 prefixed fixed-width">')).toEqual([]);
    expect(rules("src/x.jsx", "// esto antes era fixed\n/* position: fixed */\nconst a = 1;")).toEqual([]);
    expect(rules("src/index.css", "/* todo position:fixed adentro */\n.a { color: red; }")).toEqual([]);
  });

  it("un /* o // adentro de un string no esconde lo que sigue", () => {
    const text = [
      '<input accept="image/*" />',
      '<div className="fixed inset-0" />',
      "if (!window.confirm('¿Seguro?')) return",
      "{/* comentario */}",
      'const url = "https://example.com"; const x = "fixed";',
    ].join("\n");
    expect(rules("src/Profile.jsx", text)).toEqual(["2:fixed", "3:native-dialog", "5:fixed"]);
  });

  it("detecta diálogos nativos", () => {
    expect(rules("src/x.jsx", "if (!window.confirm('¿Seguro?')) return")).toEqual(["1:native-dialog"]);
    expect(rules("src/x.jsx", "alert('PIN inválido')")).toEqual(["1:native-dialog"]);
    expect(rules("src/x.jsx", "const r = window.prompt('Motivo')")).toEqual(["1:native-dialog"]);
  });

  it("no marca métodos con el mismo nombre", () => {
    expect(rules("src/x.jsx", "deferredPrompt.prompt();")).toEqual([]);
    expect(rules("src/x.jsx", "onConfirm(); handleConfirm(); confirmPendingCancel();")).toEqual([]);
    expect(rules("src/x.jsx", 'fetch("https://example.com/confirm(")')).toEqual([]);
  });
});
