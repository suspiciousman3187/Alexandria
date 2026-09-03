import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';
import { ALL_PLAYERS_KEY } from './storagePrefs';
import type { ItemCategory } from './itemNames';

// Where a whole equipment SLOT goes: category (head/body/…/rings) -> bag priority order. Scoped like tag
// rules and storage presets ('*' = All-Players default, a character name overrides it). Lowest routing
// precedence: an explicit item preset or a tag rule always beats a slot rule (see resolveLayout). Slot
// rules only ever match equipment, so they can never route a non-equippable item into a wardrobe.
export type SlotRule = { cat: ItemCategory; bags: number[] };
type Store = Record<string, SlotRule[]>;

let store: Store = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normEntries(v: unknown): SlotRule[] {
  if (!Array.isArray(v)) return [];
  const out: SlotRule[] = [];
  for (const e of v) {
    const cat = typeof (e as SlotRule)?.cat === 'string' ? (e as SlotRule).cat : '';
    const bagsRaw = (e as SlotRule)?.bags;
    const bags = Array.isArray(bagsRaw) ? bagsRaw.map((b) => Number(b)).filter((b) => Number.isInteger(b)) : [];
    if (cat && bags.length) out.push({ cat: cat as ItemCategory, bags });
  }
  return out;
}

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('slot_rules.json') });
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
  try { await invoke('write_text_file', { path: await appDataPath('slot_rules.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useSlotRules(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}
export function getSlotRules(): Store { return store; }

export function setSlotRules(name: string, entries: SlotRule[]) {
  const clean = entries.filter((e) => e.cat && e.bags.length);
  const s = { ...store };
  if (clean.length) s[name] = clean; else delete s[name];
  store = s;
  notify();
  void save();
}

// A character's effective slot rules as a Map<cat, bags>: All-Players defaults with the character's own
// entries layered on top (a per-character rule for a slot wins). Used by resolveLayout.
export function slotRulesMapFor(name: string): Map<ItemCategory, number[]> {
  const m = new Map<ItemCategory, number[]>();
  for (const e of store[ALL_PLAYERS_KEY] ?? []) m.set(e.cat, e.bags);
  if (name !== ALL_PLAYERS_KEY) for (const e of store[name] ?? []) m.set(e.cat, e.bags);
  return m;
}
