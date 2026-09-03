import { moveItem, slipRetrieve, nomadReachable, NOMAD_BAGS, type KnownChar } from './bridge';
import { ALWAYS_BAGS } from './bagConstants';
import { jobEquips, itemCategory } from './itemNames';
import { type PullRule } from './pullRules';
import { type ReportMove } from './OperationReport';

// Source bags a pull can draw from (never inventory itself).
export const SRC_BAGS: { id: number; label: string }[] = [
  { id: 5, label: 'Satchel' }, { id: 6, label: 'Sack' }, { id: 7, label: 'Case' },
  { id: 1, label: 'Safe' }, { id: 9, label: 'Safe 2' }, { id: 2, label: 'Storage' }, { id: 4, label: 'Locker' },
  { id: 8, label: 'Wardrobe 1' }, { id: 10, label: 'Wardrobe 2' }, { id: 11, label: 'Wardrobe 3' }, { id: 12, label: 'Wardrobe 4' },
  { id: 13, label: 'Wardrobe 5' }, { id: 14, label: 'Wardrobe 6' }, { id: 15, label: 'Wardrobe 7' }, { id: 16, label: 'Wardrobe 8' },
];
export const bagLabel = (id: number) => SRC_BAGS.find((b) => b.id === id)?.label ?? `Bag ${id}`;

// Destinations: inventory + carried bags take anything; wardrobes take equipment only.
export const DEST_BAGS: { id: number; label: string }[] = [
  { id: 0, label: 'Inventory' }, { id: 5, label: 'Satchel' }, { id: 6, label: 'Sack' }, { id: 7, label: 'Case' },
  { id: 8, label: 'Wardrobe 1' }, { id: 10, label: 'Wardrobe 2' }, { id: 11, label: 'Wardrobe 3' }, { id: 12, label: 'Wardrobe 4' },
  { id: 13, label: 'Wardrobe 5' }, { id: 14, label: 'Wardrobe 6' }, { id: 15, label: 'Wardrobe 7' }, { id: 16, label: 'Wardrobe 8' },
];
export const CARRY_DEST = new Set([0, 5, 6, 7]); // accept any item; wardrobes are equip-only
export const destLabel = (id: number) => DEST_BAGS.find((b) => b.id === id)?.label ?? bagLabel(id);
export const isEquip = (id: number) => itemCategory(id) !== 'other';

export type Match = { id: number; from: number; count: number; n: string };
export type PullCtx = { assign: Record<number, string[]>; exp: boolean };

// A source bag we can pull from RIGHT NOW: carried bags + wardrobes anywhere; Safe/Storage/Locker/Safe 2 only
// in a Mog House, or (Safe/Locker/Safe 2 only) at a Nomad Moogle when Experimental is on.
export const reachableBag = (char: KnownChar, exp: boolean, bag: number) =>
  ALWAYS_BAGS.has(bag) || !!char.mog || (NOMAD_BAGS.has(bag) && nomadReachable(char, exp));
export const freeOf = (char: KnownChar, bag: number) => { const b = (char.inv ?? []).find((x) => x.id === bag); return b ? Math.max(0, (b.max ?? 80) - (b.used ?? 0)) : 0; };
export const destsOf = (r: PullRule) => (r.dest && r.dest.length ? r.dest : [0]);
export const destCapacity = (char: KnownChar, r: PullRule) => destsOf(r).reduce((s, d) => s + freeOf(char, d), 0);

export function makeWants(r: PullRule, assign: Record<number, string[]>, main?: string) {
  return (id: number) => {
    if (r.tags.length) { const tg = assign[id]; if (!tg || !r.tags.some((t) => tg.includes(t))) return false; } // no tags = match everything
    if (r.jobOnly && !(main && jobEquips(id, main))) return false;
    return true;
  };
}

export type PullPlan = {
  bagOK: Match[];
  blockedBags: Map<number, number>;
  slipReady: number[];
  needGet: { sid: number; name: string; loc: number; locname: string; count: number; ids: number[] }[];
  slipStuck: number;
};

// Prereq-aware plan for a rule: what's pullable now, and what's blocked.
export function planPull(char: KnownChar, r: PullRule, ctx: PullCtx): PullPlan {
  const want = makeWants(r, ctx.assign, char.main);
  const bagOK: Match[] = [];
  const blockedBags = new Map<number, number>();
  for (const bg of char.inv ?? []) {
    if (!r.bags.includes(bg.id)) continue;
    for (const it of bg.items) if (!it.lk && want(it.id)) { // skip equipped/bazaar (locked) items
      if (reachableBag(char, ctx.exp, bg.id)) bagOK.push({ id: it.id, from: bg.id, count: it.c, n: it.n });
      else blockedBags.set(bg.id, (blockedBags.get(bg.id) ?? 0) + 1);
    }
  }
  const slipReady = new Set<number>();
  const needGet: PullPlan['needGet'] = [];
  let slipStuck = 0;
  if (r.slips) for (const sp of char.slips ?? []) {
    if (sp.owned === false) continue;
    if (r.slipSids && r.slipSids.length && !r.slipSids.includes(sp.sid)) continue;
    const ids: number[] = []; for (const it of sp.stored) if (want(it.id)) ids.push(it.id);
    if (ids.length === 0) continue;
    if (sp.ready) { for (const id of ids) slipReady.add(id); }
    else if (sp.getable) needGet.push({ sid: sp.sid, name: sp.name, loc: sp.loc, locname: sp.locname, count: ids.length, ids });
    else slipStuck += ids.length;
  }
  return { bagOK, blockedBags, slipReady: [...slipReady], needGet, slipStuck };
}

export type PullFire = { moves: ReportMove[]; movedBag: number; movedItems: number; slipTake: number; blocked: string[]; tracked: number[] };

// Fire a pull for a rule: move matching bag gear into the destinations and retrieve matching slip gear. The
// addon consolidates every needed slip and cycles through them in one pass, so slip gear is ONE slipRetrieve.
export function firePull(char: KnownChar, conn: number, r: PullRule, ctx: PullCtx): PullFire {
  const p = planPull(char, r, ctx);
  const want = makeWants(r, ctx.assign, char.main);
  const dests = destsOf(r);
  const tracked = [...new Set([...dests, 0])];
  const moves: ReportMove[] = [];
  const blocked: string[] = [];
  const free = new Map<number, number>();
  for (const d of dests) free.set(d, freeOf(char, d));
  if (!free.has(0)) free.set(0, freeOf(char, 0));

  // Aggregate every stack/copy of the same item in the same bag into ONE move (the addon resolves all slots
  // from a single snapshot; one move per slot collides on the same first slot).
  const groups = new Map<string, { id: number; from: number; count: number; slots: number; n: string }>();
  for (const x of p.bagOK) {
    const k = `${x.from}:${x.id}`;
    const g = groups.get(k);
    if (g) { g.count += x.count; g.slots += 1; } else groups.set(k, { id: x.id, from: x.from, count: x.count, slots: 1, n: x.n });
  }

  let movedBag = 0, movedItems = 0, noRoom = 0, notEq = 0;
  for (const x of groups.values()) {
    const eq = isEquip(x.id);
    const cands = dests.filter((d) => d !== x.from && (CARRY_DEST.has(d) || eq));
    if (cands.length === 0) { notEq += x.slots; continue; }
    const d = cands.find((dd) => (free.get(dd) ?? 0) >= x.slots) ?? cands.find((dd) => (free.get(dd) ?? 0) > 0);
    if (d == null) { noRoom += x.slots; continue; }
    const room = free.get(d) ?? 0, fit = Math.min(x.slots, room);
    moveItem(conn, x.id, x.from, d, x.count); free.set(d, room - fit); movedBag += fit; movedItems += x.count;
    if (fit < x.slots) noRoom += x.slots - fit;
    moves.push({ id: x.id, n: x.n, c: x.count, from: bagLabel(x.from), to: destLabel(d), fromId: x.from, toId: d });
  }
  if (noRoom) blocked.push(`${noRoom} left, destinations full`);
  if (notEq) blocked.push(`${notEq} not equippable (add Inventory/Satchel/Sack/Case as a destination)`);

  // Slip gear -> inventory, one call across every slip.
  let slipTake = 0;
  if (r.slips) {
    const info = new Map<number, string>();
    for (const sp of char.slips ?? []) { if (sp.owned === false) continue; if (r.slipSids?.length && !r.slipSids.includes(sp.sid)) continue; for (const it of sp.stored) if (want(it.id)) info.set(it.id, it.n); }
    const gear = [...p.slipReady];
    if (r.autoGetSlips) for (const ng of p.needGet) gear.push(...ng.ids);
    const slipIds = [...new Set(gear)];
    if (slipIds.length) {
      if (!char.porterNear) blocked.push(`${slipIds.length} on Storage Slips need the Porter Moogle in range`);
      else {
        slipRetrieve(conn, slipIds); slipTake = slipIds.length;
        for (const id of slipIds) moves.push({ id, n: info.get(id) ?? `Item ${id}`, c: 1, from: 'Storage Slips', to: 'Inventory', fromId: -1, toId: 0 });
      }
    }
    if (!r.autoGetSlips && p.needGet.length) { const tot = p.needGet.reduce((a, b) => a + b.count, 0); blocked.push(`${tot} on slip(s) not in your bags (turn on Auto-fetch, or get the slip first)`); }
  }
  if (p.slipStuck) blocked.push(`${p.slipStuck} on slip(s) that can't be fetched`);
  if (p.blockedBags.size) { const tot = [...p.blockedBags.values()].reduce((a, b) => a + b, 0); blocked.push(`${tot} in ${[...p.blockedBags.keys()].map(bagLabel).join(', ')} need a Mog House or Nomad Moogle`); }

  return { moves, movedBag, movedItems, slipTake, blocked, tracked };
}
