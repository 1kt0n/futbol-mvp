// Teclado virtual: mientras haya una hoja abierta, --kb-inset es lo que el
// teclado tapa de abajo. La hoja sube y se achica con eso, así el footer (con el
// botón principal) queda arriba del teclado en iOS y en Android.
// Con contador, porque puede haber hojas anidadas.

import { useEffect } from "react";

let users = 0;
let detach = null;

function attach() {
  const vv = window.visualViewport;
  if (!vv) return null;
  const root = document.documentElement;
  const update = () => {
    // Con zoom de pellizco el viewport visual también se achica: no es teclado.
    const zoomed = Math.abs(vv.scale - 1) > 0.01;
    const inset = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty("--kb-inset", `${inset}px`);
  };
  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    root.style.removeProperty("--kb-inset");
  };
}

export function useKeyboardInset() {
  useEffect(() => {
    users += 1;
    if (users === 1) detach = attach();
    return () => {
      users -= 1;
      if (users === 0) {
        detach?.();
        detach = null;
      }
    };
  }, []);
}

// Al enfocar un campo, esperar a que el teclado termine de subir y dejarlo a la vista.
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
export function revealOnFocus(e) {
  const el = e.target;
  if (!el || !FIELD.test(el.tagName)) return;
  window.setTimeout(() => {
    if (document.activeElement === el) el.scrollIntoView({ block: "nearest" });
  }, 300);
}
