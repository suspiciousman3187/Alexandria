import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';
import { resolveItemName } from './itemNames';
import { runConsolidateSelection, recipientSpaceMulti, buildCappedBySenderMulti } from './consolidate';

type Store = Record<string, string[]>;

let store: Store = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('consolidate_prefs.json') });
    const p = JSON.parse(txt) as Record<string, unknown>;
    if (p && typeof p === 'object') {
      const next: Store = {};
      for (const k in p) { const v = p[k]; if (Array.isArray(v)) { const arr = v.filter((x): x is string => typeof x === 'string'); if (arr.length) next[k] = arr; } }
      store = next;
    }
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('consolidate_prefs.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useConsolidatePrefs(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function getConsolidatePrefs(): Store { return store; }

export function addConsolidateItem(name: string, itemName: string) {
  if (!name || !itemName) return;
  const lc = itemName.toLowerCase();
  const s: Store = {};
  for (const k in store) {
    const filtered = store[k].filter((n) => n.toLowerCase() !== lc);
    if (filtered.length) s[k] = filtered;
  }
  s[name] = [...(s[name] ?? []), itemName];
  store = s;
  notify();
  void save();
}

// Add many items to one character in a single write (bulk-add from a tag or a bag). Each item is moved off
// every other character's list (an item belongs to exactly one recipient), then appended to `name`, de-duped
// and preserving the existing order.
export function addConsolidateItems(name: string, itemNames: string[]) {
  if (!name || !itemNames.length) return;
  const incoming = new Set(itemNames.map((n) => n.toLowerCase()));
  const s: Store = {};
  for (const k in store) {
    const filtered = store[k].filter((n) => !incoming.has(n.toLowerCase()));
    if (filtered.length) s[k] = filtered;
  }
  const kept = s[name] ?? [];
  const have = new Set(kept.map((n) => n.toLowerCase()));
  const additions: string[] = [];
  for (const n of itemNames) { const lc = n.toLowerCase(); if (!have.has(lc)) { have.add(lc); additions.push(n); } }
  s[name] = [...kept, ...additions];
  store = s;
  notify();
  void save();
}

export function removeConsolidateItem(name: string, itemName: string) {
  const cur = store[name];
  if (!cur) return;
  const next = cur.filter((n) => n.toLowerCase() !== itemName.toLowerCase());
  const s = { ...store };
  if (next.length) s[name] = next; else delete s[name];
  store = s;
  notify();
  void save();
}

// Remove many items across characters in a single write (bulk delete from the preference lists). `byChar`
// maps a character to the item names to drop from its list.
export function removeConsolidateItems(byChar: Record<string, string[]>) {
  const s: Store = {};
  let changed = false;
  for (const k in store) {
    const rm = new Set((byChar[k] ?? []).map((n) => n.toLowerCase()));
    const kept = rm.size ? store[k].filter((n) => !rm.has(n.toLowerCase())) : store[k];
    if (kept.length !== store[k].length) changed = true;
    if (kept.length) s[k] = kept;
  }
  if (!changed) return;
  store = s;
  notify();
  void save();
}

let stopFlag = false;
export function stopConsolidatePrefs() { stopFlag = true; }

export async function runConsolidatePrefs(experimental = false) {
  stopFlag = false;
  for (const [charName, items] of Object.entries(store)) {
    if (stopFlag) break;
    if (!items.length) continue;
    const ids: number[] = [];
    for (const n of items) { const it = resolveItemName(n); if (it && !ids.includes(it.id)) ids.push(it.id); }
    if (!ids.length) continue;
    // Gate on the recipient's free inventory: pull only as much of each item as will
    // actually fit (partial stacks filled first), so we never overflow the recipient
    // and trigger misleading "trade not confirmed" failures. Items keep the list order
    // as fill priority when space runs short.
    const space = recipientSpaceMulti(charName, ids, experimental);
    const caps: Record<number, number> = {};
    for (const pi of space.perItem) if (pi.fit > 0) caps[pi.id] = pi.fit;
    const bySender = buildCappedBySenderMulti(charName, caps, experimental);
    if (Object.keys(bySender).length) await runConsolidateSelection(charName, bySender, experimental);
  }
}
