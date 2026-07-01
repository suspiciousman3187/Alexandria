import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri, onCurioCatalog, type CurioCatalogItem } from './bridge';

// Curio Vendor Moogle stock: bundled default (public/curio_catalog.json) + per-server live Scan override; each item carries its menu option so Resupply opens the right sub-shop.
export type CurioItem = CurioCatalogItem;
type Entry = { items: CurioItem[]; at: number };
type Store = Record<string, Entry>;

const DEFAULT = 'default';
let store: Store = {};
let bundled: CurioItem[] = [];
let bundledById = new Map<number, CurioItem>();
let enrichCache = new WeakMap<CurioItem[], CurioItem[]>();
let version = 0;
let started = false;
const subs = new Set<() => void>();
const bump = () => { version += 1; subs.forEach((s) => s()); };
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('curio_catalog.json') });
      const p = JSON.parse(txt);
      if (p && typeof p === 'object' && !Array.isArray(p)) store = p as Store;
    } catch { /* none scanned yet */ }
  }
  try {
    const r = await fetch('/curio_catalog.json');
    if (r.ok) { const p = await r.json(); if (Array.isArray(p)) bundled = p; }
  } catch { /* no bundled pack */ }
  bundledById = new Map(bundled.map((b) => [b.id, b]));
  enrichCache = new WeakMap();
  bump();
}
void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('curio_catalog.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

onCurioCatalog((server, items) => {
  store = { ...store, [server || DEFAULT]: { items, at: Date.now() } };
  bump();
  void save();
});

// Older scans (saved before the addon captured item flags) lack rare/ex/stack;
// backfill them by id from the bundled pack so gating works without a rescan.
function enrich(items: CurioItem[]): CurioItem[] {
  if (!bundledById.size) return items;
  let changed = false;
  const out = items.map((it) => {
    if (it.rare !== undefined || it.ex !== undefined || it.stack !== undefined) return it;
    const b = bundledById.get(it.id);
    if (!b) return it;
    changed = true;
    return { ...it, stack: b.stack, rare: b.rare, ex: b.ex };
  });
  return changed ? out : items;
}

// Hide the Curio "Items/Materials" category (opt 5), all EX crafting mats no one restocks, except the Instant* utility scrolls; keeps new scan materials hidden automatically.
const keepCurio = (it: CurioItem) => it.opt !== 5 || /^instant /i.test(it.n);

function itemsFor(server?: string): CurioItem[] {
  const base = store[server || DEFAULT]?.items ?? store[DEFAULT]?.items ?? bundled;
  let out = enrichCache.get(base);
  if (!out) { out = enrich(base).filter(keepCurio); enrichCache.set(base, out); }
  return out;
}

export function useCurioCatalog(server?: string): CurioItem[] {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return itemsFor(server);
}

export function useCurioVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

// Distinct category options that sell the given item names, for resupply_set.
export function curioOptionsFor(server: string | undefined, names: string[]): number[] {
  const items = itemsFor(server);
  const byName = new Map(items.map((i) => [i.n.toLowerCase(), i.opt]));
  const opts = new Set<number>();
  for (const n of names) { const o = byName.get(n.toLowerCase()); if (o != null) opts.add(o); }
  return [...opts];
}
