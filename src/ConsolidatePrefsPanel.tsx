import { useMemo, useRef, useState } from 'react';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useAnon } from './anonymize';
import { useItemNames, itemNameMatches, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { Select } from './ui';
import { Popover } from './overlay';
import { useConsolidatePrefs, addConsolidateItem, removeConsolidateItem } from './consolidatePrefs';
import ConsolidatePrefsModal from './ConsolidatePrefsModal';

export default function ConsolidatePrefsPanel() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const prefs = useConsolidatePrefs();
  const db = useItemNames();
  const [modalOpen, setModalOpen] = useState(false);

  const chars = useMemo(() => known.map((k) => k.name).sort((a, b) => a.localeCompare(b)), [known]);
  const [char, setChar] = useState('');
  const activeChar = char || chars[0] || '';
  const [q, setQ] = useState('');
  const inputWrap = useRef<HTMLDivElement | null>(null);

  const idByName = useMemo(() => { const m = new Map<string, number>(); for (const it of db) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); } return m; }, [db]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [] as ItemName[];
    const out: ItemName[] = [];
    const seen = new Set<string>();
    for (const it of db) { const ln = it.n.toLowerCase(); if (seen.has(ln) || !itemNameMatches(it.id, it.n, s)) continue; seen.add(ln); out.push(it); if (out.length >= 8) break; }
    return out;
  }, [db, q]);

  const entries = useMemo(() => Object.entries(prefs).filter(([, v]) => v.length).sort((a, b) => a[0].localeCompare(b[0])), [prefs]);
  const total = entries.reduce((s, [, v]) => s + v.length, 0);
  const assetsFor = (name: string) => known.find((k) => k.name === name)?.assets;
  const iconId = (n: string) => idByName.get(n.toLowerCase()) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => setModalOpen(true)} disabled={total === 0} className="le-tap w-full px-3 py-2.5 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate By Preference</button>
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-fg">Preference List</span>
          <span className="text-[11px] text-fg-4 tabular-nums">{total} item{total === 1 ? '' : 's'} · {entries.length} character{entries.length === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-fg-4 mt-2">Items defined here will be consolidated to the designated character(s) when using Consolidate By Preference.</div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="w-40 shrink-0"><Select value={activeChar} onChange={setChar} options={chars} renderOption={(n) => anon(n)} renderValue={(n) => anon(n)} full /></div>
          <div ref={inputWrap} className="relative flex-1 min-w-0">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item to add…" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
            <Popover open={matches.length > 0} anchor={inputWrap} className="rounded-md border border-line bg-popover shadow-2xl max-h-56 overflow-y-auto">
              {matches.map((it) => (
                <button key={it.id} onMouseDown={(e) => { e.preventDefault(); if (activeChar) addConsolidateItem(activeChar, it.n); setQ(''); }} className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-field transition-colors">
                  <div className="shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={20} name={it.n} assets={assetsFor(activeChar)} bmpHas={iconSet.has(it.id)} /></div>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{it.n}</span>
                </button>
              ))}
            </Popover>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-8">No preferences yet. Pick a character and add the items they should always hold.</div>
      ) : (
        entries.map(([name, items]) => (
          <div key={name} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${known.find((k) => k.name === name)?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
              <span className="text-[12px] font-bold text-fg truncate">{anon(name)}</span>
              <span className="ml-auto text-[11px] text-fg-4 tabular-nums">{items.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((n) => (
                <span key={n} className="inline-flex items-center gap-1 rounded bg-field border border-line px-1.5 py-0.5 text-[11px] text-fg-2">
                  <div className="shrink-0 w-4 h-4 rounded bg-surface grid place-items-center overflow-hidden"><IconInner id={iconId(n)} size={16} name={n} assets={assetsFor(name)} bmpHas={iconId(n) > 0 && iconSet.has(iconId(n))} /></div>
                  <span className="truncate max-w-[150px]">{n}</span>
                  <button onClick={() => removeConsolidateItem(name, n)} aria-label="Remove" className="shrink-0 grid place-items-center w-4 h-4 rounded text-fg-4 hover:text-red-400 transition-colors">×</button>
                </span>
              ))}
            </div>
          </div>
        ))
      )}
      {modalOpen && <ConsolidatePrefsModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
