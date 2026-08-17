import { invoke } from '@tauri-apps/api/core';
import { useEffect, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, sendBoxCommand, useKnownCharacters, type InvBag } from './bridge';
import { getSettings } from './settings';

export type WatchItem = { id: number; name: string; min: number };
export type WatchChar = { enabled: boolean; items: WatchItem[] };
type Store = Record<string, WatchChar>;

export const emptyWatch = (): WatchChar => ({ enabled: true, items: [] });

let store: Store = {};
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normChar(v: unknown): WatchChar {
  const o = (v ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items)
    ? o.items
        .map((x): WatchItem | null => {
          const i = x as Record<string, unknown>;
          const id = Number(i?.id);
          const name = typeof i?.name === 'string' ? i.name : '';
          const min = Number(i?.min);
          return id > 0 && name && min >= 0 ? { id, name, min } : null;
        })
        .filter((x): x is WatchItem => !!x)
    : [];
  return { enabled: o.enabled !== false, items };
}

async function loadWatch() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('watchlist.json') });
    const p = JSON.parse(txt) as Record<string, unknown>;
    const bc = p?.byChar as Record<string, unknown> | undefined;
    if (bc && typeof bc === 'object' && !Array.isArray(bc)) {
      const next: Store = {};
      for (const k in bc) next[k] = normChar(bc[k]);
      store = next;
      notify();
    }
  } catch { /* none saved yet */ }
}
if (inTauri) void loadWatch();

async function saveWatch() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('watchlist.json'), contents: JSON.stringify({ byChar: store }) }); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void saveWatch(); }

export function useWatchStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function getWatch(name: string): WatchChar { return store[name] ?? emptyWatch(); }
export function setWatchChar(name: string, c: WatchChar) { commit({ ...store, [name]: c }); }
export function isWatchedFor(name: string, id: number): boolean { return (store[name]?.items ?? []).some((i) => i.id === id); }

export function addWatchItem(name: string, item: { id: number; name: string }, min: number) {
  const c = getWatch(name);
  const m = Math.max(0, Math.floor(min) || 0);
  const exists = c.items.some((i) => i.id === item.id);
  const items = exists
    ? c.items.map((i) => (i.id === item.id ? { ...i, min: m } : i))
    : [...c.items, { id: item.id, name: item.name, min: m }];
  setWatchChar(name, { ...c, items });
}
export function removeWatchItem(name: string, id: number) {
  const c = getWatch(name);
  setWatchChar(name, { ...c, items: c.items.filter((i) => i.id !== id) });
}
export function setWatchMin(name: string, id: number, min: number) {
  const c = getWatch(name);
  setWatchChar(name, { ...c, items: c.items.map((i) => (i.id === id ? { ...i, min: Math.max(0, Math.floor(min) || 0) } : i)) });
}

export function totalOf(inv: InvBag[] | undefined, id: number): number {
  if (!inv) return 0;
  let t = 0;
  for (const b of inv) for (const it of b.items) if (it.id === id) t += it.c;
  return t;
}

const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim();
const lastAlert = new Map<string, number>();

export function useWatchAlerts() {
  const known = useKnownCharacters();
  const s = useWatchStore();
  useEffect(() => {
    const now = Date.now();
    const throttleMs = Math.max(1, getSettings().watchFreqMin) * 60 * 1000;
    // Broadcast low-stock alerts to every open window, not just the low character's own -- when
    // multiboxing you are looking at your active character, not the mule that ran dry. Name the low
    // character so any window tells you which mule to restock (local add_to_chat only, never public).
    const targets = known.filter((k) => k.online && k.conn != null).map((k) => k.conn as number);
    for (const c of known) {
      if (!c.online || c.conn == null || !c.inv) continue;
      const wc = s[c.name];
      if (!wc || !wc.enabled || wc.items.length === 0) continue;
      for (const it of wc.items) {
        const key = `${c.name}|${it.id}`;
        const total = totalOf(c.inv, it.id);
        if (total < it.min) {
          if (now - (lastAlert.get(key) ?? 0) > throttleMs) {
            lastAlert.set(key, now);
            const text = `${ascii(c.name)} is low on ${ascii(it.name)}: ${total} left (want ${it.min})`;
            for (const conn of targets) sendBoxCommand(conn, JSON.stringify({ cmd: 'alert', text }));
          }
        } else {
          lastAlert.delete(key);
        }
      }
    }
  }, [known, s]);
}
