import { useMemo, useRef, useState } from 'react';
import { useAvailableIcons, useKnownCharacters } from './bridge';
import { useItemNames, itemNameMatches, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { Popover } from './overlay';
import { useConsolidateIgnore, toggleConsolidateIgnore } from './consolidateIgnore';
import { useConsolidateTargetExclude, toggleConsolidateTargetExclude } from './consolidateTargetExclude';
import { useAnon } from './anonymize';

export default function ConsolidateExceptionsPanel() {
  const iconSet = useAvailableIcons();
  const db = useItemNames();
  const anon = useAnon();
  const known = useKnownCharacters();
  const targetExcluded = useConsolidateTargetExclude();
  const targetExclSet = useMemo(() => new Set(targetExcluded.map((n) => n.toLowerCase())), [targetExcluded]);
  const chars = useMemo(() => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)), [known]);
  const ignore = useConsolidateIgnore();
  const [q, setQ] = useState('');
  const inputWrap = useRef<HTMLDivElement | null>(null);

  const idByName = useMemo(() => { const m = new Map<string, number>(); for (const it of db) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); } return m; }, [db]);
  const ignoreSet = useMemo(() => new Set(ignore.map((n) => n.toLowerCase())), [ignore]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [] as ItemName[];
    const out: ItemName[] = [];
    const seen = new Set<string>();
    for (const it of db) { const ln = it.n.toLowerCase(); if (seen.has(ln) || ignoreSet.has(ln) || !itemNameMatches(it.id, it.n, s)) continue; seen.add(ln); out.push(it); if (out.length >= 8) break; }
    return out;
  }, [db, q, ignoreSet]);

  const items = useMemo(() => [...ignore].sort((a, b) => a.localeCompare(b)), [ignore]);
  const iconId = (n: string) => idByName.get(n.toLowerCase()) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-fg">Exception List</span>
          <span className="text-[11px] text-fg-4 tabular-nums">{items.length} item{items.length === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-fg-4 mt-2">Items defined here are excluded from the Consolidate List.</div>
        <div ref={inputWrap} className="relative mt-2.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item to add…" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
          <Popover open={matches.length > 0} anchor={inputWrap} className="rounded-md border border-line bg-popover shadow-2xl max-h-56 overflow-y-auto">
            {matches.map((it) => (
              <button key={it.id} onMouseDown={(e) => { e.preventDefault(); toggleConsolidateIgnore(it.n); setQ(''); }} className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-field transition-colors">
                <div className="shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={20} name={it.n} bmpHas={iconSet.has(it.id)} /></div>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{it.n}</span>
              </button>
            ))}
          </Popover>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-8">No exceptions yet. Add items you want kept out of the Consolidate list.</div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap gap-1.5">
            {items.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded bg-field border border-line px-1.5 py-0.5 text-[11px] text-fg-2">
                <div className="shrink-0 w-4 h-4 rounded bg-surface grid place-items-center overflow-hidden"><IconInner id={iconId(n)} size={16} name={n} bmpHas={iconId(n) > 0 && iconSet.has(iconId(n))} /></div>
                <span className="truncate max-w-[150px]">{n}</span>
                <button onClick={() => toggleConsolidateIgnore(n)} aria-label="Remove" className="shrink-0 grid place-items-center w-4 h-4 rounded text-fg-4 hover:text-red-400 transition-colors">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-fg">Excluded Collect Targets</span>
          <span className="text-[11px] text-fg-4 tabular-nums">{targetExcluded.length} character{targetExcluded.length === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-fg-4 mt-2 leading-snug">Prevents consolidating to the selected characters.</div>
        {chars.length === 0 ? (
          <div className="text-center text-[12px] text-fg-4 py-6">No characters known yet. Connect the addon on your characters.</div>
        ) : (
          <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
            {chars.map((c) => {
              const off = targetExclSet.has(c.name.toLowerCase());
              return (
                <button
                  key={c.name}
                  onClick={() => toggleConsolidateTargetExclude(c.name)}
                  title={off ? 'Excluded as a collector, click to allow' : 'Click to exclude as a collector'}
                  className={`flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-md text-[11px] border transition-colors ${off ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-line bg-field text-fg-3 hover:border-line-2'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                  <span className={`truncate flex-1 text-left ${off ? 'line-through opacity-80' : ''}`}>{anon(c.name)}</span>
                  {off && <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide">excl</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
