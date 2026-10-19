// Botón flotante de acción (FAB). Es parte del shell: flota arriba de la barra
// inferior, en la capa z-fab, y respeta el safe-area del iPhone.

export default function Fab({ onClick, label, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="focus-ring fixed right-5 z-fab grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-2xl font-bold text-zinc-950 shadow-2xl shadow-emerald-500/40 hover:bg-emerald-400"
      style={{ bottom: "calc(var(--tabbar-h) + 1.25rem + env(safe-area-inset-bottom))" }}
    >
      {children}
    </button>
  );
}
