import { findGearsetFile, readGearsetFile, readGearLibrary, readSelindrileItems } from './gearsetFiles';
import { parseGearsetFile, parseGearLibrary, collectLocalRefs, collectLocalRefSets, resolveSet, type GearEntry, type ParsedSet } from './gearsetParser';
import { type SlotKey } from './slotLayout';
import { makeNameResolver } from './gearsetValidate';
import { getItemNames } from '../itemNames';

// Build the set of FFXI item ids that <char>'s GearSwap sets reference for `job`. This reuses the SAME
// discovery + companion-library + ref-assembly pipeline the Gearsets view uses (Rahvin GearSets-Include,
// Selindrile <Char>-Items.lua, job-file-local tables, set_combine inheritance), so an abbreviated or
// library ref resolves to the same real item name the view shows. Names that don't resolve to a known
// item are skipped -- a pull filtered by this just won't include them.
//
// Returns null when no gear file exists / can't be read for the job: callers treat null as "no gearset
// filter available" and (for a gearset-only pull) pull nothing rather than falling back to everything.
export async function gearsetItemIds(base: string, char: string, job: string): Promise<Set<number> | null> {
  if (!base || !char || !job) return null;
  const path = await findGearsetFile(base, char, job);
  if (!path) return null;
  const src = await readGearsetFile(path);
  if (src == null) return null;

  // Companion gear libraries, same as GearsetView: Rahvin's included GearSets-Include and/or Selindrile's
  // sibling <Char>-Items.lua (both carry `gear.<key>` augment entries and shared sets).
  const libSrc = await readGearLibrary(base, src);
  const sel = await readSelindrileItems(path);
  const lib = libSrc ? parseGearLibrary(libSrc) : new Map<string, GearEntry>();
  if (sel) {
    for (const [k, v] of parseGearLibrary(sel.src)) lib.set(k, v); // gear.<key> augment entries
    for (const [k, v] of collectLocalRefs(sel.src)) lib.set(k, v); // any local item tables
  }
  const refs = new Map<string, GearEntry>(lib);
  for (const [k, v] of collectLocalRefs(src)) refs.set(k, v);

  const parsed = parseGearsetFile(src, refs.size ? refs : undefined);
  const allSets: ParsedSet[] = [...parsed.sets];
  // Selindrile shared sets.* (TreasureHunter, ...) + job-file-local ref tables (e.g. BRD Instrument.*),
  // mirroring the view so nothing a song/WS set references is missed.
  if (sel) {
    const cp = parseGearsetFile(sel.src, lib);
    for (const s of cp.sets) if (!parsed.byKey.has(s.key)) { allSets.push(s); parsed.byKey.set(s.key, s); }
  }
  for (const ls of collectLocalRefSets(src)) if (!parsed.byKey.has(ls.key)) { allSets.push(ls); parsed.byKey.set(ls.key, ls); }

  const resolve = makeNameResolver(getItemNames());
  const ids = new Set<number>();
  for (const s of allSets) {
    const resolved = resolveSet(s, parsed.byKey); // folds set_combine inheritance (base first, own last)
    for (const slot of Object.keys(resolved) as SlotKey[]) {
      const entry = resolved[slot]?.entry;
      if (!entry || entry.kind !== 'item') continue;
      const r = resolve(entry.name);
      if (r) ids.add(r.id);
    }
  }
  return ids;
}
