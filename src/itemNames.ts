import { useSyncExternalStore } from 'react';

export type ItemName = { id: number; n: string; st: number; l?: string; sl?: number; jb?: number; lv?: number };

let list: ItemName[] = [];
let fullById = new Map<number, string>();
let stackById = new Map<number, number>();
let slotById = new Map<number, number>();
let jobById = new Map<number, number>();
let levelById = new Map<number, number>();
let started = false;
const subs = new Set<() => void>();

// Gear stat index (id -> lowercased description text). Loaded lazily on the first item search so it costs
// nothing until someone actually searches. Lets the search match by stat ("fast cast", "dex+10") not just name.
let descById = new Map<number, string>();
let descStarted = false;
async function loadDescs() {
  if (descStarted) return;
  descStarted = true;
  try {
    const resp = await fetch('/item_stats.json');
    if (resp.ok) {
      const p = await resp.json();
      const m = new Map<number, string>();
      for (const k in p) m.set(Number(k), p[k]);
      descById = m;
    }
  } catch { /* not bundled (dev without build:itemnames) */ }
  subs.forEach((s) => s());
}

async function load() {
  if (started) return;
  started = true;
  try {
    const resp = await fetch('/item_names.json');
    if (resp.ok) {
      const p = await resp.json();
      if (Array.isArray(p)) {
        list = p;
        fullById = new Map();
        stackById = new Map();
        slotById = new Map();
        jobById = new Map();
        levelById = new Map();
        for (const it of list) {
          if (it.l) fullById.set(it.id, it.l.toLowerCase());
          if (it.st > 1) stackById.set(it.id, it.st);
          if (it.sl) slotById.set(it.id, it.sl);
          if (it.jb) jobById.set(it.id, it.jb);
          if (it.lv) levelById.set(it.id, it.lv);
        }
      }
    }
  } catch { /* not bundled (dev without build:itemnames) */ }
  subs.forEach((s) => s());
}

export function itemStack(id: number): number {
  return stackById.get(id) ?? 1;
}

// Job codes in jobId order (WAR = jobId 1 .. RUN = 22), matching the `jobs` bitmask bit = 1<<jobId.
const JOB_NAMES = ['WAR', 'MNK', 'WHM', 'BLM', 'RDM', 'THF', 'PLD', 'DRK', 'BST', 'BRD', 'RNG', 'SAM', 'NIN', 'DRG', 'SMN', 'BLU', 'COR', 'PUP', 'DNC', 'SCH', 'GEO', 'RUN'];
// Decode which jobs can equip an item. Returns null for items with no job data (consumables, key items, etc.).
export function itemJobs(id: number): { jobs: string[]; all: boolean; level?: number } | null {
  const jb = jobById.get(id);
  if (!jb) return null;
  const jobs: string[] = [];
  for (let i = 0; i < JOB_NAMES.length; i++) if (jb & (1 << (i + 1))) jobs.push(JOB_NAMES[i]);
  return { jobs, all: jobs.length >= JOB_NAMES.length, level: levelById.get(id) };
}

const JOB_BIT: Record<string, number> = Object.fromEntries(JOB_NAMES.map((c, i) => [c, 1 << (i + 1)]));
export const JOB_LIST: readonly string[] = JOB_NAMES;
// True if the given job can equip the item. Only equippable gear carries a job bitmask, so consumables/etc.
// are never matched. An item with no job data (jb undefined) returns false.
export function jobEquips(id: number, job: string): boolean {
  const jb = jobById.get(id);
  if (!jb) return false;
  const bit = JOB_BIT[job.toUpperCase()];
  return !!bit && (jb & bit) !== 0;
}

// The full (un-abbreviated) name for an item, lowercased -- FFXI truncates long names in-game (the `n`
// shown name), so a search by the full name only matches via this. Undefined when there's no long form.
export function itemFullName(id: number): string | undefined {
  return fullById.get(id);
}

export type ItemCategory = 'main' | 'sub' | 'ranged' | 'ammo' | 'head' | 'body' | 'hands' | 'legs' | 'feet' | 'neck' | 'waist' | 'ears' | 'rings' | 'back' | 'other';

const SLOT_BITS: { cat: ItemCategory; bit: number }[] = [
  { cat: 'main', bit: 0x0001 }, { cat: 'sub', bit: 0x0002 }, { cat: 'ranged', bit: 0x0004 }, { cat: 'ammo', bit: 0x0008 },
  { cat: 'head', bit: 0x0010 }, { cat: 'body', bit: 0x0020 }, { cat: 'hands', bit: 0x0040 }, { cat: 'legs', bit: 0x0080 },
  { cat: 'feet', bit: 0x0100 }, { cat: 'neck', bit: 0x0200 }, { cat: 'waist', bit: 0x0400 }, { cat: 'ears', bit: 0x1800 },
  { cat: 'rings', bit: 0x6000 }, { cat: 'back', bit: 0x8000 },
];

export const ITEM_CATEGORIES: { id: ItemCategory; label: string }[] = [
  { id: 'main', label: 'Weapons' }, { id: 'sub', label: 'Grips/Shields' }, { id: 'ranged', label: 'Ranged' }, { id: 'ammo', label: 'Ammo' },
  { id: 'head', label: 'Head' }, { id: 'body', label: 'Body' }, { id: 'hands', label: 'Hands' }, { id: 'legs', label: 'Legs' },
  { id: 'feet', label: 'Feet' }, { id: 'neck', label: 'Neck' }, { id: 'waist', label: 'Waist' }, { id: 'ears', label: 'Ears' },
  { id: 'rings', label: 'Rings' }, { id: 'back', label: 'Back' }, { id: 'other', label: 'Other' },
];

export function itemCategory(id: number): ItemCategory {
  const sl = slotById.get(id);
  if (!sl) return 'other';
  for (const s of SLOT_BITS) if (sl & s.bit) return s.cat;
  return 'other';
}

const CAT_RANK = new Map<ItemCategory, number>(ITEM_CATEGORIES.map((c, i) => [c.id, i]));
export function itemCategoryRank(id: number): number {
  return CAT_RANK.get(itemCategory(id)) ?? 999;
}

// Split a search-box query into OR-terms on the common delimiters `|` and `,`, so one box can hunt several
// items at once ("orcfeltrap | shinj" matches either). Each term is trimmed + lowercased; blanks dropped.
// A query with no delimiter yields a single term = the old single-substring behavior.
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const raw of query.split(/[|,]/)) {
    const t = raw.trim().toLowerCase();
    if (t) terms.push(t);
  }
  return terms;
}

// True if `text` contains ANY of the query's OR-terms (see searchTerms). For the plain name-only filters
// that used `text.toLowerCase().includes(q)` -- gives them the same multi-item search. Blank query -> false
// (callers already skip filtering when the box is empty).
export function nameMatches(text: string, query: string): boolean {
  const lc = text.toLowerCase();
  for (const t of searchTerms(query)) if (lc.includes(t)) return true;
  return false;
}

export function itemNameMatches(id: number, shownName: string, lcQuery: string): boolean {
  const terms = searchTerms(lcQuery);
  if (terms.length === 0) return false;
  if (!descStarted) void loadDescs();          // pull the gear-stat index on the first search
  const shown = shownName.toLowerCase();
  const full = fullById.get(id);
  const desc = descById.get(id);               // lowercased gear stats/description (equippable gear only)
  for (const t of terms) {
    if (shown.includes(t)) return true;
    if (full != null && full.includes(t)) return true;
    if (desc != null && desc.includes(t)) return true;
  }
  return false;
}

// Named-effect catalog (item_stat_options.json) that backs the Library "Stat" filter combobox. Lazy-loaded
// the first time the filter renders; also pulls the per-item stat text so the filter can match.
let statOptions: string[] = [];
let optsStarted = false;
async function loadStatOptions() {
  if (optsStarted) return;
  optsStarted = true;
  void loadDescs();
  try {
    const resp = await fetch('/item_stat_options.json');
    if (resp.ok) { const p = await resp.json(); if (Array.isArray(p)) statOptions = p; }
  } catch { /* not built */ }
  subs.forEach((s) => s());
}

export function useStatOptions(): string[] {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => statOptions, () => statOptions);
  if (!optsStarted) void loadStatOptions();
  return statOptions;
}

// True if this item's gear description contains the given (already-lowercased) stat text.
export function itemHasStat(id: number, statLower: string): boolean {
  if (!descStarted) void loadDescs();
  const d = descById.get(id);
  return d != null && d.includes(statLower);
}
void load();

export function useItemNames(): ItemName[] {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
  return list;
}

export function getItemNames(): ItemName[] { return list; }

export function resolveItemName(name: string): ItemName | null {
  const lc = name.trim().toLowerCase();
  if (!lc) return null;
  let partial: ItemName | null = null;
  for (const it of list) {
    const n = it.n.toLowerCase();
    const l = it.l?.toLowerCase();               // full (un-abbreviated) name, if any
    if (n === lc || l === lc) return it;
    if (!partial && (n.includes(lc) || (l != null && l.includes(lc)))) partial = it;
  }
  return partial;
}
