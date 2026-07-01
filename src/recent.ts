import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri, onInventoryUpdate, type InvBag } from './bridge';

export type RecentItem = { char: string; id: number; n: string; qty: number; at: number };

const MAX_EVENTS = 600;
let events: RecentItem[] = [];
const prev = new Map<string, Map<number, number>>();
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('recent_items.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p?.events)) { events = p.events; notify(); }
  } catch { /* none yet */ }
}
if (inTauri) void load();

let saveT: number | null = null;
function save() {
  if (!inTauri || saveT) return;
  saveT = window.setTimeout(async () => {
    saveT = null;
    try { await invoke('write_text_file', { path: await appDataPath('recent_items.json'), contents: JSON.stringify({ events }) }); } catch { /* ignore */ }
  }, 1500);
}

function totals(bags: InvBag[]): Map<number, { count: number; n: string }> {
  const m = new Map<number, { count: number; n: string }>();
  for (const b of bags) for (const it of b.items) {
    const e = m.get(it.id);
    if (e) e.count += it.c; else m.set(it.id, { count: it.c, n: it.n });
  }
  return m;
}

function record(char: string, bags: InvBag[]) {
  const cur = totals(bags);
  const before = prev.get(char);
  if (before) {
    const now = Date.now();
    const fresh: RecentItem[] = [];
    for (const [id, { count, n }] of cur) {
      const old = before.get(id) ?? 0;
      if (count > old) fresh.push({ char, id, n, qty: count - old, at: now });
    }
    if (fresh.length) {
      events = [...events, ...fresh];
      if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
      notify();
      save();
    }
  }
  const next = new Map<number, number>();
  for (const [id, { count }] of cur) next.set(id, count);
  prev.set(char, next);
}

onInventoryUpdate(record);

export function clearRecent() {
  events = [];
  notify();
  save();
}

function useEvents(): RecentItem[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => events, () => events);
}

export function useRecent(windowHours: number): RecentItem[] {
  const all = useEvents();
  const cutoff = Date.now() - windowHours * 3600_000;
  return all.filter((e) => e.at >= cutoff).reverse();
}
