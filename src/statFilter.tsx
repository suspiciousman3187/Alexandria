import { useMemo } from 'react';
import { useSticky } from './sticky';
import { Select } from './ui';
import { useStatOptions, itemHasStat } from './itemNames';

// Gear-stat filter for the Library view. Sticky value is '' (off) or a named effect ("Fast Cast", "Store TP", ...).
// `matches` is null when off so callers can gate cheaply and skip the per-item check.
export function useStatFilter(key: string) {
  const [value, setValue] = useSticky<string>(key, '');
  const matches = useMemo<((id: number) => boolean) | null>(() => {
    const q = value.trim().toLowerCase();
    if (!q) return null;
    return (id: number) => itemHasStat(id, q);
  }, [value]);
  return { value, setValue, matches, active: value.trim() !== '' };
}

// Searchable combobox of gear stats. Options come from the item descriptions (item_stat_options.json), lazy-loaded.
export function StatFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = useStatOptions();
  return (
    <Select full searchable value={value} onChange={onChange} options={['', ...options]}
      renderValue={(v) => (v === '' ? 'Gear Stat' : v)} renderOption={(v) => (v === '' ? 'Any Gear Stat' : v)} />
  );
}
