import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, setResupply, useBoxes } from './bridge';
import { useMenuShortcuts } from './menuShortcuts';
import { useCurioVersion, curioOptionsFor } from './curioCatalog';

export type ResupplyItem = { name: string; min: number };
export type ResupplyChar = { enabled: boolean; items: ResupplyItem[] };
type Store = Record<string, ResupplyChar>;

export const emptyResupply = (): ResupplyChar => ({ enabled: false, items: [] });

let store: Store = {};
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normChar(v: unknown): ResupplyChar {
  const o = (v ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items)
    ? o.items
        .map((x): ResupplyItem | null => {
          const i = x as Record<string, unknown>;
          const name = typeof i?.name === 'string' ? i.name : null;
          const min = Number(i?.min);
          return name && min > 0 ? { name, min } : null;
        })
        .filter((x): x is ResupplyItem => !!x)
    : [];
  return { enabled: o.enabled === true, items };
}

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('resupply.json') });
      const p = JSON.parse(txt) as Record<string, unknown>;
      const bc = (p?.byChar ?? p) as Record<string, unknown>;
      const next: Store = {};
      if (bc && typeof bc === 'object' && !Array.isArray(bc)) {
        for (const k in bc) next[k] = normChar(bc[k]);
      }
      store = next;
    } catch { /* none saved */ }
  }
  ready = true;
  store = { ...store };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('resupply.json'), contents: JSON.stringify({ byChar: store }) }); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void save(); }

export function useResupplyStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function setResupplyChar(name: string, r: ResupplyChar) { commit({ ...store, [name]: r }); }

const CURIO = 'Curio Vendor Moogle';

// Pushes each connected character's resupply config (its own item list + the
// shared learned Curio shop categories) to its addon on change or reconnect.
export function useResupplySync() {
  const boxes = useBoxes();
  const s = useResupplyStore();
  const shortcuts = useMenuShortcuts();
  const curioVersion = useCurioVersion();
  // Learned menu shortcuts are the fallback when an item isn't in the Curio
  // catalog; otherwise each item knows its own category option.
  const learnedOpts = useMemo(() => shortcuts.filter((x) => x.npc === CURIO).map((x) => x.option), [shortcuts]);
  const onlineKey = useMemo(() => boxes.filter((b) => b.conn != null).map((b) => `${b.conn}:${b.name}`).sort().join(','), [boxes]);
  const optKey = learnedOpts.join(',');
  useEffect(() => {
    if (!ready) return;
    for (const b of boxes) {
      if (b.conn == null || !b.name) continue;
      const c = s[b.name] ?? emptyResupply();
      const catOpts = curioOptionsFor(b.server, c.items.map((i) => i.name));
      setResupply(b.conn, c.enabled, c.items, catOpts.length ? catOpts : learnedOpts);
    }
  }, [onlineKey, s, optKey, curioVersion]);
}
