// Esqueleto de carga y estados vacíos de la pestaña Partido (§7.9).

import { Link } from "react-router-dom";

export function MatchSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white" aria-busy="true">
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-6">
        <div className="h-6 w-40 animate-pulse rounded-lg bg-white/10" />
        <div className="h-28 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
      </div>
      <span className="sr-only">Cargando el partido…</span>
    </div>
  );
}

export function MatchNotFound() {
  return (
    <EmptyState title="No encontramos ese partido." text="Puede que lo hayan borrado o que el link esté incompleto.">
      <Link to="/" className="focus-ring mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-500 px-4 text-base font-semibold text-black hover:bg-emerald-400">
        Ir al próximo partido
      </Link>
    </EmptyState>
  );
}

export function EmptyState({ title, text, children }) {
  return (
    <div className="page-enter min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-lg px-4 pt-10" data-testid="match-empty">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-2 text-base text-white/65">{text}</p>
        {children}
      </div>
    </div>
  );
}
