import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, type KnownChar } from './bridge';
import { IconInner } from './atlasIcon';
import { CharacterSelect, SearchInput } from './ui';
import { itemNameMatches } from './itemNames';
import { Collapse } from './overlay';
import { useConsolidate, runConsolidate, stopConsolidate, reachableTotal, isNoTrade } from './consolidate';
import { useSettings } from './settings';
import { useAnon } from './anonymize';

const STATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

function Icon({ id, n, assets, iconSet }: { id: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

export default function ConsolidatePanel() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const run = useConsolidate();
  const experimental = useSettings().experimentalFeatures;
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);

  const [collector, setCollector] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');

  const collName = online.find((k) => k.name === collector)?.name ?? online[0]?.name ?? '';
  const senders = useMemo(() => online.filter((k) => k.name !== collName), [online, collName]);
  const assetsAny = online.find((c) => c.assets)?.assets;
  const itemName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of senders) for (const b of c.inv ?? []) for (const it of b.items) if (!m.has(it.id)) m.set(it.id, it.n);
    return m;
  }, [senders]);

  const rows = useMemo(() => {
    const ids = new Map<number, string>();
    for (const c of senders) for (const b of c.inv ?? []) for (const it of b.items) if (!ids.has(it.id)) ids.set(it.id, it.n);
    const search = q.trim().toLowerCase();
    let out = [...ids.entries()]
      .filter(([id]) => !isNoTrade(senders.find((s) => reachableTotal(s, id, experimental) > 0), id))
      .map(([id, n]) => ({
        id, n,
        total: senders.reduce((s, c) => s + reachableTotal(c, id, experimental), 0),
        holders: senders.filter((c) => reachableTotal(c, id, experimental) > 0).length,
        noTrade: senders.some((c) => isNoTrade(c, id)),
      }))
      .filter((r) => r.total > 0 && !r.noTrade);
    if (search) out = out.filter((r) => itemNameMatches(r.id, r.n, search));
    out.sort((a, b) => b.total - a.total || a.n.localeCompare(b.n));
    return out;
  }, [senders, q, experimental]);

  const toggle = (id: number) => { const next = new Set(sel); next.has(id) ? next.delete(id) : next.add(id); setSel(next); };
  const selRows = rows.filter((r) => sel.has(r.id));
  const selTotal = selRows.reduce((s, r) => s + r.total, 0);
  const affected = useMemo(() => senders.filter((c) => selRows.some((r) => reachableTotal(c, r.id, experimental) > 0)).length, [senders, selRows, experimental]);
  // While a run is going the full tradeable list is just noise; show only the items
  // actually being consolidated.
  const listRows = run.running ? rows.filter((r) => sel.has(r.id)) : rows;

  const start = () => { if (collName && sel.size) void runConsolidate(collName, [...sel], experimental); };

  if (online.length < 2) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-[14px] font-bold text-fg mb-1">Need Two Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Consolidate gathers items from your other characters onto one collector. Load the Alexandria addon on at least two characters in the same zone.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-3 pb-3 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Collect To</span>
          <div className="flex-1 min-w-0"><CharacterSelect value={collName} onChange={setCollector} chars={online} /></div>
        </div>
        <SearchInput
          value={q}
          onChange={setQ}
          wrap=""
          placeholder={`Filter ${rows.length} tradeable item${rows.length === 1 ? '' : 's'}…`}
          className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <AnimatePresence initial={false}>
        {run.running || run.order.length > 0 ? (
          <motion.div key="runblock" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="mb-3 rounded-lg border border-line bg-surface divide-y divide-line overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-3 flex items-center gap-2">
              <span>Run · {anon(run.collector)}</span>
              {run.running && <span className="text-fg-4 normal-case font-normal">working…</span>}
            </div>
            {run.order.map((name) => {
              const cs = run.chars[name];
              if (!cs) return null;
              const showItems = cs.items && cs.items.length > 0 && cs.status !== 'ok' && cs.status !== 'fail';
              return (
                <div key={name} className="px-3 py-2 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[cs.status]}`} />
                    <span className="text-[12px] text-fg-2 font-semibold min-w-0 truncate">{anon(name)}</span>
                    <span className="text-[11px] text-fg-4 shrink-0">{STATUS_LABEL[cs.status]}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-fg-3 shrink-0">{cs.sent}/{cs.goal}</span>
                    {cs.note && <span className="text-[10px] text-red-300 shrink-0 max-w-[160px] truncate" title={cs.note}>{cs.note}</span>}
                  </div>
                  <Collapse open={!!showItems}>{showItems && (
                    <div className="flex flex-wrap gap-1 pl-4">
                      {cs.items!.map((it) => (
                        <span key={it.id} className="inline-flex items-center gap-1 rounded bg-field border border-line px-1 py-0.5">
                          <div className="relative shrink-0 w-4 h-4 rounded bg-surface grid place-items-center overflow-hidden">
                            <IconInner id={it.id} size={16} name={itemName.get(it.id) ?? ''} assets={assetsAny} bmpHas={it.id > 0 && iconSet.has(it.id)} />
                          </div>
                          <span className="text-[10px] text-fg-3 max-w-[110px] truncate">{itemName.get(it.id) ?? ('Item ' + it.id)}</span>
                          <span className="text-[10px] font-bold text-fg-2 tabular-nums">×{it.want}</span>
                        </span>
                      ))}
                    </div>
                  )}</Collapse>
                </div>
              );
            })}
            {run.error && <div className="px-3 py-2 text-[11px] text-red-300">{run.error}</div>}
          </motion.div>
        ) : null}
        </AnimatePresence>

        <div className="rounded-lg border border-line bg-surface divide-y divide-line overflow-hidden">
          {listRows.length === 0 ? (
            <div className="text-center text-[12px] text-fg-4 py-12">{run.running ? 'Consolidating…' : 'Nothing tradeable on your other characters.'}</div>
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {listRows.map((r) => {
                const on = sel.has(r.id);
                return (
                  <motion.button
                    key={r.id}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => toggle(r.id)}
                    disabled={run.running}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:opacity-50 ${on ? 'bg-accent/10' : 'hover:bg-field'}`}
                  >
                    <span className={`shrink-0 w-4 h-4 rounded border grid place-items-center ${on ? 'bg-accent border-accent text-on-accent' : 'border-line'}`}>
                      {on && <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                    </span>
                    <Icon id={r.id} n={r.n} assets={assetsAny} iconSet={iconSet} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{r.n}</span>
                    <span className="shrink-0 text-[10px] text-fg-4">{r.holders} char{r.holders === 1 ? '' : 's'}</span>
                    <span className="shrink-0 text-[12px] font-semibold text-fg tabular-nums w-10 text-right">{r.total}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t-2 border-accent bg-[var(--color-bg)] shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)] px-3 py-2.5 flex items-center gap-3">
        {sel.size > 0 ? (
          <span className="text-[11px] text-fg-3 tabular-nums">{selTotal} item{selTotal === 1 ? '' : 's'} · {sel.size} kind{sel.size === 1 ? '' : 's'} · {affected} char{affected === 1 ? '' : 's'} → {anon(collName)}</span>
        ) : (
          <span className="text-[11px] text-fg-4">Select items to gather onto {anon(collName)}.</span>
        )}
        <div className="ml-auto shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            {run.running ? (
              <motion.button key="stop" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }} onClick={stopConsolidate} className="le-tap px-4 py-1.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</motion.button>
            ) : (
              <motion.button key="go" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }} onClick={start} disabled={sel.size === 0 || affected === 0} className="le-tap px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate</motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
