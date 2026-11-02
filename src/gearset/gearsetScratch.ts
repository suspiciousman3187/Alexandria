import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from '../bridge';
import type { SlotKey } from './slotLayout';
import type { GearEntry } from './gearsetParser';

// A provisional ("scratch") gearset: a free experiment not bound to a GearSwap file. Edited like a real set,
// usable as a compare operand, and promotable into the file as a real sets.X. Persisted per char|job file.
export type ScratchSet = { id: string; name: string; slots: Partial<Record<SlotKey, GearEntry>>; createdAt: number };
type Store = Record<string, ScratchSet[]>;

const FILE = 'gearset_scratch.json';
const EMPTY: ScratchSet[] = [];
let store: Store = {};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath(FILE) });
    const s = JSON.parse(txt) as Store;
    if (s && typeof s === 'object') { store = s; emit(); }
  } catch { /* none yet */ }
}
void load();

let saveTimer: number | undefined;
function commit(next: Store) {
  store = next;
  emit();
  if (!inTauri) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try { await invoke('write_text_file', { path: await appDataPath(FILE), contents: JSON.stringify(store) }); } catch { /* ignore */ }
  }, 300);
}
const sub = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };
const rid = () => Math.random().toString(36).slice(2, 9);

export function useScratch(fileKey: string): ScratchSet[] {
  useSyncExternalStore(sub, () => store, () => store);
  return store[fileKey] ?? EMPTY;
}

export function createScratch(fileKey: string, name: string, slots?: Partial<Record<SlotKey, GearEntry>>): string {
  const sc: ScratchSet = { id: rid(), name: name.trim() || 'Scratch', slots: slots ? { ...slots } : {}, createdAt: Date.now() };
  commit({ ...store, [fileKey]: [...(store[fileKey] ?? []), sc] });
  return sc.id;
}
export function renameScratch(fileKey: string, id: string, name: string): void {
  commit({ ...store, [fileKey]: (store[fileKey] ?? []).map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)) });
}
export function deleteScratch(fileKey: string, id: string): void {
  const arr = (store[fileKey] ?? []).filter((s) => s.id !== id);
  const next = { ...store };
  if (arr.length) next[fileKey] = arr; else delete next[fileKey];
  commit(next);
}
// Set (or clear, with entry=null) one slot of a scratch set.
export function setScratchSlot(fileKey: string, id: string, slot: SlotKey, entry: GearEntry | null): void {
  commit({
    ...store,
    [fileKey]: (store[fileKey] ?? []).map((s) => {
      if (s.id !== id) return s;
      const slots = { ...s.slots };
      if (entry) slots[slot] = entry; else delete slots[slot];
      return { ...s, slots };
    }),
  });
}

export const SCRATCH_PREFIX = 'scratch:';
