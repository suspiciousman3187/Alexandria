import { useSyncExternalStore } from 'react';
import { inTauri, type InvBag } from './bridge';
import { MOG_ONLY_BAGS } from './bagConstants';

// The recipe DB is generated from the bg-wiki reforge tables (see scratchpad/parse_all.js) and shipped
// as public/reforge.json. Shape: type -> job -> { slots: { slot -> { steps: [...] } } }.
export type ReforgeRef = { id: number | null; name: string };
// currency:true marks a tracked-currency requirement (e.g. Gallimaufry) rather than an inventory item.
export type ReforgeIngredient = { id: number | null; name: string; qty: number; currency?: boolean };
// A multi-day reforge (e.g. Coelestrox Artifact +2->+3) splits into `parts`, each a separate trade on a
// separate Vana'diel day. `ingredients` stays the full combined requirement for gating/display.
export type ReforgePart = { day?: number; ingredients: ReforgeIngredient[]; currency?: { name: string; qty: number }[] };
export type ReforgePath = { label: string; input: ReforgeRef; ingredients: ReforgeIngredient[]; parts?: ReforgePart[] };
export type ReforgeStep = { from: string; to: string; npc?: string; output: ReforgeRef; paths: ReforgePath[] };
export type ReforgeCurrency = { gil?: number; list?: { n: string; v: number }[] };
export type ReforgeSlotData = { slot: string; steps: ReforgeStep[] };
export type ReforgeJobData = { job: string; slots: Record<string, ReforgeSlotData> };
export type ReforgeDB = Record<string, Record<string, ReforgeJobData>>;

export const ARMOR_TYPES = ['artifact', 'empyrean', 'relic'] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];
export const ARMOR_LABEL: Record<ArmorType, string> = { artifact: 'Artifact', empyrean: 'Empyrean', relic: 'Relic' };
export const SLOT_ORDER = ['head', 'body', 'hands', 'legs', 'feet'] as const;

// Vana'diel time is a pure function of Earth time: 1 Earth sec = 25 Vana sec, so a Vana day is
// 86400/25 = 3456 real seconds. Epoch 1009810800 (2002-12-31 15:00 GMT) is Vana'diel midnight, the
// same base every clock addon uses. A reforge finishes at the next Vana midnight, so realToMidnight
// is the max real wait for a piece traded right now.
export const VANA_DAY_REAL = 3456;
const VANA_EPOCH = 1009810800;
export type VanaClock = { h: number; m: number; s: number; realToMidnight: number };
// Heat color for a "ready in" countdown: green when the piece is nearly done, warming to red the
// longer the wait. (Opposite polarity to the Time-To-Next-Day readout, which heats as midnight nears.)
export function heatColor(secLeft: number, max = 3600): string {
  const frac = Math.max(0, Math.min(1, secLeft / max));
  return `hsl(${Math.round(130 * (1 - frac))}, 70%, 60%)`;
}

export function vanaState(nowMs: number = Date.now()): VanaClock {
  const now = Math.floor(nowMs / 1000);
  const realIntoDay = (((now - VANA_EPOCH) % VANA_DAY_REAL) + VANA_DAY_REAL) % VANA_DAY_REAL;
  const vanaSec = realIntoDay * 25;
  return {
    h: Math.floor(vanaSec / 3600),
    m: Math.floor((vanaSec % 3600) / 60),
    s: Math.floor(vanaSec % 60),
    realToMidnight: VANA_DAY_REAL - realIntoDay,
  };
}

let db: ReforgeDB = {};
let started = false;
const subs = new Set<() => void>();

async function load() {
  if (started) return;
  started = true;
  try {
    const r = await fetch('/reforge.json');
    if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') { db = j; subs.forEach((f) => f()); } }
  } catch { /* ships with the app; ignore */ }
}
if (inTauri || typeof window !== 'undefined') void load();

export function useReforgeDB(): ReforgeDB {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => db, () => db);
}

// Count an item across the bags reachable while standing at Monisette -- inventory, the carry bags
// (satchel/sack/case) and wardrobes -- but NOT Mog storage, which needs a moogle. Returns the total
// plus how many are already in inventory (bag 0), so the UI and engine know what must be pulled.
export function reforgeCount(inv: InvBag[] | undefined, id: number | null): { have: number; inInv: number } {
  if (id == null || !inv) return { have: 0, inInv: 0 };
  let have = 0, inInv = 0;
  for (const bag of inv) {
    if (MOG_ONLY_BAGS.has(bag.id)) continue;
    let c = 0;
    for (const it of bag.items) if (it.id === id) c += it.c;
    have += c;
    if (bag.id === 0) inInv += c;
  }
  return { have, inInv };
}

// Display name of the first reachable bag holding this item (for "Acquired · <bag>" on unique pieces).
export function reforgeBagOf(inv: InvBag[] | undefined, id: number | null): string | null {
  if (id == null || !inv) return null;
  for (const bag of inv) {
    if (MOG_ONLY_BAGS.has(bag.id)) continue;
    for (const it of bag.items) if (it.id === id) return bag.b;
  }
  return null;
}

export type IngredientNeed = { id: number | null; name: string; have: number; inInv: number; need: number; currency?: boolean; stored?: number; mog?: number };

// How many of an item sit in Mog storage (Locker/Safe/Storage) -- the bags reforgeCount excludes because
// they need a Moogle. Lets the UI explain a shortfall the player can't act on here: they own it, but it's in
// an unreachable bag and (in a no-AH zone) can't be bought either.
export function reforgeMogCount(inv: InvBag[] | undefined, id: number | null): number {
  if (id == null || !inv) return 0;
  let c = 0;
  for (const bag of inv) if (MOG_ONLY_BAGS.has(bag.id)) for (const it of bag.items) if (it.id === id) c += it.c;
  return c;
}

// Rem's Tale Ch.1-10 occupy item ids 4064-4073, so a chapter's item id maps 1:1 to its number.
export const REM_CH_LO = 4064, REM_CH_HI = 4073;
export const remChapterOf = (id: number | null): number | null => (id != null && id >= REM_CH_LO && id <= REM_CH_HI ? id - (REM_CH_LO - 1) : null);
export type PathStatus = ReforgePath & { inputCount: number; inputInInv: number; inputBag: string | null; hasInput: boolean; needs: IngredientNeed[]; partNeeds?: IngredientNeed[][]; ingredientsOk: boolean; doable: boolean; needsPull: boolean; multiPart: boolean };
export type Opportunity = { key: string; type: ArmorType; job: string; slot: string; step: ReforgeStep; paths: PathStatus[]; doable: boolean; owned: boolean };

function currencyValue(cur: ReforgeCurrency | undefined, name: string): number {
  if (!cur) return 0;
  if (name === 'Gil') return cur.gil ?? 0;
  return cur.list?.find((e) => e.n === name)?.v ?? 0;
}

// How many of a Rem's Tale chapter this character has stored with Monisette (0 for non-chapters).
export function remStoredCount(cur: ReforgeCurrency | undefined, id: number | null): number {
  const ch = remChapterOf(id);
  return ch == null ? 0 : currencyValue(cur, `Rems Tale Chapter ${ch}`);
}

// Resolve one recipe ingredient into a have/need readout: currency reads the currency page; items read
// the bags (plus Monisette-stored Rem's Tale chapters, which the reforge auto-retrieves).
function needOf(inv: InvBag[] | undefined, cur: ReforgeCurrency | undefined, i: ReforgeIngredient): IngredientNeed {
  if (i.currency) { const v = currencyValue(cur, i.name); return { id: null, name: i.name, have: v, inInv: v, need: i.qty, currency: true }; }
  const c = reforgeCount(inv, i.id);
  const stored = remStoredCount(cur, i.id);
  const mog = reforgeMogCount(inv, i.id);
  return { id: i.id, name: i.name, have: c.have + stored, inInv: c.inInv, need: i.qty, stored: stored || undefined, mog: mog || undefined };
}

// Every upgrade step in the DB with a per-path have/need readout (across all reachable bags), tagged
// with `owned` (player holds an input for a path) and `doable` (owns input + has the mats). The context-
// aware "Ready" view filters to owned; the "All" catalog view shows everything. needsPull = doable but
// the input or an ingredient sits in another bag and must be moved to inventory first.
export function buildOpportunities(db: ReforgeDB, inv: InvBag[] | undefined, cur?: ReforgeCurrency): Opportunity[] {
  const out: Opportunity[] = [];
  for (const type of ARMOR_TYPES) {
    const jobs = db[type];
    if (!jobs) continue;
    for (const job of Object.keys(jobs)) {
      const slots = jobs[job].slots;
      for (const slot of SLOT_ORDER) {
        const sd = slots[slot];
        if (!sd) continue;
        for (let si = 0; si < sd.steps.length; si++) {
          const step = sd.steps[si];
          const paths: PathStatus[] = step.paths.map((p) => {
            const ic = reforgeCount(inv, p.input.id);
            const needs: IngredientNeed[] = p.ingredients.map((i) => needOf(inv, cur, i));
            // For a multi-day reforge, the per-day requirement lists (each with its own Escha Beads
            // amount) so the UI can show Day 1 / Day 2 groups instead of one crowded row.
            const partNeeds: IngredientNeed[][] | undefined = p.parts?.map((part) => {
              const arr = part.ingredients.map((i) => needOf(inv, cur, i));
              for (const cc of part.currency ?? []) { const v = currencyValue(cur, cc.name); arr.push({ id: null, name: cc.name, have: v, inInv: v, need: cc.qty, currency: true }); }
              return arr;
            });
            const ingredientsOk = needs.every((n) => n.have >= n.need);  // `have` already includes Monisette-stored chapters
            const hasInput = ic.have > 0;
            const doable = hasInput && ingredientsOk;
            const needsPull = doable && (ic.inInv < 1 || needs.some((n) => n.inInv < n.need));
            return { ...p, inputCount: ic.have, inputInInv: ic.inInv, inputBag: reforgeBagOf(inv, p.input.id), hasInput, needs, partNeeds, ingredientsOk, doable, needsPull, multiPart: !!(p.parts && p.parts.length > 1) };
          });
          out.push({ key: `${type}.${job}.${slot}.${si}`, type, job, slot, step, paths, owned: paths.some((p) => p.hasInput), doable: paths.some((p) => p.doable) });
        }
      }
    }
  }
  return out;
}

// Reforged set name for a job, derived from its base->reforged output (e.g. "Pummeler's").
export function setNameFor(job: ReforgeJobData): string {
  for (const slot of SLOT_ORDER) {
    const sd = job.slots[slot];
    const s = sd?.steps.find((x) => x.to === 'reforged') ?? sd?.steps[0];
    if (s) return s.output.name.replace(/\s+\S+$/, '');
  }
  return '';
}

// id -> display name for every reforge piece (input or output). The addon streams a running step by
// its output id only, so the progress UI resolves names from the recipe DB it already has.
export function reforgeNameMap(db: ReforgeDB): Map<number, string> {
  const m = new Map<number, string>();
  for (const type of ARMOR_TYPES) {
    const jobs = db[type];
    if (!jobs) continue;
    for (const job of Object.keys(jobs)) {
      for (const slot of Object.keys(jobs[job].slots)) {
        for (const step of jobs[job].slots[slot].steps) {
          if (step.output.id != null) m.set(step.output.id, step.output.name);
          for (const p of step.paths) if (p.input.id != null) m.set(p.input.id, p.input.name);
        }
      }
    }
  }
  return m;
}
