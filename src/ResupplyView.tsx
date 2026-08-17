import { useMemo, useState, type ReactNode } from 'react';
import { useKnownCharacters, useAvailableIcons, moveItem, NOMAD_BAGS, nomadReachable, type KnownChar } from './bridge';
import { useResupplyStore, useProfiles, setResupplyChar, setProfileItems, createProfile, renameProfile, deleteProfile, assignProfile, profileUsage, effectiveItems, emptyResupply, type ResupplyChar, type ResupplyItem } from './resupply';
import { useCurioCatalog, useCurioVersion, type CurioItem } from './curioCatalog';
import { itemNameMatches } from './itemNames';
import { useSettings } from './settings';
import { IconInner } from './atlasIcon';
import { Modal, Collapse } from './overlay';
import { Stepper, Toggle, SearchInput, Select, SectionTabs } from './ui';
import { useSticky } from './sticky';
import { OpGlyph } from './OpCard';
import { ALWAYS_BAGS, MOG_ONLY_BAGS } from './bagConstants';
import { useAnon } from './anonymize';

const fmt = (v: number) => v.toLocaleString();

const CATS: { opt: number; label: string }[] = [
  { opt: 1, label: 'Medicines' },
  { opt: 2, label: 'Ammunition' },
  { opt: 3, label: 'Ninja Tools' },
  { opt: 4, label: 'Food' },
  { opt: 5, label: 'Items/Materials' },
  { opt: 6, label: 'Keys' },
];
const CAT_OPTS = new Set(CATS.map((c) => c.opt));
const stackOf = (it?: CurioItem) => Math.max(1, it?.stack ?? 1);
const amtMax = (it?: CurioItem) => (it?.rare ? 1 : 999);

// What a character actually carries (must match the addon's RESUPPLY_CARRY_BAGS) vs the
// Mog-House-only bags a supply can be pulled into inventory from (Nomad Moogle covers the
// nomad-enabled ones when Experimental is on). Recycle/Temporary are never pulled.
const CARRY_BAGS = ALWAYS_BAGS;
function bagPullableNow(bagId: number, mog: boolean, nomadOk: boolean): boolean {
  if (bagId === 0) return false;
  if (CARRY_BAGS.has(bagId)) return true;
  if (MOG_ONLY_BAGS.has(bagId)) return mog || (NOMAD_BAGS.has(bagId) && nomadOk);
  return false;
}

// How many of an item a character is carrying, counted across every carried bag (inventory
// + satchel/sack/case + wardrobes) to match the addon's RESUPPLY_CARRY_BAGS. Supplies a
// character organizes into a carry bag are real stock, so they read as owned here just as
// Curio counts them, instead of looking missing because they left the main inventory.
function ownedOf(char: KnownChar, id: number): number {
  let n = 0;
  for (const bag of char.inv ?? []) {
    if (!CARRY_BAGS.has(bag.id)) continue;
    for (const it of bag.items) if (it.id === id) n += it.c;
  }
  return n;
}

// The bags an item is actually sitting in (any bag, incl. Recycle/storage), so the user
// can see where their copies are -- and why something in Recycle reads as "not owned".
function locationsOf(char: KnownChar, id: number): string[] {
  const locs: string[] = [];
  for (const bag of char.inv ?? []) {
    if (bag.items.some((it) => it.id === id)) locs.push(bag.b);
  }
  return locs;
}

function SmallIcon({ id, n, assets, iconSet }: { id?: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id ?? 0} size={24} name={n} assets={assets} bmpHas={id != null && id > 0 && iconSet.has(id)} />
    </div>
  );
}

function Flags({ it }: { it: CurioItem }) {
  if (!it.rare && !it.ex) return null;
  return (
    <span className="flex items-center gap-1 shrink-0">
      {it.rare && <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30">RA</span>}
      {it.ex && <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">EX</span>}
    </span>
  );
}

function PickerRow({ it, onAll, onAny, disabled, iconSet, assets, onAdd, onRemove }: {
  it: CurioItem; onAll: boolean; onAny: boolean; disabled: boolean; iconSet: Set<number>; assets?: string; onAdd: (qty: number) => void; onRemove: () => void;
}) {
  const stack = stackOf(it);
  const [amt, setAmt] = useState(stack > 1 ? stack : 1);
  const quick = 'le-tap shrink-0 w-14 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-2 enabled:hover:text-fg disabled:opacity-40 transition-colors';

  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <SmallIcon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-fg-2 truncate">{it.n}</span>
          <Flags it={it} />
        </div>
        <div className="text-[10px] text-fg-4 tabular-nums">{fmt(it.price)} gil{stack > 1 ? ` · stacks to ${stack}` : ''}{it.rare ? ' · max 1' : ''}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="w-4 shrink-0 text-emerald-400" title={onAll ? 'On the list' : undefined}>
          {onAll && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>}
        </span>
        <Stepper value={amt} min={1} max={amtMax(it)} numW="w-10" onChange={setAmt} />
        <button onClick={() => onAdd(amt)} disabled={disabled} className="le-tap shrink-0 w-12 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Add</button>
        {amtMax(it) > 1 ? <button onClick={() => onAdd(1)} disabled={disabled} className={quick}>Single</button> : <span className="w-14 shrink-0" />}
        {stack > 1 ? <button onClick={() => onAdd(stack)} disabled={disabled} className={quick}>Stack</button> : <span className="w-14 shrink-0" />}
        <button onClick={onRemove} disabled={!onAny} aria-label="Remove from list" className="le-tap shrink-0 grid place-items-center w-7 h-7 rounded-md text-fg-4 enabled:hover:text-rose-300 enabled:hover:bg-rose-500/10 disabled:opacity-25 transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
        </button>
      </div>
    </div>
  );
}

// Shared Curio catalog browser. Target-agnostic: callers decide what an Add/Remove does and
// whether a row already appears on the target (onAll/onAny). The character picker layers a
// multi-character "Add to" row on top via headerExtra; the profile editor uses it bare.
function CatalogPicker({ catalog, iconSet, assets, title, onAllOf, onAnyOf, onAdd, onRemove, headerExtra, disabled, disabledHint, onClose }: {
  catalog: CurioItem[]; iconSet: Set<number>; assets?: string; title: string;
  onAllOf: (item: string) => boolean; onAnyOf: (item: string) => boolean;
  onAdd: (it: CurioItem, min: number) => void; onRemove: (it: CurioItem) => void;
  headerExtra?: ReactNode; disabled?: boolean; disabledHint?: string; onClose: () => void;
}) {
  const [cat, setCat] = useState(CATS[0].opt);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = catalog.filter((it) => CAT_OPTS.has(it.opt) && (s ? itemNameMatches(it.id, it.n, s) : it.opt === cat));
    // The shop streams Potion last; it's the staple Medicine, so surface it first.
    if (!s) { const pi = list.findIndex((it) => it.id === 4112); if (pi > 0) list.unshift(list.splice(pi, 1)[0]); }
    return list;
  }, [catalog, cat, q]);

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,600px)] h-[82vh]">
      {(close) => (
        <div className="flex flex-col min-h-0 h-full">
          <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-line flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-bold text-fg flex-1 truncate">{title}</div>
              <button onClick={close} aria-label="Close" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
            </div>
            {headerExtra}
            <SearchInput
              value={q}
              onChange={setQ}
              wrap=""
              placeholder="Search all supplies…"
              className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
            {!q.trim() && (
              <div className="flex gap-1 [&>*]:flex-1">
                {CATS.map((c) => (
                  <button key={c.opt} onClick={() => setCat(c.opt)} className={`px-1 py-1 text-[10px] font-semibold rounded-md border whitespace-nowrap transition-colors ${cat === c.opt ? 'bg-accent text-on-accent border-transparent' : 'bg-surface text-fg-3 border-line hover:text-fg-2'}`}>{c.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line">
            {disabled && disabledHint && (
              <div className="px-4 py-2 text-center text-[11px] text-amber-300/90 bg-amber-500/5">{disabledHint}</div>
            )}
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-fg-4">No supplies match.</div>
            ) : (
              shown.map((it) => (
                <PickerRow key={it.id} it={it} onAll={onAllOf(it.n)} onAny={onAnyOf(it.n)} disabled={!!disabled} iconSet={iconSet} assets={assets} onAdd={(qty) => onAdd(it, qty)} onRemove={() => onRemove(it)} />
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Character "Add": pick which characters to add to, then browse the catalog.
function SupplyPicker({ catalog, chars, initialTargets, hasItem, iconSet, assets, onAdd, onRemove, onClose }: {
  catalog: CurioItem[]; chars: KnownChar[]; initialTargets: string[];
  hasItem: (charName: string, item: string) => boolean;
  iconSet: Set<number>; assets?: string;
  onAdd: (it: CurioItem, min: number, targets: string[]) => void; onRemove: (it: CurioItem, targets: string[]) => void; onClose: () => void;
}) {
  const anon = useAnon();
  const [targets, setTargets] = useState<Set<string>>(() => new Set(initialTargets));
  const toggleTarget = (n: string) => setTargets((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const targetList = useMemo(() => chars.map((c) => c.name).filter((n) => targets.has(n)), [chars, targets]);
  const header = (
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
  );
  return (
    <CatalogPicker
      catalog={catalog} iconSet={iconSet} assets={assets} title="Add Supplies"
      headerExtra={header}
      disabled={targetList.length === 0} disabledHint="Select at least one character above to add to."
      onAllOf={(name) => targetList.length > 0 && targetList.every((t) => hasItem(t, name))}
      onAnyOf={(name) => targetList.some((t) => hasItem(t, name))}
      onAdd={(it, qty) => onAdd(it, qty, targetList)}
      onRemove={(it) => onRemove(it, targetList)}
      onClose={onClose}
    />
  );
}

// Profile "Add": browse the catalog straight into one profile's list.
function ProfilePicker({ catalog, iconSet, assets, profile, items, onAdd, onRemove, onClose }: {
  catalog: CurioItem[]; iconSet: Set<number>; assets?: string; profile: string; items: ResupplyItem[];
  onAdd: (it: CurioItem, min: number) => void; onRemove: (it: CurioItem) => void; onClose: () => void;
}) {
  const has = (name: string) => items.some((i) => i.name.toLowerCase() === name.toLowerCase());
  return (
    <CatalogPicker catalog={catalog} iconSet={iconSet} assets={assets} title={`Profile · ${profile}`} onAllOf={has} onAnyOf={has} onAdd={onAdd} onRemove={onRemove} onClose={onClose} />
  );
}

function CurioPill({ near }: { near?: boolean }) {
  const state = near == null ? 'unknown' : near ? 'near' : 'far';
  const cls = state === 'near' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : state === 'far' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-field text-fg-4 border-line';
  const dot = state === 'near' ? 'bg-emerald-400' : state === 'far' ? 'bg-amber-400' : 'bg-fg-4';
  const label = state === 'near' ? 'Near Moogle' : state === 'far' ? 'Not In Range' : 'Locating…';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{label}
    </span>
  );
}

function CharCard({ char, byName, iconSet, assets, onAddClick, onManageProfiles }: { char: KnownChar; byName: Map<string, CurioItem>; iconSet: Set<number>; assets?: string; onAddClick: () => void; onManageProfiles: () => void }) {
  const anon = useAnon();
  const store = useResupplyStore();
  const profiles = useProfiles();
  const cfg: ResupplyChar = store[char.name] ?? emptyResupply();
  const update = (r: ResupplyChar) => setResupplyChar(char.name, r);
  const [open, setOpen] = useState(true);
  const byId = useMemo(() => { const m = new Map<number, CurioItem>(); for (const v of byName.values()) m.set(v.id, v); return m; }, [byName]);

  // On a profile, the card shows the profile's list read-only (edited in the Profiles tab);
  // Custom characters edit their own list right here.
  const onProfile = !!(cfg.profile && profiles[cfg.profile]);
  const items = onProfile ? profiles[cfg.profile as string] : cfg.items;
  const setMin = (item: string, min: number) => update({ ...cfg, items: cfg.items.map((x) => (x.name === item ? { ...x, min } : x)) });
  const remove = (item: string) => update({ ...cfg, items: cfg.items.filter((x) => x.name !== item) });

  const profileNames = useMemo(() => Object.keys(profiles).sort((a, b) => a.localeCompare(b)), [profiles]);
  const onPickProfile = (v: string) => {
    if (v === '__custom__') { assignProfile(char.name, null); return; }
    if (v === '__new__') {
      let n = 1; while (profiles[`Profile ${n}`]) n += 1;
      const name = `Profile ${n}`;
      createProfile(name, cfg.items); // seed the new profile from this character's current list
      assignProfile(char.name, name);
      return;
    }
    assignProfile(char.name, v);
  };

  const status = items.map((it) => {
    const c = byName.get(it.name.toLowerCase());
    const owned = c ? ownedOf(char, c.id) : 0;
    const target = c?.rare ? 1 : it.min;
    return { it, c, owned, target, met: c ? owned >= target : false, locs: c ? locationsOf(char, c.id) : [] };
  });
  const stocked = status.filter((s) => s.met).length;

  // Pull configured supplies sitting in other reachable bags into the main inventory,
  // topping each up to its target instead of over-filling from a large storage stash.
  const exp = useSettings().experimentalFeatures;
  const bringPlan = useMemo(() => {
    const nomadOk = nomadReachable(char, exp);
    const invCountOf = (id: number) => { let n = 0; for (const b of char.inv ?? []) if (b.id === 0) for (const x of b.items) if (x.id === id) n += x.c; return n; };
    const moves: { id: number; from: number; count: number; slot: number }[] = [];
    for (const ci of items) {
      const c = byName.get(ci.name.toLowerCase());
      if (!c) continue;
      let need = (c.rare ? 1 : ci.min) - invCountOf(c.id);
      if (need <= 0) continue;
      for (const bag of char.inv ?? []) {
        if (!bagPullableNow(bag.id, !!char.mog, nomadOk)) continue;
        for (const x of bag.items) {
          if (x.id !== c.id || need <= 0) continue;
          const take = Math.min(need, x.c);
          moves.push({ id: c.id, from: bag.id, count: take, slot: x.s });
          need -= take;
        }
      }
    }
    return moves;
  }, [items, char.inv, char.mog, exp, byName]);
  const bringToInv = () => { if (char.conn == null) return; for (const m of bringPlan) moveItem(char.conn, m.id, m.from, 0, m.count, m.slot); };

  const rp = char.resupply;
  const rpItem = rp && rp.item ? byId.get(rp.item) : undefined;
  const rpPct = rp && rp.target > 0 ? Math.min(100, Math.round((rp.have / rp.target) * 100)) : 0;

  return (
    <div className={`rounded-xl bg-surface border overflow-hidden ${rp?.active ? 'border-accent/40' : 'border-line'}`}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </span>
          <span className="text-[13px] font-semibold text-fg-2 truncate">{anon(char.name)}</span>
          {items.length > 0 && (
            <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${stocked === items.length ? 'text-emerald-400' : 'text-fg-4'}`}>{stocked}/{items.length} stocked</span>
          )}
        </button>
        {cfg.enabled && <CurioPill near={char.vendorNear?.curio} />}
        {bringPlan.length > 0 && (
          <button onClick={bringToInv} title="Bring Supplies To Inventory" className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors">Bring Supplies</button>
        )}
        <div className="w-[112px] shrink-0" title="Curio profile"><Select value={cfg.profile ?? '__custom__'} onChange={onPickProfile} options={['__custom__', ...profileNames, '__new__']} renderValue={(v) => (v === '__custom__' ? 'Custom' : v === '__new__' ? '＋ New' : v)} renderOption={(v) => (v === '__custom__' ? 'Custom' : v === '__new__' ? '＋ New Profile' : v)} full /></div>
        {!onProfile && <button onClick={onAddClick} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg transition-colors">Add</button>}
        <Toggle on={cfg.enabled} onChange={(v) => update({ ...cfg, enabled: v })} />
      </div>
      {onProfile && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 border-t border-line bg-field/40 text-[11px] text-fg-4">
          <span className="min-w-0 flex-1 truncate">On profile <span className="font-semibold text-accent">{cfg.profile}</span> · shared by {profileUsage(cfg.profile as string)}</span>
          <button onClick={onManageProfiles} className="shrink-0 font-semibold text-accent hover:underline transition-colors">Edit in Profiles →</button>
        </div>
      )}
      <Collapse open={!!rp?.active}>{rp?.active && (
        <div className="px-3.5 pb-2.5 -mt-0.5">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-accent font-semibold flex items-center gap-1.5 min-w-0">
              <OpGlyph state="active" className="w-3 h-3 shrink-0" />
              <span className="truncate">Restocking{rpItem ? ` · ${rpItem.n}` : '…'}</span>
            </span>
            {rp.target > 0 && <span className="tabular-nums text-fg-4 shrink-0">{fmt(rp.have)} / {fmt(rp.target)}</span>}
          </div>
          <div className="h-1 rounded-full bg-field overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-[width] duration-300 ease-out" style={{ width: `${rpPct}%` }} />
          </div>
        </div>
      )}</Collapse>
      <Collapse open={open}>
        <div className="border-t border-line">
          {items.length === 0 ? (
            <div className="px-3.5 py-3 text-[11px] text-fg-4">{onProfile ? 'This profile has no supplies yet. Add them in the Profiles tab.' : "No supplies yet. Use Add to pick from the Curio Moogle's stock."}</div>
          ) : (
            status.map(({ it, c, owned, met, locs }) => (
              <div key={it.name} className="flex items-center gap-2.5 px-3.5 py-2 border-b border-line last:border-b-0">
                <SmallIcon id={c?.id} n={it.name} assets={assets} iconSet={iconSet} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-fg-2 truncate">{it.name}</span>
                    {c && <Flags it={c} />}
                    {met && (
                      <span className="shrink-0 text-emerald-400" title="Already stocked">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] tabular-nums flex items-center gap-1.5 flex-wrap">
                    <span className="text-fg-4">{c ? `${fmt(c.price)} gil` : 'not in catalog'}</span>
                    {c && (
                      <span className={met ? 'text-emerald-400' : 'text-amber-400'}>
                        · {c.rare ? (met ? 'owned' : 'not owned') : `have ${fmt(owned)} / ${fmt(it.min)}`}
                      </span>
                    )}
                    {locs.length > 0 && <span className="text-fg-4">· in {locs.join(', ')}</span>}
                  </div>
                </div>
                {onProfile ? (
                  <span className="shrink-0 w-12 text-center text-[11px] font-semibold tabular-nums text-fg-3">×{fmt(it.min)}</span>
                ) : (
                  <>
                    <Stepper value={it.min} min={1} max={amtMax(c)} numW="w-12" onChange={(v) => setMin(it.name, v)} />
                    <button onClick={() => remove(it.name)} aria-label="Remove" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Collapse>
    </div>
  );
}

// One profile in the Profiles tab: rename in place, edit its list, see how many characters
// are on it, delete it. Every edit here propagates live to those characters.
function ProfileCard({ name, items, users, byName, iconSet, assets, onAdd, onSetMin, onRemove, onRename, onDelete }: {
  name: string; items: ResupplyItem[]; users: string[]; byName: Map<string, CurioItem>; iconSet: Set<number>; assets?: string;
  onAdd: () => void; onSetMin: (item: string, min: number) => void; onRemove: (item: string) => void; onRename: (next: string) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            onBlur={(e) => { onRename(e.target.value); setRenaming(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setRenaming(false); }}
            className="min-w-0 flex-1 bg-field border border-accent/50 rounded px-2 py-0.5 text-[13px] font-semibold text-fg-2 outline-none"
          />
        ) : (
          <button onClick={() => setRenaming(true)} className="min-w-0 flex-1 text-left text-[13px] font-semibold text-fg-2 truncate hover:text-accent transition-colors" title="Rename profile">{name}</button>
        )}
        <span className="shrink-0 text-[11px] text-fg-4 tabular-nums">{items.length} item{items.length === 1 ? '' : 's'}</span>
        <span className={`shrink-0 text-[10px] tabular-nums ${users.length ? 'text-emerald-400' : 'text-fg-4'}`} title={users.length ? users.join(', ') : 'No characters assigned'}>{users.length} assigned</span>
        <button onClick={onAdd} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg transition-colors">Add</button>
        <button onClick={onDelete} title="Delete profile" className="le-tap shrink-0 grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-rose-300 hover:bg-rose-500/10 transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
        </button>
      </div>
      <Collapse open={open}>
        <div className="border-t border-line">
          {items.length === 0 ? (
            <div className="px-3.5 py-3 text-[11px] text-fg-4">No supplies yet. Use Add to pick from the Curio Moogle's stock.</div>
          ) : (
            items.map((it) => {
              const c = byName.get(it.name.toLowerCase());
              return (
                <div key={it.name} className="flex items-center gap-2.5 px-3.5 py-2 border-b border-line last:border-b-0">
                  <SmallIcon id={c?.id} n={it.name} assets={assets} iconSet={iconSet} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-fg-2 truncate">{it.name}</span>
                      {c && <Flags it={c} />}
                    </div>
                    <div className="text-[10px] tabular-nums text-fg-4">{c ? `${fmt(c.price)} gil` : 'not in catalog'}{c?.rare ? ' · max 1' : ''}</div>
                  </div>
                  <Stepper value={it.min} min={1} max={amtMax(c)} numW="w-12" onChange={(v) => onSetMin(it.name, v)} />
                  <button onClick={() => onRemove(it.name)} aria-label="Remove" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                </div>
              );
            })
          )}
        </div>
      </Collapse>
    </div>
  );
}

function ProfilesPanel({ catalog, byName, iconSet, assets }: { catalog: CurioItem[]; byName: Map<string, CurioItem>; iconSet: Set<number>; assets?: string }) {
  const anon = useAnon();
  const profiles = useProfiles();
  const store = useResupplyStore();
  const names = useMemo(() => Object.keys(profiles).sort((a, b) => a.localeCompare(b)), [profiles]);
  const [newName, setNewName] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const usersOf = (name: string) => Object.keys(store).filter((k) => store[k].profile === name).map(anon);
  const create = () => { const n = newName.trim(); if (!n) return; createProfile(n); setNewName(''); };
  const addTo = (name: string) => (it: CurioItem, min: number) => {
    const list = profiles[name] ?? [];
    const exists = list.some((i) => i.name.toLowerCase() === it.n.toLowerCase());
    setProfileItems(name, exists ? list.map((i) => (i.name.toLowerCase() === it.n.toLowerCase() ? { ...i, min } : i)) : [...list, { name: it.n, min }]);
  };
  const removeItem = (name: string) => (it: CurioItem) => setProfileItems(name, (profiles[name] ?? []).filter((i) => i.name.toLowerCase() !== it.n.toLowerCase()));

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex items-center gap-2 max-w-2xl w-full mx-auto">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder="New profile name…"
          className="flex-1 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
        />
        <button onClick={create} disabled={!newName.trim()} className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Create Profile</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 max-w-2xl w-full mx-auto flex flex-col gap-3">
          {names.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface text-center text-[12px] text-fg-4 py-10 px-5 leading-relaxed">No profiles yet. Name one above and Create it, fill it with supplies, then assign characters to it from the <span className="text-fg-2 font-semibold">Curio</span> tab.</div>
          ) : (
            names.map((name) => (
              <ProfileCard
                key={name} name={name} items={profiles[name] ?? []} users={usersOf(name)}
                byName={byName} iconSet={iconSet} assets={assets}
                onAdd={() => setPickerFor(name)}
                onSetMin={(item, min) => setProfileItems(name, (profiles[name] ?? []).map((i) => (i.name === item ? { ...i, min } : i)))}
                onRemove={(item) => setProfileItems(name, (profiles[name] ?? []).filter((i) => i.name !== item))}
                onRename={(next) => renameProfile(name, next)}
                onDelete={() => deleteProfile(name)}
              />
            ))
          )}
        </div>
      </div>
      {pickerFor && (
        <ProfilePicker catalog={catalog} iconSet={iconSet} assets={assets} profile={pickerFor} items={profiles[pickerFor] ?? []} onAdd={addTo(pickerFor)} onRemove={removeItem(pickerFor)} onClose={() => setPickerFor(null)} />
      )}
    </div>
  );
}

export default function ResupplyView() {
  const known = useKnownCharacters();
  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const catalog = useCurioCatalog(online[0]?.server);
  useCurioVersion();
  const store = useResupplyStore();
  const profiles = useProfiles();
  const iconSet = useAvailableIcons();
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const byName = useMemo(() => new Map(catalog.map((c) => [c.n.toLowerCase(), c])), [catalog]);
  const [pickerTargets, setPickerTargets] = useState<string[] | null>(null);
  const [tab, setTab] = useSticky<'curio' | 'profiles'>('curio.tab', 'curio');
  const [noteSeen, setNoteSeen] = useSticky<boolean>('curio.shopnote.seen', false);

  const hasItem = (charName: string, item: string) => effectiveItems(charName).some((i) => i.name.toLowerCase() === item.toLowerCase());
  // An edit lands on the character's effective destination: its bound profile (shared, so it
  // touches every character on that profile just once) or its own custom list.
  const editItems = (name: string, fn: (items: ResupplyItem[]) => ResupplyItem[]) => {
    const cfg = store[name] ?? emptyResupply();
    const prof = cfg.profile && profiles[cfg.profile] ? cfg.profile : null;
    if (prof) setProfileItems(prof, fn(profiles[prof]));
    else setResupplyChar(name, { ...cfg, items: fn(cfg.items) });
  };
  const forTargets = (targets: string[], fn: (items: ResupplyItem[]) => ResupplyItem[]) => {
    const doneProfiles = new Set<string>();
    for (const name of targets) {
      const p = store[name]?.profile;
      const prof = p && profiles[p] ? p : null;
      if (prof) { if (doneProfiles.has(prof)) continue; doneProfiles.add(prof); }
      editItems(name, fn);
    }
  };
  const addTo = (it: CurioItem, min: number, targets: string[]) => forTargets(targets, (items) => {
    const exists = items.some((i) => i.name.toLowerCase() === it.n.toLowerCase());
    return exists ? items.map((i) => (i.name.toLowerCase() === it.n.toLowerCase() ? { ...i, min } : i)) : [...items, { name: it.n, min }];
  });
  const removeFrom = (it: CurioItem, targets: string[]) => forTargets(targets, (items) => items.filter((i) => i.name.toLowerCase() !== it.n.toLowerCase()));
  const setAllEnabled = (on: boolean) => {
    for (const c of online) {
      const cfg = store[c.name] ?? emptyResupply();
      setResupplyChar(c.name, { ...cfg, enabled: on });
    }
  };

  const profileCount = Object.keys(profiles).length;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
        <SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'curio', label: 'Curio' }, { id: 'profiles', label: 'Profiles' }]} />
      </div>

      {tab === 'curio' && (
        <Collapse open={!noteSeen}>
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            <span className="flex-1 min-w-0"><span className="font-semibold text-amber-200">Note:</span> The Curio Restock feature only works with fully unlocked Curio Shops!</span>
            <button onClick={() => setNoteSeen(true)} className="le-tap shrink-0 grid place-items-center w-5 h-5 rounded text-amber-300/70 hover:text-amber-200 hover:bg-amber-500/10 transition-colors" aria-label="Dismiss note"><svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          </div>
        </Collapse>
      )}

      {tab === 'profiles' ? (
        <ProfilesPanel catalog={catalog} byName={byName} iconSet={iconSet} assets={assetsAny} />
      ) : online.length === 0 ? (
        <div className="flex-1 grid place-items-center">
          <div className="text-center max-w-sm px-6">
            <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
            <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Curio tops up the supplies you list when a character nears the Curio Vendor Moogle.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex items-center gap-2 max-w-2xl w-full mx-auto">
            <button onClick={() => setPickerTargets(online.map((c) => c.name))} className="le-tap flex-1 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Add Supplies To All Characters</button>
            {profileCount > 0 && (
              <div className="w-[124px] shrink-0" title="Put every character on one profile at once">
                <Select value="" onChange={(v) => { for (const c of online) assignProfile(c.name, v === '__custom__' ? null : v); }} options={['__custom__', ...Object.keys(profiles).sort((a, b) => a.localeCompare(b))]} renderValue={() => 'Set All To…'} renderOption={(v) => (v === '__custom__' ? 'Custom' : v)} full />
              </div>
            )}
            <button onClick={() => setAllEnabled(true)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Enable All</button>
            <button onClick={() => setAllEnabled(false)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Disable All</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3 max-w-2xl w-full mx-auto flex flex-col gap-3">
              {online.map((c) => <CharCard key={c.name} char={c} byName={byName} iconSet={iconSet} assets={assetsAny} onAddClick={() => setPickerTargets([c.name])} onManageProfiles={() => setTab('profiles')} />)}
            </div>
          </div>
        </>
      )}

      {pickerTargets && (
        <SupplyPicker catalog={catalog} chars={online} initialTargets={pickerTargets} hasItem={hasItem} iconSet={iconSet} assets={assetsAny} onAdd={addTo} onRemove={removeFrom} onClose={() => setPickerTargets(null)} />
      )}
    </div>
  );
}
