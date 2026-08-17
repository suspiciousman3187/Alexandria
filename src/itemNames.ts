import { useSyncExternalStore } from 'react';

export type ItemName = { id: number; n: string; st: number; l?: string; sl?: number };

let list: ItemName[] = [];
let fullById = new Map<number, string>();
let stackById = new Map<number, number>();
let slotById = new Map<number, number>();
let started = false;
const subs = new Set<() => void>();

async function load() {
  if (started) return;
  started = true;
  try {
    const resp = await fetch('/item_names.json');
    if (resp.ok) {
      const p = await resp.json();
      if (Array.isArray(p)) {
        list = p;
        fullById = new Map();
        stackById = new Map();
        slotById = new Map();
        for (const it of list) {
          if (it.l) fullById.set(it.id, it.l.toLowerCase());
          if (it.st > 1) stackById.set(it.id, it.st);
          if (it.sl) slotById.set(it.id, it.sl);
        }
      }
    }
  } catch { /* not bundled (dev without build:itemnames) */ }
  subs.forEach((s) => s());
}

export function itemStack(id: number): number {
  return stackById.get(id) ?? 1;
}

export type ItemCategory = 'main' | 'sub' | 'ranged' | 'ammo' | 'head' | 'body' | 'hands' | 'legs' | 'feet' | 'neck' | 'waist' | 'ears' | 'rings' | 'back' | 'other';

const SLOT_BITS: { cat: ItemCategory; bit: number }[] = [
  { cat: 'main', bit: 0x0001 }, { cat: 'sub', bit: 0x0002 }, { cat: 'ranged', bit: 0x0004 }, { cat: 'ammo', bit: 0x0008 },
  { cat: 'head', bit: 0x0010 }, { cat: 'body', bit: 0x0020 }, { cat: 'hands', bit: 0x0040 }, { cat: 'legs', bit: 0x0080 },
  { cat: 'feet', bit: 0x0100 }, { cat: 'neck', bit: 0x0200 }, { cat: 'waist', bit: 0x0400 }, { cat: 'ears', bit: 0x1800 },
  { cat: 'rings', bit: 0x6000 }, { cat: 'back', bit: 0x8000 },
];

export const ITEM_CATEGORIES: { id: ItemCategory; label: string }[] = [
  { id: 'main', label: 'Weapons' }, { id: 'sub', label: 'Grips/Shields' }, { id: 'ranged', label: 'Ranged' }, { id: 'ammo', label: 'Ammo' },
  { id: 'head', label: 'Head' }, { id: 'body', label: 'Body' }, { id: 'hands', label: 'Hands' }, { id: 'legs', label: 'Legs' },
  { id: 'feet', label: 'Feet' }, { id: 'neck', label: 'Neck' }, { id: 'waist', label: 'Waist' }, { id: 'ears', label: 'Ears' },
  { id: 'rings', label: 'Rings' }, { id: 'back', label: 'Back' }, { id: 'other', label: 'Other' },
];

export function itemCategory(id: number): ItemCategory {
  const sl = slotById.get(id);
  if (!sl) return 'other';
  for (const s of SLOT_BITS) if (sl & s.bit) return s.cat;
  return 'other';
}

const CAT_RANK = new Map<ItemCategory, number>(ITEM_CATEGORIES.map((c, i) => [c.id, i]));
export function itemCategoryRank(id: number): number {
  return CAT_RANK.get(itemCategory(id)) ?? 999;
}

export function itemNameMatches(id: number, shownName: string, lcQuery: string): boolean {
  if (shownName.toLowerCase().includes(lcQuery)) return true;
  const full = fullById.get(id);
  return full != null && full.includes(lcQuery);
}
void load();

export function useItemNames(): ItemName[] {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
  return list;
}

export function getItemNames(): ItemName[] { return list; }

export function resolveItemName(name: string): ItemName | null {
  const lc = name.trim().toLowerCase();
  if (!lc) return null;
  let partial: ItemName | null = null;
  for (const it of list) {
    const n = it.n.toLowerCase();
    if (n === lc) return it;
    if (!partial && n.includes(lc)) partial = it;
  }
  return partial;
}
