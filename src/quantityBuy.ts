import { useSyncExternalStore } from 'react';
import { ahBuy, nextAhMsg, getKnownCharacters } from './bridge';

// Repeatedly places a bid on the same item/stack at a fixed price, up to a target count, tracking
// how many landed so the user gets real progress and can stop gracefully. Driven one bid at a time
// from the desktop (so it's unbounded by the addon's per-command cap and can report each result).
export type QtyBuyStatus = 'idle' | 'buying' | 'done' | 'stopped' | 'broke';
export type QtyBuyState = { running: boolean; charName: string; item: string; itemId: number; bought: number; target: number; failed: number; price: number; status: QtyBuyStatus; note?: string };

let s: QtyBuyState = { running: false, charName: '', item: '', itemId: 0, bought: 0, target: 0, failed: 0, price: 0, status: 'idle' };
const subs = new Set<() => void>();
const set = (p: Partial<QtyBuyState>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };

export function useQtyBuy(): QtyBuyState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => s, () => s);
}

let stop = false;
let wake: (() => void) | null = null;
export function stopQtyBuy() { stop = true; if (wake) wake(); }
export function clearQtyBuy() { if (!s.running) set({ status: 'idle', bought: 0, failed: 0, note: undefined }); }

function waitOrStop(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { window.clearTimeout(t); wake = null; resolve(); };
  });
}

export async function runQuantityBuy(opts: {
  conn: number; charName: string; id: number; itemName: string; single: number; price: number; target: number; paceMs?: number;
}): Promise<void> {
  if (s.running) return;
  stop = false;
  set({ running: true, charName: opts.charName, item: opts.itemName, itemId: opts.id, bought: 0, target: opts.target, failed: 0, price: opts.price, status: 'buying', note: undefined });
  const pace = opts.paceMs ?? 1200;
  for (let i = 0; i < opts.target; i++) {
    if (stop) break;
    const gil = getKnownCharacters().find((k) => k.name === opts.charName)?.gil ?? 0;
    if (gil < opts.price) { set({ running: false, status: 'broke', note: `${opts.charName} has ${gil.toLocaleString()} gil, needs ${opts.price.toLocaleString()}` }); return; }
    ahBuy(opts.conn, opts.id, opts.single, opts.price, 1);
    const res = await nextAhMsg(opts.conn, 10000);
    if (res?.ok) { set({ bought: s.bought + 1, note: res.text }); }
    else { set({ failed: s.failed + 1, note: `${res?.text || 'Bid failed'} — stopped, remaining bids at this price cancelled` }); break; }
    if (i < opts.target - 1 && !stop && s.running) await waitOrStop(pace);
  }
  set({ running: false, status: stop ? 'stopped' : (s.bought >= opts.target ? 'done' : 'stopped') });
}
