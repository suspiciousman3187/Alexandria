import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri, type KnownChar } from './bridge';
import { layoutFor, ALL_PLAYERS_KEY, type LayoutEntry } from './storagePrefs';
import { getItemTags } from './itemTags';
import { TEMPORARY_BAG } from './bagConstants';

// Where a TAG goes: tag id -> bag priority order. Scoped like storage presets
// ('*' = All-Players default, a character name overrides it).
export type TagRule = { tag: string; bags: number[] };
type Store = Record<string, TagRule[]>;

let store: Store = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function normEntries(v: unknown): TagRule[] {
  if (!Array.isArray(v)) return [];
  const out: TagRule[] = [];
  for (const e of v) {
    const tag = typeof (e as TagRule)?.tag === 'string' ? (e as TagRule).tag : '';
    const bagsRaw = (e as TagRule)?.bags;
    const bags = Array.isArray(bagsRaw) ? bagsRaw.map((b) => Number(b)).filter((b) => Number.isInteger(b)) : [];
    if (tag && bags.length) out.push({ tag, bags });
  }
  return out;
}

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('tag_rules.json') });
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
  try { await invoke('write_text_file', { path: await appDataPath('tag_rules.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useTagRules(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}
export function getTagRules(): Store { return store; }

export function setTagRules(name: string, entries: TagRule[]) {
  const clean = entries.filter((e) => e.tag && e.bags.length);
  const s = { ...store };
  if (clean.length) s[name] = clean; else delete s[name];
  store = s;
  notify();
  void save();
}

// A character's effective tag rules: its own layered over the All-Players
// defaults (a character-specific rule for a tag wins).
export function tagRulesFor(name: string): TagRule[] {
  if (name === ALL_PLAYERS_KEY) return store[ALL_PLAYERS_KEY] ?? [];
  const shared = store[ALL_PLAYERS_KEY] ?? [];
  const own = store[name] ?? [];
  if (!shared.length) return own;
  if (!own.length) return shared;
  const ownTags = new Set(own.map((e) => e.tag));
  const merged = own.slice();
  for (const e of shared) if (!ownTags.has(e.tag)) merged.push(e);
  return merged;
}

// The full item->bags layout Organize should use for a character: explicit item
// presets (All-Players + char, char wins) PLUS tag rules expanded to the items
// this character actually holds. Precedence: an explicit item preset always beats
// any tag rule; among an item's tags, the highest-priority tag (earliest in the
// tag list) that has a rule wins.
export function resolveLayout(char: KnownChar | undefined): LayoutEntry[] {
  if (!char) return [];
  const explicit = layoutFor(char.name);
  const rules = tagRulesFor(char.name);
  if (!rules.length) return explicit;
  const { tags, assign } = getItemTags();
  const rank = new Map(tags.map((t, i) => [t.id, i])); // lower index = higher priority
  const ruleByTag = new Map(rules.map((r) => [r.tag, r.bags]));
  const explicitNames = new Set(explicit.map((e) => e.item.toLowerCase()));
  const out = explicit.slice();
  const seen = new Set<string>();
  for (const bag of char.inv ?? []) {
    if (bag.id === TEMPORARY_BAG) continue; // temp items can't be moved -- never route them
    for (const it of bag.items) {
      const key = it.n.toLowerCase();
      if (explicitNames.has(key) || seen.has(key)) continue;
      const tagIds = assign[it.id];
      if (!tagIds || !tagIds.length) continue;
      let best: string | null = null;
      let bestRank = Infinity;
      for (const tid of tagIds) {
        if (!ruleByTag.has(tid)) continue;
        const r = rank.get(tid) ?? Infinity;
        if (r < bestRank) { bestRank = r; best = tid; }
      }
      if (best) { out.push({ item: it.n, bags: (ruleByTag.get(best) ?? []).slice() }); seen.add(key); }
    }
  }
  return out;
}
