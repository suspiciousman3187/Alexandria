import type { InvItem } from './bridge';
import { ITEM_CATEGORIES, itemCategory, itemCategoryRank, type ItemCategory } from './itemNames';
import { getItemTags } from './itemTags';

// Shared item sorting for Inventory and Library so both views offer the exact same options.
// Generic over the container: Inventory sorts { item, bag } entries, Library sorts bare
// items, so callers pass a getItem accessor. Sorting is display-only -- each element keeps
// its own slot, so drag/move stays correct regardless of visual order.
export type SortMode =
  | 'slot' | 'type' | 'recent' | 'az' | 'za' | 'qty'
  | 'rare' | 'notrade' | 'noah' | 'unstack' | 'usable' | `cat:${ItemCategory}` | `tag:${string}`;

export const SORTS: { id: SortMode; label: string }[] = [
  { id: 'slot', label: 'Default' },
  { id: 'type', label: 'Type' },
  { id: 'recent', label: 'Recently Moved' },
  { id: 'az', label: 'Name A-Z' },
  { id: 'za', label: 'Name Z-A' },
  { id: 'qty', label: 'Quantity' },
  { id: 'rare', label: 'Rare' },
  { id: 'notrade', label: 'Exclusive' },
  { id: 'noah', label: 'Unauctionable' },
  { id: 'unstack', label: 'Unstackable' },
  { id: 'usable', label: 'Consumable' },
  ...ITEM_CATEGORIES.filter((c) => c.id !== 'other').map((c) => ({ id: `cat:${c.id}` as SortMode, label: c.label })),
];

// Per-tag sort options, appended to SORTS by the views (tags are user-defined and change at
// runtime). Selecting one puts items carrying that tag first, like the category sorts do for
// equipment slots.
export function tagSorts(tags: { id: string; name: string }[]): { id: SortMode; label: string }[] {
  return tags.map((t) => ({ id: `tag:${t.id}` as SortMode, label: t.name }));
}

export function sortBy<T>(arr: T[], getItem: (t: T) => InvItem, mode: SortMode, movedAt?: (t: T) => number): T[] {
  if (mode === 'slot') return arr;
  const out = [...arr];
  const name = (a: T, b: T) => getItem(a).n.localeCompare(getItem(b).n);
  const flag = (bit: number) => (a: T, b: T) => (((getItem(b).f ?? 0) & bit) ? 1 : 0) - (((getItem(a).f ?? 0) & bit) ? 1 : 0) || name(a, b);
  if (mode.startsWith('cat:')) {
    const cat = mode.slice(4);
    return out.sort((a, b) => ((itemCategory(getItem(a).id) === cat ? 0 : 1) - (itemCategory(getItem(b).id) === cat ? 0 : 1)) || name(a, b));
  }
  if (mode.startsWith('tag:')) {
    // Items carrying this specific tag first, then everything else, alphabetical within each.
    const tid = mode.slice(4);
    const { assign } = getItemTags();
    const has = (id: number) => (assign[id] ?? []).includes(tid);
    return out.sort((a, b) => ((has(getItem(a).id) ? 0 : 1) - (has(getItem(b).id) ? 0 : 1)) || name(a, b));
  }
  switch (mode) {
    case 'type': return out.sort((a, b) => itemCategoryRank(getItem(a).id) - itemCategoryRank(getItem(b).id) || name(a, b));
    case 'recent': return out.sort((a, b) => (movedAt?.(b) ?? 0) - (movedAt?.(a) ?? 0));
    case 'az': return out.sort(name);
    case 'za': return out.sort((a, b) => name(b, a));
    case 'qty': return out.sort((a, b) => getItem(b).c - getItem(a).c || name(a, b));
    case 'rare': return out.sort(flag(0x01));
    case 'notrade': return out.sort(flag(0x02));
    case 'noah': return out.sort(flag(0x08));
    case 'unstack': return out.sort(flag(0x04));
    case 'usable': return out.sort((a, b) => ((getItem(a).u ? 0 : 1) - (getItem(b).u ? 0 : 1)) || name(a, b));
    default: return out;
  }
}
