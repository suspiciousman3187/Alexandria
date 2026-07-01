import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  useKnownCharacters, useAvailableIcons, useDropIconMap, inTauri, lotPool, passPool, lotAll, passAll,
  type PoolItem, type KnownChar, type PoolRules,
} from './bridge';
import { useItemNames, type ItemName } from './itemNames';
import { usePoolStore, setCharRules, emptyRules, usePassOnLot, setPassOnLot } from './poolRules';
import { useSticky, useStickyChar } from './sticky';
import { Group, CharacterSelect, Select, Row, Toggle, SearchInput } from './ui';
import { Popover } from './overlay';
import { Crossfade } from './overlay';
import { AnimatePresence, motion } from 'motion/react';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { useAnon } from './anonymize';

type PoolViewMode = 'pool' | 'lotlist' | 'passlist';

function useNow(intervalMs = 1000) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return Math.floor(Date.now() / 1000);
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const caretDown = (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80"><path d="m6 9 6 6 6-6" /></svg>);

function PoolRow({ item, now, assets, onMenu }: { item: PoolItem; now: number; assets?: string; onMenu: (item: PoolItem, anchor: DOMRect, kind: 'lot' | 'pass' | 'rules') => void }) {
  const anon = useAnon();
  const icons = useAvailableIcons();
  const hover = useItemHover({ id: item.id, n: item.n });
  const left = Math.max(0, item.ts + 300 - now);
  const color = left < 60 ? 'text-red-400' : left < 180 ? 'text-orange-400' : 'text-emerald-400';
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div {...hover} className="w-9 h-9 rounded bg-field grid place-items-center overflow-hidden shrink-0">
        <IconInner id={item.id} size={32} name={item.n} assets={assets} bmpHas={item.id > 0 && icons.has(item.id)} />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] text-fg-2 leading-tight truncate">{item.n}</div>
        <div className="text-[11px] text-fg-4">
          {item.lotter && item.lot > 0 ? <span>High: <span className="text-fg-3">{anon(item.lotter)}</span> ({item.lot})</span> : <span>No lots yet</span>}
        </div>
      </div>
      <div className={`ml-auto text-[13px] tabular-nums font-semibold shrink-0 ${color}`}>{fmt(left)}</div>
      <div className="flex items-center gap-1.5 shrink-0">
        {item.mylot != null ? (
          <span className="text-[11px] font-semibold text-accent px-2">Lotted {item.mylot}</span>
        ) : (
          <>
            <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'lot')} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Lot{caretDown}</button>
            <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'pass')} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-3 hover:text-fg transition-colors">Pass{caretDown}</button>
          </>
        )}
        <button
          onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'rules')}
          aria-label="Auto-lot / auto-pass rules"
          className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </div>
    </div>
  );
}

function PoolList({ items, now, assets, onMenu }: { items: PoolItem[]; now: number; assets?: string; onMenu: (item: PoolItem, anchor: DOMRect, kind: 'lot' | 'pass' | 'rules') => void }) {
  if (items.length === 0) {
    return <div className="text-[12px] text-fg-4 text-center py-12">The treasure pool is empty.</div>;
  }
  return (
    <div className="divide-y divide-line">
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((it) => (
          <motion.div
            key={it.i}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <PoolRow item={it} now={now} assets={assets} onMenu={onMenu} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function RuleIcon({ id, name, assets }: { id?: number; name: string; assets?: string }) {
  const [broken, setBroken] = useState(false);
  const icons = useAvailableIcons();
  const has = id != null && icons.has(id);
  const src = has && assets && inTauri ? convertFileSrc(`${assets}/icon_${id}.bmp`) : null;
  return (
    <div className="relative shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden">
      {src && !broken
        ? <img src={src} alt="" onError={() => setBroken(true)} className="w-full h-full object-contain" />
        : <span className="text-fg-4 text-[8px] font-bold">{(name[0] || '?').toUpperCase()}</span>}
    </div>
  );
}

function ItemCombo({ existing, onAdd, assets }: { existing: string[]; onAdd: (name: string) => void; assets?: string }) {
  const db = useItemNames();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const have = useMemo(() => new Set(existing.map((x) => x.toLowerCase())), [existing]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const pre: ItemName[] = [];
    const sub: ItemName[] = [];
    const seen = new Set<string>();
    for (const it of db) {
      const ln = it.n.toLowerCase();
      if (have.has(ln) || seen.has(ln) || !ln.includes(s)) continue;
      seen.add(ln);
      (ln.startsWith(s) ? pre : sub).push(it);
      if (pre.length >= 10) break;
    }
    return [...pre, ...sub].slice(0, 10);
  }, [db, q, have]);
  useEffect(() => { setHi(0); }, [q]);

  const sync = () => { if (inputRef.current) setRect(inputRef.current.getBoundingClientRect()); };
  const show = () => { sync(); setOpen(true); };
  const commit = (name: string) => {
    const n = name.trim();
    if (n && !have.has(n.toLowerCase())) onAdd(n);
    setQ(''); setOpen(false);
  };

  const W = rect?.width ?? 240;
  const left = rect?.left ?? 0;
  const top = (rect?.bottom ?? 0) + 4;

  return (
    <div className="mb-2.5">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); show(); }}
        onFocus={show}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); show(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); commit(matches[hi]?.n ?? q); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder="Search items to add…"
        className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
      />
      {createPortal(
        <Popover open={open && matches.length > 0} style={{ position: 'fixed', left, top, width: W, zIndex: 80 }} className="rounded-md border border-line bg-popover shadow-2xl max-h-64 overflow-y-auto overscroll-contain">
          {matches.map((it, i) => (
            <button
              key={it.id}
              onMouseDown={(e) => { e.preventDefault(); commit(it.n); }}
              onMouseEnter={() => setHi(i)}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left transition-colors ${i === hi ? 'bg-field' : 'hover:bg-field'}`}
            >
              <RuleIcon id={it.id} name={it.n} assets={assets} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{it.n}</span>
            </button>
          ))}
        </Popover>,
        document.body,
      )}
    </div>
  );
}

function RuleList({ items, onChange, resolveId, assets }: { items: string[]; onChange: (v: string[]) => void; resolveId: (n: string) => number | undefined; assets?: string }) {
  const [filter, setFilter] = useState('');
  const addItem = (n: string) => {
    if (n && !items.some((x) => x.toLowerCase() === n.toLowerCase())) onChange([...items, n]);
  };
  const removeItem = (name: string) => onChange(items.filter((x) => x !== name));
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((n) => n.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  return (
    <>
      <ItemCombo existing={items} onAdd={addItem} assets={assets} />
      {items.length > 3 && (
        <SearchInput
          value={filter}
          onChange={setFilter}
          wrap="mb-2.5"
          placeholder="Filter list…"
          className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
        />
      )}
      {items.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-5">Empty.</div>
      ) : shown.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-5">No items match.</div>
      ) : (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((name) => (
              <motion.div
                key={name}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-2 px-2.5 py-1"
              >
                <RuleIcon id={resolveId(name)} name={name} assets={assets} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{name}</span>
                <button onClick={() => removeItem(name)} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

export default function PoolView({ view = 'pool' }: { view?: PoolViewMode }) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const [name, setName] = useStickyChar();
  const poolStore = usePoolStore();
  const passOnLot = usePassOnLot();
  const iconMap = useDropIconMap();
  const now = useNow();
  const [menu, setMenu] = useState<{ item: PoolItem; rect: DOMRect; kind: 'lot' | 'pass' | 'rules' } | null>(null);
  const [allMenu, setAllMenu] = useState<{ rect: DOMRect; kind: 'lot' | 'pass' } | null>(null);

  const active: KnownChar | undefined = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  const parties = useMemo<{ key: string; members: KnownChar[] }[]>(() => {
    const m = new Map<string, KnownChar[]>();
    for (const c of online) {
      const key = c.party?.key && c.party.key !== '' ? c.party.key : c.name;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return [...m.entries()]
      .map(([key, members]) => ({ key, members: members.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.members[0].name.localeCompare(b.members[0].name));
  }, [online]);
  const [partyKey, setPartyKey] = useSticky('pool.party', '');
  const selParty = parties.find((p) => p.key === partyKey) ?? parties[0];
  useEffect(() => { if (selParty && selParty.key !== partyKey) setPartyKey(selParty.key); }, [selParty, partyKey]);
  const partyMembers = selParty?.members ?? [];
  const lead = partyMembers.slice().sort((a, b) => (b.pool?.length ?? 0) - (a.pool?.length ?? 0))[0];
  const renderParty = (key: string) => {
    const p = parties.find((x) => x.key === key);
    if (!p) return key;
    return (
      <span className="flex items-center gap-2 min-w-0 w-full">
        <svg viewBox="0 0 24 24" width="14" height="14" className="shrink-0 text-fg-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        <span className="truncate">{p.members.map((mm) => anon(mm.name)).join(', ')}</span>
        {p.members.length > 1 && <span className="ml-auto shrink-0 text-[10px] text-fg-4 tabular-nums">{p.members.length}</span>}
      </span>
    );
  };

  const editName = active?.name ?? '';
  const current: PoolRules = poolStore[editName] ?? emptyRules();
  const update = (r: PoolRules) => { if (editName) setCharRules(editName, r); };

  const addRuleFor = (charName: string, kind: 'lot' | 'pass', itemName: string) => {
    const r = poolStore[charName] ?? emptyRules();
    if (r[kind].some((x) => x.toLowerCase() === itemName.toLowerCase())) return;
    setCharRules(charName, { ...r, [kind]: [...r[kind], itemName] });
  };

  const nameToId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of known) {
      for (const b of c.inv ?? []) for (const it of b.items) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
      for (const it of c.pool ?? []) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
    }
    return m;
  }, [known]);
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const resolveId = (n: string) => iconMap[n] ?? nameToId.get(n.toLowerCase());

  const lotOverview = useMemo(
    () => Object.entries(poolStore).filter(([, r]) => r.lot.length > 0).sort((a, b) => a[0].localeCompare(b[0])),
    [poolStore],
  );

  const pool = (lead?.pool ?? []).slice().sort((a, b) => a.i - b.i);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">The treasure pool is live data. Load the Alexandria addon in-game to see and manage your pool here.</div>
        </div>
      </div>
    );
  }

  const poolMatch = (c: KnownChar, it: PoolItem) => (c.pool ?? []).find((p) => p.id === it.id && p.ts === it.ts);
  const eligible = (it: PoolItem) => partyMembers.filter((c) => poolMatch(c, it));
  const lotOn = (c: KnownChar, it: PoolItem) => { const m = poolMatch(c, it); if (m && c.conn != null) lotPool(c.conn, m.i); };
  const passOn = (c: KnownChar, it: PoolItem) => { const m = poolMatch(c, it); if (m && c.conn != null) passPool(c.conn, m.i); };
  const actAll = (it: PoolItem, kind: 'lot' | 'pass') => { for (const c of eligible(it)) { const m = poolMatch(c, it); if (m && c.conn != null) (kind === 'lot' ? lotPool : passPool)(c.conn, m.i); } };
  const allMembers = partyMembers.filter((c) => c.conn != null);
  const doAllOn = (c: KnownChar, kind: 'lot' | 'pass') => { if (c.conn != null) (kind === 'lot' ? lotAll : passAll)(c.conn); };
  const doAllEveryone = (kind: 'lot' | 'pass') => { for (const c of allMembers) doAllOn(c, kind); };

  const menuW = 224;
  const menuLeft = menu ? Math.max(8, Math.min(menu.rect.right - menuW, window.innerWidth - menuW - 8)) : 0;
  const menuTop = menu ? menu.rect.bottom + 4 : 0;
  const eligibleChars = menu ? eligible(menu.item) : [];
  const allMenuLeft = allMenu ? Math.max(8, Math.min(allMenu.rect.right - menuW, window.innerWidth - menuW - 8)) : 0;
  const allMenuTop = allMenu ? allMenu.rect.bottom + 4 : 0;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        {view === 'pool' ? (
          <div className="flex-1 min-w-0"><Select value={selParty?.key ?? ''} onChange={setPartyKey} options={parties.map((p) => p.key)} renderOption={renderParty} renderValue={renderParty} full /></div>
        ) : (
          <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <Crossfade id={view}>
        {view === 'pool' ? (
          <div className="rounded-xl bg-surface border border-line overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line">
              <span className="text-[11px] text-fg-4 tabular-nums">{pool.length} in pool</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={(e) => setAllMenu({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: 'lot' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Lot All{caretDown}</button>
                <button onClick={(e) => setAllMenu({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: 'pass' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Pass All{caretDown}</button>
              </div>
            </div>
            <PoolList key={selParty?.key} items={pool} now={now} assets={lead?.assets} onMenu={(item, rect, kind) => setMenu({ item, rect, kind })} />
          </div>
        ) : view === 'lotlist' ? (
          <div className="flex flex-col">
            <Group title={`Lot List · ${editName}`} right={<span className="text-[11px] text-fg-4 tabular-nums">{current.lot.length}</span>}>
              <div className="px-0.5 pb-1 text-[11px] text-fg-4">{editName} automatically lots these items from the treasure pool.</div>
            </Group>
            <div className="mb-5 rounded-xl bg-surface border border-line p-3">
              <RuleList items={current.lot} onChange={(v) => update({ ...current, lot: v })} resolveId={resolveId} assets={assetsAny} />
            </div>

            <Group title="Lot Overview" right={<span className="text-[11px] text-fg-4 tabular-nums">{lotOverview.length}</span>}>
              {lotOverview.length === 0 ? (
                <div className="text-center text-[12px] text-fg-4 py-6">No lot rules set on any character.</div>
              ) : (
                lotOverview.map(([char, r]) => (
                  <div key={char} className="flex items-start gap-3 px-3.5 py-2.5">
                    <button
                      onClick={() => setName(char)}
                      className={`shrink-0 w-24 text-left text-[12px] font-semibold truncate transition-colors ${char === editName ? 'text-accent' : 'text-fg-2 hover:text-accent'}`}
                    >
                      {anon(char)}
                    </button>
                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      {r.lot.map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded bg-field border border-line px-1.5 py-0.5 text-[11px] text-fg-2">
                          <RuleIcon id={resolveId(n)} name={n} assets={assetsAny} />
                          <span className="truncate max-w-[140px]">{n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </Group>
          </div>
        ) : (
          <div className="flex flex-col">
            <Group title="Auto-Pass (All Characters)">
              <Row label="Pass When Other Characters Lot">
                <Toggle on={passOnLot} onChange={setPassOnLot} />
              </Row>
            </Group>
            <Group title={`Pass List · ${editName}`} right={<span className="text-[11px] text-fg-4 tabular-nums">{current.pass.length}</span>}>
              <div className="px-0.5 pb-1 text-[11px] text-fg-4">{editName} automatically passes these items in the treasure pool.</div>
            </Group>
            <div className="rounded-xl bg-surface border border-line p-3">
              <RuleList items={current.pass} onChange={(v) => update({ ...current, pass: v })} resolveId={resolveId} assets={assetsAny} />
            </div>
          </div>
        )}
        </Crossfade>
      </div>

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[79]" onMouseDown={() => setMenu(null)} />
          <Popover open style={{ position: 'fixed', left: menuLeft, top: menuTop, width: menuW, zIndex: 80 }} className="rounded-lg border border-line bg-popover shadow-2xl p-1.5 flex flex-col gap-0.5">
            {menu.kind === 'rules' ? (
              <>
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4 truncate">{menu.item.n}</div>
                {eligibleChars.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No party member in this zone.</div>
                ) : (
                  <>
                    <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-4">Auto-Lot on</div>
                    {eligibleChars.map((c) => (
                      <button
                        key={`l-${c.name}`}
                        onMouseDown={(e) => { e.preventDefault(); addRuleFor(c.name, 'lot', menu.item.n); setMenu(null); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span className="truncate">{anon(c.name)}</span>
                      </button>
                    ))}
                    <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-4">Auto-Pass on</div>
                    {eligibleChars.map((c) => (
                      <button
                        key={`p-${c.name}`}
                        onMouseDown={(e) => { e.preventDefault(); addRuleFor(c.name, 'pass', menu.item.n); setMenu(null); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-fg-4" />
                        <span className="truncate">{anon(c.name)}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4 truncate">{menu.kind === 'lot' ? 'Lot on' : 'Pass on'} · {menu.item.n}</div>
                {eligibleChars.length > 1 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); actAll(menu.item, menu.kind === 'lot' ? 'lot' : 'pass'); setMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /><span>Everyone In Party ({eligibleChars.length})</span>
                  </button>
                )}
                {eligibleChars.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No party member in this zone can {menu.kind === 'lot' ? 'lot' : 'pass'} this.</div>
                ) : eligibleChars.map((c) => (
                  <button
                    key={c.name}
                    onMouseDown={(e) => { e.preventDefault(); (menu.kind === 'lot' ? lotOn : passOn)(c, menu.item); setMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="truncate">{anon(c.name)}</span>
                  </button>
                ))}
              </>
            )}
          </Popover>
        </>,
        document.body,
      )}

      {allMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[79]" onMouseDown={() => setAllMenu(null)} />
          <Popover open style={{ position: 'fixed', left: allMenuLeft, top: allMenuTop, width: menuW, zIndex: 80 }} className="rounded-lg border border-line bg-popover shadow-2xl p-1.5 flex flex-col gap-0.5">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4 truncate">{allMenu.kind === 'lot' ? 'Lot All on' : 'Pass All on'}</div>
            {allMembers.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No party member connected.</div>
            ) : (
              <>
                {allMembers.length > 1 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); doAllEveryone(allMenu.kind); setAllMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /><span>Everyone In Party ({allMembers.length})</span>
                  </button>
                )}
                {allMembers.map((c) => (
                  <button
                    key={c.name}
                    onMouseDown={(e) => { e.preventDefault(); doAllOn(c, allMenu.kind); setAllMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="truncate">{anon(c.name)}</span>
                  </button>
                ))}
              </>
            )}
          </Popover>
        </>,
        document.body,
      )}
    </div>
  );
}
