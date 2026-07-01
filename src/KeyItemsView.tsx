import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, type KnownChar } from './bridge';
import { useSticky, useStickyPersisted } from './sticky';
import { useCharScope, CharScopeBar } from './CharScope';
import { SearchInput } from './ui';
import { Collapse } from './overlay';
import { relTime, useNowTick } from './reltime';
import { useAnon } from './anonymize';

type Row = { id: number; n: string; have: boolean[]; count: number };

// Color the "Cached" badge by how stale the capture is.
function cacheTone(ms?: number): string {
  if (!ms) return 'border-line bg-field text-fg-4';
  const age = Date.now() - ms;
  if (age < 5 * 60_000) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (age < 60 * 60_000) return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
  if (age < 24 * 3_600_000) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
}

function Star({ filled, className = 'w-3.5 h-3.5' }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.9 6.2 21l1.1-6.5-4.7-4.6 6.5-.95z" />
    </svg>
  );
}

export default function KeyItemsView() {
  const known = useKnownCharacters();
  const anon = useAnon();
  useNowTick();
  const [q, setQ] = useSticky('ki.q', '');
  const [diffOnly, setDiffOnly] = useSticky('ki.diff', false);
  const [starOnly, setStarOnly] = useSticky('ki.staronly', false);
  const [starred, setStarred] = useStickyPersisted<number[]>('ki.starred', []);
  const starSet = useMemo(() => new Set(starred), [starred]);
  const toggleStar = (id: number) => setStarred((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [expand, setExpand] = useState<number | null>(null);

  const chars = useMemo<KnownChar[]>(
    () => known.filter((k) => k.keyItems !== undefined).sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)),
    [known],
  );
  const { scoped, exSet, toggle, reset } = useCharScope('ki.scope', chars);
  const lastKey = chars.reduce((m, c) => Math.max(m, c.keyAt ?? 0), 0) || undefined;

  const sets = useMemo(() => scoped.map((c) => new Set((c.keyItems ?? []).map((k) => k.id))), [scoped]);

  const rows = useMemo<Row[]>(() => {
    const names = new Map<number, string>();
    for (const c of scoped) for (const k of c.keyItems ?? []) if (!names.has(k.id)) names.set(k.id, k.n);
    const search = q.trim().toLowerCase();
    let out: Row[] = [...names.entries()].map(([id, n]) => {
      const have = sets.map((s) => s.has(id));
      return { id, n, have, count: have.filter(Boolean).length };
    });
    if (search) out = out.filter((r) => r.n.toLowerCase().includes(search));
    if (diffOnly && scoped.length > 1) out = out.filter((r) => r.count > 0 && r.count < scoped.length);
    if (starOnly) out = out.filter((r) => starSet.has(r.id));
    out.sort((a, b) => a.n.localeCompare(b.n));
    return out;
  }, [scoped, sets, q, diffOnly, starOnly, starSet]);

  if (chars.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[14px] font-bold text-fg mb-1">No Key Item Data Yet</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Log a character in-game with the Alexandria addon loaded. Each character's key items are cached, so they stay visible here even after logging off.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-line">
        <div className="flex items-center gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={`Filter ${rows.length} key item${rows.length === 1 ? '' : 's'}…`}
            className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
          />
          <button
            onClick={() => setStarOnly((v) => !v)}
            aria-pressed={starOnly}
            title="Show only starred key items"
            className={`shrink-0 grid place-items-center w-[34px] py-1.5 rounded-md border transition-colors ${starOnly ? 'bg-amber-400/15 border-amber-400/40 text-amber-300' : 'bg-surface text-fg-3 border-line hover:text-amber-300'}`}
          >
            <Star filled={starOnly} />
          </button>
          {scoped.length > 1 && (
            <button
              onClick={() => setDiffOnly((v) => !v)}
              aria-pressed={diffOnly}
              title="Show only key items some characters have and others don't"
              className={`shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${diffOnly ? 'bg-accent text-on-accent border-transparent' : 'bg-surface text-fg-3 border-line hover:text-fg-2'}`}
            >
              Differences
            </button>
          )}
          {lastKey && (
            <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cacheTone(lastKey)}`} title="Last time key items were captured">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Cached {relTime(lastKey)}
            </span>
          )}
        </div>
        <CharScopeBar chars={chars} exSet={exSet} toggle={toggle} reset={reset} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2">
        {rows.length === 0 ? (
          <div className="grid place-items-center py-10 text-[12px] text-fg-4">No key items match.</div>
        ) : (
          <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
            <AnimatePresence mode="popLayout" initial={false}>
            {rows.map((r) => {
              const open = expand === r.id;
              return (
                <motion.div
                  key={r.id}
                  layout="position"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center">
                    <button onClick={() => toggleStar(r.id)} aria-pressed={starSet.has(r.id)} aria-label={starSet.has(r.id) ? 'Unstar' : 'Star'} className={`le-tap shrink-0 grid place-items-center w-7 h-7 ml-1.5 rounded-md transition-colors ${starSet.has(r.id) ? 'text-amber-300' : 'text-fg-4/50 hover:text-amber-300 hover:bg-field/40'}`}>
                      <Star filled={starSet.has(r.id)} />
                    </button>
                    <button onClick={() => setExpand(open ? null : r.id)} className="le-tap flex-1 min-w-0 flex items-center gap-2 pl-1 pr-3 py-1.5 text-left hover:bg-field/40 transition-colors">
                      <span className="flex-1 min-w-0 truncate text-fg-2 text-[12px]">{r.n}</span>
                      <span className={`tabular-nums text-[11px] font-semibold ${r.count === scoped.length ? 'text-emerald-300' : r.count === 0 ? 'text-fg-4' : 'text-amber-300'}`}>{r.count}/{scoped.length}</span>
                      <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  </div>
                  <Collapse open={open}>
                    <div className="px-3 pb-2 pt-0.5 bg-field/10 grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5">
                      {scoped.map((c, i) => (
                        <span key={c.name} className={`flex items-center gap-1 min-w-0 px-2 py-0.5 rounded text-[10px] font-medium border ${r.have[i] ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-line bg-field text-fg-4/60'}`}>
                          {r.have[i]
                            ? <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>
                            : <span className="w-1 h-1 rounded-full bg-fg-4/50 shrink-0" />}
                          <span className="truncate">{anon(c.name)}</span>
                          {!c.online && c.keyAt && <span className="opacity-60 shrink-0">· {relTime(c.keyAt)}</span>}
                        </span>
                      ))}
                    </div>
                  </Collapse>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
