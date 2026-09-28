import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, moveItem, dropOne, shopSell, useItem, useItemDescription, useAhCatalog, useAcMap, localConsolidate, withinTradeRange, nomadReachable, NOMAD_BAGS, type KnownChar, type InvItem, type SelItem, type OrgStep } from './bridge';
import { localConsolidatePlan, LOCAL_TARGET_BAGS, DEFAULT_LOCAL_TARGETS, type PlanRow } from './localConsolidatePlan';
import { type ReportData, type ReportBlock, type ReportMove } from './OperationReport';
import { runConsolidateSelection, consolidableTotal } from './consolidate';
import { useDrop, setDrop, dropItemEverywhere, countItemEverywhere } from './drop';
import { useWishlist, addWish, removeWish } from './wishlist';
import { useWatchStore, addWatchItem, removeWatchItem } from './watch';
import { useShopSell, setShopSell } from './shop';
import { usePoolStore, setCharRules, emptyRules } from './poolRules';
import { useSettings } from './settings';
import { uiZoom, logicalRect, logicalViewport } from './uiZoom';
import { IconInner } from './atlasIcon';
import { Modal, Collapse } from './overlay';
import { CharacterSelect, Select, Stepper, SearchInput, Button } from './ui';
import { useStickyChar, useSticky, useStickyPersisted } from './sticky';
import { bagColor } from './bagColors';
import { ALWAYS_BAGS, MOG_ONLY_BAGS, TEMPORARY_BAG } from './bagConstants';
import { itemCategory, itemNameMatches, itemStack } from './itemNames';
import { SORTS, tagSorts, sortBy, type SortMode } from './itemSort';
import { AH_CATEGORY_TREE, AH_CATEGORY_TOP, acPathLabel, acLeaf } from './ahCategories';
import { useStoragePrefs, setCharLayout, layoutFor, STORABLE_BAGS } from './storagePrefs';
import { resolveLayout, useTagRules } from './tagRules';
import { useItemTags, bulkSetTag } from './itemTags';
import { useTagFilter, TagFilterSelect } from './tagFilter';
import { useJobFilter, JobFilterSelect } from './jobFilter';
import { useStatFilter, StatFilterSelect } from './statFilter';
import PullButton from './PullMenu';
import { usePorterGear } from './porterGear';
import { BAG_ORDER, bagName, bagIdByName } from './bagNames';
import { useOrganize } from './useOrganize';
import { openDistribute } from './distributeHost';
import { libraryWindowEnter, libraryWindowExit } from './windowSize';
import ConsolidateProgressCard from './ConsolidateProgressCard';
import { useItemValues, getCachedValue } from './priceStore';
import { getMovedAt, initMovedTracker } from './movedTracker';
import { openAhDetail, navToSection } from './ahNav';
import { RichDescription, WhereOwned } from './ItemTooltip';
import { SellDrawer } from './SellDrawer';
import { BazaarPriceModal, type BazaarItem } from './BazaarPriceModal';

const FLAG_RARE = 0x01;
const FLAG_NOTRADE = 0x02; // Ex / No-Trade, cannot trade to other players
const FLAG_NOAUCTION = 0x0A; // No-Trade or No-AH, cannot list on the auction house
const FLAG_NONPC = 0x10; // cannot sell to an NPC vendor
const THRESH = 5;
const ALL = 'All Characters';
const FLASH_MS = 3000; // window after a location change during which a tile flashes (>= lib-flash duration)

// Bag-grid geometry. The card/tile column counts are computed from these in JS (see the
// paneRef measure effect) instead of being left to CSS auto-fill, which derives the count
// from each card's fractional stretched width and so wobbles by a column right on a tile
// boundary (a scrollbar settling or the window finishing a resize flips 5<->4).
const OUTER_GAP = 10;   // outer bag-card grid gap (gap-2.5)
const TILE_GAP = 3;     // inner tile grid gap (gap-[3px])
const CARD_PAD = 16;    // inner tile grid padding (p-2, both sides)
const CARD_BORDER = 2;  // bag card border (1px both sides)
const PANE_PAD = 24;    // scroll pane padding (p-3, both sides)


// A move "beam": a gentle curved path from a source bag to a destination bag,
// with sample points for the comet to ride and a dash length for the draw-on.
type Beam = { key: string; id: number; path: string; pts: { x: number; y: number }[]; dash: number };
function beamGeom(from: { x: number; y: number }, to: { x: number; y: number }): Omit<Beam, 'key' | 'id'> {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(72, len * 0.16); // perpendicular bow of the arc
  const cx = (from.x + to.x) / 2 - (dy / len) * off, cy = (from.y + to.y) / 2 + (dx / len) * off;
  const bez = (t: number) => { const u = 1 - t; return { x: u * u * from.x + 2 * u * t * cx + t * t * to.x, y: u * u * from.y + 2 * u * t * cy + t * t * to.y }; };
  return { path: `M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}`, pts: [0, 0.25, 0.5, 0.75, 1].map(bez), dash: Math.round(len * 1.3) };
}
const STORABLE_SET = new Set(STORABLE_BAGS.map((b) => b.id));

const reachable = (bagId: number, char: KnownChar | undefined, exp = false): boolean =>
  ALWAYS_BAGS.has(bagId) || (MOG_ONLY_BAGS.has(bagId) && (!!char?.mog || (NOMAD_BAGS.has(bagId) && nomadReachable(char, exp))));

// Sorting (options + logic) is shared with Inventory via ./itemSort so both views match.

// Full gil amount with thousands separators, e.g. 6000000 -> "6,000,000".
const fmtGil = (n: number) => Math.round(n).toLocaleString();

type FilterKey = 'rare' | 'ex' | 'aug' | 'equip' | 'sellable';
const FILTER_CHIPS: { k: FilterKey; label: string; title: string }[] = [
  { k: 'rare', label: 'Rare', title: 'Rare items' },
  { k: 'ex', label: 'Ex', title: 'Exclusive / No-Trade items' },
  { k: 'aug', label: 'Augmented', title: 'Items with augments' },
  { k: 'equip', label: 'Equippable', title: 'Wearable gear' },
  { k: 'sellable', label: 'AH Sellable', title: 'Can be listed on the auction house' },
];
type Filt = { rare: boolean; ex: boolean; aug: boolean; equip: boolean; sellable: boolean; worth: boolean; cat: boolean; minWorth: number };

type Drag = { id: number; n: string; c: number; s: number; f?: number; u?: number; bz?: number; from: number; char: string; conn: number };
const keyOf = (charName: string, bag: number, slot: number) => `${charName}|${bag}:${slot}`;
const parseKey = (k: string) => { const i = k.indexOf('|'); const [b, s] = k.slice(i + 1).split(':').map(Number); return { char: k.slice(0, i), bag: b, slot: s }; };
const WARDROBES = new Set([8, 10, 11, 12, 13, 14, 15, 16]);
const isEquippable = (id: number) => itemCategory(id) !== 'other';
// Shared item filter predicate so the grid and Select All narrow identically.
const passesFilt = (it: InvItem, filt: Filt, catMatch?: Set<number> | null, medianOf?: Map<number, number>, tagMatches?: ((id: number) => boolean) | null, jobMatches?: ((id: number) => boolean) | null, statMatches?: ((id: number) => boolean) | null) => {
  const f = it.f ?? 0;
  if (filt.rare && !(f & 0x01)) return false;
  if (filt.ex && !(f & 0x02)) return false;
  if (filt.aug && !(it.aug && it.aug.length)) return false;
  if (filt.equip && !isEquippable(it.id)) return false;
  if (filt.sellable && (f & 0x08)) return false;
  if (filt.worth && (medianOf?.get(it.id) ?? 0) < filt.minWorth) return false;
  if (catMatch && !catMatch.has(it.id)) return false;
  if (tagMatches && !tagMatches(it.id)) return false;
  if (jobMatches && !jobMatches(it.id)) return false;
  if (statMatches && !statMatches(it.id)) return false;
  return true;
};
const bagOf = (ch: KnownChar | undefined, bagId: number) => ch?.inv?.find((b) => b.id === bagId);

function flagBadges(f?: number): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  if (!f) return out;
  if (f & 0x01) out.push({ label: 'Rare', cls: 'text-amber-200 border-amber-500/40 bg-amber-500/10' });
  if (f & 0x02) out.push({ label: 'Ex', cls: 'text-rose-200 border-rose-500/40 bg-rose-500/10' });
  if (f & 0x08) out.push({ label: 'No AH', cls: 'text-fg-3 border-line bg-field' });
  if (f & 0x20) out.push({ label: 'No Delivery', cls: 'text-fg-3 border-line bg-field' });
  return out;
}

// Instant themed hover tooltip. A single element driven by a tiny store, so hovering
// tiles never re-renders the grid; this component is the only subscriber.
type TipMeta = { id: number; n: string; c: number; f?: number; aug?: string[]; bz?: number; fleet?: number };
let tipState: { meta: TipMeta; rect: DOMRect } | null = null;
let tipSuppressed = false;
const tipSubs = new Set<() => void>();
const setTip = (meta: TipMeta, rect: DOMRect) => { if (tipSuppressed) return; tipState = { meta, rect }; tipSubs.forEach((f) => f()); };
const clearTip = () => { if (tipState) { tipState = null; tipSubs.forEach((f) => f()); } };
const suppressTip = (on: boolean) => { tipSuppressed = on; if (on) clearTip(); };

function LibraryTip({ assets, iconSet, server }: { assets?: string; iconSet: Set<number>; server?: string }) {
  const st = useSyncExternalStore((cb) => { tipSubs.add(cb); return () => tipSubs.delete(cb); }, () => tipState, () => tipState);
  const desc = useItemDescription(st?.meta.id ?? 0);
  const ahCat = useAhCatalog();
  if (!st) return null;
  const { meta } = st;
  const W = 256;
  // Position in the tooltip's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws it off-screen;
  // see uiZoom.ts. No-op at 100%.
  const rect = logicalRect(st.rect);
  const vp = logicalViewport();
  let left = rect.left - 4;
  if (left + W > vp.w) left = vp.w - W - 6;
  if (left < 6) left = 6;
  const below = rect.bottom + 240 < vp.h;
  const top = below ? rect.bottom + 6 : Math.max(6, rect.top - 6);
  const maxH = Math.max(200, below ? vp.h - top - 8 : rect.top - 12);
  const badges = flagBadges(meta.f);
  const ahItem = ahCat.items.find((i) => i.id === meta.id);
  const gear = ahItem && (ahItem.lvl > 0 || (ahItem.j && ahItem.j.length > 0));
  const val = server ? getCachedValue(server, meta.id) : undefined;
  return createPortal(
    <motion.div
      className="fixed z-[9998] pointer-events-none rounded-md border border-line-2 bg-popover shadow-2xl p-2.5 w-[256px] overflow-hidden flex flex-col"
      style={{ left, top, maxHeight: maxH, transform: below ? undefined : 'translateY(-100%)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }}
    >
      <div className="flex items-start gap-2 shrink-0">
        <div className="shrink-0 w-9 h-9 rounded bg-field grid place-items-center overflow-hidden">
          <IconInner id={meta.id} size={32} name={meta.n} assets={assets} bmpHas={meta.id > 0 && iconSet.has(meta.id)} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-fg leading-tight">{meta.n}</div>
          <div className="text-[10px] text-fg-4 tabular-nums">#{meta.id}{meta.c > 1 ? ` · ×${meta.c}` : ''}</div>
          {gear && <div className="text-[10px] font-semibold text-sky-300/90 mt-0.5 truncate">Lv{ahItem!.lvl}{ahItem!.il ? ` · IL${ahItem!.il}` : ''}{ahItem!.j && ahItem!.j.length ? ` · ${ahItem!.j.join(' ')}` : ''}</div>}
          {ahItem?.ac ? <div className="text-[10px] text-fg-3 mt-0.5 truncate" title="Auction house category"><span className="text-fg-4">AH:</span> {acPathLabel(ahItem.ac)}</div> : null}
        </div>
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5 shrink-0">
          {badges.map((b) => <span key={b.label} className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide border ${b.cls}`}>{b.label}</span>)}
        </div>
      )}
      {val && val.median ? (
        <div className="mt-1.5 shrink-0 flex items-baseline gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1">
          <span className="text-[14px] font-extrabold text-amber-300 tabular-nums leading-none">{fmtGil(val.median)}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300/70">gil</span>
          {val.stock ? <span className="ml-auto text-[10px] font-semibold text-fg-4">{val.stock} listed</span> : null}
        </div>
      ) : null}
      {meta.bz != null && (
        <div className="mt-1.5 shrink-0 flex items-baseline gap-1.5 rounded border border-yellow-400/50 bg-yellow-400/10 px-2 py-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-yellow-300">On Bazaar</span>
          <span className="ml-auto text-[13px] font-extrabold text-yellow-200 tabular-nums leading-none">{fmtGil(meta.bz)}<span className="text-[9px] font-bold uppercase tracking-wide text-yellow-300/70"> gil</span></span>
        </div>
      )}
      {desc && (
        <div className="mt-2 pt-2 border-t border-line max-h-[132px] overflow-hidden shrink-0">
          <RichDescription text={desc} className="text-[10.5px] leading-relaxed flex flex-col gap-0.5" />
        </div>
      )}
      {meta.aug && meta.aug.length > 0 && (
        <div className="mt-2 pt-2 border-t border-line shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-wide text-violet-300 mb-1">Augments</div>
          <RichDescription text={meta.aug.join('\n')} className="text-[10.5px] leading-relaxed flex flex-col gap-0.5" />
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-line min-h-0 overflow-hidden">
        <WhereOwned id={meta.id} collapsible={false} />
      </div>
    </motion.div>,
    document.body,
  );
}

function Tile({ item, dataKey, tile, assets, iconSet, selected, dim, hit, homeCls, misplaced, transit, flash, fleet, onDown, onContext, onDouble }: {
  item: InvItem; dataKey: string; tile: number; assets?: string; iconSet: Set<number>; selected: boolean; dim?: boolean; hit?: boolean; homeCls?: string; misplaced?: boolean; transit?: boolean; flash?: boolean; fleet?: number;
  onDown: (e: React.PointerEvent, item: InvItem) => void;
  onContext: (e: React.MouseEvent, item: InvItem) => void;
  onDouble: (item: InvItem) => void;
}) {
  const rare = !!(item.f && (item.f & FLAG_RARE));
  return (
    <div
      data-tile
      data-key={dataKey}
      onPointerDown={(e) => { clearTip(); onDown(e, item); }}
      onDoubleClick={() => onDouble(item)}
      onContextMenu={(e) => { clearTip(); onContext(e, item); }}
      onMouseEnter={(e) => setTip({ id: item.id, n: item.n, c: item.c, f: item.f, aug: item.aug, bz: item.bz, fleet }, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={clearTip}
      style={{ width: tile, height: tile, contentVisibility: 'auto', containIntrinsicSize: `${tile}px ${tile}px` }}
      className={`relative rounded-md bg-field grid place-items-center overflow-hidden cursor-grab select-none touch-none transition-all ${transit ? 'animate-pulse' : flash ? 'lib-flash-glow' : ''} ${transit ? 'opacity-50 ring-1 ring-accent/50 z-[1]' : dim ? 'opacity-20' : selected ? 'ring-2 ring-accent z-[1]' : hit ? 'ring-2 ring-amber-300 z-[1]' : misplaced ? 'ring-1 ring-orange-400/70' : 'hover:ring-1 hover:ring-line-2'}`}
    >
      {homeCls && <span title="Has an assigned preset bag" className={`absolute inset-x-0 bottom-0 h-[3px] z-[1] ${homeCls}`} />}
      {item.bz != null && <span className="absolute inset-y-0 left-0 w-[3px] bg-amber-400 z-[2] pointer-events-none" />}
      <IconInner id={item.id} size={tile} name={item.n} assets={assets} bmpHas={item.id > 0 && iconSet.has(item.id)} />
      {item.c > 1 && <span className="absolute right-0 bottom-0 px-0.5 text-[9px] font-extrabold tabular-nums text-white [text-shadow:0_1px_1px_#000] pointer-events-none">{item.c}</span>}
      {rare && <span className="absolute left-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 shadow-[0_0_3px] shadow-amber-300 pointer-events-none" />}
      {item.aug && item.aug.length > 0 && <span className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-sky-300 pointer-events-none" />}
      {misplaced && <span className="absolute left-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 pointer-events-none" />}
      {flash && <span className="lib-flash-wash pointer-events-none absolute inset-0 rounded-md z-[4]" />}
    </div>
  );
}

const EMPTY_HOME: Map<string, number[]> = new Map();

const BagCard = memo(function BagCard({ charName, bag, name, items, max, used, reach, isDrop, receiving, sel, query, homeBags, misplacedOnly, filt, catMatch, tagMatches, jobMatches, statMatches, medianOf, pending, tile, tileCols, assets, iconSet, fleetTotals, onDown, onContext, onDouble }: {
  charName: string; bag: number; name: string; items: InvItem[]; max: number; used: number; reach: boolean; isDrop: boolean; receiving?: boolean; sel: Set<string>; query: string; homeBags: Map<string, number[]>; misplacedOnly: boolean;
  filt: Filt; catMatch?: Set<number> | null; tagMatches?: ((id: number) => boolean) | null; jobMatches?: ((id: number) => boolean) | null; statMatches?: ((id: number) => boolean) | null; medianOf?: Map<number, number>; pending?: Set<string>; tile: number; tileCols?: number;
  assets?: string; iconSet: Set<number>; fleetTotals?: Map<number, number>;
  onDown: (e: React.PointerEvent, item: InvItem, from: number, charName: string) => void;
  onContext: (e: React.MouseEvent, item: InvItem, from: number, charName: string) => void;
  onDouble: (item: InvItem, from: number, charName: string) => void;
}) {
  const c = bagColor(bag);
  const now = Date.now();
  const homeOf = (n: string) => homeBags.get(n.toLowerCase());
  const anyFilter = filt.rare || filt.ex || filt.aug || filt.equip || filt.sellable || filt.worth || filt.cat || !!tagMatches || !!jobMatches || !!statMatches;
  // When searching, render ONLY the matching tiles (do not render every tile and
  // dim non-matches) so a 5000-item fleet stays responsive per keystroke.
  const passed = (misplacedOnly ? items.filter((it) => { const h = homeOf(it.n); return h && h.length && !h.includes(bag); }) : items).filter((it) => passesFilt(it, filt, catMatch, medianOf, tagMatches, jobMatches, statMatches));
  const shown = query ? passed.filter((it) => itemNameMatches(it.id, it.n, query)) : passed;
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  const full = !!max && used / max >= 0.95;
  return (
    <div
      data-bag={bag}
      data-char={charName}
      className={`rounded-xl border bg-surface overflow-hidden flex flex-col transition-all ${isDrop ? 'border-accent bg-accent/5' : receiving ? 'border-accent/60 ring-2 ring-accent/40' : 'border-line'} ${reach ? '' : 'opacity-55'}`}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line bg-surface-raised">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
        <span className={`text-[11px] font-bold truncate ${c.text}`}>{name}</span>
        {reach
          ? <span className={`ml-auto text-[10px] tabular-nums ${full ? 'text-orange-300 font-bold' : 'text-fg-4'}`}>{query ? <><span className={shown.length > 0 ? 'text-amber-300 font-bold' : 'text-fg-4/50'}>{shown.length}</span>/{items.length}</> : anyFilter || misplacedOnly ? <><span className={shown.length > 0 ? 'text-accent font-bold' : 'text-fg-4/50'}>{shown.length}</span>/{items.length}</> : `${used}/${max}`}</span>
          : <span className="ml-auto text-[9px] font-semibold text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5">Mog House</span>}
      </div>
      <div className="h-[3px] bg-field shrink-0"><div className={`h-full ${full ? 'bg-orange-400' : c.dot}`} style={{ width: `${pct}%` }} /></div>
      <div className="grid gap-[3px] p-2 content-start" style={{ gridTemplateColumns: tileCols ? `repeat(${tileCols}, ${tile}px)` : `repeat(auto-fill, ${tile}px)` }}>
        {shown.map((it) => {
            const h = homeOf(it.n);
            return <Tile key={it.s} item={it} dataKey={keyOf(charName, bag, it.s)} tile={tile} assets={assets} iconSet={iconSet} selected={sel.has(keyOf(charName, bag, it.s))}
              homeCls={h && h.length ? bagColor(h[0]).dot : undefined} misplaced={!!(h && h.length && !h.includes(bag))} transit={pending?.has(keyOf(charName, bag, it.s))} flash={now - getMovedAt(charName, bag, it.s, it.id) < FLASH_MS} fleet={fleetTotals?.get(it.id)}
              onDown={(e, item) => onDown(e, item, bag, charName)} onContext={(e, item) => onContext(e, item, bag, charName)} onDouble={(item) => onDouble(item, bag, charName)} />;
          })}
      </div>
    </div>
  );
});

// One button vocabulary for the whole filter/action row so it reads as a single,
// consistent control strip. Defined at module scope (NOT inside the component) so
// it is a stable component type; an inline definition remounts every button on each
// render and drops clicks that straddle a re-render (the Library re-renders often as
// inventory streams in).
// Thin toggle-aware wrapper over the canonical <Button>: `on` renders the active (accent) look; `v`
// picks the base variant. Kept local only so call sites stay terse (<Btn on v="primary">).
function Btn({ on, v = 'default', onClick, title, disabled, children }: { on?: boolean; v?: 'default' | 'primary' | 'danger'; onClick: () => void; title?: string; disabled?: boolean; children: React.ReactNode }) {
  return <Button variant={v === 'default' ? 'secondary' : v} active={on} size="sm" className="shrink-0" onClick={onClick} title={title} disabled={disabled}>{children}</Button>;
}

export default function LibraryView() {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const prefs = useStoragePrefs();
  const tagRules = useTagRules();
  const tagStore = useItemTags();
  const tf = useTagFilter('library.tagfilter');
  const sortOpts = useMemo(() => [...SORTS, ...tagSorts(tf.tags)], [tf.tags]);
  const tagMatches = tf.matches;
  const jf = useJobFilter('library.jobfilter');
  const jobMatches = jf.matches;
  const sf = useStatFilter('library.statfilter');
  const statMatches = sf.matches;
  const drop = useDrop();
  const wishlist = useWishlist();
  const watch = useWatchStore();
  const sellCfg = useShopSell();
  const poolStore = usePoolStore();
  const settings = useSettings();
  const experimental = settings.experimentalFeatures;
  const [pick, setPick] = useStickyChar();
  const [sort, setSort] = useStickyPersisted<SortMode>('library.sort', 'slot');
  const [misplacedOnly, setMisplacedOnly] = useSticky<boolean>('library.misplaced', false);
  const [compact, setCompact] = useSticky<boolean>('library.compact', false);
  const [tipSeen, setTipSeen] = useSticky<boolean>('library.tipseen', false);
  const [catTop, setCatTop] = useSticky<string>('library.cattop', 'all');
  const [catSub, setCatSub] = useSticky<number>('library.catsub', 0);
  const tile = compact ? 26 : 34;
  const cardMin = compact ? 188 : 236;
  const [filters, setFilters] = useSticky<FilterKey[]>('library.filters', []);
  const [minWorth, setMinWorth] = useSticky<number>('library.minworth', 0);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  // Concurrent rendering: defer the heavy grid work so a spinner can show instead
  // of the main thread freezing. Search uses a deferred value; the (much heavier)
  // switch to All Characters runs inside a transition. `viewBusy` drives the loader.
  const dQuery = useDeferredValue(query);
  const [isPending, startTransition] = useTransition();
  const viewBusy = isPending || query !== dQuery;
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [over, setOver] = useState<{ char: string; bag: number } | null>(null);
  const [dragN, setDragN] = useState(0);
  const [beams, setBeams] = useState<Beam[]>([]);
  const beamId = useRef(0);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [receiving, setReceiving] = useState<{ char: string; bag: number } | null>(null);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [split, setSplit] = useState<{ id: number; n: string; from: number; to: number; count: number; max: number; slot: number; conn: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: Drag[] } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  // Keep the right-click menu fully inside the window: measure its real height and clamp
  // so its bottom/right never spill past the pane (a webview menu can't overflow the OS
  // window, so a tall menu near the bottom edge otherwise gets cut off).
  useLayoutEffect(() => {
    if (!menu) { setMenuPos(null); return; }
    const el = menuRef.current;
    if (!el) return;
    const m = 8;
    // menu.x/y are visual (zoomed) cursor px; offsetWidth/Height are local. Map the cursor + viewport into the
    // menu's own local space so a uiScale > 1 never throws it off-screen; see uiZoom.ts. No-op at 100%.
    const z = uiZoom();
    const vp = logicalViewport();
    const w = el.offsetWidth || 240, h = el.offsetHeight || 0;
    setMenuPos({
      left: Math.max(m, Math.min(menu.x / z, vp.w - w - m)),
      top: Math.max(m, Math.min(menu.y / z, vp.h - h - m)),
    });
  }, [menu]);
  const [confirm, setConfirm] = useState<{ kind: 'drop' | 'sell' | 'dropall'; items: Drag[]; count: number } | null>(null);
  const [consoOpen, setConsoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [porterOpen, setPorterOpen] = useState(false);
  const [consoTargets, setConsoTargets] = useSticky<number[]>('library.consoTargets', DEFAULT_LOCAL_TARGETS);
  const [consoRun, setConsoRun] = useState<{ chars: string[]; initial: Record<string, number>; startedAt: number } | null>(null);
  const [sellDrawer, setSellDrawer] = useState<{ char: KnownChar; items: SelItem[] } | null>(null);
  const [bazaar, setBazaar] = useState<{ conn: number; items: BazaarItem[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hist, setHist] = useState<{ conn: number; label: string; moves: { id: number; from: number; to: number; count: number }[] }[]>([]);
  const searchWrap = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<{ cards: number; tiles: number } | null>(null);
  const hasF = (k: FilterKey) => filters.includes(k);
  const toggleF = (k: FilterKey) => setFilters(filters.includes(k) ? filters.filter((x) => x !== k) : [...filters, k]);

  useEffect(() => {
    initMovedTracker();
    void libraryWindowEnter();
    document.documentElement.dataset.library = '1';
    return () => { void libraryWindowExit(); delete document.documentElement.dataset.library; };
  }, []);

  // Deterministic bag-card and item-tile column counts, measured off the scroll pane's settled
  // content width (clientWidth excludes the scrollbar) rather than left to CSS auto-fill. Only
  // re-renders when a count actually changes, so it can't wobble a column between renders.
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth - PANE_PAD;
      if (W <= 0) return;
      const cards = Math.max(1, Math.floor((W + OUTER_GAP) / (cardMin + OUTER_GAP)));
      const cardW = (W - (cards - 1) * OUTER_GAP) / cards;
      const tiles = Math.max(1, Math.floor((cardW - CARD_PAD - CARD_BORDER + TILE_GAP) / (tile + TILE_GAP)));
      setCols((prev) => (prev && prev.cards === cards && prev.tiles === tiles ? prev : { cards, tiles }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardMin, tile]);

  const online = useMemo(() => known.filter((k) => k.online && k.conn != null && k.inv), [known]);
  const isAll = pick === ALL && online.length >= 2;
  const single = useMemo(() => (isAll ? undefined : (known.find((k) => k.name === pick) ?? online[0] ?? known[0])), [isAll, known, online, pick]);
  const viewChars = useMemo(() => (isAll ? online : (single ? [single] : [])), [isAll, online, single]);
  const org = useOrganize(viewChars, { grouped: isAll });
  const porterGear = usePorterGear(single); // Store / Retrieve current-job gear from the Porter slips
  useEffect(() => { if (!isAll && single && single.name !== pick) setPick(single.name); }, [isAll, single, pick, setPick]);

  const charByName = (n: string) => known.find((k) => k.name === n);
  // NPC vendor sell needs the experimental "sell in towns" setting on AND the
  // character actually in a town (mirrors InventoryView's sellOk gate).
  const canNpcSell = (name: string) => experimental && sellCfg.anywhere && !!charByName(name)?.inTown;
  const tipAssets = viewChars[0]?.assets;

  const homeBagMaps = useMemo(() => {
    const m = new Map<string, Map<string, number[]>>();
    for (const ch of viewChars) {
      const hm = new Map<string, number[]>();
      for (const e of resolveLayout(ch)) if (e.bags.length) hm.set(e.item.toLowerCase(), e.bags);
      m.set(ch.name, hm);
    }
    return m;
  }, [viewChars, prefs, tagRules, tagStore]);
  const hasHomes = useMemo(() => viewChars.some((ch) => resolveLayout(ch).length > 0), [viewChars, prefs, tagRules, tagStore]);

  const fleetTotals = useMemo(() => {
    const m = new Map<number, number>();
    if (!isAll) return m;
    for (const ch of viewChars) for (const b of ch.inv ?? []) for (const it of b.items) m.set(it.id, (m.get(it.id) ?? 0) + it.c);
    return m;
  }, [isAll, viewChars]);

  const filt: Filt = useMemo(() => ({ rare: hasF('rare'), ex: hasF('ex'), aug: hasF('aug'), equip: hasF('equip'), sellable: hasF('sellable'), worth: minWorth > 0 && !!settings.ahServer, cat: catTop !== 'all', minWorth }), [filters, minWorth, settings.ahServer, catTop]);
  const anyFilter = filters.length > 0 || minWorth > 0 || catTop !== 'all' || tf.active || jf.active || sf.active;

  // AH-category filter: match items whose bundled auction-house category (via
  // useAcMap) falls under the chosen top group, optionally narrowed to one sub.
  const acMap = useAcMap();
  const catGroup = useMemo(() => AH_CATEGORY_TREE.find((g) => g.top === catTop), [catTop]);
  const catMatch = useMemo(() => {
    if (catTop === 'all') return null;
    const ids = new Set<number>();
    for (const [id, ac] of acMap) { if (catSub ? ac === catSub : AH_CATEGORY_TOP[ac] === catTop) ids.add(id); }
    return ids;
  }, [catTop, catSub, acMap]);
  const wantValues = filt.worth;

  // Worth value filter needs one flat id fetch.
  const valueIds = useMemo(() => {
    if (!wantValues || !settings.ahServer) return [];
    const s = new Set<number>();
    for (const ch of viewChars) for (const b of ch.inv ?? []) for (const it of b.items) if (it.id > 0) s.add(it.id);
    return [...s];
  }, [wantValues, settings.ahServer, viewChars]);
  const values = useItemValues(settings.ahServer, valueIds, false);
  const medianOf = useMemo(() => {
    if (!filt.worth) return undefined;
    const m = new Map<number, number>();
    values.forEach((v, id) => { if (v.median) m.set(id, v.median); });
    return m;
  }, [values, filt.worth]);

  const totalItems = useMemo(() => viewChars.reduce((s, ch) => s + (ch.inv ?? []).reduce((n, b) => n + b.items.length, 0), 0), [viewChars]);
  const matchInfo = useMemo(() => {
    if (!dQuery) return null;
    let items = 0; const bagKeys = new Set<string>();
    for (const ch of viewChars) for (const b of ch.inv ?? []) {
      let n = 0;
      for (const it of b.items) if (itemNameMatches(it.id, it.n, dQuery)) n++;
      if (n > 0) { items += n; bagKeys.add(ch.name + b.id); }
    }
    return { items, bagsN: bagKeys.size };
  }, [viewChars, dQuery]);

  // Per character, which bags hold matching items (and how many). Built whenever ANY narrowing
  // is active -- a text search, a filter chip, or Misplaced -- so filter-only views collapse
  // empty bags and drop characters with nothing matching, exactly like search already does. Null
  // when nothing is narrowing, meaning "show every bag and character". (Also keeps the grid fast:
  // only matching bags/characters render instead of every bag with dimmed tiles.)
  const searchMap = useMemo(() => {
    if (!dQuery && !anyFilter && !misplacedOnly) return null;
    const m = new Map<string, { bags: Set<number>; count: number }>();
    for (const ch of viewChars) {
      const homes = misplacedOnly ? (homeBagMaps.get(ch.name) ?? EMPTY_HOME) : null;
      const bagSet = new Set<number>(); let count = 0;
      for (const b of ch.inv ?? []) {
        for (const it of b.items) {
          if (dQuery && !itemNameMatches(it.id, it.n, dQuery)) continue;
          if (!passesFilt(it, filt, catMatch, medianOf, tagMatches, jobMatches, statMatches)) continue;
          if (homes) { const h = homes.get(it.n.toLowerCase()); if (!(h && h.length && !h.includes(b.id))) continue; }
          bagSet.add(b.id); count++;
        }
      }
      if (count) m.set(ch.name, { bags: bagSet, count });
    }
    return m;
  }, [dQuery, anyFilter, misplacedOnly, viewChars, filt, catMatch, medianOf, homeBagMaps, tagMatches, jobMatches, statMatches]);
  // The characters left to show once the visibility map has dropped the empty ones.
  const shownChars = useMemo(() => (searchMap ? viewChars.filter((ch) => searchMap.has(ch.name)) : viewChars), [searchMap, viewChars]);

  // The Organize preview is a real dry-run from the addon (`runOrganizePreview`
  // fills each character's `orgPreview` feed), so it reflects EVERY move Organize
  // will make (storage rules + presets), not just preset routing. Grouped by
  // character, mirroring the Consolidate modal.


  const drag = useRef<{ items: Drag[]; sx: number; sy: number; started: boolean; clickKey: string; canDrag: boolean } | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const overRef = useRef<{ char: string; bag: number } | null>(null);
  const lastClick = useRef<{ char: string; bag: number; slot: number } | null>(null);
  const animatedSteps = useRef<Set<string>>(new Set());
  const orgBaselined = useRef<Set<string>>(new Set());
  const lastPlanRef = useRef<Map<string, OrgStep[]>>(new Map());
  const consoPrevIds = useRef<Map<string, Set<number>>>(new Map());
  const consoRows = useRef<Map<string, Map<number, PlanRow>>>(new Map());
  const consoSnapshot = useRef<Map<string, PlanRow[]>>(new Map());

  const keyToItem = (k: string): Drag | null => {
    const { char: cn, bag: b, slot: s } = parseKey(k);
    const ch = charByName(cn);
    const it = bagOf(ch, b)?.items.find((x) => x.s === s);
    return it && ch && ch.conn != null ? { id: it.id, n: it.n, c: it.c, s: it.s, f: it.f, u: it.u, bz: it.bz, from: b, char: cn, conn: ch.conn } : null;
  };
  const keyToSel = (k: string): SelItem | null => {
    const { char: cn, bag: b, slot: s } = parseKey(k);
    const it = bagOf(charByName(cn), b)?.items.find((x) => x.s === s);
    return it ? { ...it, bag: b } : null;
  };

  // Undo history for intra-character moves only (trades/drops/sells are committed in-game).
  const pushHist = (conn: number, label: string, moves: { id: number; from: number; to: number; count: number }[]) => {
    if (!moves.length) return;
    setHist((h) => [...h.slice(-24), { conn, label, moves }]);
  };
  const undo = () => {
    if (!hist.length) return;
    const b = hist[hist.length - 1];
    for (const m of b.moves) moveItem(b.conn, m.id, m.to, m.from, m.count);
    setHist(hist.slice(0, -1));
    setBusy(`Undid ${b.label}`);
    window.setTimeout(() => setBusy(null), 3000);
  };

  const canDrop = (destBag: number, destChar: string, items: Drag[]): boolean => {
    const src = items[0]?.char;
    if (!src) return false;
    const destCh = charByName(destChar);
    if (!destCh) return false;
    if (destChar === src) {
      if (!destCh.online || destCh.conn == null) return false;
      if (!reachable(destBag, destCh, experimental)) return false;
      const incoming = items.filter((it) => it.from !== destBag);
      if (!incoming.length) return false;
      if (WARDROBES.has(destBag) && incoming.some((it) => !isEquippable(it.id))) return false;
      const db = bagOf(destCh, destBag);
      return !!db && db.max - db.used >= incoming.length;
    }
    const srcCh = charByName(src);
    if (!srcCh || srcCh.mog || destCh.mog || !destCh.online || destCh.conn == null) return false;
    if (!withinTradeRange(srcCh, destCh)) return false;
    const tradable = items.filter((it) => !((it.f ?? 0) & FLAG_NOTRADE)); // No-Trade items can't be traded to players
    if (!tradable.length) return false;
    const inv0 = bagOf(destCh, 0);
    return !!inv0 && inv0.max - inv0.used >= tradable.length;
  };

  // A point near the top-center of a rendered bag card, used as a beam endpoint.
  const bagCenter = (charName: string, bagId: number): { x: number; y: number } | null => {
    const el = document.querySelector(`[data-char="${charName}"][data-bag="${bagId}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 90), y: r.top + Math.min(r.height / 2, 44) };
  };
  const mkBeam = (from: { x: number; y: number }, to: { x: number; y: number }, id: number): Beam => ({ key: `bm${beamId.current++}`, id, ...beamGeom(from, to) });
  const addBeam = (from: { x: number; y: number } | null, to: { x: number; y: number } | null, id: number) => {
    if (!from || !to) return;
    setBeams((b) => [...b, mkBeam(from, to, id)].slice(-48));
  };

  // Smooth the inherent move latency: draw a beam from each source bag into the
  // destination bag with the item riding along it, mark the source tiles as
  // in-transit, and glow the target bag until the game confirms.
  const animateMove = (dest: { char: string; bag: number }, items: Drag[], _dropX: number, _dropY: number) => {
    const destC = bagCenter(dest.char, dest.bag);
    for (const src of new Set(items.filter((it) => !(it.char === dest.char && it.from === dest.bag)).map((it) => `${it.char}|${it.from}`))) {
      const [cn, b] = src.split('|');
      addBeam(bagCenter(cn, Number(b)), destC, items[0].id);
    }
    const keys = items.filter((it) => !(it.char === dest.char && it.from === dest.bag)).map((it) => keyOf(it.char, it.from, it.s));
    if (keys.length) {
      setPending((p) => { const n = new Set(p); keys.forEach((k) => n.add(k)); return n; });
      window.setTimeout(() => setPending((p) => { const n = new Set(p); keys.forEach((k) => n.delete(k)); return n; }), 1400);
    }
    setReceiving({ char: dest.char, bag: dest.bag });
    window.setTimeout(() => setReceiving((r0) => (r0 && r0.char === dest.char && r0.bag === dest.bag ? null : r0)), 1100);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (!d.started) {
      if (Math.abs(e.clientX - d.sx) < THRESH && Math.abs(e.clientY - d.sy) < THRESH) return;
      if (!d.canDrag) return;
      d.started = true; suppressTip(true); setDragN(d.items.length);
    }
    if (ghost.current) ghost.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 8}px)`;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const card = el?.closest('[data-bag]') as HTMLElement | null;
    const bag = card ? Number(card.getAttribute('data-bag')) : null;
    const cn = card ? card.getAttribute('data-char') : null;
    const cur = overRef.current;
    if (bag !== (cur?.bag ?? null) || cn !== (cur?.char ?? null)) {
      overRef.current = (bag != null && cn) ? { char: cn, bag } : null;
      setOver(overRef.current && canDrop(overRef.current.bag, overRef.current.char, d.items) ? overRef.current : null);
    }
  };
  const onUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    suppressTip(false);
    const d = drag.current; drag.current = null;
    const dest = overRef.current; overRef.current = null;
    setOver(null);
    if (!d) return;
    if (!d.started) {
      const { char: cc, bag: cb, slot: cs } = parseKey(d.clickKey);
      if (e.shiftKey && lastClick.current && lastClick.current.char === cc && lastClick.current.bag === cb) {
        const lo = Math.min(lastClick.current.slot, cs), hi = Math.max(lastClick.current.slot, cs);
        const items = bagOf(charByName(cc), cb)?.items ?? [];
        setSel((prev) => { const n = new Set(prev); for (const it of items) if (it.s >= lo && it.s <= hi) n.add(keyOf(cc, cb, it.s)); return n; });
      } else {
        setSel((prev) => { const n = new Set(prev); n.has(d.clickKey) ? n.delete(d.clickKey) : n.add(d.clickKey); return n; });
        lastClick.current = { char: cc, bag: cb, slot: cs };
      }
      return;
    }
    setDragN(0);
    if (!dest || !canDrop(dest.bag, dest.char, d.items)) return;
    const src = d.items[0].char;
    if (dest.char === src && e.shiftKey && d.items.length === 1 && d.items[0].c > 1) {
      const it = d.items[0];
      setSplit({ id: it.id, n: it.n, from: it.from, to: dest.bag, count: it.c, max: it.c, slot: it.s, conn: d.items[0].conn });
      return;
    }
    animateMove(dest, d.items, e.clientX, e.clientY);
    if (dest.char === src) {
      const conn = d.items[0].conn;
      const moved = d.items.filter((it) => it.from !== dest.bag && it.bz == null);
      for (const it of moved) moveItem(conn, it.id, it.from, dest.bag, it.c, it.s);
      pushHist(conn, moved.length === 1 ? moved[0].n : `${moved.length} items`, moved.map((it) => ({ id: it.id, from: it.from, to: dest.bag, count: it.c })));
    } else {
      const bySender: Record<string, Record<number, number>> = { [src]: {} };
      for (const it of d.items) if (!((it.f ?? 0) & FLAG_NOTRADE) && it.bz == null) bySender[src][it.id] = (bySender[src][it.id] ?? 0) + it.c;
      void runConsolidateSelection(dest.char, bySender, experimental);
    }
    setSel(new Set());
  };
  const onDown = (e: React.PointerEvent, item: InvItem, from: number, charName: string) => {
    const ch = charByName(charName);
    if (e.button !== 0 || !ch?.online || ch.conn == null) return;
    const key = keyOf(charName, from, item.s);
    const single1: Drag = { id: item.id, n: item.n, c: item.c, s: item.s, f: item.f, u: item.u, bz: item.bz, from, char: charName, conn: ch.conn };
    const items = sel.has(key) ? [...sel].map(keyToItem).filter((x): x is Drag => !!x && x.char === charName) : [single1];
    drag.current = { items: items.length ? items : [single1], sx: e.clientX, sy: e.clientY, started: false, clickKey: key, canDrag: reachable(from, ch, experimental) && item.bz == null };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onContext = (e: React.MouseEvent, item: InvItem, from: number, charName: string) => {
    e.preventDefault();
    const key = keyOf(charName, from, item.s);
    const ch = charByName(charName);
    const single1: Drag = { id: item.id, n: item.n, c: item.c, s: item.s, f: item.f, u: item.u, bz: item.bz, from, char: charName, conn: ch?.conn ?? -1 };
    const items = sel.has(key) ? [...sel].map(keyToItem).filter((x): x is Drag => !!x && x.char === charName) : [single1];
    setMenu({ x: e.clientX, y: e.clientY, items: items.length ? items : [single1] });
  };
  const onDouble = (item: InvItem, from: number, charName: string) => {
    const ch = charByName(charName);
    if (!ch?.online || ch.conn == null || from === 0 || !reachable(from, ch, experimental)) return;
    const inv0 = bagOf(ch, 0);
    if (!inv0 || inv0.max - inv0.used < 1) return;
    moveItem(ch.conn, item.id, from, 0, item.c, item.s);
    pushHist(ch.conn, item.n, [{ id: item.id, from, to: 0, count: item.c }]);
    addBeam(bagCenter(charName, from), bagCenter(charName, 0), item.id);
  };

  const onContainerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-tile]') || t.closest('button') || t.closest('input')) return;
    const start = { x: e.clientX, y: e.clientY };
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? new Set(sel) : new Set<string>();
    let moved = false; let raf = 0;
    const move = (ev: PointerEvent) => {
      const l = Math.min(start.x, ev.clientX), tp = Math.min(start.y, ev.clientY), r = Math.max(start.x, ev.clientX), b = Math.max(start.y, ev.clientY);
      setBoxRect({ x0: l, y0: tp, x1: r, y1: b });
      if (!moved && Math.abs(ev.clientX - start.x) < 4 && Math.abs(ev.clientY - start.y) < 4) return;
      moved = true;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const hits = new Set(base);
        document.querySelectorAll('[data-tile]').forEach((el) => {
          const q2 = el.getBoundingClientRect();
          if (q2.right >= l && q2.left <= r && q2.bottom >= tp && q2.top <= b) { const k = el.getAttribute('data-key'); if (k) hits.add(k); }
        });
        setSel(hits);
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      setBoxRect(null);
      // A plain click on empty space (no drag) clears the current selection.
      if (!moved && !additive) setSel(new Set());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const menuChar = menu ? menu.items[0].char : '';
  const menuConn = menu ? menu.items[0].conn : -1;
  const doMoveTo = (to: number) => {
    if (!menu || menuConn < 0) return;
    const moved = menu.items.filter((it) => it.from !== to && it.bz == null);
    for (const it of moved) moveItem(menuConn, it.id, it.from, to, it.c, it.s);
    pushHist(menuConn, moved.length === 1 ? moved[0].n : `${moved.length} items`, moved.map((it) => ({ id: it.id, from: it.from, to, count: it.c })));
    if (moved.length) { const destC = bagCenter(menuChar, to); for (const b of new Set(moved.map((it) => it.from))) addBeam(bagCenter(menuChar, b), destC, moved[0].id); }
    setMenu(null); setSel(new Set());
  };
  const doSendTo = (destName: string) => {
    if (!menu) return;
    const bySender: Record<string, Record<number, number>> = { [menuChar]: {} };
    for (const it of menu.items) if (!((it.f ?? 0) & FLAG_NOTRADE) && it.bz == null) bySender[menuChar][it.id] = (bySender[menuChar][it.id] ?? 0) + it.c;
    void runConsolidateSelection(destName, bySender, experimental);
    setMenu(null); setSel(new Set());
  };
  const doGather = () => {
    if (!menu) return;
    const id = menu.items[0].id;
    const dst = charByName(menuChar);
    const bySender: Record<string, Record<number, number>> = {};
    for (const k of online) {
      if (k.name === menuChar || k.mog) continue;
      if (!dst || !withinTradeRange(k, dst)) continue;
      const want = consolidableTotal(k, id, experimental);
      if (want > 0) bySender[k.name] = { [id]: want };
    }
    if (Object.keys(bySender).length) void runConsolidateSelection(menuChar, bySender, experimental);
    setMenu(null); setSel(new Set());
  };
  // Gather every item sharing the anchor item's AH category (e.g. all Smithing
  // materials) from the other characters onto the menu character.
  const doGatherCat = () => {
    if (!menu) return;
    const ac = acMap.get(menu.items[0].id);
    const dst = charByName(menuChar);
    if (!ac || !dst) return;
    const bySender: Record<string, Record<number, number>> = {};
    for (const k of online) {
      if (k.name === menuChar || k.mog || !withinTradeRange(k, dst)) continue;
      const ids = new Set<number>();
      for (const b of k.inv ?? []) for (const it of b.items) if (acMap.get(it.id) === ac) ids.add(it.id);
      const row: Record<number, number> = {};
      for (const id of ids) { const want = consolidableTotal(k, id, experimental); if (want > 0) row[id] = want; }
      if (Object.keys(row).length) bySender[k.name] = row;
    }
    if (Object.keys(bySender).length) void runConsolidateSelection(menuChar, bySender, experimental);
    setMenu(null); setSel(new Set());
  };
  const doSetHome = (to: number | null) => {
    if (!menu) return;
    const names = [...new Set(menu.items.map((it) => it.n))];
    const kept = layoutFor(menuChar).filter((e) => !names.some((n) => n.toLowerCase() === e.item.toLowerCase()));
    setCharLayout(menuChar, to == null ? kept : [...kept, ...names.map((n) => ({ item: n, bags: [to] }))]);
    setMenu(null);
  };
  const doLookup = () => {
    if (!menu) return;
    const it = menu.items[0];
    openAhDetail({ id: it.id, n: it.n, st: itemStack(it.id), back: 'library' });
    setMenu(null);
  };
  const doListAh = () => {
    if (!menu) return;
    const ch = charByName(menuChar);
    if (!ch || !(ch.atah ?? ch.ah?.atah)) { setMenu(null); return; } // must be in a zone with an auction house
    const items = menu.items.map((it) => keyToSel(keyOf(it.char, it.from, it.s))).filter((x): x is SelItem => !!x && !((x.f ?? 0) & FLAG_NOAUCTION) && !(x.aug && x.aug.length));
    setMenu(null);
    if (items.length) setSellDrawer({ char: ch, items });
  };
  const doBazaar = () => {
    if (!menu) return;
    // Bazaar sells from inventory (bag 0); Ex/No-Trade items can't be bazaared.
    const its = menu.items.filter((it) => it.from === 0 && !((it.f ?? 0) & 0x02));
    setMenu(null);
    const conn = its[0]?.conn ?? -1;
    if (!its.length || conn < 0) return;
    setBazaar({ conn, items: its.map((it) => ({ id: it.id, n: it.n, c: it.c, s: it.s, bz: it.bz })) });
  };
  const doUse = () => {
    if (!menu) return;
    const it = menu.items[0];
    if (it.conn >= 0) useItem(it.conn, it.id, false, it.from, it.s);
    setMenu(null); setSel(new Set());
  };
  const doDeliver = () => {
    if (!menu) return;
    setPick(menuChar);
    navToSection('delivery');
    setMenu(null);
  };
  // "Add to <list>" actions, mirroring the Inventory view. Single item toggles; a
  // multi-selection adds every item. Watch/Lot are per-character (the menu's char).
  const menuNames = () => (menu ? [...new Set(menu.items.map((it) => it.n))] : []);
  const menuSingle = () => (menu && menu.items.length === 1 ? menu.items[0] : null);
  const doDistribute = () => {
    if (!menu) return;
    const seen = new Set<number>();
    const its: { id: number; n: string }[] = [];
    for (const it of menu.items) { if (((it.f ?? 0) & FLAG_NOTRADE) || seen.has(it.id)) continue; seen.add(it.id); its.push({ id: it.id, n: it.n }); }
    if (its.length) openDistribute(menuChar, its);
    setMenu(null);
  };
  const toggleDropList = () => {
    const one = menuSingle();
    if (one && drop.drop.some((n) => n.toLowerCase() === one.n.toLowerCase())) setDrop({ ...drop, drop: drop.drop.filter((n) => n.toLowerCase() !== one.n.toLowerCase()) });
    else setDrop({ ...drop, drop: [...drop.drop, ...menuNames().filter((n) => !drop.drop.some((d) => d.toLowerCase() === n.toLowerCase()))] });
    setMenu(null);
  };
  const toggleSellList = () => {
    const one = menuSingle();
    if (one && sellCfg.items.some((n) => n.toLowerCase() === one.n.toLowerCase())) setShopSell({ ...sellCfg, items: sellCfg.items.filter((n) => n.toLowerCase() !== one.n.toLowerCase()) });
    else setShopSell({ ...sellCfg, items: [...sellCfg.items, ...menuNames().filter((n) => !sellCfg.items.some((d) => d.toLowerCase() === n.toLowerCase()))] });
    setMenu(null);
  };
  const toggleWishList = () => {
    if (!menu) return;
    const one = menuSingle();
    if (one && wishlist.some((w) => w.id === one.id)) removeWish(one.id);
    else for (const it of menu.items) if (!((it.f ?? 0) & 0x08) && !wishlist.some((w) => w.id === it.id)) addWish({ id: it.id, n: it.n }, itemStack(it.id) > 1);
    setMenu(null);
  };
  const toggleWatchList = () => {
    if (!menu) return;
    const one = menuSingle();
    const items = watch[menuChar]?.items ?? [];
    if (one && items.some((i) => i.id === one.id)) removeWatchItem(menuChar, one.id);
    else { const seen = new Set<number>(); for (const it of menu.items) { if (seen.has(it.id) || items.some((i) => i.id === it.id)) continue; seen.add(it.id); addWatchItem(menuChar, { id: it.id, name: it.n }, 1); } }
    setMenu(null);
  };
  // Lot and Pass are opposite decisions, and the addon lets Lot win when an item is in
  // both lists, so adding to one clears it from the other.
  const toggleLotList = () => {
    const one = menuSingle();
    const r = poolStore[menuChar] ?? emptyRules();
    if (one && r.lot.some((n) => n.toLowerCase() === one.n.toLowerCase())) {
      setCharRules(menuChar, { ...r, lot: r.lot.filter((n) => n.toLowerCase() !== one.n.toLowerCase()) });
    } else {
      const lcs = new Set(menuNames().map((n) => n.toLowerCase()));
      const lot = [...r.lot];
      for (const n of menuNames()) if (!lot.some((l) => l.toLowerCase() === n.toLowerCase())) lot.push(n);
      setCharRules(menuChar, { ...r, lot, pass: r.pass.filter((p) => !lcs.has(p.toLowerCase())) });
    }
    setMenu(null);
  };
  const togglePassList = () => {
    const one = menuSingle();
    const r = poolStore[menuChar] ?? emptyRules();
    if (one && r.pass.some((n) => n.toLowerCase() === one.n.toLowerCase())) {
      setCharRules(menuChar, { ...r, pass: r.pass.filter((n) => n.toLowerCase() !== one.n.toLowerCase()) });
    } else {
      const lcs = new Set(menuNames().map((n) => n.toLowerCase()));
      const pass = [...r.pass];
      for (const n of menuNames()) if (!pass.some((p) => p.toLowerCase() === n.toLowerCase())) pass.push(n);
      setCharRules(menuChar, { ...r, pass, lot: r.lot.filter((l) => !lcs.has(l.toLowerCase())) });
    }
    setMenu(null);
  };
  const execDrop = (items: Drag[]) => { for (const it of items) if (it.conn >= 0) dropOne(it.conn, it.s, it.id, it.from, it.c); setSel(new Set()); };
  const execSell = (items: Drag[], count: number) => {
    const ok = items.filter((it) => it.conn >= 0 && !((it.f ?? 0) & FLAG_NONPC));
    if (ok.length === 1) { const it = ok[0]; shopSell(it.conn, it.id, Math.max(1, Math.min(count || it.c, it.c)), it.from, it.s); }
    else for (const it of ok) shopSell(it.conn, it.id, it.c, it.from, it.s);
    setSel(new Set());
  };
  const doDrop = () => { if (!menu) return; const items = menu.items; setMenu(null); if (drop.skipDropConfirm) execDrop(items); else setConfirm({ kind: 'drop', items, count: 0 }); };
  // Drop Everywhere: drop each distinct item in the menu from every connected character.
  const execDropEverywhere = (items: Drag[]) => { for (const id of new Set(items.map((it) => it.id))) dropItemEverywhere(id, experimental); setSel(new Set()); };
  const doDropEverywhere = () => { if (!menu) return; const items = menu.items; setMenu(null); setConfirm({ kind: 'dropall', items, count: 0 }); };
  const doSell = () => { if (!menu || !canNpcSell(menuChar)) return; const items = menu.items.filter((it) => !((it.f ?? 0) & FLAG_NONPC)); setMenu(null); if (!items.length) return; if (settings.skipSellConfirm) execSell(items, items.length === 1 ? items[0].c : 0); else setConfirm({ kind: 'sell', items, count: items[0].c }); };
  const dropSelected = () => {
    const items = [...sel].map(keyToItem).filter((x): x is Drag => !!x);
    if (!items.length) return;
    if (drop.skipDropConfirm) execDrop(items); else setConfirm({ kind: 'drop', items, count: 0 });
  };


  // Select All honors the active filters, category, misplaced-only, and search,
  // so "filter to a category, then select all and send" works as expected.
  const selectAll = () => {
    const all = new Set<string>();
    for (const ch of viewChars) {
      const homes = misplacedOnly ? (homeBagMaps.get(ch.name) ?? EMPTY_HOME) : null;
      for (const b of ch.inv ?? []) {
        if (!reachable(b.id, ch, experimental)) continue;
        for (const it of b.items) {
          if (!passesFilt(it, filt, catMatch, medianOf, tagMatches, jobMatches, statMatches)) continue;
          if (homes) { const h = homes.get(it.n.toLowerCase()); if (!(h && h.length && !h.includes(b.id))) continue; }
          if (query && !itemNameMatches(it.id, it.n, query)) continue;
          all.add(keyOf(ch.name, b.id, it.s));
        }
      }
    }
    setSel(all);
  };

  useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }, []);
  useEffect(() => { setSel(new Set()); setMenu(null); setHist([]); setBeams([]); setConsoRun(null); setConsoOpen(false); org.reset(); lastClick.current = null; }, [pick]);

  // Fly each organize move from its source bag to its destination as it completes,
  // so the routing is visible. Baselines already-done steps when opening mid-run,
  // and resets per character when a fresh plan arrives.
  const orgSig = viewChars.map((c) => `${c.name}:${c.orgPlan?.length ?? 0}:${c.orgOk?.length ?? 0}:${c.org?.active ? 1 : 0}`).join('|');
  useEffect(() => {
    const add: Beam[] = [];
    for (const ch of viewChars) {
      const plan = ch.orgPlan;
      if (!plan) continue;
      if (lastPlanRef.current.get(ch.name) !== plan) {
        lastPlanRef.current.set(ch.name, plan);
        orgBaselined.current.delete(ch.name);
        for (const k of [...animatedSteps.current]) if (k.startsWith(ch.name + '|')) animatedSteps.current.delete(k);
      }
      const baselined = orgBaselined.current.has(ch.name);
      for (const i of ch.orgOk ?? []) {
        const key = `${ch.name}|${i}`;
        if (animatedSteps.current.has(key)) continue;
        animatedSteps.current.add(key);
        if (!baselined) continue;
        const step = plan.find((s) => s.i === i);
        if (!step) continue;
        const fromId = bagIdByName(ch, step.from), toId = bagIdByName(ch, step.to);
        if (fromId == null || toId == null || fromId === toId) continue;
        const fromEl = document.querySelector(`[data-char="${ch.name}"][data-bag="${fromId}"]`) as HTMLElement | null;
        const toEl = document.querySelector(`[data-char="${ch.name}"][data-bag="${toId}"]`) as HTMLElement | null;
        if (!fromEl || !toEl) continue;
        const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
        add.push(mkBeam({ x: fr.left + Math.min(fr.width / 2, 44), y: fr.top + 26 }, { x: tr.left + Math.min(tr.width / 2, 44), y: tr.top + 26 }, step.id));
      }
      orgBaselined.current.add(ch.name);
    }
    if (add.length) setBeams((f) => [...f, ...add].slice(-40));
  }, [orgSig]);

  const buildConsoBlock = (name: string, rows: PlanRow[]): ReportBlock | null => {
    const ch = charByName(name);
    const moves: ReportMove[] = [];
    for (const r of rows) for (const f of r.from) moves.push({ id: r.id, n: r.n, c: f.count, from: f.bag, to: r.homeBag, fromId: bagIdByName(ch, f.bag) ?? -1, toId: r.homeBagId });
    return moves.length ? { name, assets: ch?.assets, moves, skipped: [] } : null;
  };


  // Local Consolidate: merge each character's split stacks into the target bags.
  // Progress is derived from the plan shrinking; each merged item flies from its
  // source bag to its home bag, mirroring the organize visualization.
  const consoLive = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    if (!consoRun) return m;
    const ts = new Set(consoTargets);
    for (const name of consoRun.chars) { const ch = charByName(name); if (ch) m.set(name, localConsolidatePlan(ch, ts)); }
    return m;
  }, [consoRun, consoTargets, known]);
  const consoSig = consoRun ? consoRun.chars.map((n) => `${n}:${(consoLive.get(n) ?? []).map((r) => r.id).sort((a, b) => a - b).join(',')}`).join('|') : '';
  useEffect(() => {
    if (!consoRun) return;
    const add: Beam[] = [];
    for (const name of consoRun.chars) {
      const ch = charByName(name); if (!ch) continue;
      const live = consoLive.get(name) ?? [];
      const curIds = new Set(live.map((r) => r.id));
      const prev = consoPrevIds.current.get(name);
      const rowsMap = consoRows.current.get(name);
      if (prev && rowsMap) {
        for (const id of prev) {
          if (curIds.has(id)) continue;
          const row = rowsMap.get(id); if (!row) continue;
          const toEl = document.querySelector(`[data-char="${name}"][data-bag="${row.homeBagId}"]`) as HTMLElement | null;
          if (!toEl) continue;
          const tr = toEl.getBoundingClientRect();
          const to = { x: tr.left + Math.min(tr.width / 2, 44), y: tr.top + 26 };
          for (const f of row.from) {
            const fromId = bagIdByName(ch, f.bag);
            if (fromId == null || fromId === row.homeBagId) continue;
            const fromEl = document.querySelector(`[data-char="${name}"][data-bag="${fromId}"]`) as HTMLElement | null;
            if (!fromEl) continue;
            const fr = fromEl.getBoundingClientRect();
            add.push(mkBeam({ x: fr.left + Math.min(fr.width / 2, 44), y: fr.top + 26 }, to, id));
          }
        }
      }
      consoPrevIds.current.set(name, curIds);
      const nm = new Map<number, PlanRow>(); for (const r of live) nm.set(r.id, r); consoRows.current.set(name, nm);
    }
    if (add.length) setBeams((f) => [...f, ...add].slice(-60));
    // Complete once every character has either fully merged (0) or made progress (fewer
    // rows than it started with) AND the plans then stop changing for a beat. This is a
    // stabilization debounce: a leftover/unmergeable row on one character can't block it,
    // and staggered per-character finishes are handled (the timer resets while any merges).
    const allProgressed = consoRun.chars.every((n) => { const cur = consoLive.get(n)?.length ?? 0; return cur === 0 || cur < (consoRun!.initial[n] ?? 0); });
    if (allProgressed) {
      const chars = consoRun.chars;
      const t = window.setTimeout(() => {
        const blocks: ReportBlock[] = [];
        for (const name of chars) { const b = buildConsoBlock(name, consoSnapshot.current.get(name) ?? []); if (b) blocks.push(b); }
        setConsoRun(null);
        if (blocks.length) { const r: ReportData = { kind: 'consolidate', blocks }; org.showReport(r); }
        setBusy('Consolidate complete.'); window.setTimeout(() => setBusy(null), 3000);
      }, 1400);
      return () => window.clearTimeout(t);
    }
  }, [consoSig]);

  const runConso = () => {
    const ts = new Set(consoTargets);
    const targets = viewChars.filter((ch) => ch.online && ch.conn != null && localConsolidatePlan(ch, ts).length > 0);
    if (!targets.length) { setConsoOpen(false); return; }
    const initial: Record<string, number> = {};
    consoSnapshot.current = new Map();
    for (const ch of targets) { const rows = localConsolidatePlan(ch, ts); consoPrevIds.current.delete(ch.name); consoRows.current.delete(ch.name); consoSnapshot.current.set(ch.name, rows); initial[ch.name] = rows.length; }
    const startedAt = Date.now();
    setConsoRun({ chars: targets.map((c) => c.name), initial, startedAt });
    setConsoOpen(false);
    targets.forEach((ch, i) => window.setTimeout(() => { if (ch.conn != null) localConsolidate(ch.conn, consoTargets); }, i * 300));
    window.setTimeout(() => setConsoRun((r) => (r && r.startedAt === startedAt ? null : r)), targets.length * 300 + 25000);
  };
  const consoPrep = useMemo(() => {
    if (!consoOpen) return [] as { char: KnownChar; rows: PlanRow[] }[];
    const ts = new Set(consoTargets);
    return viewChars.filter((ch) => ch.online && ch.conn != null).map((ch) => ({ char: ch, rows: localConsolidatePlan(ch, ts) })).filter((p) => p.rows.length > 0);
  }, [consoOpen, consoTargets, viewChars]);
  const toggleConsoTarget = (id: number) => setConsoTargets(consoTargets.includes(id) ? (consoTargets.length > 1 ? consoTargets.filter((x) => x !== id) : consoTargets) : [...consoTargets, id]);
  useEffect(() => {
    const focusSearch = () => searchWrap.current?.querySelector('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); return; }
      if (inField) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (e.key === 'Delete' && sel.size > 0) { e.preventDefault(); dropSelected(); return; }
      // The Modal primitive owns Escape for the dialogs (animated close); bail so we
      // don't race it or clear the selection underneath an open dialog.
      if (e.key === 'Escape') { if (org.previewOpen || org.reportOpen || consoOpen || confirm || split) return; if (moreOpen) setMoreOpen(false); else if (menu) setMenu(null); else setSel(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, viewChars, menu, org.previewOpen, org.reportOpen, consoOpen, confirm, split, moreOpen, hist, drop.skipDropConfirm]);

  const pickChars = useMemo(() => {
    const list = [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)).map((k) => ({ name: k.name, online: k.online }));
    return online.length >= 2 ? [{ name: ALL, online: true }, ...list] : list;
  }, [known, online]);

  if (known.length === 0) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-[14px] font-bold text-fg mb-1">No Characters Yet</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Library shows every bag of a character at once so you can drag items between them.</div>
        </div>
      </div>
    );
  }

  const ghostItems = drag.current?.items ?? [];
  const sendTargets = menu ? online.filter((k) => k.name !== menuChar && !k.mog && (() => { const s = charByName(menuChar); return s && withinTradeRange(s, k); })()) : [];
  const gatherN = menu && isAll ? online.reduce((n, k) => { if (k.name === menuChar || k.mog) return n; const d = charByName(menuChar); return n + (d && withinTradeRange(k, d) ? consolidableTotal(k, menu.items[0].id, experimental) : 0); }, 0) : 0;
  const gatherCatAc = menu ? (acMap.get(menu.items[0].id) ?? 0) : 0;
  const gatherCatN = (menu && isAll && gatherCatAc) ? online.reduce((n, k) => {
    if (k.name === menuChar || k.mog) return n;
    const d = charByName(menuChar); if (!d || !withinTradeRange(k, d)) return n;
    const ids = new Set<number>();
    for (const b of k.inv ?? []) for (const it of b.items) if (acMap.get(it.id) === gatherCatAc) ids.add(it.id);
    let c = 0; for (const id of ids) c += consolidableTotal(k, id, experimental);
    return n + c;
  }, 0) : 0;
  const menuOne = menu && menu.items.length === 1 ? menu.items[0] : null;
  const menuOnline = menu ? !!charByName(menuChar)?.online : false;
  const menuAtah = menu ? (() => { const c = charByName(menuChar); return !!(c?.atah ?? c?.ah?.atah); })() : false;
  const bzElig = menu ? menu.items.filter((it) => it.from === 0 && !((it.f ?? 0) & 0x02)) : [];
  const inDropL = !!menuOne && drop.drop.some((n) => n.toLowerCase() === menuOne.n.toLowerCase());
  const inSellL = !!menuOne && sellCfg.items.some((n) => n.toLowerCase() === menuOne.n.toLowerCase());
  const inWishL = !!menuOne && wishlist.some((w) => w.id === menuOne.id);
  const inWatchL = !!menuOne && (watch[menuChar]?.items ?? []).some((i) => i.id === menuOne.id);
  const inLotL = !!menuOne && (poolStore[menuChar]?.lot ?? []).some((n) => n.toLowerCase() === menuOne.n.toLowerCase());
  const inPassL = !!menuOne && (poolStore[menuChar]?.pass ?? []).some((n) => n.toLowerCase() === menuOne.n.toLowerCase());
  const wishOk = !!menu && menu.items.some((it) => !((it.f ?? 0) & 0x08));
  const chipCls = (on: boolean) => `px-2 py-0.5 rounded text-[10px] border transition-colors ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line text-fg-3 hover:border-accent hover:text-accent'}`;
  const moreItem = 'le-tap w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-fg-2 hover:bg-field transition-colors text-left';

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 p-3 border-b border-line">
        <div className="flex-1 min-w-[46%] sm:flex-none sm:w-44"><CharacterSelect value={isAll ? ALL : (single?.name ?? '')} onChange={(v) => startTransition(() => setPick(v))} chars={pickChars} /></div>
        <div className="flex-1 min-w-[46%] sm:flex-none sm:w-40"><Select full value={sort} onChange={(v) => setSort(v as SortMode)} options={sortOpts.map((s) => s.id)} renderOption={(v) => sortOpts.find((s) => s.id === v)?.label ?? v} renderValue={(v) => <span className="flex items-center gap-1.5"><svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h12" /><path d="M3 12h9" /><path d="M3 18h6" /><path d="m17 8 4 4-4 4" /></svg><span className="truncate">{sortOpts.find((s) => s.id === v)?.label ?? 'Sort'}</span></span>} /></div>
        <div ref={searchWrap} className="flex-1 min-w-[160px]"><SearchInput value={q} onChange={setQ} placeholder="Find by name or stat…  (Ctrl+F)" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" /></div>
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-field text-[11px] tabular-nums">
          {viewBusy && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent animate-spin shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>}
          {dQuery
            ? (matchInfo && matchInfo.items > 0
                ? <><span className="font-bold text-amber-300">{matchInfo.items}</span><span className="text-fg-4">in {matchInfo.bagsN} bag{matchInfo.bagsN === 1 ? '' : 's'}</span></>
                : <span className="text-fg-4">no matches</span>)
            : <><span className="font-bold text-fg-2">{totalItems}</span><span className="text-fg-4">items</span>{isAll ? <><span className="text-fg-4/60">·</span><span className="font-bold text-fg-2">{viewChars.length}</span><span className="text-fg-4">chars</span></> : null}</>}
        </div>
        <Btn on={compact} onClick={() => setCompact(!compact)} title="Compact bags: smaller tiles, more bags on screen">Compact</Btn>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-y-2 gap-x-1.5 px-3 py-2 border-b border-line">
        <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4 mr-0.5 shrink-0">Filter</span>
        {FILTER_CHIPS.map((f) => (
          <Btn key={f.k} on={hasF(f.k)} onClick={() => toggleF(f.k)} title={f.title}>{f.label}</Btn>
        ))}
        <div className="w-32 shrink-0" title="Filter by auction-house category"><Select full value={catTop} onChange={(v) => { setCatTop(v); setCatSub(0); }} options={['all', ...AH_CATEGORY_TREE.map((g) => g.top)]} renderValue={(v) => (v === 'all' ? 'AH Category' : v)} renderOption={(v) => (v === 'all' ? 'All AH Categories' : v)} /></div>
        {tf.tags.length > 0 && <div className="w-28 shrink-0" title="Filter by tag"><TagFilterSelect value={tf.value} onChange={tf.setValue} tags={tf.tags} /></div>}
        <div className="w-24 shrink-0" title="Filter by job"><JobFilterSelect value={jf.value} onChange={jf.setValue} /></div>
        <div className="w-64 shrink-0" title="Filter by equipment stat (e.g. Fast Cast)"><StatFilterSelect value={sf.value} onChange={sf.setValue} /></div>
        {catGroup && catGroup.subs.length > 1 && <div className="w-36 shrink-0"><Select full value={String(catSub)} onChange={(v) => setCatSub(Number(v))} options={['0', ...catGroup.subs.map((s) => String(s.id))]} renderValue={(v) => (v === '0' ? 'All' : (catGroup.subs.find((s) => String(s.id) === v)?.label ?? v))} renderOption={(v) => (v === '0' ? `All ${catTop}` : (catGroup.subs.find((s) => String(s.id) === v)?.label ?? v))} /></div>}
        <div className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${minWorth > 0 ? 'border-accent bg-accent/15' : 'border-line bg-field hover:border-line-2 focus-within:border-accent/50'}`}>
          <span className={minWorth > 0 ? 'text-accent' : 'text-fg-4'}>Worth &gt;</span>
          <input type="text" inputMode="numeric" value={minWorth ? minWorth.toLocaleString() : ''} onChange={(e) => setMinWorth(Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))} placeholder="0" className={`w-14 bg-transparent outline-none tabular-nums text-right placeholder-fg-4/60 ${minWorth > 0 ? 'text-accent' : 'text-fg-2'}`} />
          <span className={minWorth > 0 ? 'text-accent/70' : 'text-fg-4'}>g</span>
        </div>
        {hasHomes && <Btn on={misplacedOnly} onClick={() => setMisplacedOnly(!misplacedOnly)} title="Show only items not in their assigned preset bag">Misplaced</Btn>}
        {anyFilter && <Btn v="danger" onClick={() => { setFilters([]); setMinWorth(0); setCatTop('all'); setCatSub(0); tf.setValue('all'); jf.setValue('all'); sf.setValue(''); }} title="Clear all filters">Clear</Btn>}
        {!settings.ahServer && minWorth > 0 && <span className="shrink-0 text-[10px] text-amber-300 ml-0.5">needs an AH server</span>}
        {catTop !== 'all' && acMap.size === 0 && <span className="shrink-0 text-[10px] text-amber-300 ml-0.5">category data not loaded</span>}
        <div className="flex items-center gap-1.5 flex-wrap basis-full justify-start sm:basis-auto sm:ml-auto sm:justify-end">
        {busy && <span className="shrink-0 text-[11px] font-semibold text-accent mr-0.5">{busy}</span>}
        {(hist.length > 0 || (org.lastReport && !org.reportOpen)) && (
          <div className="relative shrink-0">
            <Btn on={moreOpen} onClick={() => setMoreOpen((o) => !o)} title="More actions"><svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg></Btn>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-[70]" onPointerDown={() => setMoreOpen(false)} />
                <motion.div className="absolute right-0 top-full mt-1 z-[71] min-w-[186px] rounded-md border border-line bg-surface-raised shadow-xl py-1 overflow-hidden" style={{ transformOrigin: 'top right' }} initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                  {hist.length > 0 && <button className={moreItem} onClick={() => { undo(); setMoreOpen(false); }}><svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>Undo Last Move{hist.length > 1 ? ` (${hist.length})` : ''}</button>}
                  {org.lastReport && !org.reportOpen &&<button className={moreItem} onClick={() => { org.showLastReport(); setMoreOpen(false); }}><svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16" /><path d="M4 12h10" /><path d="M4 19h7" /><path d="m16 16 2.5 2.5L22 14" /></svg>Last Report</button>}
                </motion.div>
              </>
            )}
          </div>
        )}
        {!isAll && <PullButton char={single} conn={single?.conn ?? undefined} compact />}
        {!isAll && (porterGear.storeIds.length > 0 || porterGear.retrieveIds.length > 0) && (
          <div className="relative shrink-0">
            <Btn on={porterOpen} onClick={() => setPorterOpen((o) => !o)} title={`Store or retrieve ${porterGear.job ?? 'this job'}'s gear from your Porter slips`}>
              <span className="inline-flex items-center gap-1">Porter<svg viewBox="0 0 24 24" className={`w-3 h-3 -mr-0.5 transition-transform ${porterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
            </Btn>
            {porterOpen && (
              <>
                <div className="fixed inset-0 z-[70]" onPointerDown={() => setPorterOpen(false)} />
                <motion.div className="absolute right-0 top-full mt-1 z-[71] min-w-[190px] rounded-md border border-line bg-surface-raised shadow-xl py-1 overflow-hidden" style={{ transformOrigin: 'top right' }} initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                  <button className={`${moreItem} disabled:opacity-40`} disabled={!porterGear.near || porterGear.running || porterGear.retrieveIds.length === 0} onClick={() => { porterGear.openRetrieve(); setPorterOpen(false); }}>
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                    Retrieve<span className="ml-auto tabular-nums text-fg-4">{porterGear.retrieveIds.length}</span>
                  </button>
                  <button className={`${moreItem} disabled:opacity-40`} disabled={!porterGear.near || porterGear.running || porterGear.storeIds.length === 0} onClick={() => { porterGear.openStore(); setPorterOpen(false); }}>
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>
                    Store<span className="ml-auto tabular-nums text-fg-4">{porterGear.storeIds.length}</span>
                  </button>
                  {!porterGear.near && <div className="px-3 py-1 text-[10px] text-amber-300">Stand next to the Porter Moogle</div>}
                </motion.div>
              </>
            )}
          </div>
        )}
        <Btn onClick={() => setConsoOpen(true)} title="Merge each character's own split stacks into their preset bags">Consolidate{isAll ? ' All' : ''}</Btn>
        <Btn v="primary" onClick={() => void org.openPreview()} title="Preview and run the organize plan">Organize{isAll ? ' All' : ''}</Btn>
        {sel.size > 0 && <Btn on onClick={() => setSel(new Set())} title="Clear selection">{sel.size} Selected · Clear</Btn>}
        </div>
      </div>

      {(viewChars.some((ch) => ch.org?.active) || consoRun) && (
        <div className="shrink-0 px-3 py-2 border-b border-line bg-accent/[0.06] flex flex-col gap-1.5">
          {viewChars.filter((ch) => ch.org?.active).map((ch) => {
            const total = ch.orgPlan?.length ?? 0;
            const done = ch.orgDone?.length ?? 0;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <div key={ch.name} className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent animate-spin shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
                <span className="text-[11px] font-semibold text-accent shrink-0">Organizing{isAll ? ` ${ch.name}` : ''}…</span>
                <div className="flex-1 h-1.5 rounded-full bg-field overflow-hidden"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
                <span className="text-[10px] tabular-nums text-fg-4 shrink-0">{done}/{total}</span>
              </div>
            );
          })}
          {consoRun && consoRun.chars.map((name) => {
            const initial = consoRun.initial[name] ?? 0;
            const remaining = (consoLive.get(name) ?? []).length;
            const done = Math.max(0, initial - remaining);
            const pct = initial ? Math.round((done / initial) * 100) : 100;
            return (
              <div key={`c${name}`} className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent animate-spin shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
                <span className="text-[11px] font-semibold text-accent shrink-0">Consolidating{isAll ? ` ${name}` : ''}…</span>
                <div className="flex-1 h-1.5 rounded-full bg-field overflow-hidden"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
                <span className="text-[10px] tabular-nums text-fg-4 shrink-0">{done}/{initial}</span>
              </div>
            );
          })}
        </div>
      )}

      <Collapse open={!tipSeen}>
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-line bg-field/60 px-3 py-2 text-[11px] text-fg-3">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          <span className="flex-1 min-w-0"><span className="font-semibold text-fg-2">Tip:</span> <span className="font-semibold text-sky-300">Drag</span> items to move them. <span className="font-semibold text-emerald-300">Click+Drag</span> or <span className="font-semibold text-amber-300">Shift+Click</span> to multi-select. <span className="font-semibold text-violet-300">CTRL+A</span> to Select All, <span className="font-semibold text-rose-300">Double Click</span> to bring to Inventory.</span>
          <button onClick={() => setTipSeen(true)} className="le-tap shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-surface transition-colors" aria-label="Dismiss tip"><svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
      </Collapse>

      <div ref={paneRef} className={`flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4 transition-opacity ${isPending ? 'opacity-50' : ''}`} onPointerDown={onContainerDown}>
        {shownChars.length === 0 && searchMap ? (
          <div className="h-full grid place-items-center text-center text-[12px] text-fg-4 px-6">{dQuery ? `Nothing matches “${q.trim()}”.` : 'Nothing matches these filters.'}</div>
        ) : shownChars.map((ch) => {
          const sm = searchMap?.get(ch.name);
          const home = homeBagMaps.get(ch.name) ?? EMPTY_HOME;
          const bags = BAG_ORDER.filter((b) => bagOf(ch, b.id) && (!sm || sm.bags.has(b.id)));
          return (
            <div key={ch.name}>
              {isAll && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ch.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                  <span className="text-[13px] font-bold text-fg">{ch.name}</span>
                  {ch.mog && <span className="text-[9px] font-semibold text-sky-300 border border-sky-500/40 bg-sky-500/10 rounded px-1.5 py-0.5">Mog House</span>}
                  {sm
                    ? <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] tabular-nums"><span className="font-bold text-amber-200">{sm.count}</span><span className="font-medium text-amber-200/70">match{sm.count === 1 ? '' : 'es'}</span></span>
                    : <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md border border-line bg-field px-2 py-0.5 text-[11px] tabular-nums"><span className="font-bold text-fg-2">{(ch.inv ?? []).reduce((n, b) => n + b.items.length, 0)}</span><span className="text-fg-4">items</span></span>}
                </div>
              )}
              <div className="grid gap-2.5" style={{ gridTemplateColumns: cols ? `repeat(${cols.cards}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(${cardMin}px, 1fr))` }}>
                {bags.map((b) => {
                  const bo = bagOf(ch, b.id)!;
                  return (
                    <BagCard
                      key={b.id}
                      charName={ch.name}
                      bag={b.id}
                      name={b.name}
                      items={sortBy(bo.items, (x) => x, sort, (it) => getMovedAt(ch.name, b.id, it.s, it.id))}
                      max={bo.max}
                      used={bo.used}
                      reach={reachable(b.id, ch, experimental)}
                      isDrop={over?.char === ch.name && over?.bag === b.id}
                      receiving={receiving?.char === ch.name && receiving?.bag === b.id}
                      sel={sel}
                      query={dQuery}
                      homeBags={home}
                      misplacedOnly={misplacedOnly}
                      filt={filt}
                      catMatch={catMatch}
                      tagMatches={tagMatches}
                      jobMatches={jobMatches}
                      statMatches={statMatches}
                      medianOf={medianOf}
                      pending={pending}
                      tile={tile}
                      tileCols={cols?.tiles}
                      assets={ch.assets}
                      iconSet={iconSet}
                      fleetTotals={isAll ? fleetTotals : undefined}
                      onDown={onDown}
                      onContext={onContext}
                      onDouble={onDouble}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {boxRect && createPortal(<div className="fixed z-[9996] border border-accent bg-accent/10 pointer-events-none rounded-sm" style={{ left: boxRect.x0, top: boxRect.y0, width: boxRect.x1 - boxRect.x0, height: boxRect.y1 - boxRect.y0 }} />, document.body)}

      {beams.length > 0 && createPortal(
        <svg className="fixed inset-0 z-[9997] pointer-events-none" style={{ width: '100vw', height: '100vh', overflow: 'visible' }}>
          <defs>
            {beams.map((b) => {
              const a = b.pts[0], z = b.pts[b.pts.length - 1];
              return (
                <linearGradient key={b.key} id={`beam-${b.key}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={z.x} y2={z.y}>
                  <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
                  <stop offset="24%" stopColor="#8affbd" stopOpacity="0.95" />
                  <stop offset="76%" stopColor="#8affbd" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
                </linearGradient>
              );
            })}
          </defs>
          {beams.map((b) => (
            <g key={b.key}>
              <path d={b.path} fill="none" stroke="#4ade80" strokeWidth={6} strokeOpacity={0.13} strokeLinecap="round" className="lib-beam" style={{ ['--len' as string]: `${b.dash}` }} />
              <path d={b.path} fill="none" stroke={`url(#beam-${b.key})`} strokeWidth={2} strokeLinecap="round" className="lib-beam" style={{ ['--len' as string]: `${b.dash}` }} />
            </g>
          ))}
        </svg>,
        document.body,
      )}

      {beams.map((b) => createPortal(
        <motion.div
          key={b.key}
          className="fixed left-0 top-0 z-[9998] pointer-events-none w-7 h-7 rounded-md bg-field grid place-items-center overflow-hidden border border-[#8affbd] shadow-[0_0_15px_3px_rgba(74,222,128,0.8)]"
          initial={{ x: b.pts[0].x - 14, y: b.pts[0].y - 14, opacity: 0, scale: 0.5 }}
          animate={{ x: b.pts.map((p) => p.x - 14), y: b.pts.map((p) => p.y - 14), opacity: [0, 1, 1, 1, 0], scale: [0.5, 1.08, 1.06, 1.04, 0.72] }}
          transition={{ duration: 1.25, ease: 'easeInOut' }}
          onAnimationComplete={() => setBeams((s) => s.filter((x) => x.key !== b.key))}
        >
          <IconInner id={b.id} size={26} name="" assets={tipAssets} bmpHas={b.id > 0 && iconSet.has(b.id)} />
        </motion.div>,
        document.body,
      ))}

      {dragN > 0 && createPortal(
        <div ref={ghost} className="fixed left-0 top-0 z-[9999] pointer-events-none flex items-center gap-2 rounded-lg border border-accent bg-surface-raised px-2 py-1.5 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.7)]">
          <div className="flex">
            {ghostItems.slice(0, 3).map((it, i) => (
              <div key={it.s} className="w-6 h-6 rounded bg-field grid place-items-center overflow-hidden border border-line" style={{ marginLeft: i ? -10 : 0 }}>
                <IconInner id={it.id} size={24} name={it.n} assets={tipAssets} bmpHas={it.id > 0 && iconSet.has(it.id)} />
              </div>
            ))}
          </div>
          <span className="text-[11px] font-semibold text-fg pr-1">{ghostItems.length === 1 ? ghostItems[0].n : `${ghostItems.length} items`}{over && over.char !== ghostItems[0]?.char ? ` → ${over.char}` : ''}</span>
        </div>,
        document.body,
      )}

      <LibraryTip assets={tipAssets} iconSet={iconSet} server={settings.ahServer} />

      {split && <Modal onClose={() => setSplit(null)} panelClass="w-64 p-4">{(close) => (
        <>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="shrink-0 w-9 h-9 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={split.id} size={34} name={split.n} assets={tipAssets} bmpHas={split.id > 0 && iconSet.has(split.id)} /></div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-fg truncate">{split.n}</div>
              <div className="text-[10px] text-fg-4">Move to {bagName(split.to)}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-[11px] text-fg-3">How many? <span className="text-fg-4">(of {split.max})</span></span>
            <Stepper value={split.count} onChange={(v) => setSplit((s) => (s ? { ...s, count: Math.max(1, Math.min(s.max, v)) } : s))} min={1} max={split.max} numW="w-12" />
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
            <button onClick={() => { moveItem(split.conn, split.id, split.from, split.to, split.count, split.slot); pushHist(split.conn, split.n, [{ id: split.id, from: split.from, to: split.to, count: split.count }]); setSel(new Set()); close(); }} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Move {split.count}</button>
          </div>
        </>
      )}</Modal>}

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[9990]" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <motion.div ref={menuRef} className="fixed z-[9991] w-60 rounded-lg border border-line-2 bg-popover shadow-2xl py-1.5 max-h-[92vh] overflow-y-auto" style={{ left: menuPos?.left ?? Math.min(menu.x / uiZoom(), logicalViewport().w - 252), top: menuPos?.top ?? Math.max(8, menu.y / uiZoom()), transformOrigin: 'top left' }} initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
            <div className="px-3 py-1 text-[11px] font-bold text-fg truncate">{menuOne ? menuOne.n : `${menu.items.length} items`}<span className="text-fg-4 font-normal"> · {menuChar}</span></div>
            <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wide text-fg-4">Move to</div>
            <div className="px-2 pb-1.5 flex flex-wrap gap-1">
              {(() => {
                const dests = BAG_ORDER.filter((b) => bagOf(charByName(menuChar), b.id) && canDrop(b.id, menuChar, menu.items));
                return dests.length
                  ? dests.map((b) => <button key={b.id} onClick={() => doMoveTo(b.id)} className="px-2 py-0.5 rounded text-[10px] border border-line text-fg-3 hover:border-accent hover:text-accent transition-colors">{b.name.replace('Mog ', '')}</button>)
                  : <span className="text-[10px] text-fg-4 px-1 py-0.5">no reachable destination</span>;
              })()}
            </div>
            {gatherN > menu.items[0].c && menuOne && (
              <button onClick={doGather} className="w-full text-left px-3 py-1.5 text-[12px] text-sky-300 hover:bg-sky-500/10 transition-colors border-t border-line">Gather all {menuOne.n} to {menuChar} <span className="text-fg-4">({gatherN})</span></button>
            )}
            {isAll && menuOne && gatherCatAc > 0 && gatherCatN > gatherN && (
              <button onClick={doGatherCat} className="w-full text-left px-3 py-1.5 text-[12px] text-sky-300 hover:bg-sky-500/10 transition-colors border-t border-line">Gather all {acLeaf(gatherCatAc)} to {menuChar} <span className="text-fg-4">({gatherCatN})</span></button>
            )}
            {sendTargets.length > 0 && menu.items.some((it) => !((it.f ?? 0) & FLAG_NOTRADE)) && (
              <>
                <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wide text-fg-4 border-t border-line">Send to <span className="text-fg-4/60 normal-case font-normal">(trades in range)</span></div>
                <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                  {sendTargets.map((k) => <button key={k.name} onClick={() => doSendTo(k.name)} className="px-2 py-0.5 rounded text-[10px] border border-line text-sky-300 hover:border-sky-400 hover:text-sky-200 transition-colors">{k.name}</button>)}
                </div>
              </>
            )}
            {online.length > 1 && menu.items.some((it) => !((it.f ?? 0) & FLAG_NOTRADE)) && (
              <button onClick={doDistribute} className="w-full text-left px-3 py-1.5 text-[12px] text-sky-300 hover:bg-sky-500/10 transition-colors border-t border-line">Distribute To…</button>
            )}
            <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wide text-fg-4 border-t border-line">Storage preset <span className="text-fg-4/60 normal-case font-normal">(Organize routes it here)</span></div>
            <div className="px-2 pb-1.5 flex flex-wrap gap-1">
              {STORABLE_BAGS.map((b) => <button key={b.id} onClick={() => doSetHome(b.id)} className="px-2 py-0.5 rounded text-[10px] border border-line text-fg-3 hover:border-accent hover:text-accent transition-colors">{b.name.replace('Mog ', '')}</button>)}
              <button onClick={() => doSetHome(null)} className="px-2 py-0.5 rounded text-[10px] border border-line text-fg-4 hover:text-red-300 hover:border-red-500/40 transition-colors">clear</button>
            </div>
            <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wide text-fg-4 border-t border-line">Add to list</div>
            <div className="px-2 pb-1.5 flex flex-wrap gap-1">
              <button onClick={toggleDropList} className={chipCls(inDropL)}>Drop</button>
              <button onClick={toggleSellList} className={chipCls(inSellL)}>Sell</button>
              <button onClick={toggleWishList} disabled={!wishOk} className={`${chipCls(inWishL)} ${!wishOk ? 'opacity-40 pointer-events-none' : ''}`} title={wishOk ? 'AH Wishlist' : 'Cannot be auctioned'}>Wishlist</button>
              <button onClick={toggleWatchList} className={chipCls(inWatchL)}>Watch</button>
              <button onClick={toggleLotList} className={chipCls(inLotL)}>Lot</button>
              <button onClick={togglePassList} className={chipCls(inPassL)}>Pass</button>
            </div>
            {tagStore.tags.length > 0 && (() => {
              // Temp-bag items can't be moved, so they can't be tagged -- exclude them.
              const ids = [...new Set(menu.items.filter((it) => it.from !== TEMPORARY_BAG).map((it) => it.id))];
              if (!ids.length) return null;
              return (
                <>
                  <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-wide text-fg-4 border-t border-line">Tags</div>
                  <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                    {tagStore.tags.map((t) => {
                      const allHave = ids.every((id) => (tagStore.assign[id] ?? []).includes(t.id));
                      return (
                        <button key={t.id} onClick={() => bulkSetTag(ids, t.id, !allHave)} title={allHave ? `Remove ${t.name}` : `Tag as ${t.name}`}
                          className="px-2 py-0.5 rounded text-[10px] border font-semibold flex items-center gap-1 transition-colors"
                          style={allHave ? { backgroundColor: `${t.color}26`, color: t.color, borderColor: `${t.color}66` } : { color: t.color, borderColor: 'var(--color-line)' }}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />{t.name}
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
            <div className="border-t border-line pt-1">
              {menuOne && <button onClick={doLookup} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">Look up on AH</button>}
              {menuOnline && menuAtah && <button onClick={doListAh} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">List on AH…</button>}
              {menuOnline && bzElig.length > 0 && <button onClick={doBazaar} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">{bzElig.every((it) => (it.bz ?? 0) > 0) ? 'Modify In Bazaar' : 'Put On Bazaar'}{bzElig.length > 1 ? ` (${bzElig.length})` : ''}…</button>}
              {menuOne && !!menuOne.u && menuOnline && <button onClick={doUse} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">Use</button>}
              {menuOnline && <button onClick={doDeliver} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">Delivery Box…</button>}
              {menuOnline && canNpcSell(menuChar) && menu.items.some((it) => !((it.f ?? 0) & FLAG_NONPC)) && <button onClick={doSell} className="w-full text-left px-3 py-1.5 text-[12px] text-fg-2 hover:bg-field transition-colors">Sell to NPC…</button>}
              {menuOnline && <button onClick={doDrop} className="w-full text-left px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10 transition-colors">Drop{menu.items.length > 1 ? ` ${menu.items.length}` : ''}…</button>}
              <button onClick={doDropEverywhere} className="w-full text-left px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10 transition-colors border-t border-line">Drop Everywhere…</button>
            </div>
          </motion.div>
        </>,
        document.body,
      )}


      {consoOpen && <Modal onClose={() => setConsoOpen(false)} panelClass="w-[560px] max-h-[82vh]">{(close) => (
        <>
            <div className="px-4 py-3 border-b border-line">
              <div className="text-[13px] font-bold text-fg">Local Consolidate</div>
              <div className="text-[11px] text-fg-3 mt-0.5">Merges each character's own split stacks into one of the chosen bags. No trading between characters.</div>
            </div>
            <div className="px-4 py-2.5 border-b border-line">
              <div className="text-[9px] font-bold uppercase tracking-wide text-fg-4 mb-1.5">Consolidate Into</div>
              <div className="flex flex-wrap gap-1.5">
                {LOCAL_TARGET_BAGS.map((b) => <button key={b.id} onClick={() => toggleConsoTarget(b.id)} className={chipCls(consoTargets.includes(b.id))}>{b.name}</button>)}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {consoPrep.length === 0
                ? <div className="text-[12px] text-fg-4 p-6 text-center">Nothing to consolidate. Every split stack is already merged.</div>
                : consoPrep.map((p) => (
                  <div key={p.char.name} className="rounded-lg border border-line bg-surface overflow-hidden mb-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-surface-raised">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[12px] font-bold text-fg truncate">{p.char.name}</span>
                      <span className="ml-auto text-[10px] tabular-nums text-fg-4">{p.rows.length} item{p.rows.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="divide-y divide-line">
                      {p.rows.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                          <div className="shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={r.id} size={24} name={r.n} assets={p.char.assets} bmpHas={r.id > 0 && iconSet.has(r.id)} /></div>
                          <div className="min-w-0 flex-1 text-[11px] text-fg-2 truncate">{r.n}<span className="text-fg-4"> from {r.from.map((f) => `${f.bag} (×${f.count})`).join(', ')}</span></div>
                          <span className="shrink-0 text-accent text-[13px]">→</span>
                          <span className="shrink-0 text-[11px] font-medium text-fg-3 max-w-[110px] truncate">{r.homeBag}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            <div className="px-4 py-3 border-t border-line flex gap-2">
              <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
              <button onClick={runConso} disabled={consoPrep.length === 0} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate{consoPrep.length ? ` (${consoPrep.reduce((s, p) => s + p.rows.length, 0)})` : ''}</button>
            </div>
        </>
      )}</Modal>}

      {confirm && <Modal onClose={() => setConfirm(null)} panelClass="w-72 p-4">{(close) => (
        <>
            {(() => {
              const one = confirm.items.length === 1 ? confirm.items[0] : null;
              if (confirm.kind === 'dropall') {
                const ids = [...new Set(confirm.items.map((it) => it.id))];
                const total = ids.reduce((s, id) => s + countItemEverywhere(id, experimental).items, 0);
                return (
                  <>
                    <div className="text-[13px] font-bold text-fg mb-1">Drop {one ? one.n : `${ids.length} items`} everywhere?</div>
                    <div className="text-[11px] text-fg-3 mb-3">Drops {total ? <span className="font-semibold text-fg-2">{total}</span> : 'every copy'} from every connected character that has {ids.length === 1 ? 'it' : 'them'}, moving from other reachable bags first. This can't be undone.</div>
                    <div className="flex gap-2">
                      <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
                      <button onClick={() => { execDropEverywhere(confirm.items); close(); }} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">Drop Everywhere{total ? ` (${total})` : ''}</button>
                    </div>
                  </>
                );
              }
              if (confirm.kind === 'drop') return (
                <>
                  <div className="text-[13px] font-bold text-fg mb-1">Drop {one ? `${one.c > 1 ? one.c + '× ' : ''}${one.n}` : `${confirm.items.length} stacks`}?</div>
                  <div className="text-[11px] text-fg-3 mb-3">Permanently destroys {one ? 'this item' : 'these items'}{isAll ? '' : ` from ${confirm.items[0].char}`}. This can't be undone.</div>
                  <div className="flex gap-2">
                    <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
                    <button onClick={() => { execDrop(confirm.items); close(); }} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">Drop{one ? '' : ` ${confirm.items.length}`}</button>
                  </div>
                </>
              );
              return (
                <>
                  <div className="text-[13px] font-bold text-fg mb-1">Sell {one ? one.n : `${confirm.items.length} stacks`} to NPC?</div>
                  <div className="text-[11px] text-fg-3 mb-3">Sells to the open NPC shop for gil. Be at a vendor with its shop open.</div>
                  {one && one.c > 1 && (
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[11px] text-fg-3">How many? <span className="text-fg-4">(of {one.c})</span></span>
                      <Stepper value={confirm.count} min={1} max={one.c} onChange={(v) => setConfirm((c) => (c ? { ...c, count: v } : c))} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
                    <button onClick={() => { execSell(confirm.items, one ? confirm.count : 0); close(); }} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Sell{one && one.c > 1 ? ` ${confirm.count}` : ''}</button>
                  </div>
                </>
              );
            })()}
        </>
      )}</Modal>}

      {sellDrawer && <SellDrawer char={sellDrawer.char} items={sellDrawer.items} iconSet={iconSet} onClose={() => setSellDrawer(null)} onListed={() => setSel(new Set())} />}
      {bazaar && <BazaarPriceModal conn={bazaar.conn} items={bazaar.items} server={settings.ahServer} iconSet={iconSet} assets={viewChars[0]?.assets} onClose={() => setBazaar(null)} onDone={() => setSel(new Set())} />}

      {org.nodes}
      {porterGear.modals}
      <ConsolidateProgressCard />
    </div>
  );
}
