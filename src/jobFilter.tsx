import { useMemo } from 'react';
import { useSticky } from './sticky';
import { Select } from './ui';
import { JOB_LIST, jobEquips } from './itemNames';

// Shared job filter for the item views. Sticky value is 'all' (off) or a job code (WAR, RDM, ...).
// `matches` is null when off so callers can gate cheaply and skip the per-item check.
export function useJobFilter(key: string) {
  const [value, setValue] = useSticky<string>(key, 'all');
  const safe = value === 'all' || JOB_LIST.includes(value) ? value : 'all';
  const matches = useMemo<((id: number) => boolean) | null>(() => {
    if (safe === 'all') return null;
    return (id: number) => jobEquips(id, safe);
  }, [safe]);
  return { value: safe, setValue, matches, active: safe !== 'all' };
}

export function JobFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select full value={value} onChange={onChange} options={['all', ...JOB_LIST]}
      renderValue={(v) => (v === 'all' ? 'Job' : v)} renderOption={(v) => (v === 'all' ? 'All Jobs' : v)} />
  );
}
