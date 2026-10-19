// Hooks para los formularios que van adentro de un <Sheet>.
import { useContext, useEffect } from "react";
import { SheetContext } from "./sheetContext.js";

// El formulario de adentro avisa si tiene cambios sin guardar.
export function useSheetDirty(dirty) {
  const ctx = useContext(SheetContext);
  const setDirty = ctx?.setDirty;
  useEffect(() => {
    if (!setDirty) return undefined;
    setDirty(Boolean(dirty));
    return () => setDirty(false);
  }, [setDirty, dirty]);
}

// El formulario de adentro avisa que hay un request en curso: la hoja no se cierra.
export function useSheetBusy(busy) {
  const ctx = useContext(SheetContext);
  const setBusy = ctx?.setBusy;
  useEffect(() => {
    if (!setBusy) return undefined;
    setBusy(Boolean(busy));
    return () => setBusy(false);
  }, [setBusy, busy]);
}

// Cierre "con guarda" desde un botón propio (por ejemplo, "Cancelar").
export function useSheetClose() {
  const ctx = useContext(SheetContext);
  return () => ctx?.requestClose("button");
}
