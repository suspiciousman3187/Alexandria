// SINGLE SOURCE OF TRUTH for stat-name canonicalization + the parse regexes. Imported by BOTH the build
// (scripts/build-itemnames.mjs, Node) and the client (src/gearset/gearsetStats.ts, browser), so the base
// item_mods and the live augment parse can never drift. Pure: no DOM/Node/React deps. Types in statCanon.d.ts.

const CANON = {};
const alias = (canon, ...keys) => { CANON[canon.toLowerCase()] = canon; for (const k of keys) CANON[k.toLowerCase()] = canon; };
alias('STR'); alias('DEX'); alias('VIT'); alias('AGI'); alias('INT'); alias('MND'); alias('CHR');
alias('HP'); alias('MP'); alias('DEF'); alias('DMG'); alias('Delay');
alias('Accuracy', 'acc.'); alias('Attack', 'atk.'); alias('Evasion', 'eva.');
alias('Ranged Accuracy', 'rng.acc.', 'ranged acc.'); alias('Ranged Attack', 'rng.atk.', 'ranged atk.');
alias('Magic Accuracy', 'mag. acc.', 'magic acc.', 'mag.acc.', 'm. acc.', 'm. accuracy'); alias('Magic Evasion', 'mag. eva.', 'magic eva.', 'm. eva.');
alias('Magic Atk. Bonus', 'magic atk. bonus', 'magic attack bonus', 'mab', 'm. atk. b.'); alias('Magic Def. Bonus', 'magic def. bonus', 'mdb', 'm. def. b.');
alias('Ranged Accuracy', 'r. accuracy', 'r. acc.'); alias('Ranged Attack', 'r. attack', 'r. atk.');
alias('Magic Damage', 'magic dmg.', 'mag. dmg.', 'mag.dmg.'); alias('Magic burst damage'); alias('Magic burst damage II'); alias('Skillchain Bonus');
alias('Haste'); alias('Dual Wield', 'dw'); alias('Store TP', 'store tp'); alias('Save TP', 'save tp');
alias('Subtle Blow'); alias('Subtle Blow II');
alias('Double Attack', 'dbl.atk.', 'double atk.'); alias('Triple Attack', 'triple atk.'); alias('Quad Attack', 'quadruple attack');
alias('Critical hit rate', 'crit.hit rate', 'critical hit rate', 'crit. hit rate'); alias('Critical hit damage', 'crit.hit damage', 'crit. hit damage');
alias('Fast Cast'); alias('Cure Potency', 'cure potency'); alias('Refresh'); alias('Regen'); alias('Regain');
alias('Movement speed'); alias('Enmity'); alias('Damage taken', 'dt');
alias('Physical damage taken', 'pdt', 'phys. dmg. taken', 'phys.dmg.taken'); alias('Physical damage taken II', 'phys. dmg. taken ii', 'pdt ii');
alias('Magic damage taken', 'mdt', 'mag. dmg. taken', 'mag.dmg.taken'); alias('Magic damage taken II', 'magic damage taken ii', 'mdt ii');
alias('Physical damage limit', 'phys. dmg. limit', 'pdl');
alias('Weapon skill damage', 'weapon skill damage'); alias('Spell interruption rate down', 'spell interruption rate');
alias('Conserve MP'); alias('Accuracy skill'); alias('Evasion skill'); alias('Parrying skill'); alias('Guarding skill'); alias('Shield skill');
alias('Counter'); alias('Snapshot'); alias('Rapid Shot'); alias('True Shot'); alias('Triple Shot'); alias('TP Bonus'); alias('Conserve TP');
alias('Zanshin'); alias('Treasure Hunter', 'th'); alias('Kick Attacks'); alias('Martial Arts'); alias('Recycle'); alias('Steal'); alias('Reward');
alias('Blood Boon'); alias('Weapon Skill Accuracy'); alias('Magic Critical hit rate'); alias('Chance of successful block');
alias('Resistance to all status ailments'); alias('Dodge'); alias('Divine benison'); alias('Occult Acumen'); alias('Weapon Bash'); alias('Shield Bash');
alias('Enhancing magic duration'); alias('Elemental magic casting time'); alias('Spellcasting time', 'spell casting time');
alias('Cure Spellcasting Time', 'cure spellcasting time', 'cure casting time');
alias('Song spellcasting time'); alias('Song recast delay'); alias('Ability delay'); alias('Quick Magic');
alias('Cure Potency II', 'cure potency ii'); alias('Cure effect received', 'cure effect received', 'potency of cure effect received');
alias('Waltz Potency', 'waltz potency'); alias('Drain and Aspir Potency', 'drain and aspir potency');
alias('Regen Potency', 'regen potency'); alias('Refresh Potency', 'refresh potency');
alias('All songs', 'all songs'); alias('Song effect duration', 'song effect duration'); alias('Regen effect duration', 'regen effect duration');
alias('Healing magic casting time', 'healing magic casting time'); alias('Healing magic recast delay', 'healing magic recast delay');
alias('Elemental magic recast delay', 'elemental magic recast delay'); alias('Blood Pact ability delay', 'blood pact ability delay');
alias('Blood Pact ability delay II', 'blood pact ability delay ii');
alias('Sword enhancement spell damage', 'sword enhancement spell damage'); alias('Step accuracy', 'step accuracy');
alias('Triple Attack damage', 'triple attack damage'); alias('Double Attack damage', 'double attack damage');
alias('Cursna', 'cursna'); alias('Killer effects', 'killer effects');
alias('Double Shot', 'double shot'); alias('Double Shot damage', 'double shot damage'); alias('Enfeebling magic effect', 'enfeebling magic effect');
alias('Charm', 'charm'); alias('Quick Draw', 'quick draw'); alias('Sublimation', 'sublimation'); alias('Fencer', 'fencer');
alias('Tactical Parry', 'tactical parry'); alias('Chain Affinity', 'chain affinity'); alias('Burst Affinity', 'burst affinity');
alias('Aggressor duration', 'aggressor duration'); alias('Retaliation', 'retaliation'); alias('Spirit Link', 'spirit link');
alias('Meditate duration', 'meditate duration'); alias('Jig duration', 'jig duration'); alias('Overload rate', 'overload rate');
alias('Converts damage taken to TP', 'converts damage taken to tp');
alias('MP recovered while healing'); alias('HP recovered while healing');
alias('Breath Damage taken'); alias('Synergy Damage taken'); alias('Avatar perpetuation cost', 'avatar perpetuation cost');

// Non-combat / non-gear numbers that must never be summed even if a future passthrough would catch them.
const NONCOMBAT = /(experience|capacity) point bonus|chocobo riding time|riding time|material loss|maximum (bonus|duration)|required skill|synthesis skill|skill gain rate|^converts?\b|moblin maze|monstrosity/i;
// BRD song-potency "+1" bonuses: "Minuet+1", "March+1", ... Each family word is its own stat.
const SONGS = new Set(['paeon', 'ballad', 'minne', 'minuet', 'madrigal', 'prelude', 'etude', 'carol', 'threnody',
  'lullaby', 'elegy', 'requiem', 'finale', 'mazurka', 'scherzo', 'sirvente', 'dirge', 'round', 'march', 'mambo',
  'operetta', 'nocturne', 'hymnus', 'capriccio', 'fantasia', 'gavotte', 'virelai', 'aubade']);

export function canonStat(name) {
  const n0 = name.trim().replace(/^"+|"+$/g, '').replace(/:$/, '').replace(/\s+/g, ' ').trim();
  const lc = n0.toLowerCase();
  if (CANON[lc]) return CANON[lc];
  if (NONCOMBAT.test(n0)) return null;
  // Family passthroughs: whole classes of stats that don't need one-by-one aliasing.
  if (/ skills?$/i.test(n0)) return n0;    // "Great Axe skill", "Parrying skill", "All magic skills", "All skills"
  if (/^resist /i.test(n0)) return n0;     // "Resist Sleep", "Resist Silence"
  if (/ killer$/i.test(n0)) return n0;     // "Undead Killer", "Lizard Killer"
  if (/\w received$/i.test(n0)) return n0; // "Phalanx received", "Regen effects received"
  if (SONGS.has(lc)) return n0.charAt(0).toUpperCase() + n0.slice(1);
  // CAPTURE-BY-DEFAULT. FFXI gear descriptions list every stat as a Title-Cased "<Name>+N" token, so a
  // capitalized name that reached here is a REAL but un-aliased stat (a job-ability enhancement, a per-
  // element magic acc/atk, a "<JA> effect duration", a "Pet:/All Jumps: <stat>", etc.) -- keep it verbatim
  // instead of silently dropping it, which is what forced us to alias stats one bug-report at a time. This
  // also makes the catalog self-complete for future game updates: a new capitalized stat is captured on
  // sight. A LOWERCASE token here is a mid-line continuation FRAGMENT the tokenizer split off (".. to MP",
  // "taken -2%", "while healing") -- never a stat name in the data -- so those stay dropped. Situational
  // clauses (weather / time-of-day / latent / addendum / area) are removed upstream by CUT/COND before we
  // get here, so capture-by-default never flat-sums a conditional stat.
  if (/^[A-Z][A-Za-z]/.test(n0)) return n0;
  return null;
}

// The name class includes `-` so hyphenated stats capture whole ("Two-handed weapon delay", "Drain-and-Aspir")
// instead of losing the leading word and leaving a lowercase fragment ("handed weapon delay").
// FFXI wraps a single stat phrase across several `\n`-separated lines purely for display width, so the
// `\n` is cosmetic, NOT a stat separator. Every real stat phrase is Title-Cased or opens with a quoted
// keyword, so a line that begins lowercase (or with a bare value) is a word-wrap CONTINUATION of the
// previous phrase -- rejoin it, or `Resistance to all` + `status ailments +10` parse as two non-stats
// instead of one real stat. Returns display-trimmed lines ready for the COND/CUT/ASSIGN walk.
export function unwrapLines(enText) {
  const raw = enText.replace(/\\"/g, '"').replace(/\\\\/g, '\\').split(/\\n/);
  const out = [];
  for (let ln of raw) {
    const t = ln.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if ((/^[a-z]/.test(t) || /^[+-]?\d/.test(t)) && out.length) out[out.length - 1] += ' ' + t;
    else out.push(t);
  }
  return out;
}

export const ASSIGN = /("?)([A-Za-z][A-Za-z.'&:\- ]*?)\1?\s*([+-])(\d+)(%?)/g;
export const COLON = /\b(DEF|DMG|Delay)\s*:\s*(\d+)/g;
// "<stat> down N%" is a sign-less reduction (e.g. "Spell interruption rate down 20%"); counted as -N.
export const DOWN = /([A-Za-z][A-Za-z.'&\- ]*?)\s+down\s+(\d+)(%?)/gi;
// Conditional / situational line prefixes. Everything FROM this marker onward on a line is dropped so a
// situational stat ("On Earthsday: Evasion+2", "Right ear: Mag. Atk. Bonus+7", "Reives: Save TP+400") is not
// summed as a flat gear stat, while an unconditional stat earlier on the same line still counts.
export const CUT = /\b(on\s+\w+?day'?s?\s*:|\w*\s*weather\s*:|nighttime\s*:|daytime\s*:|dusk\s+to\s+dawn\s*:|dawn\s+to\s+dusk\s*:|latent\s+effect\s*:|addendum\s*:\s*\w+|song\s+effects\s*:|grimoire\s*:|right\s+ear\s*:|left\s+ear\s*:|reives\s*:|campaign\s*:|besieged\s*:|assault\s*:|salvage\s*:|einherjar\s*:|limbus\s*:|abyssea\s*:|dynamis\s*:|escha\s*:|reisenjima\s*:|ambuscade\s*:|odyssey\s*:|sortie\s*:|domain\s+invasion\s*:|vs\.\s)/i;
// The COND prefixes mean the REST of the description is a trailing conditional block (set/latent/pet/...).
export const COND = /^(set:|latent effect:|unity ranking:|domain invasion:|trust:|enchantment:|pet:|avatar:|automaton:|wyvern:|luopan:|in areas|on \w+days|same elemental|enemy )/i;
