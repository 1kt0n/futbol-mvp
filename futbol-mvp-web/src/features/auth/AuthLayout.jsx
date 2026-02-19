export default function AuthLayout({ hero, card, footer }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-8 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        {hero}
        {card}
      </div>
      {footer ? <div className="pb-6 text-center text-xs text-white/35">{footer}</div> : null}
    </div>
  );
}

