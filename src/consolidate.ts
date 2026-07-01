import { useSyncExternalStore } from 'react';
import { moveItem, tradeTo, armTradeReceiver, getKnownCharacters, nomadReachable, NOMAD_BAGS, type KnownChar } from './bridge';
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
export type ConsoCharState = { status: ConsoStatus; sent: number; goal: number; note?: string };
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
export function stopConsolidate() { stopFlag = true; }

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
export function consolidableTotal(char: KnownChar | undefined, id: number, experimental: boolean): number {
  return isNoTrade(char, id) ? 0 : reachableTotal(char, id, experimental);
}

// wants: item id -> count to consolidate (Infinity = all reachable), each capped to what's reachable/tradable so a partial selection never drags the whole stash.
async function consolidateOne(name: string, collectorName: string, wants: Record<number, number>, experimental: boolean): Promise<void> {
  const s = fresh(name);
  if (!s || s.conn == null) throw new Error('offline');
  const conn = s.conn;
  const targets = Object.entries(wants)
    .map(([idStr, q]) => ({ id: Number(idStr), want: isNoTrade(fresh(name), Number(idStr)) ? 0 : Math.min(q, reachableTotal(fresh(name), Number(idStr), experimental)) }))
    .filter((t) => t.want > 0);
  if (targets.length === 0) return;

  patchChar(name, { status: 'moving' });
  for (const t of targets) {
    if (stopFlag) return;
    let need = t.want - bagCount(fresh(name), t.id, 0);
    if (need <= 0) continue;
    const cur = fresh(name);
    for (const b of cur?.inv ?? []) {
      if (need <= 0) break;
      if (b.id === 0 || !TRADABLE_BAGS.includes(b.id) || !bagPullable(cur, b.id, experimental)) continue;
      const inBag = bagCount(cur, t.id, b.id);
      if (inBag > 0) { const take = Math.min(need, inBag); moveItem(conn, t.id, b.id, 0, take); need -= take; }
    }
    await pollUntil(() => bagCount(fresh(name), t.id, 0) >= t.want, 8000);
  }
  if (stopFlag) return;

  patchChar(name, { status: 'trading' });
  const sent: Record<number, number> = {};
  let guard = 0;
  while (!stopFlag) {
    const items = targets
      .map((t) => ({ id: t.id, count: Math.min(t.want - (sent[t.id] ?? 0), bagCount(fresh(name), t.id, 0)) }))
      .filter((x) => x.count > 0);
    if (items.length === 0) break;
    const before: Record<number, number> = {};
    for (const it of items) before[it.id] = bagCount(fresh(name), it.id, 0);
    const collector = fresh(collectorName);
    if (collector?.conn != null) armTradeReceiver(collector.conn, name, fresh(name)?.id);
    tradeTo(conn, collectorName, items);
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
    .filter((k) => k.zone === collector.zone)
    .filter((k) => !k.mog)
    .filter((k) => Object.entries(bySender[k.name]).some(([id, q]) => wantAmount(k, Number(id), q, experimental) > 0));

  const chars: Record<string, ConsoCharState> = {};
  for (const s of senders) {
    const goal = Object.entries(bySender[s.name]).reduce((sum, [id, q]) => sum + wantAmount(s, Number(id), q, experimental), 0);
    chars[s.name] = { status: 'pending', sent: 0, goal };
  }
  patch({ running: true, collector: collectorName, order: senders.map((s) => s.name), chars, error: senders.length ? null : 'No selected character is parked with the collector with reachable items.' });

  for (const s0 of senders) {
    if (stopFlag) break;
    try {
      await consolidateOne(s0.name, collectorName, bySender[s0.name], experimental);
      patchChar(s0.name, { status: 'ok' });
    } catch (e) {
      patchChar(s0.name, { status: 'fail', note: e instanceof Error ? e.message : String(e) });
    }
  }
  patch({ running: false });
}

export function clearConsolidate() {
  if (state.running) return;
  state = { running: false, collector: null, order: [], chars: {}, error: null };
  listeners.forEach((l) => l());
}

export async function runConsolidate(collectorName: string, itemIds: number[], experimental = false): Promise<void> {
  if (state.running) return;
  const collector = fresh(collectorName);
  if (!collector || !collector.online || itemIds.length === 0) return;
  stopFlag = false;

  const online = getKnownCharacters().filter((k) => k.online && k.conn != null);
  const senders = online.filter((k) => k.name !== collectorName && itemIds.some((id) => !isNoTrade(k, id) && reachableTotal(k, id, experimental) > 0));
  // Gather every reachable one of each item (the dedicated Consolidate panel / CLI).
  const wantsAll: Record<number, number> = {};
  for (const id of itemIds) wantsAll[id] = Infinity;

  const chars: Record<string, ConsoCharState> = {};
  for (const s of senders) {
    const goal = itemIds.reduce((sum, id) => sum + (isNoTrade(s, id) ? 0 : reachableTotal(s, id, experimental)), 0);
    chars[s.name] = { status: 'pending', sent: 0, goal };
  }
  patch({ running: true, collector: collectorName, order: senders.map((s) => s.name), chars, error: senders.length ? null : 'No other character holds the selected items.' });

  for (const s0 of senders) {
    if (stopFlag) break;
    try {
      await consolidateOne(s0.name, collectorName, wantsAll, experimental);
      patchChar(s0.name, { status: 'ok' });
    } catch (e) {
      patchChar(s0.name, { status: 'fail', note: e instanceof Error ? e.message : String(e) });
    }
  }
  patch({ running: false });
}
