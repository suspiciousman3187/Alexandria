import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, setVendors, useBoxes, useKnownCharacters, getKnownCharacters, axEcho } from './bridge';

// Per-character proximity-vendor config: which cataloged items to keep stocked and to what
// count. Mirrors the Curio resupply store; the addon detects which cataloged vendor is
// nearby and buys the items that vendor sells up to each target.
export type VendorItemCfg = { name: string; min: number };
export type VendorChar = { enabled: boolean; items: VendorItemCfg[] };
type Store = Record<string, VendorChar>;

export const emptyVendor = (): VendorChar => ({ enabled: false, items: [] });

let store: Store = {};
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normChar(v: unknown): VendorChar {
  const o = (v ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items)
    ? o.items
        .map((x): VendorItemCfg | null => {
          const i = x as Record<string, unknown>;
          const name = typeof i?.name === 'string' ? i.name : null;
          const min = Number(i?.min);
          return name && min > 0 ? { name, min } : null;
        })
        .filter((x): x is VendorItemCfg => !!x)
    : [];
  return { enabled: o.enabled === true, items };
}

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('vendors.json') });
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
  try { await invoke('write_text_file', { path: await appDataPath('vendors.json'), contents: JSON.stringify({ byChar: store }) }); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void save(); }

export function useVendorStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function setVendorChar(name: string, r: VendorChar) { commit({ ...store, [name]: r }); }

// Push each connected character's vendor config to its addon on change or reconnect.
export function useVendorSync() {
  const boxes = useBoxes();
  const s = useVendorStore();
  const onlineKey = useMemo(() => boxes.filter((b) => b.conn != null).map((b) => `${b.conn}:${b.name}`).sort().join(','), [boxes]);
  useEffect(() => {
    if (!ready) return;
    for (const b of boxes) {
      if (b.conn == null || !b.name) continue;
      const c = s[b.name] ?? emptyVendor();
      setVendors(b.conn, c.enabled, c.items);
    }
  }, [onlineKey, s]);
}

// Fleet-wide "all done" echo once every character finishes its vendor run, mirroring Curio.
export function useVendorDone() {
  const known = useKnownCharacters();
  const activeConns = useMemo(
    () => known.filter((c) => c.online && c.conn != null && c.pvendor?.active).map((c) => c.conn as number),
    [known],
  );
  const activeKey = activeConns.join(',');
  const wasActive = useRef(false);
  const participants = useRef<Set<number>>(new Set());
  const failed = useRef<Set<number>>(new Set());
  const timer = useRef<number | null>(null);
  useEffect(() => {
    // Record each participant's latest outcome as it goes idle: 'failed' (shop never opened) marks it, a
    // later 'done' (a retry that succeeded) clears the mark. So the summary reflects who actually finished.
    for (const c of getKnownCharacters()) {
      if (c.conn == null || !participants.current.has(c.conn) || c.pvendor?.active) continue;
      if (c.pvendor?.phase === 'failed') failed.current.add(c.conn);
      else if (c.pvendor?.phase === 'done') failed.current.delete(c.conn);
    }
    if (activeConns.length > 0) {
      wasActive.current = true;
      for (const c of activeConns) participants.current.add(c);
      if (timer.current != null) { clearTimeout(timer.current); timer.current = null; }
    } else if (wasActive.current && timer.current == null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (!wasActive.current) return;
        wasActive.current = false;
        const n = participants.current.size;
        const failN = failed.current.size;
        participants.current = new Set();
        failed.current = new Set();
        for (const c of getKnownCharacters()) {
          if (!(c.online && c.conn != null)) continue;
          if (failN === 0) axEcho(c.conn, `[Alexandria] Vendor restock complete on all ${n} character${n === 1 ? '' : 's'}.`);
          else axEcho(c.conn, `[Alexandria] Vendor restock: ${n - failN}/${n} done; ${failN} could not open the shop -- retry at the vendor.`);
        }
      }, 6000); // > the addon's 5s retry cooldown, so a self-healing retry re-activates before we summarize
    }
  }, [activeKey]);
}
