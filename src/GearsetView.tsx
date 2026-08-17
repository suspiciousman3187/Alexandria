import { useEffect, useMemo, useState } from 'react';
import { useKnownCharacters, useAvailableIcons, useAddonInfo } from './bridge';
import { useItemNames } from './itemNames';
import { useSettings } from './settings';
import { IconInner } from './atlasIcon';
import { CharacterSelect, Select, SearchInput } from './ui';
import { useStickyPersisted } from './sticky';
import { openGearsetWindow } from './overlayWindow';
import { findGearsetFile, readGearsetFile, listCharacterJobs, deriveGearswapData } from './gearset/gearsetFiles';
import { parseGearsetFile, resolveSet, type ParsedGearsets, type ParsedSet } from './gearset/gearsetParser';
import { SLOT_ORDER, SLOT_LABEL, type SlotKey } from './gearset/slotLayout';
import { makeNameResolver, ownedById, validateGear, type SlotValidation } from './gearset/gearsetValidate';

const GROUP_ORDER = ['Weapons', 'Idle', 'Movement', 'OffenseMode', 'DualWield', 'Precast', 'Midcast', 'WS', 'JA', 'Waltz', 'Jig', 'Samba', 'Step', 'Flourish', 'PhantomRoll', 'QuickDraw', 'Ready', 'Geomancy', 'TreasureHunter'];
const GROUP_LABEL: Record<string, string> = { OffenseMode: 'Offense' };
const GROUP_HUE: Record<string, string> = {
  Weapons: '#c07a8a', Idle: '#7aa8c0', Movement: '#7fbdae', OffenseMode: '#c0a060', DualWield: '#c98f6a',
  Precast: '#9a86c0', Midcast: '#6fb09a', WS: '#c08070', JA: '#b088b0',
  Waltz: '#c58fb0', Jig: '#c58fb0', Samba: '#c58fb0', Step: '#c58fb0', Flourish: '#c58fb0',
  PhantomRoll: '#8f9ac8', QuickDraw: '#8f9ac8', Ready: '#9ab86e', Geomancy: '#6fb0a8', TreasureHunter: '#c7b25e',
};
const hueOf = (g: string) => GROUP_HUE[g] ?? '#8a9488';
const groupLabel = (g: string) => GROUP_LABEL[g] ?? g;

function stateDot(s: SlotValidation['state']): string {
  if (s === 'ok') return 'bg-emerald-400';
  if (s === 'aug-mismatch' || s === 'wrong-bag') return 'bg-amber-400';
  if (s === 'missing' || s === 'unknown') return 'bg-red-400';
  return 'bg-sky-400';
}
function stateText(v: SlotValidation): string {
  switch (v.state) {
    case 'ok': return 'Owned';
    case 'aug-mismatch': return 'Augments differ';
    case 'wrong-bag': return `In ${v.bag}`;
    case 'missing': return 'Not owned';
    case 'unknown': return 'Unknown item';
    case 'dynamic': return 'Dynamic value';
  }
}
function stateTextClass(s: SlotValidation['state']): string {
  if (s === 'ok') return 'text-fg-4';
  if (s === 'aug-mismatch' || s === 'wrong-bag') return 'text-amber-300';
  if (s === 'missing' || s === 'unknown') return 'text-red-300';
  return 'text-sky-300';
}

export default function GearsetView() {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const items = useItemNames();
  const addon = useAddonInfo();
  const base = useSettings().gearswapPath || (addon?.dir ? deriveGearswapData(addon.dir) : '');

  const [charName, setCharName] = useStickyPersisted('gearset.char', '');
  const active = useMemo(() => known.find((c) => c.name === charName) ?? known[0], [known, charName]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);

  const [jobs, setJobs] = useState<string[]>([]);
  const [job, setJob] = useStickyPersisted('gearset.job', '');
  useEffect(() => {
    if (!base || !active) { setJobs([]); return; }
    let alive = true;
    void listCharacterJobs(base, active.name).then((j) => { if (alive) setJobs(j); });
    return () => { alive = false; };
  }, [base, active?.name]);
  useEffect(() => {
    if (!jobs.length) return;
    if (!job || !jobs.includes(job)) {
      const m = (active?.main ?? '').toUpperCase();
      setJob(jobs.includes(m) ? m : jobs[0]);
    }
  }, [jobs, active?.name]);

  const [parsed, setParsed] = useState<ParsedGearsets | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [selKey, setSelKey] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!base || !active || !job) { setParsed(null); setFileErr(null); return; }
    let alive = true;
    setLoading(true); setFileErr(null);
    (async () => {
      const path = await findGearsetFile(base, active.name, job);
      if (!alive) return;
      if (!path) { setParsed(null); setFileErr('No gearset file found for this job.'); setLoading(false); return; }
      const src = await readGearsetFile(path);
      if (!alive) return;
      if (src == null) { setParsed(null); setFileErr('Could not read the gearset file.'); setLoading(false); return; }
      setParsed(parseGearsetFile(src));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [base, active?.name, job]);

  const resolve = useMemo(() => makeNameResolver(items), [items]);
  const owned = useMemo(() => ownedById(active ?? { inv: [] }), [active?.inv]);

  const setStatus = useMemo(() => {
    const m = new Map<string, { missing: number; issues: number; defined: number }>();
    if (!parsed) return m;
    for (const s of parsed.sets) {
      let missing = 0, issues = 0, defined = 0;
      for (const slot of Object.keys(s.slots) as SlotKey[]) {
        const g = s.slots[slot]!;
        if (g.kind === 'dynamic') continue;
        defined++;
        const v = validateGear(g, resolve, owned);
        if (v.state === 'missing' || v.state === 'unknown') missing++;
        else if (v.state === 'aug-mismatch' || v.state === 'wrong-bag') issues++;
      }
      m.set(s.key, { missing, issues, defined });
    }
    return m;
  }, [parsed, resolve, owned]);

  const summary = useMemo(() => {
    const missing = new Set<string>(), issues = new Set<string>();
    if (parsed) for (const s of parsed.sets) for (const slot of Object.keys(s.slots) as SlotKey[]) {
      const g = s.slots[slot]!;
      if (g.kind === 'dynamic') continue;
      const v = validateGear(g, resolve, owned);
      if (v.state === 'missing' || v.state === 'unknown') missing.add(g.name.toLowerCase());
      else if (v.state === 'aug-mismatch' || v.state === 'wrong-bag') issues.add(g.name.toLowerCase());
    }
    return { missing: missing.size, issues: issues.size };
  }, [parsed, resolve, owned]);

  useEffect(() => {
    if (!parsed) { setSelKey(''); return; }
    if (!parsed.byKey.has(selKey)) {
      const first = parsed.sets.find((s) => Object.keys(s.slots).length > 0) ?? parsed.sets[0];
      setSelKey(first?.key ?? '');
    }
  }, [parsed]);

  const grouped = useMemo(() => {
    if (!parsed) return [] as { group: string; sets: ParsedSet[] }[];
    const q = filter.trim().toLowerCase();
    const byGroup = new Map<string, ParsedSet[]>();
    for (const s of parsed.sets) {
      if (q && !s.key.toLowerCase().includes(q)) continue;
      const g = s.path[0] ?? '?';
      const arr = byGroup.get(g) ?? [];
      arr.push(s); byGroup.set(g, arr);
    }
    const keys = [...byGroup.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return keys.map((k) => ({ group: k, sets: byGroup.get(k)! }));
  }, [parsed, filter]);

  const sel = parsed?.byKey.get(selKey);
  const resolved = useMemo(() => (sel && parsed ? resolveSet(sel, parsed.byKey) : {}), [sel, parsed]);
  const selValidation = useMemo(() => {
    const m = new Map<SlotKey, SlotValidation>();
    for (const slot of Object.keys(resolved) as SlotKey[]) m.set(slot, validateGear(resolved[slot]!.entry, resolve, owned));
    return m;
  }, [resolved, resolve, owned]);

  const activeGroup = useMemo(() => {
    const g = sel?.path[0];
    if (g && grouped.some((x) => x.group === g)) return g;
    return grouped[0]?.group ?? '';
  }, [sel, grouped]);
  const activeSets = useMemo(() => grouped.find((x) => x.group === activeGroup)?.sets ?? [], [grouped, activeGroup]);
  const selectGroup = (grp: string) => { const first = grouped.find((x) => x.group === grp)?.sets[0]; if (first) setSelKey(first.key); };
  const groupStats = useMemo(() => {
    const m = new Map<string, { missing: number; issues: number }>();
    for (const g of grouped) {
      let missing = 0, issues = 0;
      for (const s of g.sets) { const st = setStatus.get(s.key); if (st) { missing += st.missing; issues += st.issues; } }
      m.set(g.group, { missing, issues });
    }
    return m;
  }, [grouped, setStatus]);

  const definedCount = Object.keys(resolved).length;

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)] text-fg-2">
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-line">
        <div className="w-44"><CharacterSelect value={active?.name ?? ''} onChange={setCharName} chars={known} /></div>
        <div className="w-32"><Select value={job} onChange={setJob} options={jobs} renderValue={(v) => v || 'Job'} full /></div>
        {parsed && <div className="w-44"><SearchInput value={filter} onChange={setFilter} wrap="" placeholder="Filter sets…" className="bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" /></div>}
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {summary.missing > 0 && <span className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md border border-red-500/40 bg-red-500/10 text-red-300"><b className="text-[14px] font-bold tabular-nums">{summary.missing}</b> missing</span>}
          {summary.issues > 0 && <span className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300"><b className="text-[14px] font-bold tabular-nums">{summary.issues}</b> issues</span>}
          {parsed && summary.missing === 0 && summary.issues === 0 && <span className="px-2.5 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold">All owned</span>}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4">Loading gearsets…</div>
      ) : fileErr ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4">{fileErr}</div>
      ) : !base ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4 text-center px-6">Connect a character once so Alexandria can find your addons folder, or set the GearSwap data folder in Settings.</div>
      ) : !parsed ? (
        <div className="flex-1 grid place-items-center text-[12px] text-fg-4 text-center px-6">{jobs.length ? 'Select a job.' : 'No gearset files found here. If your GearSwap folder is elsewhere, set it in Settings.'}</div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="shrink-0 flex gap-0.5 px-3 pt-1.5 border-b border-line overflow-x-auto" role="tablist">
            {grouped.map(({ group }) => {
              const hue = hueOf(group);
              const gs = groupStats.get(group);
              const on = group === activeGroup;
              return (
                <button key={group} role="tab" aria-selected={on} onClick={() => selectGroup(group)}
                  className={`relative shrink-0 inline-flex items-center gap-2 px-3 pt-2 pb-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${on ? 'text-fg' : 'text-fg-4 hover:text-fg-2'}`}>
                  <span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: hue, opacity: on ? 1 : 0.6 }} />
                  {groupLabel(group)}
                  {gs && gs.missing > 0 && <span className="text-[10px] font-bold text-red-300 tabular-nums px-1.5 py-px rounded-full bg-red-500/15">{gs.missing}</span>}
                  {gs && gs.missing === 0 && gs.issues > 0 && <span className="text-[10px] font-bold text-amber-300 tabular-nums px-1.5 py-px rounded-full bg-amber-500/15">{gs.issues}</span>}
                  {on && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-t-full" style={{ background: hue }} />}
                </button>
              );
            })}
            {grouped.length === 0 && <span className="px-3 py-2 text-[11px] text-fg-4">No sets match.</span>}
          </div>

          {activeSets.length > 0 && (
            <div className="shrink-0 flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-line max-h-24 overflow-y-auto">
              {activeSets.map((s) => {
                const st = setStatus.get(s.key);
                const leaf = s.path.slice(1).join('.') || 'Base';
                const on = s.key === selKey;
                const dot = st && st.missing > 0 ? 'bg-red-400' : st && st.issues > 0 ? 'bg-amber-400' : 'bg-fg-5';
                return (
                  <button key={s.key} onClick={() => setSelKey(s.key)}
                    className={`shrink-0 inline-flex items-center gap-2 h-7 px-3 rounded-full border text-[12px] transition-colors ${on ? 'bg-accent border-transparent text-on-accent font-semibold' : 'bg-surface border-line-2 text-fg-3 hover:text-fg-2'}`}>
                    <span className={`w-[5px] h-[5px] rounded-full ${on ? 'bg-on-accent/60' : dot}`} />
                    {leaf}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            {sel ? (
              <div className="flex flex-col lg:flex-row gap-6 items-start max-w-4xl mx-auto">
                <div className="shrink-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <h1 className="text-[15px] font-bold text-fg leading-none">{groupLabel(sel.path[0])}{sel.path.length > 1 ? <span className="text-fg-4"> · {sel.path.slice(1).join('.')}</span> : null}</h1>
                  </div>
                  <div className="rounded-xl border border-line-2 bg-gradient-to-b from-surface-raised to-surface p-3 shadow-lg shadow-black/40 w-[264px]">
                    <div className="flex items-center justify-between px-1 pb-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">Equipment</span>
                      <span className="text-[10px] text-fg-5 tabular-nums">{definedCount} / 16</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {SLOT_ORDER.map((slot) => {
                        const rs = resolved[slot];
                        const g = rs?.entry;
                        const v = g ? selValidation.get(slot) : undefined;
                        const id = v && 'id' in v ? v.id : (g && g.kind === 'item' ? resolve(g.name)?.id : undefined);
                        const st = v?.state;
                        const miss = st === 'missing' || st === 'unknown';
                        const iss = st === 'aug-mismatch' || st === 'wrong-bag';
                        const dyn = st === 'dynamic';
                        const inh = !!rs?.inherited;
                        const well = miss ? 'border-red-500/60 bg-red-500/10'
                          : iss ? 'border-amber-500/55 bg-black/30'
                            : dyn ? 'border-sky-500/45 border-dashed bg-black/30'
                              : 'border-line bg-black/30';
                        const iconDim = miss ? 'grayscale opacity-45' : inh ? 'opacity-55' : '';
                        const title = g
                          ? `${SLOT_LABEL[slot]}: ${g.kind === 'item' ? g.name : g.raw}${inh ? ` (from sets.${rs!.source})` : ''}${v ? ` — ${stateText(v)}` : ''}`
                          : `${SLOT_LABEL[slot]}: empty`;
                        return (
                          <button key={slot} title={title} className={`relative aspect-square rounded-lg border ${well} grid place-items-center overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] hover:brightness-125 hover:-translate-y-px transition-[transform,filter,border-color]`}>
                            {id && id > 0 ? (
                              <span className={`grid place-items-center ${iconDim}`}><IconInner id={id} size={32} name={g && g.kind === 'item' ? g.name : ''} assets={assetsAny} bmpHas={iconSet.has(id)} /></span>
                            ) : g && g.kind === 'dynamic' ? (
                              <span className="text-sky-300/70 text-[12px] font-mono">{'{ }'}</span>
                            ) : (
                              <span className="text-[7.5px] font-bold uppercase tracking-wide text-fg-5/70">{SLOT_LABEL[slot]}</span>
                            )}
                            {miss && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white grid place-items-center text-[9px] font-extrabold shadow">×</span>}
                            {iss && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-black grid place-items-center text-[9px] font-extrabold shadow">!</span>}
                            {inh && <span title="Inherited" className="absolute bottom-0.5 left-0.5 text-fg-3/80"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg></span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {sel.combineBase && <div className="mt-2.5 w-[264px] text-[10.5px] text-fg-4 leading-snug">Inherits from <span className="font-mono text-fg-3">{sel.combineBase}</span>. Faded pieces come from the base set.</div>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 w-[264px] text-[10px] text-fg-4">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-red-500/70" />Missing</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] border border-amber-500/70" />Augment / bag</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] border border-dashed border-sky-500/60" />Dynamic</span>
                    <span className="flex items-center gap-1.5"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-fg-4"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>Inherited</span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 w-full">
                  <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-fg-5 mb-2 pl-0.5">Fit report</div>
                  <div className="rounded-xl border border-line bg-surface overflow-hidden">
                    {SLOT_ORDER.filter((slot) => resolved[slot]).map((slot) => {
                      const rs = resolved[slot]!;
                      const g = rs.entry;
                      const v = selValidation.get(slot)!;
                      const tint = v.state === 'missing' || v.state === 'unknown' ? 'bg-red-500/[0.06]' : v.state === 'aug-mismatch' || v.state === 'wrong-bag' ? 'bg-amber-500/[0.05]' : '';
                      return (
                        <div key={slot} className={`grid grid-cols-[64px_1fr_auto] items-center gap-3 px-3.5 py-2 border-t border-line first:border-t-0 ${tint}`}>
                          <span className="text-[9.5px] font-bold uppercase tracking-wide text-fg-5">{SLOT_LABEL[slot]}</span>
                          <div className="min-w-0">
                            <div className={`truncate text-[12.5px] ${rs.inherited ? 'text-fg-4' : 'text-fg-2'}`}>{g.kind === 'item' ? g.name : <span className="text-sky-300 font-mono">{g.raw}</span>}</div>
                            {(rs.inherited || (g.kind === 'item' && (g.augments?.length || g.bag))) && (
                              <div className="text-[10px] text-fg-5 mt-px truncate">
                                {rs.inherited && <span>from {rs.source}</span>}
                                {g.kind === 'item' && g.augments && g.augments.length > 0 && <span>{rs.inherited ? ' · ' : ''}+{g.augments.length} aug</span>}
                                {g.kind === 'item' && g.bag && <span> · <span className="font-mono">{g.bag}</span></span>}
                              </div>
                            )}
                          </div>
                          <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold whitespace-nowrap ${stateTextClass(v.state)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${stateDot(v.state)}`} />{stateText(v)}
                          </span>
                        </div>
                      );
                    })}
                    {definedCount === 0 && <div className="px-3.5 py-8 text-center text-[11px] text-fg-4">This set is empty{sel.combineBase ? ' (inherits everything from its base set)' : ''}.</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full grid place-items-center text-[12px] text-fg-4">Select a set.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GearsetLauncher() {
  const known = useKnownCharacters();
  const [charName, setCharName] = useStickyPersisted('gearset.char', '');
  const active = useMemo(() => known.find((c) => c.name === charName) ?? known[0], [known, charName]);
  return (
    <div className="h-full grid place-items-center p-6">
      <div className="w-full max-w-[280px] text-center">
        <div className="mx-auto mb-3.5 w-14 h-14 rounded-2xl border border-line bg-surface grid place-items-center text-accent">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4-3 4 2 4-2 4 3-1 6c-.5 3-3 5.5-7 7-4-1.5-6.5-4-7-7z" /><path d="M12 5v15" /><path d="M5 9h14" /></svg>
        </div>
        <div className="text-[16px] font-bold text-fg mb-1.5">Gearsets</div>
        <div className="text-[12px] text-fg-4 leading-relaxed mb-4">Your GearSwap loadouts open in their own window, sized for the equipment grid and fit report.</div>
        {known.length > 0 && <div className="mb-2.5"><CharacterSelect value={active?.name ?? ''} onChange={setCharName} chars={known} /></div>}
        <button onClick={() => void openGearsetWindow()} className="w-full px-3 py-2.5 text-[13px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Open Gearsets Window</button>
      </div>
    </div>
  );
}
