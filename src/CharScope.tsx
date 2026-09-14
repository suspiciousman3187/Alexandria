import { useMemo, useState, type ReactNode } from 'react';
import type { KnownChar } from './bridge';
import { useSticky } from './sticky';
import { Collapse } from './overlay';
import { useAnon } from './anonymize';
import { Button } from './ui';

export function useCharScope(key: string, chars: KnownChar[]) {
  const [excluded, setExcluded] = useSticky<string[]>(key, []);
  const exSet = useMemo(() => new Set(excluded), [excluded]);
  const scoped = useMemo(() => chars.filter((c) => !exSet.has(c.name)), [chars, exSet]);
  const toggle = (name: string) => setExcluded((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));
  const reset = () => setExcluded([]);
  const none = () => setExcluded(chars.map((c) => c.name));
  return { scoped, exSet, toggle, reset, none };
}

export function CharScopeBar({ chars, exSet, toggle, reset, none, accessory }: { chars: KnownChar[]; exSet: Set<string>; toggle: (n: string) => void; reset: () => void; none?: () => void; accessory?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anon = useAnon();
  if (chars.length <= 1) return accessory ? <div className="flex items-center min-h-[1.25rem]">{accessory}</div> : null;
  const active = chars.length - chars.filter((c) => exSet.has(c.name)).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <button onClick={() => setOpen((o) => !o)} className="le-tap flex items-center gap-1.5 text-[11px] font-semibold text-fg-3 hover:text-fg-2 transition-colors">
          <svg viewBox="0 0 24 24" className={`w-3 h-3 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          Characters <span className="tabular-nums text-fg-4">{active}/{chars.length}</span>
        </button>
        {accessory}
        <div className="ml-auto flex items-center gap-1">
          {exSet.size > 0 && <Button variant="ghost" size="xs" onClick={reset}>Select All</Button>}
          {none && active > 0 && <Button variant="ghost" size="xs" onClick={none}>Deselect All</Button>}
        </div>
      </div>
      <Collapse open={open}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5">
          {chars.map((c) => {
            const on = !exSet.has(c.name);
            return (
              <button key={c.name} onClick={() => toggle(c.name)} className={`le-tap flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${on ? 'border-accent/40 bg-accent/10 text-fg-2' : 'border-line bg-field text-fg-4'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'} ${on ? '' : 'opacity-40'}`} />
                <span className="truncate">{anon(c.name)}</span>
              </button>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}
