import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useShopSell, setShopSell } from './shop';
import { useItemNames, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { useSticky } from './sticky';
import { Group, Row, Toggle, SearchInput } from './ui';
import { useSettings } from './settings';

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
  const [filter, setFilter] = useSticky('sell.filter', '');

  const set = (items: string[], auto: boolean, anywhere: boolean = sell.anywhere) => setShopSell({ items, auto, anywhere });
  const has = (n: string) => sell.items.some((x) => x.toLowerCase() === n.toLowerCase());
  const addItem = (name: string) => {
    const n = name.trim();
    if (n && !has(n)) set([...sell.items, n], sell.auto);
    setAdd('');
  };
  const remove = (name: string) => set(sell.items.filter((x) => x !== name), sell.auto);

  const matches = useMemo(() => {
    const q = add.trim().toLowerCase();
    if (!q) return [];
    const out: ItemName[] = [];
    for (const it of allItems) {
      if (it.n.toLowerCase().includes(q) && !has(it.n)) { out.push(it); if (out.length >= 8) break; }
    }
    return out;
  }, [add, allItems, sell.items]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? sell.items.filter((n) => n.toLowerCase().includes(q)) : sell.items;
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

        <Group title="Sell List" right={<span className="text-[11px] text-fg-4 tabular-nums">{filter.trim() ? `${shown.length}/${sell.items.length}` : sell.items.length}</span>}>
          <div className="px-2.5 pt-2.5 pb-1.5 flex flex-col gap-2">
            <div className="relative">
              <div className="flex items-center gap-2">
                <input
                  value={add}
                  onChange={(e) => setAdd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addItem(add); }}
                  placeholder="Add any item by name…"
                  className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
                />
                <button onClick={() => addItem(add)} disabled={!add.trim()} className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Add</button>
              </div>
              {matches.length > 0 && (
                <div className="mt-1 rounded-lg border border-line bg-surface divide-y divide-line overflow-hidden">
                  {matches.map((it) => (
                    <button key={it.id} onClick={() => addItem(it.n)} className="le-tap w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-field transition-colors">
                      <SmallIcon id={it.id} n={it.n} assets={assetsAny} iconSet={iconSet} />
                      <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2">{it.n}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-accent">Add</span>
                    </button>
                  ))}
                </div>
              )}
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
                    className="flex items-center gap-2 px-3 py-1.5"
                  >
                    <SmallIcon id={idByName.get(name.toLowerCase())} n={name} assets={assetsAny} iconSet={iconSet} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{name}</span>
                    <button onClick={() => remove(name)} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Group>
      </div>
    </div>
  );
}
