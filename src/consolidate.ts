import { useSyncExternalStore } from 'react';
import { moveItem, tradeTo, armTradeReceiver, getKnownCharacters, nomadReachable, withinTradeRange, NOMAD_BAGS, type KnownChar } from './bridge';
import { ALWAYS_BAGS, FLAG_NOTRADE } from './bagConstants';

const NOTRADE = FLAG_NOTRADE;
export const TRADABLE_BAGS = [0, 5, 6, 7, 1, 9, 2, 4];
const ALWAYS_REACHABLE = ALWAYS_BAGS;
export function bagPullable(char: KnownChar | undefined, bagId: number, experimental: boolean): boolean {
  if (ALWAYS_REACHABLE.has(bagId)) return true;
  if (NOMAD_BAGS.has(bagId)) return nomadReachable(char, experimental);
  return false;
}

export type ConsoStatus = 'pending' | 'moving' | 'trading' | 'ok' | 'fail';
export type ConsoCharState = { status: ConsoStatus; sent: number; goal: number; note?: string; items?: { id: number; want: number }[] };
export type ConsoRunState = {
  running: boolean;
  collector: string | null;
  order: string[];
  chars: Record<string, ConsoCharState>;
  error: string | null;
};

let state: ConsoRunState = { running: false, collector: null, order: [], chars: {}, error: null };
const listeners = new Set<() => void>();
function patch(p: Partial<ConsoRunState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }
function patchChar(name: string, p: Partial<ConsoCharState>) {
  patch({ chars: { ...state.chars, [name]: { ...(state.chars[name] ?? { status: 'pending', sent: 0, goal: 0 }), ...p } } });
}

export function useConsolidate(): ConsoRunState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}

let stopFlag = false;
// Signal any live loop to halt AND force the run state to not-running, so a stuck
// state (a run whose `running` never got cleared) can always be recovered.
export function stopConsolidate() { stopFlag = true; if (state.running) patch({ running: false }); }

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
async function pollUntil(pred: () => boolean, timeoutMs: number, interval = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (stopFlag || pred()) return pred(); await sleep(interval); }
  return pred();
}

function fresh(name: string): KnownChar | undefined {
  return getKnownCharacters().find((k) => k.name === name);
}
function bagCount(char: KnownChar | undefined, id: number, bag: number): number {
  let n = 0;
  for (const b of char?.inv ?? []) if (b.id === bag) for (const it of b.items) if (it.id === id) n += it.c;
  return n;
}
export function reachableTotal(char: KnownChar | undefined, id: number, experimental: boolean): number {
  let n = 0;
  for (const b of char?.inv ?? []) if (TRADABLE_BAGS.includes(b.id) && bagPullable(char, b.id, experimental)) for (const it of b.items) if (it.id === id) n += it.c;
  return n;
}
export function isNoTrade(char: KnownChar | undefined, id: number): boolean {
  for (const b of char?.inv ?? []) for (const it of b.items) if (it.id === id && it.f && (it.f & NOTRADE)) return true;
  return false;
}
const RARE = 0x01;
export function isRare(char: KnownChar | undefined, id: number): boolean {
  for (const b of char?.inv ?? []) for (const it of b.items) if (it.id === id && it.f && (it.f & RARE)) return true;
  return false;
}
export function consolidableTotal(char: KnownChar | undefined, id: number, experimental: boolean): number {
  return isNoTrade(char, id) ? 0 : reachableTotal(char, id, experimental);
}

// wants: item id -> count to consolidate (Infinity = all reachable), each capped to what's reachable/tradable so a partial selection never drags the whole stash.
async function consolidateOne(name: string, collectorName: string, wants: Record<number, number>, experimental: boolean): Promise<void> {
  const s = fresh(name);
  if (!s || s.conn == null) throw new Error('offline');
  const conn = s.conn;
  const targets = Object.entries(wants)
    .map(([idStr, q]) => {
      const id = Number(idStr);
      const s = fresh(name);
      let want = isNoTrade(s, id) ? 0 : Math.min(q, reachableTotal(s, id, experimental));
      // Rare items: the collector can hold only one, so never send more than it is
      // short by. If it already has the item, skip it (the trade would just fail).
      if (want > 0 && isRare(s, id)) want = Math.min(want, Math.max(0, 1 - charTotal(fresh(collectorName), id)));
      return { id, want };
    })
    .filter((t) => t.want > 0);
  if (targets.length === 0) return;

  // Interleave staging and trading: a trade window holds 8 stacks and inventory holds
  // a finite number of slots, so a large hoard (dozens of stacks) can't move in one
  // shot. Each round stages a batch from the reachable bags into inventory (the addon
  // caps the move to free slots), then trades what landed, until every target is sent.
  const sent: Record<number, number> = {};
  let guard = 0;
  while (!stopFlag) {
    const remain = targets
      .map((t) => ({ id: t.id, left: t.want - (sent[t.id] ?? 0) }))
      .filter((x) => x.left > 0);
    if (remain.length === 0) break;

    patchChar(name, { status: 'moving' });
    let movedToInv = false;
    for (const r of remain) {
      let need = r.left - bagCount(fresh(name), r.id, 0);
      if (need <= 0) continue;
      const cur = fresh(name);
      for (const b of cur?.inv ?? []) {
        if (need <= 0) break;
        if (b.id === 0 || !TRADABLE_BAGS.includes(b.id) || !bagPullable(cur, b.id, experimental)) continue;
        const inBag = bagCount(cur, r.id, b.id);
        if (inBag > 0) { const take = Math.min(need, inBag); moveItem(conn, r.id, b.id, 0, take); need -= take; movedToInv = true; }
      }
    }
    if (stopFlag) return;
    if (movedToInv) await pollUntil(() => remain.some((r) => bagCount(fresh(name), r.id, 0) > 0), 8000);

    const items = remain
      .map((r) => ({ id: r.id, count: Math.min(r.left, bagCount(fresh(name), r.id, 0)) }))
      .filter((x) => x.count > 0);
    if (items.length === 0) break; // nothing staged and nothing left to stage -> done

    patchChar(name, { status: 'trading' });
    const before: Record<number, number> = {};
    for (const it of items) before[it.id] = bagCount(fresh(name), it.id, 0);
    const collector = fresh(collectorName);
    if (collector?.conn != null) armTradeReceiver(collector.conn, name, fresh(name)?.id);
    await sleep(400);
    tradeTo(conn, collectorName, items, 0, collector?.id);
    const ok = await pollUntil(() => items.some((it) => bagCount(fresh(name), it.id, 0) < before[it.id]), 15000);
    let movedAny = 0;
    for (const it of items) { const moved = Math.max(0, before[it.id] - bagCount(fresh(name), it.id, 0)); sent[it.id] = (sent[it.id] ?? 0) + moved; movedAny += moved; }
    patchChar(name, { sent: Object.values(sent).reduce((a, b) => a + b, 0) });
    if (!ok) throw new Error('trade not confirmed (recipient nearby?)');
    if (movedAny === 0 && ++guard > 20) throw new Error('too many rounds');
    await sleep(600);
  }
}

// Capped amount of one item a sender will actually consolidate: the picked quantity,
// limited to what is reachable and tradable here (0 for No-Trade items).
function wantAmount(char: KnownChar | undefined, id: number, picked: number, experimental: boolean): number {
  return isNoTrade(char, id) ? 0 : Math.min(picked, reachableTotal(char, id, experimental));
}

// Collector-aware want: also caps Rare items so the collector never receives more
// than the single copy it can hold (a Rare it already has would fail to trade).
function wantFor(sender: KnownChar | undefined, collectorName: string, id: number, picked: number, experimental: boolean): number {
  let want = wantAmount(sender, id, picked, experimental);
  if (want > 0 && isRare(sender, id)) want = Math.min(want, Math.max(0, 1 - charTotal(fresh(collectorName), id)));
  return want;
}

export async function runConsolidateSelection(collectorName: string, bySender: Record<string, Record<number, number>>, experimental = false): Promise<void> {
  if (state.running) return;
  const collector = fresh(collectorName);
  if (!collector || !collector.online) return;
  if (collector.mog) { patch({ running: false, collector: collectorName, order: [], chars: {}, error: `${collectorName} is in a Mog House; player trades can't reach a private residence.` }); return; }
  stopFlag = false;

  const senders = Object.keys(bySender)
    .filter((n) => n !== collectorName)
    .map((n) => fresh(n))
    .filter((k): k is KnownChar => !!k && k.online && k.conn != null)
    .filter((k) => withinTradeRange(k, collector))
    .filter((k) => !k.mog)
    .filter((k) => Object.entries(bySender[k.name]).some(([id, q]) => wantFor(k, collectorName, Number(id), q, experimental) > 0));

  const chars: Record<string, ConsoCharState> = {};
  for (const s of senders) {
    const plan = Object.entries(bySender[s.name])
      .map(([id, q]) => ({ id: Number(id), want: wantFor(s, collectorName, Number(id), q, experimental) }))
      .filter((x) => x.want > 0);
    chars[s.name] = { status: 'pending', sent: 0, goal: plan.reduce((sum, x) => sum + x.want, 0), items: plan };
  }
  patch({ running: true, collector: collectorName, order: senders.map((s) => s.name), chars, error: senders.length ? null : 'No selected character is in the same zone as the collector with reachable items.' });

  try {
    for (const s0 of senders) {
      if (stopFlag) break;
      try {
        await consolidateOne(s0.name, collectorName, bySender[s0.name], experimental);
        patchChar(s0.name, { status: 'ok' });
      } catch (e) {
        patchChar(s0.name, { status: 'fail', note: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    patch({ running: false });
  }
}

export function bagConsolidatable(char: KnownChar | undefined, bagId: number, experimental: boolean): boolean {
  return TRADABLE_BAGS.includes(bagId) && bagPullable(char, bagId, experimental);
}

export function charTotal(char: KnownChar | undefined, id: number): number {
  let n = 0;
  for (const b of char?.inv ?? []) for (const it of b.items) if (it.id === id) n += it.c;
  return n;
}

export function stackSize(id: number): number {
  for (const k of getKnownCharacters()) for (const b of k.inv ?? []) for (const it of b.items) if (it.id === id && it.ms) return it.ms;
  return 1;
}

function zoneSenders(recipientName: string): KnownChar[] {
  const r = fresh(recipientName);
  if (!r) return [];
  return getKnownCharacters().filter((k) => k.online && k.conn != null && k.name !== recipientName && !k.mog && withinTradeRange(k, r));
}

export function incomingTotal(recipientName: string, id: number, experimental: boolean): number {
  return zoneSenders(recipientName).reduce((s, k) => s + consolidableTotal(k, id, experimental), 0);
}

export function incomingHolders(recipientName: string, id: number, experimental: boolean): number {
  return zoneSenders(recipientName).filter((k) => consolidableTotal(k, id, experimental) > 0).length;
}

export function stuckIncoming(recipientName: string, id: number, experimental: boolean): number {
  return zoneSenders(recipientName).reduce((s, k) => s + Math.max(0, charTotal(k, id) - consolidableTotal(k, id, experimental)), 0);
}

export type SpaceCheck = { slotsFree: number; ms: number; incoming: number; capacityUnits: number; fits: boolean; maxFit: number; slotsNeeded: number };

export function recipientSpace(recipientName: string, id: number, experimental: boolean): SpaceCheck {
  const r = fresh(recipientName);
  const inv0 = r?.inv?.find((b) => b.id === 0);
  const slotsFree = inv0 ? Math.max(0, inv0.max - inv0.used) : 0;
  const ms = stackSize(id);
  let partial = 0;
  for (const it of inv0?.items ?? []) if (it.id === id) partial += Math.max(0, ms - it.c);
  const incoming = incomingTotal(recipientName, id, experimental);
  const capacityUnits = partial + slotsFree * ms;
  const maxFit = Math.min(incoming, capacityUnits);
  const slotsNeeded = Math.ceil(Math.max(0, incoming - partial) / ms);
  return { slotsFree, ms, incoming, capacityUnits, fits: incoming <= capacityUnits, maxFit, slotsNeeded };
}

export function buildCappedBySender(recipientName: string, id: number, cap: number, experimental: boolean): Record<string, Record<number, number>> {
  const bySender: Record<string, Record<number, number>> = {};
  let remaining = cap;
  const senders = zoneSenders(recipientName)
    .map((k) => ({ name: k.name, avail: consolidableTotal(k, id, experimental) }))
    .filter((x) => x.avail > 0)
    .sort((a, b) => b.avail - a.avail);
  for (const s of senders) {
    if (remaining <= 0) break;
    const take = Math.min(s.avail, remaining);
    bySender[s.name] = { [id]: take };
    remaining -= take;
  }
  return bySender;
}

export type MultiItemFit = { id: number; incoming: number; fit: number; leftover: number };
export type MultiSpace = { slotsFree: number; perItem: MultiItemFit[]; totalIncoming: number; totalFit: number; totalLeftover: number; fits: boolean };

// Capacity check when one recipient is the target for several item types at once:
// the free slots are a SHARED pool, so items are allocated in `ids` order (the
// preference-list order = fill priority when space is tight). Partial stacks the
// recipient already holds are filled first (no slot cost), then whole free slots.
export function recipientSpaceMulti(recipientName: string, ids: number[], experimental: boolean): MultiSpace {
  const r = fresh(recipientName);
  const inv0 = r?.inv?.find((b) => b.id === 0);
  let slotsFree = inv0 ? Math.max(0, inv0.max - inv0.used) : 0;
  const perItem: MultiItemFit[] = [];
  let totalIncoming = 0;
  let totalFit = 0;
  for (const id of ids) {
    const ms = stackSize(id);
    let partial = 0;
    for (const it of inv0?.items ?? []) if (it.id === id) partial += Math.max(0, ms - it.c);
    const incoming = incomingTotal(recipientName, id, experimental);
    const slotsWanted = Math.ceil(Math.max(0, incoming - partial) / ms);
    const slotsUsed = Math.min(slotsWanted, slotsFree);
    const fit = Math.min(incoming, partial + slotsUsed * ms);
    slotsFree -= slotsUsed;
    totalIncoming += incoming;
    totalFit += fit;
    perItem.push({ id, incoming, fit, leftover: incoming - fit });
  }
  return { slotsFree, perItem, totalIncoming, totalFit, totalLeftover: totalIncoming - totalFit, fits: totalFit >= totalIncoming };
}

// Distribute a per-item cap across the in-range senders (largest holders first), so
// the run pulls no more than `caps[id]` of each item toward the recipient.
export function buildCappedBySenderMulti(recipientName: string, caps: Record<number, number>, experimental: boolean): Record<string, Record<number, number>> {
  const bySender: Record<string, Record<number, number>> = {};
  for (const [idStr, cap] of Object.entries(caps)) {
    const id = Number(idStr);
    let remaining = cap;
    if (remaining <= 0) continue;
    const senders = zoneSenders(recipientName)
      .map((k) => ({ name: k.name, avail: consolidableTotal(k, id, experimental) }))
      .filter((x) => x.avail > 0)
      .sort((a, b) => b.avail - a.avail);
    for (const s of senders) {
      if (remaining <= 0) break;
      const take = Math.min(s.avail, remaining);
      (bySender[s.name] ??= {})[id] = take;
      remaining -= take;
    }
  }
  return bySender;
}

export function clearConsolidate() {
  if (state.running) return;
  state = { running: false, collector: null, order: [], chars: {}, error: null };
  listeners.forEach((l) => l());
}

export async function runConsolidate(collectorName: string, itemIds: number[], experimental = false): Promise<void> {
  if (state.running) return;
  const collector = fresh(collectorName);
  if (!collector || !collector.online || collector.mog || itemIds.length === 0) return;
  stopFlag = false;

  // Only characters that can actually trade the collector: online, not in a Mog
  // House, and within trading distance. Mirrors incomingTotal so the run matches
  // the plan and never stalls on a trade that can't land.
  const senders = getKnownCharacters().filter((k) =>
    k.online && k.conn != null && k.name !== collectorName && !k.mog && withinTradeRange(k, collector)
    && itemIds.some((id) => !isNoTrade(k, id) && reachableTotal(k, id, experimental) > 0));
  // Gather every reachable one of each item (the dedicated Consolidate panel / CLI).
  const wantsAll: Record<number, number> = {};
  for (const id of itemIds) wantsAll[id] = Infinity;

  const chars: Record<string, ConsoCharState> = {};
  for (const s of senders) {
    const goal = itemIds.reduce((sum, id) => sum + (isNoTrade(s, id) ? 0 : reachableTotal(s, id, experimental)), 0);
    chars[s.name] = { status: 'pending', sent: 0, goal };
  }
  patch({ running: true, collector: collectorName, order: senders.map((s) => s.name), chars, error: senders.length ? null : 'No other character in trading range holds the selected items.' });

  try {
    for (const s0 of senders) {
      if (stopFlag) break;
      try {
        await consolidateOne(s0.name, collectorName, wantsAll, experimental);
        patchChar(s0.name, { status: 'ok' });
      } catch (e) {
        patchChar(s0.name, { status: 'fail', note: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    patch({ running: false });
  }
}
