import { moveItem, slipRetrieve, nomadReachable, NOMAD_BAGS, type KnownChar } from './bridge';
import { ALWAYS_BAGS } from './bagConstants';
import { jobEquips, itemCategory, itemJobs } from './itemNames';
import { type PullRule } from './pullRules';
import { type ReportMove } from './OperationReport';
import { pieceKey } from './augSig';

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

// `slot` is the physical inventory slot; `exact` is true when this copy matched ONLY via an exact-piece
// (augment) tag, not a name-level id tag -- so the move must target this exact slot, not "first copy of
// the id" (otherwise the pull could grab the wrong augmented copy).
export type Match = { id: number; from: number; count: number; n: string; slot: number; exact: boolean };
// `gearIds` (when a rule uses gearsetOnly) is the set of item ids the character's current-job GearSwap
// sets reference, resolved by the UI before planning. null = not available yet (gearsetOnly then pulls
// nothing, rather than falling back to everything).
export type PullCtx = { assign: Record<number, string[]>; assignAug?: Record<string, string[]>; gearIds?: Set<number> | null; exp: boolean };

// One physical copy's name-level and exact-piece tags, split so the matcher can tell a whole-id match
// (every copy, id-move safe) from a this-copy-only match (slot-precise move required).
type Tagged = { id: number; aug?: string[] };
function splitTags(it: Tagged, ctx: PullCtx): { name: string[]; piece: string[] } {
  const name = ctx.assign[it.id] ?? [];
  const key = pieceKey(it.id, it.aug);
  const piece = key.includes('#') ? (ctx.assignAug?.[key] ?? []) : [];
  return { name, piece };
}

// A source bag we can pull from RIGHT NOW: carried bags + wardrobes anywhere; Safe/Storage/Locker/Safe 2 only
// in a Mog House, or (Safe/Locker/Safe 2 only) at a Nomad Moogle when Experimental is on.
export const reachableBag = (char: KnownChar, exp: boolean, bag: number) =>
  ALWAYS_BAGS.has(bag) || !!char.mog || (NOMAD_BAGS.has(bag) && nomadReachable(char, exp));
export const freeOf = (char: KnownChar, bag: number) => { const b = (char.inv ?? []).find((x) => x.id === bag); return b ? Math.max(0, (b.max ?? 80) - (b.used ?? 0)) : 0; };
export const destsOf = (r: PullRule) => (r.dest && r.dest.length ? r.dest : [0]);
export const destCapacity = (char: KnownChar, r: PullRule) => destsOf(r).reduce((s, d) => s + freeOf(char, d), 0);

// Matcher for a rule against a physical copy. A copy is wanted if the rule has no tags (match all), or
// the rule's tags intersect the copy's EFFECTIVE tags (name-level id tags UNION this copy's exact-piece
// tags). Exact-piece tags let "Snapshot" land on only the 5 augmented copies and not every same-name
// piece. Pass `{ id }` for slip gear (no augment data) -- it just resolves to the name-level dimension.
export function makeWants(r: PullRule, ctx: PullCtx, main?: string) {
  return (it: Tagged) => {
    if (r.tags.length) {
      const { name, piece } = splitTags(it, ctx);
      if (!r.tags.some((t) => name.includes(t) || piece.includes(t))) return false;
    }
    if (r.jobOnly && !(main && jobEquips(it.id, main))) return false;
    if (r.jobSpecific) {
      // Job-restricted gear only: must be equippable gear, the active job can equip it, and it is NOT an
      // all-job piece (that's where "costume"/generic appearance gear lives, which this excludes).
      const ij = itemJobs(it.id);
      if (!ij || ij.all) return false;
      if (main && !ij.jobs.includes(main.toUpperCase())) return false;
    }
    if (r.gearsetOnly) {
      // Only items the current job's GearSwap sets reference. No resolved set (null) = pull nothing.
      if (!ctx.gearIds || !ctx.gearIds.has(it.id)) return false;
    }
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
  const want = makeWants(r, ctx, char.main);
  const bagOK: Match[] = [];
  const blockedBags = new Map<number, number>();
  for (const bg of char.inv ?? []) {
    if (!r.bags.includes(bg.id)) continue;
    for (const it of bg.items) if (!it.lk && want(it)) { // skip equipped/bazaar (locked) items
      // exact = matched only through an exact-piece tag (no name-level tag of the rule is on this id),
      // so other copies of this id are NOT wanted and the move must be slot-precise.
      const { name } = splitTags(it, ctx);
      const exact = r.tags.length > 0 && !r.tags.some((t) => name.includes(t));
      if (reachableBag(char, ctx.exp, bg.id)) bagOK.push({ id: it.id, from: bg.id, count: it.c, n: it.n, slot: it.s, exact });
      else blockedBags.set(bg.id, (blockedBags.get(bg.id) ?? 0) + 1);
    }
  }
  const slipReady = new Set<number>();
  const needGet: PullPlan['needGet'] = [];
  let slipStuck = 0;
  if (r.slips) for (const sp of char.slips ?? []) {
    if (sp.owned === false) continue;
    if (r.slipSids && r.slipSids.length && !r.slipSids.includes(sp.sid)) continue;
    const ids: number[] = []; for (const it of sp.stored) if (want({ id: it.id })) ids.push(it.id);
    if (ids.length === 0) continue;
    if (sp.ready) { for (const id of ids) slipReady.add(id); }
    else if (sp.getable) needGet.push({ sid: sp.sid, name: sp.name, loc: sp.loc, locname: sp.locname, count: ids.length, ids });
    else slipStuck += ids.length;
  }
  return { bagOK, blockedBags, slipReady: [...slipReady], needGet, slipStuck };
}

export type PullFire = { moves: ReportMove[]; movedBag: number; movedItems: number; slipTake: number; blocked: string[]; tracked: number[] };

// A single planned move: a stack of one item going FROM one bag TO one destination (capacity + fallback
// already resolved). `slot: -1` + `fromLabel: 'Storage Slips'` marks slip gear retrieved to Inventory.
export type PlannedMove = { id: number; n: string; count: number; slots: number; fit: number; from: number; fromLabel: string; to: number; toLabel: string; slot?: number };
export type PullPlanMoves = { moves: PlannedMove[]; movedBag: number; movedItems: number; slipTake: number; blocked: string[]; tracked: number[] };

// PURE plan of exactly what a pull would move, with the SAME routing firePull uses (destination picked by
// capacity + fallback, equippable-only bags), but WITHOUT touching the game. Both firePull and the preview
// build on this so they can never disagree about where a piece lands.
export function planMoves(char: KnownChar, r: PullRule, ctx: PullCtx): PullPlanMoves {
  const p = planPull(char, r, ctx);
  const want = makeWants(r, ctx, char.main);
  const dests = destsOf(r);
  const tracked = [...new Set([...dests, 0])];
  const moves: PlannedMove[] = [];
  const blocked: string[] = [];
  const free = new Map<number, number>();
  for (const d of dests) free.set(d, freeOf(char, d));
  if (!free.has(0)) free.set(0, freeOf(char, 0));

  // Two kinds of move unit:
  //  - name-level: aggregate every copy of the same id in the same bag into ONE id-move (the addon resolves
  //    all slots from a single snapshot; one move per slot would collide on the first slot). Any copy is fine.
  //  - exact-piece (matched via an augment tag): must stay one move PER physical slot and carry that slot, so
  //    the addon moves the RIGHT augmented copy via its exact-slot path instead of "first copy of the id".
  type Unit = { id: number; from: number; count: number; slots: number; n: string; slot?: number };
  const groups = new Map<string, Unit>();
  const exactUnits: Unit[] = [];
  for (const x of p.bagOK) {
    if (x.exact) { exactUnits.push({ id: x.id, from: x.from, count: x.count, slots: 1, n: x.n, slot: x.slot }); continue; }
    const k = `${x.from}:${x.id}`;
    const g = groups.get(k);
    if (g) { g.count += x.count; g.slots += 1; } else groups.set(k, { id: x.id, from: x.from, count: x.count, slots: 1, n: x.n });
  }
  const units = [...groups.values(), ...exactUnits];

  let movedBag = 0, movedItems = 0, noRoom = 0, notEq = 0;
  for (const x of units) {
    const eq = isEquip(x.id);
    const cands = dests.filter((d) => d !== x.from && (CARRY_DEST.has(d) || eq));
    if (cands.length === 0) { notEq += x.slots; continue; }
    const d = cands.find((dd) => (free.get(dd) ?? 0) >= x.slots) ?? cands.find((dd) => (free.get(dd) ?? 0) > 0);
    if (d == null) { noRoom += x.slots; continue; }
    const room = free.get(d) ?? 0, fit = Math.min(x.slots, room);
    free.set(d, room - fit); movedBag += fit; movedItems += x.count;
    if (fit < x.slots) noRoom += x.slots - fit;
    moves.push({ id: x.id, n: x.n, count: x.count, slots: x.slots, fit, from: x.from, fromLabel: bagLabel(x.from), to: d, toLabel: destLabel(d), ...(x.slot != null ? { slot: x.slot } : {}) });
  }
  if (noRoom) blocked.push(`${noRoom} left, destinations full`);
  if (notEq) blocked.push(`${notEq} not equippable (add Inventory/Satchel/Sack/Case as a destination)`);

  // Slip gear -> Inventory, in one retrieve pass.
  let slipTake = 0;
  if (r.slips) {
    const info = new Map<number, string>();
    for (const sp of char.slips ?? []) { if (sp.owned === false) continue; if (r.slipSids?.length && !r.slipSids.includes(sp.sid)) continue; for (const it of sp.stored) if (want({ id: it.id })) info.set(it.id, it.n); }
    const gear = [...p.slipReady];
    if (r.autoGetSlips) for (const ng of p.needGet) gear.push(...ng.ids);
    const slipIds = [...new Set(gear)];
    if (slipIds.length) {
      if (!char.porterNear) blocked.push(`${slipIds.length} on Storage Slips need the Porter Moogle in range`);
      else { slipTake = slipIds.length; for (const id of slipIds) moves.push({ id, n: info.get(id) ?? `Item ${id}`, count: 1, slots: 1, fit: 1, from: -1, fromLabel: 'Storage Slips', to: 0, toLabel: 'Inventory' }); }
    }
    if (!r.autoGetSlips && p.needGet.length) { const tot = p.needGet.reduce((a, b) => a + b.count, 0); blocked.push(`${tot} on slip(s) not in your bags (turn on Auto-fetch, or get the slip first)`); }
  }
  if (p.slipStuck) blocked.push(`${p.slipStuck} on slip(s) that can't be fetched`);
  if (p.blockedBags.size) { const tot = [...p.blockedBags.values()].reduce((a, b) => a + b, 0); blocked.push(`${tot} in ${[...p.blockedBags.keys()].map(bagLabel).join(', ')} need a Mog House or Nomad Moogle`); }

  return { moves, movedBag, movedItems, slipTake, blocked, tracked };
}

// Fire a pull for a rule: execute the planned moves (bag gear by moveItem, slip gear by one slipRetrieve).
export function firePull(char: KnownChar, conn: number, r: PullRule, ctx: PullCtx): PullFire {
  const plan = planMoves(char, r, ctx);
  const moves: ReportMove[] = [];
  const slipIds: number[] = [];
  for (const m of plan.moves) {
    if (m.from === -1) { slipIds.push(m.id); }
    else moveItem(conn, m.id, m.from, m.to, m.count, m.slot); // m.slot set only for exact-piece (augment) moves
    moves.push({ id: m.id, n: m.n, c: m.count, from: m.fromLabel, to: m.toLabel, fromId: m.from, toId: m.to });
  }
  if (slipIds.length) slipRetrieve(conn, slipIds);

  return { moves, movedBag: plan.movedBag, movedItems: plan.movedItems, slipTake: plan.slipTake, blocked: plan.blocked, tracked: plan.tracked };
}
