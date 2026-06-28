// Radar de atributos (M5) — SVG puro, sin dependencias.
// profile: [{ code, value }] con value de 0 a 1 (fraccion de votos que marcaron el atributo).

const RADAR_LABELS = {
  EQUIPO: "Equipo",
  VISION: "Visión",
  INTENSIDAD: "Intensidad",
  DEFENSA: "Defensa",
  ATAQUE: "Ataque",
  FAIRPLAY: "Fair Play",
};
const ORDER = ["EQUIPO", "VISION", "INTENSIDAD", "DEFENSA", "ATAQUE", "FAIRPLAY"];

function pointAt(cx, cy, r, i, value) {
  const ang = -Math.PI / 2 + i * (Math.PI / 3); // 6 ejes, arranca arriba
  return [cx + r * value * Math.cos(ang), cy + r * value * Math.sin(ang)];
}

export default function AttributeRadar({ profile, size = 220 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 38; // margen para labels

  const byCode = Object.fromEntries((profile || []).map((p) => [p.code, Number(p.value) || 0]));
  const hasData = ORDER.some((c) => (byCode[c] || 0) > 0);

  const rings = [0.5, 1].map((level) =>
    ORDER.map((_, i) => pointAt(cx, cy, r, i, level).join(",")).join(" ")
  );

  const valuePts = ORDER.map((code, i) => pointAt(cx, cy, r, i, byCode[code] || 0).join(",")).join(" ");

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Perfil de atributos">
        {/* Rings */}
        {rings.map((pts, idx) => (
          <polygon key={idx} points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        ))}
        {/* Ejes */}
        {ORDER.map((_, i) => {
          const [x, y] = pointAt(cx, cy, r, i, 1);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />;
        })}
        {/* Poligono de valores */}
        {hasData && (
          <polygon
            points={valuePts}
            fill="rgba(16,185,129,0.25)"
            stroke="rgb(16,185,129)"
            strokeWidth="2"
          />
        )}
        {/* Labels */}
        {ORDER.map((code, i) => {
          const [x, y] = pointAt(cx, cy, r + 18, i, 1);
          return (
            <text
              key={code}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="10"
              fill="rgba(255,255,255,0.7)"
            >
              {RADAR_LABELS[code] || code}
            </text>
          );
        })}
      </svg>
      {!hasData && (
        <div className="-mt-2 text-xs text-white/50">Todavía no hay atributos suficientes.</div>
      )}
    </div>
  );
}
