import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, setResupply, useBoxes, useKnownCharacters, getKnownCharacters, axEcho } from './bridge';
import { useMenuShortcuts } from './menuShortcuts';
import { useCurioVersion, curioOptionsFor } from './curioCatalog';

export type ResupplyItem = { name: string; min: number };
// A character either keeps its own list (Custom) or is bound to a named profile. When bound,
// its restock uses that profile's items LIVE, so editing the profile updates every character
// on it -- that's the "3 reraisers on everyone" case.
export type ResupplyChar = { enabled: boolean; items: ResupplyItem[]; profile?: string };
type Store = Record<string, ResupplyChar>;
type Profiles = Record<string, ResupplyItem[]>;

export const emptyResupply = (): ResupplyChar => ({ enabled: false, items: [] });

let store: Store = {};
let profiles: Profiles = {};
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normItems(v: unknown): ResupplyItem[] {
  return Array.isArray(v)
    ? v
        .map((x): ResupplyItem | null => {
          const i = x as Record<string, unknown>;
          const name = typeof i?.name === 'string' ? i.name : null;
          const min = Number(i?.min);
          return name && min > 0 ? { name, min } : null;
        })
        .filter((x): x is ResupplyItem => !!x)
    : [];
}

function normChar(v: unknown): ResupplyChar {
  const o = (v ?? {}) as Record<string, unknown>;
  return { enabled: o.enabled === true, items: normItems(o.items), profile: typeof o.profile === 'string' ? o.profile : undefined };
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
      const pf = p?.profiles;
      if (pf && typeof pf === 'object' && !Array.isArray(pf)) {
        const np: Profiles = {};
        for (const k in pf as Record<string, unknown>) np[k] = normItems((pf as Record<string, unknown>)[k]);
        profiles = np;
      }
    } catch { /* none saved */ }
  }
  ready = true;
  store = { ...store };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('resupply.json'), contents: JSON.stringify({ byChar: store, profiles }) }); } catch { /* ignore */ }
}

function commit(next: Store) { store = next; notify(); void save(); }
function commitProfiles(next: Profiles) { profiles = next; notify(); void save(); }

export function useResupplyStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}
export function useProfiles(): Profiles {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => profiles, () => profiles);
}

export function setResupplyChar(name: string, r: ResupplyChar) { commit({ ...store, [name]: r }); }

// A character's effective item list: its bound profile's items (live) when it's on one that
// still exists, otherwise its own custom list.
export function effectiveItems(name: string): ResupplyItem[] {
  const c = store[name];
  if (!c) return [];
  if (c.profile && profiles[c.profile]) return profiles[c.profile];
  return c.items;
}

export function assignProfile(name: string, profile: string | null) {
  const c = store[name] ?? emptyResupply();
  commit({ ...store, [name]: { ...c, profile: profile ?? undefined } });
}

export function setProfileItems(profile: string, items: ResupplyItem[]) {
  commitProfiles({ ...profiles, [profile]: items });
}

// Create a profile (no-op if the name is empty or taken), seeded with the given items.
export function createProfile(name: string, items: ResupplyItem[] = []) {
  const n = name.trim();
  if (!n || profiles[n]) return;
  commitProfiles({ ...profiles, [n]: items.map((i) => ({ ...i })) });
}

export function renameProfile(oldName: string, newName: string) {
  const n = newName.trim();
  if (!n || oldName === n || !profiles[oldName] || profiles[n]) return;
  const next: Profiles = {};
  for (const k in profiles) next[k === oldName ? n : k] = profiles[k];
  profiles = next;
  const s2: Store = { ...store };
  for (const k in s2) if (s2[k].profile === oldName) s2[k] = { ...s2[k], profile: n };
  store = s2;
  notify(); void save();
}

export function deleteProfile(name: string) {
  if (!profiles[name]) return;
  const items = profiles[name];
  const next: Profiles = { ...profiles };
  delete next[name];
  profiles = next;
  // Detach bound characters back to Custom, keeping the profile's items so nothing is lost.
  const s2: Store = { ...store };
  for (const k in s2) if (s2[k].profile === name) s2[k] = { ...s2[k], profile: undefined, items: items.map((i) => ({ ...i })) };
  store = s2;
  notify(); void save();
}

export function profileUsage(name: string): number {
  let n = 0;
  for (const k in store) if (store[k].profile === name) n += 1;
  return n;
}

const CURIO = 'Curio Vendor Moogle';

// Pushes each connected character's EFFECTIVE resupply list (profile items when bound, else
// its own) to its addon on change or reconnect. The profiles map is a dependency, so editing
// a profile re-pushes for every character on it.
export function useResupplySync() {
  const boxes = useBoxes();
  const s = useResupplyStore();
  const pf = useProfiles();
  const shortcuts = useMenuShortcuts();
  const curioVersion = useCurioVersion();
  const learnedOpts = useMemo(() => shortcuts.filter((x) => x.npc === CURIO).map((x) => x.option), [shortcuts]);
  const onlineKey = useMemo(() => boxes.filter((b) => b.conn != null).map((b) => `${b.conn}:${b.name}`).sort().join(','), [boxes]);
  const optKey = learnedOpts.join(',');
  useEffect(() => {
    if (!ready) return;
    for (const b of boxes) {
      if (b.conn == null || !b.name) continue;
      const c = s[b.name] ?? emptyResupply();
      const items = effectiveItems(b.name);
      const catOpts = curioOptionsFor(b.server, items.map((i) => i.name));
      setResupply(b.conn, c.enabled, items, catOpts.length ? catOpts : learnedOpts);
    }
  }, [onlineKey, s, pf, optKey, curioVersion]);
}

export function useResupplyDone() {
  const known = useKnownCharacters();
  const activeConns = useMemo(
    () => known.filter((c) => c.online && c.conn != null && c.resupply?.active).map((c) => c.conn as number),
    [known],
  );
  const activeKey = activeConns.join(',');
  const wasActive = useRef(false);
  const participants = useRef<Set<number>>(new Set());
  const unfinished = useRef<Set<number>>(new Set());
  const timer = useRef<number | null>(null);
  useEffect(() => {
    // As each participant goes idle, record whether it finished: only phase 'done' clears it; 'retry'/'failed'
    // (Alexandria is still auto-retrying that character) leaves it unfinished.
    for (const c of getKnownCharacters()) {
      if (c.conn == null || !participants.current.has(c.conn) || c.resupply?.active) continue;
      if (c.resupply?.phase === 'done') unfinished.current.delete(c.conn);
      else unfinished.current.add(c.conn);
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
        const leftN = unfinished.current.size;
        participants.current = new Set();
        unfinished.current = new Set();
        for (const c of getKnownCharacters()) {
          if (!(c.online && c.conn != null)) continue;
          if (leftN === 0) axEcho(c.conn, `[Alexandria] Curio restock complete on all ${n} character${n === 1 ? '' : 's'}.`);
          else axEcho(c.conn, `[Alexandria] Curio restock: ${n - leftN}/${n} done; still retrying ${leftN}.`);
        }
      }, 6000); // > the addon's 5s retry cooldown, so a self-healing retry re-activates before we summarize
    }
  }, [activeKey]);
}
