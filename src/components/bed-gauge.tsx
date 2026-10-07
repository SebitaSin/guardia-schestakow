import { cn } from "@/lib/utils";

/** Medidor de aguja: el máximo es el total de camas del servicio y la aguja marca las ocupadas. */
export function BedGauge({ ocupadas, total, vigente }: { ocupadas: number; total: number; vigente: boolean }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, ocupadas / total)) : 0;
  const tone = !vigente ? "text-muted" : ratio >= 0.85 ? "text-danger" : ratio >= 0.6 ? "text-warn" : "text-ok";
  const angle = Math.PI * (1 - ratio); // 180° (vacío, izquierda) → 0° (lleno, derecha)
  const point = (radius: number, at: number) => `${(60 + radius * Math.cos(at)).toFixed(2)} ${(62 - radius * Math.sin(at)).toFixed(2)}`;
  const ticks = total > 0 && total <= 30 ? Array.from({ length: total + 1 }, (_, index) => Math.PI * (1 - index / total)) : [Math.PI, Math.PI * 0.75, Math.PI / 2, Math.PI / 4, 0];
  return (
    <svg viewBox="0 0 120 78" className={cn("w-full", tone)} role="img" aria-label={`${ocupadas} camas ocupadas de ${total}`}>
      <path d={`M ${point(46, Math.PI)} A 46 46 0 0 1 ${point(46, 0)}`} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-border" />
      {ratio > 0 ? <path d={`M ${point(46, Math.PI)} A 46 46 0 0 1 ${point(46, angle)}`} fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" /> : null}
      {ticks.map((at, index) => <line key={index} x1={point(36, at).split(" ")[0]} y1={point(36, at).split(" ")[1]} x2={point(39.5, at).split(" ")[0]} y2={point(39.5, at).split(" ")[1]} strokeWidth="0.8" className="stroke-muted" opacity="0.6" />)}
      <line x1="60" y1="62" x2={point(34, angle).split(" ")[0]} y2={point(34, angle).split(" ")[1]} strokeWidth="2.6" strokeLinecap="round" className="stroke-fg" />
      <circle cx="60" cy="62" r="4.2" className="fill-fg" />
      <text x="14" y="76" textAnchor="middle" fontSize="8" className="fill-muted">0</text>
      <text x="106" y="76" textAnchor="middle" fontSize="8" fontWeight="600" className="fill-muted">{total}</text>
      <text x="60" y="48" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{ocupadas}</text>
    </svg>
  );
}
