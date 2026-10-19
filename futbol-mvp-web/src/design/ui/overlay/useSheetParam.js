// La hoja (o el diálogo) abierta de una pantalla vive en la URL como
// ?sheet=<name>: el atrás de Android la cierra, un link la abre y recargar la
// deja abierta. Uno por pantalla:
//
//   const sheets = useSheetParam();
//   <button onClick={() => sheets.open("invite")}>Invitar</button>
//   <Sheet open={sheets.isOpen("invite")} onClose={sheets.close} history={sheets.history}>
//
// `current` es estado propio (no se lee la URL en cada render): react-router 7
// aplica las navegaciones en una transición, así que la URL y lo que pinta React
// pueden ir desfasados un momento. Se reconcilian cuando cambia location.key.
// Con el atrás del usuario, la hoja registrada en `history` decide si bloquea
// (cambios sin guardar, un diálogo encima, un request en curso): ahí se vuelve a
// poner el param y la hoja no se desmonta. La lógica está en sheetParamState.js.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  entryState,
  historyKeyOf,
  planClose,
  planOpen,
  readSheet,
  reconcileLocation,
  resolveBack,
  withSheet,
} from "./sheetParamState.js";

export function useSheetParam() {
  const location = useLocation();
  const navigate = useNavigate();
  const [current, setCurrentState] = useState(() => readSheet(location.search));
  const currentRef = useRef(current);
  const pendingRef = useRef(null);
  const closingRef = useRef(null);
  const backHandlerRef = useRef(null);
  const navigateRef = useRef(navigate);

  useLayoutEffect(() => {
    navigateRef.current = navigate;
  });

  const setCurrent = useCallback((value) => {
    currentRef.current = value;
    setCurrentState(value);
  }, []);

  // Navega a la entrada actual con ?sheet=<name> (o sin el param). Se lee el
  // history real y no el location de React, que puede venir atrasado.
  const go = useCallback((name, { replace, ours }) => {
    const { search, hash } = window.location;
    navigateRef.current(
      { search: withSheet(search, name), hash },
      { replace, state: entryState(window.history.state?.usr, ours ? name : null) }
    );
    pendingRef.current = { type: "go", key: historyKeyOf(window.history.state) };
  }, []);

  useLayoutEffect(() => {
    const result = reconcileLocation(
      { current: currentRef.current, pending: pendingRef.current },
      { key: location.key, sheet: readSheet(location.search), historyKey: historyKeyOf(window.history.state) }
    );
    pendingRef.current = result.pending;
    if (result.type === "set") {
      if (result.current !== currentRef.current) setCurrent(result.current);
    } else if (result.type === "ask") {
      const blocked = Boolean(backHandlerRef.current?.());
      const next = resolveBack({ current: currentRef.current, next: result.next, blocked });
      if (next.repush) go(next.repush, { replace: false, ours: true });
      else setCurrent(next.current);
    }
  }, [location.key, location.search, go, setCurrent]);

  const open = useCallback(
    (name) => {
      if (!name) return;
      const closing = closingRef.current !== null;
      if (!closing && currentRef.current === name) return;
      // Cancela el -1 de un close() de este mismo tick.
      closingRef.current = null;
      setCurrent(name);
      go(name, planOpen({ closing, search: window.location.search, historyState: window.history.state }));
    },
    [go, setCurrent]
  );

  const close = useCallback(() => {
    if (currentRef.current === null || closingRef.current !== null) return;
    setCurrent(null);
    const token = {};
    closingRef.current = token;
    // En un microtask: un open() en el mismo tick (cerrar una hoja y abrir otra)
    // reemplaza la entrada en vez de volver atrás y empujar otra.
    queueMicrotask(() => {
      if (closingRef.current !== token) return;
      closingRef.current = null;
      const plan = planClose({ search: window.location.search, historyState: window.history.state });
      if (plan === "back") {
        pendingRef.current = { type: "back", fromKey: historyKeyOf(window.history.state) };
        navigateRef.current(-1);
      } else if (plan === "replace") {
        go(null, { replace: true, ours: false });
      }
    });
  }, [go, setCurrent]);

  // Se pasa como <Sheet history={sheets.history}> (o al Dialog) de la hoja que
  // representa a `current`. fn() devuelve true para bloquear el atrás.
  const history = useMemo(
    () => ({
      register(fn) {
        backHandlerRef.current = fn;
        return () => {
          if (backHandlerRef.current === fn) backHandlerRef.current = null;
        };
      },
    }),
    []
  );

  const isOpen = useCallback((name) => current === name, [current]);

  return useMemo(() => ({ current, open, close, isOpen, history }), [current, open, close, isOpen, history]);
}
