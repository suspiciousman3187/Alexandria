import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { appDataPath, inTauri, useKnownCharacters, type KnownChar } from './bridge';

export type FindEntry = { loc: string; id: number; n: string; c: number };
type CachedChar = { at: number; entries: FindEntry[] };

let cache: Record<string, CachedChar> = {};
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('find_cache.json') });
    const p = JSON.parse(txt);
    if (p && typeof p === 'object' && !Array.isArray(p)) cache = p as Record<string, CachedChar>;
  } catch {}
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('find_cache.json'), contents: JSON.stringify(cache) }); } catch {}
}

export function findEntriesFor(c: KnownChar): FindEntry[] {
  const out: FindEntry[] = [];
  for (const b of c.inv ?? []) for (const it of b.items) out.push({ loc: b.b, id: it.id, n: it.n, c: it.c });
  for (const sp of c.slips ?? []) for (const it of sp.stored) out.push({ loc: sp.name, id: it.id, n: it.n, c: 1 });
  for (const ki of c.keyItems ?? []) out.push({ loc: 'key items', id: 0, n: ki.n, c: 1 });
  return out;
}

export function getFindCache(): Record<string, FindEntry[]> {
  const out: Record<string, FindEntry[]> = {};
  for (const [name, v] of Object.entries(cache)) out[name] = v.entries;
  return out;
}

export function useFindCacheSync() {
  const known = useKnownCharacters();
  const lastSnap = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastSnap.current < 15000) return;
    let changed = false;
    for (const c of known) {
      if (!c.online || c.conn == null) continue;
      if (!(c.inv?.length || c.slips?.length || c.keyItems?.length)) continue;
      cache[c.name] = { at: now, entries: findEntriesFor(c) };
      changed = true;
    }
    if (changed) { lastSnap.current = now; void save(); }
  }, [known]);
}
