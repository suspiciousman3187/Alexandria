import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

// Item classification shared across all your characters. A tag says what an item
// IS ("Consumables", "Omen", "Beastman Seals"); an item can carry many tags.
// Routing rules (tag -> bag) layer on top and reuse the storage-preset
// precedence. One shared file, keyed by item id, so every character sees the same tags.
export type TagDef = { id: string; name: string; color: string };
export type TagStore = { tags: TagDef[]; assign: Record<number, string[]> };

export const TAG_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#a3e635', '#94a3b8'];

let store: TagStore = { tags: [], assign: {} };
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normalize(v: unknown): TagStore {
  const out: TagStore = { tags: [], assign: {} };
  if (!v || typeof v !== 'object') return out;
  const o = v as { tags?: unknown; assign?: unknown };
  if (Array.isArray(o.tags)) {
    for (const t of o.tags as TagDef[]) {
      if (t && typeof t.id === 'string' && typeof t.name === 'string') {
        out.tags.push({ id: t.id, name: t.name, color: typeof t.color === 'string' ? t.color : TAG_COLORS[0] });
      }
    }
  }
  const valid = new Set(out.tags.map((t) => t.id));
  if (o.assign && typeof o.assign === 'object') {
    const a = o.assign as Record<string, unknown>;
    for (const k in a) {
      const id = Number(k);
      if (!Number.isInteger(id)) continue;
      const arr = Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === 'string' && valid.has(x)) : [];
      if (arr.length) out.assign[id] = arr;
    }
  }
  return out;
}

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('item_tags.json') });
    store = normalize(JSON.parse(txt));
  } catch {
    // Fresh install: seed with the bundled starter set (public/default_item_tags.json)
    // so new users open the Tagging view to a useful classification instead of blank.
    try {
      const resp = await fetch('/default_item_tags.json');
      if (resp.ok) { const seeded = normalize(await resp.json()); if (seeded.tags.length) { store = seeded; void save(); } }
    } catch { /* no default bundled */ }
  }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('item_tags.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

function commit(next: TagStore) { store = next; notify(); void save(); }

export function useItemTags(): TagStore {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}
export function getItemTags(): TagStore { return store; }

function newId(): string { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

// Create (or return the existing same-named) tag, auto-picking an unused color.
export function createTag(name: string, color?: string): string {
  const nm = name.trim();
  if (!nm) return '';
  const dup = store.tags.find((t) => t.name.toLowerCase() === nm.toLowerCase());
  if (dup) return dup.id;
  const used = new Set(store.tags.map((t) => t.color));
  const col = color ?? (TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[store.tags.length % TAG_COLORS.length]);
  const id = newId();
  commit({ ...store, tags: [...store.tags, { id, name: nm, color: col }] });
  return id;
}

// Merge an imported tag set into ours: match tags by NAME (case-insensitive) so a friend's "Omen" folds
// into your "Omen", create any tag you don't have (fresh id + unused color), and UNION each item's tags
// (never replace). Returns what was new so the import can report it.
export function mergeTagStore(incoming: TagStore): { tagsAdded: number; itemsChanged: number } {
  const byName = new Map(store.tags.map((t) => [t.name.toLowerCase(), t.id] as const));
  const used = new Set(store.tags.map((t) => t.color));
  const tags = [...store.tags];
  const idMap = new Map<string, string>(); // imported tag id -> our tag id
  let tagsAdded = 0;
  for (const t of incoming.tags) {
    const nm = t.name.trim(); if (!nm) continue;
    const key = nm.toLowerCase();
    let localId = byName.get(key);
    if (!localId) {
      const col = (typeof t.color === 'string' && t.color) || TAG_COLORS.find((c) => !used.has(c)) || TAG_COLORS[tags.length % TAG_COLORS.length];
      used.add(col);
      localId = newId();
      tags.push({ id: localId, name: nm, color: col });
      byName.set(key, localId);
      tagsAdded++;
    }
    idMap.set(t.id, localId);
  }
  const assign: Record<number, string[]> = { ...store.assign };
  let itemsChanged = 0;
  for (const k in incoming.assign) {
    const id = Number(k); if (!Number.isInteger(id)) continue;
    const mapped = incoming.assign[id].map((tid) => idMap.get(tid)).filter((x): x is string => !!x);
    if (!mapped.length) continue;
    const cur = new Set(assign[id] ?? []);
    const before = cur.size;
    for (const tid of mapped) cur.add(tid);
    if (cur.size !== before) { assign[id] = [...cur]; itemsChanged++; }
  }
  commit({ tags, assign });
  return { tagsAdded, itemsChanged };
}

export function renameTag(id: string, name: string) {
  const nm = name.trim(); if (!nm) return;
  commit({ ...store, tags: store.tags.map((t) => (t.id === id ? { ...t, name: nm } : t)) });
}
export function recolorTag(id: string, color: string) {
  commit({ ...store, tags: store.tags.map((t) => (t.id === id ? { ...t, color } : t)) });
}
export function deleteTag(id: string) {
  const assign: Record<number, string[]> = {};
  for (const k in store.assign) { const left = store.assign[k].filter((x) => x !== id); if (left.length) assign[Number(k)] = left; }
  commit({ tags: store.tags.filter((t) => t.id !== id), assign });
}
export function reorderTags(ids: string[]) {
  const byId = new Map(store.tags.map((t) => [t.id, t]));
  const next: TagDef[] = [];
  for (const id of ids) { const t = byId.get(id); if (t) { next.push(t); byId.delete(id); } }
  for (const t of byId.values()) next.push(t);
  commit({ ...store, tags: next });
}

export function setItemTag(itemId: number, tagId: string, on: boolean) {
  const cur = store.assign[itemId] ?? [];
  if (on === cur.includes(tagId)) return;
  const next = on ? [...cur, tagId] : cur.filter((x) => x !== tagId);
  const assign = { ...store.assign };
  if (next.length) assign[itemId] = next; else delete assign[itemId];
  commit({ ...store, assign });
}

// Apply/remove one tag across many items in a single write (Tag All Shown, etc.).
export function bulkSetTag(itemIds: number[], tagId: string, on: boolean) {
  const assign = { ...store.assign };
  let changed = false;
  for (const id of itemIds) {
    const cur = assign[id] ?? [];
    if (on === cur.includes(tagId)) continue;
    const next = on ? [...cur, tagId] : cur.filter((x) => x !== tagId);
    if (next.length) assign[id] = next; else delete assign[id];
    changed = true;
  }
  if (changed) commit({ ...store, assign });
}

export function tagIdsOf(itemId: number): string[] { return store.assign[itemId] ?? []; }
export function itemsWithTag(id: string): number[] {
  const out: number[] = [];
  for (const k in store.assign) if (store.assign[k].includes(id)) out.push(Number(k));
  return out;
}
export function countForTag(id: string): number {
  let n = 0; for (const k in store.assign) if (store.assign[k].includes(id)) n++; return n;
}
