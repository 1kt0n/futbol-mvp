import Card from "../../design/ui/Card.jsx";

export default function BrandHero() {
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-400/15 blur-3xl" aria-hidden="true" />
      <div className="absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-amber-300/15 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <img src="/tercer-tiempo-logo.png" alt="Tercer Tiempo FC" className="h-14 w-14 rounded-2xl border border-white/20 bg-white/10 p-1 object-cover" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Organiza torneos y partidos como un profesional.</h1>
        <p className="mt-2 text-sm text-white/70">Gestion rapida, resultados en vivo y modo TV para compartir la fecha.</p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-amber-200/90">Cancha</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="h-12 rounded-lg border border-emerald-300/30 bg-emerald-500/10" />
            <div className="h-12 rounded-lg border border-emerald-300/30 bg-emerald-500/10" />
            <div className="h-12 rounded-lg border border-emerald-300/30 bg-emerald-500/10" />
          </div>
        </div>
      </div>
    </Card>
  );
}

