// Ambuscade cape augment-state tracking. Reads a cape's current augment strings (from extdata, e.g.
// `"Store TP"+8`, `Accuracy+15 Attack+15`, `DEF+50`, `Damage taken -5%`) and estimates how many trades of each
// material have been applied, so the augment UI can gate remaining repeats against the PER-MATERIAL total cap.
//
// Each augment is displayed as separate LINES, and every line is one slot from ONE material -- so a cape can show
// "STR+20" (Thread) AND a separate "STR+10" (Dye). We classify PER LINE and never sum a stat across lines, then
// clamp every material to its hard cap (Thread 20 / Dust 20 / Sap 10 / Dye 10 / Resin 5) so a pre-augmented cape
// can never report more than a material's total.
// Exact for Sap and Resin (their stats are unique). Best-effort (signature-based, option B) for Thread / Dust /
// Dye, where the game shares stats:
//   - Dust adds Acc/Atk (and the ranged / magic pairs) TOGETHER in one line, Dye adds them singly -> a matched
//     pair is Dust, a lone single (or the imbalance of an uneven pair) is Dye.
//   - Evasion / Magic Evasion: paired => Dust; a single +3 chunk => Resin, otherwise => Dye.
//   - STR-CHR / HP / MP are the only Thread-or-Dye stats: a value over the Dye cap (10) must be Thread, else the
//     one Thread slot fills first and the rest is Dye. Pet Acc/Atk (and Pet MAcc/MDmg) pairs come from Thread.
// The UI exposes a manual override (option C) so the user can correct any material's count when they mixed.

import { CAPE_MAX } from './augData';

export type Material = 'Thread' | 'Dust' | 'Sap' | 'Dye' | 'Resin';
export const MATERIAL_ORDER: Material[] = ['Thread', 'Dust', 'Sap', 'Dye', 'Resin'];

// The cape's real augment strings are ABBREVIATED and come from extdata, not the generic res/augments.lua, so an
// exact-name table misses them (e.g. "Dbl.Atk.", "Phys. dmg. taken", "Spell interruption rate down", "Mag.Atk.Bns.",
// "Mag. Acc."). Match a stat token to a canonical key by ordered keyword regex over the NORMALIZED token (lowercased,
// quotes/periods/colons removed, whitespace collapsed). Order is most-specific first so e.g. pet/phys/mag variants
// win before the generic term.
const norm = (s: string) => s.toLowerCase().replace(/["]/g, '').replace(/[.:]/g, ' ').replace(/\s+/g, ' ').trim();

const STAT_MATCHERS: [RegExp, string][] = [
  [/spell interruption/, 'castint'],
  [/pet.*phys.*dmg.*taken|pet.*physical damage taken/, 'petpdt'],
  [/pet.*mag.*dmg.*taken|pet.*magic damage taken/, 'petmdt'],
  [/pet.*(dmg|damage).*taken/, 'petdt'],
  [/phys.*dmg.*taken|physical damage taken/, 'pdt'],
  [/mag.*dmg.*taken|magic damage taken/, 'mdt'],
  [/(dmg|damage) taken/, 'dt'],
  [/pet.*regen/, 'petregen'],
  [/pet.*haste/, 'pethaste'],
  [/pet.*mag.*acc/, 'petmacc'],
  [/pet.*mag.*(dmg|dm)/, 'petmdmg'],
  [/pet.*ranged acc/, 'petracc'],
  [/pet.*ranged (atk|att)/, 'petratk'],
  [/pet.*acc/, 'petacc'],
  [/pet.*(atk|attack)/, 'petatk'],
  [/dbl.*atk|double attack/, 'da'],
  [/store tp/, 'stp'],
  [/fast cast/, 'fc'],
  [/dual wield/, 'dw'],
  [/snapshot/, 'snapshot'],
  [/crit.*hit|critical hit/, 'crit'],
  [/mag.*atk.*(bonus|bns|b)|magic att?a?c?k? ?bonus/, 'mab'],
  [/weapon skill (dmg|damage)|ws.*(dmg|damage)/, 'wsd'],
  [/waltz/, 'waltz'],
  [/cure/, 'cure'],
  [/haste/, 'haste'],
  [/counter/, 'counter'],
  [/parry/, 'parry'],
  [/block/, 'block'],
  [/status ailment/, 'resist'],
  [/regen/, 'regen'],
  [/enmity/, 'enmity'],
  [/^def|defense/, 'def'],
  [/mag.*acc/, 'macc'],
  [/mag.*(dmg|dm)/, 'mdmg'],
  [/mag.*eva/, 'meva'],
  [/ranged acc/, 'racc'],
  [/ranged (atk|att)/, 'ratk'],
  [/evasion/, 'evasion'],
  [/accuracy/, 'accuracy'],
  [/attack/, 'attack'],
  [/^hp$/, 'hp'], [/^mp$/, 'mp'],
  [/^str$/, 'str'], [/^dex$/, 'dex'], [/^vit$/, 'vit'], [/^agi$/, 'agi'], [/^int$/, 'int'], [/^mnd$/, 'mnd'], [/^chr$/, 'chr'],
];

function matchStat(token: string): string | null {
  const t = norm(token);
  if (!t) return null;
  for (const [re, key] of STAT_MATCHERS) if (re.test(t)) return key;
  return null;
}

// Parse ONE augment line into its canonical key -> value tokens. A cape augment is displayed as several separate
// LINES, and each line is a distinct augment slot produced by a single material (e.g. "STR+20" from Thread and a
// separate "STR+10" line from Dye). So we must NEVER sum a stat across lines into one bucket -- that is what let
// the old code report STR+20 and STR+10 as a single Thread 30 (over the 20 cap). One line can still carry a Dust
// PAIR ("Accuracy+20 Attack+20"), so a line yields a small list. Values may be signless; magnitude is taken.
function parseLine(raw: string): { key: string; val: number }[] {
  const out: { key: string; val: number }[] = [];
  const line = raw.replace(/"/g, '');
  const re = /([A-Za-z][A-Za-z .]*?)\s*([+-]?\d+)\s*%?(?=$|[^%\d]|\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const key = matchStat(m[1]);
    if (key) out.push({ key, val: Math.abs(Number(m[2])) });
  }
  return out;
}

// Stats found ONLY on Sap, +1 (or +1%) per trade.
const SAP_KEYS = new Set(['wsd', 'crit', 'stp', 'da', 'haste', 'dw', 'enmity', 'snapshot', 'mab', 'fc', 'cure', 'waltz', 'pethaste', 'petregen']);
// Stats found ONLY on Resin, with the trade increment each one advances by.
const RESIN_INC: Record<string, number> = { def: 10, pdt: 2, mdt: 2, dt: 1, regen: 1, counter: 2, block: 1, parry: 1, resist: 2, castint: 2, petpdt: 2, petmdt: 2, petdt: 1 };
// The 7 base attributes + HP/MP are the ONLY stats both Thread and Dye can grant; every trade is +1 (attributes).
// Everything else that looks like a "single" (lone Acc/Atk, ranged, magic, pet) can only come from Dye.
const THREAD_OR_DYE = new Set(['str', 'dex', 'vit', 'agi', 'int', 'mnd', 'chr', 'hp', 'mp']);

export type CapeUsage = { used: Record<Material, number>; approx: boolean };

// Decompose a cape's current augments into how many trades of each material were applied, per LINE, respecting the
// hard per-material cap (Thread 20 / Dust 20 / Sap 10 / Dye 10 / Resin 5). `approx` flags the estimate whenever a
// line is ambiguous (a stat Thread/Dust/Dye share) so the UI shows the note + offers a manual override.
export function capeUsage(lines: string[]): CapeUsage {
  const used: Record<Material, number> = { Thread: 0, Dust: 0, Sap: 0, Dye: 0, Resin: 0 };
  const attrLines: { key: string; val: number }[] = []; // Thread-or-Dye attributes, assigned after all lines seen
  let approx = false;

  for (const raw of lines ?? []) {
    if (!raw) continue;
    const toks = parseLine(raw);
    if (!toks.length) continue;
    const val = (k: string) => toks.find((t) => t.key === k)?.val ?? 0;
    const done = new Set<string>();

    // Paired offensive families come TOGETHER from one Dust trade; a leftover imbalance is a Dye single.
    for (const [a, b] of [['accuracy', 'attack'], ['racc', 'ratk'], ['macc', 'mdmg']] as const) {
      if (val(a) > 0 && val(b) > 0) {
        used.Dust += Math.min(val(a), val(b));
        const imb = Math.abs(val(a) - val(b));
        if (imb > 0) { used.Dye += imb; approx = true; }
        done.add(a); done.add(b);
      }
    }
    // Eva + MEva together => Dust (Eva/MEva path).
    if (val('evasion') > 0 && val('meva') > 0) { used.Dust += Math.min(val('evasion'), val('meva')); done.add('evasion'); done.add('meva'); }
    // Pet Acc+Atk / Pet MAcc+MDmg pairs come from Thread (PetMelee / PetMagic).
    if (val('petacc') > 0 && val('petatk') > 0) { used.Thread += Math.min(val('petacc'), val('petatk')); done.add('petacc'); done.add('petatk'); }
    if (val('petmacc') > 0 && val('petmdmg') > 0) { used.Thread += Math.min(val('petmacc'), val('petmdmg')); done.add('petmacc'); done.add('petmdmg'); }

    for (const t of toks) {
      if (done.has(t.key)) continue;
      const k = t.key, v = t.val;
      if (SAP_KEYS.has(k)) used.Sap += v;
      else if (k in RESIN_INC) used.Resin += v / RESIN_INC[k];
      else if (k === 'evasion' || k === 'meva') { if (v % 3 === 0) used.Resin += v / 3; else { used.Dye += v; approx = true; } }
      else if (THREAD_OR_DYE.has(k)) attrLines.push({ key: k, val: v });
      else { used.Dye += v; approx = true; } // lone Acc/Atk/ranged/magic/pet single = Dye-only
    }
  }

  // Assign the Thread-or-Dye attribute lines: a value over the Dye cap (10) MUST be Thread; otherwise fill the one
  // Thread slot first (bigger values), the rest fall to Dye. Any pet pair above already claimed Thread.
  let threadUsed = used.Thread > 0;
  for (const a of attrLines.sort((x, y) => y.val - x.val)) {
    approx = true;
    if (a.val > 10) { used.Thread += a.val; threadUsed = true; }
    else if (!threadUsed) { used.Thread += a.val; threadUsed = true; }
    else used.Dye += a.val;
  }

  for (const m of MATERIAL_ORDER) used[m] = Math.max(0, Math.min(CAPE_MAX[m] ?? 0, Math.round(used[m])));
  return { used, approx };
}

export const remaining = (m: Material, used: number) => Math.max(0, (CAPE_MAX[m] ?? 0) - used);
