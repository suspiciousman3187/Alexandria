import { useState } from 'react';
import { ITEM_CATEGORIES, type ItemCategory } from './itemNames';
import { STORABLE_BAGS, ALL_PLAYERS_KEY } from './storagePrefs';
import { useSlotRules, setSlotRules, type SlotRule } from './slotRules';

// Slot-routing destinations: the 8 wardrobes (the natural home for gear) plus the storage bags, so an odd
// slot like Ammo can go to Sack if preferred. Inventory (0) is intentionally left out -- routing a whole
// equipment slot back onto the character makes no sense.
const WARDROBE_BAGS = [
  { id: 8, name: 'Wardrobe 1' }, { id: 10, name: 'Wardrobe 2' }, { id: 11, name: 'Wardrobe 3' }, { id: 12, name: 'Wardrobe 4' },
  { id: 13, name: 'Wardrobe 5' }, { id: 14, name: 'Wardrobe 6' }, { id: 15, name: 'Wardrobe 7' }, { id: 16, name: 'Wardrobe 8' },
];
const ROUTE_BAGS = [...WARDROBE_BAGS, ...STORABLE_BAGS];
const bagName = (id: number) => ROUTE_BAGS.find((x) => x.id === id)?.name ?? String(id);
// Equipment slots only -- 'other' has no equip slot to route by.
const SLOT_CATS = ITEM_CATEGORIES.filter((c) => c.id !== 'other');

export function SlotRoutingEditor({ storeKey, isAll }: { storeKey: string; isAll: boolean }) {
  const rules = useSlotRules();
  const entries = rules[storeKey] ?? [];
  const allPlayers = rules[ALL_PLAYERS_KEY] ?? [];
  const [open, setOpen] = useState<Set<ItemCategory>>(() => new Set());
  const toggleOpen = (cat: ItemCategory) => setOpen((s) => { const n = new Set(s); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; });
  const commit = (next: SlotRule[]) => setSlotRules(storeKey, next);
  const upsert = (rule: SlotRule) => commit([...entries.filter((e) => e.cat !== rule.cat), rule]);
  const clearCat = (cat: ItemCategory) => commit(entries.filter((e) => e.cat !== cat));

  return (
    <div className="flex flex-col gap-1.5">
      {SLOT_CATS.map((c) => {
        const own = entries.find((e) => e.cat === c.id);
        const inh = isAll ? undefined : allPlayers.find((e) => e.cat === c.id);
        const bags = own?.bags ?? [];
        const isOpen = open.has(c.id);
        const toggleBag = (bagId: number) => {
          const next = bags.includes(bagId) ? bags.filter((b) => b !== bagId) : [...bags, bagId];
          if (next.length) upsert({ cat: c.id, bags: next }); else clearCat(c.id);
        };
        const status = own
          ? { text: own.bags.map(bagName).join(' › '), cls: 'text-accent' }
          : inh
            ? { text: `Follows All Players: ${inh.bags.map(bagName).join(' › ')}`, cls: 'text-fg-4' }
            : { text: 'Not routed', cls: 'text-fg-5' };
        return (
          <div key={c.id} className="rounded-lg border border-line bg-surface overflow-hidden">
            <button onClick={() => toggleOpen(c.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field/40 transition-colors">
              <svg className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
              <span className="shrink-0 text-[12px] font-bold text-fg-2">{c.label}</span>
              {own && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
              <span className={`min-w-0 flex-1 truncate text-right text-[11px] ${status.cls}`}>{status.text}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-2.5 pt-1 border-t border-line/60">
                <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))' }}>
                  {ROUTE_BAGS.map((b) => {
                    const idx = bags.indexOf(b.id);
                    const on = idx >= 0;
                    return (
                      <button key={b.id} onClick={() => toggleBag(b.id)} aria-pressed={on} className={`w-full px-1.5 py-1 text-[10.5px] font-bold rounded border transition-colors truncate ${on ? 'bg-accent text-on-accent border-transparent' : 'bg-field text-fg-3 border-line hover:text-fg-2'}`}>
                        {on ? `${idx + 1}. ${b.name}` : b.name}
                      </button>
                    );
                  })}
                </div>
                {own && (
                  <div className="mt-1.5 flex justify-end">
                    <button onClick={() => clearCat(c.id)} className="text-[10px] font-semibold text-fg-4 hover:text-fg-2 transition-colors">Clear</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
