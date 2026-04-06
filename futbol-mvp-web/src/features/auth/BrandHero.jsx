import { useRef } from "react";

export default function BrandHero({ onUnlockDebug }) {
  const tapCount = useRef(0);
  const tapTimer = useRef(null);

  function handleLogoTap() {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    if (tapCount.current >= 5) {
      tapCount.current = 0;
      onUnlockDebug?.();
      return;
    }
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 1500);
  }

  return (
    <div className="flex flex-col items-center text-center">
      <button type="button" onClick={handleLogoTap} className="focus:outline-none" aria-label="Logo">
        <img
          src="/tercertiempo_escudo_3d.png"
          alt="Tercer Tiempo FC"
          className="h-20 w-20 rounded-2xl border border-white/20 bg-white/10 p-1.5 object-cover"
        />
      </button>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Tercer Tiempo FC</h1>
      <p className="mt-1 text-sm text-white/50">Organiza torneos y partidos como un profesional.</p>
    </div>
  );
}
