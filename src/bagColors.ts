export type BagColor = { text: string; pill: string; dot: string };

const COLORS: Record<number, BagColor> = {
  0: { text: 'text-emerald-300', pill: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400' },
  1: { text: 'text-sky-300', pill: 'text-sky-300 bg-sky-500/10 border-sky-500/20', dot: 'bg-sky-400' },
  9: { text: 'text-teal-300', pill: 'text-teal-300 bg-teal-500/10 border-teal-500/20', dot: 'bg-teal-400' },
  2: { text: 'text-amber-300', pill: 'text-amber-300 bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400' },
  4: { text: 'text-violet-300', pill: 'text-violet-300 bg-violet-500/10 border-violet-500/20', dot: 'bg-violet-400' },
  5: { text: 'text-rose-300', pill: 'text-rose-300 bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-400' },
  6: { text: 'text-orange-300', pill: 'text-orange-300 bg-orange-500/10 border-orange-500/20', dot: 'bg-orange-400' },
  7: { text: 'text-lime-300', pill: 'text-lime-300 bg-lime-500/10 border-lime-500/20', dot: 'bg-lime-400' },
  8: { text: 'text-indigo-300', pill: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20', dot: 'bg-indigo-400' },
  10: { text: 'text-fuchsia-300', pill: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20', dot: 'bg-fuchsia-400' },
  11: { text: 'text-cyan-300', pill: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20', dot: 'bg-cyan-400' },
  12: { text: 'text-pink-300', pill: 'text-pink-300 bg-pink-500/10 border-pink-500/20', dot: 'bg-pink-400' },
  13: { text: 'text-blue-300', pill: 'text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-400' },
  14: { text: 'text-purple-300', pill: 'text-purple-300 bg-purple-500/10 border-purple-500/20', dot: 'bg-purple-400' },
  15: { text: 'text-yellow-300', pill: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400' },
  16: { text: 'text-green-300', pill: 'text-green-300 bg-green-500/10 border-green-500/20', dot: 'bg-green-400' },
  17: { text: 'text-zinc-300', pill: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/20', dot: 'bg-zinc-400' },
  3: { text: 'text-slate-300', pill: 'text-slate-300 bg-slate-500/10 border-slate-500/20', dot: 'bg-slate-400' },
};

const FALLBACK: BagColor = { text: 'text-fg-4', pill: 'text-fg-4 bg-field border-line', dot: 'bg-fg-4' };

export function bagColor(id: number | undefined): BagColor {
  return (id != null && COLORS[id]) || FALLBACK;
}
