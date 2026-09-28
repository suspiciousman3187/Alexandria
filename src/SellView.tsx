import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useShopSell, setShopSell } from './shop';
import { useItemNames, itemNameMatches, nameMatches, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { Popover } from './overlay';
import { useSticky } from './sticky';
import { Group, Row, Toggle, SearchInput, Button } from './ui';
import { useSettings } from './settings';
import { exportSellList } from './sellListShare';
import SellListImportModal from './SellListImportModal';

// Max add-search suggestions shown at once. Generous so a full job-variant set (e.g. every "??? Ear.: <JOB>")
// fits; the dropdown scrolls past this and shows a "keep typing" hint only when there are still more.
const MAX_SUGGEST = 100;

function SmallIcon({ id, n, assets, iconSet }: { id?: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id ?? 0} size={20} name={n} assets={assets} bmpHas={id != null && id > 0 && iconSet.has(id)} />
    </div>
  );
}

export default function SellView() {
  const sell = useShopSell();
  const exp = useSettings().experimentalFeatures;
  const allItems = useItemNames();
  const iconSet = useAvailableIcons();
  const known = useKnownCharacters();
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const idByName = useMemo(() => new Map(allItems.map((it) => [it.n.toLowerCase(), it.id])), [allItems]);

  const [add, setAdd] = useState('');
  const addWrap = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useSticky('sell.filter', '');
  const [importOpen, setImportOpen] = useState(false);

  const set = (items: string[], auto: boolean, anywhere: boolean = sell.anywhere) => setShopSell({ items, auto, anywhere });
  const has = (n: string) => sell.items.some((x) => x.toLowerCase() === n.toLowerCase());
  const addItem = (name: string) => {
    const n = name.trim();
    if (n && !has(n)) set([...sell.items, n], sell.auto);
    setAdd('');
  };
  const remove = (name: string) => set(sell.items.filter((x) => x !== name), sell.auto);
  // Drag-paint multi-select (same shape as the inventory grid / consolidate prefs): pointer-down on a row sets
  // add-vs-remove from that row's current state, then dragging across rows paints the rest; Remove Selected drops
  // them all in one write.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const dragRef = useRef<{ add: boolean } | null>(null);
  const applySel = (name: string, add: boolean) => setSel((p) => { const n = new Set(p); if (add) n.add(name); else n.delete(name); return n; });
  const paintDown = (name: string) => {
    const add = !sel.has(name);
    dragRef.current = { add };
    applySel(name, add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const paintEnter = (name: string) => { if (dragRef.current) applySel(name, dragRef.current.add); };
  const removeSelected = () => { const s = sel; set(sell.items.filter((x) => !s.has(x)), sell.auto); setSel(new Set()); };

  const matches = useMemo(() => {
    const q = add.trim().toLowerCase();
    if (!q) return [];
    // Collect up to MAX_SUGGEST+1 (the extra flags "there are more" for the footer). The old cap of 8 hid
    // most of a multi-variant set -- e.g. "??? ear" has a job-specific piece per job, so only WAR/MNK/WHM
    // showed. The dropdown already scrolls (max-h-64), so a high cap just lets you scroll the full set.
    const out: ItemName[] = [];
    for (const it of allItems) {
      if (itemNameMatches(it.id, it.n, q) && !has(it.n)) { out.push(it); if (out.length > MAX_SUGGEST) break; }
    }
    return out;
  }, [add, allItems, sell.items]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? sell.items.filter((n) => nameMatches(n, q)) : sell.items;
  }, [sell.items, filter]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <Group title="Auto-Sell">
          <Row label="Auto-Sell On Shop Open">
            <Toggle on={sell.auto} onChange={(v) => set(sell.items, v)} />
          </Row>
          <Row
            label={
              <span className="flex items-center gap-2">
                Auto-Sell In Towns
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">Experimental</span>
              </span>
            }
            desc={!exp ? 'Enable Experimental Features in Settings to use this.' : undefined}
          >
            <Toggle on={sell.anywhere && exp} disabled={!exp} onChange={(v) => set(sell.items, sell.auto, v)} />
          </Row>
        </Group>

        <Group title="Sell List" right={
          <span className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
              Import
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportSellList(sell.items)} disabled={sell.items.length === 0}>
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>
              Export
            </Button>
            <span className="text-[11px] text-fg-4 tabular-nums">{filter.trim() ? `${shown.length}/${sell.items.length}` : sell.items.length}</span>
          </span>
        }>
          <div className="px-2.5 pt-2.5 pb-1.5 flex flex-col gap-2">
            <div ref={addWrap} className="relative">
              <div className="flex items-center gap-2">
                <input
                  value={add}
                  onChange={(e) => setAdd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addItem(add); }}
                  placeholder="Add any item by name…"
                  className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
                />
                <button onClick={() => addItem(add)} disabled={!add.trim()} className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Add</button>
              </div>
              <Popover open={matches.length > 0} anchor={addWrap} className="rounded-lg border border-line bg-popover divide-y divide-line overflow-hidden max-h-64 overflow-y-auto shadow-2xl">
                {matches.slice(0, MAX_SUGGEST).map((it) => (
                  <button key={it.id} onClick={() => addItem(it.n)} className="le-tap w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field transition-colors">
                    <SmallIcon id={it.id} n={it.n} assets={assetsAny} iconSet={iconSet} />
                    <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2">{it.n}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-accent">Add</span>
                  </button>
                ))}
                {matches.length > MAX_SUGGEST && (
                  <div className="px-3 py-2 text-center text-[11px] text-fg-4">Keep typing to narrow the list.</div>
                )}
              </Popover>
            </div>
            {sell.items.length > 0 && (
              <SearchInput
                value={filter}
                onChange={setFilter}
                wrap=""
                placeholder="Filter list…"
                className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
              />
            )}
            {sell.items.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSel(shown.length > 0 && shown.every((n) => sel.has(n)) ? new Set() : new Set(shown))}
                  className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg-2 transition-colors"
                >
                  {shown.length > 0 && shown.every((n) => sel.has(n)) ? 'Deselect All' : 'Select All'}
                </button>
                {sel.size > 0 && (
                  <>
                    <span className="text-[11px] text-fg-4 tabular-nums">{sel.size} selected</span>
                    <button
                      onClick={removeSelected}
                      className="le-tap ml-auto px-2.5 py-1 text-[11px] font-bold rounded-md border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                    >
                      Remove Selected
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {sell.items.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-[12px] text-fg-4">Sell list is empty. Add items above to auto-sell them whenever you open a shop.</div>
          ) : shown.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-[12px] text-fg-4">No items match.</div>
          ) : (
            <div className="border-t border-line divide-y divide-line">
              <AnimatePresence mode="popLayout" initial={false}>
                {shown.map((name) => (
                  <motion.div
                    key={name}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    onPointerDown={() => paintDown(name)}
                    onPointerEnter={() => paintEnter(name)}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors ${sel.has(name) ? 'bg-accent/10' : 'hover:bg-field/40'}`}
                  >
                    <input type="checkbox" checked={sel.has(name)} readOnly className="shrink-0 w-3.5 h-3.5 accent-[var(--color-accent)] pointer-events-none" />
                    <SmallIcon id={idByName.get(name.toLowerCase())} n={name} assets={assetsAny} iconSet={iconSet} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{name}</span>
                    <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); remove(name); }} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Group>
      </div>
      {importOpen && <SellListImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}
