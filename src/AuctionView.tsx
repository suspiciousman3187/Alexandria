import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useKnownCharacters, useAvailableIcons, useAhMessages, useAhCatalog, requestAhCatalog, requestIcons, useItemDescription,
  ahSlots, ahBuy, ahSell, addPendingListing, ahClearSlot, ahCancel, ffxiahSid, FFXIAH_SID, fetchMarket, openExternal,
  nomadReachable, NOMAD_BAGS,
  type KnownChar, type AhCatItem, type MarketData, type InvItem,
} from './bridge';
import { useSettings, setSettings } from './settings';
import { ALWAYS_BAGS } from './bagConstants';
import { useAhDetailTarget, closeAhDetail, type AhSellContext } from './ahNav';
import { useWishlist, addWish, removeWish, removeWishEntry, type WishItem } from './wishlist';
import { IconInner } from './atlasIcon';
import { useItemHover, RichDescription, WhereOwned } from './ItemTooltip';
import { Select, Segmented, SectionTabs, Group, GilInput, Stepper, SearchInput, BagTag } from './ui';
import { useSticky, useStickyChar } from './sticky';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Crossfade, Modal, Popover, Collapse } from './overlay';
import { useRowMarket } from './rowMarket';
import { fmtGilStr, rateInfo } from './marketFmt';
import { AH_CATEGORY_TREE, AH_CATEGORY_TOP, AH_CATEGORY_PATH } from './ahCategories';
import { useAnon } from './anonymize';

const acLabel = (ac?: number) => (ac && AH_CATEGORY_PATH[ac] ? AH_CATEGORY_PATH[ac].replace(/->/g, ' / ') : '');

function PlayerName({ name }: { name?: string }) {
  if (!name) return <span className="text-fg-4">—</span>;
  return <span className="text-fg-3 truncate max-w-full">{name}</span>;
}


const JOBS = ['WAR', 'MNK', 'WHM', 'BLM', 'RDM', 'THF', 'PLD', 'DRK', 'BST', 'BRD', 'RNG', 'SAM', 'NIN', 'DRG', 'SMN', 'BLU', 'COR', 'PUP', 'DNC', 'SCH', 'GEO', 'RUN'];

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

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Log a character in-game with the Alexandria addon loaded to manage its auction house. The character must be in a zone that has an auction house.</div>
        </div>
      </div>
    );
  }

  const navItem = target
    ? (cat.items.find((i) => i.id === target.id) ?? { id: target.id, n: target.n, cat: target.cat ?? '', lvl: target.lvl ?? 0, j: target.j ?? [], st: target.st, ac: target.ac })
    : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
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
          <div className="shrink-0 w-28">
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
            onClick={() => conn != null && ahSlots(conn)}
            title="Refresh"
            className="shrink-0 grid place-items-center w-9 h-9 rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
          </button>
        </div>

        {!target && <SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'browse', label: 'Browse' }, { id: 'slots', label: 'Listings' }, { id: 'wishlist', label: 'Wishlist' }]} />}

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
        <Crossfade id={target ? `nav-${target.id}` : tab}>{!target && tab === 'slots' ? (
          <ListingsTab char={active} ah={ah} atah={atah} now={now} assets={active?.assets} iconSet={iconSet} conn={conn} server={effServer} />
        ) : !target && tab === 'wishlist' ? (
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
  })() : null;
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
        if (s && !it.n.toLowerCase().includes(s)) continue;
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

function BrowseRow({ it, assets, iconSet, onSelect }: { it: AhCatItem; assets?: string; iconSet: Set<number>; onSelect: () => void }) {
  const wished = useWishlist().some((w) => w.id === it.id);
  return (
    <div className="flex items-center hover:bg-field transition-colors">
      <button onClick={onSelect} className="min-w-0 flex-1 text-left flex items-center gap-2.5 px-3 py-1.5">
        <Icon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{it.n}</span>
        {it.lvl > 0 && <span className="shrink-0 text-[10px] text-fg-4">Lv{it.lvl}</span>}
        <span className="shrink-0 text-[10px] text-fg-4 truncate max-w-[110px]">{acLabel(it.ac) || it.cat}</span>
      </button>
      <button
        onClick={() => (wished ? removeWish(it.id) : addWish({ id: it.id, n: it.n }, it.st > 1))}
        title={wished ? 'On Wishlist' : 'Add to Wishlist'}
        className={`shrink-0 grid place-items-center w-7 h-7 mr-2 rounded-md border transition-colors ${wished ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-4 hover:text-fg-2'}`}
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
      if (s && !it.n.toLowerCase().includes(s)) continue;
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
            : `${results.length.toLocaleString()} Items Found`}
        </span>
      </div>

      <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line max-h-[68vh] overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-fg-4 text-center">No items match.</div>
        ) : results.map((it) => (
          <BrowseRow key={it.id} it={it} assets={assets} iconSet={iconSet} onSelect={() => setSel(it)} />
        ))}
        {results.length > RESULT_CAP && <div className="px-3 py-2 text-[10px] text-fg-4 text-center">Showing first {RESULT_CAP}. Refine your search.</div>}
      </div>
      </div>
      )}
    </Crossfade>
  );
}

function ItemDetail({ item, onBack, backLabel, sell, initialStack, atah, assets, iconSet, conn, server, onGoWishlist }: { item: AhCatItem; onBack: () => void; backLabel?: string; sell?: AhSellContext; initialStack?: boolean; atah: boolean; assets?: string; iconSet: Set<number>; conn?: number; server?: string; onGoWishlist?: () => void }) {
  const anon = useAnon();
  const [stack, setStack] = useState(!!initialStack && item.st > 1);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const market = useRowMarket(item.id, stack, server, true);

  const selling = !!sell;
  const priceNum = Number(price) || 0;
  const buyQty = stack ? qty : 1;
  const canStack = selling ? (item.st > 1 && sell!.count > 1) : item.st > 1;
  const canBid = atah && priceNum > 0 && conn != null;
  const canList = atah && priceNum > 0 && conn != null && selling;
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

  const bazaars = useMemo(
    () => (market?.bazaar ? (server ? market.bazaar.filter((b) => !b.server || b.server.toLowerCase() === server.toLowerCase()) : market.bazaar) : []),
    [market, server],
  );

  const onBid = () => {
    if (!canBid) return;
    ahBuy(conn!, item.id, stack ? 0 : 1, priceNum, buyQty);
  };

  const listQty = stack ? qty : 1;
  const onList = () => {
    if (!canList || !sell || conn == null) return;
    ahSell(conn, item.id, stack ? 0 : 1, priceNum, listQty, sell.fromBag ? sell.bagId : undefined, sell.fromBag ? sell.slot : undefined);
    for (let i = 0; i < listQty; i++) addPendingListing(conn, item.n);
    onBack();
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
        <div className="px-3.5 py-3">
          <WhereOwned id={item.id} collapsible defaultOpen />
        </div>
      </Group>

      <Group title={selling ? 'List For Sale' : 'Pricing'}>
        <div className="px-3.5 py-3 flex flex-col gap-3">
          {selling && sell!.fromBag && <div className="text-[11px] text-fg-4 leading-snug rounded-md border border-line bg-field/50 px-2.5 py-1.5">Held in {anon(sell!.charName)}'s storage. Alexandria moves it to inventory first, then lists it. The bag must be reachable from where you're standing.</div>}
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
            <GilInput value={price} onChange={setPrice} placeholder={selling ? 'List price (gil)' : 'Bid price (gil)'} className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-2 text-[13px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
            {stack && <Stepper value={qty} min={1} max={7} onChange={setQty} title={selling ? 'How many stacks to list' : 'How many stacks to buy'} className="shrink-0 h-9" />}
            {selling
              ? <button onClick={onList} disabled={!canList} className="le-tap px-5 py-2 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">List</button>
              : <button onClick={() => setConfirming(true)} disabled={!canBid} className="le-tap px-5 py-2 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Bid</button>}
          </div>
          {stack && <div className="text-[10px] text-fg-4">{selling ? `Listing ${qty} stack${qty === 1 ? '' : 's'} at this price each.` : `Buying ${qty} stack${qty === 1 ? '' : 's'} at this price each.`}</div>}
          {!atah && <div className="text-[10px] text-amber-300">Be in a zone with an auction house to {selling ? 'list' : 'bid'}.</div>}
        </div>
      </Group>

      {confirming && (
        <Modal onClose={() => setConfirming(false)} panelClass="w-[min(94vw,380px)]">
          {(close) => (
            <div className="p-4 flex flex-col gap-3">
              <div className="text-[14px] font-bold text-fg">Confirm Bid</div>
              <div className="text-[13px] text-fg-2 leading-relaxed">
                Bid <span className="font-extrabold tabular-nums text-amber-300">{priceNum.toLocaleString()} gil</span> on <span className="font-extrabold text-accent">{item.n}</span>?
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

      {market && market.sales.length > 0 && (
        <Group title={`Price History · ${market.sales.length}`}>
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

      {bazaars.length > 0 && (
        <Group title="Bazaar">
          {bazaars.slice(0, 10).map((b, i) => (
            <div key={i} className="flex items-center justify-between px-3.5 py-2 text-[12px]">
              <span className="text-fg-3 truncate">{b.player}{b.quantity > 1 ? ` ×${b.quantity}` : ''}</span>
              <span className="text-fg-2 font-semibold tabular-nums">{fmtGil(b.price)}</span>
            </div>
          ))}
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
      const ln = it.n.toLowerCase();
      if (!ln.includes(s)) continue;
      (ln.startsWith(s) ? pre : sub).push(it);
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

function WishlistPanel({ atah, assets, iconSet, conn, server }: { atah: boolean; assets?: string; iconSet: Set<number>; conn?: number; server?: string }) {
  const wish = useWishlist();
  const cat = useAhCatalog();
  const [sel, setSel] = useState<{ item: AhCatItem; stack: boolean } | null>(null);
  const [marketAll, setMarketAll] = useSticky<Record<string, Record<string, MarketData | null>>>('ah.wishMarket', {});
  const sv = server ?? '';
  const market = marketAll[sv] ?? {};
  const [populating, setPopulating] = useState(false);
  const [progress, setProgress] = useState(0);

  const entryKey = (w: WishItem) => `${w.id}:${w.stack ? 1 : 0}`;
  const resolve = (id: number, n: string): AhCatItem => cat.items.find((i) => i.id === id) ?? { id, n, cat: '', lvl: 0, j: [], st: 1 };

  useEffect(() => {
    if (conn == null || wish.length === 0) return;
    requestIcons(conn, wish.map((w) => w.id));
  }, [wish, conn]);

  const populate = async () => {
    setPopulating(true);
    setProgress(0);
    for (let i = 0; i < wish.length; i++) {
      const w = wish[i];
      const k = entryKey(w);
      try { const d = await fetchMarket(w.id, !!w.stack, server); setMarketAll((all) => ({ ...all, [sv]: { ...(all[sv] ?? {}), [k]: d } })); }
      catch { setMarketAll((all) => ({ ...all, [sv]: { ...(all[sv] ?? {}), [k]: null } })); }
      setProgress(i + 1);
      await new Promise((r) => setTimeout(r, 250));
    }
    setPopulating(false);
  };

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
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fg-4 tabular-nums">{wish.length} item{wish.length === 1 ? '' : 's'} watched</span>
        <button onClick={populate} disabled={populating} className="le-tap ml-auto px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-50 transition-colors">
          {populating ? `Populating ${progress}/${wish.length}…` : 'Populate Prices'}
        </button>
      </div>

      <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
        {wish.map((w) => {
          const k = entryKey(w);
          const d = market[k];
          return (
            <div key={k} className="flex items-center gap-2.5 px-3 py-2 hover:bg-field transition-colors">
              <button onClick={() => setSel({ item: resolve(w.id, w.n), stack: !!w.stack })} className="min-w-0 flex-1 flex items-center gap-2.5 text-left">
                <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
                  <IconInner id={w.id} size={24} name={w.n} assets={assets} bmpHas={w.id > 0 && iconSet.has(w.id)} />
                </div>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{w.n}</span>
                <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${w.stack ? 'bg-accent/15 text-accent' : 'bg-field text-fg-4'}`}>{w.stack ? 'Stack' : 'Single'}</span>
                {d === undefined ? (
                  <span className="shrink-0 text-[10px] text-fg-4">—</span>
                ) : d && d.median ? (
                  <span className="shrink-0 text-right leading-tight">
                    <span className="text-[13px] font-bold text-fg tabular-nums">{fmtGilStr(d.median)}</span>
                    {d.stock && <span className={`block text-[10px] tabular-nums ${Number(d.stock) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtGilStr(d.stock)} in stock</span>}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-fg-4">no data</span>
                )}
              </button>
              <button onClick={() => removeWishEntry(w.id, !!w.stack)} title="Remove from wishlist" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-red-400 hover:bg-line transition-colors">×</button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-fg-4 leading-snug">Populate pulls each item's current FFXIAH price one at a time. Tap an item to see full details and bid.</p>
    </div>
      )}
    </Crossfade>
  );
}

