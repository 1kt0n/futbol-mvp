import { QRCodeSVG } from "qrcode.react";
import Card from "../../../../design/ui/Card.jsx";

export default function ShareTab({ link, onCopy }) {
  const tvLink = link ? link.replace(/\/tournaments\/(.+?)\?/, "/tournaments/$1/tv?") : "";

  return (
    <Card data-testid="tournament-share-tab">
      <h3 className="text-lg font-semibold">Compartir</h3>
      <p className="mt-1 text-sm text-white/60">Link publico, QR y acceso rapido a modo TV.</p>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm break-all text-white/80">{link || "-"}</div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!link} data-testid="share-copy-link-btn" onClick={onCopy} className="focus-ring rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">Copiar link</button>
            <a href={link || "#"} target="_blank" rel="noreferrer" data-testid="share-open-public-link" className="focus-ring rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">Ver pagina publica</a>
            <a href={tvLink || "#"} target="_blank" rel="noreferrer" data-testid="share-open-tv-link" className="focus-ring rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">Ver modo TV</a>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          {link ? (
            <div className="grid place-items-center gap-2">
              <QRCodeSVG value={link} size={180} bgColor="#0a0a0a" fgColor="#f5f5f5" />
              <div className="text-xs text-white/60">QR publico</div>
            </div>
          ) : (
            <div className="text-sm text-white/60">Sin link publico disponible.</div>
          )}
        </div>
      </div>
    </Card>
  );
}

