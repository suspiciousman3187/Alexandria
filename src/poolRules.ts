import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, setPoolRules, useBoxes, type PoolRules } from './bridge';

export const emptyRules = (): PoolRules => ({ lot: [], pass: [], drop: [] });

type Store = Record<string, PoolRules>;

let store: Store = {};
let passOnLot = false;
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

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
      passOnLot = p?.passOnLot === true;
    } catch { /* none saved */ }
  }
  ready = true;
  store = { ...store };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('pool_rules.json'), contents: JSON.stringify({ byChar: store, passOnLot }) }); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void save(); }

export function usePoolStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function setCharRules(name: string, r: PoolRules) { commit({ ...store, [name]: r }); }

export function usePassOnLot(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => passOnLot, () => passOnLot);
}
export function setPassOnLot(v: boolean) { passOnLot = v; notify(); void save(); }

// Re-push each character's rules to its addon on change or reconnect, so they survive app/game restarts.
export function usePoolRulesSync() {
  const boxes = useBoxes();
  const s = usePoolStore();
  const yield_ = usePassOnLot();
  const onlineKey = useMemo(() => boxes.filter((b) => b.conn != null).map((b) => `${b.conn}:${b.name}`).sort().join(','), [boxes]);
  useEffect(() => {
    if (!ready) return;
    for (const b of boxes) {
      if (b.conn == null || !b.name) continue;
      setPoolRules(b.conn, { ...(s[b.name] ?? emptyRules()), passOnLot: yield_ });
    }
  }, [onlineKey, s, yield_]);
}
