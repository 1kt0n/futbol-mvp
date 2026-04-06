export default function AuthLayout({ hero, card, footer }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-zinc-950 via-zinc-950 to-black px-4 py-8 text-white">
      <div className="w-full max-w-md space-y-5">
        {hero}
        {card}
      </div>
      {footer ? <div className="mt-6 pb-4 text-center text-xs text-white/35">{footer}</div> : null}
    </div>
  );
}
