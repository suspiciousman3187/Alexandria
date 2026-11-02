import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from '../bridge';
import type { SlotKey } from './slotLayout';
import type { Target } from './gearsetEdit';

// A succession plan: when `newName` is obtained, write it into every recorded target slot of one gearswap
// file (char|job), replacing whatever is there.
export type Plan = {
  id: string;
  newName: string;
  newId?: number;         // item id, used to detect ownership
  replaces?: string;      // the piece it succeeds (display only)
  targets: Target[];      // set+slot occurrences to rewrite
  augments?: string[];    // optional augments to write with it
  auto: boolean;          // auto-apply on obtain (vs. wait for a manual Apply)
  createdAt: number;
};
export type Fulfillment = { fileKey: string; newName: string; slots: number; at: number };
type Store = { plans: Record<string, Plan[]>; log: Fulfillment[] };

// Dedicated file (NOT the shared ui_sticky.json, whose whole-map save would let the main window clobber
// plans written by the Gearsets window). The Gearsets window is the sole reader/writer + owner of applying.
const FILE = 'gearset_plans.json';
const EMPTY: Plan[] = [];
let store: Store = { plans: {}, log: [] };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath(FILE) });
    const s = JSON.parse(txt) as Store;
    if (s && typeof s === 'object') { store = { plans: s.plans ?? {}, log: s.log ?? [] }; emit(); }
  } catch { /* none saved yet */ }
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

export const fileKeyOf = (char: string, job: string) => `${char}|${job}`;
export const parseFileKey = (k: string): { char: string; job: string } => { const i = k.indexOf('|'); return { char: k.slice(0, i), job: k.slice(i + 1) }; };

export function usePlans(fileKey: string): Plan[] {
  useSyncExternalStore(sub, () => store, () => store);
  return store.plans[fileKey] ?? EMPTY;
}
export function useAllPlans(): Store {
  useSyncExternalStore(sub, () => store, () => store);
  return store;
}
export function getAllPlans(): Store { return store; }

export function addPlan(fileKey: string, p: Omit<Plan, 'id' | 'createdAt'>): void {
  const plan: Plan = { ...p, id: rid(), createdAt: Date.now() };
  commit({ ...store, plans: { ...store.plans, [fileKey]: [...(store.plans[fileKey] ?? []), plan] } });
}
export function updatePlan(fileKey: string, id: string, patch: Partial<Plan>): void {
  commit({ ...store, plans: { ...store.plans, [fileKey]: (store.plans[fileKey] ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) } });
}
export function removePlan(fileKey: string, id: string): void {
  const arr = (store.plans[fileKey] ?? []).filter((p) => p.id !== id);
  const plans = { ...store.plans };
  if (arr.length) plans[fileKey] = arr; else delete plans[fileKey];
  commit({ ...store, plans });
}
export function logFulfillment(f: Fulfillment): void {
  commit({ ...store, log: [f, ...store.log].slice(0, 40) });
}

// Which slot keys of a set currently have a pending plan targeting them (for slot badges in the editor UI).
export function plannedSlots(fileKey: string, setKey: string): Set<SlotKey> {
  const out = new Set<SlotKey>();
  for (const p of store.plans[fileKey] ?? []) for (const t of p.targets) if (t.setKey === setKey) out.add(t.slot);
  return out;
}
