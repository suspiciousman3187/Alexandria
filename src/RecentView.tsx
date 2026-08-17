import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, type KnownChar, type InvBag, type InvItem } from './bridge';
import { useRecent, clearRecent } from './recent';
import { itemNameMatches } from './itemNames';
import { useSettings, setSettings } from './settings';
import { ItemRow, RowActions } from './InventoryView';
import { Select, SearchInput } from './ui';
import { useSticky } from './sticky';
import { useAnon } from './anonymize';

const RECENT_OPTS = ['0.0833333', '0.5', '1', '3', '6', '12', '24', '48'];
const recentLabel = (v: string) => { const n = Number(v); return n < 1 ? `Last ${Math.round(n * 60)}m` : `Last ${n}h`; };

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function locate(live: KnownChar | undefined, id: number): { bag: InvBag; item: InvItem } | null {
  if (!live?.inv) return null;
  const bag0 = live.inv.find((b) => b.id === 0);
  const inBag0 = bag0?.items.find((it) => it.id === id);
  if (bag0 && inBag0) return { bag: bag0, item: inBag0 };
  for (const b of live.inv) { const it = b.items.find((x) => x.id === id); if (it) return { bag: b, item: it }; }
  return null;
}

type Agg = { char: string; id: number; n: string; qty: number; at: number };

export default function RecentView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const settings = useSettings();
  const recentHours = settings.recentHours;
  const recent = useRecent(recentHours);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(h); }, []);

  const [charFilter, setCharFilter] = useSticky('recent.char', 'all');
  const [q, setQ] = useSticky('recent.q', '');
  const [hideTemp, setHideTemp] = useSticky('recent.hideTemp', false);

  const byName = useMemo(() => new Map(known.map((k) => [k.name, k])), [known]);

  const rows = useMemo<Agg[]>(() => {
    const m = new Map<string, Agg>();
    for (const e of recent) {
      const k = `${e.char}:${e.id}`;
      const ex = m.get(k);
      if (ex) { ex.qty += e.qty; if (e.at > ex.at) ex.at = e.at; }
      else m.set(k, { ...e });
    }
    return [...m.values()].sort((a, b) => b.at - a.at);
  }, [recent]);

  const charOpts = useMemo(() => ['all', ...[...new Set(rows.map((r) => r.char))].sort()], [rows]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (charFilter !== 'all' && r.char !== charFilter) return false;
      if (query && !itemNameMatches(r.id, r.n, query)) return false;
      const loc = locate(byName.get(r.char), r.id);
      if (!loc) return false;
      if (hideTemp && loc.bag.id === 3) return false;
      return true;
    });
  }, [rows, charFilter, q, byName, hideTemp]);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-line">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0"><Select value={charFilter} onChange={setCharFilter} options={charOpts} renderOption={(v) => (v === 'all' ? 'All Characters' : anon(v))} full /></div>
          <button onClick={() => setHideTemp((v) => !v)} title="Hide temporary items from this list" className={`le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${hideTemp ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface text-fg-3 hover:text-fg'}`}>Hide Temp</button>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search recent items…"
            className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
          />
          <div className="shrink-0 w-28">
            <Select value={String(recentHours)} onChange={(v) => setSettings({ ...settings, recentHours: Number(v) })} options={RECENT_OPTS} renderOption={recentLabel} full />
          </div>
          {rows.length > 0 && (
            <button onClick={clearRecent} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Clear</button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2">
        {visible.length === 0 ? (
          <div className="h-full grid place-items-center">
            <div className="text-center max-w-sm px-6">
              <div className="text-[14px] font-bold text-fg mb-1">Nothing Recent</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">{rows.length > 0 ? 'No recent items match your filters.' : `Items picked up in the ${recentLabel(String(recentHours)).toLowerCase()} show here, and clear out once dropped or used.`}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((r) => {
                const live = byName.get(r.char);
                const found = locate(live, r.id);
                const item: InvItem = found?.item ?? { s: -1, id: r.id, c: r.qty, n: r.n };
                const canAct = !!(found && live?.online && live.conn != null);
                return (
                  <motion.div
                    key={`${r.char}:${r.id}`}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ItemRow
                      item={item}
                      bag={anon(r.char)}
                      assets={live?.assets}
                      actions={
                        <>
                          <span className="shrink-0 text-[10px] text-fg-4 tabular-nums mr-0.5">+{r.qty} · {ago(r.at, now)}</span>
                          {canAct && found && live && <RowActions char={live} bag={found.bag} item={found.item} canAct bags={live.inv ?? []} />}
                        </>
                      }
                    />
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
