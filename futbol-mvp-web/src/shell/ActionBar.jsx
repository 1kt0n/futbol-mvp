// Barra de acción de una pantalla ("Me anoto", "No puedo ir"), fija arriba de la
// barra inferior (rediseño UX §5.3). Publica su alto en --actionbar-h: la pantalla
// lo usa para no quedar tapada y los toasts (--toast-bottom) para ir encima.

import { useLayoutEffect, useRef } from "react";

export default function ActionBar({ children, testId }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return undefined;
    const apply = () => root.style.setProperty("--actionbar-h", `${el.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--actionbar-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid={testId}
      className="fixed inset-x-0 z-sticky border-t border-white/10 bg-zinc-950/95 backdrop-blur"
      style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-lg px-4 py-3">{children}</div>
    </div>
  );
}
