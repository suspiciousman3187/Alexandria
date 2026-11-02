import { useSyncExternalStore } from 'react';
import type { SlotKey } from './slotLayout';
import type { GearEntry } from './gearsetParser';
import type { NameResolver } from './gearsetValidate';
import { AUG_EXTRA_GROUPS } from './augExtraGroups';
import { canonStat, ASSIGN, COLON, DOWN, CUT, COND } from './statCanon';

// Structured gear stats. Base per-item mods come pre-parsed from /item_mods.json (built by
// scripts/build-itemnames.mjs from res/item_descriptions.lua). Augment strings written in a set (or on an
// owned copy) are parsed here client-side with the SAME canon (src/gearset/statCanon.js, shared with the
// build) so planning any piece yields a full numeric breakdown and live swap deltas.
export type StatMods = Record<string, number>;

// Parse free-form gear/augment text ("DEX+20 Accuracy+20 Attack+20", '"Dbl.Atk."+10') into mods.
export function parseMods(text: string): StatMods {
  const out: StatMods = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (COND.test(line)) continue; // skip a conditional line (don't stop; augment lines aren't ordered)
    line = line.replace(/"/g, '').replace(/\s+/g, ' ').trim(); // strip keyword quotes (`"Cure" spellcasting time`)
    const ci = line.search(CUT); if (ci >= 0) line = line.slice(0, ci).trim(); // drop a trailing conditional clause
    let cm: RegExpExecArray | null; COLON.lastIndex = 0;
    while ((cm = COLON.exec(line))) out[cm[1]] = (out[cm[1]] || 0) + Number(cm[2]);
    let am: RegExpExecArray | null; ASSIGN.lastIndex = 0;
    while ((am = ASSIGN.exec(line))) {
      const cn = canonStat(am[2]);
      if (cn) out[cn] = (out[cn] || 0) + Number(am[3] + am[4]);
    }
    let dm: RegExpExecArray | null; DOWN.lastIndex = 0;
    while ((dm = DOWN.exec(line))) {
      const cn = canonStat(dm[1].trim() + ' down');
      if (cn) out[cn] = (out[cn] || 0) - Number(dm[2]);
    }
  }
  return out;
}
export function parseAugMods(augs?: string[]): StatMods {
  if (!augs || !augs.length) return {};
  return parseMods(augs.join('\n'));
}

// ----- display schema -----
// style: 'attr' = compact 2-col grid (always shows every key), 'bar' = full-width labelled rows (nonzero only).
// Four sections only: Attributes, Offense, Defense, Other (Other = haste/TP/multi-attack/crit/misc, folded).
export type StatGroup = { title: string; keys: string[]; style: 'attr' | 'bar'; color?: string };
// Curated keys first (the common combat view), then every other aug-DB stat appended from the generated
// buckets so all 170 tracked stats are categorized + pickable. Pet and Skills are whole groups of their own.
export const STAT_GROUPS: StatGroup[] = [
  { title: 'Attributes', style: 'attr', keys: ['STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR', 'HP', 'MP'] },
  {
    title: 'Offensive Stats', style: 'bar', color: 'scar', keys: [
      'Accuracy', 'Attack', 'Ranged Accuracy', 'Ranged Attack', 'Magic Accuracy', 'Magic Atk. Bonus', 'Magic Damage', 'Weapon skill damage',
      'Weapon Skill Accuracy', 'Double Attack', 'Triple Attack', 'Quad Attack', 'Critical hit rate', 'Critical hit damage',
      'Magic Critical hit rate', 'Magic burst damage', 'Magic burst damage II', 'Physical damage limit',
      ...AUG_EXTRA_GROUPS.Offense,
    ],
  },
  {
    title: 'Defensive Stats', style: 'bar', color: 'gold', keys: [
      'DEF', 'Evasion', 'Magic Evasion', 'Magic Def. Bonus', 'Damage taken', 'Physical damage taken', 'True Phys. Dmg Taken',
      'Physical damage taken II', 'Magic damage taken', 'True Mag. Dmg Taken', 'Breath Damage taken', 'Resistance to all status ailments',
      ...AUG_EXTRA_GROUPS.Defense,
    ],
  },
  { title: 'Pet', style: 'bar', color: 'pet', keys: [...AUG_EXTRA_GROUPS.Pet] },
  { title: 'Skills', style: 'bar', color: 'skill', keys: ['All magic skills', 'All skills', 'All combat skills', ...AUG_EXTRA_GROUPS.Skills] },
  // Catch-all: these explicit keys first, then the appended bucket, then any remaining recognized stat the set carries (CLAIMED).
  {
    title: 'Utility Stats & Other', style: 'bar', color: 'teal', keys: [
      'Haste', 'Dual Wield', 'Store TP', 'Save TP', 'Fast Cast', 'Subtle Blow', 'Subtle Blow II',
      'Treasure Hunter', 'Cure Potency', 'Refresh', 'Regen', 'Regain', 'Enmity', 'Movement speed',
      ...AUG_EXTRA_GROUPS.Other,
    ],
  },
];
export const WEAPON_KEYS = ['DMG', 'Delay'];

// Short display labels for the panel (canonical key otherwise).
const STAT_LABEL: Record<string, string> = {
  Haste: 'Gear Haste', 'Weapon skill damage': 'Weapon Skill Dmg', 'Magic Accuracy': 'Magic Accuracy',
  'Critical hit rate': 'Crit Hit Rate', 'Critical hit damage': 'Crit Hit Dmg', 'Magic Critical hit rate': 'Mag. Crit Rate',
  'Physical damage taken': 'Phys. Dmg Taken', 'Magic damage taken': 'Mag. Dmg Taken', 'Damage taken': 'Dmg Taken',
  'Physical damage limit': 'Phys. Dmg Limit', 'Magic Atk. Bonus': 'Magic Atk. Bonus', 'Magic Def. Bonus': 'Magic Def. Bonus',
  'Subtle Blow II': 'Subtle Blow II', 'Ranged Accuracy': 'Ranged Acc.', 'Ranged Attack': 'Ranged Atk.',
  'Weapon Skill Accuracy': 'WS Accuracy', 'Magic burst damage': 'Mag. Burst Dmg', 'Magic burst damage II': 'Mag. Burst Dmg II',
  'Physical damage taken II': 'Phys. Dmg Taken II', 'Breath Damage taken': 'Breath Dmg Taken', 'Resistance to all status ailments': 'Resist Ailments',
  'True Phys. Dmg Taken': 'True Phys. Dmg Taken', 'True Mag. Dmg Taken': 'True Mag. Dmg Taken',
};
export function statLabel(k: string): string { return STAT_LABEL[k] ?? k; }
// Stats shown as a percentage.
export const PCT = new Set(['Haste', 'Dual Wield', 'Double Attack', 'Triple Attack', 'Quad Attack', 'Critical hit rate', 'Critical hit damage',
  'Damage taken', 'Physical damage taken', 'Physical damage taken II', 'Magic damage taken', 'Physical damage limit', 'Weapon skill damage',
  'Fast Cast', 'Magic Critical hit rate', 'Movement speed', 'Cure Potency', 'Breath Damage taken', 'True Phys. Dmg Taken', 'True Mag. Dmg Taken',
  'Spell interruption rate down', 'Cure Potency II', 'Magic damage taken II', 'Regen Potency', 'Cure effect received', 'Song effect duration', 'Waltz Potency']);
// Stats where a lower (more negative) value is the improvement.
export const NEG = new Set(['Damage taken', 'Physical damage taken', 'Physical damage taken II', 'Magic damage taken', 'Breath Damage taken',
  'True Phys. Dmg Taken', 'True Mag. Dmg Taken',
  'Synergy Damage taken', 'Avatar perpetuation cost', 'Elemental magic casting time', 'Spellcasting time', 'Cure Spellcasting Time', 'Song spellcasting time',
  'Ability delay', 'Song recast delay', 'Spell interruption rate down', 'Magic damage taken II',
  'Healing magic casting time', 'Healing magic recast delay', 'Elemental magic recast delay', 'Blood Pact ability delay']);
// Rough bar ceilings for the gear-contribution bars (gearset totals, not character totals).
export const BARMAX: Record<string, number> = {
  STR: 150, DEX: 130, VIT: 140, AGI: 90, INT: 90, MND: 90, CHR: 80, HP: 800, MP: 600,
  Accuracy: 350, Attack: 450, 'Ranged Accuracy': 350, 'Ranged Attack': 450, 'Magic Accuracy': 250, 'Magic Atk. Bonus': 120, 'Magic Damage': 200, 'Weapon skill damage': 50,
  Haste: 26, 'Dual Wield': 35, 'Store TP': 80, 'Save TP': 100, 'Fast Cast': 80, 'Subtle Blow': 50, 'Subtle Blow II': 50,
  DEF: 1800, Evasion: 900, 'Magic Evasion': 900, 'Magic Def. Bonus': 60, 'Damage taken': 50, 'Physical damage taken': 50, 'Magic damage taken': 50, 'Physical damage limit': 20,
  'Double Attack': 40, 'Triple Attack': 20, 'Quad Attack': 15, 'Critical hit rate': 30, 'Critical hit damage': 30, 'Magic Critical hit rate': 20,
  'Weapon Skill Accuracy': 60, 'Treasure Hunter': 12, 'Cure Potency': 50, Refresh: 15, Regen: 25, Regain: 50, Enmity: 60, 'Movement speed': 25,
  'Magic burst damage': 25, 'Magic burst damage II': 25, 'Physical damage taken II': 30, 'Breath Damage taken': 30, 'Resistance to all status ailments': 40,
  'True Phys. Dmg Taken': 60, 'True Mag. Dmg Taken': 60,
};

// Derived display stats: gear "Damage taken" (DT) applies on top of the type-specific reductions, so the true
// damage taken is DT + PDT (physical) and DT + MDT (magical). Added to the totals for display only.
export function withTrueDamageTaken(m: StatMods): StatMods {
  const dt = m['Damage taken'], pdt = m['Physical damage taken'], mdt = m['Magic damage taken'];
  const out = { ...m };
  if (dt != null || pdt != null) out['True Phys. Dmg Taken'] = (pdt ?? 0) + (dt ?? 0);
  if (dt != null || mdt != null) out['True Mag. Dmg Taken'] = (mdt ?? 0) + (dt ?? 0);
  return out;
}
export function isPct(k: string): boolean { return PCT.has(k); }
export function fmtStat(k: string, v: number): string {
  const unit = isPct(k) ? '%' : '';
  const abs = ['DEF', 'DMG', 'Delay', 'HP', 'MP', 'Evasion', 'Magic Evasion'];
  const sign = v > 0 && !abs.includes(k) ? '+' : '';
  return `${sign}${v}${unit}`;
}
// Delta polarity for colouring (+1 good up, -1 good down).
export function isGood(k: string, delta: number): boolean { return NEG.has(k) ? delta < 0 : delta > 0; }

// Gear-contribution caps. Returns the cap value for a stat (and whether a value has reached/exceeded it) so a
// panel can show "value / cap" + a CAPPED/OVER chip. Handles positive caps, negative-good caps, magnitude caps,
// Enmity's two-sided cap, and job-aware Treasure Hunter. atCap = exactly on it (green); over = past it (red).
export function capInfo(k: string, c: number, job: string): { cap: number; atCap: boolean; over: boolean } | null {
  const pos = (cap: number) => ({ cap, atCap: c === cap, over: c > cap });
  const neg = (cap: number) => ({ cap, atCap: c === cap, over: c < cap });
  const POS: Record<string, number> = {
    Haste: 25, 'Fast Cast': 80, 'Subtle Blow': 50, 'Subtle Blow II': 50, 'Skillchain Bonus': 50,
    'Cure Potency': 50, 'Cure Potency II': 30, 'Cure effect received': 30, 'Waltz Potency': 50,
  };
  if (k in POS) return pos(POS[k]);
  if (k === 'Treasure Hunter') return pos(job.toUpperCase() === 'THF' ? 8 : 4);
  const NEG_CAP: Record<string, number> = {
    'Damage taken': -50, 'Physical damage taken': -50, 'Magic damage taken': -50,
    'True Phys. Dmg Taken': -50, 'True Mag. Dmg Taken': -50, 'Luopan: Damage Taken': -38,
  };
  if (k in NEG_CAP) return neg(NEG_CAP[k]);
  if (k === 'Spell interruption rate down') return { cap: -102, atCap: Math.abs(c) === 102, over: Math.abs(c) > 102 };
  if (k === 'Enmity') return c >= 0 ? pos(200) : neg(-50);
  return null;
}

// ----- item mods store (/item_mods.json) + system-4 augment DB (/aug_db.json, /aug_hidden.json) -----
// item_mods = visible description stats. aug_db = path/rank augment stats that the game never sends on the
// wire (JSE necks like Bard's Charm +2, Oseem/Odyssey path gear, REM/Prime), keyed id -> rank -> path.
// aug_hidden = flat per-item hidden stats (Brutal DA+5, Fotia fTP, ...). Built by scripts/build-augdb.mjs.
let modsById = new Map<number, StatMods>();
let augDb: Record<string, Record<string, Record<string, StatMods>>> = {};
let augHidden: Record<string, StatMods> = {};
let modsStarted = false;
const subs = new Set<() => void>();
async function loadMods() {
  if (modsStarted) return;
  modsStarted = true;
  try {
    const resp = await fetch('/item_mods.json');
    if (resp.ok) {
      const p = await resp.json() as Record<string, StatMods>;
      const m = new Map<number, StatMods>();
      for (const k in p) m.set(Number(k), p[k]);
      modsById = m;
    }
  } catch { /* not built */ }
  try { const r = await fetch('/aug_db.json'); if (r.ok) augDb = await r.json(); } catch { /* not built */ }
  try { const r = await fetch('/aug_hidden.json'); if (r.ok) augHidden = await r.json(); } catch { /* not built */ }
  // Merge the aug DB's own %/polarity metadata so every tracked stat formats correctly (built from GearInfo's stat_dict).
  try {
    const r = await fetch('/aug_meta.json');
    if (r.ok) { const meta = await r.json() as { pct?: string[]; neg?: string[] }; for (const k of meta.pct ?? []) PCT.add(k); for (const k of meta.neg ?? []) NEG.add(k); }
  } catch { /* not built */ }
  modsById = new Map(modsById); // new identity so stat memos keyed on the store recompute now the aug DB is in
  subs.forEach((s) => s());
}

// Resolve the system-4 augment stats for a piece from aug_db, using the rank + path carried in its augment
// text ("Path: A", "(R25)", "Rank 25"). Path defaults to A; rank defaults to the entry's max (a fully
// upgraded "+2" neck). Returns null when the item has no aug_db entry (so normal text parsing applies).
function augDbMods(id: number | undefined, augs?: string[]): StatMods | null {
  if (!id) return null;
  const byRank = augDb[String(id)];
  if (!byRank) return null;
  const text = (augs ?? []).join(' ');
  const rm = /(?:rank|\(r)\D*?(\d+)/i.exec(text);
  const pm = /(?:path|type)\D*?([a-d])/i.exec(text);
  let rank = rm ? Number(rm[1]) : NaN;
  const path = pm ? pm[1].toUpperCase() : 'A';
  if (!Number.isFinite(rank) || !byRank[String(rank)]) {
    rank = Math.max(...Object.keys(byRank).map(Number));
  }
  const byPath = byRank[String(rank)];
  if (!byPath) return null;
  return byPath[path] ?? byPath['A'] ?? null;
}
export function getItemMods(id: number): StatMods | undefined { return modsById.get(id); }
// Every distinct stat key present across the item_mods catalog (the numeric, sortable stats). Cached, and
// rebuilt once the catalog finishes loading (modsById is empty until then). Used to decide whether a chosen
// stat has real numeric values (so it can be sorted / precisely filtered) vs. a description-only named effect.
let statKeyCache: Set<string> | null = null;
let statKeyCacheSize = 0;
export function itemModStatKeys(): Set<string> {
  if (statKeyCache && modsById.size === statKeyCacheSize) return statKeyCache;
  const s = new Set<string>();
  modsById.forEach((m) => { for (const k in m) s.add(k); });
  statKeyCache = s; statKeyCacheSize = modsById.size;
  return s;
}
export function useItemMods(): Map<number, StatMods> {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => modsById, () => modsById);
  if (!modsStarted) void loadMods();
  return modsById;
}

// ----- aggregation -----
export type SlotResolve = { entry: GearEntry };
// Sum base item mods + the set's declared augments across every defined slot. `resolve` maps a name to its id.
export function aggregateSet(slots: Partial<Record<SlotKey, SlotResolve>>, resolve: NameResolver): StatMods {
  const total: StatMods = {};
  for (const key of Object.keys(slots) as SlotKey[]) {
    const g = slots[key]?.entry;
    if (!g || g.kind !== 'item') continue;
    const id = resolve(g.name)?.id;
    const base = id ? modsById.get(id) : undefined;
    if (base) for (const k in base) total[k] = (total[k] || 0) + base[k];
    const hidden = id ? augHidden[String(id)] : undefined;
    if (hidden) for (const k in hidden) total[k] = (total[k] || 0) + hidden[k];
    const aug = augDbMods(id, g.augments) ?? parseAugMods(g.augments);
    for (const k in aug) total[k] = (total[k] || 0) + aug[k];
  }
  return total;
}
// Mods a single piece (id + optional augments) contributes, for swap previews.
export function pieceMods(id: number | undefined, augs?: string[]): StatMods {
  const out: StatMods = {};
  const base = id ? modsById.get(id) : undefined;
  if (base) for (const k in base) out[k] = (out[k] || 0) + base[k];
  const hidden = id ? augHidden[String(id)] : undefined;
  if (hidden) for (const k in hidden) out[k] = (out[k] || 0) + hidden[k];
  const aug = augDbMods(id, augs) ?? parseAugMods(augs);
  for (const k in aug) out[k] = (out[k] || 0) + aug[k];
  return out;
}
// The AUGMENT-only stats a piece contributes: the system-4 path/rank block from aug_db (resolved from the
// copy's "Path:/Rank" text, else the max rank) plus any flat hidden stats. Excludes the base item_mods, which
// the card already shows from the description text. Empty when the item has no aug_db / hidden entry.
export function augStats(id: number | undefined, augs?: string[]): StatMods {
  const out: StatMods = {};
  const hidden = id ? augHidden[String(id)] : undefined;
  if (hidden) for (const k in hidden) out[k] = (out[k] || 0) + hidden[k];
  const db = augDbMods(id, augs);
  if (db) for (const k in db) out[k] = (out[k] || 0) + db[k];
  return out;
}
export function diffMods(base: StatMods, remove: StatMods, add: StatMods): StatMods {
  const out: StatMods = { ...base };
  for (const k in remove) out[k] = (out[k] || 0) - remove[k];
  for (const k in add) out[k] = (out[k] || 0) + add[k];
  for (const k in out) if (out[k] === 0) delete out[k];
  return out;
}
