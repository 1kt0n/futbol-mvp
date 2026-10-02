import { useEffect, useState } from 'react'

/** Fecha actual que se refresca cada `ms` (para cuentas regresivas y "próximo partido"). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
