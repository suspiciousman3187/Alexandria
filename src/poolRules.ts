import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, setPoolRules, onAutoLotFeed, useBoxes, type PoolRules } from './bridge';

export const emptyRules = (): PoolRules => ({ lot: [], pass: [], drop: [] });

type Store = Record<string, PoolRules>;

let store: Store = {};
let passOnLot = true;
let autoLotEnabled = true; // global master switch for acting on the lot list
let autoLotOff: Record<string, boolean> = {}; // per-character overrides (true = auto-lot disabled)
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

// Tauri windows are separate JS contexts, each with its own copy of this store.
// Mirror every change through localStorage (shared per origin) so the main window
// and the floating pool overlay stay in lockstep: a rule added in one appears in
// the other, and neither clobbers the other when it re-pushes rules to the addon.
const POOL_SYNC_KEY = 'alexandria:poolrules:sync';

function normRules(p: unknown): PoolRules {
  const o = (p ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { lot: arr(o.lot), pass: arr(o.pass), drop: arr(o.drop) };
}

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('pool_rules.json') });
      const p = JSON.parse(txt) as Record<string, unknown>;
      const bc = (p?.byChar ?? p) as Record<string, unknown>;
      const next: Store = {};
      if (bc && typeof bc === 'object' && !Array.isArray(bc)) {
        for (const k in bc) {
          const v = bc[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) next[k] = normRules(v);
        }
      }
      store = next;
      passOnLot = p?.passOnLot !== false; // default ON: only an explicit false disables it
      autoLotEnabled = p?.autoLotEnabled !== false;
      autoLotOff = {};
      const alo = p?.autoLotOff;
      if (alo && typeof alo === 'object' && !Array.isArray(alo)) for (const k in alo as Record<string, unknown>) if ((alo as Record<string, unknown>)[k] === true) autoLotOff[k] = true;
    } catch { /* none saved */ }
  }
  ready = true;
  store = { ...store };
  notify();
}
if (inTauri) void load(); else ready = true;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== POOL_SYNC_KEY || !e.newValue) return;
    try {
      const p = JSON.parse(e.newValue) as { store?: Store; passOnLot?: boolean; autoLotEnabled?: boolean; autoLotOff?: Record<string, boolean> };
      if (p.store && typeof p.store === 'object') store = p.store;
      passOnLot = p.passOnLot === true;
      autoLotEnabled = p.autoLotEnabled !== false;
      autoLotOff = (p.autoLotOff && typeof p.autoLotOff === 'object') ? { ...p.autoLotOff } : {};
      ready = true;
      notify();
    } catch { /* ignore */ }
  });
}

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('pool_rules.json'), contents: JSON.stringify({ byChar: store, passOnLot, autoLotEnabled, autoLotOff }) }); } catch { /* ignore */ }
  try { localStorage.setItem(POOL_SYNC_KEY, JSON.stringify({ store, passOnLot, autoLotEnabled, autoLotOff, t: Date.now() })); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void save(); }

export function usePoolStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function setCharRules(name: string, r: PoolRules) { commit({ ...store, [name]: r }); }

// Add one item to a rule list across many characters in a single commit (so the whole
// fleet gets a standing rule without editing them one at a time).
export function addRuleToChars(names: string[], kind: 'lot' | 'pass' | 'drop', itemName: string) {
  const next: Store = { ...store };
  const lc = itemName.toLowerCase();
  for (const name of names) {
    if (!name) continue;
    const r = next[name] ?? emptyRules();
    if (r[kind].some((x) => x.toLowerCase() === lc)) continue;
    next[name] = { ...r, [kind]: [...r[kind], itemName] };
  }
  commit(next);
}

export function removeRuleFromChar(name: string, kind: 'lot' | 'pass' | 'drop', itemName: string) {
  const r = store[name];
  if (!r) return;
  const lc = itemName.toLowerCase();
  if (!r[kind].some((x) => x.toLowerCase() === lc)) return;
  commit({ ...store, [name]: { ...r, [kind]: r[kind].filter((x) => x.toLowerCase() !== lc) } });
}

export function usePassOnLot(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => passOnLot, () => passOnLot);
}
export function setPassOnLot(v: boolean) { passOnLot = v; notify(); void save(); }

export function useAutoLotEnabled(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => autoLotEnabled, () => autoLotEnabled);
}
export function setAutoLotEnabled(v: boolean) { autoLotEnabled = v; notify(); void save(); }
export function useAutoLotOff(): Record<string, boolean> {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => autoLotOff, () => autoLotOff);
}
export function isAutoLotOn(name: string): boolean { return autoLotEnabled && !autoLotOff[name]; }
export function setAutoLotChar(name: string, on: boolean) {
  const next = { ...autoLotOff };
  if (on) delete next[name]; else next[name] = true;
  autoLotOff = next; notify(); void save();
}
// A //ax autolot toggle typed in-game arrives here so the desktop UI + persistence stay in sync.
onAutoLotFeed((name, on, all) => { if (all) setAutoLotEnabled(on); else if (name) setAutoLotChar(name, on); });

// Re-push each character's rules to its addon on change or reconnect, so they survive app/game restarts.
export function usePoolRulesSync() {
  const boxes = useBoxes();
  const s = usePoolStore();
  const yield_ = usePassOnLot();
  const enabled = useAutoLotEnabled();
  const off = useAutoLotOff();
  const onlineKey = useMemo(() => boxes.filter((b) => b.conn != null).map((b) => `${b.conn}:${b.name}`).sort().join(','), [boxes]);
  useEffect(() => {
    if (!ready) return;
    for (const b of boxes) {
      if (b.conn == null || !b.name) continue;
      setPoolRules(b.conn, { ...(s[b.name] ?? emptyRules()), passOnLot: yield_, autoLot: enabled && !off[b.name] });
    }
  }, [onlineKey, s, yield_, enabled, off]);
}
