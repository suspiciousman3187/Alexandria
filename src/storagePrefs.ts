import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

export type LayoutEntry = { item: string; bags: number[] };
type Store = Record<string, LayoutEntry[]>;

export const STORABLE_BAGS: { id: number; name: string }[] = [
  { id: 5, name: 'Satchel' }, { id: 6, name: 'Sack' }, { id: 7, name: 'Case' },
  { id: 2, name: 'Storage' }, { id: 4, name: 'Locker' }, { id: 1, name: 'Safe' }, { id: 9, name: 'Safe 2' },
];

// The shared "applies to every character" layout is stored under this reserved
// key (not a real character name, so it never collides). Editing here routes an
// item for the whole fleet; a per-character entry overrides it for that one.
export const ALL_PLAYERS_KEY = '*';
export const ALL_PLAYERS_LABEL = 'All Players';

let store: Store = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normEntries(v: unknown): LayoutEntry[] {
  if (!Array.isArray(v)) return [];
  const out: LayoutEntry[] = [];
  for (const e of v) {
    const item = typeof (e as LayoutEntry)?.item === 'string' ? (e as LayoutEntry).item : '';
    const bagsRaw = (e as LayoutEntry)?.bags;
    const bags = Array.isArray(bagsRaw) ? bagsRaw.map((b) => Number(b)).filter((b) => Number.isInteger(b)) : [];
    if (item && bags.length) out.push({ item, bags });
  }
  return out;
}

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('storage_prefs.json') });
    const p = JSON.parse(txt) as Record<string, unknown>;
    if (p && typeof p === 'object') {
      const next: Store = {};
      for (const k in p) { const arr = normEntries(p[k]); if (arr.length) next[k] = arr; }
      store = next;
    }
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('storage_prefs.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useStoragePrefs(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function getStoragePrefs(): Store { return store; }

// Runtime layout for a character: its own rules layered over the shared
// All-Players defaults. A character-specific rule for an item wins; any item the
// character hasn't overridden falls back to the shared rule.
export function layoutFor(name: string): LayoutEntry[] {
  if (name === ALL_PLAYERS_KEY) return store[ALL_PLAYERS_KEY] ?? [];
  const shared = store[ALL_PLAYERS_KEY] ?? [];
  const own = store[name] ?? [];
  if (!shared.length) return own;
  if (!own.length) return shared;
  const ownItems = new Set(own.map((e) => e.item.toLowerCase()));
  const merged = own.slice();
  for (const e of shared) if (!ownItems.has(e.item.toLowerCase())) merged.push(e);
  return merged;
}

export function setCharLayout(name: string, entries: LayoutEntry[]) {
  const clean = entries.filter((e) => e.item && e.bags.length);
  const s = { ...store };
  if (clean.length) s[name] = clean; else delete s[name];
  store = s;
  notify();
  void save();
}
