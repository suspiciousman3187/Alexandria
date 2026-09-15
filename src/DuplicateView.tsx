import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, localConsolidate, useAhCatalog, type KnownChar } from './bridge';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { Chip, SearchInput, BagTag, SectionTabs } from './ui';
import { itemNameMatches } from './itemNames';
import { useSticky } from './sticky';
import { useAnon } from './anonymize';
import { useSettings } from './settings';
import { bagConsolidatable, recipientSpace } from './consolidate';
import { FLAG_NOTRADE } from './bagConstants';
import ConsolidateToModal from './ConsolidateToModal';
import { Modal, Collapse } from './overlay';
import { useConsoQueue, addConsoJob, runConsoQueue, runConsoQueueFast, stopConsoQueue, clearConsoQueue, removeConsoJob } from './consoQueue';
import ConsoProgress from './ConsoProgress';
import ConsolidatePrefsPanel from './ConsolidatePrefsPanel';
import ConsolidateExceptionsPanel from './ConsolidateExceptionsPanel';
import { useConsolidateIgnore, toggleConsolidateIgnore } from './consolidateIgnore';
import { localConsolidatePlan, LOCAL_TARGET_BAGS, DEFAULT_LOCAL_TARGETS, type PlanRow } from './localConsolidatePlan';

const MED_AC = 33;
const FOOD_ACS = new Set([51, 52, 53, 54, 55, 56, 57, 58, 59]);

type BagLoc = { bag: string; id: number; count: number; acc: boolean };
type Split = { id: number; n: string; total: number; bags: BagLoc[]; noTrade: boolean };
type Group = { name: string; online?: boolean; conn?: number; main?: string; sub?: string; assets?: string; items: Split[] };
type Holder = { name: string; conn?: number; count: number };
type ItemGroup = { id: number; n: string; total: number; holders: Holder[]; assets?: string; noTrade: boolean };

function DIcon({ id, n, c, assets, iconSet }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number> }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function LocalConsolidateAllModal({ onClose, targets, setTargets }: { onClose: () => void; targets: number[]; setTargets: (t: number[]) => void }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const anon = useAnon();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const live = useMemo(() => online.map((c) => ({ char: c, rows: localConsolidatePlan(c, targetSet) })).filter((p) => p.rows.length > 0), [online, targetSet]);
  const toggleTarget = (id: number) => setTargets(targets.includes(id) ? (targets.length > 1 ? targets.filter((x) => x !== id) : targets) : [...targets, id]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [initialItems, setInitialItems] = useState(0);
  const liveItems = live.reduce((s, p) => s + p.rows.length, 0);
  const running = phase === 'running';
  const done = phase === 'done';
  const pct = phase !== 'idle' && initialItems > 0 ? Math.min(100, Math.round(((initialItems - liveItems) / initialItems) * 100)) : 0;

  useEffect(() => { if (phase === 'running' && liveItems === 0) setPhase('done'); }, [phase, liveItems]);

  const run = () => {
    if (!live.length) return;
    const snapshot = live;
    setInitialItems(snapshot.reduce((s, p) => s + p.rows.length, 0));
    setPhase('running');
    snapshot.forEach((p, i) => {
      window.setTimeout(() => { if (p.char.conn != null) localConsolidate(p.char.conn, targets); }, i * 300);
    });
    window.setTimeout(() => setPhase((ph) => (ph === 'running' ? 'done' : ph)), snapshot.length * 300 + 15000);
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Local Consolidate All</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Gathers each character's own split stacks into one of the chosen bags. No trading between characters.</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Consolidate Into</div>
              <div className="flex flex-wrap gap-1.5">
                {LOCAL_TARGET_BAGS.map((b) => <Chip key={b.id} on={targets.includes(b.id)} onChange={() => toggleTarget(b.id)}>{b.name}</Chip>)}
              </div>
            </div>
            {(running || done) && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className={`font-semibold ${done ? 'text-emerald-300' : 'text-fg-2'}`}>{done ? (liveItems === 0 ? 'Done, all stacks merged' : `Done, ${liveItems} left unmerged`) : 'Consolidating…'}</span>
                  <span className="text-fg-4 tabular-nums">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-emerald-400' : 'bg-accent'}`} style={{ width: `${Math.max(3, pct)}%` }} /></div>
              </div>
            )}
            {live.length === 0 ? (
              <div className="rounded-md bg-field border border-line px-3 py-2 text-[11px] text-fg-4">{phase === 'idle' ? "Nothing to consolidate. Every online character's stacks are already merged." : 'All split stacks were merged.'}</div>
            ) : (
              live.map((p) => (
                <div key={p.char.name} className="rounded-lg border border-line bg-surface overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${running ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    <span className="text-[12px] font-bold text-fg truncate">{anon(p.char.name)}</span>
                    <span className="ml-auto text-[11px] text-fg-4 tabular-nums shrink-0">{p.rows.length} item{p.rows.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="divide-y divide-line">
                    {p.rows.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                        <DIcon id={r.id} n={r.n} assets={p.char.assets} iconSet={iconSet} />
                        <div className="min-w-0 flex-1 text-[11px] text-fg-2 truncate">{r.n}<span className="text-fg-4"> from {r.from.map((f) => `${f.bag} (×${f.count})`).join(', ')}</span></div>
                        <span className="shrink-0 text-accent text-[13px]">&rarr;</span>
                        <BagTag id={r.homeBagId} label={r.homeBag} className="max-w-[110px] shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">{phase === 'idle' ? 'Cancel' : 'Close'}</button>
            {live.length > 0 && <button onClick={run} disabled={running} className="le-tap ml-auto px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">{running ? 'Consolidating…' : `Local Consolidate All (${live.length})`}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function IgnoreBtn({ name, ignored }: { name: string; ignored: boolean }) {
  return (
    <button onClick={() => toggleConsolidateIgnore(name)} title={ignored ? 'Remove from exceptions' : 'Add to exceptions (hide from Consolidate)'} className={`le-tap shrink-0 grid place-items-center w-7 h-7 rounded-md border transition-colors ${ignored ? 'border-accent/40 bg-accent/10 text-accent hover:text-fg' : 'border-line bg-field text-fg-4 hover:text-fg hover:border-accent/40'}`}>
      {ignored ? (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M2 2l20 20" /></svg>
      )}
    </button>
  );
}

export default function DuplicateView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const [q, setQ] = useSticky('dupe.q', '');
  const [incRare, setIncRare] = useSticky('dupe.rare', false);
  const [incEx, setIncEx] = useSticky('dupe.ex', false);
  const [incUnstack, setIncUnstack] = useSticky('dupe.unstack', false);
  const [expanded, setExpanded] = useSticky('dupe.expanded', [] as string[]);
  const [section, setSection] = useSticky<'consolidate' | 'exceptions' | 'pref'>('dupe.section', 'consolidate');
  const [mode, setMode] = useSticky<'item' | 'char'>('dupe.view', 'char');
  const [conso, setConso] = useState<{ id: number; n: string; assets?: string; recipient: string } | null>(null);
  const [selfSent, setSelfSent] = useState<string | null>(null);
  const [localSummary, setLocalSummary] = useState<{ name: string; assets?: string; rows: PlanRow[] } | null>(null);
  const [localAll, setLocalAll] = useState(false);
  const [showMeds, setShowMeds] = useSticky('dupe.meds', false);
  const [localTargets, setLocalTargets] = useSticky<number[]>('dupe.localTargets', DEFAULT_LOCAL_TARGETS);
  const queue = useConsoQueue();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const cat = useAhCatalog();
  const acById = useMemo(() => { const m = new Map<number, number>(); for (const it of cat.items) if (it.ac != null) m.set(it.id, it.ac); return m; }, [cat.items]);
  const ignore = useConsolidateIgnore();
  const ignoreSet = useMemo(() => new Set(ignore.map((n) => n.toLowerCase())), [ignore]);
  const isIgnored = (n: string) => ignoreSet.has(n.toLowerCase());

  const runLocal = (name: string, conn?: number) => {
    if (conn == null) return;
    const char = known.find((k) => k.name === name);
    const rows = char ? localConsolidatePlan(char, new Set(localTargets)) : [];
    localConsolidate(conn, localTargets);
    setSelfSent(name);
    window.setTimeout(() => setSelfSent((s) => (s === name ? null : s)), 2500);
    setLocalSummary({ name, assets: char?.assets, rows });
  };

  const withInv = useMemo(() => known.filter((c) => c.inv && c.inv.length), [known]);

  const keepFlags = (f: number) => (incRare || !(f & 1)) && (incEx || !(f & 2)) && (incUnstack || !(f & 4));

  const groups = useMemo<Group[]>(() => {
    const chars = withInv;
    const search = q.trim().toLowerCase();
    const out: Group[] = [];
    for (const c of chars) {
      const byId = new Map<number, { n: string; f: number; bags: Map<string, { id: number; count: number }> }>();
      for (const bg of c.inv!) for (const it of bg.items) {
        let g = byId.get(it.id);
        if (!g) { g = { n: it.n, f: it.f ?? 0, bags: new Map() }; byId.set(it.id, g); }
        const b = g.bags.get(bg.b);
        if (b) b.count += it.c; else g.bags.set(bg.b, { id: bg.id, count: it.c });
      }
      const items: Split[] = [];
      for (const [id, g] of byId) {
        if (g.bags.size < 2) continue;
        if (!keepFlags(g.f)) continue;
        const ac = acById.get(id);
        if (!showMeds && (ac === MED_AC || (ac != null && FOOD_ACS.has(ac)))) continue;
        if (ignoreSet.has(g.n.toLowerCase())) continue;
        if (search && !itemNameMatches(id, g.n, search)) continue;
        const bags = [...g.bags.entries()].map(([bag, v]) => ({ bag, id: v.id, count: v.count, acc: bagConsolidatable(c, v.id, exp) })).sort((a, b) => b.count - a.count);
        items.push({ id, n: g.n, total: bags.reduce((s, l) => s + l.count, 0), bags, noTrade: (g.f & FLAG_NOTRADE) !== 0 });
      }
      if (!items.length) continue;
      items.sort((a, b) => b.bags.length - a.bags.length || b.total - a.total || a.n.localeCompare(b.n));
      out.push({ name: c.name, online: c.online, conn: c.conn, main: c.main, sub: c.sub, assets: c.assets, items });
    }
    out.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    return out;
  }, [withInv, q, incRare, incEx, incUnstack, exp, showMeds, acById, ignoreSet]);

  const itemGroups = useMemo<ItemGroup[]>(() => {
    const search = q.trim().toLowerCase();
    const byId = new Map<number, { n: string; f: number; assets?: string; holders: Map<string, { conn?: number; count: number }> }>();
    for (const c of withInv) {
      const per = new Map<number, { n: string; f: number; count: number }>();
      for (const bg of c.inv!) for (const it of bg.items) {
        const e = per.get(it.id);
        if (e) e.count += it.c; else per.set(it.id, { n: it.n, f: it.f ?? 0, count: it.c });
      }
      for (const [id, e] of per) {
        let g = byId.get(id);
        if (!g) { g = { n: e.n, f: e.f, assets: c.assets, holders: new Map() }; byId.set(id, g); }
        g.holders.set(c.name, { conn: c.conn, count: e.count });
      }
    }
    const out: ItemGroup[] = [];
    for (const [id, g] of byId) {
      if (g.holders.size < 2) continue;
      if (!keepFlags(g.f)) continue;
      const ac = acById.get(id);
      if (!showMeds && (ac === MED_AC || (ac != null && FOOD_ACS.has(ac)))) continue;
      if (ignoreSet.has(g.n.toLowerCase())) continue;
      if (search && !itemNameMatches(id, g.n, search)) continue;
      const holders = [...g.holders.entries()].map(([name, v]) => ({ name, conn: v.conn, count: v.count })).sort((a, b) => b.count - a.count);
      out.push({ id, n: g.n, total: holders.reduce((s, h) => s + h.count, 0), holders, assets: g.assets, noTrade: (g.f & FLAG_NOTRADE) !== 0 });
    }
    out.sort((a, b) => b.holders.length - a.holders.length || b.total - a.total || a.n.localeCompare(b.n));
    return out;
  }, [withInv, q, incRare, incEx, incUnstack, showMeds, acById, ignoreSet]);

  const toggleExpand = (name: string) => setExpanded(expanded.includes(name) ? expanded.filter((n) => n !== name) : [...expanded, name]);
  const toggleSel = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Visible + selected + tradeable: the exact set the bulk add operates on, so the
  // count and the action always match what's on screen.
  const selVisible = useMemo(() => itemGroups.filter((d) => sel.has(d.id) && !d.noTrade), [itemGroups, sel]);
  // Bulk enqueue: each selected item goes to its biggest reachable holder at the full
  // fitting amount -- the same defaults a single Add to Queue picks in the modal.
  const addSelectedToQueue = () => {
    for (const d of selVisible) {
      const recipient = (d.holders.find((h) => h.conn != null) ?? d.holders[0])?.name;
      if (!recipient) continue;
      const space = recipientSpace(recipient, d.id, exp);
      const incoming = space?.incoming ?? 0;
      const amount = space && !space.fits ? space.maxFit : incoming;
      if (amount > 0) addConsoJob({ itemId: d.id, itemName: d.n, assets: d.assets, recipient, amount });
    }
    setSel(new Set());
  };

  if (known.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Yet</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Consolidate finds items split across multiple bags so you can merge them into one.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        <SectionTabs
          value={section}
          onChange={setSection}
          tabs={[
            { id: 'consolidate', label: 'Consolidate' },
            { id: 'exceptions', label: 'Exceptions', dot: ignore.length > 0 },
            { id: 'pref', label: 'Preferences' },
          ]}
        />
        {section === 'consolidate' && (
          <>
            <div className="flex items-center gap-1.5">
              <div className="inline-flex rounded-md border border-line bg-field p-0.5">
                <button onClick={() => setMode('char')} className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${mode === 'char' ? 'bg-accent text-on-accent' : 'text-fg-3 hover:text-fg'}`}>CHARACTER</button>
                <button onClick={() => setMode('item')} className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors ${mode === 'item' ? 'bg-accent text-on-accent' : 'text-fg-3 hover:text-fg'}`}>ITEM</button>
              </div>
              <div className="ml-auto flex items-center justify-end gap-1.5">
                <Chip on={incRare} onChange={setIncRare}>RA</Chip>
                <Chip on={incEx} onChange={setIncEx}>EX</Chip>
                <Chip on={incUnstack} onChange={setIncUnstack}>UNSTACKABLE</Chip>
                <Chip on={showMeds} onChange={setShowMeds}>CONSUMABLE</Chip>
              </div>
            </div>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Filter items…"
              className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {section === 'exceptions' ? (
          <ConsolidateExceptionsPanel />
        ) : section === 'pref' ? (
          <ConsolidatePrefsPanel />
        ) : (
          <>
        <Collapse open={queue.jobs.length > 0}>{queue.jobs.length > 0 && (
          <div className="mb-3 rounded-lg border border-accent/30 bg-black/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
              <span className="text-[11px] font-bold uppercase tracking-wide text-accent">Consolidation Queue · {queue.jobs.length}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {queue.running ? (
                  <button onClick={stopConsoQueue} className="le-tap px-2.5 py-1 text-[11px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>
                ) : (
                  <>
                    <button onClick={() => clearConsoQueue()} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg hover:border-accent/40 transition-colors">Clear</button>
                    <button onClick={() => void runConsoQueue(exp)} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg hover:border-accent/40 transition-colors">Run All</button>
                    <button onClick={() => void runConsoQueueFast(exp)} title="Combine items to the same character into single trades" className="le-tap inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors"><svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" stroke="none"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>Fast</button>
                  </>
                )}
              </div>
            </div>
            <ConsoProgress />
            <div className="divide-y divide-line">
              {queue.jobs.map((j) => {
                const status = queue.done.includes(j.key) ? 'done' : queue.curKeys.includes(j.key) ? 'running' : 'pending';
                return (
                  <div key={j.key} className="flex items-center gap-2 px-3 py-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'done' ? 'bg-emerald-400' : status === 'running' ? 'bg-amber-400' : 'bg-fg-4'}`} />
                    <span className="text-[11px] text-fg-2 font-semibold min-w-0 truncate">{j.itemName}</span>
                    <span className="text-[10px] text-fg-4 shrink-0">&rarr; {anon(j.recipient)}</span>
                    <span className="ml-auto shrink-0 inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent tabular-nums">&times;{j.amount}</span>
                    {!queue.running && <button onClick={() => removeConsoJob(j.key)} aria-label="Remove" className="le-tap grid place-items-center w-5 h-5 shrink-0 rounded text-[15px] leading-none text-fg-4 hover:text-red-400 transition-colors"><svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}</Collapse>
        {mode === 'char' ? (
        groups.length === 0 ? (
          <div className={`${queue.jobs.length ? 'py-10' : 'h-full'} grid place-items-center text-center px-6`}>
            <div className="max-w-sm">
              <div className="text-[13px] font-bold text-fg mb-1">Nothing to consolidate</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">
                No item is split across multiple bags on a single character. Consumables and food are hidden by default; toggle Consumables (or RA / EX / UNSTACKABLE) above to widen the search.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 -mb-1 px-1">
              {groups.length > 1 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpanded(groups.map((g) => g.name))} className="le-tap px-2.5 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Expand All</button>
                  <button onClick={() => setExpanded([])} className="le-tap px-2.5 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Collapse All</button>
                </div>
              )}
              <button onClick={() => setLocalAll(true)} className="le-tap ml-auto px-3 py-1.5 text-[11px] font-bold tracking-wide rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Local Consolidate All</button>
            </div>
            {groups.map((g) => {
              const isExpanded = expanded.includes(g.name);
              return (
                <div key={g.name}>
                  <div className="w-full flex items-center gap-2 mb-2 px-1">
                    <button onClick={() => toggleExpand(g.name)} className="flex items-center gap-2 min-w-0 flex-1 group">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-fg-4 group-hover:text-fg-2 transition-transform ${isExpanded ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                      <span className={`shrink-0 w-2 h-2 rounded-full ${g.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                      <span className="text-[12px] font-bold text-fg group-hover:text-accent transition-colors truncate">{anon(g.name)}</span>
                      {g.main && <span className="shrink-0 text-[11px] text-fg-4">{g.main}{g.sub ? `/${g.sub}` : ''}</span>}
                      <span className="ml-auto shrink-0 text-[11px] text-fg-4 tabular-nums">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
                    </button>
                    {g.online && g.conn != null && (
                      <button onClick={() => runLocal(g.name, g.conn)} title="Merge this character's own split stacks together, in place. No trading, no storage moves." className="le-tap shrink-0 px-2.5 py-1 text-[10px] font-bold tracking-wide rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">
                        {selfSent === g.name ? 'Sent' : 'Local Consolidate'}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="flex flex-col gap-1.5">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {g.items.map((d) => (
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
                              <DIcon id={d.id} n={d.n} assets={g.assets} iconSet={iconSet} />
                              <span className="truncate text-[12px] text-fg-2 flex-1 min-w-0">{d.n}</span>
                              <span className="shrink-0 inline-flex items-center rounded-md bg-field border border-line px-1.5 py-0.5 text-[10px] font-semibold text-fg-4 tabular-nums">{d.bags.length} bags</span>
                              <span className="shrink-0 inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent tabular-nums">&times;{d.total}</span>
                              <IgnoreBtn name={d.n} ignored={isIgnored(d.n)} />
                              {d.noTrade
                                ? <span className="shrink-0 px-2.5 py-1 text-[10px] font-bold tracking-wide rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30" title="Exclusive / No-Trade items can't be consolidated">UNTRADABLE</span>
                                : <button onClick={() => setConso({ id: d.id, n: d.n, assets: g.assets, recipient: g.name })} className="le-tap shrink-0 px-2.5 py-1 text-[10px] font-bold tracking-wide rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">CONSOLIDATE</button>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {d.bags.map((l) => (
                                <span key={l.bag} title={l.acc ? undefined : 'Inaccessible: needs a Mog House or Nomad Moogle to reach, so it cannot be consolidated'} className={`inline-flex items-center gap-1 ${l.acc ? '' : 'opacity-45'}`}>
                                  <BagTag id={l.id} label={l.bag} className="max-w-[110px]" />
                                  <span className="text-[10px] font-semibold text-fg-2 tabular-nums">×{l.count}</span>
                                  {!l.acc && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-fg-4 shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
                                </span>
                              ))}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
        ) : (
        itemGroups.length === 0 ? (
          <div className={`${queue.jobs.length ? 'py-10' : 'h-full'} grid place-items-center text-center px-6`}>
            <div className="max-w-sm">
              <div className="text-[13px] font-bold text-fg mb-1">Nothing to consolidate</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">
                No item is held by more than one character. Consumables and food are hidden by default; toggle Consumables (or RA / EX / UNSTACKABLE) above to widen the search.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {selVisible.length > 0 && (
              <div className="sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-accent/40 bg-[var(--color-bg)] px-3 py-2 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.55)]">
                <span className="text-[11px] font-semibold text-fg-2 tabular-nums">{selVisible.length} item{selVisible.length === 1 ? '' : 's'} selected</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setSel(new Set())} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Clear</button>
                  <button onClick={addSelectedToQueue} className="le-tap px-3 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Add to Queue</button>
                </div>
              </div>
            )}
            <AnimatePresence mode="popLayout" initial={false}>
              {itemGroups.map((d) => (
                <motion.div key={d.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="rounded-lg border border-line bg-surface p-2.5">
                  <div className="flex items-center gap-2">
                    {d.noTrade
                      ? <span className="shrink-0 w-4" />
                      : <button onClick={() => toggleSel(d.id)} aria-label={sel.has(d.id) ? 'Deselect' : 'Select'} className={`le-tap shrink-0 w-4 h-4 rounded border grid place-items-center transition-colors ${sel.has(d.id) ? 'bg-accent border-accent text-on-accent' : 'border-line hover:border-accent/50'}`}>
                          {sel.has(d.id) && <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>}
                        </button>}
                    <DIcon id={d.id} n={d.n} assets={d.assets} iconSet={iconSet} />
                    <span className="truncate text-[12px] text-fg-2 flex-1 min-w-0">{d.n}</span>
                    <span className="shrink-0 inline-flex items-center rounded-md bg-field border border-line px-1.5 py-0.5 text-[10px] font-semibold text-fg-4 tabular-nums">{d.holders.length} chars</span>
                    <span className="shrink-0 inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent tabular-nums">&times;{d.total}</span>
                    <IgnoreBtn name={d.n} ignored={isIgnored(d.n)} />
                    {d.noTrade
                      ? <span className="shrink-0 px-2.5 py-1 text-[10px] font-bold tracking-wide rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/30" title="Exclusive / No-Trade items can't be traded between characters">UNTRADABLE</span>
                      : <button onClick={() => setConso({ id: d.id, n: d.n, assets: d.assets, recipient: d.holders[0].name })} className="le-tap shrink-0 px-2.5 py-1 text-[10px] font-bold tracking-wide rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">CONSOLIDATE</button>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.holders.map((h) => (
                      <span key={h.name} className="inline-flex items-center gap-1 w-32 rounded-md bg-field border border-line px-1.5 py-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${h.conn != null ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                        <span className="text-[10px] font-semibold text-fg-2 flex-1 min-w-0 truncate">{anon(h.name)}</span>
                        <span className="text-[10px] font-semibold text-fg-4 tabular-nums shrink-0">×{h.count}</span>
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )
        )}
        </>
        )}
      </div>
      {conso && <ConsolidateToModal id={conso.id} n={conso.n} assets={conso.assets} defaultRecipient={conso.recipient} onClose={() => setConso(null)} />}
      {localAll && <LocalConsolidateAllModal onClose={() => setLocalAll(false)} targets={localTargets} setTargets={setLocalTargets} />}

      {localSummary && (
        <Modal onClose={() => setLocalSummary(null)} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
          {(close) => (
            <div className="flex flex-col min-h-0">
              <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
                <h2 className="text-[14px] font-bold text-fg">Consolidated on {anon(localSummary.name)}</h2>
                <p className="text-[11px] text-fg-4 mt-1">{localSummary.rows.length > 0 ? `Merged ${localSummary.rows.length} item type${localSummary.rows.length === 1 ? '' : 's'} scattered across bags into one each.` : 'Nothing to consolidate; stacks are already merged.'}</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                {localSummary.rows.length === 0 ? (
                  <div className="text-center text-[12px] text-fg-4 py-8">All stacks were already consolidated.</div>
                ) : (
                  <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
                    {localSummary.rows.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                        <DIcon id={r.id} n={r.n} assets={localSummary.assets} iconSet={iconSet} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-fg-2 truncate">{r.n}</div>
                          <div className="text-[10px] text-fg-4 truncate">from {r.from.map((f) => `${f.bag} (×${f.count})`).join(', ')}</div>
                        </div>
                        <span className="shrink-0 text-accent text-[13px]">&rarr;</span>
                        <BagTag id={r.homeBagId} label={r.homeBag} className="max-w-[120px] shrink-0" />
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-fg">×{r.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 px-4 py-3 border-t border-line flex justify-end">
                <button onClick={close} className="px-4 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Done</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
