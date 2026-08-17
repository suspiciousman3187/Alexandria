import { useSyncExternalStore } from 'react';
import { getKnownCharacters, withinTradeRange, type KnownChar } from './bridge';
import { runConsolidateSelection, stopConsolidate, reachableTotal, isNoTrade, isRare, charTotal } from './consolidate';

// Distribute = the mirror of Consolidate (one holder -> many recipients). Each
// recipient's hand-off is just a consolidate FROM the holder TO that recipient,
// so we reuse the whole tested trade engine (gather, arm, trade, poll, rare-cap,
// range/mog checks, stop) and only add the recipient loop + the split planning.

export type DistMode = 'each' | 'split' | 'fill';
export type DistItemCfg = { mode: DistMode; amount: number };

export type DistRunState = { running: boolean; holder: string | null; order: string[]; done: string[]; current: string | null; error: string | null };
let state: DistRunState = { running: false, holder: null, order: [], done: [], current: null, error: null };
const listeners = new Set<() => void>();
function patch(p: Partial<DistRunState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }
export function useDistribute(): DistRunState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}
export function clearDistribute() { if (state.running) return; state = { running: false, holder: null, order: [], done: [], current: null, error: null }; listeners.forEach((l) => l()); }

let stopFlag = false;
export function stopDistribute() { stopFlag = true; stopConsolidate(); if (state.running) patch({ running: false }); }

const fresh = (name: string) => getKnownCharacters().find((k) => k.name === name);

// A recipient can receive an item if online, not in a Mog House, within trade
// range of the holder, and (for Rare) doesn't already hold it.
export function distEligible(holder: KnownChar | undefined, recipientName: string, itemIds: number[], experimental: boolean): { ok: boolean; reason?: string } {
  const r = fresh(recipientName);
  if (!r || !r.online || r.conn == null) return { ok: false, reason: 'offline' };
  if (r.mog) return { ok: false, reason: 'in mog house' };
  if (!withinTradeRange(r, holder)) return { ok: false, reason: 'out of range' };
  if (itemIds.length === 1 && isRare(holder, itemIds[0]) && charTotal(r, itemIds[0]) >= 1) return { ok: false, reason: 'already has it' };
  return { ok: true };
}

// Resolve the per-recipient item counts from the chosen mode/amount, capped by
// what the holder actually has (allocated in recipient order) and by Rare rules.
export function buildDistributePlan(
  holderName: string, itemIds: number[], recipients: string[], cfg: Record<number, DistItemCfg>, experimental: boolean,
): { plan: Record<string, Record<number, number>>; available: Record<number, number> } {
  const holder = fresh(holderName);
  const recs = recipients.filter((n) => n !== holderName);
  const plan: Record<string, Record<number, number>> = {};
  const available: Record<number, number> = {};
  for (const id of itemIds) {
    let avail = isNoTrade(holder, id) ? 0 : reachableTotal(holder, id, experimental);
    available[id] = avail;
    const { mode, amount } = cfg[id] ?? { mode: 'each' as DistMode, amount: 1 };
    const rareCap = (r: string) => (isRare(holder, id) ? Math.max(0, 1 - charTotal(fresh(r), id)) : Infinity);
    const desired: { r: string; w: number }[] = recs.map((r) => {
      let w = mode === 'fill' ? Math.max(0, amount - charTotal(fresh(r), id)) : mode === 'split' ? 0 : amount;
      return { r, w: Math.min(w, rareCap(r)) };
    });
    if (mode === 'split') {
      const takers = desired.filter((d) => rareCap(d.r) > 0);
      const per = takers.length ? Math.floor(avail / takers.length) : 0;
      let rem = takers.length ? avail - per * takers.length : 0;
      for (const d of desired) {
        if (rareCap(d.r) <= 0) { d.w = 0; continue; }
        d.w = Math.min(per + (rem > 0 ? 1 : 0), rareCap(d.r));
        if (rem > 0) rem--;
      }
    }
    for (const d of desired) {
      const w = Math.min(d.w, avail);
      if (w <= 0) continue;
      avail -= w;
      plan[d.r] = plan[d.r] ?? {};
      plan[d.r][id] = (plan[d.r][id] ?? 0) + w;
    }
  }
  return { plan, available };
}

export async function runDistribute(holderName: string, plan: Record<string, Record<number, number>>, experimental = false): Promise<void> {
  if (state.running) return;
  const holder = fresh(holderName);
  if (!holder || !holder.online || holder.mog) { patch({ running: false, error: `${holderName} can't trade right now.` }); return; }
  stopFlag = false;
  const recipients = Object.keys(plan).filter((r) => Object.values(plan[r]).some((c) => c > 0));
  if (!recipients.length) return;
  patch({ running: true, holder: holderName, order: recipients, done: [], current: null, error: recipients.length ? null : 'No recipient in range.' });
  try {
    for (const r of recipients) {
      if (stopFlag) break;
      patch({ current: r });
      // One recipient hand-off = consolidate FROM the holder TO this recipient.
      try { await runConsolidateSelection(r, { [holderName]: plan[r] }, experimental); } catch { /* the trade engine records its own per-run state */ }
      patch({ done: [...state.done, r] });
    }
  } finally {
    patch({ running: false, current: null });
  }
}
