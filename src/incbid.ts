import { useSyncExternalStore } from 'react';
import { ahBuy, nextAhMsg, getKnownCharacters } from './bridge';

export type IncBidStatus = 'idle' | 'bidding' | 'won' | 'gaveup' | 'stopped' | 'broke';
export type IncBidState = { running: boolean; charName: string; item: string; attempt: number; maxTries: number; price: number; status: IncBidStatus; note?: string; waitUntil?: number; waitMs?: number };

let s: IncBidState = { running: false, charName: '', item: '', attempt: 0, maxTries: 0, price: 0, status: 'idle' };
const subs = new Set<() => void>();
const set = (p: Partial<IncBidState>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };

export function useIncBid(): IncBidState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => s, () => s);
}

let stop = false;
let wake: (() => void) | null = null;
export function stopIncBid() { stop = true; if (wake) wake(); }
export function clearIncBid() { if (!s.running) set({ status: 'idle', attempt: 0, note: undefined }); }

function waitOrStop(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { window.clearTimeout(t); wake = null; resolve(); };
  });
}

export async function runIncrementalBid(opts: {
  conn: number; charName: string; id: number; itemName: string; single: number; qty: number; startPrice: number; increment: number; maxTries: number; delayMs?: number;
}): Promise<void> {
  if (s.running) return;
  stop = false;
  let price = opts.startPrice;
  set({ running: true, charName: opts.charName, item: opts.itemName, attempt: 0, maxTries: opts.maxTries, price, status: 'bidding', note: undefined });

  for (let attempt = 1; attempt <= opts.maxTries; attempt++) {
    if (stop) break;
    const gil = getKnownCharacters().find((k) => k.name === opts.charName)?.gil ?? 0;
    const cost = price * opts.qty;
    if (gil < cost) { set({ running: false, status: 'broke', attempt, price, note: `${opts.charName} has ${gil.toLocaleString()} gil, needs ${cost.toLocaleString()}` }); return; }

    set({ attempt, price, status: 'bidding', note: undefined, waitUntil: undefined, waitMs: undefined });
    ahBuy(opts.conn, opts.id, opts.single, price, opts.qty);
    const res = await nextAhMsg(opts.conn, 10000);
    if (res?.ok) { set({ running: false, status: 'won', attempt, price, note: res.text }); return; }
    const why = res?.text || 'No response from the auction house';
    set({ note: `Bid ${price.toLocaleString()} failed: ${why}` });
    if (attempt < opts.maxTries) {
      price += opts.increment;
      const delay = opts.delayMs ?? 10000;
      set({ waitUntil: Date.now() + delay, waitMs: delay });
      await waitOrStop(delay);
      if (stop) break;
    }
  }
  set({ running: false, status: stop ? 'stopped' : 'gaveup', price, waitUntil: undefined, waitMs: undefined });
}
