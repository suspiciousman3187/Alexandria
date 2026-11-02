import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { T_INDICATOR } from './motion';
import { useKnownCharacters, useAvailableIcons, useAddonInfo, type KnownChar } from './bridge';
import { usableGearBags, moveGearToBag, canReachBag } from './commands';
import { useItemNames, nameMatches, jobEquips, type ItemName } from './itemNames';
import { useSettings } from './settings';
import { IconInner } from './atlasIcon';
import { useItemCard, RichDescription } from './ItemTooltip';
import { CharacterSelect, Select, SearchInput } from './ui';
import { useStickyPersisted } from './sticky';
import { openGearsetWindow } from './overlayWindow';
import { findGearsetFile, readGearsetFile, writeGearsetFile, listCharacterJobs, deriveGearswapData, readGearLibrary, readSelindrileItems } from './gearset/gearsetFiles';
import { parseGearsetFile, resolveSet, collectLocalRefs, collectLocalRefSets, parseGearLibrary, type ParsedGearsets, type ParsedSet, type GearEntry, type ResolvedSlot } from './gearset/gearsetParser';
import { SLOT_ORDER, SLOT_LABEL, type SlotKey } from './gearset/slotLayout';
import { makeNameResolver, ownedById, validateGear, bagLabel, type SlotValidation, type OwnedCopy } from './gearset/gearsetValidate';
import {
  useItemMods, aggregateSet, pieceMods, diffMods,
  STAT_GROUPS, WEAPON_KEYS, isPct, isGood, fmtStat, statLabel, withTrueDamageTaken, capInfo, type StatMods,
} from './gearset/gearsetStats';
import { gearLiteral, replaceTargets, buildRefIndex, type RefIndex } from './gearset/gearsetEdit';
import { usePlans, useAllPlans, addPlan, removePlan, updatePlan, fileKeyOf, type Plan, type Fulfillment } from './gearset/gearsetPlans';
import { GearsetCompare, type CompareOperand } from './gearset/GearsetCompare';
import { useScratch, createScratch, renameScratch, deleteScratch, setScratchSlot, SCRATCH_PREFIX, type ScratchSet } from './gearset/gearsetScratch';
import { useViews, addView, updateView, removeView, setActiveView, toggleCollapsed, setAppearance, BRIGHT_DEFAULT, BLUR_DEFAULT, type StatView } from './gearset/gearsetViews';

const EQUIP_BAGS = new Set([0, 8, 10, 11, 12, 13, 14, 15, 16]);

// Equip-slot bitmask per canonical slot (matches item_names `sl`), to filter the swap picker to items
// that fit the slot. Ears/rings share their pair's bits.
const SLOT_BIT: Record<SlotKey, number> = {
  main: 0x1, sub: 0x2, range: 0x4, ammo: 0x8, head: 0x10, body: 0x20, hands: 0x40, legs: 0x80, feet: 0x100,
  neck: 0x200, waist: 0x400, left_ear: 0x1800, right_ear: 0x1800, left_ring: 0x6000, right_ring: 0x6000, back: 0x8000,
};
// GearSwap slot name written into the .lua when assigning an empty slot.
const SLOT_WRITE: Record<SlotKey, string> = {
  main: 'main', sub: 'sub', range: 'range', ammo: 'ammo', head: 'head', neck: 'neck',
  left_ear: 'left_ear', right_ear: 'right_ear', body: 'body', hands: 'hands',
  left_ring: 'left_ring', right_ring: 'right_ring', back: 'back', waist: 'waist', legs: 'legs', feet: 'feet',
};

const GROUP_ORDER = ['Weapons', 'Instrument', 'Idle', 'Movement', 'OffenseMode', 'DualWield', 'Precast', 'Midcast', 'WS', 'JA', 'Waltz', 'Jig', 'Samba', 'Step', 'Flourish', 'PhantomRoll', 'QuickDraw', 'Ready', 'Geomancy', 'TreasureHunter'];
const GROUP_LABEL: Record<string, string> = { OffenseMode: 'Offense' };
const GROUP_HUE: Record<string, string> = {
  Weapons: '#c07a8a', Idle: '#7aa8c0', Movement: '#7fbdae', OffenseMode: '#c0a060', DualWield: '#c98f6a',
  Precast: '#9a86c0', Midcast: '#6fb09a', WS: '#c08070', JA: '#b088b0',
  Waltz: '#c58fb0', Jig: '#c58fb0', Samba: '#c58fb0', Step: '#c58fb0', Flourish: '#c58fb0',
  PhantomRoll: '#8f9ac8', QuickDraw: '#8f9ac8', Ready: '#9ab86e', Geomancy: '#6fb0a8', TreasureHunter: '#c7b25e',
};
const hueOf = (g: string) => GROUP_HUE[g] ?? '#8a9488';
// Title-case a group key (Selindrile uses lowercase groups: weapons/precast/midcast/engaged/idle).
const groupLabel = (g: string) => GROUP_LABEL[g] ?? (g ? g.charAt(0).toUpperCase() + g.slice(1) : g);

// gearset-only semantic colours (css vars from the .gearset-scope theme)
const C_OK = 'var(--gl-ok)', C_ISSUE = 'var(--gl-issue)', C_MISS = 'var(--gl-miss)', C_DYN = 'var(--gl-dyn)', C_AUG = 'var(--gl-aug)', C_GOLD = 'var(--gl-gold)';
// Keys any named category already owns; everything else recognized falls into the Other catch-all.
const CLAIMED = new Set<string>([...STAT_GROUPS.flatMap((g) => g.keys), ...WEAPON_KEYS]);
// Shared easing for animated stat bars (grow/shrink on swap preview).
// Solid category marker colours for the stats table's category dots + filter chips.
const CAT_ORDER = ['Attributes', 'Offensive Stats', 'Defensive Stats', 'Pet', 'Skills', 'Utility Stats & Other', 'Weapon'];
// Route an uncategorized stat (a base-description skill/mod not in any curated group) into its natural group
// by name. Mirrors the bucket rules in scripts/build-augdb.mjs. Returns a STAT_GROUPS title.
function bucketStat(n: string): string {
  if (/^(Pet|Avatar|Automaton|Wyvern|Luopan)\b/i.test(n) || /blood pact|perpetuation/i.test(n)) return 'Pet';
  if (/ skill$/i.test(n)) return 'Skills';
  if (/taken|resist|\bblock\b|stoneskin|aquaveil|phalanx|mana wall|evasion|defense|status ailment/i.test(n)) return 'Defensive Stats';
  if (/attack|accuracy|\bacc\b|damage|dmg|crit|magic|burst|weapon skill|\btp\b|daken|shot|skillchain|kick|double|triple|quad|zanshin|drain|aspir|enspell/i.test(n)) return 'Offensive Stats';
  return 'Utility Stats & Other';
}
const CAT_DOT: Record<string, string> = {
  Attributes: 'var(--gl-gold)', 'Offensive Stats': '#ef9aa0', 'Defensive Stats': '#8fc7f0',
  Pet: '#a985e0', Skills: '#5f9fd7', 'Utility Stats & Other': '#5fc7ad', Weapon: '#c7b25e',
};

function stateText(v: SlotValidation): string {
  switch (v.state) {
    case 'ok': return 'Owned, equippable';
    case 'aug-mismatch': return 'Augments differ';
    case 'wrong-bag': return `In ${v.bag}`;
    case 'missing': return 'Not in your bags';
    case 'unknown': return 'Unknown item';
    case 'dynamic': return 'Lua value';
  }
}
function stateColor(s: SlotValidation['state']): string {
  if (s === 'ok') return C_OK;
  if (s === 'aug-mismatch' || s === 'wrong-bag') return C_ISSUE;
  if (s === 'missing' || s === 'unknown') return C_MISS;
  return C_DYN;
}

type PreviewPiece = { slot: SlotKey; id?: number; augs?: string[]; name: string };

// Every directly-defined slot across the file that equips the given item (by name). Inherited slots resolve
// from their base, so replacing the base covers them; only spanned (own) entries are rewritten.
type Occurrence = { setKey: string; path: string[]; slot: SlotKey; augments?: string[] };
function findOccurrences(parsed: ParsedGearsets, nameLc: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const s of parsed.sets) for (const slot of Object.keys(s.slots) as SlotKey[]) {
    const g = s.slots[slot]!;
    if (g.kind === 'item' && g.name.toLowerCase() === nameLc && s.slotSpans?.[slot]) out.push({ setKey: s.key, path: s.path, slot, augments: g.augments });
  }
  return out;
}

type WinCtl = { minimize: () => Promise<unknown>; toggleMaximize: () => Promise<unknown>; close: () => Promise<unknown> } | null;

export default function GearsetView({ win }: { win?: WinCtl }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const items = useItemNames();
  const addon = useAddonInfo();
  const itemMods = useItemMods(); // store identity changes once item_mods + aug_db are loaded
  const base = useSettings().gearswapPath || (addon?.dir ? deriveGearswapData(addon.dir) : '');

  const [charName, setCharName] = useStickyPersisted('gearset.char', '');
  const active = useMemo(() => known.find((c) => c.name === charName) ?? known[0], [known, charName]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);

  const [jobs, setJobs] = useState<string[]>([]);
  const [job, setJob] = useStickyPersisted('gearset.job', '');
  const [mode, setMode] = useStickyPersisted<'edit' | 'compare'>('gearset.mode', 'edit');
  useEffect(() => {
    if (!base || !active) { setJobs([]); return; }
    let alive = true;
    void listCharacterJobs(base, active.name).then((j) => { if (alive) setJobs(j); });
    return () => { alive = false; };
  }, [base, active?.name]);
  useEffect(() => {
    if (!jobs.length) return;
    const m = (active?.main ?? '').toUpperCase();
    // Selecting an online character snaps the job selector to that box's current in-game job (when it has a
    // gearset for it). Fires only on a character switch (keyed on active.name), so a manual job change sticks.
    if (active?.online && jobs.includes(m)) { setJob(m); return; }
    if (!job || !jobs.includes(job)) setJob(jobs.includes(m) ? m : jobs[0]);
  }, [jobs, active?.name]);

  const [parsed, setParsed] = useState<ParsedGearsets | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [selKey, setSelKey] = useState('');
  const [filter, setFilter] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileSrc, setFileSrc] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1600); return () => clearTimeout(t); }, [saved]);

  // Reference resolution for library-based suites (Rahvin). `refs` turns `gear.<key>` / local tables into
  // real items on read; `refIndex` maps an item back to its library reference on write (so we keep Rahvin's
  // naming + HP priority). Both are empty for literal-only suites (Mirdain), leaving those files untouched.
  const libRef = useRef<Map<string, GearEntry>>(new Map());
  const refsRef = useRef<Map<string, GearEntry> | undefined>(undefined);
  const refIndexRef = useRef<RefIndex | undefined>(undefined);
  // Selindrile keeps shared sets (TreasureHunter, BehemothSuit, ...) in a sibling <Char>-Items.lua, referenced
  // cross-file by set_combine. Parsed once on load and merged into byKey each reparse so those refs resolve.
  const companionSetsRef = useRef<ParsedSet[]>([]);
  // The companion (Selindrile <Char>-Items.lua) file: its path + source + the set keys it owns, so edits to a
  // shared set write into THAT file (its byte spans point there), not the gear file.
  const itemsPathRef = useRef<string>('');
  const itemsSrcRef = useRef<string>('');
  const companionKeysRef = useRef<Set<string>>(new Set());
  // Parse the file, then fold in job-file-local gear tables (e.g. BRD Instrument.*) as browsable, editable
  // pseudo-sets. A real `sets.*` of the same key wins (locals only fill gaps). Refs are rebuilt from the
  // library + the file's current local tables each parse, so editing an Instrument also refreshes the
  // `range=Instrument.X` reference in every song set that uses it.
  const reparse = (s: string): ParsedGearsets => {
    const refs = new Map<string, GearEntry>(libRef.current);
    for (const [k, v] of collectLocalRefs(s)) refs.set(k, v);
    refsRef.current = refs.size ? refs : undefined;
    const p = parseGearsetFile(s, refsRef.current);
    for (const cs of companionSetsRef.current) {
      if (!p.byKey.has(cs.key)) { p.sets.push(cs); p.byKey.set(cs.key, cs); }
    }
    for (const ls of collectLocalRefSets(s)) {
      if (!p.byKey.has(ls.key)) { p.sets.push(ls); p.byKey.set(ls.key, ls); }
    }
    return p;
  };

  useEffect(() => {
    if (!base || !active || !job) { setParsed(null); setFileErr(null); setFilePath(''); setFileSrc(''); return; }
    let alive = true;
    setLoading(true); setFileErr(null);
    (async () => {
      const path = await findGearsetFile(base, active.name, job);
      if (!alive) return;
      if (!path) { setParsed(null); setFilePath(''); setFileSrc(''); setFileErr('No gearset file found for this job.'); setLoading(false); return; }
      const src = await readGearsetFile(path);
      if (!alive) return;
      if (src == null) { setParsed(null); setFilePath(''); setFileSrc(''); setFileErr('Could not read the gearset file.'); setLoading(false); return; }
      // Companion gear libraries: Rahvin's GearSets-Include (via include()) and/or Selindrile's <Char>-Items.lua.
      const libSrc = await readGearLibrary(base, src);
      const sel = await readSelindrileItems(path);
      if (!alive) return;
      const lib = libSrc ? parseGearLibrary(libSrc) : new Map<string, GearEntry>();
      const compSets: ParsedSet[] = [];
      itemsPathRef.current = sel?.path ?? '';
      itemsSrcRef.current = sel?.src ?? '';
      if (sel) {
        for (const [k, v] of parseGearLibrary(sel.src)) lib.set(k, v);   // gear.<key> augment entries
        for (const [k, v] of collectLocalRefs(sel.src)) lib.set(k, v);   // any local item tables
        const cp = parseGearsetFile(sel.src, lib);                        // its shared sets.* (TreasureHunter, ...)
        compSets.push(...cp.sets);
        for (const ls of collectLocalRefSets(sel.src)) if (!cp.byKey.has(ls.key)) compSets.push(ls);
      }
      companionSetsRef.current = compSets;
      companionKeysRef.current = new Set(compSets.map((s) => s.key));
      libRef.current = lib;
      refIndexRef.current = lib.size ? buildRefIndex(lib) : undefined;
      setFilePath(path); setFileSrc(src);
      setParsed(reparse(src)); // reparse builds refsRef from libRef + the file's local tables
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [base, active?.name, job]);

  const card = useItemCard();
  const resolve = useMemo(() => makeNameResolver(items), [items]);
  const owned = useMemo(() => ownedById(active ?? { inv: [] }), [active?.inv]);
  const idToItem = useMemo(() => { const m = new Map<number, ItemName>(); for (const it of items) if (!m.has(it.id)) m.set(it.id, it); return m; }, [items]);

  const setStatus = useMemo(() => {
    const m = new Map<string, { missing: number; issues: number; defined: number }>();
    if (!parsed) return m;
    for (const s of parsed.sets) {
      let missing = 0, issues = 0, defined = 0;
      for (const slot of Object.keys(s.slots) as SlotKey[]) {
        const g = s.slots[slot]!;
        if (g.kind === 'dynamic') continue;
        defined++;
        const v = validateGear(g, resolve, owned);
        if (v.state === 'missing' || v.state === 'unknown') missing++;
        else if (v.state === 'aug-mismatch' || v.state === 'wrong-bag') issues++;
      }
      m.set(s.key, { missing, issues, defined });
    }
    return m;
  }, [parsed, resolve, owned]);

  const summary = useMemo(() => {
    const missing = new Set<string>(), issues = new Set<string>();
    if (parsed) for (const s of parsed.sets) for (const slot of Object.keys(s.slots) as SlotKey[]) {
      const g = s.slots[slot]!;
      if (g.kind === 'dynamic') continue;
      const v = validateGear(g, resolve, owned);
      if (v.state === 'missing' || v.state === 'unknown') missing.add(g.name.toLowerCase());
      else if (v.state === 'aug-mismatch' || v.state === 'wrong-bag') issues.add(g.name.toLowerCase());
    }
    return { missing: missing.size, issues: issues.size };
  }, [parsed, resolve, owned]);

  useEffect(() => {
    if (!parsed) { setSelKey(''); return; }
    if (!selKey.startsWith(SCRATCH_PREFIX) && !parsed.byKey.has(selKey)) {
      const first = parsed.sets.find((s) => Object.keys(s.slots).length > 0) ?? parsed.sets[0];
      setSelKey(first?.key ?? '');
    }
  }, [parsed]);

  const grouped = useMemo(() => {
    if (!parsed) return [] as { group: string; sets: ParsedSet[] }[];
    const q = filter.trim().toLowerCase();
    const byGroup = new Map<string, ParsedSet[]>();
    for (const s of parsed.sets) {
      if (q && !nameMatches(s.key, q)) continue;
      const g = s.path[0] ?? '?';
      const arr = byGroup.get(g) ?? [];
      arr.push(s); byGroup.set(g, arr);
    }
    const keys = [...byGroup.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return keys.map((k) => ({ group: k, sets: byGroup.get(k)! }));
  }, [parsed, filter]);

  const fileKey = fileKeyOf(active?.name ?? '', job);
  // Pinned sets: kept as a base layer that every viewed set overlays onto, so e.g. a Weapons set (main/sub
  // only) can be combined with any other set to see the full picture. Persisted per file.
  const [pinMap, setPinMap] = useStickyPersisted<Record<string, string[]>>('gearset.pinned', {});
  const pins = useMemo(() => pinMap[fileKey] ?? [], [pinMap, fileKey]);
  const togglePin = (key: string) => setPinMap((prev) => {
    const cur = (prev[fileKey] ?? []).slice();
    const i = cur.indexOf(key);
    if (i >= 0) cur.splice(i, 1); else cur.push(key);
    const next = { ...prev };
    if (cur.length) next[fileKey] = cur; else delete next[fileKey];
    return next;
  });

  const scratchList = useScratch(fileKey);
  const scratchSel = selKey.startsWith(SCRATCH_PREFIX) ? scratchList.find((s) => SCRATCH_PREFIX + s.id === selKey) : undefined;
  // A scratch set is viewed/edited like a real set via a synthetic ParsedSet (no file spans); edits route to
  // the scratch store instead of the file.
  const sel = scratchSel
    ? ({ path: ['Scratch', scratchSel.name], key: selKey, slots: scratchSel.slots, slotSpans: {}, valueSpan: [0, 0] as [number, number], nonSlotKeys: 0 } as ParsedSet)
    : parsed?.byKey.get(selKey);
  // Layered resolution: pinned sets form a base layer, the viewed set overlays on top (viewed wins per slot).
  // Each slot records its OWNER set so edits write to the right place (e.g. a weapon shown from a pinned
  // Weapons set edits that Weapons set, not the viewed Precast set).
  const resolved = useMemo<Partial<Record<SlotKey, ResolvedSlot & { owner: ParsedSet; fromPinned: boolean }>>>(() => {
    if (!sel || !parsed) return {};
    const out: Partial<Record<SlotKey, ResolvedSlot & { owner: ParsedSet; fromPinned: boolean }>> = {};
    const pinnedSets = pins.map((k) => parsed.byKey.get(k)).filter((s): s is ParsedSet => !!s && s.key !== sel.key);
    for (const layer of [...pinnedSets, sel]) {
      const r = resolveSet(layer, parsed.byKey);
      const fromPinned = layer.key !== sel.key;
      for (const slot of Object.keys(r) as SlotKey[]) out[slot] = { ...r[slot]!, owner: layer, fromPinned };
    }
    return out;
  }, [sel, parsed, pins]);
  const selValidation = useMemo(() => {
    const m = new Map<SlotKey, SlotValidation>();
    for (const slot of Object.keys(resolved) as SlotKey[]) m.set(slot, validateGear(resolved[slot]!.entry, resolve, owned));
    return m;
  }, [resolved, resolve, owned]);

  const groupStats = useMemo(() => {
    const m = new Map<string, { missing: number; issues: number }>();
    for (const g of grouped) {
      let missing = 0, issues = 0;
      for (const s of g.sets) { const st = setStatus.get(s.key); if (st) { missing += st.missing; issues += st.issues; } }
      m.set(g.group, { missing, issues });
    }
    return m;
  }, [grouped, setStatus]);

  const inhNote = sel?.combineBase;

  // Operands for the compare screen: every file set (slots pre-resolved) plus every scratch set.
  const compareOperands = useMemo<CompareOperand[]>(() => {
    const fileOps: CompareOperand[] = (parsed?.sets ?? []).map((s) => {
      const r = resolveSet(s, parsed!.byKey);
      const slots: Partial<Record<SlotKey, GearEntry>> = {};
      for (const slot of Object.keys(r) as SlotKey[]) slots[slot] = r[slot]!.entry;
      return { key: s.key, label: `${groupLabel(s.path[0])} · ${s.path.slice(1).join('.') || 'Base'}`, slots };
    });
    const scratchOps: CompareOperand[] = scratchList.map((sc) => ({ key: SCRATCH_PREFIX + sc.id, label: `Scratch · ${sc.name}`, slots: sc.slots, scratch: true }));
    return [...fileOps, ...scratchOps];
  }, [parsed, scratchList]);
  const [renamingScratch, setRenamingScratch] = useState<string | null>(null);

  const newScratch = () => { const id = createScratch(fileKey, `Scratch ${scratchList.length + 1}`); setSelKey(SCRATCH_PREFIX + id); setMode('edit'); };
  // Seed a scratch from the currently-viewed set's effective (resolved, incl. pins) gear.
  const duplicateToScratch = () => {
    if (!sel) return;
    const slots: Partial<Record<SlotKey, GearEntry>> = {};
    for (const s of Object.keys(resolved) as SlotKey[]) { const e = resolved[s]!.entry; if (e.kind === 'item') slots[s] = e; }
    const base = scratchSel ? scratchSel.name : (sel.path.slice(1).join('.') || sel.path[0]);
    const id = createScratch(fileKey, `${base} copy`, slots);
    setSelKey(SCRATCH_PREFIX + id); setMode('edit');
  };
  // Write a scratch set into the file as a new top-level sets['Name'], then select it.
  const promoteScratch = async (sc: ScratchSet) => {
    if (!parsed || !filePath || !fileSrc || !parsed.sets.length || saving) return;
    const name = sc.name.replace(/[^A-Za-z0-9_ .-]/g, '').trim() || 'Scratch';
    const body = (Object.keys(sc.slots) as SlotKey[])
      .filter((s) => sc.slots[s]?.kind === 'item')
      .map((s) => { const e = sc.slots[s] as Extract<GearEntry, { kind: 'item' }>; return `\t\t${SLOT_WRITE[s]} = ${gearLiteral(e.name, e.augments, refIndexRef.current)},`; })
      .join('\n');
    const at = parsed.sets[parsed.sets.length - 1].valueSpan[1];
    const newSrc = fileSrc.slice(0, at) + `\n\n\tsets['${name}'] = {\n${body}\n\t}` + fileSrc.slice(at);
    setSaving(true);
    const ok = await writeGearsetFile(filePath, newSrc);
    setSaving(false);
    if (ok) { setFileSrc(newSrc); setParsed(reparse(newSrc)); setSelKey(name); setSaved(true); }
  };

  // base stat totals of the currently-viewed set
  const baseTotals = useMemo<StatMods>(() => aggregateSet(resolved, resolve), [resolved, resolve, itemMods]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selSlot, setSelSlot] = useState<SlotKey | null>(null);
  const [preview, setPreview] = useState<PreviewPiece | null>(null);
  const [replaceFor, setReplaceFor] = useState<{ oldName: string; oldId?: number; suggestedNew?: string; mode?: 'now' | 'plan' } | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  useEffect(() => { setSelSlot(null); setPreview(null); }, [selKey]);
  const toggleGroup = (g: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  // Per-gearswap-file favorites (keyed by char|job), persisted locally. Star a set to float it to the top of
  // its group and to filter the rail down to just favorites.
  const [favMap, setFavMap] = useStickyPersisted<Record<string, string[]>>('gearset.favorites', {});
  const [favFilter, setFavFilter] = useStickyPersisted('gearset.favFilter', false);
  const plans = usePlans(fileKey);
  const allPlansLog = useAllPlans().log.filter((l) => l.fileKey === fileKey);
  const favs = useMemo(() => new Set(favMap[fileKey] ?? []), [favMap, fileKey]);
  const toggleFav = (key: string) => setFavMap((prev) => {
    const cur = new Set(prev[fileKey] ?? []);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    const next = { ...prev };
    if (cur.size) next[fileKey] = [...cur]; else delete next[fileKey];
    return next;
  });
  // Apply the favorites filter + float favorites to the top of each group.
  const displayGroups = useMemo(() => grouped
    .map(({ group, sets }) => ({ group, sets: (favFilter ? sets.filter((s) => favs.has(s.key)) : sets.slice()).sort((a, b) => (favs.has(b.key) ? 1 : 0) - (favs.has(a.key) ? 1 : 0)) }))
    .filter((g) => g.sets.length), [grouped, favs, favFilter]);

  // preview totals: swap the hovered piece into its slot and recompute
  const previewTotals = useMemo<StatMods | null>(() => {
    if (!preview) return null;
    const cur = resolved[preview.slot]?.entry;
    const curId = cur && cur.kind === 'item' ? resolve(cur.name)?.id : undefined;
    const curAugs = cur && cur.kind === 'item' ? cur.augments : undefined;
    return diffMods(baseTotals, pieceMods(curId, curAugs), pieceMods(preview.id, preview.augs));
  }, [preview, baseTotals, resolved, resolve, itemMods]);

  // ---- editing ------------------------------------------------------------
  // Write newSrc to the right file: the gear file, or the Selindrile companion <Char>-Items.lua when editing a
  // shared set. On a companion write, rebuild the library + shared sets from the edited items source, then
  // reparse the gear file so cross-file refs refresh.
  const commitEdit = async (companion: boolean, newSrc: string): Promise<boolean> => {
    const path = companion ? itemsPathRef.current : filePath;
    if (!path) return false;
    const ok = await writeGearsetFile(path, newSrc);
    if (!ok) return false;
    if (companion) {
      itemsSrcRef.current = newSrc;
      const lib = new Map<string, GearEntry>();
      for (const [k, v] of parseGearLibrary(newSrc)) lib.set(k, v);
      for (const [k, v] of collectLocalRefs(newSrc)) lib.set(k, v);
      const cp = parseGearsetFile(newSrc, lib);
      const comp = [...cp.sets];
      for (const ls of collectLocalRefSets(newSrc)) if (!cp.byKey.has(ls.key)) comp.push(ls);
      companionSetsRef.current = comp;
      companionKeysRef.current = new Set(comp.map((s) => s.key));
      libRef.current = lib;
      refIndexRef.current = lib.size ? buildRefIndex(lib) : undefined;
      setParsed(reparse(fileSrc));
    } else {
      setFileSrc(newSrc);
      setParsed(reparse(newSrc));
    }
    return true;
  };

  // Surgical in-place write. Defined/dynamic slots splice over their value span; empty or inherited-only
  // slots INSERT a new `slot = value` entry just inside the set's table, so any slot is assignable.
  const applySwap = async (slot: SlotKey, name: string, augments?: string[]) => {
    // Scratch set: write to the local store, not the file.
    if (scratchSel) { setScratchSlot(fileKey, scratchSel.id, slot, { kind: 'item', name, augments }); setSaved(true); return; }
    // Edit the set that OWNS this slot (a pinned-layer slot edits its pinned set); empty slots go to the viewed set.
    const target = resolved[slot]?.owner ?? sel;
    if (!target || saving) return;
    const companion = companionKeysRef.current.has(target.key);
    const srcEdit = companion ? itemsSrcRef.current : fileSrc;
    if (!srcEdit || (companion ? !itemsPathRef.current : !filePath)) return;
    const val = gearLiteral(name, augments, refIndexRef.current);
    let newSrc: string;
    const span = target.slotSpans?.[slot];
    if (span) {
      const slice = srcEdit.slice(span[0], span[1]);
      const eq = slice.indexOf('=');
      if (eq < 0) return;
      newSrc = srcEdit.slice(0, span[0]) + slice.slice(0, eq + 1) + ' ' + val + srcEdit.slice(span[1]);
    } else {
      // insert a fresh entry right after the slots table's opening brace (works for plain + set_combine sets)
      const tbl = srcEdit.slice(target.valueSpan[0], target.valueSpan[1]);
      const br = tbl.indexOf('{');
      if (br < 0) return;
      const at = target.valueSpan[0] + br + 1;
      newSrc = srcEdit.slice(0, at) + `\n    ${SLOT_WRITE[slot]} = ${val},` + srcEdit.slice(at);
    }
    setSaving(true);
    const ok = await commitEdit(companion, newSrc);
    setSaving(false);
    if (ok) setSaved(true);
  };

  // Remove a slot's entry from the set entirely (its `slot = value` line, plus trailing comma). The slot then
  // falls back to inherited (if a base set defines it) or shows as empty.
  const applyUnassign = async (slot: SlotKey) => {
    if (scratchSel) { setScratchSlot(fileKey, scratchSel.id, slot, null); setSaved(true); return; }
    const target = resolved[slot]?.owner ?? sel;
    if (!target || saving) return;
    const companion = companionKeysRef.current.has(target.key);
    const srcEdit = companion ? itemsSrcRef.current : fileSrc;
    if (!srcEdit || (companion ? !itemsPathRef.current : !filePath)) return;
    const span = target.slotSpans?.[slot];
    if (!span) return;
    // A local pseudo-set (e.g. Instrument.Savage) is referenced by other sets' slots, so don't delete its
    // definition -- clear the item to `{}` so the reference stays valid and the slot reads empty.
    if (target.local) {
      const slice = srcEdit.slice(span[0], span[1]);
      const eq = slice.indexOf('=');
      if (eq < 0) return;
      const cleared = srcEdit.slice(0, span[0]) + slice.slice(0, eq + 1) + ' {}' + srcEdit.slice(span[1]);
      setSaving(true);
      const okc = await commitEdit(companion, cleared);
      setSaving(false);
      if (okc) setSaved(true);
      return;
    }
    const n = srcEdit.length;
    let e = span[1];
    while (e < n && (srcEdit[e] === ' ' || srcEdit[e] === '\t')) e++;
    if (srcEdit[e] === ',') e++;
    if (srcEdit[e] === '\r') e++;
    if (srcEdit[e] === '\n') e++;
    let b = span[0];
    while (b > 0 && (srcEdit[b - 1] === ' ' || srcEdit[b - 1] === '\t')) b--;
    const newSrc = srcEdit.slice(0, b) + srcEdit.slice(e);
    setSaving(true);
    const ok = await commitEdit(companion, newSrc);
    setSaving(false);
    if (ok) setSaved(true);
  };

  // Replace every selected occurrence of an item (across sets) in one write, newest span first so offsets hold.
  const applyBulkReplace = async (newName: string, picks: { setKey: string; slot: SlotKey }[], carryAug: boolean) => {
    if (!parsed || !filePath || !fileSrc || saving || !picks.length) return;
    const res = replaceTargets(fileSrc, parsed, picks, newName, carryAug
      ? (t) => { const g = parsed.byKey.get(t.setKey)?.slots[t.slot]; return g && g.kind === 'item' ? g.augments : undefined; }
      : undefined, refIndexRef.current);
    if (res) {
      setSaving(true);
      const ok = await writeGearsetFile(filePath, res.src);
      setSaving(false);
      if (ok) { setFileSrc(res.src); setParsed(reparse(res.src)); setSaved(true); }
    }
    setReplaceFor(null);
  };

  // Save a succession plan: record the target slots; the watcher writes the piece in once it's obtained.
  const savePlan = (newName: string, newId: number | undefined, picks: { setKey: string; slot: SlotKey }[], replaces?: string, augments?: string[]) => {
    if (!picks.length || !newName) return;
    addPlan(fileKey, { newName, newId, replaces, targets: picks, augments, auto: true });
    setReplaceFor(null);
  };
  // Apply a pending plan right now (manual button in the Plans list).
  const applyPlanNow = async (plan: Plan) => {
    if (!parsed || !filePath || !fileSrc || saving) return;
    const augs = plan.augments && plan.augments.length ? plan.augments : undefined;
    const res = replaceTargets(fileSrc, parsed, plan.targets, plan.newName, augs ? () => augs : undefined, refIndexRef.current);
    if (res) {
      setSaving(true);
      const ok = await writeGearsetFile(filePath, res.src);
      setSaving(false);
      if (ok) { setFileSrc(res.src); setParsed(reparse(res.src)); setSaved(true); }
    }
    removePlan(fileKey, plan.id);
  };

  const selEntry = selSlot ? resolved[selSlot]?.entry : undefined;
  const selInh = selSlot ? resolved[selSlot]?.inherited : false;
  const selSrc = selSlot ? resolved[selSlot]?.source : undefined;
  const selOwner = selSlot ? resolved[selSlot]?.owner : undefined;
  const selFromPinned = selSlot ? !!resolved[selSlot]?.fromPinned : false;
  const selCompanion = selOwner ? companionKeysRef.current.has(selOwner.key) : false;
  const selOwnerLabel = selOwner && (selFromPinned || selCompanion)
    ? `${selCompanion ? 'shared set ' : 'pinned '}${groupLabel(selOwner.path[0])} · ${selOwner.path.slice(1).join('.') || 'Base'}${selCompanion ? ' (Items.lua)' : ''}`
    : undefined;
  const selV = selSlot ? selValidation.get(selSlot) : undefined;
  // every non-dynamic slot is now editable (empty + inherited get an insert); dynamic stays hand-edited
  const canEdit = !!(selSlot && (!selEntry || selEntry.kind === 'item'));

  return (
    <div className="h-full flex flex-col text-fg-2">
      {/* toolbar */}
      <div data-tauri-drag-region className="gs-sh shrink-0 flex items-center gap-2 px-4 py-2 border-b border-line bg-[rgba(10,6,3,0.76)] backdrop-blur-sm">
        <div className="w-44"><CharacterSelect value={active?.name ?? ''} onChange={setCharName} chars={known} /></div>
        <div className="w-28"><Select value={job} onChange={setJob} options={jobs} renderValue={(v) => v || 'Job'} full /></div>
        {parsed && (
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-field p-0.5">
            {(['edit', 'compare'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className="le-tap px-2.5 h-[28px] text-[11px] font-bold rounded transition-colors"
                style={mode === m ? { background: 'var(--color-accent)', color: 'var(--color-on-accent)' } : { color: 'var(--color-fg-3)' }}>
                {m === 'edit' ? 'Edit' : 'Compare'}
              </button>
            ))}
          </div>
        )}
        {parsed && mode === 'edit' && <button onClick={() => setFavFilter((v) => !v)} title="Show favorites only" className={`le-tap h-[34px] px-2.5 inline-flex items-center gap-1.5 rounded-md border text-[11px] font-semibold transition-colors ${favFilter ? 'border-accent text-fg bg-accent/15' : 'border-line text-fg-4 hover:text-fg-2'}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={favFilter || favs.size ? C_GOLD : 'none'} stroke={favFilter || favs.size ? C_GOLD : 'currentColor'} strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9z" /></svg>
          {favs.size > 0 && <span className="tabular-nums">{favs.size}</span>}
        </button>}
        {parsed && <button onClick={() => setShowPlans(true)} title="Upgrade plans for this file" className={`le-tap h-[34px] px-2.5 inline-flex items-center gap-1.5 rounded-md border text-[11px] font-semibold transition-colors ${plans.length ? 'border-accent/60 text-fg bg-accent/10' : 'border-line text-fg-4 hover:text-fg-2'}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>
          Plans{plans.length ? ` · ${plans.length}` : ''}
        </button>}
        {parsed && <AppearanceButton />}
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <button onClick={() => void win?.minimize()} aria-label="Minimize" title="Minimize" className="le-tap w-7 h-7 grid place-items-center rounded text-fg-4 hover:bg-line hover:text-fg-2 transition-colors"><svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 9.5h7" /></svg></button>
          <button onClick={() => void win?.toggleMaximize()} aria-label="Maximize" title="Maximize" className="le-tap w-7 h-7 grid place-items-center rounded text-fg-4 hover:bg-line hover:text-fg-2 transition-colors"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2.3" y="2.3" width="7.4" height="7.4" rx="1" /></svg></button>
          <button onClick={() => void win?.close()} aria-label="Close" title="Close" className="le-tap w-7 h-7 grid place-items-center rounded text-fg-4 hover:bg-line hover:text-red-400 transition-colors"><svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg></button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4">Loading gearsets…</div>
      ) : fileErr ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4">{fileErr}</div>
      ) : !base ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4 text-center px-6">Connect a character once so Alexandria can find your addons folder, or set the GearSwap data folder in Settings.</div>
      ) : !parsed ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4 text-center px-6">{jobs.length ? 'Select a job.' : 'No gearset files found here. If your GearSwap folder is elsewhere, set it in Settings.'}</div>
      ) : (
        <div className="relative flex-1 min-h-0">
          <div className="h-full grid" style={{ gridTemplateColumns: mode === 'compare' ? '232px minmax(0,1fr)' : '232px minmax(0,1fr) 400px' }}>
            {/* LEFT: set tree */}
            <aside className="gs-wash min-h-0 flex flex-col overflow-hidden border-r border-line">
              <div className="shrink-0 px-2.5 pt-2.5 pb-2 border-b border-line">
                <SearchInput value={filter} onChange={setFilter} wrap="" placeholder="Filter sets…" className="w-full bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/60 transition-colors" />
              </div>
              <div className="flex-1 overflow-y-auto py-1.5">
                {displayGroups.map(({ group, sets }) => {
                  const hue = hueOf(group);
                  const gs = groupStats.get(group);
                  const open = !collapsed.has(group);
                  return (
                    <div key={group} className="px-2">
                      <button onClick={() => toggleGroup(group)} className="le-tap w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                        <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: hue }} />
                        <span className="flex-1 text-left text-[12.5px] font-semibold text-fg-2 truncate">{groupLabel(group)}</span>
                        {gs && gs.missing > 0 && <span className="text-[10px] font-bold tabular-nums px-1.5 rounded" style={{ color: '#ffb4ba', background: 'rgba(239,93,105,.16)' }}>{gs.missing}</span>}
                        {gs && gs.missing === 0 && gs.issues > 0 && <span className="text-[10px] font-bold tabular-nums px-1.5 rounded" style={{ color: '#ffd98c', background: 'rgba(234,178,76,.16)' }}>{gs.issues}</span>}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-fg-4" style={{ transition: 'transform var(--dur-base) var(--ease-out)', transform: open ? 'none' : 'rotate(-90deg)' }}><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      <div className="grid" style={{ gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows var(--dur-base) var(--ease-out)' }}>
                        <div className="overflow-hidden">
                        <div className="pb-1 pl-1.5">
                          {sets.map((s) => {
                            const st = setStatus.get(s.key);
                            const leaf = s.path.slice(1).join('.') || 'Base';
                            const on = s.key === selKey;
                            const dot = st && st.missing > 0 ? C_MISS : st && st.issues > 0 ? C_ISSUE : C_OK;
                            const fav = favs.has(s.key);
                            const pinned = pins.includes(s.key);
                            return (
                              <div key={s.key} className={`relative group/leaf flex items-center rounded-lg transition-colors ${on ? 'bg-accent/15' : 'hover:bg-accent/10'}`}>
                                <span className={`absolute left-0.5 top-1.5 bottom-1.5 w-[2.5px] rounded bg-accent transition-opacity ${on ? 'opacity-100' : 'opacity-0 group-hover/leaf:opacity-60'}`} />
                                <button onClick={() => setSelKey(s.key)} className="le-tap flex-1 min-w-0 flex items-center gap-2.5 pl-3 pr-1 py-1.5 text-left">
                                  <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />
                                  <span className={`flex-1 truncate text-[12.5px] transition-colors ${on ? 'text-fg font-medium' : 'text-fg-3 group-hover/leaf:text-fg'}`}>{leaf}</span>
                                </button>
                                <button onClick={() => togglePin(s.key)} aria-label={pinned ? 'Unpin' : 'Pin as base layer'} title={pinned ? 'Unpin from base' : 'Pin: keep as a base layer and overlay other sets onto it'}
                                  className={`w-6 h-6 grid place-items-center rounded shrink-0 transition-opacity ${pinned ? 'opacity-100' : 'opacity-0 group-hover/leaf:opacity-100 focus:opacity-100'}`}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? 'var(--gl-aug)' : 'none'} stroke={pinned ? 'var(--gl-aug)' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={pinned ? '' : 'text-fg-4 hover:text-fg-2'}><path d="M12 17v5M9 10.76V4h6v6.76l2 2.24H7z" /></svg>
                                </button>
                                <button onClick={() => toggleFav(s.key)} aria-label={fav ? 'Unfavorite' : 'Favorite'} title={fav ? 'Unfavorite' : 'Favorite'}
                                  className={`mr-1 w-6 h-6 grid place-items-center rounded shrink-0 transition-opacity ${fav ? 'opacity-100' : 'opacity-0 group-hover/leaf:opacity-100 focus:opacity-100'}`}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill={fav ? C_GOLD : 'none'} stroke={fav ? C_GOLD : 'currentColor'} strokeWidth="1.8" strokeLinejoin="round" className={fav ? '' : 'text-fg-4 hover:text-fg-2'}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9z" /></svg>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {displayGroups.length === 0 && <div className="px-4 py-6 text-[11px] text-fg-4 text-center leading-relaxed">{favFilter ? 'No favorites in this file yet. Tap the star on a set to add one.' : 'No sets match.'}</div>}

                {/* Scratch sets: provisional, not written to the file until promoted. */}
                <div className="px-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--color-line-2)' }}>
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: 'var(--gl-aug)' }} />
                    <span className="flex-1 text-[12.5px] font-semibold" style={{ color: 'var(--gl-aug)' }}>Scratch</span>
                    <button onClick={duplicateToScratch} title="Duplicate the current set to a scratch" className="le-tap w-6 h-6 grid place-items-center rounded text-fg-4 hover:text-fg-2 transition-colors"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg></button>
                    <button onClick={newScratch} title="New empty scratch set" className="le-tap w-6 h-6 grid place-items-center rounded text-fg-4 transition-colors hover:text-[var(--gl-aug)]"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
                  </div>
                  <div className="pb-1 pl-1.5">
                    {scratchList.map((sc) => {
                      const on = selKey === SCRATCH_PREFIX + sc.id;
                      return (
                        <div key={sc.id} className={`relative group/leaf flex items-center rounded-lg transition-colors ${on ? 'bg-accent/15' : 'hover:bg-accent/10'}`}>
                          <button onClick={() => setSelKey(SCRATCH_PREFIX + sc.id)} className="le-tap flex-1 min-w-0 flex items-center gap-2.5 pl-3 pr-1 py-1.5 text-left">
                            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: 'var(--gl-aug)' }} />
                            {renamingScratch === sc.id
                              ? <input autoFocus defaultValue={sc.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { renameScratch(fileKey, sc.id, e.currentTarget.value); setRenamingScratch(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingScratch(null); }} className="flex-1 min-w-0 bg-field border border-accent rounded px-1 text-[12px] text-fg outline-none" />
                              : <span className={`flex-1 truncate text-[12.5px] ${on ? 'text-fg font-medium' : 'text-fg-3'}`} onDoubleClick={(e) => { e.stopPropagation(); setRenamingScratch(sc.id); }} title="Double-click to rename">{sc.name}</span>}
                          </button>
                          <button onClick={() => void promoteScratch(sc)} title="Save as a new set in the file" className="w-6 h-6 grid place-items-center rounded text-fg-4 hover:text-accent opacity-0 group-hover/leaf:opacity-100 transition-opacity"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg></button>
                          <button onClick={() => { deleteScratch(fileKey, sc.id); if (on) setSelKey(''); }} title="Delete scratch" className="mr-1 w-6 h-6 grid place-items-center rounded text-fg-4 hover:text-red-400 opacity-0 group-hover/leaf:opacity-100 transition-opacity"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
                        </div>
                      );
                    })}
                    {scratchList.length === 0 && <div className="px-3 py-2 text-[10.5px] text-fg-4 leading-relaxed">None yet. Use + for a blank set, or the copy icon to duplicate the current one.</div>}
                  </div>
                </div>
              </div>
            </aside>

            {mode === 'compare' && parsed && (
              <GearsetCompare operands={compareOperands} resolve={resolve} iconSet={iconSet} assets={assetsAny} job={job} initialA={selKey} />
            )}

            {mode === 'edit' && <>
            {/* CENTER: paperdoll */}
            <section className="gs-wash min-h-0 overflow-y-auto">
              {sel ? (
                <div key={sel.key} className="p-5 le-view">
                  <div className="flex items-center gap-3 mb-1 min-h-[26px]">
                    <h1 className="text-[18px] font-bold text-fg leading-tight truncate" style={{ fontFamily: 'var(--gs-display)' }}><span className="text-fg-4 font-medium">{groupLabel(sel.path[0])} · </span>{sel.path.slice(1).join('.') || 'Base'}</h1>
                    <div className="ml-auto flex items-center gap-1.5 text-[10.5px]">
                      {summary.missing > 0 && <span title={`${summary.missing} item${summary.missing === 1 ? '' : 's'} missing from your bags`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border" style={{ color: '#ffb4ba', borderColor: 'rgba(239,93,105,.4)', background: 'rgba(239,93,105,.12)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg><b className="text-[12px] font-bold tabular-nums">{summary.missing}</b></span>}
                      {summary.issues > 0 && <span title={`${summary.issues} item${summary.issues === 1 ? '' : 's'} with an issue (wrong bag or augment mismatch)`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border" style={{ color: '#ffd98c', borderColor: 'rgba(234,178,76,.4)', background: 'rgba(234,178,76,.12)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2l9.3 16.1H2.7z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" /></svg><b className="text-[12px] font-bold tabular-nums">{summary.issues}</b></span>}
                      {parsed && summary.missing === 0 && summary.issues === 0 && <span title="All items in this file are owned" className="inline-flex items-center px-1.5 py-0.5 rounded-md border" style={{ color: '#a8ecc2', borderColor: 'rgba(103,207,144,.4)', background: 'rgba(103,207,144,.1)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg></span>}
                    </div>
                  </div>
                  {inhNote && <div className="flex items-center gap-1.5 text-[11.5px] text-fg-4 mb-3"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7" /></svg>Inherits from <span className="font-mono text-fg-3">{inhNote}</span>, unset slots fall through</div>}
                  {pins.filter((k) => k !== sel.key && parsed?.byKey.get(k)).length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11.5px] mb-3" style={{ color: 'var(--gl-aug)' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 17v5M9 10.76V4h6v6.76l2 2.24H7z" /></svg>
                      Overlaid on pinned: <span className="font-medium">{pins.filter((k) => k !== sel.key).map((k) => parsed?.byKey.get(k)).filter((s): s is ParsedSet => !!s).map((s) => s.path.slice(1).join('.') || 'Base').join(', ')}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-2.5 max-w-[640px]">
                    {SLOT_ORDER.map((slot) => {
                      const rs = resolved[slot];
                      const g = rs?.entry;
                      const v = g ? selValidation.get(slot) : undefined;
                      const id = v && 'id' in v ? v.id : (g && g.kind === 'item' ? resolve(g.name)?.id : undefined);
                      const st = v?.state;
                      const miss = st === 'missing' || st === 'unknown';
                      const iss = st === 'aug-mismatch' || st === 'wrong-bag';
                      const dyn = st === 'dynamic';
                      const inh = !!rs?.inherited;
                      const pinnedSlot = !!rs?.fromPinned;
                      // Augments to badge: the set's declared augments, else the augments on the owned copy
                      // (Nyame/Sortie-path gear is written as a bare name but the physical item carries a path/rank).
                      const augView = g && g.kind === 'item'
                        ? (g.augments && g.augments.length ? g.augments : (id ? owned.get(id)?.find((c) => c.aug.length)?.aug : undefined))
                        : undefined;
                      const on = slot === selSlot;
                      const ringStyle = on ? { borderColor: 'var(--color-accent)', boxShadow: '0 0 0 1px var(--color-accent), 0 0 22px -6px var(--color-accent)' }
                        : miss ? { borderColor: 'rgba(239,93,105,.5)' } : iss ? { borderColor: 'rgba(234,178,76,.45)' }
                        : dyn ? { borderColor: 'rgba(121,184,221,.45)' } : undefined;
                      if (!g) return (
                        <button key={slot} onClick={() => setSelSlot(slot)}
                          className={`le-tap le-lift group relative rounded-xl border-2 border-dashed p-2 min-h-[96px] flex flex-col items-center justify-center gap-1.5 transition-all ${on ? 'border-accent' : 'border-[rgba(232,179,92,.45)] hover:border-[var(--gl-gold)]'}`}
                          style={{ background: 'rgba(20,13,7,.4)' }}>
                          <div className="text-[8.5px] font-bold uppercase tracking-wide text-fg-4 leading-none">{SLOT_LABEL[slot]}</div>
                          <div className="w-11 h-11 rounded-lg grid place-items-center" style={{ border: '1px dashed rgba(232,179,92,.3)' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C_GOLD} strokeWidth="1.6"><path d="M12 5v14M5 12h14" /></svg>
                          </div>
                          <div className="text-[10px] font-bold" style={{ color: 'var(--gl-gold-soft)' }}>Assign</div>
                        </button>
                      );
                      return (
                        <button key={slot}
                          onMouseEnter={(e) => { if (id && id > 0) card?.hoverOpen({ id, n: g.kind === 'item' ? g.name : undefined, aug: augView }, e.currentTarget.getBoundingClientRect(), e.currentTarget, 'condensed'); }}
                          onMouseLeave={() => card?.hoverHide()}
                          onContextMenu={(e) => { if (id && id > 0) { e.preventDefault(); card?.open({ id, n: g.kind === 'item' ? g.name : undefined, aug: augView }, e.currentTarget.getBoundingClientRect(), e.currentTarget); } }}
                          onClick={() => setSelSlot(slot)}
                          className={`le-tap le-lift relative rounded-xl border-2 border-[rgba(232,179,92,.34)] bg-surface-raised hover:bg-surface-hover hover:border-accent hover:shadow-[0_0_0_1px_var(--color-accent),0_0_20px_-7px_var(--color-accent)] p-2 min-h-[96px] flex flex-col items-center justify-center gap-1.5 transition-all ${inh ? 'opacity-85' : ''}`}
                          style={ringStyle}>
                          {miss && <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full grid place-items-center text-[11px] font-extrabold" style={{ background: C_MISS, color: '#2a0608', border: '2px solid var(--color-bg)' }}>×</span>}
                          {iss && <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full grid place-items-center text-[11px] font-extrabold" style={{ background: C_ISSUE, color: '#2a1c04', border: '2px solid var(--color-bg)' }}>!</span>}
                          {inh && <span className="absolute top-1.5 left-1.5 text-fg-4"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg></span>}
                          {pinnedSlot && <span className="absolute top-1.5 right-1.5" title="From a pinned set" style={{ color: 'var(--gl-aug)' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 17v5M9 10.76V4h6v6.76l2 2.24H7z" /></svg></span>}
                          <div className="text-[8.5px] font-bold uppercase tracking-wide text-fg-4 leading-none">{SLOT_LABEL[slot]}</div>
                          <div className="w-11 h-11 rounded-lg bg-field border border-line grid place-items-center overflow-hidden">
                            {id && id > 0 ? <span className={miss ? 'grayscale opacity-45' : ''}><IconInner id={id} size={44} name={g.kind === 'item' ? g.name : ''} assets={assetsAny} bmpHas={iconSet.has(id)} /></span>
                              : dyn ? <span className="text-[13px] font-mono" style={{ color: C_DYN }}>{'{ }'}</span> : null}
                          </div>
                          {augView && augView.length > 0 && (() => { const rk = augRank(augView); return (
                            <span className="inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-[0.05em] px-1.5 py-[2px] rounded leading-none" style={{ background: 'rgba(170,120,230,.2)', border: '1px solid rgba(195,162,234,.4)' }}>
                              <span style={{ color: '#c3a2ea' }}>Aug</span>{rk != null && <span className="tabular-nums" style={{ color: '#ffd98c' }}>R{rk}</span>}
                            </span>
                          ); })()}
                          <div className="text-[11.5px] font-semibold leading-[1.2] text-fg line-clamp-2 min-h-[27px] px-0.5">{g.kind === 'item' ? g.name : <span className="font-mono" style={{ color: C_DYN }}>{g.raw}</span>}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-5 text-[10px] font-bold uppercase tracking-wide text-fg-4">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'rgba(239,93,105,.75)' }} />Missing</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'rgba(234,178,76,.75)' }} />Augment / Wrong Bag</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ border: '1.5px dashed var(--gl-gold)' }} />Empty, Assignable</span>
                    <span className="flex items-center gap-1.5"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-fg-4"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>Inherited</span>
                  </div>
                </div>
              ) : <div className="h-full grid place-items-center text-[12px] text-fg-4">Select a set.</div>}
            </section>

            {/* RIGHT: live stat breakdown (always visible) */}
            <StatsPanel base={baseTotals} preview={previewTotals} previewName={preview?.name} job={job} />
            </>}
          </div>

          {/* bottom editor (over tree + center, never the stats column) */}
          {selSlot && (
            <SlotEditor
              key={selSlot}
              slot={selSlot} entry={selEntry} v={selV} inh={selInh ? selSrc : undefined}
              id={selV && 'id' in selV ? selV.id : (selEntry && selEntry.kind === 'item' ? resolve(selEntry.name)?.id : undefined)}
              owned={owned} items={items} idToItem={idToItem} job={job} char={active}
              assets={assetsAny} iconSet={iconSet} editable={canEdit} saving={saving} saved={saved}
              fileName={active && job ? `${active.name}_${job}.lua` : ''}
              onPreview={setPreview} onClose={() => { setSelSlot(null); setPreview(null); }}
              onSwap={(name, augs) => { void applySwap(selSlot, name, augs); }}
              ownerLabel={selOwnerLabel}
              canUnassign={scratchSel ? !!scratchSel.slots[selSlot] : !!selOwner?.slotSpans?.[selSlot]} onUnassign={() => void applyUnassign(selSlot)}
              onReplaceAcross={(oldName, oldId) => setReplaceFor({ oldName, oldId, mode: 'now' })}
              onPlanAcross={(oldName, oldId) => setReplaceFor({ oldName, oldId, mode: 'plan' })}
            />
          )}

          {replaceFor && <ReplaceAcrossModal
            oldName={replaceFor.oldName} oldId={replaceFor.oldId ?? resolve(replaceFor.oldName)?.id} suggestedNew={replaceFor.suggestedNew} initialMode={replaceFor.mode ?? 'now'}
            parsed={parsed} items={items} owned={owned} idToItem={idToItem} job={job}
            assets={assetsAny} iconSet={iconSet} saving={saving}
            onCancel={() => setReplaceFor(null)}
            onApply={(newName, picks, carryAug) => { void applyBulkReplace(newName, picks, carryAug); }}
            onPlan={(newName, newId, picks) => savePlan(newName, newId, picks, replaceFor.oldName)}
          />}

          {showPlans && <PlansModal
            plans={plans} log={allPlansLog} fileKey={fileKey} owned={owned} idToItem={idToItem}
            assets={assetsAny} iconSet={iconSet} saving={saving}
            onClose={() => setShowPlans(false)}
            onApplyNow={(p) => { void applyPlanNow(p); }}
            onDelete={(p) => removePlan(fileKey, p.id)}
            onToggleAuto={(p) => updatePlan(fileKey, p.id, { auto: !p.auto })}
          />}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── stat breakdown panel ─────────────────────────

// All stat keys a view can choose from, grouped the way they'll render.
const PICK_GROUPS = [...STAT_GROUPS.map((g) => ({ title: g.title, keys: g.keys })), { title: 'Weapon', keys: WEAPON_KEYS }];
const ALL_KEYS = PICK_GROUPS.flatMap((g) => g.keys);

// Stat labels stay on ONE line by reducing font size (keeping letter shapes, no horizontal squish). To avoid a
// ragged look, every label inside one group's grid is sized the SAME: the smallest size the longest label in
// that grid needs. Measured per `.gs-fitgrid` so a long name only shrinks its own group, not the whole panel.
const FIT_MAX = 10, FIT_MIN = 7;
function fitGrid(grid: HTMLElement) {
  const labs = grid.querySelectorAll<HTMLElement>('.gs-fit');
  let need = FIT_MAX;
  labs.forEach((l) => {
    let s = FIT_MAX;
    l.style.fontSize = `${s}px`;
    while (l.scrollWidth > l.clientWidth && s > FIT_MIN) { s -= 0.5; l.style.fontSize = `${s}px`; }
    if (s < need) need = s;
  });
  labs.forEach((l) => { l.style.fontSize = `${need}px`; });
}

function StatsPanel({ base: baseProp, preview: previewProp, previewName, job }: { base: StatMods; preview: StatMods | null; previewName?: string; job: string }) {
  // Add the derived True Damage Taken stats (DT folded into PDT/MDT) for display.
  const base = useMemo(() => withTrueDamageTaken(baseProp), [baseProp]);
  const preview = useMemo(() => (previewProp ? withTrueDamageTaken(previewProp) : null), [previewProp]);
  const cur = preview ?? base;

  const vstore = useViews();
  const activeView = vstore.activeId ? vstore.views.find((v) => v.id === vstore.activeId) ?? null : null;
  const allowed = activeView ? new Set(activeView.keys) : null;
  const collapsedSet = new Set(vstore.collapsed);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id?: string; name: string; keys: Set<string> }>(null);
  const openNew = () => { setSwitchOpen(false); setEditing({ name: '', keys: new Set(activeView ? activeView.keys : ALL_KEYS) }); };
  const openEdit = (v: StatView) => { setSwitchOpen(false); setEditing({ id: v.id, name: v.name, keys: new Set(v.keys) }); };

  // Stats table controls: free-text filter, category filter, click-to-sort column.
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [sortKey, setSortKey] = useState<'cat' | 'label' | 'val' | 'delta'>('cat');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const sortBy = (k: 'cat' | 'label' | 'val' | 'delta') => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(1); } };
  // While previewing a swap, default to showing only the stats that changed; the banner toggles back to all.
  const [changesOnly, setChangesOnly] = useState(true);
  const onlyChanged = !!preview && changesOnly;
  const filterKeys = (keys: string[]) => onlyChanged ? keys.filter((k) => (base[k] ?? 0) !== (cur[k] ?? 0)) : keys;

  const pick = (keys: string[], attr: boolean) => allowed ? keys.filter((k) => allowed.has(k))
    : attr ? keys.filter((k) => k !== 'MP' || (base.MP ?? 0) !== 0 || (cur.MP ?? 0) !== 0)
      : keys.filter((k) => (base[k] ?? 0) !== 0 || (cur[k] ?? 0) !== 0);
  // Surface any recognized stat the set carries that no curated group claims (base-description skills, niche
  // mods), routing each into its natural group by name rather than dumping them all under Utility. Skipped
  // when a custom display set is active.
  const extras = allowed ? [] : [...new Set([...Object.keys(base), ...Object.keys(cur)])].filter((k) => !CLAIMED.has(k)).sort((a, b) => a.localeCompare(b));
  const extrasByGroup = new Map<string, string[]>();
  for (const k of extras) { const g = bucketStat(k); const a = extrasByGroup.get(g) ?? []; a.push(k); extrasByGroup.set(g, a); }
  const sections = STAT_GROUPS.map((gp) => {
    let keys = pick(gp.keys, gp.style === 'attr');
    const ex = extrasByGroup.get(gp.title);
    if (ex?.length) keys = [...keys, ...ex];
    return { gp, keys };
  });
  const weaponRows = pick(WEAPON_KEYS, false);
  const anything = sections.some((s) => s.keys.length) || weaponRows.length;

  // Flatten the (display-set filtered) sections + weapon into table rows, then apply the table's own
  // search / category filter / sort. The Delta column only appears while a swap preview is active.
  const showDelta = !!preview;
  const flatRows = [
    ...sections.flatMap(({ gp, keys }) => keys.map((k) => ({ k, cat: gp.title }))),
    ...weaponRows.map((k) => ({ k, cat: 'Weapon' })),
  ];
  const catsPresent = CAT_ORDER.filter((c) => flatRows.some((r) => r.cat === c));
  const qLc = q.trim().toLowerCase();
  const tableRows = flatRows
    .filter((r) => (catFilter === 'all' || r.cat === catFilter) && (!qLc || statLabel(r.k).toLowerCase().includes(qLc)))
    .map((r) => { const b = base[r.k] ?? 0, c = cur[r.k] ?? 0; return { ...r, b, c, d: c - b }; })
    .sort((a, b2) => {
      let r: number;
      if (sortKey === 'label') r = statLabel(a.k).localeCompare(statLabel(b2.k));
      else if (sortKey === 'val') r = Math.abs(a.c) - Math.abs(b2.c);
      else if (sortKey === 'delta') r = Math.abs(a.d) - Math.abs(b2.d);
      else r = (CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b2.cat)) || statLabel(a.k).localeCompare(statLabel(b2.k));
      return r * sortDir;
    });

  // Drag-paint multi-select (same shape as the inventory grid / sell list): pointer-down sets add-vs-remove from
  // that key's current state, then dragging across keys paints the rest. A plain click still toggles one.
  const setKeyPaint = (k: string, add: boolean) => setEditing((e) => { if (!e) return e; const keys = new Set(e.keys); if (add) keys.add(k); else keys.delete(k); return { ...e, keys }; });
  const paintRef = useRef<{ add: boolean } | null>(null);
  const paintDown = (k: string) => {
    const add = !editing?.keys.has(k);
    paintRef.current = { add };
    setKeyPaint(k, add);
    const end = () => { paintRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const paintEnter = (k: string) => { if (paintRef.current) setKeyPaint(k, paintRef.current.add); };
  const toggleAll = () => setEditing((e) => (e ? { ...e, keys: e.keys.size >= ALL_KEYS.length ? new Set() : new Set(ALL_KEYS) } : e));
  const setGroupKeys = (gkeys: string[], on: boolean) => setEditing((e) => { if (!e) return e; const keys = new Set(e.keys); for (const k of gkeys) { if (on) keys.add(k); else keys.delete(k); } return { ...e, keys }; });
  const saveView = () => { if (!editing) return; const keys = [...editing.keys]; const name = editing.name.trim() || 'Custom'; if (editing.id) updateView(editing.id, { name, keys }); else addView(name, keys); setEditing(null); };

  // After every render, size each group's labels uniformly (and refit on panel width changes).
  const bodyRef = useRef<HTMLDivElement>(null);
  const refit = () => bodyRef.current?.querySelectorAll<HTMLElement>('.gs-fitgrid').forEach(fitGrid);
  useLayoutEffect(() => { refit(); });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <aside className="gs-wash relative min-h-0 flex flex-col overflow-hidden border-l border-line">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <h2 className="text-[14.5px] font-bold text-fg tracking-wide" style={{ fontFamily: 'var(--gs-display)' }}>GEAR STATS</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setSwitchOpen((o) => !o)} title="Switch display set" className="le-tap inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line bg-field text-[11px] font-semibold text-fg-2 hover:border-accent/60 transition-colors">
            <span className="truncate max-w-[104px]">{activeView ? activeView.name : 'All stats'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button onClick={openNew} title="Customize stats / new display set" className="le-tap w-7 h-7 grid place-items-center rounded-md border border-line bg-field text-fg-4 hover:text-accent transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
          </button>
        </div>
        {switchOpen && <>
          <div className="fixed inset-0 z-40" onClick={() => setSwitchOpen(false)} />
          <div className="absolute right-3 top-[46px] z-50 w-[224px] rounded-lg border border-line bg-popover shadow-2xl py-1 le-pop">
            <button onClick={() => { setActiveView(null); setSwitchOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-surface-hover ${!activeView ? 'text-fg font-semibold' : 'text-fg-3'}`}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: !activeView ? 'var(--color-accent)' : 'transparent' }} />All stats
            </button>
            {vstore.views.map((v) => (
              <div key={v.id} className={`group/vr flex items-center pr-1 rounded hover:bg-surface-hover ${vstore.activeId === v.id ? 'bg-accent/10' : ''}`}>
                <button onClick={() => { setActiveView(v.id); setSwitchOpen(false); }} className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-[12px] text-left ${vstore.activeId === v.id ? 'text-fg font-semibold' : 'text-fg-3'}`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vstore.activeId === v.id ? 'var(--color-accent)' : 'transparent' }} /><span className="truncate">{v.name}</span>
                </button>
                <button onClick={() => openEdit(v)} aria-label="Edit" className="w-6 h-6 grid place-items-center rounded text-fg-4 hover:text-fg opacity-0 group-hover/vr:opacity-100 transition-opacity"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button>
                <button onClick={() => removeView(v.id)} aria-label="Delete" className="w-6 h-6 grid place-items-center rounded text-fg-4 hover:text-red-400 opacity-0 group-hover/vr:opacity-100 transition-opacity"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
              </div>
            ))}
            <div className="h-px bg-line my-1" />
            <button onClick={openNew} className="w-full px-3 py-1.5 text-[12px] text-left font-semibold text-accent hover:bg-surface-hover">＋ New display set…</button>
          </div>
        </>}
      </div>
      {preview && <div className="le-fade shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-[10.5px] font-semibold border-b border-line" style={{ color: 'var(--gl-gold-soft)', background: 'rgba(232,179,92,.07)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
        Previewing <span className="text-fg">{previewName}</span>
        <div className="ml-auto flex rounded-md overflow-hidden border border-line">
          <button onClick={() => setChangesOnly(true)} className="le-tap px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide transition-colors" style={changesOnly ? { color: '#1c1206', background: 'var(--gl-gold)' } : { color: 'var(--color-fg-4)', background: 'var(--color-field)' }}>Changes</button>
          <button onClick={() => setChangesOnly(false)} className="le-tap px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide transition-colors" style={!changesOnly ? { color: '#1c1206', background: 'var(--gl-gold)' } : { color: 'var(--color-fg-4)', background: 'var(--color-field)' }}>All</button>
        </div>
      </div>}
      {!anything ? (
        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          <div className="py-10 text-center text-[11.5px] text-fg-4 leading-relaxed">{allowed ? 'This display set has no stats selected, or none apply here. Edit it from the switcher.' : 'No stat data for this set yet. If item stats haven\'t built, run the item index build. Dynamic (Lua) slots aren\'t counted.'}</div>
        </div>
      ) : (
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-3.5 py-3">
          {onlyChanged && ![...sections.flatMap((s) => s.keys), ...weaponRows].some((k) => (base[k] ?? 0) !== (cur[k] ?? 0)) && (
            <div className="py-8 text-center text-[11.5px] text-fg-4">No stats change with this swap. <button onClick={() => setChangesOnly(false)} className="text-accent font-semibold">Show all</button></div>
          )}
          {[...sections.map((s) => ({ title: s.gp.title, keys: filterKeys(s.keys) })), { title: 'Weapon', keys: filterKeys(weaponRows) }]
            .filter((g) => g.keys.length)
            .map((g) => {
              const isCol = collapsedSet.has(g.title);
              const catColor = CAT_DOT[g.title] ?? 'var(--color-fg-3)';
              return (
                <div key={g.title} className="mb-3.5">
                  <button onClick={() => toggleCollapsed(g.title)} className="le-tap w-full flex items-center gap-2 mb-2 px-0.5">
                    <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: CAT_DOT[g.title] ?? 'var(--color-fg-4)' }} />
                    <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-fg-3">{g.title}</span>
                    <span className="flex-1 h-px" style={{ background: 'var(--color-line-2)' }} />
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-fg-4" style={{ transition: 'transform var(--dur-base) var(--ease-out)', transform: isCol ? 'rotate(-90deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {!isCol && (
                    <div className="gs-fitgrid grid gap-1.5" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
                      {g.keys.map((k) => {
                        const b = base[k] ?? 0, c = cur[k] ?? 0, d = c - b;
                        const good = isGood(k, d);
                        const cap = capInfo(k, c, job);
                        const valColor = cap?.over ? 'var(--gl-down)' : cap?.atCap ? 'var(--gl-up)' : 'var(--color-fg)';
                        return (
                          <div key={k} className={`rounded-lg px-2.5 py-2 flex flex-col gap-1 ${c === 0 && !d ? 'opacity-45' : ''}`}
                            style={{ background: 'var(--color-field)', border: '1px solid var(--color-line-2)', borderLeft: `2px solid ${d ? (good ? 'var(--gl-up)' : 'var(--gl-down)') : 'transparent'}`, transition: 'background-color var(--dur-base) var(--ease-out)' }}>
                            <span className="gs-fit block whitespace-nowrap font-semibold uppercase tracking-[0.02em] leading-none" style={{ color: catColor, fontSize: FIT_MAX }} title={statLabel(k)}>{statLabel(k)}</span>
                            <span className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="font-mono text-[17px] font-bold tabular-nums leading-none" style={{ color: valColor }}>{fmtStat(k, c)}</span>
                              {cap && <span className="font-mono text-[11px] font-semibold text-fg-4 tabular-nums self-center">/ {Math.abs(cap.cap)}{isPct(k) ? '%' : ''}</span>}
                              {d ? <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: good ? 'var(--gl-up)' : 'var(--gl-down)' }}>{d > 0 ? '+' : ''}{d}{isPct(k) ? '%' : ''}</span> : null}
                              {cap && (cap.atCap || cap.over) && <span className="self-center text-[9px] font-extrabold uppercase tracking-[0.1em]" style={{ color: cap.over ? 'var(--gl-down)' : 'var(--gl-up)' }}>{cap.over ? 'Over Cap' : 'Capped'}</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {editing && (
        <div className="absolute inset-0 z-30 flex flex-col le-fade" style={{ background: 'rgba(16,10,5,.97)', backdropFilter: 'blur(2px)' }}>
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-line">
            <span className="text-[13px] font-bold text-fg" style={{ fontFamily: 'var(--gs-display)' }}>{editing.id ? 'Edit display set' : 'New display set'}</span>
            <button onClick={() => setEditing(null)} aria-label="Close" className="ml-auto w-7 h-7 grid place-items-center rounded-md border border-line bg-field text-fg-4 hover:text-accent transition-colors"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          </div>
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <input value={editing.name} onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))} placeholder="Name this display set…" className="flex-1 h-8 rounded-md bg-field border border-line text-fg-2 px-2.5 text-[12px] outline-none focus:border-accent placeholder-fg-4" />
            <button onClick={toggleAll} className="le-tap shrink-0 h-8 px-3 text-[11px] font-bold rounded-md border border-line bg-field text-fg-2 hover:border-accent hover:text-fg transition-colors">{editing.keys.size >= ALL_KEYS.length ? 'Clear all' : 'Select all'}</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2.5">
            {PICK_GROUPS.map((g) => (
              <div key={g.title} className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--gl-gold)' }}>{g.title}</span>
                  <span className="flex-1" />
                  <button onClick={() => setGroupKeys(g.keys, true)} className="le-tap text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 transition-colors">All</button>
                  <button onClick={() => setGroupKeys(g.keys, false)} className="le-tap text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-fg-4 hover:text-fg-2 hover:bg-surface-hover transition-colors">None</button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {g.keys.map((k) => { const on = editing.keys.has(k); return (
                    <button key={k} onPointerDown={() => paintDown(k)} onPointerEnter={() => paintEnter(k)} className="flex items-center gap-2 py-1 text-left select-none touch-none">
                      <Check on={on} /><span className={`text-[11.5px] truncate ${on ? 'text-fg-2' : 'text-fg-4'}`}>{statLabel(k)}</span>
                    </button>
                  ); })}
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-line">
            {editing.id && <button onClick={() => { removeView(editing.id!); setEditing(null); }} className="le-tap px-3 py-1.5 text-[11.5px] font-semibold rounded-md border border-line text-red-400 hover:border-red-400/50 transition-colors">Delete</button>}
            <span className="text-[10.5px] text-fg-4">{editing.keys.size} selected</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setEditing(null)} className="le-tap px-3 py-1.5 text-[11.5px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
              <button disabled={editing.keys.size === 0} onClick={saveView} className="le-tap px-4 py-1.5 text-[11.5px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40">{editing.id ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ───────────────────────── slot editor (bottom panel) ─────────────────────────
const BAG_SHORT: Record<number, string> = { 0: 'Inv', 8: 'WD1', 10: 'WD2', 11: 'WD3', 12: 'WD4', 13: 'WD5', 14: 'WD6', 15: 'WD7', 16: 'WD8' };

function SlotEditor({ slot, entry, v, inh, id, owned, items, idToItem, job, char, assets, iconSet, editable, saving, saved, fileName, ownerLabel, onPreview, onClose, onSwap, onReplaceAcross, onPlanAcross, canUnassign, onUnassign }: {
  slot: SlotKey; entry?: GearEntry; v?: SlotValidation; inh?: string; id?: number;
  owned: Map<number, OwnedCopy[]>; items: ItemName[]; idToItem: Map<number, ItemName>; job: string; char?: KnownChar;
  assets?: string; iconSet: Set<number>; editable: boolean; saving: boolean; saved: boolean; fileName: string; ownerLabel?: string;
  onPreview: (p: PreviewPiece | null) => void; onClose: () => void; onSwap: (name: string, augments?: string[]) => void;
  onReplaceAcross: (oldName: string, oldId?: number) => void; onPlanAcross: (oldName: string, oldId?: number) => void;
  canUnassign: boolean; onUnassign: () => void;
}) {
  const dyn = entry?.kind === 'dynamic';
  const name = entry ? (entry.kind === 'item' ? entry.name : entry.raw) : '';
  const empty = !entry;
  const want = entry && entry.kind === 'item' ? (entry.augments ?? []) : [];
  const copies = id ? (owned.get(id) ?? []) : [];

  const [pick, setPick] = useState('');
  const [pickAll, setPickAll] = useState(false);
  // Clicking a candidate/roll PINS it (preview stays put so you can scroll + compare); a confirm button writes.
  const [pinned, setPinned] = useState<{ id?: number; name: string; augs?: string[] } | null>(null);
  const restore = () => onPreview(pinned ? { slot, id: pinned.id, augs: pinned.augs, name: pinned.name } : null);
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState<string | null>(null);
  const dests = useMemo(() => usableGearBags(char).filter((b) => b.free > 0), [char]);
  useEffect(() => { onPreview(null); setMoveMsg(null); }, [slot]);
  const doMove = async (fromBag: number, toBag: number) => {
    if (!id || moving) return;
    setMoving(true); setMoveMsg(null);
    try { await moveGearToBag(char, { id, n: name }, fromBag, toBag); setMoveMsg(`Moving ${name} to ${BAG_SHORT[toBag] ?? bagLabel(toBag)}…`); }
    catch (e) { setMoveMsg(e instanceof Error ? e.message : 'move failed'); }
    finally { setMoving(false); }
  };

  const candidates = useMemo(() => {
    const bit = SLOT_BIT[slot];
    const q = pick.trim().toLowerCase();
    const out: { id: number; name: string; count: number }[] = [];
    const pushIf = (it: ItemName) => {
      if (!it.sl || !(it.sl & bit)) return;
      if (job && it.jb && !jobEquips(it.id, job)) return;
      if (q && !nameMatches(it.n, q)) return;
      out.push({ id: it.id, name: it.n, count: owned.get(it.id)?.length ?? 0 });
    };
    if (pickAll) {
      for (const it of items) { pushIf(it); if (out.length >= 120) break; }
    } else {
      for (const [oid] of owned) { const it = idToItem.get(oid); if (it) pushIf(it); if (out.length >= 120) break; }
    }
    return out.sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  }, [slot, pick, pickAll, items, owned, idToItem, job]);

  const stColor = !v ? 'var(--color-fg-4)' : stateColor(v.state);
  const stLabel = empty ? 'Nothing assigned' : v ? stateText(v) : '';

  return (
    <>
      <div onClick={onClose} className="absolute z-20 top-0 bottom-0 left-0 le-fade" style={{ right: 400, background: 'rgba(6,4,2,.4)' }} />
      <div className="absolute z-30 bottom-0 left-0 flex flex-col le-rise" style={{ right: 400, height: '62%', background: 'linear-gradient(180deg,rgba(36,24,15,.98),rgba(20,14,8,.99))', borderTop: '1px solid var(--color-line-2)', boxShadow: '0 -28px 70px -22px rgba(0,0,0,.92)' }}>
        {/* header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-line">
          <div className="w-12 h-12 rounded-xl bg-field border border-line grid place-items-center overflow-hidden shrink-0">
            {id && id > 0 ? <IconInner id={id} size={48} name={entry && entry.kind === 'item' ? entry.name : ''} assets={assets} bmpHas={iconSet.has(id)} />
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C_GOLD} strokeWidth="1.6"><path d="M12 5v14M5 12h14" /></svg>}
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-fg-4">{SLOT_LABEL[slot]}{inh ? ` · inherited from ${inh}` : ''}{ownerLabel ? <span style={{ color: 'var(--gl-aug)' }}> · editing {ownerLabel}</span> : ''}</div>
            <div className="flex items-center gap-3">
              <div className="text-[18px] font-bold leading-tight" style={{ fontFamily: 'var(--gs-display)', color: dyn ? C_DYN : 'var(--color-fg)' }}>{empty ? 'Empty slot' : name}</div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: empty ? 'var(--gl-gold-soft)' : stColor }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: empty ? 'var(--gl-gold-soft)' : stColor }} />{stLabel}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canUnassign && !dyn && <button onClick={onUnassign} disabled={saving} title="Remove this piece from the set" className="le-tap inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line bg-field text-[11px] font-semibold text-fg-3 hover:border-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
              Clear
            </button>}
            {!empty && !dyn && entry && entry.kind === 'item' && <button onClick={() => onPlanAcross(name, id)} title="Plan a future upgrade to succeed this piece" className="le-tap inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line bg-field text-[11px] font-semibold text-fg-3 hover:border-accent hover:text-fg transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>
              Plan
            </button>}
            {!empty && !dyn && entry && entry.kind === 'item' && <button onClick={() => onReplaceAcross(name, id)} title="Replace this item everywhere it appears" className="le-tap inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line bg-field text-[11px] font-semibold text-fg-3 hover:border-accent hover:text-fg transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
              Replace
            </button>}
            <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg border border-line bg-field grid place-items-center text-fg-4 hover:text-accent transition-colors"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* left: context + owned copies + augments */}
          <div className="border-r border-line px-5 py-4 overflow-y-auto">
            {dyn ? (
              <>
                <div className="note rounded-lg px-3 py-2.5 text-[12px] leading-relaxed mb-3">This slot is a Lua value, resolved at runtime. It can't be checked against your bags or edited here. Edit it by hand in the file.</div>
                <div className="font-mono text-[11.5px] rounded-lg px-3 py-2 break-all" style={{ color: C_DYN, background: 'rgba(121,184,221,.1)', border: '1px solid rgba(121,184,221,.25)' }}>{entry && entry.kind === 'dynamic' ? entry.raw : ''}</div>
              </>
            ) : <>
              {empty && <div className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed mb-3.5" style={{ color: 'var(--gl-gold-soft)', border: '1px solid rgba(232,179,92,.35)', background: 'rgba(232,179,92,.09)' }}><b className="font-extrabold">This slot is empty.</b> Search any {SLOT_LABEL[slot].toLowerCase()} on the right, hover to preview its stats, then click to write it in. Flip to <b>All items</b> to define gear you don't own yet.</div>}
              {!empty && v && (v.state === 'missing' || v.state === 'unknown') && <div className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed mb-3.5" style={{ color: '#ffc0c5', border: '1px solid rgba(239,93,105,.35)', background: 'rgba(239,93,105,.1)' }}><b className="font-extrabold">Defined, but no copy in your bags.</b> Keep it as a plan, or swap to something you own. This slot is fully editable either way.</div>}

              {!empty && (
                <div className="mb-4">
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Owned copies</span>
                    {copies.length > 1 && <span className="text-[10px] text-fg-4">{copies.length} rolls, click one to use</span>}
                  </div>
                  {copies.length === 0 ? (
                    <div className="text-[12px] rounded-lg px-3 py-2 leading-relaxed" style={{ color: '#ffc0c5', background: 'rgba(239,93,105,.1)', border: '1px solid rgba(239,93,105,.25)' }}>No copies in any bag.</div>
                  ) : copies.map((c, i) => {
                    const eq = EQUIP_BAGS.has(c.bag);
                    const usable = editable && eq && !!entry && entry.kind === 'item';
                    const cur = eq && want.length > 0 && want.length === c.aug.length && want.every((w) => c.aug.map((x) => x.toLowerCase()).includes(w.toLowerCase()));
                    const inner = (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: eq ? 'var(--color-accent)' : C_ISSUE }} />
                          <span className="text-[11.5px] font-semibold text-fg-3 shrink-0">{bagLabel(c.bag)}</span>
                          {cur && <span className="text-[9px] font-bold uppercase shrink-0" style={{ color: 'var(--color-accent)' }}>in set</span>}
                          <span className="flex-1" />
                          {usable && <span className="text-[9px] font-bold uppercase tracking-wide shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-accent)' }}>Use this roll</span>}
                        </div>
                        {c.aug.length > 0
                          ? <div className="mt-1 pl-4 flex flex-col gap-0.5">{c.aug.map((a, k) => <RichDescription key={k} text={a} className="text-[11px] leading-snug break-words" />)}</div>
                          : <div className="mt-1 pl-4 text-[10px] text-fg-4">{eq ? 'no augments' : 'not equippable here'}</div>}
                      </>
                    );
                    return usable
                      ? <button key={i} disabled={saving} onMouseEnter={() => onPreview({ slot, id, augs: c.aug, name: `${name} (${bagLabel(c.bag)})` })} onMouseLeave={restore} onClick={() => { const a = c.aug.length ? c.aug : undefined; setPinned({ id, name, augs: a }); onPreview({ slot, id, augs: a, name: `${name} (${bagLabel(c.bag)})` }); }} className={`group w-full flex flex-col items-stretch px-2.5 py-2 rounded-lg border mb-1.5 text-left transition-colors disabled:opacity-50 ${cur ? 'bg-accent/10 border-accent/40' : 'bg-surface border-line hover:border-accent/40 hover:bg-surface-hover'}`}>{inner}</button>
                      : (
                        <div key={i} className="flex flex-col items-stretch px-2.5 py-2 rounded-lg bg-surface border mb-1.5" style={{ borderColor: eq ? 'var(--color-line)' : 'rgba(234,178,76,.4)' }}>
                          {inner}
                          {!eq && (
                            <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--color-line)' }}>
                              {!char?.online ? <span className="text-[10px] text-fg-4">Connect this character to move it into a usable bag.</span>
                                : !canReachBag(char, c.bag) ? <span className="text-[10px]" style={{ color: C_ISSUE }}>In {bagLabel(c.bag)}, visit a Mog House or Nomad Moogle to move it.</span>
                                  : dests.length === 0 ? <span className="text-[10px] text-fg-4">No inventory or wardrobe has a free slot.</span>
                                    : <div className="flex flex-wrap items-center gap-1">
                                      <span className="text-[10px] font-semibold mr-0.5" style={{ color: 'var(--gl-gold-soft)' }}>Move to usable bag:</span>
                                      {dests.map((d) => (
                                        <button key={d.id} disabled={moving} onClick={() => doMove(c.bag, d.id)} title={`${bagLabel(d.id)} · ${d.free} free`}
                                          className="le-tap px-1.5 py-0.5 rounded text-[10px] font-bold border border-line bg-field text-fg-3 hover:border-accent hover:text-fg transition-colors disabled:opacity-50">{BAG_SHORT[d.id] ?? bagLabel(d.id)}</button>
                                      ))}
                                    </div>}
                            </div>
                          )}
                        </div>
                      );
                  })}
                  {moveMsg && <div className="mt-1 text-[10.5px] font-semibold" style={{ color: moving ? 'var(--color-accent)' : moveMsg.toLowerCase().includes('moving') ? C_OK : C_ISSUE }}>{moveMsg}</div>}
                </div>
              )}

            </>}
          </div>

          {/* right: picker (full catalog) */}
          {!dyn && (
            <div className="px-5 py-4 flex flex-col min-h-0">
              <div className="relative flex mb-2 p-0.5 rounded-lg bg-field border border-line">
                {([['OWNED', false], ['ALL', true]] as const).map(([label, v]) => (
                  <button key={label} onClick={() => setPickAll(v)} className="le-tap relative flex-1 h-7 rounded-md grid place-items-center text-[11.5px] font-bold">
                    {pickAll === v && <motion.span layoutId="gsPickSeg" transition={T_INDICATOR} className="absolute inset-0 rounded-md bg-accent/25 border border-accent/70" />}
                    <span className={`relative z-10 transition-colors ${pickAll === v ? 'text-fg' : 'text-fg-4'}`}>{label}</span>
                  </button>
                ))}
              </div>
              <input value={pick} onChange={(e) => setPick(e.target.value)} placeholder={`Search any ${SLOT_LABEL[slot].toLowerCase()}…`} className="w-full h-9 rounded-lg bg-field border border-line text-fg-2 px-3 text-[12.5px] outline-none focus:border-accent placeholder-fg-4 mb-2 shrink-0" />
              <div className="flex-1 min-h-0 overflow-y-auto">
                {candidates.length === 0 ? <div className="text-[11px] text-fg-4 px-2 py-6 text-center">{pickAll ? `No ${SLOT_LABEL[slot].toLowerCase()} match.` : <>No owned {SLOT_LABEL[slot].toLowerCase()} match. Flip to <b style={{ color: 'var(--gl-gold-soft)' }}>All items</b> to plan ahead.</>}</div> :
                  candidates.map((c) => {
                    const copies = owned.get(c.id);
                    const augs = copies?.find((x) => EQUIP_BAGS.has(x.bag) && x.aug.length)?.aug ?? copies?.find((x) => x.aug.length)?.aug;
                    const sel = pinned?.id === c.id;
                    return (
                      <button key={c.id} disabled={saving}
                        onMouseEnter={() => onPreview({ slot, id: c.id, augs, name: c.name })} onMouseLeave={restore}
                        onClick={() => { setPinned({ id: c.id, name: c.name, augs }); onPreview({ slot, id: c.id, augs, name: c.name }); }}
                        className={`le-tap w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg disabled:opacity-50 transition-colors text-left border ${sel ? 'bg-accent/20 border-accent' : 'border-transparent hover:bg-accent/10 hover:border-accent/40'}`}>
                        <span className="w-6 h-6 rounded bg-field border border-line grid place-items-center overflow-hidden shrink-0"><IconInner id={c.id} size={22} name={c.name} assets={assets} bmpHas={iconSet.has(c.id)} /></span>
                        <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2">{c.name}</span>
                        {augs && augs.length > 0 && <span className="text-[9px] font-bold uppercase tracking-wide px-1 rounded shrink-0" style={{ color: 'var(--gl-aug)', background: 'rgba(195,162,234,.16)' }}>Aug{augRank(augs) != null ? ` R${augRank(augs)}` : ''}</span>}
                        {c.count > 0 ? <span className="text-[9.5px] font-bold font-mono px-1.5 rounded shrink-0" style={{ color: '#a8ecc2', background: 'rgba(103,207,144,.15)' }}>×{c.count}</span> : <span className="text-[9.5px] font-bold uppercase text-fg-4 shrink-0">plan</span>}
                      </button>
                    );
                  })}
              </div>
              {pinned?.augs && pinned.augs.length > 0 && (
                <div className="shrink-0 mt-2 rounded-md px-2.5 py-1.5 text-[10.5px] leading-snug" style={{ color: 'var(--gl-aug)', background: 'rgba(195,162,234,.08)', border: '1px solid rgba(195,162,234,.22)' }}>
                  <div className="font-bold uppercase tracking-wide text-[9px] mb-0.5 text-fg-4">Augments on this copy</div>
                  {pinned.augs.map((a, i) => <div key={i} className="break-words font-mono">{a}</div>)}
                </div>
              )}
              {pinned && (
                <div className="le-rise shrink-0 mt-2 flex items-center gap-2">
                  <button disabled={saving} onClick={() => { onSwap(pinned.name, pinned.augs); setPinned(null); onPreview(null); }} className="le-tap flex-1 min-w-0 h-9 rounded-lg bg-accent text-on-accent text-[12px] font-bold hover:bg-accent-hover transition-colors disabled:opacity-50 px-3 truncate">{empty ? 'Assign' : 'Swap to'} {pinned.name}</button>
                  <button onClick={() => { setPinned(null); onPreview(null); }} aria-label="Clear selection" className="shrink-0 w-9 h-9 grid place-items-center rounded-lg border border-line bg-field text-fg-4 hover:text-fg-2 transition-colors"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// quick scalar for the candidate net chip (weights the stats melee gear is usually picked for)
// Odyssey/Unity rank, which the addon appends to a "Path: X (R16)" augment line.
function augRank(augs?: string[]): number | null {
  if (!augs) return null;
  for (const a of augs) { const m = a.match(/\(R(\d+)\)/) || a.match(/\bR(\d+)\b/) || a.match(/rank[:\s]+(\d+)/i); if (m) return Number(m[1]); }
  return null;
}


// ───────────────────────── replace-across-sets modal ─────────────────────────
function ReplaceAcrossModal({ oldName, oldId, suggestedNew, initialMode, parsed, items, owned, idToItem, job, assets, iconSet, saving, onCancel, onApply, onPlan }: {
  oldName: string; oldId?: number; suggestedNew?: string; initialMode?: 'now' | 'plan';
  parsed: ParsedGearsets; items: ItemName[]; owned: Map<number, OwnedCopy[]>; idToItem: Map<number, ItemName>; job: string;
  assets?: string; iconSet: Set<number>; saving: boolean;
  onCancel: () => void; onApply: (newName: string, picks: { setKey: string; slot: SlotKey }[], carryAug: boolean) => void;
  onPlan: (newName: string, newId: number | undefined, picks: { setKey: string; slot: SlotKey }[]) => void;
}) {
  const [mode, setMode] = useState<'now' | 'plan'>(initialMode ?? 'now');
  const occ = useMemo(() => findOccurrences(parsed, oldName.toLowerCase()), [parsed, oldName]);
  const oldSl = (oldId != null ? idToItem.get(oldId)?.sl : undefined) ?? items.find((i) => i.n.toLowerCase() === oldName.toLowerCase())?.sl ?? 0;
  const nameToId = (n: string) => items.find((i) => i.n.toLowerCase() === n.toLowerCase())?.id;

  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState(suggestedNew ?? '');
  const [newId, setNewId] = useState<number | undefined>(suggestedNew ? nameToId(suggestedNew) : undefined);
  const [carryAug, setCarryAug] = useState(false);
  const [sel, setSel] = useState<Set<number>>(() => new Set(occ.map((_, i) => i)));
  useEffect(() => { setSel(new Set(occ.map((_, i) => i))); }, [occ.length]);

  const candidates = useMemo(() => {
    const q = pick.trim().toLowerCase();
    const out: { id: number; name: string; count: number }[] = [];
    for (const it of items) {
      if (!it.sl || !(oldSl && (it.sl & oldSl))) continue;
      if (it.n.toLowerCase() === oldName.toLowerCase()) continue;
      if (job && it.jb && !jobEquips(it.id, job)) continue;
      if (q && !nameMatches(it.n, q)) continue;
      out.push({ id: it.id, name: it.n, count: owned.get(it.id)?.length ?? 0 });
      if (out.length >= 140) break;
    }
    return out.sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  }, [pick, items, oldSl, oldName, owned, job]);

  // group occurrences by set for the list
  const bySet = useMemo(() => {
    const m = new Map<string, { path: string[]; rows: { i: number; slot: SlotKey; augments?: string[] }[] }>();
    occ.forEach((o, i) => { const e = m.get(o.setKey) ?? { path: o.path, rows: [] }; e.rows.push({ i, slot: o.slot, augments: o.augments }); m.set(o.setKey, e); });
    return [...m.entries()];
  }, [occ]);

  const toggle = (i: number) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const allOn = sel.size === occ.length && occ.length > 0;
  const setGroup = (rows: { i: number }[], on: boolean) => setSel((s) => { const n = new Set(s); for (const r of rows) { if (on) n.add(r.i); else n.delete(r.i); } return n; });
  const picks = useMemo(() => [...sel].map((i) => ({ setKey: occ[i].setKey, slot: occ[i].slot })), [sel, occ]);
  const ready = !!newName && picks.length > 0 && !saving;

  const chooseNew = (n: string, idv?: number) => { setNewName(n); setNewId(idv); };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-6">
      <div onClick={onCancel} className="absolute inset-0 le-fade" style={{ background: 'rgba(6,4,2,.6)', backdropFilter: 'blur(2px)' }} />
      <div className="relative z-10 w-full max-w-[840px] flex flex-col rounded-2xl le-rise overflow-hidden" style={{ height: '86%', maxHeight: 640, background: 'linear-gradient(180deg,rgba(38,26,16,.99),rgba(20,14,8,1))', border: '1px solid var(--color-line-2)', boxShadow: '0 40px 100px -30px rgba(0,0,0,.92)' }}>
        {/* header: title + mode toggle + close */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gl-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
          <h2 className="text-[15px] font-bold text-fg" style={{ fontFamily: 'var(--gs-display)' }}>{mode === 'plan' ? 'Plan an upgrade' : 'Replace across sets'}</h2>
          <div className="ml-auto relative inline-flex p-0.5 rounded-lg border border-line bg-field text-[11px] font-bold">
            {([['Replace now', 'now'], ['Plan for later', 'plan']] as const).map(([label, m]) => (
              <button key={m} onClick={() => setMode(m)} className="le-tap relative px-3 py-1 rounded-md">
                {mode === m && <motion.span layoutId="gsModeSeg" transition={T_INDICATOR} className="absolute inset-0 rounded-md bg-accent" />}
                <span className={`relative z-10 transition-colors ${mode === m ? 'text-on-accent' : 'text-fg-4'}`}>{label}</span>
              </button>
            ))}
          </div>
          <button onClick={onCancel} aria-label="Close" className="w-8 h-8 rounded-lg border border-line bg-field grid place-items-center text-fg-4 hover:text-accent transition-colors"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>

        {/* old -> new summary */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-line">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-field border border-line grid place-items-center overflow-hidden shrink-0">{oldId ? <IconInner id={oldId} size={36} name={oldName} assets={assets} bmpHas={iconSet.has(oldId)} /> : null}</div>
            <div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-wide text-fg-4">Retiring</div><div className="text-[12.5px] font-semibold text-fg-2 truncate">{oldName}</div></div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gl-gold)" strokeWidth="2.4" className="shrink-0"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-lg bg-field grid place-items-center overflow-hidden shrink-0" style={{ border: newName ? '1px solid var(--color-accent)' : '1px dashed var(--color-line-2)' }}>{newId ? <IconInner id={newId} size={36} name={newName} assets={assets} bmpHas={iconSet.has(newId)} /> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-4)" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>}</div>
            <div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-wide text-fg-4">Replace with</div><div className="text-[12.5px] font-semibold truncate" style={{ color: newName ? 'var(--color-fg)' : 'var(--color-fg-4)' }}>{newName || 'Pick an item on the left…'}</div></div>
          </div>
        </div>

        {/* two panes: choose new item | choose target slots */}
        <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* left: new item picker */}
          <div className="flex flex-col min-h-0 border-r border-line">
            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-4 mb-1.5">Replace with</div>
              <input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Search any compatible item…" className="w-full h-9 rounded-lg bg-field border border-line text-fg-2 px-3 text-[12.5px] outline-none focus:border-accent placeholder-fg-4" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {candidates.length === 0 ? <div className="text-[11px] text-fg-4 px-2 py-6 text-center">No compatible item matches.</div> :
                candidates.map((c) => (
                  <button key={c.id} onClick={() => chooseNew(c.name, c.id)} className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors ${newName.toLowerCase() === c.name.toLowerCase() ? 'bg-accent/15 border border-accent' : 'hover:bg-surface-hover border border-transparent'}`}>
                    <span className="w-6 h-6 rounded bg-field border border-line grid place-items-center overflow-hidden shrink-0"><IconInner id={c.id} size={22} name={c.name} assets={assets} bmpHas={iconSet.has(c.id)} /></span>
                    <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2">{c.name}</span>
                    {c.count > 0 ? <span className="text-[9.5px] font-bold font-mono px-1.5 rounded shrink-0" style={{ color: '#a8ecc2', background: 'rgba(103,207,144,.15)' }}>×{c.count}</span> : <span className="text-[9.5px] font-bold uppercase text-fg-4 shrink-0">plan</span>}
                  </button>
                ))}
            </div>
          </div>

          {/* right: target slots */}
          <div className="flex flex-col min-h-0">
            <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-4">{mode === 'plan' ? 'Land in' : 'Apply to'} {occ.length} slot{occ.length === 1 ? '' : 's'} · {bySet.length} set{bySet.length === 1 ? '' : 's'}</span>
              {occ.length > 0 && <button onClick={() => setSel(allOn ? new Set() : new Set(occ.map((_, i) => i)))} className="ml-auto text-[10.5px] font-semibold text-accent hover:underline">{allOn ? 'Clear' : 'All'}</button>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
              {bySet.map(([setKey, grp]) => {
                const label = `${groupLabel(grp.path[0])} · ${grp.path.slice(1).join('.') || 'Base'}`;
                const grpOn = grp.rows.every((r) => sel.has(r.i));
                return (
                  <div key={setKey} className="mb-2 rounded-lg border border-line overflow-hidden">
                    <button onClick={() => setGroup(grp.rows, !grpOn)} className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-surface/60 hover:bg-surface-hover transition-colors text-left">
                      <Check on={grpOn} />
                      <span className="flex-1 text-[12px] font-semibold text-fg-2 truncate">{label}</span>
                      <span className="text-[10px] text-fg-4">{grp.rows.length}</span>
                    </button>
                    <div className="px-2.5 py-1">
                      {grp.rows.map((r) => (
                        <button key={r.i} onClick={() => toggle(r.i)} className="w-full flex items-center gap-2 py-1 text-left">
                          <Check on={sel.has(r.i)} />
                          <span className="w-[62px] text-[10px] font-bold uppercase tracking-wide text-fg-4 shrink-0">{SLOT_LABEL[r.slot]}</span>
                          {r.augments && r.augments.length ? <span className="flex-1 min-w-0 truncate text-[10.5px]" style={{ color: 'var(--gl-aug)' }}>{r.augments.join(', ')}</span> : <span className="flex-1 text-[10.5px] text-fg-4">no augments</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {occ.length === 0 && <div className="py-8 text-center text-[11.5px] text-fg-4 leading-relaxed px-3">This item isn't directly set in any slot of this file.</div>}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-t border-line">
          {mode === 'now'
            ? <label className="flex items-center gap-2 text-[11.5px] text-fg-3 cursor-pointer select-none"><input type="checkbox" checked={carryAug} onChange={(e) => setCarryAug(e.target.checked)} className="accent-[var(--color-accent)] w-3.5 h-3.5" />Carry over existing augments</label>
            : <span className="text-[10.5px] leading-snug max-w-[360px]" style={{ color: 'var(--gl-gold-soft)' }}>Writes {newName || 'the item'} into the selected slots automatically once you obtain it.</span>}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10.5px] text-fg-4 tabular-nums">{picks.length} selected</span>
            <button onClick={onCancel} className="le-tap px-3.5 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
            {mode === 'now'
              ? <button disabled={!ready} onClick={() => onApply(newName, picks, carryAug)} className="le-tap px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{saving ? 'Replacing…' : `Replace ${picks.length} slot${picks.length === 1 ? '' : 's'}`}</button>
              : <button disabled={!newName || !picks.length} onClick={() => onPlan(newName, newId, picks)} className="le-tap inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>Save plan</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── plans list modal ─────────────────────────
function timeAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function PlansModal({ plans, log, owned, assets, iconSet, saving, onClose, onApplyNow, onDelete, onToggleAuto }: {
  plans: Plan[]; log: Fulfillment[]; fileKey: string; owned: Map<number, OwnedCopy[]>; idToItem: Map<number, ItemName>;
  assets?: string; iconSet: Set<number>; saving: boolean;
  onClose: () => void; onApplyNow: (p: Plan) => void; onDelete: (p: Plan) => void; onToggleAuto: (p: Plan) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-6">
      <div onClick={onClose} className="absolute inset-0 le-fade" style={{ background: 'rgba(6,4,2,.6)', backdropFilter: 'blur(2px)' }} />
      <div className="relative z-10 w-full max-w-[640px] flex flex-col rounded-2xl le-rise overflow-hidden" style={{ maxHeight: '84%', background: 'linear-gradient(180deg,rgba(38,26,16,.99),rgba(20,14,8,1))', border: '1px solid var(--color-line-2)', boxShadow: '0 40px 100px -30px rgba(0,0,0,.92)' }}>
        <div className="shrink-0 flex items-center gap-2 px-5 py-3.5 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gl-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>
          <h2 className="text-[15px] font-bold text-fg" style={{ fontFamily: 'var(--gs-display)' }}>Upgrade plans</h2>
          <span className="text-[11px] text-fg-4">{plans.length} pending</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 rounded-lg border border-line bg-field grid place-items-center text-fg-4 hover:text-accent transition-colors"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {plans.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-fg-4 leading-relaxed">No plans for this job yet.<br />Open a slot and use <b style={{ color: 'var(--gl-gold-soft)' }}>Plan</b> to queue a piece. It drops into your sets automatically once you obtain it.</div>
          ) : plans.map((p) => {
            const have = p.newId != null && owned.has(p.newId);
            const sets = new Set(p.targets.map((t) => t.setKey)).size;
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border mb-2 px-3 py-2.5" style={{ borderColor: have ? 'rgba(103,207,144,.4)' : 'var(--color-line)', background: have ? 'rgba(103,207,144,.07)' : 'var(--color-field)' }}>
                <div className="w-11 h-11 rounded-lg bg-field border border-line grid place-items-center overflow-hidden shrink-0">{p.newId ? <IconInner id={p.newId} size={44} name={p.newName} assets={assets} bmpHas={iconSet.has(p.newId)} /> : null}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-fg truncate">{p.newName}</div>
                  <div className="text-[11px] text-fg-4 truncate">{p.replaces ? <>succeeds <span className="text-fg-3">{p.replaces}</span> · </> : null}{p.targets.length} slot{p.targets.length === 1 ? '' : 's'} across {sets} set{sets === 1 ? '' : 's'}</div>
                  <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: have ? C_OK : 'var(--gl-gold-soft)' }}>{have ? '● Obtained, ready to apply' : '○ Waiting to be obtained'}</div>
                </div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-fg-4 cursor-pointer select-none shrink-0" title="Apply automatically the moment it's obtained">
                  <input type="checkbox" checked={p.auto} onChange={() => onToggleAuto(p)} className="accent-[var(--color-accent)] w-3.5 h-3.5" />Auto
                </label>
                <button disabled={saving} onClick={() => onApplyNow(p)} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-50">Apply now</button>
                <button onClick={() => onDelete(p)} aria-label="Delete plan" className="le-tap shrink-0 w-7 h-7 grid place-items-center rounded text-fg-4 hover:text-red-400 transition-colors"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg></button>
              </div>
            );
          })}

          {log.length > 0 && (
            <div className="mt-5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4 mb-2">Recently applied</div>
              {log.slice(0, 8).map((f, i) => (
                <div key={i} className="flex items-center gap-2 py-1 text-[11.5px]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C_OK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12l5 5L20 6" /></svg>
                  <span className="text-fg-2 truncate flex-1">{f.newName} <span className="text-fg-4">into {f.slots} slot{f.slots === 1 ? '' : 's'}</span></span>
                  <span className="text-fg-4 shrink-0">{timeAgo(f.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="w-4 h-4 rounded shrink-0 grid place-items-center transition-colors" style={on ? { background: 'var(--color-accent)', border: '1px solid var(--color-accent)' } : { border: '1px solid var(--color-line-2)' }}>
      {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-on-accent)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>}
    </span>
  );
}

// ───────────────────────── backdrop controls (brightness + surface blur) ─────────────────────────
function AppearanceButton() {
  const vs = useViews();
  const bright = vs.bright ?? BRIGHT_DEFAULT;
  const blur = vs.blur ?? BLUR_DEFAULT;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty('--gs-bright', String(bright));
    el.style.setProperty('--gs-blur', `${blur}px`);
  }, [bright, blur]);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };
  return (
    <>
      <button ref={btnRef} onClick={toggle} title="Background brightness & surface blur" className="le-tap h-[34px] w-9 grid place-items-center rounded-md border border-line bg-field text-fg-4 hover:text-fg-2 transition-colors">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></svg>
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="fixed z-[91] w-[244px] rounded-lg border border-line bg-popover shadow-2xl p-3.5 le-pop" style={{ top: pos.top, right: pos.right }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-4">Backdrop</span>
              <button onClick={() => setAppearance({ bright: BRIGHT_DEFAULT, blur: BLUR_DEFAULT })} className="text-[10px] font-semibold text-accent hover:underline">Reset</button>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] text-fg-3 mb-1"><span>Brightness</span><span className="font-mono text-fg-4">{Math.round(bright * 100)}%</span></div>
              <input type="range" min="0.35" max="1.15" step="0.01" value={bright} onChange={(e) => setAppearance({ bright: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" />
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-fg-3 mb-1"><span>Surface blur</span><span className="font-mono text-fg-4">{blur}px</span></div>
              <input type="range" min="0" max="16" step="1" value={blur} onChange={(e) => setAppearance({ blur: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" />
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export function GearsetLauncher() {
  const known = useKnownCharacters();
  const [charName, setCharName] = useStickyPersisted('gearset.char', '');
  const active = useMemo(() => known.find((c) => c.name === charName) ?? known[0], [known, charName]);
  return (
    <div className="h-full grid place-items-center p-6">
      <div className="w-full max-w-[280px] text-center">
        <div className="mx-auto mb-3.5 w-14 h-14 rounded-2xl border border-line bg-surface grid place-items-center text-accent">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4-3 4 2 4-2 4 3-1 6c-.5 3-3 5.5-7 7-4-1.5-6.5-4-7-7z" /><path d="M12 5v15" /><path d="M5 9h14" /></svg>
        </div>
        <div className="text-[16px] font-bold text-fg mb-1.5">Gearsets</div>
        <div className="text-[12px] text-fg-4 leading-relaxed mb-4">Your GearSwap loadouts open in their own window, sized for the equipment grid, a full stat breakdown and the fit report.</div>
        {known.length > 0 && <div className="mb-2.5"><CharacterSelect value={active?.name ?? ''} onChange={setCharName} chars={known} /></div>}
        <button onClick={() => void openGearsetWindow()} className="w-full px-3 py-2.5 text-[13px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Open Gearsets Window</button>
      </div>
    </div>
  );
}
