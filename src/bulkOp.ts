import { useSyncExternalStore } from 'react';

export type BulkOp = { id: number; active: string; done: string; count: number; state: 'active' | 'done' };

let cur: BulkOp | null = null;
let seq = 0;
let tDone: number | undefined;
let tClear: number | undefined;
const subs = new Set<() => void>();
const emit = (v: BulkOp | null) => { cur = v; subs.forEach((f) => f()); };

export function startBulkOp(active: string, done: string, count: number) {
  if (tDone) window.clearTimeout(tDone);
  if (tClear) window.clearTimeout(tClear);
  const id = ++seq;
  emit({ id, active, done, count, state: 'active' });
  tDone = window.setTimeout(() => { if (cur && cur.id === id) emit({ ...cur, state: 'done' }); }, Math.min(500 + count * 220, 3000));
  tClear = window.setTimeout(() => { if (cur && cur.id === id) emit(null); }, 6000);
}

export function useBulkOp(): BulkOp | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cur, () => cur);
}
