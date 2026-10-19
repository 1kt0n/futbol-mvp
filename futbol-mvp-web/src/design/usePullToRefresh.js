// Tirar hacia abajo desde arriba de todo para recargar (Home y pantalla del partido).
import { useRef, useState } from "react";

export function usePullToRefresh(onRefresh) {
  const [pulling, setPulling] = useState(false);
  const [pullY, setPullY] = useState(0);
  const startYRef = useRef(0);
  const activeRef = useRef(false);

  function onTouchStart(e) {
    if (window.scrollY > 5) return;
    startYRef.current = e.touches[0].clientY;
    activeRef.current = true;
  }

  function onTouchMove(e) {
    if (!activeRef.current) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0) { setPullY(0); return; }
    setPulling(true);
    setPullY(Math.min(delta * 0.45, 80));
  }

  function onTouchEnd() {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (pullY >= 60) onRefresh();
    setPulling(false);
    setPullY(0);
  }

  return { pulling, pullY, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
