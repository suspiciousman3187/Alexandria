import { useMemo, useRef, useState } from 'react';
import { useAvailableIcons } from './bridge';
import { useItemNames, itemNameMatches, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { Popover } from './overlay';

export function ItemSearchAdd({ onAdd, placeholder, exclude, assets, className }: {
  onAdd: (name: string) => void;
  placeholder?: string;
  exclude?: (name: string) => boolean;
  assets?: string;
  className?: string;
}) {
  const iconSet = useAvailableIcons();
  const db = useItemNames();
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [] as ItemName[];
    const out: ItemName[] = [];
    const seen = new Set<string>();
    for (const it of db) {
      const ln = it.n.toLowerCase();
      if (seen.has(ln) || (exclude && exclude(it.n)) || !itemNameMatches(it.id, it.n, s)) continue;
      seen.add(ln); out.push(it); if (out.length >= 8) break;
    }
    return out;
  }, [db, q, exclude]);
  const commit = (name: string) => { const n = name.trim(); if (n) onAdd(n); setQ(''); };

  return (
    <div ref={wrapRef} className={`relative ${className ?? 'flex-1 min-w-0'}`}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(q); }}
        placeholder={placeholder ?? 'Search item…'}
        className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
      />
      <Popover open={matches.length > 0} anchor={wrapRef} className="rounded-md border border-line bg-popover shadow-2xl max-h-56 overflow-y-auto">
        {matches.map((it) => (
          <button key={it.id} onMouseDown={(e) => { e.preventDefault(); commit(it.n); }} className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-field transition-colors">
            <div className="shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={20} name={it.n} assets={assets} bmpHas={iconSet.has(it.id)} /></div>
            <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{it.n}</span>
          </button>
        ))}
      </Popover>
    </div>
  );
}
