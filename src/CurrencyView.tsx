import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, broadcastCurrency, type KnownChar } from './bridge';
import { Segmented } from './ui';
import { useStars, toggleStar } from './currencyStars';
import { useSticky } from './sticky';
import { useCharScope, CharScopeBar } from './CharScope';
import { Collapse } from './overlay';
import { relTime, useNowTick } from './reltime';
import { useAnon } from './anonymize';

const fmt = (v: number | null) => (v == null ? '·' : v.toLocaleString());

type SortMode = 'name' | 'total';

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={on ? 'Unstar' : 'Star'}
      className={`shrink-0 transition-colors ${on ? 'text-amber-400 hover:text-amber-300' : 'text-fg-4/30 hover:text-fg-4 opacity-0 group-hover:opacity-100'} ${on ? '!opacity-100' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
    </button>
  );
}

export default function CurrencyView() {
  const known = useKnownCharacters();
  const anon = useAnon();
  useNowTick();
  const stars = useStars();
  const starSet = useMemo(() => new Set(stars), [stars]);
  const [updating, setUpdating] = useState(false);
  const [query, setQuery] = useSticky('cur.q', '');
  const [sort, setSort] = useSticky<SortMode>('cur.sort', 'total');
  const [starredOnly, setStarredOnly] = useSticky('cur.starred', false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (name: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });

  const chars = useMemo<KnownChar[]>(
    () => known.filter((c) => c.online || c.cur).sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)),
    [known],
  );
  const { scoped, exSet, toggle, reset } = useCharScope('cur.scope', chars);

  const valueFor = (c: KnownChar, name: string): number | null => {
    if (!c.cur) return null;
    if (name === 'Gil') return c.cur.gil;
    return c.cur.list.find((e) => e.n === name)?.v ?? 0;
  };

  const rows = useMemo(() => {
    const others: string[] = [];
    const seen = new Set<string>();
    for (const c of scoped) for (const e of c.cur?.list ?? []) if (!seen.has(e.n)) { seen.add(e.n); others.push(e.n); }
    const all = ['Gil', ...others];
    const built = all
      .map((name) => ({ name, total: scoped.reduce((s, c) => s + (valueFor(c, name) ?? 0), 0) }))
      .filter((r) => r.total > 0);
    const q = query.trim().toLowerCase();
    let filtered = q ? built.filter((r) => r.name.toLowerCase().includes(q)) : built;
    if (starredOnly) filtered = filtered.filter((r) => starSet.has(r.name));
    filtered.sort((a, b) => {
      if (a.name === 'Gil') return -1;
      if (b.name === 'Gil') return 1;
      return sort === 'total' ? b.total - a.total : a.name.localeCompare(b.name);
    });
    return filtered;
  }, [scoped, query, sort, starredOnly, starSet]);

  const hasData = chars.some((c) => c.cur);
  const onlineCount = chars.filter((c) => c.online).length;
  const lastSync = chars.reduce((m, c) => Math.max(m, c.curAt ?? 0), 0) || undefined;

  const update = () => {
    void broadcastCurrency();
    setUpdating(true);
    window.setTimeout(() => setUpdating(false), 2500);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={update}
            disabled={onlineCount === 0}
            className="shrink-0 px-4 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            {onlineCount === 0 ? 'No Characters Connected' : updating ? 'Updating…' : 'Update'}
          </button>

          {hasData && (
            <>
              <div className="relative flex-1 min-w-0">
                <svg viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-4 pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter Currencies"
                  className="pl-8 pr-7 py-1.5 w-full text-[12px] rounded-md bg-field border border-line text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-4 hover:text-fg">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
              </div>

              <div className="shrink-0">
                <Segmented
                  value={sort}
                  onChange={(v) => setSort(v as SortMode)}
                  options={[{ v: 'total', label: 'Total' }, { v: 'name', label: 'A-Z' }]}
                />
              </div>

              <button
                onClick={() => setStarredOnly((s) => !s)}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${
                  starredOnly ? 'bg-amber-400/15 border-amber-400/40 text-amber-300' : 'bg-field border-line text-fg-3 hover:text-fg-2'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={starredOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
                Starred
              </button>
            </>
          )}

          {!hasData && (
            <span className="text-[11px] text-fg-4">
              {onlineCount > 0 ? `Requests fresh currency from ${onlineCount} online character${onlineCount === 1 ? '' : 's'}` : 'Load the addon in-game to fetch currencies'}
            </span>
          )}
        </div>
        {hasData && (
          <CharScopeBar
            chars={chars}
            exSet={exSet}
            toggle={toggle}
            reset={reset}
            accessory={lastSync ? (
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-field border border-line text-[10px] font-semibold text-fg-3" title="Last time currency was refreshed">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
                Synced {relTime(lastSync)}
              </span>
            ) : undefined}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!hasData ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="max-w-sm">
              <div className="text-[14px] font-bold text-fg mb-1">No currency data yet</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">Hit <span className="text-fg-2 font-semibold">Update</span> to pull gil, Gallimaufry, Imprimaturs, Sparks and more from your connected characters. Only currencies above zero are shown.</div>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="text-[12px] text-fg-4">
              {query ? <>No currencies match <span className="text-fg-2 font-semibold">{query}</span>.</>
                : starredOnly ? <>No starred currencies yet. Click a <span className="text-amber-400">★</span> to pin one here.</>
                  : 'No currencies above zero.'}
            </div>
          </div>
        ) : (
          <div className="p-3">
            <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
              <AnimatePresence mode="popLayout" initial={false}>
              {rows.map(({ name, total }) => {
                const isGil = name === 'Gil';
                const open = expanded.has(name);
                const holders = scoped
                  .map((c) => ({ c, v: valueFor(c, name) }))
                  .sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
                const holdingCount = holders.filter((x) => (x.v ?? 0) > 0).length;
                return (
                  <motion.div
                    key={name}
                    layout="position"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className={isGil ? 'bg-accent/5' : ''}
                  >
                    <div
                      onClick={() => toggleExpand(name)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(name); } }}
                      className="le-tap group flex items-center gap-2 px-3 py-1.5 hover:bg-field/40 transition-colors cursor-pointer"
                    >
                      <Star on={starSet.has(name)} onClick={() => toggleStar(name)} />
                      <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2 font-medium">{name}</span>
                      <span className="tabular-nums text-[12px] font-semibold text-fg">{fmt(total)}</span>
                      <span className="shrink-0 w-10 text-right text-[10px] text-fg-4 tabular-nums">{holdingCount}/{scoped.length}</span>
                      <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                    </div>
                    <Collapse open={open}>
                      <div className="px-3 pb-2 pt-0.5 bg-field/10 flex flex-col gap-0.5">
                        {holders.length === 0 ? (
                          <div className="text-[11px] text-fg-4 py-1 pl-6">No character holds this.</div>
                        ) : (
                          holders.map(({ c, v }) => (
                            <div key={c.name} className="flex items-center gap-2 text-[11px] pl-6 py-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                              <span className="min-w-0 truncate text-fg-3">{anon(c.name)}</span>
                              {!c.online && c.curAt && <span className="text-[10px] text-fg-4/70 shrink-0">{relTime(c.curAt)}</span>}
                              <span className={`ml-auto tabular-nums ${(v ?? 0) > 0 ? 'text-fg-2' : 'text-fg-4/50'}`}>{fmt(v)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </Collapse>
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
