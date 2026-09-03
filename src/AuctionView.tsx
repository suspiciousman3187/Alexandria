import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useKnownCharacters, useAvailableIcons, useAhMessages, useAhCatalog, requestAhCatalog, requestIcons, useItemDescription,
  ahMenu, ahSlots, ahBuy, ahSell, addPendingListing, ahClearSlot, ahCancel, ffxiahSid, FFXIAH_SID, openExternal,
  nomadReachable, NOMAD_BAGS, washCap,
  type KnownChar, type AhCatItem, type InvItem,
} from './bridge';
import { useSettings, setSettings } from './settings';
import { ALWAYS_BAGS } from './bagConstants';
import { itemNameMatches } from './itemNames';
import { useAhDetailTarget, closeAhDetail, type AhSellContext } from './ahNav';
import { useWishlist, addWish, removeWish, removeWishEntry, type WishItem } from './wishlist';
import { IconInner } from './atlasIcon';
import { logicalRect, logicalViewport } from './uiZoom';
import { useItemHover, RichDescription, WhereOwned } from './ItemTooltip';
import { Select, Segmented, SectionTabs, Group, GilInput, Stepper, SearchInput, BagTag } from './ui';
import IncBidModal from './IncBidModal';
import { useQtyBuy, runQuantityBuy, stopQtyBuy } from './quantityBuy';
import { useSticky, useStickyChar } from './sticky';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Crossfade, Modal, Popover, Collapse } from './overlay';
import { useRowMarket } from './rowMarket';
import { getPriceHistory, refreshVisibleRows } from './priceStore';
import Sparkline from './Sparkline';
import { ServerHealthBanner } from './ServerHealth';
import { fmtGilStr, rateInfo } from './marketFmt';
import { AH_CATEGORY_TREE, AH_CATEGORY_TOP, AH_CATEGORY_PATH } from './ahCategories';
import { useAnon } from './anonymize';

const acLabel = (ac?: number) => (ac && AH_CATEGORY_PATH[ac] ? AH_CATEGORY_PATH[ac].replace(/->/g, ' / ') : '');
const acLeaf = (ac?: number) => (ac && AH_CATEGORY_PATH[ac] ? AH_CATEGORY_PATH[ac].split('->').pop() ?? '' : '');

function PlayerName({ name }: { name?: string }) {
  if (!name) return <span className="text-fg-4">—</span>;
  return <span className="text-fg-3 truncate max-w-full">{name}</span>;
}


const JOBS = ['WAR', 'MNK', 'WHM', 'BLM', 'RDM', 'THF', 'PLD', 'DRK', 'BST', 'BRD', 'RNG', 'SAM', 'NIN', 'DRG', 'SMN', 'BLU', 'COR', 'PUP', 'DNC', 'SCH', 'GEO', 'RUN'];
const PROP_FLAGS: { bit: number; label: string; cls: string }[] = [
  { bit: 0x01, label: 'Rare', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { bit: 0x02, label: 'Exclusive', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  { bit: 0x08, label: 'No Auction', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  { bit: 0x10, label: 'No NPC Sale', cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
  { bit: 0x20, label: 'No Delivery', cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
];

const AUCTION_SECS = 829440;
const fmtGil = (v: number) => v.toLocaleString();

function relTime(secs: number) {
  if (secs <= 0) return 'now';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const timeColor = (secs: number) => (secs <= 3600 ? 'text-red-400' : secs <= 86400 ? 'text-amber-300' : 'text-emerald-300');

function Icon({ id, n, c, assets, iconSet, big }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number>; big?: boolean }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className={`relative shrink-0 ${big ? 'w-8 h-8' : 'w-6 h-6'} rounded bg-field grid place-items-center overflow-hidden`}>
      <IconInner id={id} size={big ? 32 : 24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

const statusTone: Record<string, string> = {
  'On auction': 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  'Sold': 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  'Not Sold': 'text-red-300 border-red-500/40 bg-red-500/10',
  'Empty': 'text-fg-4 border-line bg-field',
};

export default function AuctionView() {
  const known = useKnownCharacters();
  const anon = useAnon();
  const iconSet = useAvailableIcons();
  const msgs = useAhMessages();
  const [name, setName] = useStickyChar();
  const [tab, setTab] = useSticky<'slots' | 'browse' | 'wishlist'>('auction.tab', 'browse');
  const [spin, setSpin] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);

  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const active = online.find((c) => c.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  const ah = active?.ah;
  const atah = !!(active?.atah ?? active?.ah?.atah);
  const conn = active?.conn;
  const lastMsg = msgs[0];

  const settings = useSettings();
  const detected = active?.server || undefined;
  const effServer = settings.ahServer || detected;
  const cat = useAhCatalog();
  const target = useAhDetailTarget();
  const serverOpts = useMemo(() => Object.keys(FFXIAH_SID), []);

  const [bannerOn, setBannerOn] = useState(false);
  const bannerSeen = useRef(0);
  useEffect(() => {
    if (!lastMsg || lastMsg.at === bannerSeen.current) return;
    bannerSeen.current = lastMsg.at;
    setBannerOn(true);
    const t = window.setTimeout(() => setBannerOn(false), 6000);
    return () => window.clearTimeout(t);
  }, [lastMsg?.at]);

  const hasChar = online.length > 0;
  const effTab = !hasChar && tab === 'slots' ? 'browse' : tab;

  const doRefresh = () => {
    if (effTab === 'slots') { if (conn != null) ahMenu(conn); }
    else refreshVisibleRows();
    setSpin(true);
    window.setTimeout(() => setSpin(false), 700);
  };

  useEffect(() => { if (effTab === 'slots' && conn != null && !ah?.init) ahMenu(conn); }, [effTab, conn, ah?.init]);

  const navItem = target
    ? (cat.items.find((i) => i.id === target.id) ?? { id: target.id, n: target.n, cat: target.cat ?? '', lvl: target.lvl ?? 0, j: target.j ?? [], st: target.st, ac: target.ac })
    : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          {hasChar && (
            <div className="flex-1 min-w-0">
              <Select
                value={active?.name ?? ''}
                onChange={setName}
                options={online.map((c) => c.name)}
                renderOption={(nm) => {
                  const c = online.find((x) => x.name === nm);
                  return (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c?.ah?.atah ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="truncate">{anon(nm)}</span>
                    </span>
                  );
                }}
                full
              />
            </div>
          )}
          <div className={hasChar ? 'shrink-0 w-28' : 'flex-1 min-w-0'}>
            <Select
              value={effServer ?? ''}
              onChange={(v) => setSettings({ ...settings, ahServer: v })}
              options={serverOpts}
              renderOption={(s) => (s ? <span className="truncate">{s}</span> : <span className="truncate text-amber-300">Server</span>)}
              full
            />
          </div>
          {ah && ah.qn > 0 && <span className="shrink-0 text-[10px] text-fg-4 tabular-nums">{ah.qn} queued</span>}
          <button
            onClick={doRefresh}
            title={effTab === 'slots' ? 'Refresh listings' : 'Refresh prices'}
            className="shrink-0 grid place-items-center w-9 h-9 rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 transition-colors"
          >
            <svg viewBox="0 0 24 24" className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          </button>
        </div>

        {!target && <SectionTabs value={effTab} onChange={setTab} tabs={hasChar ? [{ id: 'browse', label: 'Browse' }, { id: 'slots', label: 'Listings' }, { id: 'wishlist', label: 'Wishlist' }] : [{ id: 'browse', label: 'Browse' }, { id: 'wishlist', label: 'Wishlist' }]} />}

        <AnimatePresence>
          {lastMsg && bannerOn && (
            <motion.div
              key={lastMsg.at}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className={`text-[11px] px-2.5 py-1.5 rounded-md border ${lastMsg.ok ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10'}`}>
                {lastMsg.text}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <Crossfade id={target ? `nav-${target.id}` : effTab}>{!target && effTab === 'slots' ? (
          <ListingsTab char={active} ah={ah} atah={atah} now={now} assets={active?.assets} iconSet={iconSet} conn={conn} server={effServer} />
        ) : !target && effTab === 'wishlist' ? (
          <WishlistPanel atah={atah} assets={active?.assets} iconSet={iconSet} conn={conn} server={effServer} />
        ) : (
          <BrowsePanel atah={atah} assets={active?.assets} iconSet={iconSet} conn={conn} server={effServer} onGoWishlist={() => setTab('wishlist')} navItem={navItem} navSell={target?.sell} onNavBack={closeAhDetail} />
        )}</Crossfade>
      </div>
    </div>
  );
}

// ---- List Items: stage items from accessible bags, set price + single/stack, list to AH ----
// Always reachable (inventory + carry + wardrobes); Safe/Safe 2/Locker (NOMAD_BAGS) become
// reachable when at a Nomad Moogle, and Storage when in a Mog House -- some AH zones (e.g. Norg)
// also have a Nomad Moogle.
const LIST_ALWAYS_BAGS = ALWAYS_BAGS;
const LIST_BAG_ORDER = [0, 5, 6, 7, 1, 9, 2, 4, 8, 10, 11, 12, 13, 14, 15, 16];
const listBagRank = (id: number) => { const i = LIST_BAG_ORDER.indexOf(id); return i < 0 ? 99 : i; };
const DEFAULT_LIST_COLLAPSED = new Set([5, 6, 7, 1, 9, 2, 4, 8, 10, 11, 12, 13, 14, 15, 16]); // everything except Inventory
const auctionable = (it: InvItem) => !((it.f ?? 0) & 0x0A) && !(it.aug && it.aug.length > 0); // not No-AH / Ex / augmented

type ListEntry = { key: string; id: number; bag: number; slot: number; n: string; c: number; ms: number; price: string; stack: boolean };

function ListRow({ entry, expanded, onToggle, server, assets, iconSet, onPrice, onStack, onRemove }: {
  entry: ListEntry; expanded: boolean; onToggle: () => void; server?: string; assets?: string; iconSet: Set<number>; onPrice: (v: string) => void; onStack: (v: boolean) => void; onRemove: () => void;
}) {
  const market = useRowMarket(entry.id, entry.stack, server, true);
  const fullStack = entry.ms > 1 && entry.c >= entry.ms;
  const medianDigits = market?.median ? market.median.replace(/[^\d]/g, '') : '';
  const priceNum = Number(entry.price) || 0;
  const stockBadge = market ? (() => {
    const n = Number(String(market.stock ?? '0').replace(/[^\d]/g, ''));
    const tone = !Number.isFinite(n) ? 'border-line bg-field text-fg-3'
      : n === 0 ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
        : n <= 3 ? 'border-amber-500/45 bg-amber-500/15 text-amber-300'
          : 'border-red-500/45 bg-red-500/15 text-red-300';
    return (
      <span className={`shrink-0 flex items-baseline gap-1 px-2 py-0.5 rounded-md border ${tone}`} title="Currently listed on the auction house">
        <span className="text-[16px] font-extrabold tabular-nums leading-none">{market.stock ?? '0'}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide opacity-80">listed</span>
      </span>
    );
  })() : market === undefined ? <RowSpinner /> : null;
  return (
    <div className={`rounded-md border bg-accent/5 ${expanded ? 'border-accent/60' : 'border-accent/40'}`}>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <button onClick={onToggle} className="min-w-0 flex-1 flex items-center gap-2.5 text-left">
          <Icon id={entry.id} n={entry.n} assets={assets} iconSet={iconSet} big />
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{entry.n}{entry.c > 1 ? ` ×${entry.c}` : ''}</span>
          {!expanded && (priceNum > 0
            ? <span className="shrink-0 text-[11px] font-semibold text-fg-2 tabular-nums">{fmtGil(priceNum)} gil</span>
            : <span className="shrink-0 text-[10px] font-semibold text-amber-300">Set price</span>)}
        </button>
        {stockBadge}
        <button onClick={onRemove} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <button onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} className="shrink-0 grid place-items-center w-5 h-6 text-fg-4 hover:text-fg-2 transition-colors">
          <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <GilInput value={entry.price} onChange={onPrice} placeholder={medianDigits || 'Price'} className="w-32 bg-field border border-line rounded px-2 py-1 text-[12px] text-fg-2 text-right tabular-nums outline-none focus:border-accent/50" />
            <span className="text-[10px] text-fg-4">gil</span>
            {medianDigits && (
              <button onClick={() => onPrice(medianDigits)} className="le-tap px-2 py-1 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">Median {market!.median}</button>
            )}
            {fullStack && (
              <div className="ml-auto"><Segmented value={entry.stack ? '1' : '0'} onChange={(v) => onStack(v === '1')} options={[{ v: '0', label: 'Single' }, { v: '1', label: 'Stack' }]} /></div>
            )}
          </div>
          {market && market.sales.length > 0 && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-fg-4 mb-1">Recent Sales · {entry.stack ? 'Stack' : 'Single'}</div>
              <div className="rounded border border-line/60 bg-field/40 divide-y divide-line/50 max-h-28 overflow-y-auto">
                {market.sales.slice(0, 10).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 text-[10px]">
                    <span className="text-fg-4 tabular-nums whitespace-nowrap shrink-0">{s.date}</span>
                    <span className="text-fg-4 truncate flex-1 min-w-0">{s.seller}</span>
                    <span className="text-fg-2 font-semibold tabular-nums shrink-0">{fmtGil(s.price)} gil</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListItemsModal({ char, freeSlots, conn, server, assets, iconSet, onClose }: {
  char: KnownChar; freeSlots: number; conn: number; server?: string; assets?: string; iconSet: Set<number>; onClose: () => void;
}) {
  const exp = useSettings().experimentalFeatures;
  const anon = useAnon();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ListEntry[]>([]);
  const searching = q.trim().length > 0;
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(DEFAULT_LIST_COLLAPSED));
  const toggleBag = (id: number) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bagOpen = (id: number) => searching || !collapsed.has(id);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const nomadOk = nomadReachable(char, exp);
    const mog = !!char.mog;
    const reachable = (id: number) => LIST_ALWAYS_BAGS.has(id) || (nomadOk && NOMAD_BAGS.has(id)) || (mog && id === 2);
    const out: { id: number; name: string; items: { id: number; bag: number; slot: number; n: string; c: number; ms: number }[] }[] = [];
    for (const bag of char.inv ?? []) {
      if (!reachable(bag.id)) continue;
      const items = [];
      for (const it of bag.items) {
        if (!auctionable(it)) continue;
        if (s && !itemNameMatches(it.id, it.n, s)) continue;
        items.push({ id: it.id, bag: bag.id, slot: it.s, n: it.n, c: it.c, ms: it.ms ?? 1 });
      }
      if (items.length) out.push({ id: bag.id, name: bag.b, items });
    }
    out.sort((a, b) => listBagRank(a.id) - listBagRank(b.id));
    return out;
  }, [char.inv, char.zone, char.nomadNear, char.mog, exp, q]);
  const poolCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  const pickedKeys = useMemo(() => new Set(picked.map((p) => p.key)), [picked]);
  const full = picked.length >= freeSlots;
  // Only one staged item's inspect panel is open at a time (accordion).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const add = (x: { id: number; bag: number; slot: number; n: string; c: number; ms: number }) => {
    const key = `${x.bag}:${x.slot}`;
    if (pickedKeys.has(key)) { setPicked((p) => p.filter((y) => y.key !== key)); return; }
    if (full) return; // no free auction slot
    setPicked((p) => [...p, { key, id: x.id, bag: x.bag, slot: x.slot, n: x.n, c: x.c, ms: x.ms, price: '', stack: x.ms > 1 && x.c >= x.ms }]);
    setExpandedKey(key);
  };
  const setPrice = (key: string, price: string) => setPicked((p) => p.map((y) => (y.key === key ? { ...y, price } : y)));
  const setStack = (key: string, stack: boolean) => setPicked((p) => p.map((y) => (y.key === key ? { ...y, stack } : y)));
  const remove = (key: string) => { setPicked((p) => p.filter((y) => y.key !== key)); setExpandedKey((k) => (k === key ? null : k)); };

  const priced = picked.filter((e) => (Number(e.price) || 0) > 0).length;
  const ready = picked.length > 0 && picked.length <= freeSlots && priced === picked.length;
  const submit = () => {
    if (!ready) return;
    for (const e of picked) {
      const priceNum = Number(e.price) || 0;
      if (priceNum <= 0) continue;
      ahSell(conn, e.id, e.stack ? 0 : 1, priceNum, 1, e.bag, e.slot);
      addPendingListing(conn, e.n);
    }
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,460px)] max-h-[88vh] flex flex-col">
      {(close) => (
        <>
          <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
            <div className="text-[14px] font-bold text-fg">List Items<span className="text-accent">: {anon(char.name)}</span></div>
            <button onClick={close} aria-label="Close" className="le-tap ml-auto grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <div className="shrink-0 px-4 pt-3">
            <SearchInput value={q} onChange={setQ} wrap="" placeholder="Search items to list…" className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
          </div>

          {picked.length > 0 && (
            <div className="shrink-0 px-4 pt-2.5 flex flex-col gap-1.5 max-h-[42vh] overflow-y-auto">
              <div className="text-[10px] font-bold uppercase tracking-wider text-fg-4">To List · {picked.length} / {freeSlots} slot{freeSlots === 1 ? '' : 's'}</div>
              {picked.map((e) => (
                <ListRow key={e.key} entry={e} expanded={expandedKey === e.key} onToggle={() => setExpandedKey((k) => (k === e.key ? null : e.key))} server={server} assets={assets} iconSet={iconSet} onPrice={(v) => setPrice(e.key, v)} onStack={(v) => setStack(e.key, v)} onRemove={() => remove(e.key)} />
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2.5 pb-3 flex flex-col gap-2">
            {poolCount === 0 ? (
              <div className="text-center text-[12px] text-fg-4 py-8">No auctionable items{q.trim() ? ' match your search' : ' in your bags'}.</div>
            ) : (
              groups.map((g) => {
                const open = bagOpen(g.id);
                return (
                  <div key={g.id} className="flex flex-col">
                    <button onClick={() => toggleBag(g.id)} className="le-tap flex items-center gap-2 px-1 py-1 text-left [&_*]:pointer-events-none">
                      <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                      <BagTag id={g.id} label={g.name} />
                      <span className="text-[11px] text-fg-4 tabular-nums">{g.items.length}</span>
                    </button>
                    <Collapse open={open}>
                      <div className="flex flex-col gap-1 pt-1 pl-1">
                        {g.items.map((x) => {
                          const key = `${x.bag}:${x.slot}`;
                          const on = pickedKeys.has(key);
                          const blocked = full && !on;
                          return (
                            <button
                              key={key}
                              onClick={() => add(x)}
                              disabled={blocked}
                              title={blocked ? 'No free auction slots' : undefined}
                              className={`w-full flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${on ? 'border-accent bg-accent/10' : blocked ? 'border-line bg-surface-raised opacity-40 cursor-not-allowed' : 'border-line bg-surface-raised hover:border-fg-4'}`}
                            >
                              <Icon id={x.id} n={x.n} assets={assets} iconSet={iconSet} />
                              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{x.n}</span>
                              {x.c > 1 && <span className="shrink-0 text-[10px] font-bold tabular-nums text-accent">×{x.c}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </Collapse>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-line">
            <span className={`text-[11px] ${full ? 'text-amber-300' : 'text-fg-4'}`}>
              {freeSlots === 0 ? 'No free auction slots' : `${picked.length}/${freeSlots} slot${freeSlots === 1 ? '' : 's'}${picked.length > 0 && priced < picked.length ? ` · ${picked.length - priced} need a price` : ''}`}
            </span>
            <button onClick={close} className="le-tap ml-auto px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={submit} disabled={!ready} className="le-tap px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">List {picked.length || ''}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ListingsTab({ char, ah, atah, now, assets, iconSet, conn, server }: {
  char?: KnownChar; ah?: KnownChar['ah']; atah: boolean; now: number; assets?: string; iconSet: Set<number>; conn?: number; server?: string;
}) {
  const [listing, setListing] = useState(false);
  const [confirmUnlist, setConfirmUnlist] = useState(false);
  // The slots array can include Empty placeholders, so count actual listings, not length.
  const used = (ah?.slots ?? []).filter((s) => s.st && s.st !== 'Empty').length;
  const free = Math.max(0, 7 - used);
  const canList = atah && !!ah?.init && conn != null && !!char;
  const onAuction = (ah?.slots ?? []).filter((s) => s.st === 'On auction');
  const canUnlist = atah && conn != null && onAuction.length > 0;
  const unlistAll = () => { if (conn != null) for (const s of onAuction) ahCancel(conn, s.s); setConfirmUnlist(false); };
  return (
    <div className="flex flex-col gap-2.5">
      {(canList || canUnlist) && (
        <div className="flex items-center gap-2 [&>*]:flex-1">
          {canList && (
            <button
              onClick={() => setListing(true)}
              disabled={free === 0}
              title={free === 0 ? 'All seven auction slots are in use' : undefined}
              className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-accent text-on-accent text-[12px] font-bold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              List Items{free < 7 ? ` (${free} free)` : ''}
            </button>
          )}
          {canUnlist && (
            confirmUnlist ? (
              <div className="flex items-center gap-2 [&>*]:flex-1">
                <button onClick={unlistAll} className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-red-500 text-white text-[12px] font-bold hover:bg-red-600 transition-colors">
                  Confirm Unlist ({onAuction.length})
                </button>
                <button onClick={() => setConfirmUnlist(false)} className="le-tap inline-flex items-center justify-center h-9 px-3 rounded-md border border-line text-fg-3 text-[12px] font-semibold hover:text-fg-2 transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmUnlist(true)}
                title="Remove all active listings from the auction house"
                className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-[12px] font-bold hover:bg-red-500/20 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                Unlist All ({onAuction.length})
              </button>
            )
          )}
        </div>
      )}
      <SlotsPanel ah={ah} atah={atah} now={now} assets={assets} iconSet={iconSet} conn={conn} />
      {listing && char && conn != null && (
        <ListItemsModal char={char} freeSlots={free} conn={conn} server={server} assets={assets} iconSet={iconSet} onClose={() => setListing(false)} />
      )}
    </div>
  );
}

function SlotsPanel({ ah, atah, now, assets, iconSet, conn }: { ah?: KnownChar['ah']; atah: boolean; now: number; assets?: string; iconSet: Set<number>; conn?: number }) {
  const [confirmDelist, setConfirmDelist] = useState<number | null>(null);
  if (!ah || !ah.init) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-sm">
          {atah ? (
            <>
              <div className="flex items-center justify-center gap-2 mb-1">
                <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin text-accent" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
                <div className="text-[13px] font-bold text-fg">Loading Your Auctions…</div>
              </div>
              <div className="text-[12px] text-fg-4 leading-relaxed">Pulling your seven sell slots from the auction house. This takes a moment after arriving.</div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-bold text-fg mb-1">No Auction Data Yet</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">In a zone with an auction house your sell slots load automatically. Or hit <span className="text-fg-2 font-semibold">Refresh</span> to fetch them now.</div>
            </>
          )}
        </div>
      </div>
    );
  }
  const slots = ah.slots;
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
      {Array.from({ length: 7 }, (_, i) => {
        const s = slots.find((x) => x.s === i);
        const st = s?.st ?? 'Empty';
        const tone = statusTone[st] ?? statusTone.Empty;
        const remaining = st === 'On auction' && s ? (s.ts + AUCTION_SECS) - now : 0;
        return (
          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2.5">
            <span className="text-[10px] text-fg-4 w-4 text-center tabular-nums shrink-0">{i + 1}</span>
            {st === 'Empty' ? (
              <span className="text-[12px] text-fg-4 flex-1">Empty</span>
            ) : (
              <>
                <Icon id={s!.id} n={s!.n} assets={assets} iconSet={iconSet} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] text-fg-3 truncate">{s!.n}</span>
                    {s!.c > 1 && <span className="shrink-0 text-[10px] font-bold text-fg-2 tabular-nums px-1.5 py-px rounded bg-field border border-line">×{s!.c}</span>}
                  </div>
                  <div className="flex items-baseline gap-2 leading-tight">
                    <span className="text-[14px] font-bold text-fg tabular-nums">{fmtGil(s!.p)}<span className="text-[11px] font-semibold text-fg-3"> gil</span></span>
                    {st === 'On auction' && <span className={`text-[12px] font-semibold tabular-nums ${timeColor(remaining)}`}>{remaining > 0 ? `${relTime(remaining)} left` : 'ending'}</span>}
                  </div>
                </div>
                {(st === 'Sold' || st === 'Not Sold') && (
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tone}`}>{st === 'Not Sold' ? 'Expired' : st}</span>
                )}
                {(st === 'Sold' || st === 'Not Sold') && (
                  <button onClick={() => conn != null && ahClearSlot(conn, i)} title="Clear Slot" className="shrink-0 grid place-items-center w-6 h-6 rounded-md border border-line text-fg-4 hover:text-fg-2 transition-colors">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                )}
                {st === 'On auction' && (
                  <AnimatePresence mode="wait" initial={false}>
                  {confirmDelist === i ? (
                    <motion.span key="confirm" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }} className="shrink-0 flex items-center gap-1">
                      <button onClick={() => { if (conn != null) ahCancel(conn, i); setConfirmDelist(null); }} title="Confirm Delist" className="grid place-items-center w-7 h-7 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      </button>
                      <button onClick={() => setConfirmDelist(null)} title="Cancel" className="grid place-items-center w-7 h-7 rounded-md border border-line text-fg-4 hover:text-fg-2 transition-colors">
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </motion.span>
                  ) : (
                    <motion.button key="delist" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }} onClick={() => setConfirmDelist(i)} title="Delist (remove from auction)" className="shrink-0 grid place-items-center w-7 h-7 rounded-md border border-line text-fg-3 hover:text-fg hover:border-line-2 transition-colors">
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </motion.button>
                  )}
                  </AnimatePresence>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}


const RESULT_CAP = 250;

function useOnScreen<T extends Element>(ref: { readonly current: T | null }): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

function RowSpinner() {
  return (
    <svg className="shrink-0 animate-spin w-3.5 h-3.5 text-fg-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function BrowseRow({ it, assets, iconSet, server, onSelect }: { it: AhCatItem; assets?: string; iconSet: Set<number>; server?: string; onSelect: () => void }) {
  const wished = useWishlist().some((w) => w.id === it.id);
  const rowRef = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(rowRef);
  const market = useRowMarket(it.id, false, server, visible);
  const median = market?.median;
  const lt = market?.listedTotal;
  const n = lt != null ? lt : null;
  const tone = n == null ? '' : n === 0 ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : n <= 3 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  return (
    <div ref={rowRef} className="flex items-center gap-2 px-3 py-1.5 hover:bg-field transition-colors">
      <button onClick={onSelect} className="min-w-0 flex-1 flex items-center gap-2.5 text-left">
        <Icon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-fg-2 leading-tight">{it.n}</span>
          <span className="block truncate text-[10px] text-fg-4 leading-tight">{acLeaf(it.ac) || it.cat}{it.lvl > 0 ? ` · Lv${it.lvl}` : ''}</span>
        </span>
      </button>
      {visible && market === undefined ? <RowSpinner /> : (
        <>
          {median && <span className="shrink-0 text-[12px] font-bold text-fg tabular-nums">{fmtGilStr(median)}<span className="text-[9px] font-semibold text-fg-4 ml-0.5">G</span></span>}
          {n != null && (
            <span className={`shrink-0 inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-md border tabular-nums leading-none ${tone}`}>
              <span className="text-[12px] font-extrabold">{n}</span>
              <span className="text-[8px] font-bold uppercase tracking-wide opacity-80">listed</span>
            </span>
          )}
        </>
      )}
      <button
        onClick={() => (wished ? removeWish(it.id) : addWish({ id: it.id, n: it.n }, it.st > 1))}
        title={wished ? 'On Wishlist' : 'Add to Wishlist'}
        className={`shrink-0 grid place-items-center w-7 h-7 rounded-md border transition-colors ${wished ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-4 hover:text-fg-2'}`}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={wished ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" /></svg>
      </button>
    </div>
  );
}

function BrowsePanel({ atah, assets, iconSet, conn, server, onGoWishlist, navItem, navSell, onNavBack }: { atah: boolean; assets?: string; iconSet: Set<number>; conn?: number; server?: string; onGoWishlist: () => void; navItem?: AhCatItem; navSell?: AhSellContext; onNavBack?: () => void }) {
  const cat = useAhCatalog();
  const wish = useWishlist();
  const [q, setQ] = useSticky('ah.q', '');
  const [group, setGroup] = useSticky('ah.group', 'all');
  const [subCat, setSubCat] = useSticky('ah.subCat', 'all');
  const [job, setJob] = useSticky('ah.job', 'all');
  const [maxLvl, setMaxLvl] = useSticky('ah.maxLvl', '');
  const [only119, setOnly119] = useSticky('ah.only119', false);
  const [sel, setSel] = useState<AhCatItem | null>(null);
  const [wishToast, setWishToast] = useState(false);
  const prevWishLen = useRef(wish.length);
  useEffect(() => {
    const grew = wish.length > prevWishLen.current;
    prevWishLen.current = wish.length;
    if (grew && !sel) {
      setWishToast(true);
      const t = window.setTimeout(() => setWishToast(false), 5000);
      return () => window.clearTimeout(t);
    }
  }, [wish.length]);

  const groups = useMemo(() => ['all', ...AH_CATEGORY_TREE.map((g) => g.top), 'Uncategorized'], []);
  const subs = useMemo(() => AH_CATEGORY_TREE.find((g) => g.top === group)?.subs ?? [], [group]);
  const changeGroup = (g: string) => { setGroup(g); setSubCat('all'); };

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const lvl = Number(maxLvl) || 0;
    const subId = subCat === 'all' ? 0 : Number(subCat);
    const out: AhCatItem[] = [];
    for (const it of cat.items) {
      if (s && !itemNameMatches(it.id, it.n, s)) continue;
      if (group === 'Uncategorized') { if (it.ac) continue; }
      else if (group !== 'all') {
        if (subId) { if (it.ac !== subId) continue; }
        else if (AH_CATEGORY_TOP[it.ac ?? 0] !== group) continue;
      }
      if (lvl > 0 && it.lvl > lvl) continue;
      if (only119 && it.il !== 119) continue;
      if (job !== 'all' && !(it.j ?? []).includes(job)) continue;
      out.push(it);
      if (out.length > RESULT_CAP) break;
    }
    return out;
  }, [cat.items, q, group, subCat, job, maxLvl, only119]);

  const hasBrowseFilter = q.trim() !== '' || group !== 'all';

  const requested = useRef<Set<number>>(new Set());
  useEffect(() => { requested.current = new Set(); }, [conn]);
  useEffect(() => {
    if (conn == null) return;
    const ids: number[] = [];
    for (const it of results) if (!requested.current.has(it.id)) { requested.current.add(it.id); ids.push(it.id); }
    if (ids.length) requestIcons(conn, ids);
  }, [results, conn]);

  if (cat.items.length === 0) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-sm">
          <div className="text-[13px] font-bold text-fg mb-1">{cat.loading ? 'Loading Item Catalog…' : 'Item Catalog Unavailable'}</div>
          <div className="text-[12px] text-fg-4 leading-relaxed mb-3">
            {cat.loading ? `Received ${cat.loaded.toLocaleString()}${cat.expected ? ` of ${cat.expected.toLocaleString()}` : ''} items…` : 'The catalog ships with the app, so this is rare. Rebuild it from a connected character.'}
          </div>
          {!cat.loading && (
            <button onClick={() => conn != null && requestAhCatalog(conn)} disabled={conn == null} className="px-4 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">Rebuild From Game</button>
          )}
        </div>
      </div>
    );
  }

  const detailItem = navItem ?? sel;
  return (
    <Crossfade id={detailItem ? `detail-${detailItem.id}` : 'browse-list'}>
      {detailItem ? (
        <ItemDetail key={detailItem.id} item={detailItem} onBack={navItem ? (onNavBack ?? (() => setSel(null))) : () => setSel(null)} backLabel={navItem ? 'Back to Inventory' : undefined} sell={navItem ? navSell : undefined} atah={atah} assets={assets} iconSet={iconSet} conn={conn} server={server} onGoWishlist={navItem ? undefined : onGoWishlist} />
      ) : (
      <div className="flex flex-col gap-2.5">
      <ServerHealthBanner />
      <AnimatePresence>
        {wishToast && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-accent">Added to wishlist.</span>
              <button onClick={onGoWishlist} className="ml-auto text-[11px] font-bold text-sky-300 hover:text-sky-200 hover:underline transition-colors">View Wishlist →</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <SearchInput
        value={q}
        onChange={setQ}
        wrap=""
        placeholder={`Search ${cat.items.length.toLocaleString()} auctionable items…`}
        className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[120px]"><Select value={group} onChange={changeGroup} options={groups} renderOption={(v) => (v === 'all' ? 'All Categories' : v)} full /></div>
        {group !== 'all' && group !== 'Uncategorized' && subs.length > 1 && (
          <div className="flex-1 min-w-[120px]"><Select value={subCat} onChange={setSubCat} options={['all', ...subs.map((s) => String(s.id))]} renderOption={(v) => (v === 'all' ? `All ${group}` : subs.find((s) => String(s.id) === v)?.label ?? v)} full /></div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[110px]"><Select value={job} onChange={setJob} options={['all', ...JOBS]} renderOption={(v) => (v === 'all' ? 'All Jobs' : v)} full /></div>
        <button
          onClick={() => setOnly119((v) => !v)}
          title="Show only item level 119 gear"
          className={`le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-md border transition-colors ${only119 ? 'bg-accent text-on-accent border-transparent' : 'bg-field border-line text-fg-3 hover:text-fg-2'}`}
        >
          i119
        </button>
        <input value={maxLvl} onChange={(e) => setMaxLvl(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Max Lv" className="w-[80px] bg-field border border-line rounded-md px-2 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
      </div>
      <div className="flex items-center -mt-0.5">
        <span className="text-[12px] font-semibold text-fg-3 tabular-nums">
          {cat.loading
            ? `Loading ${cat.loaded.toLocaleString()}${cat.expected ? `/${cat.expected.toLocaleString()}` : ''}…`
            : hasBrowseFilter
              ? `${results.length.toLocaleString()} Items Found`
              : ''}
        </span>
      </div>

      {!hasBrowseFilter ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-16 text-center text-[12px] text-fg-4">
          Search or pick a category to filter…
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line max-h-[68vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-fg-4 text-center">No items match.</div>
          ) : results.map((it) => (
            <BrowseRow key={it.id} it={it} assets={assets} iconSet={iconSet} server={server} onSelect={() => setSel(it)} />
          ))}
          {results.length > RESULT_CAP && <div className="px-3 py-2 text-[10px] text-fg-4 text-center">Showing first {RESULT_CAP}. Refine your search.</div>}
        </div>
      )}
      </div>
      )}
    </Crossfade>
  );
}

function SellModal({ item, sellers, initial, server, assets, iconSet, onClose, afterList }: {
  item: AhCatItem;
  sellers: { char: KnownChar; ctx: AhSellContext }[];
  initial: AhSellContext | null;
  server?: string;
  assets?: string;
  iconSet: Set<number>;
  onClose: () => void;
  afterList?: () => void;
}) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const [stack, setStack] = useState(false);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const options = useMemo(() => {
    const list = sellers.map((s) => s.ctx);
    if (initial && !list.some((c) => c.conn === initial.conn)) list.unshift(initial);
    return list;
  }, [sellers, initial]);
  const [sellerConn, setSellerConn] = useState<number | null>(initial?.conn ?? options[0]?.conn ?? null);
  const ctx = options.find((c) => c.conn === sellerConn) ?? options[0] ?? null;
  useEffect(() => { if (ctx?.conn != null) ahSlots(ctx.conn); }, [ctx?.conn]);
  const boxOf = (c?: number | null) => (c == null ? undefined : known.find((k) => k.conn === c)?.ah);
  const freeOf = (c?: number | null) => { const ah = boxOf(c); if (!ah?.init) return null; const u = (ah.slots ?? []).filter((s) => s.st && s.st !== 'Empty').length; return Math.max(0, 7 - u); };
  const bagNameOf = (c: AhSellContext) => { const k = known.find((kk) => kk.conn === c.conn); return k?.inv?.find((b) => b.id === c.bagId)?.b ?? (c.bagId === 0 ? 'Inventory' : 'Bag'); };
  const boxFree = freeOf(ctx?.conn);
  const fullStacks = ctx ? Math.floor(ctx.count / (item.st || 1)) : 0;
  const canStack = item.st > 1 && fullStacks >= 1;
  const stk = canStack && stack;
  const maxStk = Math.max(1, Math.min(7, boxFree ?? 7, fullStacks || 1));
  const maxSingles = Math.max(1, Math.min(7, boxFree ?? 7, ctx?.count ?? 1));
  const maxList = stk ? maxStk : maxSingles;
  const listQty = Math.min(qty, maxList);
  const market = useRowMarket(item.id, stk, server, true);
  const rate = rateInfo(market?.rate);
  const priceNum = Number(price) || 0;
  const medianNum = market?.median ? Number(market.median.replace(/[^\d]/g, '')) : 0;
  const boxFull = boxFree != null && listQty > boxFree;
  const sellerAtah = !!known.find((k) => k.conn === ctx?.conn && (k.atah ?? k.ah?.atah));
  const canList = !!ctx && priceNum > 0 && sellerAtah && !boxFull;

  const commit = () => {
    if (!canList || !ctx) return;
    ahSell(ctx.conn, item.id, stk ? 0 : 1, priceNum, listQty, ctx.fromBag ? ctx.bagId : undefined, ctx.fromBag ? ctx.slot : undefined);
    for (let i = 0; i < listQty; i++) addPendingListing(ctx.conn, item.n);
    onClose();
    afterList?.();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,440px)]">
      {(close) => (
        <div className="flex flex-col max-h-[86vh]">
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line">
            <div className="shrink-0 w-11 h-11 rounded-lg bg-field grid place-items-center overflow-hidden">
              <IconInner id={item.id} size={32} name={item.n} assets={assets} bmpHas={item.id > 0 && iconSet.has(item.id)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-fg leading-tight truncate">Sell {item.n}</div>
              <div className="text-[11px] text-fg-4 truncate">{acLabel(item.ac)}{acLabel(item.ac) && item.st > 1 ? ' · ' : ''}{item.st > 1 ? `stacks to ${item.st}` : ''}</div>
            </div>
          </div>

          <div className="px-4 py-3.5 flex flex-col gap-3.5 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Sell From</div>
              {options.length <= 1 ? (
                ctx && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-line bg-field/60">
                    <span className="text-[13px] font-semibold text-fg-2 truncate">{anon(ctx.charName)}</span>
                    <BagTag id={ctx.bagId} label={bagNameOf(ctx)} className="ml-auto shrink-0" />
                    <span className="shrink-0 text-[10px] text-fg-4 tabular-nums">x{ctx.count}{boxFree != null ? ` · ${boxFree} free` : ''}</span>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-1.5">
                  {options.map((o) => {
                    const fr = freeOf(o.conn);
                    const sel = o.conn === ctx?.conn;
                    return (
                      <button key={o.conn} onClick={() => setSellerConn(o.conn)} className={`le-tap flex items-center gap-2 w-full px-3 py-2 rounded-md border transition-colors ${sel ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field/60 text-fg-2 hover:border-accent/40'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sel ? 'bg-accent' : 'bg-fg-4'}`} />
                        <span className="text-[13px] font-semibold truncate">{anon(o.charName)}</span>
                        <BagTag id={o.bagId} label={bagNameOf(o)} className="ml-auto shrink-0" />
                        <span className="shrink-0 text-[10px] text-fg-4 tabular-nums">x{o.count}{fr != null ? ` · ${fr} free` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {ctx?.fromBag && <div className="text-[11px] text-fg-4 leading-snug rounded-md border border-line bg-field/50 px-2.5 py-1.5">Held in {anon(ctx.charName)}'s storage. Alexandria pulls it to inventory first, then lists it.</div>}

            {canStack && <Segmented full value={stk ? '1' : '0'} onChange={(v) => setStack(v === '1')} options={[{ v: '0', label: 'Single' }, { v: '1', label: 'Stack' }]} />}

            <div className="rounded-md border border-line bg-field/40 px-3 py-2.5 flex flex-col gap-1.5">
              {market === undefined ? (
                <div className="text-[11px] text-fg-4">Looking up {stk ? 'stack' : 'single'} prices…</div>
              ) : market && (market.median || market.stock) ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="w-12 shrink-0 text-[10px] font-bold uppercase tracking-wide text-fg-4">Median</span>
                    {market.median ? <span className="text-[18px] font-extrabold text-fg tabular-nums leading-none">{fmtGilStr(market.median)}<span className="text-[11px] font-semibold text-fg-3"> gil</span></span> : <span className="text-[13px] text-fg-4">—</span>}
                    {market.stock != null && <span className={`ml-auto text-[11px] font-semibold tabular-nums ${Number(market.stock) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtGilStr(market.stock)} in stock</span>}
                  </div>
                  {rate && <div className="flex items-baseline gap-2"><span className="w-12 shrink-0 text-[10px] font-bold uppercase tracking-wide text-fg-4">Rate</span><span className="text-[11px]"><span className={`font-bold ${rate.cls}`}>{rate.label}</span> <span className="text-fg-4">({rate.perDay}/day)</span></span></div>}
                </>
              ) : (
                <div className="text-[11px] text-fg-4">No market data for this {stk ? 'stack' : 'single'}.</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <GilInput value={price} onChange={setPrice} placeholder="List price (gil)" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-2 text-[13px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
              {medianNum > 0 && <button onClick={() => setPrice(String(medianNum))} title={`Median · ${fmtGil(medianNum)} gil`} className="le-tap shrink-0 px-3 py-2 text-[12px] font-bold rounded-md border border-line bg-field text-fg-2 hover:text-fg hover:border-accent/40 transition-colors">Median</button>}
              {maxList > 1 && <Stepper value={listQty} min={1} max={maxList} onChange={setQty} title={stk ? 'How many stacks to list' : 'How many singles to list'} className="shrink-0 h-9" />}
            </div>

            {boxFull && <div className="text-[11px] text-amber-300">{ctx ? anon(ctx.charName) : 'This character'} {boxFree === 0 ? 'has no free auction slots (7/7 used). Unlist something first.' : `has only ${boxFree} free slot${boxFree === 1 ? '' : 's'} but this lists ${listQty}. Lower the count.`}</div>}
            {ctx && !sellerAtah && <div className="text-[11px] text-amber-300">{anon(ctx.charName)} is not at an auction house.</div>}
          </div>

          <div className="px-4 py-3 border-t border-line flex items-center gap-2">
            <button onClick={close} className="px-4 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
            <button onClick={commit} disabled={!canList} className="le-tap flex-1 px-4 py-2 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
              {priceNum > 0 ? `List${listQty > 1 ? ` ${listQty} ${stk ? 'Stacks' : 'Singles'}` : ''} · ${fmtGil(priceNum)} gil${listQty > 1 ? ' ea' : ''}` : 'Set a Price to List'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ItemDetail({ item, onBack, backLabel, sell, initialStack, atah, assets, iconSet, conn, server, onGoWishlist }: { item: AhCatItem; onBack: () => void; backLabel?: string; sell?: AhSellContext; initialStack?: boolean; atah: boolean; assets?: string; iconSet: Set<number>; conn?: number; server?: string; onGoWishlist?: () => void }) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const [stack, setStack] = useState(!!initialStack && item.st > 1);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [bidder, setBidder] = useState('');
  const [bidderOpen, setBidderOpen] = useState(false);
  const [incOpen, setIncOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(!!sell);
  const bidBtnRef = useRef<HTMLButtonElement>(null);
  const bidderMenuRef = useRef<HTMLDivElement>(null);
  const [bidderPos, setBidderPos] = useState<{ right: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!bidderOpen) return;
    const onScroll = (e: Event) => { if (bidderMenuRef.current?.contains(e.target as Node)) return; setBidderOpen(false); };
    const onResize = () => setBidderOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [bidderOpen]);
  const market = useRowMarket(item.id, stack, server, true);
  const chartPts = useMemo(() => {
    const raw = (market?.sales ?? []).filter((s) => s.ts && s.price > 0);
    const cap = washCap(raw.map((s) => s.price));
    const salePts = raw
      .filter((s) => s.price <= cap)
      .map((s) => ({ t: (s.ts as number) * 1000, v: s.price }))
      .sort((a, b) => a.t - b.t);
    const hist = getPriceHistory(server ?? '', item.id, stack).filter((h) => h.median > 0 && h.median <= cap);
    if (salePts.length >= 2) {
      const oldest = salePts[0].t;
      const older = hist.filter((h) => h.at < oldest).map((h) => ({ t: h.at, v: h.median }));
      return [...older, ...salePts];
    }
    if (hist.length >= 2) return hist.map((h) => ({ t: h.at, v: h.median }));
    return salePts;
  }, [market, server, item.id, stack]);
  const trend = chartPts.length >= 2 ? ((chartPts[chartPts.length - 1].v - chartPts[0].v) / chartPts[0].v) * 100 : null;

  const priceNum = Number(price) || 0;
  const buyQty = qty;  // multi-purchase applies to both singles and stacks
  const canStack = item.st > 1;
  const itemFlag = useMemo(() => { for (const k of known) for (const b of k.inv ?? []) for (const it of b.items) if (it.id === item.id && it.f != null) return it.f; return 0; }, [known, item.id]);
  const isRare = (itemFlag & 0x01) !== 0;
  const heldCount = useMemo(() => { const m = new Map<string, number>(); for (const k of known) { let c = 0; for (const b of k.inv ?? []) for (const it of b.items) if (it.id === item.id) c += it.c; if (c > 0) m.set(k.name, c); } return m; }, [known, item.id]);
  const atAh = useMemo(() => known.filter((k) => k.online && k.conn != null && (k.atah ?? k.ah?.atah)), [known]);
  const sellers = useMemo(() => {
    const out = [] as { char: (typeof known)[number]; ctx: AhSellContext }[];
    for (const k of known) {
      if (!k.online || k.conn == null || !(k.atah ?? k.ah?.atah)) continue;
      let best: { bag: number; slot: number; count: number } | null = null;
      for (const b of k.inv ?? []) for (const it of b.items) {
        if (it.id !== item.id || !auctionable(it)) continue;
        if (b.id === 0) best = { bag: 0, slot: it.s, count: it.c };
        else if (!best) best = { bag: b.id, slot: it.s, count: it.c };
      }
      if (best) out.push({ char: k, ctx: { conn: k.conn, bagId: best.bag, slot: best.slot, count: best.count, charName: k.name, fromBag: best.bag !== 0 } });
    }
    return out;
  }, [known, item.id]);
  const bidCost = priceNum * buyQty;
  const bidders = useMemo(() => atAh.filter((k) => (k.gil ?? 0) >= bidCost && !(isRare && (heldCount.get(k.name) ?? 0) >= 1)), [atAh, bidCost, isRare, heldCount]);
  const onlineChars = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const bidderChar = bidders.find((k) => k.name === bidder) ?? bidders[0];
  const canBid = priceNum > 0 && bidders.length > 0;
  const jobsList = item.j ?? [];
  const description = useItemDescription(item.id);
  const serverKnown = !!(server && ffxiahSid(server) != null);
  const wished = useWishlist().some((w) => w.id === item.id);
  const rate = rateInfo(market?.rate);
  const nameSlug = encodeURIComponent(item.n.replace(/ /g, '_'));
  const links = [
    { label: 'BG Wiki', url: `https://www.bg-wiki.com/ffxi/${nameSlug}` },
    { label: 'Wiki', url: `https://ffxi.gamerescape.com/wiki/${nameSlug}` },
    { label: 'FFXIAH', url: `https://www.ffxiah.com/item/${item.id}` },
  ];

  const qbuy = useQtyBuy();
  const onBid = () => {
    const c = bidderChar?.conn;
    if (c == null || priceNum <= 0 || !bidderChar) return;
    // buyQty > 1 -> drive a paced loop with progress + stop; a single bid stays a one-shot.
    if (buyQty > 1) void runQuantityBuy({ conn: c, charName: bidderChar.name, id: item.id, itemName: item.n, single: stack ? 0 : 1, price: priceNum, target: buyQty });
    else ahBuy(c, item.id, stack ? 0 : 1, priceNum, 1);
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="le-tap flex items-center gap-1.5 text-[12px] font-semibold text-fg-3 hover:text-fg transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          {backLabel ?? 'Back'}
        </button>
        {wished && onGoWishlist && (
          <button onClick={onGoWishlist} className="le-tap text-[11px] font-bold text-sky-300 hover:text-sky-200 hover:underline transition-colors">View Wishlist →</button>
        )}
        <button
          onClick={() => (wished ? removeWish(item.id) : addWish({ id: item.id, n: item.n }, item.st > 1))}
          className={`le-tap ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md border transition-colors ${wished ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-3 hover:text-fg'}`}
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={wished ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" /></svg>
          {wished ? 'On Wishlist' : 'Add to Wishlist'}
        </button>
      </div>

      <div className="rounded-xl bg-surface-raised border border-line p-3.5 mb-5 flex flex-col gap-3">
        <div className="flex items-start gap-3.5">
          <div className="shrink-0 w-14 h-14 rounded-lg bg-field grid place-items-center overflow-hidden">
            <IconInner id={item.id} size={40} name={item.n} assets={assets} bmpHas={item.id > 0 && iconSet.has(item.id)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold text-fg leading-tight">{item.n}</div>
            <div className="text-[11px] text-fg-4 truncate mt-0.5">{acLabel(item.ac) || item.cat}{item.lvl > 0 ? ` · Lv${item.lvl}` : ''}{item.st > 1 ? ` · stacks to ${item.st}` : ''}</div>
            {itemFlag > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {PROP_FLAGS.filter((p) => itemFlag & p.bit).map((p) => (
                  <span key={p.label} className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded border ${p.cls}`}>{p.label}</span>
                ))}
              </div>
            )}
            {jobsList.length > 0 && jobsList.length < JOBS.length && <div className="text-[10px] text-fg-3 mt-1 leading-snug">{jobsList.join(' ')}</div>}
          </div>
        </div>
        {description && <div className="border-t border-line pt-3"><RichDescription text={description} /></div>}
        <div className="border-t border-line pt-2.5 flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-4">Info</span>
          {links.map((l) => (
            <button key={l.label} onClick={() => openExternal(l.url)} className="text-[11px] font-semibold text-sky-300 hover:text-sky-200 hover:underline transition-colors">[{l.label}]</button>
          ))}
        </div>
      </div>

      <Group title="In Your Bags">
        <div className="px-3.5 py-3 flex flex-col gap-3">
          <WhereOwned id={item.id} collapsible defaultOpen />
          {sellers.length > 0 && (
            <button onClick={() => setSellOpen(true)} className="le-tap flex items-center justify-center gap-2 w-full px-3 py-2.5 text-[12px] font-bold rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L3 13V3h10z" /><circle cx="7.5" cy="7.5" r="1" fill="currentColor" /></svg>
              Sell From Bags{sellers.length > 1 ? ` · ${sellers.length} characters` : ` · ${anon(sellers[0].char.name)}`}
            </button>
          )}
        </div>
      </Group>

      <Group title="Pricing">
        <div className="px-3.5 py-3 flex flex-col gap-3">
          {canStack && <Segmented full value={stack ? '1' : '0'} onChange={(v) => setStack(v === '1')} options={[{ v: '0', label: 'Single' }, { v: '1', label: 'Stack' }]} />}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11px] text-fg-4">Server</span>
              {server
                ? <span className={`text-[14px] font-extrabold ${serverKnown ? 'text-accent' : 'text-amber-300'}`}>{server}{!serverKnown && <span className="ml-1.5 text-[10px] font-semibold text-amber-300">(default)</span>}</span>
                : <span className="text-[12px] font-bold text-amber-300">Unknown</span>}
            </div>
            {market === undefined ? (
              <div className="text-[11px] text-fg-4">Looking up {stack ? 'stack' : 'single'} prices…</div>
            ) : market && (market.median || market.stock) ? (
              <>
                {rate && (
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[11px] text-fg-4">Rate</span>
                    <span className="text-[12px]"><span className={`font-bold ${rate.cls}`}>{rate.label}</span> <span className="text-fg-4">({rate.perDay} sold/day)</span></span>
                  </div>
                )}
                <div className="flex items-baseline gap-3">
                  <span className="w-14 shrink-0 text-[11px] text-fg-4">Median</span>
                  {market.median
                    ? <span className="text-[22px] font-extrabold text-fg tabular-nums leading-none">{fmtGilStr(market.median)}<span className="text-[12px] font-semibold text-fg-3"> gil</span></span>
                    : <span className="text-[14px] font-semibold text-fg-4">—</span>}
                  {market.stock && (
                    Number(market.stock) > 0 ? (
                      <span className="inline-flex items-baseline gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5">
                        <span className="text-[16px] font-extrabold text-emerald-300 tabular-nums leading-none">{fmtGilStr(market.stock)}</span>
                        <span className="text-[10px] font-semibold text-emerald-300/80">in stock</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-baseline gap-1 rounded-md border border-red-500/30 bg-red-500/15 px-2 py-0.5">
                        <span className="text-[16px] font-extrabold text-red-300 tabular-nums leading-none">0</span>
                        <span className="text-[10px] font-semibold text-red-300/80">in stock</span>
                      </span>
                    )
                  )}
                </div>
                {market.sales.length > 0 && (() => {
                  const last = market.sales[0].price;
                  const med = market.median ? Number(market.median.replace(/[^\d]/g, '')) : null;
                  const cls = med == null || last === med ? 'text-fg-2' : last < med ? 'text-emerald-300' : 'text-red-300';
                  return (
                    <div className="flex items-baseline gap-3">
                      <span className="w-14 shrink-0 text-[11px] text-fg-4">Last Sold</span>
                      <span className={`text-[15px] font-bold tabular-nums leading-none ${cls}`}>{fmtGil(last)}<span className="text-[11px] font-semibold text-fg-4"> gil</span></span>
                      {market.sales[0].date && <span className="text-[10px] text-fg-4 tabular-nums">{market.sales[0].date}</span>}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="text-[11px] text-fg-4">No market data for this {stack ? 'stack' : 'single'}.</div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-3 border-t border-line">
            <GilInput value={price} onChange={setPrice} placeholder="Bid price (gil)" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-2 text-[13px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
            <Stepper value={qty} min={1} max={99} onChange={setQty} title={stack ? 'How many stacks to buy' : 'How many to buy'} className="shrink-0 h-9" />
            <div className="relative shrink-0">
                  <button ref={bidBtnRef} onClick={() => { if (!bidderOpen) { const raw = bidBtnRef.current?.getBoundingClientRect(); if (raw) { const r = logicalRect(raw); const vp = logicalViewport(); setBidderPos({ right: vp.w - r.right, bottom: vp.h - r.top + 6 }); } } setBidderOpen((o) => !o); }} disabled={!canBid} className="le-tap px-5 py-2 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors flex items-center gap-1.5">
                    Bid
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {bidderOpen && bidderPos && createPortal(
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={() => setBidderOpen(false)} />
                      <div ref={bidderMenuRef} style={{ position: 'fixed', right: bidderPos.right, bottom: bidderPos.bottom }} className="z-[61] min-w-[280px] max-h-[320px] overflow-y-auto rounded-lg border border-line bg-popover shadow-xl p-2 flex flex-col gap-0.5">
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-4">Bid With</div>
                        {onlineChars.length === 0 && <div className="px-2.5 py-2 text-[12px] text-fg-4">No characters connected.</div>}
                        {onlineChars.map((b) => {
                          const inAh = !!(b.atah ?? b.ah?.atah);
                          const g = b.gil ?? 0;
                          const rareBlock = isRare && (heldCount.get(b.name) ?? 0) >= 1;
                          const ok = inAh && g >= bidCost && !rareBlock;
                          return (
                            <button key={b.name} disabled={!ok} onClick={() => { setBidder(b.name); setBidderOpen(false); setConfirming(true); }} title={ok ? '' : rareBlock ? 'Already holds this Rare item (only one can be held)' : !inAh ? 'Not in an auction house zone' : `Needs ${bidCost.toLocaleString()} gil to bid`} className={`le-tap flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${ok ? 'hover:bg-field' : 'opacity-50 cursor-not-allowed'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                              <span className="text-[13px] text-fg-2 font-semibold min-w-0 truncate">{anon(b.name)}</span>
                              {rareBlock
                                ? <span className="ml-auto text-[10px] text-orange-300/80 shrink-0">Owns (Rare)</span>
                                : !inAh
                                  ? <span className="ml-auto text-[10px] text-fg-4 shrink-0">Not at AH</span>
                                  : <span className={`ml-auto text-[12px] tabular-nums shrink-0 ${ok ? 'text-amber-300' : 'text-red-400/80'}`}>{g.toLocaleString()} G</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
            <button onClick={() => setIncOpen(true)} disabled={priceNum <= 0} title="Incremental Bid" className="le-tap shrink-0 px-3 py-2 text-[12px] font-bold rounded-md border border-line bg-field text-fg-2 enabled:hover:text-fg enabled:hover:border-accent/40 disabled:opacity-40 transition-colors">Inc Bid</button>
          </div>
          {qty > 1 && <div className="text-[10px] text-fg-4">Buying {qty} {stack ? 'stack' : 'single'}{qty === 1 ? '' : 's'} at this price each, one bid at a time.</div>}
          {(qbuy.running || (qbuy.status !== 'idle' && qbuy.itemId === item.id)) && (
            <div className={`rounded-md border px-3 py-2 text-[11px] flex flex-col gap-1.5 ${qbuy.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : qbuy.status === 'buying' ? 'border-line bg-surface text-fg-2' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{qbuy.status === 'done' ? 'Bought' : qbuy.status === 'buying' ? 'Buying' : qbuy.status === 'broke' ? 'Out Of Gil' : 'Stopped'}</span>
                {qbuy.status === 'buying' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                <span className="ml-auto tabular-nums font-bold">{qbuy.bought}/{qbuy.target}{qbuy.failed > 0 ? ` · ${qbuy.failed} failed` : ''}</span>
              </div>
              <div className="h-1 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${qbuy.target > 0 ? Math.round((qbuy.bought / qbuy.target) * 100) : 0}%` }} /></div>
              {qbuy.note && <div className="text-[10px] opacity-90 leading-snug truncate">{qbuy.note}</div>}
              {qbuy.running && <button onClick={stopQtyBuy} className="self-end px-3 py-1 text-[11px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>}
            </div>
          )}
          {priceNum > 0 && bidders.length === 0 && <div className="text-[10px] text-amber-300">{atAh.length === 0 ? 'No character is in a zone with an auction house.' : `No character at an auction house has ${bidCost.toLocaleString()} gil to bid.`}</div>}
        </div>
      </Group>

      {confirming && (
        <Modal onClose={() => setConfirming(false)} panelClass="w-[min(94vw,380px)]">
          {(close) => (
            <div className="p-4 flex flex-col gap-3">
              <div className="text-[14px] font-bold text-fg">Confirm Bid</div>
              <div className="text-[13px] text-fg-2 leading-relaxed">
                Bid <span className="font-extrabold tabular-nums text-amber-300">{priceNum.toLocaleString()} gil</span> on <span className="font-extrabold text-accent">{item.n}</span>{bidderChar ? <> as <span className="font-extrabold text-emerald-300">{anon(bidderChar.name)}</span></> : null}?
              </div>
              {stack && buyQty > 1 && <div className="text-[11px] text-fg-4">{buyQty} stacks · up to <span className="text-fg-2 font-semibold tabular-nums">{(priceNum * buyQty).toLocaleString()} gil</span> total.</div>}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
                <button onClick={() => { onBid(); close(); }} className="le-tap flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Confirm Bid</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {sellOpen && <SellModal item={item} sellers={sellers} initial={sell ?? null} server={server} assets={assets} iconSet={iconSet} onClose={() => setSellOpen(false)} afterList={sell ? onBack : undefined} />}

      {incOpen && <IncBidModal id={item.id} n={item.n} single={stack ? 0 : 1} qty={buyQty} startPrice={priceNum} rare={isRare} assets={assets} onClose={() => setIncOpen(false)} />}

      {market && market.sales.length > 0 && (
        <Group title={`Price History · ${market.sales.length}`}>
          {chartPts.length >= 2 && (
            <div className="px-3.5 pt-3 pb-2 border-b border-line">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Trend</span>
                {trend != null && (
                  <span className={`text-[11px] font-bold tabular-nums ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
                  </span>
                )}
              </div>
              <Sparkline points={chartPts} height={46} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-fg-4 border-b border-line">
                  <th className="px-3.5 py-2 font-bold">Date</th>
                  <th className="px-2 py-2 font-bold">Seller</th>
                  <th className="px-2 py-2 font-bold">Buyer</th>
                  <th className="px-3.5 py-2 font-bold text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {market.sales.map((s, i) => (
                  <tr key={i} className="hover:bg-field/40">
                    <td className="px-3.5 py-1.5 text-fg-4 tabular-nums whitespace-nowrap">{s.date}</td>
                    <td className="px-2 py-1.5 max-w-[120px]"><PlayerName name={s.seller} /></td>
                    <td className="px-2 py-1.5 max-w-[120px]"><PlayerName name={s.buyer} /></td>
                    <td className="px-3.5 py-1.5 text-fg-2 font-semibold tabular-nums text-right whitespace-nowrap">{fmtGil(s.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Group>
      )}

    </div>
  );
}

function WishCombo({ assets, iconSet }: { assets?: string; iconSet: Set<number> }) {
  const cat = useAhCatalog();
  const wish = useWishlist();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const have = useMemo(() => new Set(wish.filter((w) => !w.stack).map((w) => w.id)), [wish]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const pre: AhCatItem[] = [];
    const sub: AhCatItem[] = [];
    let n = 0;
    for (const it of cat.items) {
      if (!itemNameMatches(it.id, it.n, s)) continue;
      (it.n.toLowerCase().startsWith(s) ? pre : sub).push(it);
      if (++n >= 60) break;
    }
    return [...pre, ...sub].slice(0, 10);
  }, [cat.items, q]);
  useEffect(() => { setHi(0); }, [q]);

  const sync = () => { if (inputRef.current) setRect(inputRef.current.getBoundingClientRect()); };
  const show = () => { sync(); setOpen(true); };
  const commit = (it?: AhCatItem) => {
    if (it) addWish({ id: it.id, n: it.n }, it.st > 1);
    setQ(''); setOpen(false);
  };

  const W = rect?.width ?? 240;
  const left = rect?.left ?? 0;
  const top = (rect?.bottom ?? 0) + 4;

  return (
    <div>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); show(); }}
        onFocus={show}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); show(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); commit(matches[hi]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder="Search the auction house to add…"
        className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
      />
      {createPortal(
        <Popover open={open && matches.length > 0} style={{ position: 'fixed', left, top, width: W, zIndex: 80 }} className="rounded-md border border-line bg-popover shadow-2xl max-h-64 overflow-y-auto overscroll-contain">
          {matches.map((it, i) => (
            <button
              key={it.id}
              onMouseDown={(e) => { e.preventDefault(); commit(it); }}
              onMouseEnter={() => setHi(i)}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left transition-colors ${i === hi ? 'bg-field' : 'hover:bg-field'}`}
            >
              <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
                <IconInner id={it.id} size={24} name={it.n} assets={assets} bmpHas={it.id > 0 && iconSet.has(it.id)} />
              </div>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{it.n}</span>
              {have.has(it.id) ? (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-accent">Added</span>
              ) : it.st > 1 ? (
                <span className="shrink-0 text-[10px] text-fg-4">×{it.st}</span>
              ) : null}
            </button>
          ))}
        </Popover>,
        document.body,
      )}
    </div>
  );
}

function WishRow({ w, ac, server, assets, iconSet, onSelect }: { w: WishItem; ac?: number; server?: string; assets?: string; iconSet: Set<number>; onSelect: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(rowRef);
  const market = useRowMarket(w.id, !!w.stack, server, visible);
  const median = market?.median;
  const stockStr = market?.stock;
  const n = stockStr != null && stockStr !== '' ? Number(stockStr) : null;
  const tone = n == null ? '' : n === 0 ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : n <= 3 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  const leaf = acLeaf(ac);
  return (
    <div ref={rowRef} className="flex items-center gap-2 px-3 py-1.5 hover:bg-field transition-colors">
      <button onClick={onSelect} className="min-w-0 flex-1 flex items-center gap-2.5 text-left">
        <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
          <IconInner id={w.id} size={24} name={w.n} assets={assets} bmpHas={w.id > 0 && iconSet.has(w.id)} />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-fg-2 leading-tight">{w.n}</span>
          <span className="block truncate text-[10px] text-fg-4 leading-tight">{leaf ? `${leaf} · ` : ''}{w.stack ? 'Stack' : 'Single'}</span>
        </span>
      </button>
      {visible && market === undefined ? <RowSpinner /> : (
        <>
          {median && <span className="shrink-0 text-[12px] font-bold text-fg tabular-nums">{fmtGilStr(median)}<span className="text-[9px] font-semibold text-fg-4 ml-0.5">G</span></span>}
          {n != null && (
            <span className={`shrink-0 inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-md border tabular-nums leading-none ${tone}`}>
              <span className="text-[12px] font-extrabold">{n}</span>
              <span className="text-[8px] font-bold uppercase tracking-wide opacity-80">listed</span>
            </span>
          )}
        </>
      )}
      <button onClick={() => removeWishEntry(w.id, !!w.stack)} title="Remove from wishlist" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-red-400 hover:bg-line transition-colors">×</button>
    </div>
  );
}

function WishlistPanel({ atah, assets, iconSet, conn, server }: { atah: boolean; assets?: string; iconSet: Set<number>; conn?: number; server?: string }) {
  const wish = useWishlist();
  const cat = useAhCatalog();
  const [sel, setSel] = useState<{ item: AhCatItem; stack: boolean } | null>(null);

  const entryKey = (w: WishItem) => `${w.id}:${w.stack ? 1 : 0}`;
  const resolve = (id: number, n: string): AhCatItem => cat.items.find((i) => i.id === id) ?? { id, n, cat: '', lvl: 0, j: [], st: 1 };

  useEffect(() => {
    if (conn == null || wish.length === 0) return;
    requestIcons(conn, wish.map((w) => w.id));
  }, [wish, conn]);

  if (wish.length === 0 && !sel) {
    return (
      <div className="flex flex-col gap-3">
        <WishCombo assets={assets} iconSet={iconSet} />
        <div className="rounded-lg border border-line bg-surface text-center px-6 py-12">
          <div className="text-[13px] font-bold text-fg mb-1">Your Wishlist Is Empty</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Search above, use the <span className="text-fg-2 font-semibold">Browse</span> tab, or star any inventory item.</div>
        </div>
      </div>
    );
  }

  return (
    <Crossfade id={sel ? `wdetail-${sel.item.id}-${sel.stack ? 1 : 0}` : 'wishlist'}>
      {sel ? (
        <ItemDetail key={`${sel.item.id}-${sel.stack ? 1 : 0}`} item={sel.item} initialStack={sel.stack} onBack={() => setSel(null)} atah={atah} assets={assets} iconSet={iconSet} conn={conn} server={server} />
      ) : (
    <div className="flex flex-col gap-3">
      <WishCombo assets={assets} iconSet={iconSet} />
      <div className="flex items-center">
        <span className="text-[11px] text-fg-4 tabular-nums">{wish.length} item{wish.length === 1 ? '' : 's'} watched</span>
      </div>

      <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
        {wish.map((w) => (
          <WishRow key={entryKey(w)} w={w} ac={resolve(w.id, w.n).ac} server={server} assets={assets} iconSet={iconSet} onSelect={() => setSel({ item: resolve(w.id, w.n), stack: !!w.stack })} />
        ))}
      </div>
      <p className="text-[10px] text-fg-4 leading-snug">Tap an item to see full details and bid.</p>
    </div>
      )}
    </Crossfade>
  );
}

