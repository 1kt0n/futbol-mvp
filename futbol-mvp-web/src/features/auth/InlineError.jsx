export default function InlineError({ children }) {
  if (!children) return null;
  return (
    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
      {children}
    </div>
  );
}

