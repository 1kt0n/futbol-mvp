// Fecha local "YYYY-MM-DDTHH:mm" (lo que acepta un <input type="datetime-local">) a N días de hoy.
// Las listas de admin traen los más nuevos primero: con una fecha fija en el pasado, en una base
// con muchos datos el registro creado no aparece.
export function datetimeLocalInDays(days: number, hour = 20, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
