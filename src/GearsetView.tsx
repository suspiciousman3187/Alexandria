import { useEffect, useMemo, useState } from 'react';
import { useKnownCharacters, useAvailableIcons, useAddonInfo } from './bridge';
import { useItemNames, nameMatches, type ItemName } from './itemNames';
import { useSettings } from './settings';
import { IconInner } from './atlasIcon';
import { useItemCard, RichDescription } from './ItemTooltip';
import { CharacterSelect, Select, SearchInput } from './ui';
import { useStickyPersisted } from './sticky';
import { openGearsetWindow } from './overlayWindow';
import { findGearsetFile, readGearsetFile, writeGearsetFile, listCharacterJobs, deriveGearswapData, JOB_CODES } from './gearset/gearsetFiles';
import { parseGearsetFile, resolveSet, type ParsedGearsets, type ParsedSet, type GearEntry } from './gearset/gearsetParser';
import { SLOT_ORDER, SLOT_LABEL, type SlotKey } from './gearset/slotLayout';
import { makeNameResolver, ownedById, validateGear, bagLabel, type SlotValidation, type OwnedCopy } from './gearset/gearsetValidate';

const EQUIP_BAGS = new Set([0, 8, 10, 11, 12, 13, 14, 15, 16]);

// Job-equip bit per job code: items.lua `jobs` is a bitmask where bit (1<<jobId) is set for each job that can
// equip the item. JOB_CODES is jobId order (WAR=1..RUN=22), so the bit is 1<<(index+1).
const JOB_BIT: Record<string, number> = Object.fromEntries(JOB_CODES.map((c, i) => [c, 1 << (i + 1)]));

// Equip-slot bitmask per canonical slot (matches item_names `sl`), for filtering the swap picker to items
// that actually fit the slot. Ears/rings share their pair's bits.
const SLOT_BIT: Record<SlotKey, number> = {
  main: 0x1, sub: 0x2, range: 0x4, ammo: 0x8, head: 0x10, body: 0x20, hands: 0x40, legs: 0x80, feet: 0x100,
  neck: 0x200, waist: 0x400, left_ear: 0x1800, right_ear: 0x1800, left_ring: 0x6000, right_ring: 0x6000, back: 0x8000,
};

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
  const [filePath, setFilePath] = useState('');
  const [fileSrc, setFileSrc] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1800); return () => clearTimeout(t); }, [saved]);

  useEffect(() => {
    if (!base || !active || !job) { setParsed(null); setFileErr(null); setFilePath(''); setFileSrc(''); return; }
    let alive = true;
    setLoading(true); setFileErr(null);
    (async () => {
      const path = await findGearsetFile(base, active.name, job);
      if (!alive) return;
      if (!path) { setParsed(null); setFilePath(''); setFileSrc(''); setFileErr('No gearset file found for this job.'); setLoading(false); return; }
      const src = await readGearsetFile(path);
      if (!alive) return;
      if (src == null) { setParsed(null); setFilePath(''); setFileSrc(''); setFileErr('Could not read the gearset file.'); setLoading(false); return; }
      setFilePath(path); setFileSrc(src);
      setParsed(parseGearsetFile(src));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [base, active?.name, job]);

  const card = useItemCard();
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
      if (q && !nameMatches(s.key, q)) continue;
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

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selSlot, setSelSlot] = useState<SlotKey | null>(null);
  const [tab, setTab] = useState<'fit' | 'slot'>('fit');
  useEffect(() => { setSelSlot(null); setTab('fit'); }, [selKey]);
  const toggleGroup = (g: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const idToItem = useMemo(() => { const m = new Map<number, ItemName>(); for (const it of items) if (!m.has(it.id)) m.set(it.id, it); return m; }, [items]);
  const [pick, setPick] = useState('');
  useEffect(() => { setPick(''); }, [selSlot]);
  const pickCandidates = useMemo(() => {
    if (!selSlot) return [] as { id: number; name: string; count: number }[];
    const bit = SLOT_BIT[selSlot];
    const jbit = JOB_BIT[job] ?? 0;
    const q = pick.trim().toLowerCase();
    const out: { id: number; name: string; count: number }[] = [];
    for (const [id, copies] of owned) {
      const it = idToItem.get(id);
      if (!it || !it.sl || !(it.sl & bit)) continue;
      if (jbit && it.jb && !(it.jb & jbit)) continue; // hide gear this job can't equip
      if (q && !nameMatches(it.n, q)) continue;
      out.push({ id, name: it.n, count: copies.length });
      if (out.length >= 60) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [selSlot, owned, idToItem, pick, job]);

  // Surgical in-place edit: splice the new value over just this slot's `key = value` byte range, so every
  // comment and every other slot in the file is preserved untouched.
  const applySwap = async (slot: SlotKey, name: string, augments?: string[]) => {
    if (!sel || !filePath || !fileSrc || saving) return;
    const span = sel.slotSpans?.[slot];
    if (!span) return; // only directly-defined slots are editable here (inherited/dynamic stay read-only)
    const slice = fileSrc.slice(span[0], span[1]);
    const eq = slice.indexOf('=');
    if (eq < 0) return;
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // A specific augment roll writes the table form; a plain swap writes a bare string.
    const val = augments && augments.length
      ? `{ name="${esc(name)}", augments={${augments.map((a) => `"${esc(a)}"`).join(',')},} }`
      : `"${esc(name)}"`;
    const newSrc = fileSrc.slice(0, span[0]) + slice.slice(0, eq + 1) + ' ' + val + fileSrc.slice(span[1]);
    setSaving(true);
    const ok = await writeGearsetFile(filePath, newSrc);
    setSaving(false);
    if (ok) { setFileSrc(newSrc); setParsed(parseGearsetFile(newSrc)); setSaved(true); }
  };

  const inhNote = sel?.combineBase;
  const selEntry = selSlot ? resolved[selSlot]?.entry : undefined;
  const selV = selSlot ? selValidation.get(selSlot) : undefined;
  const canEdit = !!(selSlot && sel?.slotSpans?.[selSlot]);

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
        <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: '242px minmax(0,1fr) 340px' }}>
          {/* LEFT: sets tree */}
          <aside className="min-h-0 flex flex-col border-r border-line bg-surface/40 overflow-hidden">
            <div className="flex-1 overflow-y-auto py-1.5">
              {grouped.map(({ group, sets }) => {
                const hue = hueOf(group);
                const gs = groupStats.get(group);
                const open = !collapsed.has(group);
                return (
                  <div key={group} className="px-2">
                    <button onClick={() => toggleGroup(group)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                      <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: hue }} />
                      <span className="flex-1 text-left text-[12.5px] font-semibold text-fg-2 truncate">{groupLabel(group)}</span>
                      {gs && gs.missing > 0 && <span className="text-[10px] font-bold text-red-300 tabular-nums px-1.5 rounded bg-red-500/15">{gs.missing}</span>}
                      {gs && gs.missing === 0 && gs.issues > 0 && <span className="text-[10px] font-bold text-amber-300 tabular-nums px-1.5 rounded bg-amber-500/15">{gs.issues}</span>}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`text-fg-4 transition-transform ${open ? '' : '-rotate-90'}`}><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {open && (
                      <div className="pb-1 pl-1.5">
                        {sets.map((s) => {
                          const st = setStatus.get(s.key);
                          const leaf = s.path.slice(1).join('.') || 'Base';
                          const on = s.key === selKey;
                          const dot = st && st.missing > 0 ? 'bg-red-400' : st && st.issues > 0 ? 'bg-amber-400' : 'bg-emerald-400/70';
                          return (
                            <button key={s.key} onClick={() => setSelKey(s.key)}
                              className={`relative w-full flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-left transition-colors ${on ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}>
                              {on && <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2.5px] rounded bg-accent" />}
                              <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${dot}`} />
                              <span className={`flex-1 truncate text-[12.5px] ${on ? 'text-fg font-medium' : 'text-fg-3'}`}>{leaf}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {grouped.length === 0 && <div className="px-4 py-6 text-[11px] text-fg-4 text-center">No sets match.</div>}
            </div>
          </aside>

          {/* CENTER: paperdoll */}
          <section className="min-h-0 overflow-y-auto">
            {sel ? (
              <div className="p-5">
                <div className="flex items-end gap-3 mb-1">
                  <h1 className="text-[16px] font-bold text-fg leading-none"><span className="text-fg-4 font-medium">{groupLabel(sel.path[0])} · </span>{sel.path.slice(1).join('.') || 'Base'}</h1>
                  <span className="ml-auto text-[11px] text-fg-4 tabular-nums">{definedCount} / 16 slots</span>
                </div>
                {inhNote && <div className="flex items-center gap-1.5 text-[11.5px] text-fg-4 mb-3"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7" /></svg>Inherits from <span className="font-mono text-fg-3">{inhNote}</span>, unset slots fall through</div>}
                <div className="grid grid-cols-4 gap-2 max-w-[560px]">
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
                    const on = slot === selSlot;
                    const ring = on ? 'border-accent ring-1 ring-accent' : miss ? 'border-red-500/50' : iss ? 'border-amber-500/45' : dyn ? 'border-sky-500/45 border-dashed' : 'border-line';
                    if (!g) return (
                      <div key={slot} className="rounded-xl border border-line bg-surface/40 p-2 min-h-[78px] flex flex-col items-center justify-center gap-1.5 opacity-45">
                        <div className="text-[8.5px] font-bold uppercase tracking-wide text-fg-4 leading-none">{SLOT_LABEL[slot]}</div>
                        <div className="w-10 h-10 rounded-lg bg-field border border-line" />
                      </div>
                    );
                    return (
                      <button key={slot}
                        onMouseEnter={(e) => { if (id && id > 0) card?.hoverOpen({ id, n: g.kind === 'item' ? g.name : undefined, aug: g.kind === 'item' ? g.augments : undefined }, e.currentTarget.getBoundingClientRect(), e.currentTarget); }}
                        onMouseLeave={() => card?.hoverHide()}
                        onClick={() => { setSelSlot(slot); setTab('slot'); }} className={`relative rounded-xl border ${ring} ${inh ? 'opacity-80' : ''} bg-surface-raised hover:bg-surface-hover p-2 min-h-[78px] flex flex-col items-center justify-center gap-1.5 transition-colors`}>
                        {miss && <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-red-500 text-white grid place-items-center text-[11px] font-extrabold border-2 border-[var(--color-bg)]">×</span>}
                        {iss && <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-amber-500 text-black grid place-items-center text-[11px] font-extrabold border-2 border-[var(--color-bg)]">!</span>}
                        {inh && <span className="absolute top-1.5 left-1.5 text-fg-4"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg></span>}
                        <div className="text-[8.5px] font-bold uppercase tracking-wide text-fg-4 leading-none">{SLOT_LABEL[slot]}</div>
                        <div className="w-10 h-10 rounded-lg bg-field border border-line grid place-items-center overflow-hidden">
                          {id && id > 0 ? <span className={miss ? 'grayscale opacity-45' : ''}><IconInner id={id} size={40} name={g.kind === 'item' ? g.name : ''} assets={assetsAny} bmpHas={iconSet.has(id)} /></span>
                            : dyn ? <span className="text-sky-300/70 text-[13px] font-mono">{'{ }'}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 max-w-[620px] text-[11px] text-fg-4">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-red-500/70" />Missing</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-amber-500/70" />Augment / wrong bag</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] border border-dashed border-sky-500/60" />Dynamic</span>
                  <span className="flex items-center gap-1.5"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-fg-4"><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>Inherited</span>
                  <span className="text-fg-4/80">Click a slot to inspect &amp; swap</span>
                </div>
              </div>
            ) : <div className="h-full grid place-items-center text-[12px] text-fg-4">Select a set.</div>}
          </section>

          {/* RIGHT: fit report / slot inspector */}
          <aside className="min-h-0 flex flex-col border-l border-line bg-surface/40">
            <div className="shrink-0 flex gap-1 p-2 border-b border-line">
              <button onClick={() => setTab('fit')} className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'fit' ? 'bg-accent text-on-accent' : 'text-fg-4 hover:text-fg-2 hover:bg-surface-hover'}`}>Fit Report</button>
              <button onClick={() => setTab('slot')} className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'slot' ? 'bg-accent text-on-accent' : 'text-fg-4 hover:text-fg-2 hover:bg-surface-hover'}`}>Slot</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {tab === 'fit' ? (
                sel ? (
                  <>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {(() => { const st = setStatus.get(sel.key); const ok = definedCount - (st?.missing ?? 0) - (st?.issues ?? 0); return (<>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md text-emerald-300 bg-emerald-500/10"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{ok} owned</span>
                        {st && st.missing > 0 && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md text-red-300 bg-red-500/10"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />{st.missing} missing</span>}
                        {st && st.issues > 0 && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md text-amber-300 bg-amber-500/10"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{st.issues} issue{st.issues > 1 ? 's' : ''}</span>}
                      </>); })()}
                    </div>
                    {SLOT_ORDER.filter((slot) => resolved[slot]).map((slot) => {
                      const rs = resolved[slot]!; const g = rs.entry; const v = selValidation.get(slot)!;
                      const idv = v && 'id' in v ? v.id : undefined;
                      // Prefer the augments written in the set; if none, fall back to the equipped copy's real augments
                      // (path/Unity items are often written plainly in the .lua but carry a path on the actual piece).
                      const augs = g.kind === 'item'
                        ? (g.augments && g.augments.length ? g.augments : (idv ? (owned.get(idv)?.find((c) => EQUIP_BAGS.has(c.bag) && c.aug.length)?.aug ?? []) : []))
                        : [];
                      return (
                        <button key={slot} onClick={() => { setSelSlot(slot); setTab('slot'); }} className={`w-full flex items-start gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-surface-hover transition-colors ${slot === selSlot ? 'bg-accent/10' : ''}`}>
                          <span className="w-[62px] shrink-0 mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-fg-4">{SLOT_LABEL[slot]}</span>
                          <div className="flex-1 min-w-0">
                            <div className={`truncate text-[12px] ${g.kind === 'dynamic' ? 'font-mono text-sky-300 text-[11px]' : rs.inherited ? 'text-fg-4' : 'text-fg-2'}`}>{g.kind === 'item' ? g.name : g.raw}</div>
                            {augs.length > 0 && <div className="mt-1 flex flex-col gap-0.5">{augs.map((a, i) => <RichDescription key={i} text={a} className="text-[11px] leading-snug break-words" />)}</div>}
                            {rs.inherited && <div className="text-[10px] text-fg-4 mt-px">from {rs.source}</div>}
                          </div>
                          <span className={`inline-flex items-center gap-1.5 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${stateTextClass(v.state)}`}><span className={`w-1.5 h-1.5 rounded-full ${stateDot(v.state)}`} />{v.state === 'aug-mismatch' || v.state === 'wrong-bag' ? 'Aug' : v.state === 'missing' || v.state === 'unknown' ? 'Miss' : v.state === 'dynamic' ? 'Lua' : 'OK'}</span>
                        </button>
                      );
                    })}
                    {definedCount === 0 && <div className="px-2 py-8 text-center text-[11px] text-fg-4">This set is empty{inhNote ? ' (inherits everything from its base set)' : ''}.</div>}
                  </>
                ) : <div className="px-2 py-10 text-center text-[12px] text-fg-4">Select a set.</div>
              ) : (
                !selEntry || !selSlot ? (
                  <div className="px-3 py-12 text-center text-[12px] text-fg-4 leading-relaxed">Select a slot in the paperdoll to inspect its item, owned copies and augments, or swap it.</div>
                ) : (
                  <SlotInspector slot={selSlot} entry={selEntry} v={selV}
                    inh={resolved[selSlot]?.inherited ? resolved[selSlot]!.source : undefined}
                    id={selV && 'id' in selV ? selV.id : undefined}
                    owned={owned} assets={assetsAny} iconSet={iconSet}
                    editable={canEdit} saving={saving} saved={saved}
                    pick={pick} setPick={setPick} candidates={pickCandidates} onSwap={(name, augments) => { void applySwap(selSlot, name, augments); }}
                    fileName={active && job ? `${active.name}_${job}.lua` : ''} />
                )
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function SlotInspector({ slot, entry, v, inh, id, owned, assets, iconSet, editable, saving, saved, pick, setPick, candidates, onSwap, fileName }: {
  slot: SlotKey; entry: GearEntry; v?: SlotValidation; inh?: string; id?: number;
  owned: Map<number, OwnedCopy[]>; assets?: string; iconSet: Set<number>; editable: boolean; saving: boolean; saved: boolean;
  pick: string; setPick: (s: string) => void; candidates: { id: number; name: string; count: number }[];
  onSwap: (name: string, augments?: string[]) => void; fileName: string;
}) {
  const dyn = entry.kind === 'dynamic';
  const name = entry.kind === 'item' ? entry.name : entry.raw;
  const want = entry.kind === 'item' ? (entry.augments ?? []) : [];
  const copies = id ? (owned.get(id) ?? []) : [];
  const stColor = !v ? 'text-fg-4' : v.state === 'ok' ? 'text-emerald-300'
    : v.state === 'missing' || v.state === 'unknown' ? 'text-red-300' : v.state === 'dynamic' ? 'text-sky-300' : 'text-amber-300';
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-fg-4">{SLOT_LABEL[slot]}{inh ? ` · inherited from ${inh}` : ''}</div>
      <div className="flex items-center gap-3 mt-2 mb-3.5">
        <div className="w-[52px] h-[52px] rounded-lg bg-field border border-line grid place-items-center overflow-hidden shrink-0">
          {id && id > 0 ? <IconInner id={id} size={48} name={entry.kind === 'item' ? entry.name : ''} assets={assets} bmpHas={iconSet.has(id)} /> : dyn ? <span className="text-sky-300/70 font-mono text-[13px]">{'{ }'}</span> : null}
        </div>
        <div className="min-w-0">
          <div className={`font-bold ${dyn ? 'font-mono text-[13px] text-sky-300 break-all' : 'text-[15px] text-fg'}`}>{name}</div>
          {v && <div className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold mt-1 ${stColor}`}><span className={`w-1.5 h-1.5 rounded-full ${stateDot(v.state)}`} />{stateText(v)}</div>}
        </div>
      </div>

      {dyn ? (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4 mb-1.5">Dynamic value</div>
          <div className="font-mono text-[11.5px] text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-lg px-3 py-2 break-all">{entry.raw}</div>
          <div className="text-[11.5px] text-fg-4 mt-2 leading-relaxed">Resolved by the Lua at runtime, so it can't be checked against your inventory. Left as-is.</div>
        </div>
      ) : (
        <>
          {want.length > 0 && (
            <div className="mb-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-violet-300 mb-1.5">Augments in this set</div>
              {want.map((a, i) => {
                const have = copies.some((c) => EQUIP_BAGS.has(c.bag) && c.aug.map((x) => x.toLowerCase()).includes(a.toLowerCase()));
                return <div key={i} className="flex items-start gap-2 py-0.5"><span className={`w-3.5 text-center shrink-0 text-[11.5px] font-bold ${have ? 'text-emerald-400' : 'text-amber-300'}`}>{have ? '✓' : '✕'}</span><div className="min-w-0 flex-1"><RichDescription text={a} className="text-[11.5px] leading-snug break-words" /></div></div>;
              })}
              <div className="text-[10px] text-fg-4 mt-1">✓ present on an equippable copy · ✕ no owned copy has it</div>
            </div>
          )}
          <div className="mb-3.5">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Owned copies</span>
              {copies.length > 1 && <span className="text-[10px] text-fg-4">{copies.length} rolls, click one to use</span>}
            </div>
            {copies.length === 0 ? (
              <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 leading-relaxed">No copies in any bag. Buy or craft one, or pick a substitute below.</div>
            ) : copies.map((c, i) => {
              const eq = EQUIP_BAGS.has(c.bag);
              const usable = editable && eq && entry.kind === 'item';
              const cur = eq && want.length > 0 && want.length === c.aug.length && want.every((w) => c.aug.map((x) => x.toLowerCase()).includes(w.toLowerCase()));
              const inner = (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: eq ? 'var(--color-accent)' : '#eeb24a' }} />
                    <span className="text-[11.5px] font-semibold text-fg-3 shrink-0">{bagLabel(c.bag)}</span>
                    {cur && <span className="text-[9px] font-bold uppercase text-accent shrink-0">in set</span>}
                    <span className="flex-1" />
                    {usable && <span className="text-[9px] font-bold uppercase tracking-wide text-accent shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Use this roll</span>}
                  </div>
                  {c.aug.length > 0
                    ? <div className="mt-1 pl-4 flex flex-col gap-0.5">{c.aug.map((a, k) => <RichDescription key={k} text={a} className="text-[11px] leading-snug break-words" />)}</div>
                    : <div className="mt-1 pl-4 text-[10px] text-fg-4">{eq ? 'no augments' : 'not equippable here'}</div>}
                </>
              );
              return usable
                ? <button key={i} disabled={saving} onClick={() => onSwap(name, c.aug.length ? c.aug : undefined)} className={`group w-full flex flex-col items-stretch px-2.5 py-2 rounded-lg border mb-1.5 text-left transition-colors disabled:opacity-50 ${cur ? 'bg-accent/10 border-accent/40' : 'bg-surface border-line hover:border-accent/40 hover:bg-surface-hover'}`}>{inner}</button>
                : <div key={i} className="flex flex-col items-stretch px-2.5 py-2 rounded-lg bg-surface border border-line mb-1.5">{inner}</div>;
            })}
          </div>
        </>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Swap item</span>
          {saving ? <span className="text-[10px] font-semibold text-accent">saving…</span>
            : saved ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 6" /></svg>saved</span> : null}
        </div>
        {editable ? (
          <>
            <input value={pick} onChange={(e) => setPick(e.target.value)} placeholder={`Search any ${SLOT_LABEL[slot].toLowerCase()} you own…`} className="w-full h-9 rounded-lg bg-field border border-line text-fg-2 px-3 text-[12.5px] outline-none focus:border-accent placeholder-fg-4 mb-1.5" />
            <div className="max-h-56 overflow-y-auto">
              {candidates.length === 0 ? <div className="text-[11px] text-fg-4 px-2 py-3 text-center">No owned {SLOT_LABEL[slot].toLowerCase()} match.</div> :
                candidates.map((c) => (
                  <button key={c.id} disabled={saving} onClick={() => onSwap(c.name)} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-hover disabled:opacity-50 transition-colors text-left">
                    <span className="w-6 h-6 rounded bg-field border border-line grid place-items-center overflow-hidden shrink-0"><IconInner id={c.id} size={22} name={c.name} assets={assets} bmpHas={iconSet.has(c.id)} /></span>
                    <span className="flex-1 min-w-0 truncate text-[12px] text-fg-2">{c.name}</span>
                    {c.count > 1 && <span className="text-[10px] font-bold text-fg-4">×{c.count}</span>}
                  </button>
                ))}
            </div>
            {fileName && <div className="text-[10px] text-fg-4 mt-2">Writes to <span className="font-mono text-fg-3">{fileName}</span></div>}
          </>
        ) : (
          <div className="text-[11.5px] text-fg-4 bg-field border border-line rounded-lg px-3 py-2.5 leading-relaxed">
            {inh ? <>This piece is inherited from <span className="font-mono text-fg-3">{inh}</span>. Edit it in that base set, or add an override to this set by hand.</> : entry.kind === 'dynamic' ? 'Dynamic (Lua) values are edited by hand.' : 'This slot can only be edited directly in the .lua for now.'}
          </div>
        )}
      </div>
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
