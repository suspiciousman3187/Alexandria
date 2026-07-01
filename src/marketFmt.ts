export const fmtGilStr = (s?: string) => {
  if (!s) return '';
  const n = Number(String(s).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 1000 ? n.toLocaleString() : s;
};

export function rateInfo(rateStr?: string): { label: string; perDay: string; cls: string } | null {
  if (!rateStr) return null;
  const r = Number(rateStr);
  if (!Number.isFinite(r) || r <= 0) return null;
  const perDay = String(parseFloat(r.toFixed(r < 1 ? 3 : 1)));
  if (r < 0.5) return { label: 'Slow', perDay, cls: 'text-amber-300' };
  if (r < 2) return { label: 'Average', perDay, cls: 'text-sky-300' };
  if (r < 10) return { label: 'Fast', perDay, cls: 'text-emerald-300' };
  return { label: 'Very Fast', perDay, cls: 'text-emerald-300' };
}
