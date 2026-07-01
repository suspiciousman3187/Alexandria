import { useSyncExternalStore } from 'react';

export type ItemName = { id: number; n: string; st: number };

let list: ItemName[] = [];
let started = false;
const subs = new Set<() => void>();

async function load() {
  if (started) return;
  started = true;
  try {
    const resp = await fetch('/item_names.json');
    if (resp.ok) { const p = await resp.json(); if (Array.isArray(p)) list = p; }
  } catch { /* not bundled (dev without build:itemnames) */ }
  subs.forEach((s) => s());
}
void load();

export function useItemNames(): ItemName[] {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
  return list;
}

export function getItemNames(): ItemName[] { return list; }

export function resolveItemName(name: string): ItemName | null {
  const lc = name.trim().toLowerCase();
  if (!lc) return null;
  let partial: ItemName | null = null;
  for (const it of list) {
    const n = it.n.toLowerCase();
    if (n === lc) return it;
    if (!partial && n.includes(lc)) partial = it;
  }
  return partial;
}
