import type { KnownChar } from './bridge';

// Plan for merging a single character's own split stacks into target bags (no
// trading). Shared by the Duplicate view and Library's Local Consolidate.
export type PlanRow = { id: number; n: string; homeBag: string; homeBagId: number; from: { bag: string; count: number }[]; total: number };

const LOCAL_BASE_BAGS = [0, 5, 6, 7];
const LOCAL_MOG_BAGS = [1, 2, 4, 9];
export const LOCAL_TARGET_BAGS = [
  { id: 0, name: 'Inventory' }, { id: 5, name: 'Satchel' }, { id: 6, name: 'Sack' }, { id: 7, name: 'Case' },
  { id: 1, name: 'Safe' }, { id: 9, name: 'Safe 2' }, { id: 2, name: 'Storage' }, { id: 4, name: 'Locker' },
];
export const DEFAULT_LOCAL_TARGETS = LOCAL_TARGET_BAGS.map((b) => b.id);

export function localReachableBags(c: KnownChar): Set<number> {
  const s = new Set(LOCAL_BASE_BAGS);
  if (c.mog) for (const b of LOCAL_MOG_BAGS) s.add(b);
  return s;
}

export function localConsolidatePlan(c: KnownChar, targetBags?: Set<number>): PlanRow[] {
  const reach = localReachableBags(c);
  const bags = (c.inv ?? []).filter((b) => reach.has(b.id));
  const bagFree = new Map<number, number>();
  for (const b of bags) bagFree.set(b.id, Math.max(0, (b.max ?? 80) - (b.used ?? 0)));
  const allow = (bid: number) => !targetBags || targetBags.has(bid);
  const byId = new Map<number, { n: string; ms: number; bags: Map<number, { name: string; count: number }> }>();
  for (const b of bags) for (const it of b.items) {
    if (!it.id) continue;
    let g = byId.get(it.id);
    if (!g) { g = { n: it.n, ms: it.ms ?? 1, bags: new Map() }; byId.set(it.id, g); }
    const e = g.bags.get(b.id);
    if (e) e.count += it.c; else g.bags.set(b.id, { name: b.b, count: it.c });
  }
  const rows: PlanRow[] = [];
  for (const [id, g] of byId) {
    if ((g.ms ?? 1) <= 1 || g.bags.size < 2) continue;
    const stack = g.ms ?? 1;
    const entries = [...g.bags.entries()].sort((a, b) => b[1].count - a[1].count);
    let homeId: number | undefined; let homeName = ''; let homeCount = 0;
    const he = entries.find(([bid]) => (bagFree.get(bid) ?? 0) > 0 && allow(bid));
    if (he) { homeId = he[0]; homeName = he[1].name; homeCount = he[1].count; }
    else if (targetBags) {
      for (const b of bags) if (targetBags.has(b.id) && (bagFree.get(b.id) ?? 0) > 0) { homeId = b.id; homeName = b.b; homeCount = 0; break; }
    }
    if (homeId == null) continue;
    let freeLeft = bagFree.get(homeId) ?? 0;
    const from: { bag: string; count: number }[] = [];
    for (const [bid, info] of entries) {
      if (bid === homeId) continue;
      const need = Math.ceil(info.count / stack);
      if (freeLeft >= need) { from.push({ bag: info.name, count: info.count }); freeLeft -= need; }
    }
    if (from.length === 0) continue;
    rows.push({ id, n: g.n, homeBag: homeName, homeBagId: homeId, from, total: homeCount + from.reduce((s, f) => s + f.count, 0) });
  }
  rows.sort((a, b) => b.total - a.total || a.n.localeCompare(b.n));
  return rows;
}
