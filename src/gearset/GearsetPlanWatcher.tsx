import { useEffect, useRef } from 'react';
import { useKnownCharacters, useAddonInfo } from '../bridge';
import { useSettings } from '../settings';
import { findGearsetFile, readGearsetFile, writeGearsetFile, deriveGearswapData, readGearLibrary } from './gearsetFiles';
import { parseGearsetFile, parseGearLibrary, collectLocalRefs, type GearEntry } from './gearsetParser';
import { replaceTargets, buildRefIndex } from './gearsetEdit';
import { useAllPlans, parseFileKey, removePlan, logFulfillment, type Plan } from './gearsetPlans';

// Mounted once inside the Gearsets window (the sole owner of the plans file, so no cross-window write
// contention). When a planned piece shows up in a character's bags, it writes the piece into every target
// slot of that character's gearswap file and clears the plan. Runs while the window is open and catches up
// on open (the effect re-fires as the plans file loads and as inventory streams in).
export function GearsetPlanWatcher() {
  const known = useKnownCharacters();
  const addon = useAddonInfo();
  const base = useSettings().gearswapPath || (addon?.dir ? deriveGearswapData(addon.dir) : '');
  const store = useAllPlans();
  const busy = useRef(new Set<string>());

  useEffect(() => {
    if (!base) return;
    (async () => {
      for (const [fileKey, plans] of Object.entries(store.plans)) {
        const { char: charName, job } = parseFileKey(fileKey);
        const char = known.find((c) => c.name === charName);
        if (!char?.inv) continue;
        const ownedIds = new Set<number>();
        for (const b of char.inv) for (const it of b.items) if (it.id) ownedIds.add(it.id);
        for (const plan of plans) {
          if (!plan.auto || plan.newId == null || !ownedIds.has(plan.newId)) continue;
          const tag = `${fileKey}:${plan.id}`;
          if (busy.current.has(tag)) continue;
          busy.current.add(tag);
          try { await applyPlan(base, charName, job, fileKey, plan); } finally { busy.current.delete(tag); }
        }
      }
    })();
  }, [known, base, store]);

  return null;
}

async function applyPlan(base: string, charName: string, job: string, fileKey: string, plan: Plan): Promise<void> {
  const path = await findGearsetFile(base, charName, job);
  if (!path) { removePlan(fileKey, plan.id); return; } // file gone: drop the plan
  const src = await readGearsetFile(path);
  if (src == null) return; // transient read failure: leave the plan, retry next inventory update
  const libSrc = await readGearLibrary(base, src);
  const lib = libSrc ? parseGearLibrary(libSrc) : new Map<string, GearEntry>();
  const refs = new Map<string, GearEntry>(lib);
  for (const [k, v] of collectLocalRefs(src)) refs.set(k, v);
  const refIndex = lib.size ? buildRefIndex(lib) : undefined;
  const parsed = parseGearsetFile(src, refs.size ? refs : undefined);
  const augs = plan.augments && plan.augments.length ? plan.augments : undefined;
  const res = replaceTargets(src, parsed, plan.targets, plan.newName, augs ? () => augs : undefined, refIndex);
  if (res && res.applied > 0) {
    const ok = await writeGearsetFile(path, res.src);
    if (!ok) return; // write failed: keep the plan, retry
    logFulfillment({ fileKey, newName: plan.newName, slots: res.applied, at: Date.now() });
  }
  removePlan(fileKey, plan.id); // applied, or no live targets left
}
