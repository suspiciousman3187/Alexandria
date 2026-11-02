import { useMemo } from 'react';
import { useSticky } from './sticky';
import { Select } from './ui';
import { useItemTags, effectiveTagsOf, type TagDef } from './itemTags';

// Shared tag filter for the Library and Inventory views. The sticky value is 'all'
// (no filter), a tag id, or 'untagged'. `matches` is null when inactive so callers
// can both gate on it and skip the per-item check cheaply. It accepts the item's
// augments too, so an exact-piece (augment) tag is honored: pass `it.aug` to surface
// a copy tagged only at the piece level, and to keep it out of "Untagged".
export function useTagFilter(key: string) {
  const [value, setValue] = useSticky<string>(key, 'all');
  const { tags, assign, assignAug } = useItemTags();
  // A tag deleted after being selected falls back to showing everything.
  const safe = value === 'all' || value === 'untagged' || tags.some((t) => t.id === value) ? value : 'all';
  const matches = useMemo<((id: number, aug?: string[]) => boolean) | null>(() => {
    if (safe === 'all') return null;
    if (safe === 'untagged') return (id: number, aug?: string[]) => effectiveTagsOf({ id, aug }).length === 0;
    return (id: number, aug?: string[]) => effectiveTagsOf({ id, aug }).includes(safe);
  }, [safe, assign, assignAug]);
  return { value: safe, setValue, matches, active: safe !== 'all', tags };
}

export function TagFilterSelect({ value, onChange, tags }: { value: string; onChange: (v: string) => void; tags: TagDef[] }) {
  const dot = (t: TagDef, name: string) => (
    <span className="flex items-center gap-2 min-w-0"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} /><span className="truncate">{name}</span></span>
  );
  const renderValue = (v: string) => {
    if (v === 'all') return 'Tag';
    if (v === 'untagged') return 'Untagged';
    const t = tags.find((x) => x.id === v);
    return t ? dot(t, t.name) : 'Tag';
  };
  const renderOption = (v: string) => {
    if (v === 'all') return 'All Tags';
    if (v === 'untagged') return 'Untagged';
    const t = tags.find((x) => x.id === v);
    return t ? dot(t, t.name) : v;
  };
  return (
    <Select full value={value} onChange={onChange} options={['all', ...tags.map((t) => t.id), 'untagged']} renderValue={renderValue} renderOption={renderOption} />
  );
}
