import { useMemo } from 'react';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { itemNameMatches, itemStack, useItemNames } from './itemNames';
import { IconInner } from './atlasIcon';
import { Group, CharacterSelect, SearchInput, SectionTabs } from './ui';
import { useSettings } from './settings';
import { useItemValues } from './priceStore';
import { openAhDetail } from './ahNav';
import { useSticky } from './sticky';
import { useNetworthBlacklist, addBlacklist, removeBlacklist } from './networthBlacklist';

const ALL = 'All Characters';

const listedTone = (n: number | null | undefined) =>
  n == null ? '' : n === 0 ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : n <= 3 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';

function SmallIcon({ id, n, assets, iconSet }: { id: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={28} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

export default function NetworthView() {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const world = useSettings().ahServer || known.find((c) => c.online)?.server;

  const [tab, setTab] = useSticky('networth.tab', 'networth' as 'networth' | 'blacklist');
  const [scope, setScope] = useSticky('networth.scope', ALL);
  const [q, setQ] = useSticky('networth.filter', '');
  const chars = useMemo(() => [{ name: ALL, online: true }, ...known.map((k) => ({ name: k.name, online: k.online }))], [known]);
  const active = scope !== ALL && known.some((k) => k.name === scope) ? scope : ALL;

  const source = useMemo(() => (active === ALL ? known : known.filter((k) => k.name === active)), [known, active]);

  const entries = useMemo(() => {
    const m = new Map<number, { id: number; n: string; count: number }>();
    for (const c of source) {
      for (const b of c.inv ?? []) for (const it of b.items) {
        if (!it.id || ((it.f ?? 0) & 0x0A) || (it.aug && it.aug.length > 0)) continue;
        const e = m.get(it.id);
        if (e) e.count += it.c; else m.set(it.id, { id: it.id, n: it.n, count: it.c });
      }
    }
    return [...m.values()];
  }, [source]);

  // c.gil is the live (online) value; offline characters keep their gil in their persisted currency
  // snapshot (cur.gil), so fall back to it -- every character ever connected counts, not just online.
  const gil = useMemo(() => source.reduce((s, c) => s + (c.gil ?? c.cur?.gil ?? 0), 0), [source]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const values = useItemValues(world, ids);

  const blacklist = useNetworthBlacklist();
  const ranked = useMemo(() => entries
    .map((e) => { const v = values.get(e.id); return { ...e, median: v?.median ?? 0, listed: v?.listedTotal, total: (v?.median ?? 0) * e.count }; })
    .filter((e) => e.median > 0)
    .sort((a, b) => b.total - a.total), [entries, values]);

  const visible = useMemo(() => ranked.filter((e) => !blacklist.has(e.id)), [ranked, blacklist]);
  const excludedCount = useMemo(() => ranked.reduce((n, e) => n + (blacklist.has(e.id) ? 1 : 0), 0), [ranked, blacklist]);

  const itemsTotal = useMemo(() => visible.reduce((s, e) => s + e.total, 0), [visible]);
  const grand = itemsTotal + gil;
  const priced = visible.length;
  const pct = entries.length ? Math.round((priced / entries.length) * 100) : 0;

  const [minLog, maxLog] = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const e of visible) { const l = Math.log(e.total); if (l < mn) mn = l; if (l > mx) mx = l; }
    return [mn, mx];
  }, [visible]);
  const valueColor = (total: number) => {
    const denom = maxLog - minLog;
    const t = denom > 0 ? Math.min(1, Math.max(0, (Math.log(total) - minLog) / denom)) : 1;
    return `hsl(${(t * 130).toFixed(0)}, 72%, 58%)`;
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? visible.filter((e) => itemNameMatches(e.id, e.n, query)) : visible;
  }, [visible, q]);

  const itemNames = useItemNames();
  const nameById = useMemo(() => { const m = new Map<number, string>(); for (const it of itemNames) m.set(it.id, it.n); return m; }, [itemNames]);
  const blIds = useMemo(() => [...blacklist], [blacklist]);
  const blValues = useItemValues(world, blIds);
  const blHeld = useMemo(() => {
    const m = new Map<number, { n: string; count: number }>();
    if (blacklist.size === 0) return m;
    for (const c of known) for (const b of c.inv ?? []) for (const it of b.items) {
      if (!it.id || !blacklist.has(it.id)) continue;
      if (((it.f ?? 0) & 0x0A) || (it.aug && it.aug.length > 0)) continue;
      const e = m.get(it.id); if (e) e.count += it.c; else m.set(it.id, { n: it.n, count: it.c });
    }
    return m;
  }, [known, blacklist]);
  const blList = useMemo(() => blIds.map((id) => {
    const held = blHeld.get(id);
    const median = blValues.get(id)?.median ?? 0;
    const count = held?.count ?? 0;
    return { id, n: held?.n ?? nameById.get(id) ?? `Item ${id}`, count, median, total: median * count };
  }).sort((a, b) => b.total - a.total), [blIds, blHeld, blValues, nameById]);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 p-3 border-b border-line flex flex-col gap-2">
        <SectionTabs value={tab} onChange={setTab} tabs={[
          { id: 'networth', label: 'Net Worth' },
          { id: 'blacklist', label: <>Blacklist{blacklist.size > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{blacklist.size}</span>}</> },
        ]} />
        {tab === 'networth' && (
          <div className="flex items-center gap-2">
            <div className="w-48"><CharacterSelect value={active} onChange={setScope} chars={chars} /></div>
            <SearchInput value={q} onChange={setQ} placeholder="Filter holdings…" className="flex-1 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {tab === 'blacklist' ? (
          blList.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-16 text-center text-[12px] text-fg-4">Nothing blacklisted. Use the exclude button on any Net Worth item to hide it from your total.</div>
          ) : (
            <Group title="Blacklisted Items" right={<span className="text-[11px] text-fg-4 tabular-nums">{blList.length}</span>}>
              <div className="divide-y divide-line">
                {blList.map((h) => (
                  <div key={h.id} className="w-full flex items-center gap-3 px-3 py-2">
                    <div className="opacity-60"><SmallIcon id={h.id} n={h.n} assets={assetsAny} iconSet={iconSet} /></div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-fg-3">{h.n}{h.count > 1 ? ` ×${h.count}` : ''}</span>
                      <div className="text-[10px] text-fg-4 tabular-nums">{h.count === 0 ? 'not currently held' : h.median > 0 ? `${h.median.toLocaleString()} G ea · would add ${h.total.toLocaleString()} G` : 'no market price'}</div>
                    </div>
                    <button onClick={() => removeBlacklist(h.id)} title="Count in net worth again" className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-line text-fg-3 hover:text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-colors">Restore</button>
                  </div>
                ))}
              </div>
            </Group>
          )
        ) : !world ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-16 text-center text-[12px] text-fg-4">Connect a character or set a market world in Settings to value your holdings.</div>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-fg-4">Estimated Net Worth</div>
              <div className="mt-1 text-[30px] font-extrabold tabular-nums text-amber-300 leading-none">{grand.toLocaleString()}<span className="text-[13px] text-fg-4 ml-1">G</span></div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
                <span className="text-fg-4">Items <span className="text-fg-2 font-semibold tabular-nums">{itemsTotal.toLocaleString()} G</span></span>
                <span className="text-fg-4">Gil <span className="text-fg-2 font-semibold tabular-nums">{gil.toLocaleString()}</span></span>
                <span className="text-fg-4">Valued <span className="text-fg-2 font-semibold tabular-nums">{priced}/{entries.length}</span></span>
                {excludedCount > 0 && <span className="text-fg-4">Excluded <span className="text-red-300 font-semibold tabular-nums">{excludedCount}</span></span>}
              </div>
              {priced < entries.length && (
                <div className="mt-2.5 h-1 rounded bg-field overflow-hidden"><div className="h-full bg-accent/60 transition-all" style={{ width: `${pct}%` }} /></div>
              )}
            </div>

            <Group title="Holdings" right={<span className="text-[11px] text-fg-4 tabular-nums">{q.trim() ? `${filtered.length}/${visible.length}` : visible.length}</span>}>
              {filtered.length === 0 ? (
                <div className="px-3.5 py-8 text-center text-[12px] text-fg-4">{ranked.length === 0 ? 'Valuing sellable items…' : q.trim() ? 'No holdings match.' : 'All valued items are excluded.'}</div>
              ) : (
                <div className="divide-y divide-line">
                  {filtered.map((h) => (
                    <div key={h.id} className="group le-tap w-full flex items-center gap-1 pr-2 hover:bg-field transition-colors">
                      <button onClick={() => openAhDetail({ id: h.id, n: h.n, st: itemStack(h.id), back: 'networth' })} className="min-w-0 flex-1 flex items-center gap-3 px-3 py-2 text-left">
                        <SmallIcon id={h.id} n={h.n} assets={assetsAny} iconSet={iconSet} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] text-fg-2">{h.n}</span>
                            {h.count > 1 && <span className="shrink-0 tabular-nums font-bold text-accent rounded bg-accent/15 leading-none text-[12px] px-1.5 py-0.5">×{h.count}</span>}
                          </div>
                          <div className="text-[10px] text-fg-4 tabular-nums"><span className="font-semibold text-amber-300">{h.median.toLocaleString()} G</span> ea</div>
                        </div>
                        {h.listed != null && (
                          <span className={`shrink-0 inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-md border tabular-nums leading-none ${listedTone(h.listed)}`}>
                            <span className="text-[12px] font-extrabold">{h.listed}</span>
                            <span className="text-[8px] font-bold uppercase tracking-wide opacity-80">listed</span>
                          </span>
                        )}
                        <span className="shrink-0 w-20 text-right text-[14px] font-bold tabular-nums" style={{ color: valueColor(h.total) }}>{h.total.toLocaleString()}<span className="text-[9px] text-fg-4 ml-0.5">G</span></span>
                      </button>
                      <button onClick={() => addBlacklist(h.id)} title="Exclude from net worth" aria-label="Exclude from net worth" className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
