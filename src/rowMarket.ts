import { useEffect, useRef, useState } from 'react';
import { fetchMarket, type MarketData } from './bridge';

const cache = new Map<string, MarketData | null>();
const subs = new Map<string, Set<() => void>>();
const queue: string[] = [];
const pending = new Set<string>();
let active = 0;
const MAX = 3;
const DELAY = 150;

const keyOf = (id: number, stack: boolean, server?: string) => `${id}:${stack ? 1 : 0}:${server ?? ''}`;

function notify(k: string) { subs.get(k)?.forEach((f) => f()); }

function pump() {
  while (active < MAX && queue.length) {
    const k = queue.shift()!;
    pending.delete(k);
    if (cache.has(k)) continue;
    active++;
    const [idStr, stackStr, server] = k.split(':');
    fetchMarket(Number(idStr), stackStr === '1', server || undefined)
      .then((d) => cache.set(k, d))
      .catch(() => cache.set(k, null))
      .finally(() => { active--; notify(k); window.setTimeout(pump, DELAY); });
  }
}

function request(id: number, stack: boolean, server?: string) {
  const k = keyOf(id, stack, server);
  if (cache.has(k) || pending.has(k)) return;
  pending.add(k);
  queue.push(k);
  pump();
}

export function useRowMarket(id: number, stack: boolean, server: string | undefined, enabled: boolean): MarketData | null | undefined {
  const k = keyOf(id, stack, server);
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || cache.has(k)) return;
    let set = subs.get(k);
    if (!set) { set = new Set(); subs.set(k, set); }
    const cb = () => force((n) => n + 1);
    set.add(cb);
    request(id, stack, server);
    return () => { set!.delete(cb); };
  }, [k, enabled, id, stack, server]);
  return cache.get(k);
}

