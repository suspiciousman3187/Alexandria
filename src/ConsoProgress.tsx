import { useMemo } from 'react';
import { useConsolidate } from './consolidate';
import { useConsoQueue } from './consoQueue';
import { useAnon } from './anonymize';
import { useItemNames } from './itemNames';

export default function ConsoProgress() {
  const run = useConsolidate();
  const queue = useConsoQueue();
  const anon = useAnon();
  const db = useItemNames();
  const nameById = useMemo(() => { const m = new Map<number, string>(); for (const it of db) if (!m.has(it.id)) m.set(it.id, it.n); return m; }, [db]);

  if (!run.running && !queue.running) return null;

  const chars = run.order.map((n) => run.chars[n]).filter((c): c is NonNullable<typeof c> => !!c);
  const totalGoal = chars.reduce((s, c) => s + c.goal, 0);
  const totalSent = chars.reduce((s, c) => s + c.sent, 0);
  const pct = totalGoal > 0 ? Math.min(100, Math.round((totalSent / totalGoal) * 100)) : run.running ? 3 : 0;

  const active = run.order.find((n) => run.chars[n]?.status === 'trading') ?? run.order.find((n) => run.chars[n]?.status === 'moving');
  let text: string;
  if (run.running && active) {
    const cs = run.chars[active]!;
    text = cs.status === 'trading'
      ? `Trading ${anon(active)} → ${anon(run.collector)} · ${cs.sent}/${cs.goal}`
      : `Gathering from ${anon(active)}…`;
  } else if (run.running) {
    text = `Preparing ${anon(run.collector)}…`;
  } else {
    text = 'Starting next consolidation…';
  }
  if (queue.running && queue.jobs.length > 0) text += ` · ${queue.done.length}/${queue.jobs.length} queued done`;

  // The exact items the active character is consolidating right now, so a mass
  // run shows what is actually moving instead of just a running total.
  const activeItems = active ? (run.chars[active]?.items ?? []) : [];

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-b border-line">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-fg-2 font-semibold min-w-0 truncate">{text}</span>
        <span className="text-fg-4 tabular-nums shrink-0">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      {activeItems.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-fg-4 mt-0.5">
          {activeItems.map((t) => (
            <span key={t.id} className="whitespace-nowrap">{nameById.get(t.id) ?? `#${t.id}`}{t.want > 1 ? <span className="text-fg-3"> ×{t.want}</span> : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}
