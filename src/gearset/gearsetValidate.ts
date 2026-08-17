import type { KnownChar } from '../bridge';
import type { ItemName } from '../itemNames';
import type { GearEntry } from './gearsetParser';

const EQUIPPABLE_BAGS = new Set([0, 8, 10, 11, 12, 13, 14, 15, 16]);
const BAG_NAMES: Record<number, string> = {
  0: 'Inventory', 1: 'Safe', 2: 'Storage', 3: 'Temporary', 4: 'Locker', 5: 'Satchel', 6: 'Sack', 7: 'Case',
  8: 'Wardrobe', 9: 'Safe 2', 10: 'Wardrobe 2', 11: 'Wardrobe 3', 12: 'Wardrobe 4', 13: 'Wardrobe 5',
  14: 'Wardrobe 6', 15: 'Wardrobe 7', 16: 'Wardrobe 8', 17: 'Recycle Bin',
};

export type SlotValidation =
  | { state: 'dynamic'; raw: string }
  | { state: 'unknown'; name: string }
  | { state: 'ok'; id: number; name: string; bag: number }
  | { state: 'aug-mismatch'; id: number; name: string; owned: string[] }
  | { state: 'wrong-bag'; id: number; name: string; bag: string }
  | { state: 'missing'; id: number; name: string };

export type NameResolver = (name: string) => { id: number; sl?: number } | null;

export function makeNameResolver(items: ItemName[]): NameResolver {
  const m = new Map<string, { id: number; sl?: number }>();
  for (const it of items) {
    const v = { id: it.id, sl: it.sl };
    const n = it.n.toLowerCase();
    if (!m.has(n)) m.set(n, v);
    if (it.l) { const l = it.l.toLowerCase(); if (!m.has(l)) m.set(l, v); }
  }
  return (name) => m.get(name.trim().toLowerCase()) ?? null;
}

export type OwnedCopy = { bag: number; aug: string[] };
export function ownedById(char: Pick<KnownChar, 'inv'>): Map<number, OwnedCopy[]> {
  const m = new Map<number, OwnedCopy[]>();
  for (const b of char.inv ?? []) for (const it of b.items) {
    if (!it.id) continue;
    const arr = m.get(it.id);
    if (arr) arr.push({ bag: b.id, aug: it.aug ?? [] });
    else m.set(it.id, [{ bag: b.id, aug: it.aug ?? [] }]);
  }
  return m;
}

const stripAug = (s: string) => s.toLowerCase().replace(/[^a-z0-9,\-]/g, '');
function augSubset(want: string[], have: string[]): boolean {
  const cur = have.map(stripAug).filter(Boolean);
  for (const w of want.map(stripAug).filter(Boolean)) {
    const idx = cur.indexOf(w);
    if (idx < 0) return false;
    cur.splice(idx, 1);
  }
  return true;
}

export function validateGear(entry: GearEntry, resolve: NameResolver, owned: Map<number, OwnedCopy[]>): SlotValidation {
  if (entry.kind === 'dynamic') return { state: 'dynamic', raw: entry.raw };
  const r = resolve(entry.name);
  if (!r) return { state: 'unknown', name: entry.name };
  const copies = owned.get(r.id) ?? [];
  if (copies.length === 0) return { state: 'missing', id: r.id, name: entry.name };
  const want = entry.augments ?? [];
  const equippable = copies.filter((c) => EQUIPPABLE_BAGS.has(c.bag));
  const okCopy = equippable.find((c) => want.length === 0 || augSubset(want, c.aug));
  if (okCopy) return { state: 'ok', id: r.id, name: entry.name, bag: okCopy.bag };
  if (equippable.length > 0) return { state: 'aug-mismatch', id: r.id, name: entry.name, owned: equippable[0].aug };
  const copy = copies.find((c) => want.length === 0 || augSubset(want, c.aug)) ?? copies[0];
  return { state: 'wrong-bag', id: r.id, name: entry.name, bag: BAG_NAMES[copy.bag] ?? `Bag ${copy.bag}` };
}

export function bagLabel(id: number): string { return BAG_NAMES[id] ?? `Bag ${id}`; }
