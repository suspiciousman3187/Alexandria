import { useMemo, useState } from 'react';
import { useBoxes, useKnownCharacters, sortBag } from './bridge';
import { useSettings, setSettings } from './settings';
import { Group, RowStacked, Chip } from './ui';
import { CharScopeBar } from './CharScope';
import { STORABLE_BAGS } from './storagePrefs';

const AUTOSORT_BAGS = [{ id: 0, name: 'Inventory' }, ...STORABLE_BAGS];

export default function AutoSortSettings() {
  const boxes = useBoxes();
  const known = useKnownCharacters();
  const settings = useSettings();
  const [sortSent, setSortSent] = useState(false);
  const knownSorted = useMemo(() => [...known].sort((a, b) => a.name.localeCompare(b.name)), [known]);
  const asExSet = useMemo(() => new Set(settings.autoSortExclude ?? []), [settings.autoSortExclude]);
  const asToggle = (name: string) => { const ex = settings.autoSortExclude ?? []; setSettings({ ...settings, autoSortExclude: ex.includes(name) ? ex.filter((x) => x !== name) : [...ex, name] }); };
  const asReset = () => setSettings({ ...settings, autoSortExclude: [] });
  return (
    <Group title="Auto-Sort">
      <div className="px-3.5 py-2.5">
        <button onClick={() => { const excl = new Set(settings.autoSortExclude ?? []); let n = 0; for (const b of boxes) if (b.conn != null && !excl.has(b.name)) { sortBag(b.conn, AUTOSORT_BAGS.map((x) => x.id)); n++; } if (n > 0) { setSortSent(true); window.setTimeout(() => setSortSent(false), 2500); } }} disabled={boxes.length === 0} className="w-full px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
          {boxes.length === 0 ? 'No Characters Connected' : sortSent ? 'Sorted ✓' : `Sort All Bags Now${boxes.length > 1 ? ` (${boxes.length})` : ''}`}
        </button>
      </div>
      <RowStacked label="Bags" desc="Sorted automatically when contents change. Mog bags only at a moogle.">
        <div className="flex flex-wrap gap-1.5">
          {AUTOSORT_BAGS.map((b) => {
            const on = (settings.autoSortBags ?? []).includes(b.id);
            return <Chip key={b.id} on={on} onChange={() => setSettings({ ...settings, autoSortBags: on ? settings.autoSortBags.filter((x) => x !== b.id) : [...(settings.autoSortBags ?? []), b.id] })}>{b.name}</Chip>;
          })}
        </div>
      </RowStacked>
      <div className="px-3.5 py-3">
        <CharScopeBar chars={knownSorted} exSet={asExSet} toggle={asToggle} reset={asReset} />
      </div>
    </Group>
  );
}
