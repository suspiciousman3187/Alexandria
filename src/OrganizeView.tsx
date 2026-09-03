import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Group, Row, RowStacked, Toggle, Chip, Select, SectionTabs, Stepper, Button } from './ui';
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
import { useBoxes, useKnownCharacters, useAvailableIcons, retrieveItems, broadcastRetrieve, appDataPath, inTauri, DEFAULT_ORGANIZE_RULES, normalizeOrganizeRules, type OrganizeRules } from './bridge';
import { useStoragePrefs, setCharLayout, STORABLE_BAGS, ALL_PLAYERS_KEY, ALL_PLAYERS_LABEL, type LayoutEntry } from './storagePrefs';
import { ItemSearchAdd } from './ItemSearchAdd';
import { useOrganize } from './useOrganize';
import { SlotRoutingEditor } from './SlotRoutingEditor';

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

type InvMode = 'keepall' | 'bringsingles' | 'bringstacks';
const INV_MODES: InvMode[] = ['keepall', 'bringsingles', 'bringstacks'];
const INV_MODE_LABEL: Record<InvMode, string> = { keepall: 'Keep All', bringsingles: 'Bring Singles', bringstacks: 'Bring Stacks' };

function InventoryRules({ rules, setRules, nameToId, assets }: { rules: OrganizeRules; setRules: (r: OrganizeRules) => void; nameToId: Map<string, number>; assets?: string }) {
  const rows = useMemo(() => {
    const out: { name: string; mode: InvMode; qty?: number }[] = [];
    for (const n of rules.alwaysBring) out.push({ name: n, mode: 'keepall' });
    for (const n of rules.keep) out.push({ name: n, mode: 'keepall' });
    for (const n of rules.keepSingle) out.push({ name: n, mode: 'bringstacks', qty: 1 });
    for (const e of rules.keepQty) out.push({ name: e.item, mode: e.stacks ? 'bringstacks' : 'bringsingles', qty: e.qty });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rules.alwaysBring, rules.keep, rules.keepSingle, rules.keepQty]);
  const has = (n: string) => rows.some((x) => x.name.toLowerCase() === n.toLowerCase());
  const strip = (r: OrganizeRules, n: string): OrganizeRules => {
    const lc = n.toLowerCase();
    return {
      ...r,
      alwaysBring: r.alwaysBring.filter((x) => x.toLowerCase() !== lc),
      keep: r.keep.filter((x) => x.toLowerCase() !== lc),
      keepSingle: r.keepSingle.filter((x) => x.toLowerCase() !== lc),
      keepQty: r.keepQty.filter((x) => x.item.toLowerCase() !== lc),
    };
  };
  const apply = (name: string, mode: InvMode, qty = 1) => {
    const r = strip(rules, name);
    if (mode === 'keepall') setRules({ ...r, alwaysBring: [...r.alwaysBring, name] });
    else setRules({ ...r, keepQty: [...r.keepQty, { item: name, qty, stacks: mode === 'bringstacks' }] });
  };
  return (
    <div>
      <div className="mb-2">
        <ItemSearchAdd onAdd={(n) => { if (!has(n)) apply(n, 'keepall'); }} placeholder="Item name (e.g. Echo Drops)" assets={assets} exclude={has} className="w-full" />
      </div>
      {rows.length > 0 && (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-2 px-2.5 py-1">
              <OrgIcon id={nameToId.get(r.name.toLowerCase()) ?? 0} n={r.name} assets={assets} sm />
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{r.name}</span>
              {r.mode !== 'keepall' && <Stepper value={r.qty ?? 1} min={1} max={r.mode === 'bringstacks' ? 30 : 99} onChange={(q) => apply(r.name, r.mode, q)} className="shrink-0" />}
              <div className="w-28 shrink-0"><Select value={r.mode} onChange={(m) => apply(r.name, m as InvMode, r.qty ?? 1)} options={INV_MODES} renderValue={(m) => INV_MODE_LABEL[m as InvMode]} renderOption={(m) => INV_MODE_LABEL[m as InvMode]} full /></div>
              <button onClick={() => setRules(strip(rules, r.name))} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STORABLE_IDS = new Set(STORABLE_BAGS.map((b) => b.id));
const cleanBags = (ids: number[]) => ids.filter((id) => STORABLE_IDS.has(id));

// Bags reachable anywhere (no Mog House). Safe/Safe 2/Storage/Locker need a Mog House,
// so Light Organize (which runs outside the Mog House) must never target them.

const DEFAULT_RULES = DEFAULT_ORGANIZE_RULES;

const ALL = 'All Characters';

function StorageLayoutEditor({ storeKey, isAll, nameToId, assets }: { storeKey: string; isAll: boolean; nameToId: Map<string, number>; assets?: string }) {
  const prefs = useStoragePrefs();
  const entries = prefs[storeKey] ?? [];
  const inherited = useMemo(() => isAll ? [] : (prefs[ALL_PLAYERS_KEY] ?? []).filter((e) => !entries.some((o) => o.item.toLowerCase() === e.item.toLowerCase())), [isAll, prefs, entries]);
  const commit = (e: LayoutEntry[]) => setCharLayout(storeKey, e);
  const addItem = (n: string) => {
    if (n && !entries.some((x) => x.item.toLowerCase() === n.toLowerCase())) commit([...entries, { item: n, bags: [6] }]);
  };
  const toggleBag = (item: string, bagId: number) => commit(entries.map((e) => e.item === item ? { ...e, bags: e.bags.includes(bagId) ? e.bags.filter((b) => b !== bagId) : [...e.bags, bagId] } : e));
  const removeEntry = (item: string) => commit(entries.filter((e) => e.item !== item));
  return (
    <div>
      <div className="mb-2">
        <ItemSearchAdd onAdd={addItem} placeholder="Item name…" assets={assets} exclude={(n) => entries.some((x) => x.item.toLowerCase() === n.toLowerCase())} className="w-full" />
      </div>
      {entries.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-3">{isAll ? 'No global preset yet. Add an item, then pick its bags in priority order. It applies to every character.' : 'No override for this character. It follows the All Players list. Add an item to send it somewhere different here.'}</div>
      ) : (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
          {entries.map((e) => (
            <div key={e.item} className="px-2.5 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <OrgIcon id={nameToId.get(e.item.toLowerCase()) ?? 0} n={e.item} assets={assets} sm />
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{e.item}</span>
                <button onClick={() => removeEntry(e.item)} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STORABLE_BAGS.map((b) => {
                  const idx = e.bags.indexOf(b.id);
                  return <Chip key={b.id} on={idx >= 0} onChange={() => toggleBag(e.item, b.id)}>{idx >= 0 ? `${idx + 1}. ${b.name}` : b.name}</Chip>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {!isAll && inherited.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-4 px-0.5 mb-1">Inherited From All Players</div>
          <div className="rounded-lg border border-line/60 bg-surface/50 overflow-hidden divide-y divide-line/60">
            {inherited.map((e) => (
              <div key={e.item} className="px-2.5 py-2 flex items-center gap-2 opacity-70">
                <OrgIcon id={nameToId.get(e.item.toLowerCase()) ?? 0} n={e.item} assets={assets} sm />
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-3">{e.item}</span>
                <span className="shrink-0 text-[10px] text-fg-4">{e.bags.map((b) => STORABLE_BAGS.find((x) => x.id === b)?.name ?? b).join(' › ')}</span>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => commit([...entries, { item: e.item, bags: e.bags.slice() }])}>Override</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = 'organize' | 'settings' | 'presets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'organize', label: 'Organize' },
  { id: 'settings', label: 'Rules' },
  { id: 'presets', label: 'Presets' },
];

export default function OrganizeView() {
  const boxes = useBoxes();
  const known = useKnownCharacters();
  const organizing = known.filter((k) => k.online && k.org?.active);
  const [rules, setRulesState] = useState<OrganizeRules>(DEFAULT_RULES);
  const [target, setTarget] = useSticky<string>('org.target', ALL);
  const [rawTab, setTab] = useSticky<Tab>('org.tab', 'organize');
  const tab: Tab = rawTab === 'settings' ? 'settings' : rawTab === 'presets' ? 'presets' : 'organize';
  const settings = useSettings();
  const [collapsed, setCollapsed] = useSticky<Record<string, boolean>>('org.collapsed', {});
  const toggleCollapse = (name: string) => setCollapsed((c) => ({ ...c, [name]: !c[name] }));
  const loaded = useRef(false);
  const previewTargets = useMemo(() => known.filter((k) => k.online && k.conn != null && (target === ALL || k.name === target)), [known, target]);
  const org = useOrganize(previewTargets, { grouped: target === ALL, title: target === ALL ? 'Organize All' : `Organize ${target}` });

  useEffect(() => {
    if (!inTauri) { loaded.current = true; return; }
    (async () => {
      try {
        const r = JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('organize_rules.json') })) as OrganizeRules;
        setRulesState(normalizeOrganizeRules({ ...DEFAULT_RULES, ...r, storableBags: cleanBags(r.storableBags ?? DEFAULT_RULES.storableBags) }));
      } catch {
        try {
          const txt = await invoke<string>('read_text_file', { path: await appDataPath('organize_presets.json') });
          const s = JSON.parse(txt) as { current?: string; presets?: Record<string, OrganizeRules> };
          const r = s.presets && s.current ? s.presets[s.current] : undefined;
          if (r) setRulesState(normalizeOrganizeRules({ ...DEFAULT_RULES, ...r, storableBags: cleanBags(r.storableBags ?? DEFAULT_RULES.storableBags) }));
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

  const targetOptions = [ALL, ...boxes.map((b) => b.name)];
  const targetBusy = target === ALL ? organizing.length > 0 : organizing.some((k) => k.name === target);

  const nameToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of known) for (const b of c.inv ?? []) for (const it of b.items) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
    return m;
  }, [known]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const charNames = useMemo(() => known.map((k) => k.name).sort((a, b) => a.localeCompare(b)), [known]);
  const [presetScope, setPresetScope] = useSticky<string>('org.presetScope', ALL_PLAYERS_LABEL);
  const scopeOptions = useMemo(() => [ALL_PLAYERS_LABEL, ...charNames], [charNames]);
  const scopeActive = scopeOptions.includes(presetScope) ? presetScope : ALL_PLAYERS_LABEL;
  const scopeIsAll = scopeActive === ALL_PLAYERS_LABEL;
  const scopeKey = scopeIsAll ? ALL_PLAYERS_KEY : scopeActive;

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
            <RowStacked label="" desc="Stores stackable items into storage by the rules above, then pulls your Keep All and Bring items back into inventory.">
              <div className="flex flex-col gap-2">
                <button onClick={() => void org.openPreview()} disabled={boxes.length === 0 || targetBusy || org.targetCount === 0} className="le-tap w-full px-3 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
                  {boxes.length === 0 ? 'No Characters Connected' : targetBusy ? 'Organizing…' : 'Organize'}
                </button>
                <div className="text-[11px] text-fg-4 px-0.5">Preview the exact moves first, then run. Uses every storage bag in your Mog House, or Satchel / Sack / Case anywhere else.</div>
              </div>
            </RowStacked>
          </Group>

          <Group title="Automation">
            <Row label="Auto-Organize Upon Entering Mog House">
              <Toggle on={settings.autoOrganizeOnMog} onChange={(v) => setSettings({ ...settings, autoOrganizeOnMog: v })} />
            </Row>
            <Collapse open={settings.autoOrganizeOnMog}>
              <Row label="Delay After Entering">
                <div className="flex items-center gap-2">
                  <Stepper value={settings.autoOrganizeDelaySec} min={1} max={120} onChange={(v) => setSettings({ ...settings, autoOrganizeDelaySec: v })} />
                  <span className="text-[11px] text-fg-4">sec</span>
                </div>
              </Row>
            </Collapse>
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

      {org.lastReport && !org.reportOpen && (
        <button onClick={org.showLastReport} className="le-tap w-full px-3 py-2 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">View Last Run Results</button>
      )}
      {organizing.length === 0 && !org.lastReport && (
        <Group title="Last Run Results">
          <div className="text-center text-[12px] text-fg-4 py-10">No runs yet.<br />Choose a target and hit Organize to consolidate.</div>
        </Group>
      )}
        </>
      )}

      {tab === 'settings' && (
      <>
      <Group title="Inventory Rules">
        <RowStacked label="Items To Keep In Inventory" desc="Add an item, then pick how much stays on you: gather all in, keep all, keep one stack, or keep a set amount. The rest is stored.">
          <InventoryRules rules={rules} setRules={setRules} nameToId={nameToId} assets={assetsAny} />
          {rules.alwaysBring.length > 0 && (
            <button onClick={retrieve} disabled={boxes.length === 0} className="mt-2 w-full px-3 py-2 text-[12px] font-semibold rounded-md border border-line bg-surface-raised text-fg-2 hover:bg-surface-hover disabled:opacity-40 transition-colors">
              {boxes.length === 0 ? 'No Characters Connected' : `Retrieve Keep-All Items${target === ALL ? '' : ` to ${target}`}`}
            </button>
          )}
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
        <Row label="Store All Items (Gear Included)" desc="Attempts to store all items (gear included) into storage.">
          <Toggle on={rules.strictInventory} onChange={(v) => set('strictInventory', v)} />
        </Row>
      </Group>
      </>
      )}

      {tab === 'presets' && (
      <>
      <Group>
        <Row label="Applies To"><div className="w-44"><Select value={scopeActive} onChange={setPresetScope} options={scopeOptions} full /></div></Row>
      </Group>
      <Group title="Storage Presets">
        <RowStacked label="Send Specific Items To Bags" desc="Route an individual item. This beats any tag rule (set in Tagging → Rules). Bags fill in priority order, overflowing to the next.">
          <StorageLayoutEditor storeKey={scopeKey} isAll={scopeIsAll} nameToId={nameToId} assets={assetsAny} />
        </RowStacked>
      </Group>
      <Group title="Route Equipment By Slot">
        <RowStacked label="Send A Whole Slot To Bags" desc="Route every equippable piece of a slot (i.e. all Head, all Rings) to a specific set of bags.">
          <SlotRoutingEditor storeKey={scopeKey} isAll={scopeIsAll} />
        </RowStacked>
      </Group>
      </>
      )}

      {org.nodes}
    </div>
  );
}
