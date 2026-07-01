import { useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useKnownCharacters, useAvailableIcons, inTauri, type KnownChar } from './bridge';
import { useWatchStore, setWatchChar, addWatchItem, removeWatchItem, setWatchMin, isWatchedFor, emptyWatch, totalOf, type WatchChar } from './watch';
import { useItemHover } from './ItemTooltip';
import { Stepper, Toggle, SearchInput } from './ui';
import { Modal, Collapse } from './overlay';
import { useAnon } from './anonymize';

const fmt = (v: number) => v.toLocaleString();
type CatItem = { id: number; n: string };

function Icon({ id, n, assets }: { id: number; n: string; assets?: string }) {
  const hover = useItemHover({ id, n });
  const [broken, setBroken] = useState(false);
  const ready = useAvailableIcons().has(id);
  const src = ready && assets && inTauri ? convertFileSrc(`${assets}/icon_${id}.bmp`) : null;
  return (
    <div {...hover} className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} className="w-full h-full object-contain" />
      ) : (
        <span className="text-fg-4 text-[9px] font-bold">{(n[0] || '?').toUpperCase()}</span>
      )}
    </div>
  );
}

function PickerRow({ it, onAll, onAny, disabled, assets, onAdd, onRemove }: {
  it: CatItem; onAll: boolean; onAny: boolean; disabled: boolean; assets?: string; onAdd: (min: number) => void; onRemove: () => void;
}) {
  const [amt, setAmt] = useState(12);
  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <Icon id={it.id} n={it.n} assets={assets} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{it.n}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {onAll && (
          <span className="text-emerald-400" title="On the list">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>
          </span>
        )}
        <Stepper value={amt} min={0} numW="w-10" onChange={setAmt} />
        <button onClick={() => onAdd(amt)} disabled={disabled} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Add</button>
        <button onClick={onRemove} disabled={!onAny} aria-label="Remove from list" className="le-tap shrink-0 grid place-items-center w-7 h-7 rounded-md text-fg-4 enabled:hover:text-rose-300 enabled:hover:bg-rose-500/10 disabled:opacity-25 transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
        </button>
      </div>
    </div>
  );
}

function WatchPicker({ catalog, chars, initialTargets, assets, onAdd, onRemove, onClose }: {
  catalog: CatItem[]; chars: KnownChar[]; initialTargets: string[]; assets?: string;
  onAdd: (it: CatItem, min: number, targets: string[]) => void; onRemove: (it: CatItem, targets: string[]) => void; onClose: () => void;
}) {
  const anon = useAnon();
  const [q, setQ] = useState('');
  const [targets, setTargets] = useState<Set<string>>(() => new Set(initialTargets));
  const toggleTarget = (n: string) => setTargets((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const targetList = useMemo(() => chars.map((c) => c.name).filter((n) => targets.has(n)), [chars, targets]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((it) => it.n.toLowerCase().includes(s)).slice(0, 200);
  }, [catalog, q]);

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,600px)] h-[82vh]">
      {(close) => (
        <div className="flex flex-col min-h-0 h-full">
          <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-line flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-bold text-fg flex-1">Add Items To Watch</div>
              <button onClick={close} aria-label="Close" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-fg-4 mr-0.5">Add to</span>
              {chars.map((c) => {
                const on = targets.has(c.name);
                return (
                  <button key={c.name} onClick={() => toggleTarget(c.name)} className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${on ? 'bg-accent/15 text-accent border-accent/40' : 'bg-field text-fg-4 border-line hover:text-fg-3'}`}>{anon(c.name)}</button>
                );
              })}
              {chars.length > 1 && (
                <button onClick={() => setTargets(targets.size === chars.length ? new Set() : new Set(chars.map((c) => c.name)))} className="px-2 py-0.5 text-[10px] font-semibold rounded-full border border-line bg-surface text-fg-3 hover:text-fg transition-colors">{targets.size === chars.length ? 'None' : 'All'}</button>
              )}
            </div>
            <SearchInput
              value={q}
              onChange={setQ}
              wrap=""
              placeholder="Search items in any character's bags…"
              className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
            {targetList.length === 0 && (
              <div className="px-4 py-2 text-center text-[11px] text-amber-300/90 bg-amber-500/5">Select at least one character above to add to.</div>
            )}
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-fg-4">No items match.</div>
            ) : (
              shown.map((it) => (
                <PickerRow
                  key={it.id}
                  it={it}
                  onAll={targetList.length > 0 && targetList.every((t) => isWatchedFor(t, it.id))}
                  onAny={targetList.some((t) => isWatchedFor(t, it.id))}
                  disabled={targetList.length === 0}
                  assets={assets}
                  onAdd={(min) => onAdd(it, min, targetList)}
                  onRemove={() => onRemove(it, targetList)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CharCard({ char, assets, onAddClick }: { char: KnownChar; assets?: string; onAddClick: () => void }) {
  const anon = useAnon();
  const store = useWatchStore();
  const cfg: WatchChar = store[char.name] ?? emptyWatch();
  const [open, setOpen] = useState(true);

  const status = cfg.items.map((it) => {
    const total = totalOf(char.inv, it.id);
    return { it, total, low: total < it.min };
  });
  const lowN = status.filter((s) => s.low).length;

  return (
    <div className={`rounded-xl bg-surface border overflow-hidden ${cfg.enabled && lowN > 0 ? 'border-red-500/40' : 'border-line'}`}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${char.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
          <span className="text-[13px] font-semibold text-fg-2 truncate">{anon(char.name)}</span>
          {cfg.items.length > 0 && (
            <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${cfg.enabled && lowN > 0 ? 'text-red-300' : 'text-fg-4'}`}>
              {cfg.enabled && lowN > 0 ? `${lowN} low` : `${cfg.items.length} watched`}
            </span>
          )}
        </button>
        <button onClick={onAddClick} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg transition-colors">Add</button>
        <Toggle on={cfg.enabled} onChange={(v) => setWatchChar(char.name, { ...cfg, enabled: v })} />
      </div>
      <Collapse open={open}>
        <div className="border-t border-line">
          {cfg.items.length === 0 ? (
            <div className="px-3.5 py-3 text-[11px] text-fg-4">No items watched yet. Use Add to track a supply for this character.</div>
          ) : (
            status.map(({ it, total, low }) => (
              <div key={it.id} className="flex items-center gap-2.5 px-3.5 py-2 border-b border-line last:border-b-0">
                <Icon id={it.id} n={it.name} assets={assets} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-fg-2 truncate">{it.name}</div>
                  <div className="text-[10px] tabular-nums">
                    <span className={low ? 'text-amber-400' : 'text-emerald-400'}>have {fmt(total)} / {fmt(it.min)}</span>
                  </div>
                </div>
                <Stepper value={it.min} min={0} numW="w-12" onChange={(v) => setWatchMin(char.name, it.id, v)} />
                <button onClick={() => removeWatchItem(char.name, it.id)} aria-label="Remove" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
              </div>
            ))
          )}
        </div>
      </Collapse>
    </div>
  );
}

export default function WatchView() {
  const known = useKnownCharacters();
  const store = useWatchStore();
  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const [pickerTargets, setPickerTargets] = useState<string[] | null>(null);

  const catalog = useMemo<CatItem[]>(() => {
    const m = new Map<number, string>();
    for (const c of known) for (const b of c.inv ?? []) for (const it of b.items) if (it.id > 0 && !m.has(it.id)) m.set(it.id, it.n);
    return [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => a.n.localeCompare(b.n));
  }, [known]);

  const addTo = (it: CatItem, min: number, targets: string[]) => { for (const name of targets) addWatchItem(name, { id: it.id, name: it.n }, min); };
  const removeFrom = (it: CatItem, targets: string[]) => { for (const name of targets) removeWatchItem(name, it.id); };
  const setAllEnabled = (on: boolean) => { for (const c of online) setWatchChar(c.name, { ...(store[c.name] ?? emptyWatch()), enabled: on }); };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Each character gets its own watch list, and you'll be alerted in-game when a tracked supply runs low.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex items-center gap-2 max-w-2xl w-full mx-auto">
        <button onClick={() => setPickerTargets(online.map((c) => c.name))} className="le-tap flex-1 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Add Items To All Characters</button>
        <button onClick={() => setAllEnabled(true)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Enable All</button>
        <button onClick={() => setAllEnabled(false)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Disable All</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 max-w-2xl w-full mx-auto flex flex-col gap-3">
          {online.map((c) => <CharCard key={c.name} char={c} assets={assetsAny} onAddClick={() => setPickerTargets([c.name])} />)}
        </div>
      </div>

      {pickerTargets && (
        <WatchPicker catalog={catalog} chars={online} initialTargets={pickerTargets} assets={assetsAny} onAdd={addTo} onRemove={removeFrom} onClose={() => setPickerTargets(null)} />
      )}
    </div>
  );
}
