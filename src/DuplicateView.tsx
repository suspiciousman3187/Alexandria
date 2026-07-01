import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, type KnownChar } from './bridge';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { Select, Chip, SearchInput } from './ui';
import { useSticky } from './sticky';
import { useAnon } from './anonymize';

type Loc = { label: string; count: number; online?: boolean };
type Dupe = { id: number; n: string; total: number; locs: Loc[] };

function DIcon({ id, n, c, assets, iconSet }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number> }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

export default function DuplicateView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const [scope, setScope] = useSticky('dupe.scope', 'all');
  const [q, setQ] = useSticky('dupe.q', '');
  const [incRare, setIncRare] = useSticky('dupe.rare', false);
  const [incEx, setIncEx] = useSticky('dupe.ex', false);
  const [incUnstack, setIncUnstack] = useSticky('dupe.unstack', false);

  const withInv = useMemo(() => known.filter((c) => c.inv && c.inv.length), [known]);
  const scopeChar = scope === 'all' ? null : known.find((c) => c.name === scope);
  const assetsAny = useMemo(() => withInv.find((c) => c.assets)?.assets, [withInv]);

  const keepFlags = (f: number) => (incRare || !(f & 1)) && (incEx || !(f & 2)) && (incUnstack || !(f & 4));

  const dupes = useMemo<Dupe[]>(() => {
    const byId = new Map<number, { n: string; f: number; locs: Map<string, Loc> }>();

    const addLoc = (id: number, n: string, f: number, label: string, count: number, online?: boolean) => {
      let g = byId.get(id);
      if (!g) { g = { n, f, locs: new Map() }; byId.set(id, g); }
      g.locs.set(label, { label, count, online });
    };

    if (scope === 'all') {
      for (const c of withInv) {
        const per = new Map<number, { n: string; f: number; count: number }>();
        for (const bg of c.inv!) for (const it of bg.items) {
          const e = per.get(it.id);
          if (e) e.count += it.c; else per.set(it.id, { n: it.n, f: it.f ?? 0, count: it.c });
        }
        for (const [id, v] of per) addLoc(id, v.n, v.f, c.name, v.count, c.online);
      }
    } else if (scopeChar?.inv) {
      for (const bg of scopeChar.inv) {
        const per = new Map<number, { n: string; f: number; count: number }>();
        for (const it of bg.items) {
          const e = per.get(it.id);
          if (e) e.count += it.c; else per.set(it.id, { n: it.n, f: it.f ?? 0, count: it.c });
        }
        for (const [id, v] of per) addLoc(id, v.n, v.f, bg.b, v.count);
      }
    }

    const out: Dupe[] = [];
    const search = q.trim().toLowerCase();
    for (const [id, g] of byId) {
      if (g.locs.size < 2) continue;
      if (!keepFlags(g.f)) continue;
      if (search && !g.n.toLowerCase().includes(search)) continue;
      const locs = [...g.locs.values()].sort((a, b) => b.count - a.count);
      out.push({ id, n: g.n, total: locs.reduce((s, l) => s + l.count, 0), locs });
    }
    out.sort((a, b) => b.locs.length - a.locs.length || b.total - a.total || a.n.localeCompare(b.n));
    return out;
  }, [scope, scopeChar, withInv, q, incRare, incEx, incUnstack]);

  const scopeOptions = useMemo(() => ['all', ...known.map((c) => c.name)], [known]);
  const renderScope = (v: string) => {
    if (v === 'all') return <span className="flex items-center gap-2"><span className="truncate">All Characters</span></span>;
    const c = known.find((x) => x.name === v);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
        <span className="truncate">{anon(v)}</span>
      </span>
    );
  };

  if (known.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Yet</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Duplicates compares item stacks scattered across bags and characters.</div>
        </div>
      </div>
    );
  }

  const scopeNoun = scope === 'all' ? 'character' : 'bag';

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-stretch gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Filter duplicates…"
            className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
          />
          <div className="shrink-0 min-w-[150px]">
            <Select value={scope} onChange={setScope} options={scopeOptions} renderOption={renderScope} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-fg-4 uppercase tracking-wide mr-0.5">Include</span>
          <Chip on={incRare} onChange={setIncRare}>Rare</Chip>
          <Chip on={incEx} onChange={setIncEx}>Exclusive</Chip>
          <Chip on={incUnstack} onChange={setIncUnstack}>Unstackable</Chip>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {dupes.length === 0 ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="max-w-sm">
              <div className="text-[13px] font-bold text-fg mb-1">No duplicates found</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">
                {scope === 'all'
                  ? 'No stackable item is held by more than one character. Toggle Rare / Exclusive / Unstackable above to widen the search.'
                  : 'No stackable item is split across multiple bags on this character. Toggle the filters above to widen the search.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-fg-4 px-0.5">
              {dupes.length} item{dupes.length === 1 ? '' : 's'} spread across {scopeNoun === 'character' ? 'multiple characters' : 'multiple bags'}
            </div>
            <AnimatePresence mode="popLayout" initial={false}>
            {dupes.map((d) => (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-lg border border-line bg-surface p-2.5"
              >
                <div className="flex items-center gap-2">
                  <DIcon id={d.id} n={d.n} assets={scopeChar?.assets ?? assetsAny} iconSet={iconSet} />
                  <span className="truncate text-[12px] text-fg-2 flex-1 min-w-0">{d.n}</span>
                  <span className="shrink-0 text-[10px] text-fg-4 tabular-nums">{d.locs.length} {scopeNoun}{d.locs.length === 1 ? '' : 's'}</span>
                  <span className="shrink-0 text-[12px] font-semibold text-fg tabular-nums w-10 text-right">{d.total}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {d.locs.map((l) => (
                    <span key={l.label} className="inline-flex items-center gap-1 rounded bg-field px-1.5 py-0.5 text-[10px]">
                      {scope === 'all' && <span className={`w-1 h-1 rounded-full ${l.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />}
                      <span className="text-fg-3 max-w-[110px] truncate">{scope === 'all' ? anon(l.label) : l.label}</span>
                      <span className="text-fg-2 tabular-nums font-semibold">{l.count}</span>
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
