import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useBoxes, useKnownCharacters, useAvailableIcons, useDropIconMap, broadcastDropNow, dropClean, NOMAD_BAGS, nomadReachable, inTauri, type KnownChar } from './bridge';
import { useDrop, setDrop } from './drop';
import { Group, Row, Toggle, SearchInput } from './ui';
import { useSticky } from './sticky';
import { useSettings } from './settings';
import { useItemValues, getCachedValue } from './priceStore';
import { useAnon } from './anonymize';
import { nameMatches } from './itemNames';
import { Modal, Collapse } from './overlay';
import { MOG_ONLY_BAGS } from './bagConstants';
import TreasuryImportModal from './TreasuryImportModal';
import DropListImportModal from './DropListImportModal';
import { exportDropList } from './sellListShare';

// Bags the cleanout pulls from (matches the addon do_retrieve list {1,9,2,4,5,6,7}). Carry
// bags are always reachable; Safe/Storage/Locker/Safe 2 need a Mog House or Nomad Moogle.
const CLEAN_CARRY = new Set([5, 6, 7]);
const CLEAN_MOG = MOG_ONLY_BAGS;
const DROP_VALUABLE = 10000;

function cleanReachable(bagId: number, mog: boolean, nomadOk: boolean): boolean {
  if (bagId === 0 || CLEAN_CARRY.has(bagId)) return true;
  if (CLEAN_MOG.has(bagId)) return mog || (NOMAD_BAGS.has(bagId) && nomadOk);
  return false;
}

function Icon({ id, name, assets }: { id?: number; name: string; assets?: string }) {
  const [broken, setBroken] = useState(false);
  const icons = useAvailableIcons();
  const has = id != null && icons.has(id);
  const src = has && assets && inTauri ? convertFileSrc(`${assets}/icon_${id}.bmp`) : null;
  return (
    <div className="relative shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden">
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} className="w-full h-full object-contain" />
      ) : (
        <span className="text-fg-4 text-[8px] font-bold">{(name[0] || '?').toUpperCase()}</span>
      )}
    </div>
  );
}

export default function DropView() {
  const known = useKnownCharacters();
  const boxes = useBoxes();
  const cfg = useDrop();
  const iconMap = useDropIconMap();
  const exp = useSettings().experimentalFeatures;
  const anon = useAnon();
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingList, setImportingList] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewChecked, setReviewChecked] = useState<Set<string>>(() => new Set());
  const [reviewFilter, setReviewFilter] = useState('');
  const [cleanSel, setCleanSel] = useState<'all' | string>('all');

  const dropSet = useMemo(() => new Set(cfg.drop.map((n) => n.toLowerCase())), [cfg.drop]);
  const excludeSet = useMemo(() => new Set(cfg.exclude ?? []), [cfg.exclude]);
  const toggleExclude = (name: string) => setDrop({ ...cfg, exclude: excludeSet.has(name) ? (cfg.exclude ?? []).filter((n) => n !== name) : [...(cfg.exclude ?? []), name] });

  const matchCount = (c: KnownChar) => {
    const mainBag = (c.inv ?? []).find((b) => b.id === 0);
    let n = 0;
    for (const it of mainBag?.items ?? []) if (dropSet.has(it.n.toLowerCase())) n += it.c;
    return n;
  };

  // Exactly what "Drop Matching Now" will drop: matching items in each online character's
  // main inventory (the only bag the drop-now touches), so the user can review first.
  const dropNowPlanFor = (c: KnownChar) => {
    const mainBag = (c.inv ?? []).find((b) => b.id === 0);
    const totals = new Map<string, { name: string; id: number; count: number }>();
    for (const it of mainBag?.items ?? []) {
      if (!dropSet.has(it.n.toLowerCase())) continue;
      const k = it.n.toLowerCase();
      const cur = totals.get(k) ?? { name: it.n, id: it.id, count: 0 };
      cur.count += it.c;
      totals.set(k, cur);
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const sortedChars = useMemo<KnownChar[]>(
    () => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)),
    [known],
  );
  const onlineMatches = sortedChars.filter((c) => c.online && !excludeSet.has(c.name)).reduce((s, c) => s + matchCount(c), 0);

  // Everything across a character's reachable bags (not just main inventory) that the
  // cleanout would pull in and drop. Used to preview exactly what gets cleaned out.
  const planFor = (c: KnownChar) => {
    const nomadOk = nomadReachable(c, exp);
    const totals = new Map<string, { name: string; id: number; count: number }>();
    for (const bag of c.inv ?? []) {
      if (!cleanReachable(bag.id, !!c.mog, nomadOk)) continue;
      for (const it of bag.items) {
        if (!dropSet.has(it.n.toLowerCase())) continue;
        const k = it.n.toLowerCase();
        const cur = totals.get(k) ?? { name: it.n, id: it.id, count: 0 };
        cur.count += it.c;
        totals.set(k, cur);
      }
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const onlineChars = useMemo(() => sortedChars.filter((c) => c.online), [sortedChars]);
  const dropNowPlan = useMemo(
    () => onlineChars.filter((c) => !excludeSet.has(c.name)).map((c) => ({ char: c, rows: dropNowPlanFor(c) })).filter((p) => p.rows.length > 0),
    [onlineChars, dropSet, excludeSet],
  );
  const dropNowTotal = dropNowPlan.reduce((s, p) => s + p.rows.reduce((n, r) => n + r.count, 0), 0);
  const cleanTargets = useMemo(
    () => (cleanSel === 'all' ? onlineChars.filter((c) => !excludeSet.has(c.name)) : onlineChars.filter((c) => c.name === cleanSel)),
    [cleanSel, onlineChars, excludeSet],
  );
  const cleanPlan = useMemo(
    () => cleanTargets.map((c) => ({ char: c, rows: planFor(c) })).filter((p) => p.rows.length > 0),
    [cleanTargets, dropSet, exp],
  );
  const cleanTotal = cleanPlan.reduce((s, p) => s + p.rows.reduce((n, r) => n + r.count, 0), 0);
  const runClean = () => {
    for (const p of cleanPlan) if (p.char.conn != null) dropClean(p.char.conn, cfg.drop);
    setCleaning(false);
  };

  const nameToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of known) for (const b of c.inv ?? []) for (const it of b.items) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
    return m;
  }, [known]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const [add, setAdd] = useState('');
  const addItem = () => {
    const n = add.trim();
    if (n && !cfg.drop.some((x) => x.toLowerCase() === n.toLowerCase())) setDrop({ ...cfg, drop: [...cfg.drop, n] });
    setAdd('');
  };
  const removeItem = (name: string) => setDrop({ ...cfg, drop: cfg.drop.filter((x) => x !== name) });
  const [filter, setFilter] = useSticky('drop.filter', '');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? cfg.drop.filter((n) => nameMatches(n, q)) : cfg.drop;
  }, [cfg.drop, filter]);
  const world = useSettings().ahServer || known.find((c) => c.online)?.server;
  const shownIds = useMemo(() => shown.map((name) => iconMap[name] ?? nameToId.get(name.toLowerCase())).filter((id): id is number => typeof id === 'number' && id > 0), [shown, iconMap, nameToId]);
  const dropValues = useItemValues(world, shownIds);
  const valuableCount = useMemo(() => shownIds.filter((id) => (dropValues.get(id)?.median ?? 0) >= DROP_VALUABLE).length, [shownIds, dropValues]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
      <Group title="Auto-Drop">
        <Row label="Auto-Drop Matching Items" desc="Connected characters drop these from inventory automatically. Dropped items are gone for good.">
          <Toggle on={cfg.autoDrop} onChange={(v) => { if (v && !cfg.reviewed) { setReviewChecked(new Set(cfg.drop)); setReviewFilter(''); setReviewOpen(true); } else setDrop({ ...cfg, autoDrop: v }); }} />
        </Row>
        <div className="pt-1">
          <button
            onClick={() => { if (cfg.skipDropConfirm) void broadcastDropNow(); else setConfirming(true); }}
            disabled={boxes.length === 0 || onlineMatches === 0}
            className="le-tap w-full px-3 py-2 text-[12px] font-semibold rounded-md transition-colors bg-red-500/90 text-white hover:bg-red-500 disabled:bg-field disabled:text-fg-4 disabled:hover:bg-field"
          >
            {boxes.length === 0 ? 'No Characters Connected' : onlineMatches === 0 ? 'Drop Matching Now' : cfg.skipDropConfirm ? `Drop Matching Now (${onlineMatches})` : `Review & Drop Matching (${onlineMatches})`}
          </button>
        </div>
      </Group>

      {known.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="px-0.5 text-[10px] text-fg-4">Click a character to exclude it from auto-drop (e.g. crafting mules that use drop-list items).</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5">
            {sortedChars.map((c) => {
              const n = matchCount(c);
              const excluded = excludeSet.has(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() => toggleExclude(c.name)}
                  title={excluded ? 'Excluded from auto-drop, click to include' : 'Click to exclude from auto-drop'}
                  className={`flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-md text-[11px] border transition-colors ${
                    excluded ? 'border-line bg-field/40 text-fg-4' : n > 0 ? 'border-amber-500/50 bg-amber-500/10 text-amber-200 hover:border-amber-400' : 'border-line bg-field text-fg-3 hover:border-line-2'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${excluded ? 'bg-fg-4' : c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                  <span className={`truncate flex-1 text-left ${excluded ? 'line-through opacity-70' : ''}`}>{anon(c.name)}</span>
                  {excluded ? <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-fg-4">off</span> : <span className="tabular-nums font-semibold shrink-0">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Group title="Drop List" right={
        <div className="flex items-center gap-2">
          <button onClick={() => void exportDropList(cfg.drop)} disabled={cfg.drop.length === 0} title="Save your drop list to a file to share" className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 disabled:opacity-40 transition-colors">Export</button>
          <button onClick={() => setImportingList(true)} title="Merge a shared drop list into yours" className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Import</button>
          <button onClick={() => setImporting(true)} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Import From Treasury</button>
          <span className="text-[11px] text-fg-4 tabular-nums">{filter.trim() ? `${shown.length}/${cfg.drop.length}` : cfg.drop.length}</span>
        </div>
      }>
        <div className="flex items-center gap-2 mb-2.5">
          <input
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            placeholder="Add an item name…"
            className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
          />
          <button onClick={addItem} disabled={!add.trim()} className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Add</button>
        </div>
        {cfg.drop.length > 0 && (
          <button
            onClick={() => { setCleanSel('all'); setCleaning(true); }}
            disabled={boxes.length === 0}
            className="le-tap w-full mb-2.5 px-3 py-2 text-[12px] font-semibold rounded-md border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40 disabled:hover:bg-red-500/10 transition-colors"
          >
            Bring All Drop List Items To Inventory
          </button>
        )}
        {cfg.drop.length > 0 && (
          <SearchInput
            value={filter}
            onChange={setFilter}
            wrap="mb-2.5"
            placeholder="Filter list…"
            className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
          />
        )}
        <Collapse open={valuableCount > 0}>
          <div className="mb-2.5 px-3 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-[11px] font-semibold text-red-300">
            {valuableCount} item{valuableCount === 1 ? '' : 's'} here {valuableCount === 1 ? 'is' : 'are'} worth {DROP_VALUABLE.toLocaleString()}+ gil. Review before auto-dropping.
          </div>
        </Collapse>
        {cfg.drop.length === 0 ? (
          <div className="text-center text-[12px] text-fg-4 py-6">Drop list is empty.</div>
        ) : shown.length === 0 ? (
          <div className="text-center text-[12px] text-fg-4 py-6">No items match.</div>
        ) : (
          <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
            <AnimatePresence mode="popLayout" initial={false}>
              {shown.map((name) => {
                const id = iconMap[name] ?? nameToId.get(name.toLowerCase());
                return (
                  <motion.div
                    key={name}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="flex items-center gap-2 px-2.5 py-1"
                  >
                    <Icon id={id} name={name} assets={assetsAny} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{name}</span>
                    {(() => {
                      const m = id != null ? dropValues.get(id)?.median : undefined;
                      if (m == null || m <= 0) return null;
                      const hot = m >= DROP_VALUABLE;
                      return <span className={`shrink-0 text-[11px] font-bold tabular-nums ${hot ? 'text-red-300' : 'text-fg-4'}`}>{m.toLocaleString()}<span className="text-[8px] ml-0.5 opacity-70">G</span></span>;
                    })()}
                    <button onClick={() => removeItem(name)} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </Group>

      {importing && <TreasuryImportModal onClose={() => setImporting(false)} />}
      {importingList && <DropListImportModal onClose={() => setImportingList(false)} />}

      {reviewOpen && (() => {
        const f = reviewFilter.trim().toLowerCase();
        const list = f ? cfg.drop.filter((n) => nameMatches(n, f)) : cfg.drop;
        const keep = reviewChecked.size;
        return (
          <Modal onClose={() => setReviewOpen(false)} panelClass="w-[min(94vw,520px)] max-h-[90vh]">
            {(close) => (
              <div className="flex flex-col min-h-0">
                <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
                  <h2 className="text-[14px] font-bold text-fg">Review Drop List</h2>
                  <p className="text-[11px] text-fg-4 mt-1 leading-snug">Auto-Drop permanently drops these items from inventory. Alexandria ships with a starter list. Uncheck anything you want to keep, then enable. Dropped items are gone for good.</p>
                </div>
                <div className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2">
                  <SearchInput value={reviewFilter} onChange={setReviewFilter} placeholder="Filter list…" className="flex-1 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
                  <button onClick={() => setReviewChecked(new Set(cfg.drop))} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">All</button>
                  <button onClick={() => setReviewChecked(new Set())} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">None</button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
                  <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
                    {list.map((name) => {
                      const id = iconMap[name] ?? nameToId.get(name.toLowerCase());
                      const on = reviewChecked.has(name);
                      return (
                        <label key={name} className="flex items-center gap-2 px-2.5 py-1 cursor-pointer hover:bg-field/40 transition-colors">
                          <input type="checkbox" checked={on} onChange={() => setReviewChecked((c) => { const next = new Set(c); if (next.has(name)) next.delete(name); else next.add(name); return next; })} className="accent-[var(--color-accent)] shrink-0" />
                          <Icon id={id} name={name} assets={assetsAny} />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{name}</span>
                        </label>
                      );
                    })}
                    {list.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-fg-4">No items match.</div>}
                  </div>
                </div>
                <div className="shrink-0 px-4 py-3 border-t border-line flex items-center gap-2">
                  <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                  <button
                    onClick={() => { setDrop({ ...cfg, drop: cfg.drop.filter((n) => reviewChecked.has(n)), autoDrop: true, reviewed: true }); setReviewOpen(false); }}
                    className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    Enable Auto-Drop ({keep})
                  </button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {cleaning && (
        <Modal onClose={() => setCleaning(false)} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
          {(close) => (
            <div className="flex flex-col min-h-0">
              <div className="px-4 pt-4 pb-3 border-b border-line">
                <h2 className="text-[14px] font-bold text-fg">Bring &amp; Drop List Items</h2>
                <p className="text-[11px] text-fg-4 mt-1">Pulls every drop-list item from reachable bags into inventory and drops them. Dropped items are gone for good.</p>
              </div>

              <div className="px-4 pt-3 pb-2 grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5">
                <button
                  onClick={() => setCleanSel('all')}
                  className={`col-span-full px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${cleanSel === 'all' ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-3 hover:text-fg-2'}`}
                >
                  All Characters
                </button>
                {onlineChars.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setCleanSel(c.name)}
                    className={`flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${cleanSel === c.name ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-3 hover:text-fg-2'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="truncate">{anon(c.name)}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                {cleanPlan.length === 0 ? (
                  <div className="text-center text-[12px] text-fg-4 py-8">Nothing to clean from {cleanSel === 'all' ? 'these characters' : anon(cleanSel)}.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {cleanPlan.map((p) => (
                      <div key={p.char.name} className="rounded-lg border border-line bg-surface overflow-hidden">
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-field border-b border-line">
                          <span className="text-[12px] font-semibold text-fg-2 truncate">{anon(p.char.name)}</span>
                          <span className="text-[11px] font-semibold tabular-nums text-red-300">{p.rows.reduce((n, r) => n + r.count, 0)} to drop</span>
                        </div>
                        <div className="divide-y divide-line">
                          {p.rows.map((r) => (
                            <div key={r.name} className="flex items-center gap-2 px-2.5 py-1">
                              <Icon id={iconMap[r.name] ?? r.id} name={r.name} assets={assetsAny} />
                              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{r.name}</span>
                              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-fg-3">×{r.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-line flex items-center gap-2">
                <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                <button
                  onClick={runClean}
                  disabled={cleanTotal === 0}
                  className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 disabled:bg-field disabled:text-fg-4 disabled:hover:bg-field transition-colors"
                >
                  {cleanTotal === 0 ? 'Nothing To Drop' : `Confirm Drop (${cleanTotal})`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {confirming && (
        <Modal onClose={() => setConfirming(false)} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
          {(close) => (
            <div className="flex flex-col min-h-0">
              <div className="px-4 pt-4 pb-3 border-b border-line">
                <h2 className="text-[14px] font-bold text-fg">Drop Matching Items</h2>
                <p className="text-[11px] text-fg-4 mt-1">These items will be dropped from every connected character's inventory. Dropped items are gone for good.</p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                {dropNowPlan.length === 0 ? (
                  <div className="text-center text-[12px] text-fg-4 py-8">Nothing matching in any inventory.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {dropNowPlan.map((p) => (
                      <div key={p.char.name} className="rounded-lg border border-line bg-surface overflow-hidden">
                        <div className="flex items-center justify-between px-2.5 py-1.5 bg-field border-b border-line">
                          <span className="text-[12px] font-semibold text-fg-2 truncate">{anon(p.char.name)}</span>
                          <span className="text-[11px] font-semibold tabular-nums text-red-300">{p.rows.reduce((n, r) => n + r.count, 0)} to drop</span>
                        </div>
                        <div className="divide-y divide-line">
                          {p.rows.map((r) => {
                            const med = world ? getCachedValue(world, r.id)?.median : undefined;
                            const hot = med != null && med >= DROP_VALUABLE;
                            return (
                              <div key={r.name} className="flex items-center gap-2 px-2.5 py-1">
                                <Icon id={iconMap[r.name] ?? r.id} name={r.name} assets={assetsAny} />
                                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{r.name}</span>
                                {med != null && med > 0 && <span className={`shrink-0 text-[11px] font-bold tabular-nums ${hot ? 'text-red-300' : 'text-fg-4'}`}>{med.toLocaleString()}<span className="text-[8px] ml-0.5 opacity-70">G</span></span>}
                                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-fg-3 w-9 text-right">×{r.count}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-line flex items-center gap-2">
                <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                <button
                  onClick={() => { void broadcastDropNow(); setConfirming(false); }}
                  disabled={dropNowTotal === 0}
                  className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 disabled:bg-field disabled:text-fg-4 disabled:hover:bg-field transition-colors"
                >
                  {dropNowTotal === 0 ? 'Nothing To Drop' : `Confirm Drop (${dropNowTotal})`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
