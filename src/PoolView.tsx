import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  useKnownCharacters, useAvailableIcons, useDropIconMap, inTauri, lotPool, passPool, lotAll, passAll, useAhCatalog,
  type PoolItem, type KnownChar, type PoolRules,
} from './bridge';
import { useItemNames, itemStack, itemNameMatches, type ItemName } from './itemNames';
import { useItemValue } from './priceStore';
import { useSettings } from './settings';
import { openPoolWindow, isPoolOverlay } from './overlayWindow';
import { openAhDetail } from './ahNav';
import { useDrop, setDrop } from './drop';
import { usePoolStore, setCharRules, addRuleToChars, emptyRules, usePassOnLot, setPassOnLot, useAutoLotEnabled, setAutoLotEnabled, useAutoLotOff, setAutoLotChar } from './poolRules';
import { usePoolPriceMode, setPoolPriceMode, usePoolPriceDefault, setPoolPriceDefault } from './poolPriceMode';
import { useAlertNames, setAlertNames, useAlertOn, setAlertOn, useAlertVolume, setAlertVolume, testAlertTone, toggleAlert, hasAlert, useAlertActiveNames, dismissAlerts } from './poolAlerts';
import { useSticky, useStickyChar } from './sticky';
import { logicalRect, logicalViewport } from './uiZoom';
import { Group, CharacterSelect, Select, Row, Toggle, SearchInput, Segmented } from './ui';
import { Popover } from './overlay';
import { Crossfade } from './overlay';
import { AnimatePresence, motion } from 'motion/react';
import TreasuryImportModal from './TreasuryImportModal';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { useAnon } from './anonymize';

type PoolViewMode = 'pool' | 'lotlist' | 'passlist' | 'pricelist' | 'alertlist';

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
const stackMark = (<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0"><rect x="3" y="9" width="12" height="12" rx="1.5" /><path d="M9 9V4.5A1.5 1.5 0 0 1 10.5 3h9A1.5 1.5 0 0 1 21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H15" /></svg>);

function PoolRow({ item, now, assets, world, compact, dense, sellable, onMenu }: { item: PoolItem; now: number; assets?: string; world?: string; compact?: boolean; dense?: boolean; sellable: boolean; onMenu: (item: PoolItem, anchor: DOMRect, kind: 'lot' | 'pass' | 'rules') => void }) {
  const anon = useAnon();
  const icons = useAvailableIcons();
  const hover = useItemHover({ id: item.id, n: item.n });
  const priceMode = usePoolPriceMode();
  const priceDefault = usePoolPriceDefault();
  const stack = sellable && itemStack(item.id) > 1 && (priceMode[item.id] ?? priceDefault) === 'stack';
  const val = useItemValue(world, item.id, stack, sellable);
  const median = val?.median;
  const listed = val?.listedTotal;
  const left = Math.max(0, item.ts + 300 - now);
  const color = left < 60 ? 'text-red-400' : left < 180 ? 'text-orange-400' : 'text-emerald-400';
  if (dense) {
    return (
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <div {...hover} className="w-[18px] h-[18px] rounded bg-field grid place-items-center overflow-hidden shrink-0">
          <IconInner id={item.id} size={18} name={item.n} assets={assets} bmpHas={item.id > 0 && icons.has(item.id)} />
        </div>
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{item.n}</span>
        <span className={`text-[10px] font-bold tabular-nums ${color}`}>{fmt(left)}</span>
        {median != null && median > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums text-amber-300">{stack && <span className="text-fg-4" title="Stack price">{stackMark}</span>}{median.toLocaleString()}<span className="text-fg-4">g</span></span>}
        {listed != null && listed > 0 && <span title={`${listed} listed`} className={`text-[10px] font-bold tabular-nums ${listed <= 3 ? 'text-amber-300' : 'text-emerald-300'}`}>{listed}</span>}
        {item.mylot != null ? (
          <span title={`Lotted ${item.mylot}`} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-accent tabular-nums shrink-0">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>{item.mylot}
          </span>
        ) : (
          <>
            <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'lot')} title="Lot" aria-label="Lot" className="grid place-items-center w-5 h-5 rounded bg-accent text-on-accent hover:bg-accent-hover transition-colors shrink-0">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
            </button>
            <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'pass')} title="Pass" aria-label="Pass" className="grid place-items-center w-5 h-5 rounded bg-surface-raised border border-line text-fg-3 hover:text-fg transition-colors shrink-0">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </>
        )}
        <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'rules')} title="More" aria-label="More actions" className="grid place-items-center w-4 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors shrink-0">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </div>
    );
  }
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div {...hover} className="w-7 h-7 rounded bg-field grid place-items-center overflow-hidden shrink-0">
          <IconInner id={item.id} size={26} name={item.n} assets={assets} bmpHas={item.id > 0 && icons.has(item.id)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-fg-2 leading-tight truncate">{item.n}</div>
          <div className="flex items-center gap-1.5 leading-tight mt-0.5">
            <span className={`text-[10px] font-bold tabular-nums ${color}`}>{fmt(left)}</span>
            {median != null && median > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums text-amber-300">{stack && <span className="text-fg-4" title="Stack price">{stackMark}</span>}{median.toLocaleString()}<span className="text-fg-4">g</span></span>}
            {listed != null && listed > 0 && <span className={`text-[10px] font-bold tabular-nums ${listed <= 3 ? 'text-amber-300' : 'text-emerald-300'}`}>{listed} listed</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {item.mylot != null ? (
            <span className="text-[10px] font-semibold text-accent px-1">Lotted {item.mylot}</span>
          ) : (
            <>
              <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'lot')} className="px-2 py-1 text-[11px] font-semibold rounded bg-accent text-on-accent hover:bg-accent-hover transition-colors">Lot</button>
              <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'pass')} className="px-2 py-1 text-[11px] font-semibold rounded bg-surface-raised border border-line text-fg-3 hover:text-fg transition-colors">Pass</button>
            </>
          )}
          <button onClick={(e) => onMenu(item, (e.currentTarget as HTMLElement).getBoundingClientRect(), 'rules')} aria-label="More actions" className="grid place-items-center w-5 h-6 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>
        </div>
      </div>
    );
  }
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
      <div className="ml-auto flex items-center gap-2.5 shrink-0">
        {((median != null && median > 0) || (listed != null && listed > 0)) && (
          <span className="flex flex-col items-end leading-tight">
            {median != null && median > 0 && <span className="inline-flex items-center gap-0.5 text-[12px] font-bold text-amber-300 tabular-nums">{stack && <span className="text-fg-4" title="Stack price">{stackMark}</span>}{median.toLocaleString()}<span className="text-[9px] text-fg-4 ml-0.5">G</span></span>}
            {listed != null && listed > 0 && <span className={`text-[10px] font-bold tabular-nums ${listed <= 3 ? 'text-amber-300' : 'text-emerald-300'}`}>{listed} listed</span>}
          </span>
        )}
        <span className={`text-[13px] tabular-nums font-semibold ${color}`}>{fmt(left)}</span>
      </div>
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
          aria-label="More actions"
          className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </div>
    </div>
  );
}

function PoolList({ items, now, assets, world, compact, dense, sellableIds, onMenu }: { items: PoolItem[]; now: number; assets?: string; world?: string; compact?: boolean; dense?: boolean; sellableIds: Set<number>; onMenu: (item: PoolItem, anchor: DOMRect, kind: 'lot' | 'pass' | 'rules') => void }) {
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
            <PoolRow item={it} now={now} assets={assets} world={world} compact={compact} dense={dense} sellable={sellableIds.size === 0 || sellableIds.has(it.id)} onMenu={onMenu} />
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
      if (have.has(ln) || seen.has(ln) || !itemNameMatches(it.id, it.n, s)) continue;
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

  // Position in the popover's own (zoom-adjusted) coordinate space so a uiScale > 1 never offsets it; see uiZoom.ts.
  const lr = rect ? logicalRect(rect) : null;
  const W = lr?.width ?? 240;
  const left = lr?.left ?? 0;
  const top = (lr?.bottom ?? 0) + 4;

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

function RuleList({ items, onChange, resolveId, assets, fanOut, qty, onQty }: { items: string[]; onChange: (v: string[]) => void; resolveId: (n: string) => number | undefined; assets?: string; fanOut?: { onlineCount: number; allCount: number; add: (itemName: string, scope: 'online' | 'all') => void }; qty?: Record<string, number>; onQty?: (name: string, n: number | undefined) => void }) {
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'this' | 'online' | 'all'>('this');
  const addItem = (n: string) => {
    if (!n) return;
    if (scope !== 'this' && fanOut) fanOut.add(n, scope);
    else if (!items.some((x) => x.toLowerCase() === n.toLowerCase())) onChange([...items, n]);
  };
  const removeItem = (name: string) => onChange(items.filter((x) => x !== name));
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((n) => n.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  return (
    <>
      {fanOut ? (
        <div className="flex items-start gap-2">
          <div className="shrink-0 w-40"><Select value={scope} onChange={(v) => setScope(v as 'this' | 'online' | 'all')} options={['this', 'online', 'all']} renderOption={(v) => (v === 'this' ? 'This Character' : v === 'online' ? `All Online · ${fanOut.onlineCount}` : `All Characters · ${fanOut.allCount}`)} full /></div>
          <div className="flex-1 min-w-0"><ItemCombo existing={scope === 'this' ? items : []} onAdd={addItem} assets={assets} /></div>
        </div>
      ) : (
        <ItemCombo existing={items} onAdd={addItem} assets={assets} />
      )}
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
                {onQty && (
                  <label className="shrink-0 flex items-center gap-1 text-[10px] text-fg-4" title="Auto-lot until this character holds this many (blank = every copy)">
                    <span>keep</span>
                    <input
                      type="number" min={1} inputMode="numeric"
                      value={qty?.[name] ?? ''}
                      onChange={(e) => { const v = e.target.value.trim(); const n = Math.floor(Number(v)); onQty(name, v === '' || !Number.isFinite(n) || n <= 0 ? undefined : n); }}
                      placeholder="all"
                      className="w-12 bg-field border border-line rounded px-1.5 py-0.5 text-[11px] text-fg-2 text-right tabular-nums outline-none focus:border-accent/50 placeholder-fg-4/60"
                    />
                  </label>
                )}
                <button onClick={() => removeItem(name)} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

export default function PoolView({ view = 'pool', compact = false, dense = false, dragHeader = false, headerRight }: { view?: PoolViewMode; compact?: boolean; dense?: boolean; dragHeader?: boolean; headerRight?: ReactNode }) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const allCharNames = useMemo(() => known.map((k) => k.name).filter(Boolean), [known]);
  const [name, setName] = useStickyChar();
  const poolStore = usePoolStore();
  const passOnLot = usePassOnLot();
  const autoLotEnabled = useAutoLotEnabled();
  const autoLotOff = useAutoLotOff();
  const alertNames = useAlertNames();
  const alertOn = useAlertOn();
  const alertVol = useAlertVolume();
  const alertActive = useAlertActiveNames();
  const iconMap = useDropIconMap();
  const now = useNow();
  const [menu, setMenu] = useState<{ item: PoolItem; rect: DOMRect; kind: 'lot' | 'pass' | 'rules' } | null>(null);
  const [importing, setImporting] = useState(false);
  const [allMenu, setAllMenu] = useState<{ rect: DOMRect; kind: 'lot' | 'pass' } | null>(null);

  const active: KnownChar | undefined = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);
  const settings = useSettings();
  const world = settings.ahServer || active?.server;
  const drop = useDrop();
  const priceMode = usePoolPriceMode();
  const priceDefault = usePoolPriceDefault();
  const ahCatalog = useAhCatalog();
  const sellableIds = useMemo(() => new Set(ahCatalog.items.map((i) => i.id)), [ahCatalog.items]);

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

  const itemDb = useItemNames();
  const idToItemName = useMemo(() => { const m = new Map<number, string>(); for (const it of itemDb) if (!m.has(it.id)) m.set(it.id, it.n); return m; }, [itemDb]);
  const nameToItemId = useMemo(() => { const m = new Map<string, number>(); for (const it of itemDb) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); } return m; }, [itemDb]);
  const priceEntries = useMemo(() => Object.entries(priceMode).map(([idStr, mode]) => ({ id: Number(idStr), mode, name: idToItemName.get(Number(idStr)) ?? `#${idStr}` })).sort((a, b) => a.name.localeCompare(b.name)), [priceMode, idToItemName]);
  const priceNames = useMemo(() => priceEntries.map((e) => e.name), [priceEntries]);

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
  const itemFlagOf = (id: number) => { for (const k of known) for (const b of k.inv ?? []) for (const it of b.items) if (it.id === id && it.f != null) return it.f; return 0; };
  const heldCountOf = (c: KnownChar, id: number) => { let n = 0; for (const b of c.inv ?? []) for (const it of b.items) if (it.id === id) n += it.c; return n; };
  const rareBlocked = (c: KnownChar, it: PoolItem) => (itemFlagOf(it.id) & 0x01) !== 0 && heldCountOf(c, it.id) >= 1;
  const lotOn = (c: KnownChar, it: PoolItem) => { if (rareBlocked(c, it)) return; const m = poolMatch(c, it); if (m && c.conn != null) lotPool(c.conn, m.i); };
  const passOn = (c: KnownChar, it: PoolItem) => { const m = poolMatch(c, it); if (m && c.conn != null) passPool(c.conn, m.i); };
  const actAll = (it: PoolItem, kind: 'lot' | 'pass') => { for (const c of eligible(it)) { if (kind === 'lot' && rareBlocked(c, it)) continue; const m = poolMatch(c, it); if (m && c.conn != null) (kind === 'lot' ? lotPool : passPool)(c.conn, m.i); } };
  const allMembers = partyMembers.filter((c) => c.conn != null);
  const doAllOn = (c: KnownChar, kind: 'lot' | 'pass') => { if (c.conn != null) (kind === 'lot' ? lotAll : passAll)(c.conn); };
  const doAllEveryone = (kind: 'lot' | 'pass') => { for (const c of allMembers) doAllOn(c, kind); };

  const menuW = 224;
  // Position menus in their own (zoom-adjusted) coordinate space so a uiScale > 1 never throws them off-screen;
  // see uiZoom.ts. No-op at 100% and in the un-zoomed pop-out window.
  const vp = logicalViewport();
  const mR = menu ? logicalRect(menu.rect) : null;
  const menuLeft = mR ? Math.max(8, Math.min(mR.right - menuW, vp.w - menuW - 8)) : 0;
  const menuSpaceBelow = mR ? vp.h - mR.bottom - 8 : 0;
  const menuSpaceAbove = mR ? mR.top - 8 : 0;
  const menuAbove = mR ? menuSpaceBelow < 200 && menuSpaceAbove > menuSpaceBelow : false;
  const menuMaxH = menuAbove ? menuSpaceAbove : menuSpaceBelow;
  const menuStyle: CSSProperties = mR
    ? (menuAbove
        ? { position: 'fixed', left: menuLeft, bottom: vp.h - mR.top + 4, width: menuW, maxHeight: menuMaxH, zIndex: 80 }
        : { position: 'fixed', left: menuLeft, top: mR.bottom + 4, width: menuW, maxHeight: menuMaxH, zIndex: 80 })
    : {};
  const eligibleChars = menu ? eligible(menu.item) : [];
  const menuLot = menu?.kind === 'lot';
  const heldOf = (c: KnownChar, id: number) => { let n = 0; for (const b of c.inv ?? []) for (const it of b.items) if (it.id === id) n += it.c; return n; };
  const lotableChars = menuLot && menu ? eligibleChars.filter((c) => !rareBlocked(c, menu.item)) : eligibleChars;
  const aR = allMenu ? logicalRect(allMenu.rect) : null;
  const allMenuLeft = aR ? Math.max(8, Math.min(aR.right - menuW, vp.w - menuW - 8)) : 0;
  const allMenuTop = aR ? aR.bottom + 4 : 0;

  return (
    <div className="h-full flex flex-col">
      {view !== 'pricelist' && (
      <div data-tauri-drag-region={dragHeader ? '' : undefined} className={`shrink-0 border-b border-line flex flex-col gap-2.5 ${compact ? 'px-2 py-1.5' : 'px-4 pt-4 pb-3'}`}>
        {view === 'pool' ? (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0"><Select value={selParty?.key ?? ''} onChange={setPartyKey} options={parties.map((p) => p.key)} renderOption={renderParty} renderValue={renderParty} full /></div>
            {!isPoolOverlay() && !headerRight && (
              <button onClick={() => void openPoolWindow()} title="Pop Out To A Floating Window" aria-label="Pop out pool" className="shrink-0 grid place-items-center w-9 h-9 rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
              </button>
            )}
            {headerRight}
          </div>
        ) : (
          <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
        )}
      </div>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto ${dense ? 'p-1' : compact ? 'p-2' : 'p-4'}`}>
        {alertActive.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300 animate-pulse" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            <span className="text-[11px] text-amber-100 flex-1 min-w-0 truncate">In pool: {alertActive.join(', ')}</span>
            <button onClick={dismissAlerts} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 transition-colors">Silence</button>
          </div>
        )}
        <Crossfade id={view}>
        {view === 'pool' ? (
          <div className={compact ? 'overflow-hidden' : 'rounded-xl bg-surface border border-line overflow-hidden'}>
            {(!compact || pool.length > 0) && (
              <div className={`flex items-center gap-2 border-b border-line ${compact ? 'px-2 py-1.5' : 'px-3.5 py-2.5'}`}>
                <span className="text-[11px] text-fg-4 tabular-nums">{pool.length} in pool</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={(e) => setAllMenu({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: 'lot' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Lot All{caretDown}</button>
                  <button onClick={(e) => setAllMenu({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), kind: 'pass' })} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Pass All{caretDown}</button>
                </div>
              </div>
            )}
            <PoolList key={selParty?.key} items={pool} now={now} assets={lead?.assets} world={world} compact={compact} dense={dense} sellableIds={sellableIds} onMenu={(item, rect, kind) => setMenu({ item, rect, kind })} />
          </div>
        ) : view === 'lotlist' ? (
          <div className="flex flex-col">
            <Group title="Auto-Lot">
              <Row label="Toggle Auto-Lotting Globally">
                <Toggle on={autoLotEnabled} onChange={setAutoLotEnabled} />
              </Row>
            </Group>
            <Group title={`Lot List · ${editName}`} right={
              <div className="flex items-center gap-2">
                <button onClick={() => setImporting(true)} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Import From Treasury</button>
                <span className="text-[11px] text-fg-4 tabular-nums">{current.lot.length}</span>
              </div>
            }>
              <div className="px-0.5 pb-1 text-[11px] text-fg-4">{editName} automatically lots these items from the treasure pool. Set <span className="text-fg-3 font-medium">keep</span> to stop once this character already holds that many.</div>
            </Group>
            <div className="mb-5 rounded-xl bg-surface border border-line p-3">
              <RuleList
                items={current.lot}
                onChange={(v) => { const keep = new Set(v.map((n) => n.toLowerCase())); const q: Record<string, number> = {}; for (const [k, val] of Object.entries(current.lotQty ?? {})) if (keep.has(k.toLowerCase())) q[k] = val; update({ ...current, lot: v, lotQty: q }); }}
                qty={current.lotQty}
                onQty={(name, n) => { const q = { ...(current.lotQty ?? {}) }; if (n == null) delete q[name]; else q[name] = n; update({ ...current, lotQty: q }); }}
                resolveId={resolveId}
                assets={assetsAny}
                fanOut={{ onlineCount: online.length, allCount: allCharNames.length, add: (n, scope) => addRuleToChars(scope === 'online' ? online.map((c) => c.name) : allCharNames, 'lot', n) }}
              />
            </div>

            <Group title="Lot Overview" right={<span className="text-[11px] text-fg-4 tabular-nums">{lotOverview.length}</span>}>
              {lotOverview.length === 0 ? (
                <div className="text-center text-[12px] text-fg-4 py-6">No lot rules set on any character.</div>
              ) : (
                lotOverview.map(([char, r]) => (
                  <div key={char} className={`flex items-start gap-3 px-3.5 py-2.5 transition-opacity ${!autoLotEnabled || autoLotOff[char] ? 'opacity-45' : ''}`}>
                    <button
                      onClick={() => setName(char)}
                      className={`shrink-0 w-24 text-left text-[12px] font-semibold truncate transition-colors ${char === editName ? 'text-accent' : 'text-fg-2 hover:text-accent'}`}
                    >
                      {anon(char)}
                    </button>
                    <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                      {r.lot.map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded bg-field border border-line px-1.5 py-0.5 text-[11px] text-fg-2">
                          <RuleIcon id={resolveId(n)} name={n} assets={assetsAny} />
                          <span className="truncate max-w-[140px]">{n}</span>
                        </span>
                      ))}
                    </div>
                    <div className="shrink-0" title={autoLotEnabled ? 'Auto-lot for this character' : 'Disabled by the master switch'}><Toggle on={autoLotEnabled && !autoLotOff[char]} disabled={!autoLotEnabled} onChange={(v) => setAutoLotChar(char, v)} /></div>
                  </div>
                ))
              )}
            </Group>
          </div>
        ) : view === 'passlist' ? (
          <div className="flex flex-col">
            <Group title="Auto-Pass (All Characters)">
              <Row label="Pass When Other Characters Lot">
                <Toggle on={passOnLot} onChange={setPassOnLot} />
              </Row>
            </Group>
            <Group title={`Pass List · ${editName}`} right={
              <div className="flex items-center gap-2">
                <button onClick={() => setImporting(true)} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Import From Treasury</button>
                <span className="text-[11px] text-fg-4 tabular-nums">{current.pass.length}</span>
              </div>
            }>
              <div className="px-0.5 pb-1 text-[11px] text-fg-4">{editName} automatically passes these items in the treasure pool.</div>
            </Group>
            <div className="rounded-xl bg-surface border border-line p-3">
              <RuleList items={current.pass} onChange={(v) => update({ ...current, pass: v })} resolveId={resolveId} assets={assetsAny} fanOut={{ onlineCount: online.length, allCount: allCharNames.length, add: (n, scope) => addRuleToChars(scope === 'online' ? online.map((c) => c.name) : allCharNames, 'pass', n) }} />
            </div>
          </div>
        ) : view === 'alertlist' ? (
          <div className="flex flex-col">
            <Group title="Pool Alerts">
              <Row label="Play A Sound While A Watched Item Is In The Pool">
                <Toggle on={alertOn} onChange={setAlertOn} />
              </Row>
              <Row label="Volume">
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={1} step={0.05} value={alertVol} onChange={(e) => setAlertVolume(Number(e.target.value))} className="w-32 accent-accent" />
                  <button onClick={() => testAlertTone()} className="le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Test</button>
                </div>
              </Row>
            </Group>
            <Group title="Watched Items" right={<span className="text-[11px] text-fg-4 tabular-nums">{alertNames.length}</span>}>
              <div className="px-0.5 pb-1 text-[11px] text-fg-4">The tone repeats while any of these sit in the treasure pool, on any character. Add one before it drops (e.g. a Volte piece).</div>
            </Group>
            <div className="rounded-xl bg-surface border border-line p-3">
              <RuleList items={alertNames} onChange={setAlertNames} resolveId={resolveId} assets={assetsAny} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <Group title="Pool AH Price Display" right={<span className="text-[11px] text-fg-4 tabular-nums">{priceEntries.length}</span>}>
              <Row label="Default For Stackable Items">
                <Segmented value={priceDefault} onChange={setPoolPriceDefault} options={[{ v: 'single', label: 'Single' }, { v: 'stack', label: 'Stack' }]} />
              </Row>
            </Group>
            <div className="rounded-xl bg-surface border border-line p-3">
              <ItemCombo existing={priceNames} onAdd={(n) => { const id = nameToItemId.get(n.toLowerCase()); if (id) setPoolPriceMode(id, priceDefault === 'stack' ? 'single' : 'stack'); }} assets={assetsAny} />
              {priceEntries.length === 0 ? (
                <div className="text-center text-[12px] text-fg-4 py-5">No overrides. Items use the default above.</div>
              ) : (
                <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
                  {priceEntries.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <RuleIcon id={e.id} name={e.name} assets={assetsAny} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{e.name}</span>
                      <Segmented value={e.mode} onChange={(v) => setPoolPriceMode(e.id, v)} options={[{ v: 'single', label: 'Single' }, { v: 'stack', label: 'Stack' }]} />
                      <button onClick={() => setPoolPriceMode(e.id, null)} aria-label="Remove" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </Crossfade>
      </div>

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[79]" onMouseDown={() => setMenu(null)} />
          <Popover open style={menuStyle} className="rounded-lg border border-line bg-popover shadow-2xl p-1.5 flex flex-col gap-0.5 overflow-y-auto">
            {menu.kind === 'rules' ? (
              <>
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4 truncate">{menu.item.n}</div>
                <button
                  onMouseDown={(e) => { e.preventDefault(); openAhDetail({ id: menu.item.id, n: menu.item.n, st: itemStack(menu.item.id), back: 'pool' }); setMenu(null); }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-4"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                  <span className="truncate">Look Up On Auction House</span>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); const onList = drop.drop.some((n) => n.toLowerCase() === menu.item.n.toLowerCase()); setDrop(onList ? { ...drop, drop: drop.drop.filter((n) => n.toLowerCase() !== menu.item.n.toLowerCase()) } : { ...drop, drop: [...drop.drop, menu.item.n] }); setMenu(null); }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-4"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M10 11v6M14 11v6" /></svg>
                  <span className="truncate">{drop.drop.some((n) => n.toLowerCase() === menu.item.n.toLowerCase()) ? 'Remove From Drop List' : 'Add To Drop List'}</span>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); toggleAlert(menu.item.n); setMenu(null); }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-4"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
                  <span className="truncate">{hasAlert(menu.item.n) ? 'Remove Sound Alert' : 'Alert Me When In Pool'}</span>
                </button>
                {itemStack(menu.item.id) > 1 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); const other = (priceMode[menu.item.id] ?? priceDefault) === 'stack' ? 'single' : 'stack'; setPoolPriceMode(menu.item.id, other === priceDefault ? null : other); setMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-4"><rect x="3" y="9" width="12" height="12" rx="1.5" /><path d="M9 9V4.5A1.5 1.5 0 0 1 10.5 3h9A1.5 1.5 0 0 1 21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H15" /></svg>
                    <span className="truncate">{(priceMode[menu.item.id] ?? priceDefault) === 'stack' ? 'Show Single Price' : 'Show Stack Price'}</span>
                  </button>
                )}
                <div className="my-1 border-t border-line" />
                {eligibleChars.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No character in this zone for auto-rules.</div>
                ) : (
                  <>
                    <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-4">Auto-Lot on</div>
                    {online.length > 1 && (
                      <button
                        onMouseDown={(e) => { e.preventDefault(); addRuleToChars(online.map((c) => c.name), 'lot', menu.item.n); setMenu(null); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-accent hover:bg-accent/10 transition-colors"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        <span className="truncate">All Characters</span>
                      </button>
                    )}
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
                    {online.length > 1 && (
                      <button
                        onMouseDown={(e) => { e.preventDefault(); addRuleToChars(online.map((c) => c.name), 'pass', menu.item.n); setMenu(null); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-accent hover:bg-accent/10 transition-colors"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        <span className="truncate">All Characters</span>
                      </button>
                    )}
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
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4 truncate">{menuLot ? 'Lot on' : 'Pass on'} · {menu.item.n}</div>
                {lotableChars.length > 1 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); actAll(menu.item, menuLot ? 'lot' : 'pass'); setMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /><span>Everyone ({lotableChars.length})</span>
                  </button>
                )}
                {eligibleChars.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No character in this zone can {menuLot ? 'lot' : 'pass'} this.</div>
                ) : eligibleChars.map((c) => (
                  menuLot && rareBlocked(c, menu.item) ? (
                    <div
                      key={c.name}
                      title="Already holds this Rare item (only one can be held)"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-4 opacity-60 cursor-not-allowed"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-fg-4 shrink-0" />
                      <span className="truncate">{anon(c.name)}</span>
                      <span className="ml-auto shrink-0 text-[10px] font-semibold text-orange-300/80">Owns (Rare)</span>
                    </div>
                  ) : (
                    <button
                      key={c.name}
                      onMouseDown={(e) => { e.preventDefault(); (menuLot ? lotOn : passOn)(c, menu.item); setMenu(null); }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate">{anon(c.name)}</span>
                      <span className="ml-auto shrink-0 flex items-center gap-2">
                        {c.inv != null && <span className={`text-[10px] font-semibold tabular-nums ${heldOf(c, menu.item.id) > 0 ? 'text-amber-300' : 'text-fg-4/60'}`} title="Held across all bags">×{heldOf(c, menu.item.id)}</span>}
                        {c.main && <span className="text-[10px] font-semibold text-fg-4 tracking-wide">{c.main}{c.sub ? `/${c.sub}` : ''}</span>}
                      </span>
                    </button>
                  )
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
              <div className="px-2.5 py-1.5 text-[11px] text-fg-4">No character connected.</div>
            ) : (
              <>
                {allMembers.length > 1 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); doAllEveryone(allMenu.kind); setAllMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] font-semibold text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" /><span>Everyone ({allMembers.length})</span>
                  </button>
                )}
                {allMembers.map((c) => (
                  <button
                    key={c.name}
                    onMouseDown={(e) => { e.preventDefault(); doAllOn(c, allMenu.kind); setAllMenu(null); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] text-fg-2 hover:bg-field transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="truncate">{anon(c.name)}</span>
                    {c.main && <span className="ml-auto shrink-0 text-[10px] font-semibold text-fg-4 tracking-wide">{c.main}{c.sub ? `/${c.sub}` : ''}</span>}
                  </button>
                ))}
              </>
            )}
          </Popover>
        </>,
        document.body,
      )}

      {importing && <TreasuryImportModal defaultTarget={editName} onClose={() => setImporting(false)} />}
    </div>
  );
}
