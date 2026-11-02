import type { ParsedGearsets, GearEntry } from './gearsetParser';
import type { SlotKey } from './slotLayout';

export type Target = { setKey: string; slot: SlotKey };

// A reverse index over a Rahvin gear library: given an item name + augments, find the library
// reference ("gear.nyameHead") that names exactly that piece. Writing the reference back instead of a
// literal preserves Rahvin's naming scheme and the entry's HP-priority ordering token.
export type RefIndex = { keyFor(name: string, augments?: string[]): string | null };

function augKey(name: string, augments?: string[]): string {
  return name.toLowerCase() + '\u0001' + (augments ?? []).join('\u0002');
}

export function buildRefIndex(lib: Map<string, GearEntry>): RefIndex {
  const m = new Map<string, string>();
  for (const [ref, e] of lib) {
    if (e.kind !== 'item') continue;
    const k = augKey(e.name, e.augments);
    if (!m.has(k)) m.set(k, ref); // first entry wins, so the mapping is deterministic
  }
  return { keyFor: (name, augs) => m.get(augKey(name, augs)) ?? null };
}

// Lua for a gear value. With a RefIndex that has a matching library entry, emit that reference
// (`gear.nyameHead`) so Rahvin's convention + HP priority are kept. Otherwise a bare string, or a
// { name=, augments={} } table when augments are kept.
export function gearLiteral(name: string, augments?: string[], refs?: RefIndex): string {
  const ref = refs?.keyFor(name, augments && augments.length ? augments : undefined);
  if (ref) return ref;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return augments && augments.length
    ? `{ name="${esc(name)}", augments={${augments.map((a) => `"${esc(a)}"`).join(',')},} }`
    : `"${esc(name)}"`;
}

// Rewrite every (directly-defined) target slot's value to `newName`. Edits are applied newest-span-first so
// earlier byte offsets stay valid. `augFor` supplies per-target augments (omit for a plain string). Returns
// the new source + how many slots were actually rewritten, or null when no target had a writable span.
export function replaceTargets(
  src: string, parsed: ParsedGearsets, targets: Target[], newName: string, augFor?: (t: Target) => string[] | undefined, refs?: RefIndex,
): { src: string; applied: number } | null {
  const edits: { span: [number, number]; augs?: string[] }[] = [];
  for (const t of targets) {
    const span = parsed.byKey.get(t.setKey)?.slotSpans?.[t.slot];
    if (!span) continue;
    edits.push({ span, augs: augFor?.(t) });
  }
  if (!edits.length) return null;
  edits.sort((a, b) => b.span[0] - a.span[0]);
  let out = src;
  let applied = 0;
  for (const e of edits) {
    const slice = out.slice(e.span[0], e.span[1]);
    const eq = slice.indexOf('=');
    if (eq < 0) continue;
    out = out.slice(0, e.span[0]) + slice.slice(0, eq + 1) + ' ' + gearLiteral(newName, e.augs, refs) + out.slice(e.span[1]);
    applied++;
  }
  return { src: out, applied };
}
