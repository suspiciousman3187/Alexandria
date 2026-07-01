import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Group, Row, RowStacked, Toggle, Chip, Select, SectionTabs, Stepper } from './ui';
import { Collapse } from './overlay';
import { useSticky } from './sticky';
import { useSettings, setSettings } from './settings';

function CharSection({ name, desc, open, onToggle, bar, children }: { name: string; desc: string; open: boolean; onToggle: () => void; bar?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-field/40 transition-colors">
        <svg className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        <span className="font-semibold text-fg text-[13px] truncate">{name}</span>
        <span className="ml-auto shrink-0 text-[11px] text-fg-4 tabular-nums">{desc}</span>
      </button>
      {bar && <div className="px-3 pb-2.5">{bar}</div>}
      <Collapse open={open}><div className="px-3 pb-3">{children}</div></Collapse>
    </div>
  );
}
import { useBoxes, useKnownCharacters, useAvailableIcons, runOrganize, broadcastOrganize, retrieveItems, broadcastRetrieve, appDataPath, inTauri, inNomadZone, type OrganizeRules } from './bridge';

function OrgIcon({ id, n, assets, sm }: { id: number; n: string; assets?: string; sm?: boolean }) {
  const [broken, setBroken] = useState(false);
  const ready = useAvailableIcons().has(id);
  const src = ready && assets && inTauri ? convertFileSrc(`${assets}/icon_${id}.bmp`) : null;
  return (
    <div className={`${sm ? 'w-5 h-5' : 'w-7 h-7'} rounded bg-surface grid place-items-center overflow-hidden shrink-0`}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} className={`${sm ? 'w-full h-full' : 'w-6 h-6'} object-contain`} /> : <span className="text-[9px] text-fg-4">{n.slice(0, 3)}</span>}
    </div>
  );
}

function RuleList({ value, onChange, placeholder, nameToId, assets }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; nameToId: Map<string, number>; assets?: string }) {
  const [add, setAdd] = useState('');
  const addItem = () => { const n = add.trim(); if (n && !value.some((x) => x.toLowerCase() === n.toLowerCase())) onChange([...value, n]); setAdd(''); };
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} placeholder={placeholder} className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
        <button onClick={addItem} disabled={!add.trim()} className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40">Add</button>
      </div>
      {value.length > 0 && (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
          {value.map((name) => (
            <div key={name} className="flex items-center gap-2 px-2.5 py-1">
              <OrgIcon id={nameToId.get(name.toLowerCase()) ?? 0} n={name} assets={assets} sm />
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{name}</span>
              <button onClick={() => onChange(value.filter((x) => x !== name))} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STORABLE_BAGS = [
  { id: 5, name: 'Satchel' }, { id: 6, name: 'Sack' }, { id: 7, name: 'Case' },
  { id: 2, name: 'Storage' }, { id: 4, name: 'Locker' }, { id: 1, name: 'Safe' }, { id: 9, name: 'Safe 2' },
];
const STORABLE_IDS = new Set(STORABLE_BAGS.map((b) => b.id));
const cleanBags = (ids: number[]) => ids.filter((id) => STORABLE_IDS.has(id));

// Bags reachable anywhere (no Mog House). Safe/Safe 2/Storage/Locker need a Mog House,
// so Light Organize (which runs outside the Mog House) must never target them.
const LIGHT_BAGS = [5, 6, 7];
const STORAGE_NAMES: Record<number, string> = { 5: 'Satchel', 6: 'Sack', 7: 'Case', 1: 'Safe', 9: 'Safe 2', 2: 'Storage', 4: 'Locker' };

const DEFAULT_RULES: OrganizeRules = { alwaysBring: [], keep: [], keepSingle: [], storableBags: [5, 6, 7], storeUsable: true, reserve: 3 };

const ALL = 'All Characters';

type Tab = 'organize' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'organize', label: 'Organize' },
  { id: 'settings', label: 'Settings' },
];

export default function OrganizeView() {
  const boxes = useBoxes();
  const known = useKnownCharacters();
  const organizing = known.filter((k) => k.online && k.org?.active);
  const completed = known.filter((k) => k.online && k.org && !k.org.active && (k.orgPlan?.length ?? 0) > 0);
  const [rules, setRulesState] = useState<OrganizeRules>(DEFAULT_RULES);
  const [target, setTarget] = useSticky<string>('org.target', ALL);
  const [ran, setRan] = useState<string | null>(null);
  const [rawTab, setTab] = useSticky<Tab>('org.tab', 'organize');
  const tab: Tab = rawTab === 'organize' ? 'organize' : 'settings';
  const settings = useSettings();
  const [collapsed, setCollapsed] = useSticky<Record<string, boolean>>('org.collapsed', {});
  const toggleCollapse = (name: string) => setCollapsed((c) => ({ ...c, [name]: !c[name] }));
  const loaded = useRef(false);

  useEffect(() => {
    if (!inTauri) { loaded.current = true; return; }
    (async () => {
      try {
        const txt = await invoke<string>('read_text_file', { path: await appDataPath('organize_presets.json') });
        const s = JSON.parse(txt) as { current?: string; presets?: Record<string, OrganizeRules> };
        const r = s.presets && s.current ? s.presets[s.current] : undefined;
        if (r) setRulesState({ ...DEFAULT_RULES, ...r, storableBags: cleanBags(r.storableBags ?? DEFAULT_RULES.storableBags) });
      } catch {
        try {
          const legacy = JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('organize_rules.json') })) as OrganizeRules;
          setRulesState({ ...DEFAULT_RULES, ...legacy, storableBags: cleanBags(legacy.storableBags ?? DEFAULT_RULES.storableBags) });
        } catch { /* fresh */ }
      }
      loaded.current = true;
    })();
  }, []);

  const setRules = (r: OrganizeRules) => {
    setRulesState(r);
    if (inTauri) void (async () => { try { await invoke('write_text_file', { path: await appDataPath('organize_rules.json'), contents: JSON.stringify(r) }); } catch { /* ignore */ } })();
  };
  const set = <K extends keyof OrganizeRules>(k: K, v: OrganizeRules[K]) => setRules({ ...rules, [k]: v });
  const toggleBag = (id: number) => set('storableBags', rules.storableBags.includes(id) ? rules.storableBags.filter((b) => b !== id) : [...rules.storableBags, id]);

  const run = () => {
    if (target === ALL) { void broadcastOrganize(rules); setRan(`Sent to all ${boxes.length} character${boxes.length === 1 ? '' : 's'}.`); }
    else { const box = boxes.find((b) => b.name === target); if (!box) return; runOrganize(box.conn, rules); setRan(`Sent to ${box.name}.`); }
    window.setTimeout(() => setRan(null), 4000);
  };

  const targetOptions = [ALL, ...boxes.map((b) => b.name)];
  const targetBusy = target === ALL ? organizing.length > 0 : organizing.some((k) => k.name === target);

  const canStore = (b: { mog?: boolean; zone?: number }) => !!b.mog || inNomadZone(b.zone);
  const targetMog = target === ALL ? boxes.some(canStore) : (() => { const b = boxes.find((x) => x.name === target); return !!b && canStore(b); })();
  const availIds = useMemo(() => {
    const want = target === ALL ? known.filter((k) => k.online && k.conn != null) : known.filter((k) => k.name === target);
    const set = new Set<number>();
    for (const c of want) for (const b of c.inv ?? []) if (LIGHT_BAGS.includes(b.id)) set.add(b.id);
    return LIGHT_BAGS.filter((id) => set.has(id));
  }, [known, target]);

  const runLight = () => {
    const lr: OrganizeRules = { ...rules, storableBags: availIds.length ? availIds : LIGHT_BAGS };
    if (target === ALL) { void broadcastOrganize(lr); setRan(`Light organize sent to all ${boxes.length} character${boxes.length === 1 ? '' : 's'}.`); }
    else { const box = boxes.find((b) => b.name === target); if (!box) return; runOrganize(box.conn, lr); setRan(`Light organize sent to ${box.name}.`); }
    window.setTimeout(() => setRan(null), 4000);
  };

  const nameToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of known) for (const b of c.inv ?? []) for (const it of b.items) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
    return m;
  }, [known]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);

  const retrieve = () => {
    const items = rules.alwaysBring;
    if (!items.length) return;
    if (target === ALL) void broadcastRetrieve(items);
    else { const box = boxes.find((b) => b.name === target); if (box) retrieveItems(box.conn, items); }
  };

  return (
    <div className="max-w-2xl mx-auto p-5">
      <div className="mb-4">
        <SectionTabs
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({ id: t.id, label: t.label, dot: t.id === 'organize' && organizing.length > 0 ? 'bg-emerald-400' : undefined }))}
        />
      </div>

      {tab === 'organize' && (
        <>
          <Group>
            <Row label="Target"><div className="w-44"><Select value={target} onChange={setTarget} options={targetOptions} full /></div></Row>
            <RowStacked label="" desc={ran ?? 'Stores stackable items into your storage bags by the rules above, then retrieves your Always Bring items.'}>
              <div className="flex flex-col gap-2">
                <button onClick={run} disabled={boxes.length === 0 || targetBusy || !targetMog} className="le-tap w-full px-3 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
                  {boxes.length === 0 ? 'No Characters Connected' : !targetMog ? 'Full Organize · Mog House Or Nomad Moogle' : targetBusy ? 'Organizing…' : 'Run Organize'}
                </button>
                <button onClick={runLight} disabled={boxes.length === 0 || targetBusy || availIds.length === 0} className="le-tap w-full px-3 py-2 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-2">
                  {targetBusy ? 'Organizing…' : 'Light Organize'}
                  {!targetBusy && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">Experimental</span>}
                </button>
                <div className="text-[11px] text-fg-4 px-0.5">
                  {availIds.length
                    ? <>Light Organize uses your reachable bags: <span className="text-fg-3">{['Inventory', ...availIds.map((id) => STORAGE_NAMES[id])].join(' · ')}</span>. Works outside the mog house.</>
                    : 'No storage bags reachable right now.'}
                </div>
              </div>
            </RowStacked>
          </Group>

          <Group title="Automation">
            <Row label="Auto-Organize Upon Entering Mog House">
              <Toggle on={settings.autoOrganizeOnMog} onChange={(v) => setSettings({ ...settings, autoOrganizeOnMog: v })} />
            </Row>
            {settings.autoOrganizeOnMog && (
              <Row label="Delay After Entering">
                <div className="flex items-center gap-2">
                  <Stepper value={settings.autoOrganizeDelaySec} min={1} max={120} onChange={(v) => setSettings({ ...settings, autoOrganizeDelaySec: v })} />
                  <span className="text-[11px] text-fg-4">sec</span>
                </div>
              </Row>
            )}
          </Group>

          <Collapse open={organizing.length > 0}>
        <Group title="In Progress">
          <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
          {organizing.map((k) => {
            const plan = k.orgPlan ?? [];
            const doneSet = new Set(k.orgDone ?? []);
            const okSet = new Set(k.orgOk ?? []);
            const pct = plan.length > 0 ? Math.min(100, Math.round((doneSet.size / plan.length) * 100)) : 0;
            return (
              <motion.div key={k.name} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <CharSection
                name={k.name}
                desc={`${doneSet.size} / ${plan.length} moves · ${pct}%`}
                open={!collapsed[k.name]}
                onToggle={() => toggleCollapse(k.name)}
                bar={
                  <div className="h-2 rounded-full bg-field overflow-hidden">
                    <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                  </div>
                }
              >
                {plan.length > 0 && (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-line bg-field divide-y divide-line">
                    {plan.map((m) => {
                      const done = doneSet.has(m.i);
                      const ok = okSet.has(m.i);
                      return (
                        <div key={m.i} className={`flex items-center gap-2.5 px-2.5 py-1.5 transition-opacity ${done ? 'opacity-40' : ''}`}>
                          <OrgIcon id={m.id} n={m.n} assets={k.assets} />
                          <div className="min-w-0 flex-1 text-[12px] text-fg-2 truncate">
                            {m.n}{m.c > 1 && <span className="text-fg-4"> x{m.c}</span>}
                          </div>
                          <div className="shrink-0 flex items-center gap-1 text-[11px]">
                            <span className="text-fg-4">{m.from}</span>
                            <span className="text-accent">→</span>
                            <span className="text-fg-3">{m.to}</span>
                          </div>
                          <span className={`shrink-0 w-4 text-center text-[12px] ${!done ? 'text-fg-4' : ok ? 'text-emerald-400' : 'text-orange-400'}`}>{!done ? '·' : ok ? '✓' : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CharSection>
              </motion.div>
            );
          })}
          </AnimatePresence>
          </div>
        </Group>
      </Collapse>

      <Collapse open={completed.length > 0}>
        <Group title="Last Run Results">
          <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
          {completed.map((k) => {
            const okSet = new Set(k.orgOk ?? []);
            const doneSet = new Set(k.orgDone ?? []);
            const plan = k.orgPlan ?? [];
            const moved = plan.filter((s) => okSet.has(s.i));
            const skipped = plan.filter((s) => doneSet.has(s.i) && !okSet.has(s.i));
            const byDest = new Map<string, Map<number, { n: string; c: number }>>();
            for (const s of moved) {
              if (!byDest.has(s.to)) byDest.set(s.to, new Map());
              const dm = byDest.get(s.to)!;
              const e = dm.get(s.id);
              if (e) e.c += s.c; else dm.set(s.id, { n: s.n, c: s.c });
            }
            const dests = [...byDest.entries()];
            const itemCount = new Set(moved.map((s) => s.id)).size;
            const desc = [`${moved.length} moved`, skipped.length ? `${skipped.length} skipped` : null, `${itemCount} item${itemCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
            return (
              <motion.div key={k.name} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <CharSection name={k.name} desc={desc} open={!collapsed[k.name]} onToggle={() => toggleCollapse(k.name)}>
                <div className="flex flex-col gap-3">
                  {dests.map(([dest, items]) => (
                    <div key={dest}>
                      <div className="text-[11px] font-semibold text-fg-3 mb-1.5 flex items-center gap-1.5">
                        <span className="w-[3px] h-3 rounded bg-accent" />{dest}
                        <span className="text-fg-4 font-normal">{items.size} item{items.size === 1 ? '' : 's'}</span>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                        {[...items.entries()].map(([id, it]) => (
                          <div key={id} className="flex items-center gap-2 rounded-md bg-field border border-line px-2 py-1.5">
                            <OrgIcon id={id} n={it.n} assets={k.assets} />
                            <div className="min-w-0 flex-1 text-[11px] text-fg-2 truncate">{it.n}</div>
                            <div className="text-[11px] text-fg-4 tabular-nums shrink-0">x{it.c}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {skipped.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-orange-400 mb-1.5 flex items-center gap-1.5">
                        <span className="w-[3px] h-3 rounded bg-orange-400" />Couldn't Move
                        <span className="text-fg-4 font-normal">destination full</span>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                        {skipped.map((s) => (
                          <div key={s.i} className="flex items-center gap-2 rounded-md bg-field border border-line px-2 py-1.5 opacity-70">
                            <OrgIcon id={s.id} n={s.n} assets={k.assets} />
                            <div className="min-w-0 flex-1 text-[11px] text-fg-2 truncate">{s.n}{s.c > 1 && <span className="text-fg-4"> x{s.c}</span>}</div>
                            <div className="text-[11px] text-fg-4 shrink-0">→ {s.to}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CharSection>
              </motion.div>
            );
          })}
          </AnimatePresence>
          </div>
        </Group>
      </Collapse>

      {organizing.length === 0 && completed.length === 0 && (
        <Group title="Last Run Results">
          <div className="text-center text-[12px] text-fg-4 py-10">No runs yet.<br />Choose a target and hit Run to consolidate.</div>
        </Group>
      )}
        </>
      )}

      {tab === 'settings' && (
      <>
      <Group title="Rules">
        <RowStacked label="Always Bring To Inventory" desc="Pulled into inventory on every run">
          <RuleList value={rules.alwaysBring} onChange={(v) => set('alwaysBring', v)} placeholder="Item name (e.g. Echo Drops)" nameToId={nameToId} assets={assetsAny} />
          {rules.alwaysBring.length > 0 && (
            <button onClick={retrieve} disabled={boxes.length === 0} className="mt-2 w-full px-3 py-2 text-[12px] font-semibold rounded-md border border-line bg-surface-raised text-fg-2 hover:bg-surface-hover disabled:opacity-40 transition-colors">
              {boxes.length === 0 ? 'No Characters Connected' : `Retrieve All${target === ALL ? '' : ` to ${target}`}`}
            </button>
          )}
        </RowStacked>
        <RowStacked label="Keep In Inventory" desc="Never stored away">
          <RuleList value={rules.keep} onChange={(v) => set('keep', v)} placeholder="Item name (e.g. Vile Elixir)" nameToId={nameToId} assets={assetsAny} />
        </RowStacked>
        <RowStacked label="Keep Single Stack" desc="Hold one stack, store the rest">
          <RuleList value={rules.keepSingle} onChange={(v) => set('keepSingle', v)} placeholder="Item name (e.g. Remedy)" nameToId={nameToId} assets={assetsAny} />
        </RowStacked>
      </Group>
      <Group title="Storage">
        <RowStacked label="Storable Bags" desc="Overflow is stored into these">
          <div className="flex flex-wrap gap-1.5">
            {STORABLE_BAGS.map((b) => <Chip key={b.id} on={rules.storableBags.includes(b.id)} onChange={() => toggleBag(b.id)}>{b.name}</Chip>)}
          </div>
        </RowStacked>
        <Row label="Store Usable Items" desc="Also store food, oils, and consumables">
          <Toggle on={rules.storeUsable} onChange={(v) => set('storeUsable', v)} />
        </Row>
        <Row label="Reserve Inventory Slots" desc="Kept free so consolidation never fills your inventory mid-run">
          <Stepper value={rules.reserve ?? 3} min={0} max={20} onChange={(v) => set('reserve', v)} />
        </Row>
      </Group>
      </>
      )}
    </div>
  );
}
