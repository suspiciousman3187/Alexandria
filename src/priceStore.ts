import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { appDataPath, inTauri, fetchMarket, type MarketData } from './bridge';

export type PriceSnap = { at: number; median: number; stock: number };
export type ItemValue = { median?: number; stock?: number; rate?: number; listedTotal?: number; at: number };

const keyOf = (world: string, id: number, stack: boolean) => `${world}|${id}|${stack ? 1 : 0}`;

const latest = new Map<string, ItemValue>();
const market = new Map<string, MarketData | null>();
const history: Record<string, PriceSnap[]> = {};
const inflight = new Map<string, Promise<MarketData | null>>();
const subs = new Map<string, Set<() => void>>();

const LOG_MIN_GAP = 30 * 60 * 1000;
const MAX_SNAPS = 120;
const STALE_MS = 10 * 60 * 1000;

const queue: Array<() => void> = [];
let active = 0;
const MAX = 3;
const DELAY = 150;

let loadP: Promise<void> | null = null;
let saveT: number | null = null;

function notify(k: string) { subs.get(k)?.forEach((f) => f()); }

function load(): Promise<void> {
  if (loadP) return loadP;
  loadP = (async () => {
    if (!inTauri) return;
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('price_history.json') });
      const p = JSON.parse(txt) as Record<string, PriceSnap[]>;
      if (p && typeof p === 'object') {
        for (const k in p) {
          if (!Array.isArray(p[k]) || history[k]) continue;
          history[k] = p[k];
          const last = p[k][p[k].length - 1];
          if (last && !latest.has(k)) latest.set(k, { median: last.median, stock: last.stock, at: last.at });
        }
      }
    } catch { /* none saved yet */ }
    for (const s of subs.values()) s.forEach((f) => f());
  })();
  return loadP;
}

function save() {
  if (!inTauri || saveT != null) return;
  saveT = window.setTimeout(async () => {
    saveT = null;
    try { await invoke('write_text_file', { path: await appDataPath('price_history.json'), contents: JSON.stringify(history) }); } catch { /* ignore */ }
  }, 3000);
}

function logSnap(k: string, median: number, stock: number, at: number) {
  const arr = history[k] ?? (history[k] = []);
  const prev = arr[arr.length - 1];
  if (prev && at - prev.at < LOG_MIN_GAP && prev.median === median) return;
  arr.push({ at, median, stock });
  if (arr.length > MAX_SNAPS) arr.splice(0, arr.length - MAX_SNAPS);
  save();
}

function pump() {
  while (active < MAX && queue.length > 0) {
    const job = queue.shift();
    if (job) { active++; job(); }
  }
}

function request(world: string, id: number, stack: boolean): Promise<MarketData | null> {
  const k = keyOf(world, id, stack);
  const inf = inflight.get(k);
  if (inf) return inf;
  const p = new Promise<MarketData | null>((resolve) => {
    queue.push(async () => {
      let data: MarketData | null = null;
      try {
        data = await fetchMarket(id, stack, world);
        const median = data.median ? Number(data.median.replace(/[^\d]/g, '')) : undefined;
        const stock = data.stock != null && data.stock !== '' ? Number(data.stock) : undefined;
        const rate = data.rate ? Number(data.rate) : undefined;
        market.set(k, data);
        latest.set(k, { median, stock, rate, listedTotal: data.listedTotal, at: Date.now() });
      } catch { data = null; market.set(k, null); const prev = latest.get(k); latest.set(k, { ...(prev ?? {}), at: Date.now() }); }
      finally { active--; inflight.delete(k); notify(k); window.setTimeout(pump, DELAY); }
      resolve(data);
    });
  });
  inflight.set(k, p);
  pump();
  return p;
}

// Row-market data (wishlist / AH browse via useRowMarket) is fetched once when a row first
// scrolls into view and cached for the session, so a long-open window would otherwise show
// the same prices for days. Periodically re-fetch the rows that are currently on screen
// (subscribed, non-empty) once their cached value ages past ROW_TTL.
let rowTtlMs = 15 * 60 * 1000;
export function setRowPollMinutes(min: number) { rowTtlMs = min > 0 ? min * 60 * 1000 : 0; }
function sweepStaleRows() {
  if (rowTtlMs <= 0) return;
  const now = Date.now();
  for (const [k, set] of subs) {
    if (!set.size || inflight.has(k)) continue;
    const cur = latest.get(k);
    if (!cur || now - cur.at <= rowTtlMs) continue;
    const [world, idStr, stackStr] = k.split('|');
    const id = Number(idStr);
    if (id > 0) void request(world, id, stackStr === '1');
  }
}
if (typeof window !== 'undefined') window.setTimeout(() => { if (inTauri) window.setInterval(sweepStaleRows, 60 * 1000); }, 0);

// Explicit user refresh: drop the cached value for every on-screen row so it
// visibly flips back to its loading spinner, then re-fetch. (The background
// sweep leaves the old value in place; this one wipes it for clear feedback.)
export function refreshVisibleRows() {
  for (const [k, set] of subs) {
    if (!set.size) continue;
    market.delete(k);
    latest.delete(k);
    notify(k);
    if (inflight.has(k)) continue;
    const [world, idStr, stackStr] = k.split('|');
    const id = Number(idStr);
    if (world && id > 0) void request(world, id, stackStr === '1');
  }
}

export function getCachedValue(world: string, id: number, stack = false): ItemValue | undefined {
  return latest.get(keyOf(world, id, stack));
}

export function getMarket(world: string, id: number, stack = false): MarketData | null | undefined {
  return market.get(keyOf(world, id, stack));
}

export async function getItemValue(world: string, id: number, stack = false): Promise<ItemValue | null> {
  void load();
  const k = keyOf(world, id, stack);
  const cur = latest.get(k);
  if (cur && Date.now() - cur.at < STALE_MS) return cur;
  await request(world, id, stack);
  return latest.get(k) ?? null;
}

export async function getItemValueLazy(world: string, id: number, stack = false): Promise<ItemValue | null> {
  void load();
  const k = keyOf(world, id, stack);
  const cur = latest.get(k);
  if (cur) return cur;
  await request(world, id, stack);
  return latest.get(k) ?? null;
}

export function getPriceHistory(world: string, id: number, stack = false): PriceSnap[] {
  void load();
  return history[keyOf(world, id, stack)] ?? [];
}

export async function logPriceSnapshot(world: string, id: number, stack: boolean, median: number, stock: number) {
  await load();
  if (Number.isFinite(median) && median > 0) logSnap(keyOf(world, id, stack), median, stock, Date.now());
}

export function useRowMarket(id: number, stack: boolean, server: string | undefined, enabled: boolean): MarketData | null | undefined {
  const world = server ?? '';
  const k = keyOf(world, id, stack);
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let set = subs.get(k);
    if (!set) { set = new Set(); subs.set(k, set); }
    const cb = () => force((n) => n + 1);
    set.add(cb);
    if (!market.has(k)) void request(world, id, stack);
    return () => { set!.delete(cb); };
  }, [k, enabled, world, id, stack]);
  return market.get(k);
}

export function useItemValues(world: string | undefined, ids: number[], stack = false): Map<number, ItemValue> {
  const [, force] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    if (!world || ids.length === 0) return;
    let alive = true;
    const bump = () => { if (alive) force((n) => n + 1); };
    for (const id of ids) void getItemValueLazy(world, id, stack).then(bump);
    return () => { alive = false; };
  }, [world, key, stack]);
  const m = new Map<number, ItemValue>();
  if (world) for (const id of ids) { const v = getCachedValue(world, id, stack); if (v) m.set(id, v); }
  return m;
}

export function useItemValue(world: string | undefined, id: number, stack = false, enabled = true): ItemValue | undefined {
  const k = world ? keyOf(world, id, stack) : '';
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || !world) return;
    let set = subs.get(k);
    if (!set) { set = new Set(); subs.set(k, set); }
    const cb = () => force((n) => n + 1);
    set.add(cb);
    void getItemValue(world, id, stack);
    return () => { set!.delete(cb); };
  }, [k, enabled, world, id, stack]);
  return world ? latest.get(k) : undefined;
}
