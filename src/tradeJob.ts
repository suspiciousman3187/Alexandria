import { useSyncExternalStore } from 'react';
import { getKnownCharacters, armTradeReceiver, tradeTo } from './bridge';

export type TradeRow = { slot: number; id: number; count: number };
export type TradeJob = {
  id: number;
  charName: string;
  target: string;
  batches: TradeRow[][];
  gil: number;
  batchIdx: number;
  result: 'done' | 'failed' | 'failedToStart' | null;
  pct: number;
};

let job: TradeJob | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useTradeJob(): TradeJob | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => job, () => job);
}

// Tracking lives here (not in the React banner) so it survives navigating away
// from the Inventory view: a trade that completes while another section is open
// is still detected, and the banner never re-fires the trade on remount.
let poll: number | null = null;
let deadline = 0;
let globalBase: { items: number; gil: number } | null = null;
let batchBase: { items: number; gil: number } | null = null;

function tradedIds(j: TradeJob): Set<number> {
  const s = new Set<number>();
  for (const b of j.batches) for (const r of b) s.add(r.id);
  return s;
}
function bag0Total(name: string, ids: Set<number>): number {
  const lv = getKnownCharacters().find((k) => k.name === name);
  const bag0 = lv?.inv?.find((b) => b.id === 0);
  let n = 0;
  for (const it of bag0?.items ?? []) if (ids.has(it.id)) n += it.c;
  return n;
}
function curGil(name: string): number {
  return getKnownCharacters().find((k) => k.name === name)?.gil ?? 0;
}
function clearPoll() { if (poll != null) { window.clearInterval(poll); poll = null; } }

function finish(result: TradeJob['result']) {
  clearPoll();
  if (!job) return;
  const fid = job.id;
  job = { ...job, result, pct: result === 'done' ? 100 : job.pct };
  emit();
  window.setTimeout(() => { if (job && job.id === fid) clearTradeJob(); }, result === 'done' ? 1400 : 4000);
}

function kick(idx: number) {
  if (!job) return;
  const live = getKnownCharacters().find((k) => k.name === job!.charName);
  const dest = getKnownCharacters().find((k) => k.name === job!.target);
  if (!live || live.conn == null || !dest || dest.conn == null) { finish('failedToStart'); return; }
  const base = { items: bag0Total(job.charName, tradedIds(job)), gil: live.gil ?? 0 };
  batchBase = base;
  if (idx === 0) globalBase = base;
  armTradeReceiver(dest.conn, live.name, live.id);
  const jid = job.id;
  const conn = live.conn, target = dest.name, batch = job.batches[idx], gil = idx === 0 ? job.gil : 0;
  window.setTimeout(() => { if (job && job.id === jid) tradeTo(conn, target, batch, gil); }, 400);
  deadline = Date.now() + 15400;
}

function tick() {
  if (!job || job.result) return;
  const ids = tradedIds(job);
  const items = bag0Total(job.charName, ids);
  const gil = curGil(job.charName);

  const totalExp = job.batches.reduce((n, b) => n + b.reduce((m, r) => m + r.count, 0), 0);
  const movedItems = globalBase ? Math.max(0, globalBase.items - items) : 0;
  const movedGil = globalBase ? Math.max(0, globalBase.gil - gil) : 0;
  const pct = totalExp > 0 ? Math.min(100, Math.round((movedItems / totalExp) * 100)) : job.gil > 0 ? Math.min(100, Math.round((movedGil / job.gil) * 100)) : 5;
  if (pct !== job.pct) { job = { ...job, pct }; emit(); }

  if (batchBase) {
    const leftItems = batchBase.items - items;
    const leftGil = batchBase.gil - gil;
    const expItems = job.batches[job.batchIdx]?.reduce((m, r) => m + r.count, 0) ?? 0;
    const expGil = job.batchIdx === 0 ? job.gil : 0;
    if ((expItems > 0 || expGil > 0) && leftItems >= expItems && leftGil >= expGil) {
      if (job.batchIdx < job.batches.length - 1) {
        const next = job.batchIdx + 1;
        job = { ...job, batchIdx: next };
        emit();
        kick(next);
      } else {
        finish('done');
      }
      return;
    }
  }

  if (Date.now() > deadline) {
    const moved = (globalBase ? globalBase.items - items : 0) + (globalBase ? globalBase.gil - gil : 0);
    finish(moved > 0 ? 'failed' : 'failedToStart');
  }
}

export function startTradeJob(j: { charName: string; target: string; batches: TradeRow[][]; gil: number }) {
  clearPoll();
  globalBase = null;
  batchBase = null;
  job = { id: ++seq, ...j, batchIdx: 0, result: null, pct: 0 };
  emit();
  kick(0);
  poll = window.setInterval(tick, 300);
}

export function clearTradeJob() {
  clearPoll();
  globalBase = null;
  batchBase = null;
  job = null;
  emit();
}
