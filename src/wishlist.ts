import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from './bridge';

export type WishItem = { id: number; n: string; stack?: boolean };

const sameEntry = (a: WishItem, id: number, stack: boolean) => a.id === id && !!a.stack === stack;

let list: WishItem[] = [];
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('wishlist.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p?.items)) { list = p.items; notify(); }
  } catch { /* none yet */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('wishlist.json'), contents: JSON.stringify({ items: list }) }); } catch { /* ignore */ }
}

export function setWishlist(next: WishItem[]) { list = next; notify(); void save(); }
export function addWish(it: { id: number; n: string }, hasStack?: boolean) {
  const next = [...list];
  if (!next.some((x) => sameEntry(x, it.id, false))) next.push({ id: it.id, n: it.n, stack: false });
  if (hasStack && !next.some((x) => sameEntry(x, it.id, true))) next.push({ id: it.id, n: it.n, stack: true });
  if (next.length !== list.length) setWishlist(next);
}
export function removeWish(id: number) { setWishlist(list.filter((x) => x.id !== id)); }
export function removeWishEntry(id: number, stack: boolean) { setWishlist(list.filter((x) => !sameEntry(x, id, stack))); }

export function useWishlist(): WishItem[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
}
