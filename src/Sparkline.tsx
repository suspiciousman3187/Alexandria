export type SparkPoint = { t: number; v: number };

export default function Sparkline({ points, className, height = 40 }: { points: SparkPoint[]; className?: string; height?: number }) {
  if (points.length < 2) return null;
  const W = 100, H = 32, pad = 2.5;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const sx = (t: number) => pad + ((t - minX) / spanX) * (W - 2 * pad);
  const sy = (v: number) => (H - pad) - ((v - minY) / spanY) * (H - 2 * pad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(2)},${sy(p.v).toFixed(2)}`).join(' ');
  const area = `${line} L${sx(maxX).toFixed(2)},${H} L${sx(minX).toFixed(2)},${H} Z`;
  const up = ys[ys.length - 1] >= ys[0];
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }} className={`${className ?? ''} ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      <path d={area} fill="currentColor" opacity="0.1" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(last.t)} cy={sy(last.v)} r="2.5" fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
