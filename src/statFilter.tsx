import { useMemo } from 'react';
import { useSticky } from './sticky';
import { Select } from './ui';
import { useStatOptions, itemHasStat } from './itemNames';
import { useItemMods, getItemMods, itemModStatKeys } from './gearset/gearsetStats';

export type StatDir = 'desc' | 'asc';

// Gear-stat filter + sort for the Library view. Sticky value is '' (off) or a stat name. Picking a stat
// filters to items that carry it AND (when the stat has numeric values) sorts by that value; the direction
// toggle flips high->low / low->high. `matches` is null when off so callers can skip the per-item check.
//
// Two kinds of stat live in the catalog: NUMERIC stats from /item_mods.json (Accuracy, Haste, DEX, Fast
// Cast, ...) which can be both precisely filtered (value present) and sorted by value; and description-only
// NAMED effects (conditional / quoted-only text) which can only be filtered by presence. `sortMode` is set
// only for numeric stats.
export function useStatFilter(key: string) {
  const [value, setValue] = useSticky<string>(key, '');
  const [dir, setDir] = useSticky<StatDir>(`${key}.dir`, 'desc');
  const mods = useItemMods(); // ensure /item_mods.json is loaded (re-renders on load)
  const statKeys = itemModStatKeys();
  const v = value.trim();
  const numeric = v !== '' && statKeys.has(v);
  const matches = useMemo<((id: number) => boolean) | null>(() => {
    if (!v) return null;
    // Numeric stat: an item "has" it when its base mods carry a value (precise, no substring false matches
    // like INT -> "interruption"). Named effect: fall back to description-text presence.
    if (statKeys.has(v)) return (id: number) => getItemMods(id)?.[v] != null;
    const q = v.toLowerCase();
    return (id: number) => itemHasStat(id, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, mods]);
  const sortMode = numeric ? (dir === 'desc' ? (`stat:${v}` as const) : (`statasc:${v}` as const)) : null;
  return { value, setValue, matches, active: v !== '', dir, setDir, numeric, sortMode };
}

// The stat dropdown offers the numeric item_mods stats (sortable) plus the description-only named effects,
// merged and de-duplicated, searchable.
function useStatCatalog(): string[] {
  const named = useStatOptions();
  const mods = useItemMods();
  return useMemo(() => {
    const set = new Set<string>(itemModStatKeys());
    for (const n of named) set.add(n);
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named, mods]);
}

export function StatFilterSelect({ value, onChange, dir, onDir, sortable }: {
  value: string; onChange: (v: string) => void; dir?: StatDir; onDir?: (d: StatDir) => void; sortable?: boolean;
}) {
  const options = useStatCatalog();
  return (
    <div className="flex items-stretch gap-1 min-w-0">
      <div className="flex-1 min-w-0">
        <Select full searchable value={value} onChange={onChange} options={['', ...options]}
          renderValue={(v) => (v === '' ? 'Equipment Stats' : v)} renderOption={(v) => (v === '' ? 'Any Equipment Stat' : v)} />
      </div>
      {value !== '' && sortable && onDir && (
        <button
          type="button"
          onClick={() => onDir(dir === 'desc' ? 'asc' : 'desc')}
          title={dir === 'desc' ? 'Sorting highest first (click for lowest first)' : 'Sorting lowest first (click for highest first)'}
          className="le-tap shrink-0 w-8 grid place-items-center rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {dir === 'desc'
              ? <><path d="M3 6h11" /><path d="M3 12h7" /><path d="M3 18h4" /><path d="M18 8V20" /><path d="m14 16 4 4 4-4" /></>
              : <><path d="M3 6h4" /><path d="M3 12h7" /><path d="M3 18h11" /><path d="M18 16V4" /><path d="m14 8 4-4 4 4" /></>}
          </svg>
        </button>
      )}
    </div>
  );
}
