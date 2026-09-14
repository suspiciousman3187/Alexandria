import { memo, useEffect, useMemo, useRef, useState, useTransition, useDeferredValue, type ReactElement, type ReactNode, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Modal, Popover, Collapse } from './overlay';
import { openDistribute } from './distributeHost';
import { useTradeJob, startTradeJob, type TradeJob, type TradeRow } from './tradeJob';
import { useKnownCharacters, useAvailableIcons, useItemDescription, moveItem, dropOne, useItem, useStop, shopSell, bzApply, NOMAD_BAGS, nomadReachable, withinTradeRange, useAcMap, type InvItem, type InvBag, type SelItem, type KnownChar } from './bridge';
import { useSettings } from './settings';
import { useShopSell, setShopSell } from './shop';
import { getCachedValue } from './priceStore';
import { BazaarPriceModal } from './BazaarPriceModal';
import { tipAttrs } from './textTip';
import { logicalRect, logicalViewport } from './uiZoom';
import { IconInner } from './atlasIcon';
import { useSticky, useStickyChar, useStickyPersisted } from './sticky';
import { getMovedAt } from './movedTracker';
import { startBulkOp, useBulkOp } from './bulkOp';
import { useRowMarket } from './rowMarket';
import { openAhDetail } from './ahNav';
import { useWatchStore, addWatchItem, removeWatchItem, totalOf } from './watch';
import { useWishlist, addWish, removeWish } from './wishlist';
import { useDrop, setDrop, dropItemEverywhere, countItemEverywhere } from './drop';
import { usePoolStore, addRuleToChars, setCharRules, emptyRules } from './poolRules';
import { useConsolidatePrefs, addConsolidateItem, removeConsolidateItem } from './consolidatePrefs';
import { useStoragePrefs, setCharLayout, STORABLE_BAGS, type LayoutEntry } from './storagePrefs';
import { SellDrawer } from './SellDrawer';
import { useAnimatedList } from './useAnimatedList';
import { useItemHover } from './ItemTooltip';
import { openUseAll } from './useAllHost';
import { Select, Stepper, Slider, GilInput, CharacterSelect, BagTag, SearchInput, Chip, Button } from './ui';
import { bagColor } from './bagColors';
import { itemNameMatches, itemCategory, itemCategoryRank, itemStack, ITEM_CATEGORIES, type ItemCategory } from './itemNames';
import { useMedianStack, toggleMedianStack } from './medianMode';
import { SORTS, tagSorts, sortBy, type SortMode } from './itemSort';
import { useTagFilter, TagFilterSelect } from './tagFilter';
import { useJobFilter, JobFilterSelect } from './jobFilter';
import PullButton from './PullMenu';
import { acLeaf, acPathLabel } from './ahCategories';
import { useConsolidate, runConsolidateSelection, stopConsolidate, clearConsolidate, consolidableTotal, bagConsolidatable } from './consolidate';
import { useAnon } from './anonymize';
import { OpCard } from './OpCard';
import { ALWAYS_BAGS, MOG_ONLY_BAGS, FLAG_NOTRADE } from './bagConstants';

// AH category on inventory rows + category-aware search is parked until refined; flip to re-enable.
const SHOW_INV_AH_CATEGORY = false;
type ViewMode = 'list' | 'compact';
type Entry = { item: InvItem; bag?: string; bagObj?: InvBag };

// Sort options + logic are shared with Library via ./itemSort; this wrapper only supplies
// the Entry -> item accessor so the existing call sites stay unchanged.
const sortEntries = (entries: Entry[], mode: SortMode, movedAt?: (e: Entry) => number): Entry[] =>
  sortBy(entries, (e) => e.item, mode, movedAt);
type BulkAction = 'move' | 'bazaar' | 'sell' | 'drop' | 'use';
type BulkKind = BulkAction | null;

const BAG_META: Record<number, { order: number; name: string }> = {
  0: { order: 0, name: 'Inventory' },
  1: { order: 1, name: 'Mog Safe' },
  9: { order: 2, name: 'Mog Safe 2' },
  2: { order: 3, name: 'Storage' },
  4: { order: 4, name: 'Mog Locker' },
  5: { order: 5, name: 'Mog Satchel' },
  6: { order: 6, name: 'Mog Sack' },
  7: { order: 7, name: 'Mog Case' },
  8: { order: 8, name: 'Wardrobe 1' },
  10: { order: 9, name: 'Wardrobe 2' },
  11: { order: 10, name: 'Wardrobe 3' },
  12: { order: 11, name: 'Wardrobe 4' },
  13: { order: 12, name: 'Wardrobe 5' },
  14: { order: 13, name: 'Wardrobe 6' },
  15: { order: 14, name: 'Wardrobe 7' },
  16: { order: 15, name: 'Wardrobe 8' },
  17: { order: 16, name: 'Recycle Bin' },
  3: { order: 17, name: 'Temporary Items' },
};
const bagRank = (id: number) => BAG_META[id]?.order ?? 100 + id;
// Reach-anywhere vs Mog-House-only bags, to disable move-to-inventory presteps the character can't reach from where it stands.
const ALWAYS_REACHABLE = ALWAYS_BAGS;
const MOG_REACHABLE = MOG_ONLY_BAGS;
function bagReachable(bagId: number, atMog: boolean, nomadOk: boolean): boolean {
  if (ALWAYS_REACHABLE.has(bagId)) return true;
  if (MOG_REACHABLE.has(bagId)) return atMog || (NOMAD_BAGS.has(bagId) && nomadOk);
  return false;
}
const bagName = (id: number, fallback: string) => BAG_META[id]?.name ?? fallback;
// One-shot "did this element scroll into view" via IntersectionObserver, so a per-row market fetch fires
// only for rows the user actually sees (never a whole-inventory burst against the AH). Latches true on
// first sighting and disconnects; disabled = no observer at all (the common ItemRow uses without a server).
function useOnScreen(enabled: boolean): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || on) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: '250px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, on]);
  return [ref, on];
}

export const ItemRow = memo(function ItemRow({ item, bag, bagId, assets, selected, onClick, onPointerDown, onPointerEnter, dense, actions, cat, server }: { item: InvItem; bag?: string; bagId?: number; assets?: string; selected?: boolean; onClick?: () => void; onPointerDown?: () => void; onPointerEnter?: () => void; dense?: boolean; actions?: ReactNode; cat?: { leaf: string; path: string }; server?: string }) {
  const icons = useAvailableIcons();
  const hover = useItemHover(item);
  // AH median inline, fetched lazily once the row is on screen. Only for auctionable items in non-dense
  // rows when an AH server is configured; off-AH gear and the compact view skip it entirely.
  const auctionable = !((item.f ?? 0) & 0x08);
  const wantMarket = !!server && !dense && auctionable;
  const [rowRef, onScreen] = useOnScreen(wantMarket);
  const stackable = itemStack(item.id) > 1;
  const medStack = useMedianStack(item.id);
  const market = useRowMarket(item.id, stackable && medStack, server, wantMarket && onScreen);
  return (
    <div ref={rowRef} className={`relative group flex items-center transition-colors ${selected ? 'bg-accent/15' : 'hover:bg-field'}`}>
      <button
        onClick={onClick ?? hover.onClick}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        className={`min-w-0 flex-1 text-left flex items-center transition-colors cursor-pointer ${onPointerDown ? 'select-none' : ''} ${dense ? 'gap-2 px-2.5 py-1' : 'gap-3 px-3 py-1.5'}`}
      >
        <div className={`relative shrink-0 rounded bg-field grid place-items-center overflow-hidden ${dense ? 'w-5 h-5' : 'w-7 h-7'}`}>
          <IconInner id={item.id} size={dense ? 20 : 28} name={item.n} assets={assets} bmpHas={item.id > 0 && icons.has(item.id)} />
        </div>
        <div className="min-w-0 flex-1">
          {/* BAZAAR sits above the name (non-dense) so the badge stops eating the name's horizontal room;
              dense rows keep it inline to stay single-line compact. */}
          {!dense && item.bz != null && (
            <span {...tipAttrs(`On bazaar · ${(item.bz || 0).toLocaleString()} gil`)} className="flex items-baseline gap-1 leading-none mb-0.5 cursor-help">
              <span className="text-[9px] font-bold uppercase tracking-wide text-yellow-200">Bazaar</span>
              <span className="text-[10px] font-semibold tabular-nums text-yellow-300">{(item.bz || 0).toLocaleString()}<span className="text-[8px] font-medium text-yellow-200/70 ml-0.5">g</span></span>
            </span>
          )}
          <div className="flex items-baseline gap-2">
            <span className={`min-w-0 truncate text-fg-2 ${dense ? 'text-[11px]' : 'text-[12px]'}`}>{item.n}</span>
            {item.c > 1 && <span className={`shrink-0 tabular-nums font-bold text-accent rounded bg-accent/15 leading-none ${dense ? 'text-[10px] px-1 py-0.5' : 'text-[12px] px-1.5 py-0.5'}`}>×{item.c}</span>}
            {item.aug && item.aug.length > 0 && <span title="Augmented" className={`shrink-0 font-bold rounded leading-none border border-amber-500/40 bg-amber-500/10 text-amber-300 ${dense ? 'text-[8px] px-1 py-0.5' : 'text-[9px] px-1.5 py-0.5'}`}>AUG</span>}
            {dense && item.bz != null && <span {...tipAttrs(`On bazaar · ${(item.bz || 0).toLocaleString()} gil`)} className="shrink-0 font-bold rounded leading-none border border-yellow-400/60 bg-yellow-400/15 text-yellow-200 cursor-help text-[8px] px-1 py-0.5">BAZAAR</span>}
          </div>
        </div>
        {wantMarket && (market?.median ? (
          <div
            {...tipAttrs(stackable ? `AH ${medStack ? 'stack' : 'single'} median · ${market.stock ?? '0'} listed · click to toggle stack/single` : `AH median · ${market.stock ?? '0'} listed`)}
            onClick={stackable ? (e) => { e.stopPropagation(); e.preventDefault(); toggleMedianStack(item.id); } : undefined}
            className={`shrink-0 flex flex-col items-end leading-tight ${stackable ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-help'}`}
          >
            <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4">Median{stackable ? (medStack ? ' · Stack' : ' · Each') : ''}</span>
            <span className="text-[12.5px] font-semibold tabular-nums text-yellow-300">{market.median}<span className="text-[9px] font-medium text-yellow-200/70 ml-0.5">g</span></span>
          </div>
        ) : onScreen && market === undefined ? (
          <div {...tipAttrs('Checking AH price…')} className="shrink-0 flex flex-col items-end leading-tight cursor-help">
            <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4">Median</span>
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-fg-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
          </div>
        ) : onScreen && market !== undefined ? (
          <span {...tipAttrs('No recent AH sales')} className="shrink-0 text-[12px] tabular-nums text-fg-4/50 cursor-help">—</span>
        ) : null)}
        {!dense && cat && <span title={`Auction House: ${cat.path}`} className="shrink-0 text-[9px] leading-none px-1.5 py-0.5 rounded bg-field border border-line text-fg-4 max-w-[96px] truncate">{cat.leaf}</span>}
        {bag && (bagId != null ? <BagTag id={bagId} label={bag} className="max-w-[110px]" /> : <span className="shrink-0 truncate max-w-[110px] text-[10px] text-fg-4">{bag}</span>)}
      </button>
      {actions && (
        <div
          onClick={(e) => { e.stopPropagation(); (document.activeElement as HTMLElement | null)?.blur(); }}
          className={`shrink-0 flex items-center gap-1 ${dense ? 'pr-2 pl-1' : 'pr-2.5 pl-1.5'}`}
        >
          {actions}
        </div>
      )}
    </div>
  );
});

const entryKey = (e: Entry) => `${e.bag ?? ''}:${e.item.s}:${e.item.id}`;
const NO_ENTRIES: Entry[] = [];
// content-visibility:auto lets the WebView2 compositor skip layout/paint for off-screen rows, so a long,
// icon-dense inventory (hundreds of items) can't flood the GPU on mount and trip a display-driver TDR. The
// intrinsic-size fallback keeps the scrollbar stable for never-yet-rendered rows.
const ROW_CV: CSSProperties = { contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' };

const noop = () => {};
function ItemCollection({ entries, mode, assets, isSel, onSelect, onSelectDown, onSelectEnter, renderActions, animate, dimEntry, catOf, server }: { entries: Entry[]; mode: ViewMode; assets?: string; isSel?: (slot: number, entry: Entry) => boolean; onSelect?: (slot: number, entry: Entry) => void; onSelectDown?: (slot: number, entry: Entry) => void; onSelectEnter?: (slot: number, entry: Entry) => void; renderActions?: (item: InvItem, entry: Entry) => ReactNode; animate?: boolean; dimEntry?: (slot: number, entry: Entry) => boolean; catOf?: (id: number) => { leaf: string; path: string } | undefined; server?: string }) {
  const animated = useAnimatedList(animate ? entries : NO_ENTRIES, entryKey, 240);
  const nodes = animate ? animated : entries.map((e) => ({ key: entryKey(e), item: e, leaving: false }));
  const drag = !!onSelectDown;

  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
      {nodes.map((n) => {
        const slot = n.item.item.s;
        const dimmed = !n.leaving && !!dimEntry && dimEntry(slot, n.item);
        const cls = [animate ? (n.leaving ? 'le-row-out' : 'le-row-in') : '', dimmed ? 'opacity-40 pointer-events-none' : ''].filter(Boolean).join(' ');
        return (
        <div key={n.key} className={cls || undefined} style={ROW_CV}>
          <ItemRow
            item={n.item.item}
            bag={n.item.bag}
            bagId={n.item.bagObj?.id}
            assets={assets}
            dense={mode === 'compact'}
            selected={!n.leaving && isSel ? isSel(slot, n.item) : false}
            onClick={n.leaving ? undefined : drag ? noop : onSelect ? () => onSelect(slot, n.item) : undefined}
            onPointerDown={!n.leaving && onSelectDown ? () => onSelectDown(slot, n.item) : undefined}
            onPointerEnter={!n.leaving && onSelectEnter ? () => onSelectEnter(slot, n.item) : undefined}
            actions={n.leaving ? undefined : renderActions?.(n.item.item, n.item)}
            cat={catOf?.(n.item.item.id)}
            server={server}
          />
        </div>
        );
      })}
    </div>
  );
}

function viewIcon(id: ViewMode): ReactElement {
  if (id === 'list') return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="3" height="3" rx="0.6" /><rect x="6" y="2.75" width="7" height="1.5" rx="0.75" /><rect x="1" y="9" width="3" height="3" rx="0.6" /><rect x="6" y="9.75" width="7" height="1.5" rx="0.75" /></svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2.25" width="12" height="1.5" rx="0.75" /><rect x="1" y="6.25" width="12" height="1.5" rx="0.75" /><rect x="1" y="10.25" width="12" height="1.5" rx="0.75" /></svg>
  );
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const modes: { id: ViewMode; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'compact', label: 'Compact' },
  ];
  return (
    <div className="shrink-0 flex items-center gap-0.5 rounded-md bg-field border border-line p-0.5">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          title={m.label}
          aria-label={m.label}
          aria-pressed={mode === m.id}
          className={`grid place-items-center w-[26px] h-[26px] rounded transition-colors ${mode === m.id ? 'bg-accent text-on-accent' : 'text-fg-4 hover:text-fg-2'}`}
        >
          {viewIcon(m.id)}
        </button>
      ))}
    </div>
  );
}

function ActBtn({ onClick, title, active, tone = 'neutral', sm, disabled, className, children }: { onClick: () => void; title: string; active?: boolean; tone?: 'accent' | 'amber' | 'red' | 'neutral'; sm?: boolean; disabled?: boolean; className?: string; children: ReactNode }) {
  const on = { accent: 'border-accent bg-accent/15 text-accent', amber: 'border-amber-500/60 bg-amber-500/15 text-amber-300', red: 'border-red-500/60 bg-red-500/15 text-red-300', neutral: 'border-line-2 bg-field text-fg' }[tone];
  const off = tone === 'red' ? 'border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300' : 'border-line text-fg-3 hover:text-fg hover:border-line-2';
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active} disabled={disabled} className={`shrink-0 grid place-items-center rounded-md border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${sm ? 'w-7 h-7' : 'w-8 h-8'} ${active ? on : off} ${className ?? ''}`}>
      {children}
    </button>
  );
}

// Hide at rest, show when the row (a .group) is hovered. Base ActBtn is display:grid; `hidden` is emitted
// after `grid` in Tailwind so it wins at rest, and the group-hover variant wins on hover.
const REVEAL_ON_HOVER = 'hidden group-hover:grid';

const SVG = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function DropConfirmModal({ kind, item, charName, fromBag, allCount, onCancel, onConfirm }: { kind: 'now' | 'list' | 'all' | 'party'; item: InvItem; charName: string; fromBag?: string; allCount?: { items: number; chars: number }; onCancel: () => void; onConfirm: () => void }) {
  const anon = useAnon();
  const action = useRef(onCancel);
  const spread = allCount ? <> (<span className="font-semibold text-fg-2">{allCount.items}</span> across {allCount.chars} character{allCount.chars === 1 ? '' : 's'})</> : null;
  return (
    <Modal onClose={() => action.current()} panelClass="w-[min(92vw,360px)] p-4">
      {(close) => (
        <>
          <div className="text-[13px] font-bold text-fg mb-1.5">{kind === 'now' ? 'Drop This Item?' : kind === 'all' || kind === 'party' ? 'Drop Across All Characters?' : 'Add to Drop List?'}</div>
          <div className="text-[12px] text-fg-3 leading-relaxed mb-3.5">
            {kind === 'now' ? (
              fromBag ? (
                <><span className="font-semibold text-fg-2">{item.n}{item.c > 1 ? ` x${item.c}` : ''}</span> will be moved from {anon(charName)}'s <span className="font-semibold text-fg-2">{fromBag}</span> to inventory and dropped.</>
              ) : (
                <><span className="font-semibold text-fg-2">{item.n}{item.c > 1 ? ` x${item.c}` : ''}</span> will be dropped from {anon(charName)}'s inventory now.</>
              )
            ) : kind === 'party' ? (
              <><span className="font-semibold text-fg-2">{item.n}</span> will be dropped from every connected character that has it{spread}, moving from other reachable bags to inventory first. This does not add it to the drop list. Dropped items are gone for good.</>
            ) : kind === 'all' ? (
              <><span className="font-semibold text-fg-2">{item.n}</span> will be added to the drop list, then dropped from every connected character that has it{spread}, moving from other reachable bags to inventory first. Dropped items are gone for good.</>
            ) : (
              <><span className="font-semibold text-fg-2">{item.n}</span> will be added to the drop list. When Auto-Drop is on, connected characters drop it from inventory automatically.</>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { action.current = onCancel; close(); }} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => { action.current = onConfirm; close(); }} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">{kind === 'now' ? 'Drop' : kind === 'party' ? `Drop Everywhere${allCount?.items ? ` (${allCount.items})` : ''}` : kind === 'all' ? `Drop All${allCount?.items ? ` (${allCount.items})` : ''}` : 'Add to Drop'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

const ICN = {
  use: <svg {...SVG}><path d="M9 3h6" /><path d="M10 3v6l-4.5 8A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 9V3" /><path d="M7.5 14h9" /></svg>,
  drop: <svg {...SVG}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M10 11v6M14 11v6" /></svg>,
  watch: <svg {...SVG}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  ban: <svg {...SVG}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg>,
  auction: <svg {...SVG}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></svg>,
  sell: <svg {...SVG}><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.5 2.7 3 6 3" /><path d="M15 9.5c3.3 0 6 1.3 6 3v3c0 1.7-2.7 3-6 3s-6-1.3-6-3" /></svg>,
  bazaar: <svg {...SVG}><path d="M3 9l1.6-4.5A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.5L21 9" /><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M3 9h18" /><path d="M9 20v-6h6v6" /></svg>,
  retrieve: <svg {...SVG}><path d="M3 12a9 9 0 1 0 2.6-6.4" /><path d="M3 3v4h4" /></svg>,
  move: <svg {...SVG}><path d="M4 8h12" /><path d="M13 5l3 3-3 3" /><path d="M20 16H8" /><path d="M11 13l-3 3 3 3" /></svg>,
  trade: <svg {...SVG}><circle cx="8" cy="7" r="3" /><path d="M2 21v-1a5 5 0 0 1 5-5h2" /><path d="M14 11l3 3-3 3" /><path d="M22 14h-7" /></svg>,
  distribute: <svg {...SVG}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.3 10.9 15.7 7.1" /><path d="M8.3 13.1 15.7 16.9" /></svg>,
  wishlist: <svg {...SVG}><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" /></svg>,
  lot: <svg {...SVG}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" /></svg>,
  consolidate: <svg {...SVG}><path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" /><path d="M12 3v11" /><path d="M8 10l4 4 4-4" /></svg>,
  pin: <svg {...SVG}><path d="M12 17v5" /><path d="M9 10.76V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.76a2 2 0 0 0 .59 1.41l1.7 1.7A1 1 0 0 1 17.59 16H6.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 8 11.16" /></svg>,
  more: <svg {...SVG}><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></svg>,
};

function ConsolidateAssignModal({ item, assets, defaultChar, onClose }: { item: InvItem; assets?: string; defaultChar: string; onClose: () => void }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const anon = useAnon();
  const prefs = useConsolidatePrefs();
  const chars = useMemo(() => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)), [known]);
  const holders = useMemo(() => chars.filter((c) => (prefs[c.name] ?? []).some((n) => n.toLowerCase() === item.n.toLowerCase())).map((c) => c.name), [chars, prefs, item.n]);
  const [target, setTarget] = useState(() => (chars.some((c) => c.name === defaultChar) ? defaultChar : chars[0]?.name ?? ''));
  const onTarget = holders.includes(target);
  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,380px)]">
      {(close) => (
        <div className="flex flex-col">
          <div className="shrink-0 flex items-center gap-2 p-4 pb-3">
            <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
              <IconInner id={item.id} size={28} name={item.n} assets={assets} bmpHas={item.id > 0 && iconSet.has(item.id)} />
            </div>
            <div className="text-[14px] font-bold text-fg truncate flex-1 min-w-0">Consolidate {item.n}</div>
          </div>
          <div className="px-4 pb-1 flex flex-col gap-3">
            <div className="text-[11px] text-fg-4 leading-snug">Pick the character every copy of this item should collect to when you run the Preference List.</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Collect To</span>
              <div className="flex-1 min-w-0"><CharacterSelect value={target} onChange={setTarget} chars={chars} /></div>
            </div>
            {holders.length > 0 && (
              <div className="rounded-md border border-line bg-surface divide-y divide-line overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-4">Currently Collects To</div>
                {holders.map((h) => (
                  <div key={h} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    <span className="text-[11px] text-fg-2 font-semibold min-w-0 truncate">{anon(h)}</span>
                    <button onClick={() => removeConsolidateItem(h, item.n)} aria-label="Remove" className="ml-auto shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-red-400 transition-colors">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Close</button>
            {onTarget
              ? <button onClick={() => removeConsolidateItem(target, item.n)} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Remove From {anon(target)}</button>
              : <button onClick={() => { if (target) { addConsolidateItem(target, item.n); onClose(); } }} disabled={!target} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Add To {anon(target)}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function StoragePresetModal({ item, defaultChar, assets, onClose }: { item: InvItem; defaultChar: string; assets?: string; onClose: () => void }) {
  const iconSet = useAvailableIcons();
  const anon = useAnon();
  const known = useKnownCharacters();
  const prefs = useStoragePrefs();
  const chars = useMemo(() => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)), [known]);
  const [target, setTarget] = useState(() => (chars.some((c) => c.name === defaultChar) ? defaultChar : chars[0]?.name ?? ''));
  const entry = (prefs[target] ?? []).find((e) => e.item.toLowerCase() === item.n.toLowerCase());
  const bags = entry?.bags ?? [];
  const toggleBag = (bagId: number) => {
    const cur = prefs[target] ?? [];
    const e = cur.find((x) => x.item.toLowerCase() === item.n.toLowerCase());
    let next: LayoutEntry[];
    if (e) {
      const nb = e.bags.includes(bagId) ? e.bags.filter((b) => b !== bagId) : [...e.bags, bagId];
      next = cur.map((x) => (x === e ? { ...x, bags: nb } : x)).filter((x) => x.bags.length > 0);
    } else {
      next = [...cur, { item: item.n, bags: [bagId] }];
    }
    setCharLayout(target, next);
  };
  const clearPreset = () => setCharLayout(target, (prefs[target] ?? []).filter((x) => x.item.toLowerCase() !== item.n.toLowerCase()));
  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,380px)]">
      {(close) => (
        <div className="flex flex-col">
          <div className="shrink-0 flex items-center gap-2 p-4 pb-3">
            <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
              <IconInner id={item.id} size={28} name={item.n} assets={assets} bmpHas={item.id > 0 && iconSet.has(item.id)} />
            </div>
            <div className="text-[14px] font-bold text-fg truncate flex-1 min-w-0">Storage Preset · {item.n}</div>
          </div>
          <div className="px-4 pb-1 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Character</span>
              <div className="flex-1 min-w-0"><CharacterSelect value={target} onChange={setTarget} chars={chars} /></div>
            </div>
            <div className="text-[11px] text-fg-4 leading-snug">During Organize on {anon(target)}, this item is sent to the chosen bags in priority order, overflowing to the next when one fills.</div>
            <div className="flex flex-wrap gap-1.5">
              {STORABLE_BAGS.map((b) => {
                const idx = bags.indexOf(b.id);
                return <Chip key={b.id} on={idx >= 0} onChange={() => toggleBag(b.id)}>{idx >= 0 ? `${idx + 1}. ${b.name}` : b.name}</Chip>;
              })}
            </div>
            {bags.length === 0 && <div className="text-[11px] text-fg-4">No bags chosen. Tap bags in the order you want them filled.</div>}
          </div>
          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Close</button>
            {bags.length > 0 && <button onClick={clearPreset} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md border border-line bg-field text-fg-2 hover:text-red-400 transition-colors">Remove Preset</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

type MenuAction = { icon: ReactNode; label: string; tone?: 'red' | 'accent' | 'neutral'; disabled?: boolean; onClick: () => void };

function ActionMenu({ actions }: { actions: MenuAction[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rect) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setRect(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRect(null); };
    document.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [rect]);

  const W = 188;
  let left = 8, top = 0, up = false;
  if (rect) {
    // Position in the menu's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws it off-screen;
    // see uiZoom.ts. No-op at 100%.
    const r = logicalRect(rect);
    const vh = logicalViewport().h;
    left = Math.max(8, r.right - W);
    const estH = actions.length * 32 + 8;
    if (r.bottom + 4 + estH > vh && r.top - estH - 4 > 8) { top = r.top - estH - 4; up = true; }
    else top = r.bottom + 4;
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setRect(rect ? null : e.currentTarget.getBoundingClientRect()); }}
        title="More Actions"
        aria-label="More Actions"
        aria-pressed={!!rect}
        className={`shrink-0 grid place-items-center rounded-md border transition-colors w-7 h-7 ${rect ? 'border-line-2 bg-field text-fg' : 'border-line text-fg-3 hover:text-fg hover:border-line-2'}`}
      >
        {ICN.more}
      </button>
      {createPortal(
        <Popover open={!!rect} up={up} style={{ position: 'fixed', left, top, width: W, zIndex: 80 }} className="rounded-lg border border-line bg-popover shadow-2xl p-1 overscroll-contain">
          <div ref={menuRef} className="flex flex-col">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={a.disabled}
                onClick={(e) => { e.stopPropagation(); if (a.disabled) return; a.onClick(); setRect(null); }}
                className={`le-tap flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-left transition-colors ${a.disabled ? 'text-fg-4/50 cursor-default' : a.tone === 'red' ? 'text-red-300 hover:bg-red-500/10' : a.tone === 'accent' ? 'text-accent hover:bg-accent/10' : 'text-fg-2 hover:bg-field hover:text-fg'}`}
              >
                <span className="shrink-0 w-4 grid place-items-center">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </Popover>,
        document.body,
      )}
    </>
  );
}

export function RowActions({ char, bag, item, canAct, bags }: { char: KnownChar; bag: InvBag; item: InvItem; canAct: boolean; bags: InvBag[] }) {
  const watchStore = useWatchStore();
  const drop = useDrop();
  const sell = useShopSell();
  const wished = useWishlist().some((w) => w.id === item.id);
  const watched = (watchStore[char.name]?.items ?? []).some((i) => i.id === item.id);
  const inDrop = drop.drop.some((n) => n.toLowerCase() === item.n.toLowerCase());
  const inSell = sell.items.some((n) => n.toLowerCase() === item.n.toLowerCase());
  const auctionable = !((item.f ?? 0) & 0x08);
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const server = useSettings().ahServer || known.find((c) => c.online)?.server;
  const poolStore = usePoolStore();
  const consoPrefs = useConsolidatePrefs();
  const storagePrefs = useStoragePrefs();
  const [confirm, setConfirm] = useState<null | 'now' | 'list' | 'all' | 'party'>(null);
  const [consoAssign, setConsoAssign] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [movingInv, setMovingInv] = useState(false);
  const [selling, setSelling] = useState(false);
  const [trading, setTrading] = useState(false);
  const [bazaaring, setBazaaring] = useState(false);
  const [useAmt, setUseAmt] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const isRecycle = bag.id === 17;
  const canDrop = canAct && !isRecycle;
  const usable = canAct && !isRecycle && !!item.u;
  const atah = !!(char.atah ?? char.ah?.atah);
  const canAuction = canAct && !isRecycle && atah && !(item.f && (item.f & 0x0A)) && !(item.aug && item.aug.length > 0);
  const canMove = canAct && bags.some((b) => b.id !== bag.id);
  const canMoveToInv = canAct && bag.id !== 0 && bag.id !== 17;
  const reachable = bag.id === 0 || bagReachable(bag.id, !!char.mog, nomadReachable(char, exp));
  const rsuf = (base: string) => (reachable ? base : `${base} · Mog House Or Nomad Moogle`);
  const vendorable = canAct && !isRecycle && !(item.f && (item.f & 0x10));
  const sellOk = vendorable && sell.anywhere && exp && !!char.inTown && reachable;
  const tradeTargets = useMemo(() => (char.mog ? [] : known.filter((k) => k.name !== char.name && k.online && k.conn != null && !k.mog && withinTradeRange(k, char))), [known, char]);
  const canTrade = canAct && !char.mog && bag.id === 0 && !(item.f && (item.f & 0x02)) && tradeTargets.length > 0;
  // Bazaar sells from your main inventory; Ex/No-Trade items can't be bazaared. Unlike auction,
  // augmented gear is fine (the exact item changes hands) and no auction house is required.
  const canBazaar = canAct && !isRecycle && bag.id === 0 && !(item.f && (item.f & 0x02));
  const doRetrieve = () => { if (char.conn != null) moveItem(char.conn, item.id, 17, 0, item.c, item.s); };
  const doMoveToInv = () => { if (char.conn == null) return; if (item.c > 1) setMovingInv(true); else moveItem(char.conn, item.id, bag.id, 0, item.c, item.s); };

  const toggleDrop = () => {
    if (inDrop) { setDrop({ ...drop, drop: drop.drop.filter((n) => n.toLowerCase() !== item.n.toLowerCase()) }); return; }
    if (drop.skipAddConfirm) { setDrop({ ...drop, drop: [...drop.drop, item.n] }); return; }
    setConfirm('list');
  };
  const confirmAddList = () => { if (!inDrop) setDrop({ ...drop, drop: [...drop.drop, item.n] }); setConfirm(null); };
  const doDropNow = () => { if (char.conn != null) dropOne(char.conn, item.s, item.id, bag.id, item.c); setConfirm(null); };
  const askDropNow = () => { if (drop.skipDropConfirm) doDropNow(); else setConfirm('now'); };

  const inLot = (poolStore[char.name]?.lot ?? []).some((n) => n.toLowerCase() === item.n.toLowerCase());
  const toggleLot = () => {
    if (inLot) { const r = poolStore[char.name] ?? emptyRules(); setCharRules(char.name, { ...r, lot: r.lot.filter((n) => n.toLowerCase() !== item.n.toLowerCase()) }); }
    else addRuleToChars([char.name], 'lot', item.n);
  };
  const consoHolders = Object.entries(consoPrefs).filter(([, its]) => its.some((n) => n.toLowerCase() === item.n.toLowerCase())).map(([nm]) => nm);
  const layoutEntry = (storagePrefs[char.name] ?? []).find((e) => e.item.toLowerCase() === item.n.toLowerCase());
  const presetBags = layoutEntry?.bags ?? [];
  const hasPreset = presetBags.length > 0;

  const allMatches = useMemo(() => countItemEverywhere(item.id, exp), [known, item.id, exp]);
  const dropEverywhere = () => {
    if (!inDrop) setDrop({ ...drop, drop: [...drop.drop, item.n] });
    dropItemEverywhere(item.id, exp);
    setConfirm(null);
  };
  const dropOnParty = () => { dropItemEverywhere(item.id, exp); setConfirm(null); };

  const verbs: MenuAction[] = [];
  if (isRecycle && canAct) verbs.push({ icon: ICN.retrieve, label: 'Retrieve To Inventory', tone: 'accent', onClick: doRetrieve });
  if (canMoveToInv) verbs.push({ icon: ICN.retrieve, label: rsuf('Move To Inventory'), tone: 'accent', disabled: !reachable, onClick: doMoveToInv });
  if (canMove) verbs.push({ icon: ICN.move, label: rsuf('Move To Another Bag'), disabled: !reachable, onClick: () => setMoving(true) });
  verbs.push({ icon: ICN.consolidate, label: 'Consolidate To…', tone: consoHolders.length ? 'accent' : undefined, onClick: () => setConsoAssign(true) });
  verbs.push({ icon: ICN.pin, label: hasPreset ? `Storage Preset · ${presetBags.map((id) => STORABLE_BAGS.find((b) => b.id === id)?.name ?? id).join(', ')}` : 'Storage Preset…', tone: hasPreset ? 'accent' : undefined, onClick: () => setPresetOpen(true) });
  if (canTrade) verbs.push({ icon: ICN.trade, label: 'Trade To Character', tone: 'accent', onClick: () => setTrading(true) });
  if (canTrade) verbs.push({ icon: ICN.distribute, label: 'Distribute To…', tone: 'accent', onClick: () => openDistribute(char.name, [{ id: item.id, n: item.n }]) });
  if (canAuction && char.conn != null) verbs.push({
    icon: ICN.auction,
    label: rsuf('Put On Auction'),
    tone: 'accent',
    disabled: !reachable,
    onClick: () => openAhDetail({
      id: item.id,
      n: item.n,
      st: item.ms ?? 1,
      back: 'inventory',
      sell: { conn: char.conn!, bagId: bag.id, slot: item.s, count: item.c, charName: char.name, fromBag: bag.id !== 0 },
    }),
  });
  if (canBazaar) verbs.push({ icon: ICN.bazaar, label: item.bz != null ? 'Modify In Bazaar' : 'Put On Bazaar', tone: 'accent', onClick: () => setBazaaring(true) });
  if (usable) {
    verbs.push({ icon: ICN.use, label: rsuf('Use One'), disabled: !reachable, onClick: () => { if (char.conn != null) useItem(char.conn, item.id, false, bag.id, item.s); } });
    if (item.c > 1) verbs.push({ icon: ICN.use, label: reachable ? `Use All (${item.c})` : `Use All · Mog House Or Nomad Moogle`, disabled: !reachable, onClick: () => { if (char.conn != null) useItem(char.conn, item.id, true, bag.id, item.s); } });
    verbs.push({ icon: ICN.use, label: 'Use One Everywhere', onClick: () => openUseAll(item.id, item.n, false) });
    verbs.push({ icon: ICN.use, label: 'Use All Everywhere', onClick: () => openUseAll(item.id, item.n) });
    if (item.c > 1) verbs.push({ icon: ICN.use, label: reachable ? 'Use Amount…' : 'Use Amount · Mog House Or Nomad Moogle', disabled: !reachable, onClick: () => setUseAmt(true) });
  }
  if (vendorable) verbs.push({
    icon: ICN.sell,
    label: sellOk ? 'Sell…' : !reachable ? 'Sell · Mog House Or Nomad Moogle' : !exp ? 'Sell · Requires Experimental Features' : !sell.anywhere ? 'Sell · Enable Auto-Sell In Towns' : 'Sell · Not In A Town',
    disabled: !sellOk,
    onClick: () => setSelling(true),
  });
  if (canDrop) verbs.push({ icon: ICN.drop, label: reachable ? 'Drop' : 'Drop · Mog House Or Nomad Moogle', tone: 'red', disabled: !reachable, onClick: askDropNow });
  if (allMatches.chars > 0) verbs.push({ icon: ICN.drop, label: `Drop Everywhere${allMatches.items ? ` (${allMatches.items})` : ''}`, tone: 'red', onClick: () => setConfirm('party') });
  verbs.push({ icon: ICN.drop, label: `Add To Drop List & Drop All${allMatches.items ? ` (${allMatches.items})` : ''}`, tone: 'red', onClick: () => setConfirm('all') });

  return (
    <>
      {/* Inactive quick-actions hide at rest and reveal on row hover, so item names get the full row width
          instead of being crushed by six always-on buttons. Active ones stay visible so their state (on
          the watch/wishlist/drop/sell/lot list) is never lost at a glance, and the ⋯ menu is always there. */}
      <ActBtn sm tone="accent" active={watched} className={watched ? undefined : REVEAL_ON_HOVER} onClick={() => setWatchOpen(true)} title="Add To Watchlist">{ICN.watch}</ActBtn>
      <ActBtn sm tone="accent" active={wished} className={wished ? undefined : REVEAL_ON_HOVER} disabled={!auctionable} onClick={() => (wished ? removeWish(item.id) : addWish({ id: item.id, n: item.n }, (item.ms ?? 1) > 1))} title={!auctionable ? 'Cannot Be Auctioned' : wished ? 'On AH Wishlist' : 'Add to AH Wishlist'}>{ICN.wishlist}</ActBtn>
      <ActBtn sm tone="amber" active={inDrop} className={inDrop ? undefined : REVEAL_ON_HOVER} onClick={toggleDrop} title={inDrop ? 'On Drop List' : 'Add to Drop List'}>{ICN.ban}</ActBtn>
      <ActBtn sm tone="accent" active={inSell} className={inSell ? undefined : REVEAL_ON_HOVER} onClick={() => setShopSell({ ...sell, items: inSell ? sell.items.filter((n) => n.toLowerCase() !== item.n.toLowerCase()) : [...sell.items, item.n] })} title={inSell ? 'On Sell List' : 'Add To Sell List'}>{ICN.sell}</ActBtn>
      <ActBtn sm tone="accent" active={inLot} className={inLot ? undefined : REVEAL_ON_HOVER} onClick={toggleLot} title={inLot ? 'On Lot List' : 'Add To Lot List'}>{ICN.lot}</ActBtn>
      {verbs.length > 0 && <ActionMenu actions={verbs} />}
      {confirm && <DropConfirmModal kind={confirm} item={item} charName={char.name} fromBag={bag.id !== 0 ? bagName(bag.id, bag.b) : undefined} allCount={confirm === 'all' || confirm === 'party' ? allMatches : undefined} onCancel={() => setConfirm(null)} onConfirm={confirm === 'now' ? doDropNow : confirm === 'all' ? dropEverywhere : confirm === 'party' ? dropOnParty : confirmAddList} />}
      {moving && <MoveModal char={char} fromBag={bag} item={item} bags={bags} onClose={() => setMoving(false)} />}
      {consoAssign && <ConsolidateAssignModal item={item} assets={char.assets} defaultChar={char.name} onClose={() => setConsoAssign(false)} />}
      {presetOpen && <StoragePresetModal item={item} defaultChar={char.name} assets={char.assets} onClose={() => setPresetOpen(false)} />}
      {trading && <TradePlayerModal char={char} items={[item]} iconSet={iconSet} assets={char.assets} onClose={() => setTrading(false)} />}
      {useAmt && <UseAmountModal char={char} bag={bag} item={item} onClose={() => setUseAmt(false)} />}
      {watchOpen && <AddToWatchModal item={item} assets={char.assets} iconSet={iconSet} onClose={() => setWatchOpen(false)} />}
      {movingInv && <MoveToInvModal char={char} bag={bag} item={item} onClose={() => setMovingInv(false)} />}
      {selling && <SellModal char={char} bag={bag} item={item} onClose={() => setSelling(false)} />}
      {bazaaring && char.conn != null && <BazaarPriceModal conn={char.conn} items={[{ id: item.id, n: item.n, c: item.c, s: item.s, bz: item.bz }]} server={server} iconSet={iconSet} assets={char.assets} onClose={() => setBazaaring(false)} />}
    </>
  );
}

function MoveToInvModal({ char, bag, item, onClose }: { char: KnownChar; bag: InvBag; item: InvItem; onClose: () => void }) {
  const [count, setCount] = useState(item.c);
  const submit = (close: () => void) => {
    if (char.conn == null) return;
    moveItem(char.conn, item.id, bag.id, 0, Math.max(1, Math.min(count, item.c)), item.s);
    close();
  };
  return (
    <Modal onClose={onClose} panelClass="w-[min(92vw,340px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-bold text-fg truncate">{item.n}</div>
            <span className="ml-auto text-[10px] text-fg-4 shrink-0">in <span className={`font-medium ${bagColor(bag.id).text}`}>{bagName(bag.id, bag.b)}</span> · {item.c}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[11px] text-fg-4">Move</span>
            <Stepper value={count} min={1} max={item.c} onChange={setCount} className="shrink-0" />
            <span className="text-[11px] text-fg-4">to Inventory</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => submit(close)} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Move {count}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// "Use All" but capped to a specific number of uses. The addon counts the item across
// inventory + satchel/sack/case and pulls stacks as it goes, so the cap is that total.
function UseAmountModal({ char, bag, item, onClose }: { char: KnownChar; bag: InvBag; item: InvItem; onClose: () => void }) {
  const total = useMemo(() => {
    let n = 0;
    for (const b of char.inv ?? []) if (b.id === 0 || b.id === 5 || b.id === 6 || b.id === 7) for (const it of b.items) if (it.id === item.id) n += it.c;
    return n;
  }, [char.inv, item.id]);
  const cap = Math.max(1, total);
  const [count, setCount] = useState(cap);
  const n = Math.max(1, Math.min(count, cap));
  const submit = (close: () => void) => {
    if (char.conn == null) return;
    useItem(char.conn, item.id, false, bag.id, item.s, n);
    close();
  };
  return (
    <Modal onClose={onClose} panelClass="w-[min(92vw,360px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-bold text-fg truncate">{item.n}</div>
            <span className="ml-auto text-[10px] text-fg-4 shrink-0 tabular-nums">{total} available</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[11px] text-fg-4">Use</span>
            <Stepper value={n} min={1} max={cap} onChange={setCount} className="shrink-0" />
            <span className="text-[11px] text-fg-4">time{n === 1 ? '' : 's'}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setCount(Math.max(1, Math.floor(total / 2)))} className="le-tap px-2 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 transition-colors">Half</button>
              <button onClick={() => setCount(cap)} className="le-tap px-2 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 transition-colors">All</button>
            </div>
          </div>
          <Slider value={n} min={1} max={cap} step={1} onChange={setCount} />
          <div className="flex items-center gap-2">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => submit(close)} disabled={total <= 0} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Use ×{n}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function SellModal({ char, bag, item, onClose }: { char: KnownChar; bag: InvBag; item: InvItem; onClose: () => void }) {
  const [count, setCount] = useState(item.c);
  const fromInv = bag.id === 0;
  const submit = (close: () => void) => {
    if (char.conn == null) return;
    shopSell(char.conn, item.id, Math.max(1, Math.min(count, item.c)), bag.id, item.s);
    close();
  };
  return (
    <Modal onClose={onClose} panelClass="w-[min(92vw,340px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-bold text-fg truncate">{item.n}</div>
            <span className="ml-auto text-[10px] text-fg-4 shrink-0">in <span className={`font-medium ${bagColor(bag.id).text}`}>{bagName(bag.id, bag.b)}</span>{item.c > 1 ? ` · ${item.c}` : ''}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[11px] text-fg-4">Sell</span>
            {item.c > 1 ? <Stepper value={count} min={1} max={item.c} onChange={setCount} className="shrink-0" /> : <span className="text-[12px] text-fg-2">1</span>}
            {!fromInv && <span className="text-[10px] text-fg-4">moved to inventory first</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => submit(close)} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Sell {item.c > 1 ? count : 1}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

const FLAG_BADGES: { bit: number; label: string; tone: string }[] = [
  { bit: 1, label: 'Rare', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  { bit: 2, label: 'Ex', tone: 'text-red-300 border-red-500/40 bg-red-500/10' },
  { bit: 8, label: 'No AH', tone: 'text-fg-4 border-line bg-field' },
  { bit: 16, label: 'No Vendor', tone: 'text-fg-4 border-line bg-field' },
  { bit: 32, label: 'No Send', tone: 'text-fg-4 border-line bg-field' },
];

const ItemDetailBlock = memo(function ItemDetailBlock({ item, server }: { item: InvItem; server?: string }) {
  const description = useItemDescription(item.id);
  const auctionable = !(item.f && (item.f & 8));
  const market = useRowMarket(item.id, false, server, auctionable);
  const f = item.f ?? 0;
  const badges = FLAG_BADGES.filter((b) => f & b.bit);
  return (
    <div className="flex flex-col gap-1.5">
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map((b) => (
            <span key={b.label} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${b.tone}`}>{b.label}</span>
          ))}
        </div>
      )}
      {auctionable && (
        <div className="text-[11px] tabular-nums">
          {market === undefined
            ? <span className="text-fg-4">Checking AH price…</span>
            : market && market.median
              ? <span className="text-fg-4">AH median <span className="text-fg-2 font-semibold">{market.median} gil</span> · {market.stock ?? '0'} listed</span>
              : <span className="text-fg-4">No recent AH sales</span>}
        </div>
      )}
      {description && <p className="text-[11px] text-fg-3 leading-snug whitespace-pre-wrap max-h-24 overflow-y-auto">{description}</p>}
    </div>
  );
});

function MoveModal({ char, fromBag, item, bags, onClose }: { char: KnownChar; fromBag: InvBag; item: InvItem; bags: InvBag[]; onClose: () => void }) {
  const exp = useSettings().experimentalFeatures;
  const dests = bags.filter((b) => b.id !== fromBag.id && b.id !== 17 && (b.id === 0 || bagReachable(b.id, !!char.mog, nomadReachable(char, exp))));
  const [destName, setDestName] = useState(dests[0] ? bagName(dests[0].id, dests[0].b) : '');
  const [count, setCount] = useState(item.c);
  const dest = dests.find((b) => bagName(b.id, b.b) === destName);

  const submit = (close: () => void) => {
    if (char.conn == null || !dest) return;
    moveItem(char.conn, item.id, fromBag.id, dest.id, Math.max(1, Math.min(count, item.c)), item.s);
    close();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(92vw,340px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-bold text-fg truncate">{item.n}</div>
            <span className="ml-auto text-[10px] text-fg-4 shrink-0">in <span className={`font-medium ${bagColor(fromBag.id).text}`}>{bagName(fromBag.id, fromBag.b)}</span>{item.c > 1 ? ` · ${item.c}` : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            {item.c > 1 && (
              <Stepper value={count} min={1} max={item.c} onChange={setCount} className="shrink-0" />
            )}
            <span className="shrink-0 text-[11px] text-fg-4">to</span>
            <div className="flex-1 min-w-0"><Select
              value={destName}
              onChange={setDestName}
              options={dests.map((b) => bagName(b.id, b.b))}
              renderOption={(n) => {
                const b = dests.find((x) => bagName(x.id, x.b) === n);
                const free = b ? b.max - b.used : 0;
                const c = bagColor(b?.id);
                return (
                  <span className="flex items-center gap-2 min-w-0 w-full">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                    <span className={`truncate ${c.text}`}>{n}</span>
                    {b && <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${free <= 0 ? 'text-red-300' : free <= 3 ? 'text-amber-300' : 'text-fg-4'}`}>{b.used}/{b.max}</span>}
                  </span>
                );
              }}
              full
            /></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => submit(close)} disabled={!dest} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">Move</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function BulkBar({ char, items, canAct, freeSlots, sellAnywhere, hasTradeTarget, onSelectAll, onClear, onAh, onTrade, onBulk }: {
  char: KnownChar; items: SelItem[]; bags: InvBag[]; canAct: boolean; freeSlots: number; sellAnywhere: boolean; hasTradeTarget: boolean;
  onSelectAll: () => void; onClear: () => void; onAh: () => void; onTrade: () => void; onBulk: (k: BulkAction) => void;
}) {
  const n = items.length;
  const exp = useSettings().experimentalFeatures;
  const nomadOk = nomadReachable(char, exp);
  const reachable = n > 0 && items.every((it) => it.bag === 0 || bagReachable(it.bag, !!char.mog, nomadOk));
  const hasInv = items.some((it) => it.bag === 0);
  const ahCount = items.filter((it) => !(it.f && (it.f & 0x0A))).length;
  const tradeN = items.filter((it) => it.bag === 0 && !(it.f && (it.f & 0x02))).length;
  const usableN = items.filter((it) => !!it.u).length;
  const vendorN = items.filter((it) => !(it.f && (it.f & 0x10))).length;
  const has = n > 0 && canAct;
  const Btn = ({ label, onClick, disabled, tone }: { label: string; onClick: () => void; disabled?: boolean; tone?: 'red' | 'accent' }) => (
    <button onClick={onClick} disabled={disabled} className={`px-3 py-2 text-[11px] font-semibold rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tone === 'red' ? 'border-red-500/40 text-red-300 enabled:hover:bg-red-500/10 bg-transparent' : tone === 'accent' ? 'bg-accent text-on-accent border-transparent enabled:hover:bg-accent-hover' : 'border-line bg-field text-fg-2 enabled:hover:border-accent/40'}`}>{label}</button>
  );
  const miniBtn = 'le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-line-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
  return (
    <div className="shrink-0 border-t-2 border-accent bg-[var(--color-bg)] shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="text-[12px] text-fg-2"><span className="font-bold text-accent tabular-nums">{n}</span> selected</span>
        <button onClick={onSelectAll} className={miniBtn}>Select All</button>
        <button onClick={onClear} disabled={n === 0} className={miniBtn}>Clear</button>
        <span className="ml-auto text-[11px] font-medium text-fg-4">{freeSlots === 0 ? <><span className="font-bold text-red-400">No</span> AH Listing Slots Available</> : <><span className={`font-bold tabular-nums ${freeSlots <= 2 ? 'text-amber-400' : 'text-emerald-400'}`}>{freeSlots}</span> AH Listing Slot{freeSlots === 1 ? '' : 's'} Available</>}</span>
      </div>
      <div className="flex flex-nowrap gap-1.5 px-3 py-2.5 [&>button]:flex-1 [&>button]:min-w-0 [&>button]:whitespace-nowrap [&>button]:px-2">
        <Btn label={`Move${n ? ` (${n})` : ''}`} disabled={!has || !reachable} onClick={() => onBulk('move')} />
        {hasInv && <Btn label={`Trade${tradeN ? ` (${Math.min(tradeN, 8)})` : ''}`} disabled={!has || tradeN === 0 || !hasTradeTarget} onClick={onTrade} />}
        <Btn label={`List${ahCount ? ` (${Math.min(ahCount, freeSlots)})` : ''}`} tone="accent" disabled={!has || ahCount === 0 || freeSlots === 0} onClick={onAh} />
        {hasInv && <Btn label="Bazaar" disabled={!has} onClick={() => onBulk('bazaar')} />}
        <Btn label="Sell" disabled={!has || vendorN === 0 || !(sellAnywhere && exp) || !char.inTown || !reachable} onClick={() => onBulk('sell')} />
        {usableN > 0 && <Btn label={`Use (${usableN})`} disabled={!has || !reachable} onClick={() => onBulk('use')} />}
        <Btn label="Drop" tone="red" disabled={!has || !reachable} onClick={() => onBulk('drop')} />
      </div>
    </div>
  );
}

const CSTATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const CSTATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

function GlobalConsolidateBar({ plan, stacks, qty, known, activeName, experimental, onSelectAll, onClear, onBack, onClose }: {
  plan: Record<string, Record<number, number>>; stacks: number; qty: number; known: KnownChar[]; activeName?: string; experimental: boolean; onSelectAll: () => void; onClear: () => void; onBack: () => void; onClose: () => void;
}) {
  const anon = useAnon();
  const run = useConsolidate();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const senderNames = Object.keys(plan);
  const [collector, setCollector] = useState('');
  const [confirm, setConfirm] = useState(false);
  const collName = (collector && online.some((k) => k.name === collector)) ? collector
    : (activeName && online.some((k) => k.name === activeName)) ? activeName
    : (online[0]?.name ?? '');
  const collChar = online.find((k) => k.name === collName);
  const collZone = collChar?.zone;
  const senders = useMemo(() => senderNames.map((n) => known.find((k) => k.name === n)).filter((k): k is KnownChar => !!k && k.online && k.conn != null && k.name !== collName), [senderNames, known, collName]);
  const collInMog = !!collChar?.mog;
  const sameZone = senders.filter((s) => s.zone != null && s.zone === collZone);
  const outOfZone = senders.filter((s) => !(s.zone != null && s.zone === collZone));
  const inMog = sameZone.filter((s) => s.mog);
  const reachableSenders = sameZone.filter((s) => !s.mog);
  const wantOf = (s: KnownChar, id: number, picked: number) => Math.min(picked, consolidableTotal(s, id, experimental));
  const entriesFor = (s: KnownChar) => Object.entries(plan[s.name] ?? {}).map(([id, q]) => [Number(id), q] as const);
  const actionable = reachableSenders.filter((s) => entriesFor(s).some(([id, q]) => wantOf(s, id, q) > 0));
  const blocked = reachableSenders.filter((s) => !actionable.includes(s));
  const skippedKinds = reachableSenders.reduce((n, s) => n + entriesFor(s).filter(([id, q]) => wantOf(s, id, q) === 0).length, 0);
  const collBag = collChar?.inv?.find((b) => b.id === 0);
  const collFree = collBag ? Math.max(0, collBag.max - collBag.used) : 0;
  const distinct = new Set<number>();
  for (const s of actionable) for (const [id, q] of entriesFor(s)) if (wantOf(s, id, q) > 0) distinct.add(id);
  const running = run.running;
  const showRun = running || run.order.length > 0;
  const ready = !!collChar && !collInMog && actionable.length > 0 && collFree > 0 && distinct.size > 0 && !running;

  const breakdown = actionable.map((s) => ({ name: s.name, count: entriesFor(s).reduce((n, [id, q]) => n + wantOf(s, id, q), 0) }));
  const moveTotal = breakdown.reduce((n, b) => n + b.count, 0);

  const start = () => {
    if (!ready) return;
    const filtered: Record<string, Record<number, number>> = {};
    for (const s of actionable) filtered[s.name] = plan[s.name];
    void runConsolidateSelection(collName, filtered, experimental);
    setConfirm(false);
  };

  const miniBtn = 'le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-line-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="shrink-0 border-t-2 border-accent bg-[var(--color-bg)] shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)]">
      {showRun && (
        <div className="border-b border-line max-h-[28vh] overflow-y-auto divide-y divide-line">
          {run.order.map((nm) => {
            const cs = run.chars[nm];
            if (!cs) return null;
            return (
              <div key={nm} className="px-3 py-1.5 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${CSTATUS_DOT[cs.status]}`} />
                <span className="text-[12px] text-fg-2 font-semibold min-w-0 truncate">{anon(nm)}</span>
                <span className="text-[11px] text-fg-4 shrink-0">{CSTATUS_LABEL[cs.status]}</span>
                <span className="ml-auto text-[11px] tabular-nums text-fg-3 shrink-0">{cs.sent}/{cs.goal}</span>
                {cs.note && <span className="text-[10px] text-red-300 shrink-0 max-w-[140px] truncate" title={cs.note}>{cs.note}</span>}
              </div>
            );
          })}
          {run.error && <div className="px-3 py-1.5 text-[11px] text-red-300">{run.error}</div>}
        </div>
      )}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button onClick={onSelectAll} disabled={running} className={miniBtn}>Select All</button>
        <button onClick={onClear} disabled={running || stacks === 0} className={miniBtn}>Clear</button>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-fg-4 shrink-0">Collect To</span>
          <div className="w-40"><CharacterSelect value={collName} onChange={setCollector} chars={online} /></div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="shrink-0 text-[12px] text-fg-2"><span className="font-bold text-accent tabular-nums">{stacks}</span> selected · <span className="tabular-nums">{qty}</span> item{qty === 1 ? '' : 's'} · {senderNames.length} char{senderNames.length === 1 ? '' : 's'}</span>
          {outOfZone.length > 0 && <span className="text-amber-300 truncate">· {outOfZone.map((s) => anon(s.name)).join(', ')} not in {anon(collName)}'s zone (skipped)</span>}
          {inMog.length > 0 && <span className="text-amber-300 truncate">· {inMog.map((s) => anon(s.name)).join(', ')} in a Mog House (can't trade)</span>}
          {blocked.length > 0 && <span className="text-amber-300 truncate">· {blocked.map((s) => anon(s.name)).join(', ')} have nothing tradable reachable here</span>}
        </div>
        {collInMog ? <span className="shrink-0 text-red-300 font-semibold">{anon(collName)} Is In A Mog House</span>
          : collFree === 0 ? <span className="shrink-0 text-red-300 font-semibold">No Free Slots In Inventory</span>
          : <span className="shrink-0 text-fg-4"><span className={`font-bold tabular-nums ${collFree <= 3 ? 'text-amber-400' : 'text-emerald-400'}`}>{collFree}</span> Free Slot{collFree === 1 ? '' : 's'} In Inventory</span>}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        {!running && <button onClick={onBack} className="px-3 py-2 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">← Actions</button>}
        <button onClick={onClose} className="px-3 py-2 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:border-accent/40 transition-colors">Done</button>
        <div className="flex-1" />
        {showRun && !running && <button onClick={clearConsolidate} className="px-3 py-2 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Dismiss</button>}
        {running
          ? <button onClick={stopConsolidate} className="px-4 py-2 text-[11px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>
          : <button onClick={() => setConfirm(true)} disabled={!ready} className="px-4 py-2 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Trade To {collName ? anon(collName) : '…'}{actionable.length > 1 ? ` (${actionable.length})` : ''}</button>}
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(false)} panelClass="w-[min(94vw,420px)] p-4 gap-3">
          {(close) => (
            <>
              <div className="text-[14px] font-bold text-fg">Consolidate Onto {anon(collName)}?</div>
              <div className="text-[12px] text-fg-3">
                Gathering <span className="font-semibold text-fg-2 tabular-nums">{moveTotal}</span> item{moveTotal === 1 ? '' : 's'} from <span className="font-semibold text-fg-2">{actionable.length}</span> character{actionable.length === 1 ? '' : 's'} to consolidate to <span className="font-semibold text-fg-2">{anon(collName)}</span>. Proceed?
              </div>
              <div className="flex flex-col gap-1 max-h-[34vh] overflow-y-auto">
                {breakdown.map((b) => (
                  <div key={b.name} className="flex items-center gap-2 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-400" />
                    <span className="text-[12px] text-fg-2 truncate flex-1">{anon(b.name)}</span>
                    <span className="text-[11px] text-fg-4 tabular-nums shrink-0">{b.count} item{b.count === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
              {skippedKinds > 0 && <div className="text-[11px] text-amber-300">{skippedKinds} selected item type{skippedKinds === 1 ? '' : 's'} are Exclusive or out of reach here and will be skipped.</div>}
              {collFree <= actionable.length && <div className="text-[11px] text-amber-300">{anon(collName)} has {collFree} free inventory slot{collFree === 1 ? '' : 's'}; trades that overflow will stop.</div>}
              {(outOfZone.length > 0 || inMog.length > 0 || blocked.length > 0) && <div className="text-[11px] text-amber-300">{[...outOfZone, ...inMog, ...blocked].map((s) => anon(s.name)).join(', ')} will be skipped.</div>}
              <div className="flex items-center gap-2">
                <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                <button onClick={start} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Trade To {anon(collName)}</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// The action menu for a cross-character selection (all-characters search + MULTI). Consolidate
// keeps its own dedicated bar; Move/Use/Drop run per character via GlobalBulkModal.
function GlobalBulkBar({ groups, qty, onSelectAll, onClear, onClose, onConsolidate, onTrade, onAction }: {
  groups: { char: KnownChar; items: SelItem[] }[]; qty: number;
  onSelectAll: () => void; onClear: () => void; onClose: () => void;
  onConsolidate: () => void; onTrade: () => void; onAction: (k: 'move' | 'use' | 'drop') => void;
}) {
  const stacks = groups.reduce((n, g) => n + g.items.length, 0);
  const chars = groups.length;
  const usableN = groups.reduce((n, g) => n + g.items.filter((it) => !!it.u).length, 0);
  const miniBtn = 'le-tap px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-line-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
  const base = 'px-3 py-2 text-[11px] font-semibold rounded-md border disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
  const neutral = `${base} border-line bg-field text-fg-2 enabled:hover:border-accent/40`;
  const accentBtn = `${base} border-transparent bg-accent text-on-accent enabled:hover:bg-accent-hover`;
  const dangerBtn = `${base} border-red-500/40 bg-field text-red-300 enabled:hover:bg-red-500/10`;
  return (
    <div className="shrink-0 border-t-2 border-accent bg-[var(--color-bg)] shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="text-[12px] text-fg-2"><span className="font-bold text-accent tabular-nums">{stacks}</span> selected · <span className="tabular-nums">{qty}</span> item{qty === 1 ? '' : 's'} · {chars} char{chars === 1 ? '' : 's'}</span>
        <button onClick={onSelectAll} className={miniBtn}>Select All</button>
        <button onClick={onClear} disabled={stacks === 0} className={miniBtn}>Clear</button>
        <button onClick={onClose} className={`${miniBtn} ml-auto`}>Done</button>
      </div>
      <div className="flex flex-nowrap gap-1.5 px-3 py-2.5 [&>button]:flex-1 [&>button]:min-w-0 [&>button]:whitespace-nowrap">
        <button onClick={onConsolidate} disabled={stacks === 0} className={accentBtn}>Consolidate</button>
        <button onClick={onTrade} disabled={stacks === 0} className={neutral}>Trade</button>
        <button onClick={() => onAction('move')} disabled={stacks === 0} className={neutral}>Move</button>
        <button onClick={() => onAction('use')} disabled={usableN === 0} className={neutral}>Use{usableN ? ` (${usableN})` : ''}</button>
        <button onClick={() => onAction('drop')} disabled={stacks === 0} className={dangerBtn}>Drop</button>
      </div>
    </div>
  );
}

const G_DEST_BAGS: { id: number; name: string }[] = [
  { id: 0, name: 'Inventory' }, { id: 5, name: 'Satchel' }, { id: 6, name: 'Sack' },
  { id: 7, name: 'Case' }, { id: 8, name: 'Wardrobe' }, { id: 10, name: 'Wardrobe 2' },
];

// Runs Move/Use/Drop over a cross-character selection: each character acts on its own copies via
// its own connection. Items in unreachable Mog storage, on offline characters, or (for Use)
// non-usable items are filtered out per character, so the preview is exactly what will happen.
function GlobalBulkModal({ kind, groups, iconSet, experimental, onClose, onDone }: {
  kind: 'move' | 'use' | 'drop'; groups: { char: KnownChar; items: SelItem[] }[];
  iconSet: Set<number>; experimental: boolean; onClose: () => void; onDone: () => void;
}) {
  const anon = useAnon();
  const [destId, setDestId] = useState(0);
  const elig = useMemo(() => groups.map((g) => {
    const nomadOk = nomadReachable(g.char, experimental);
    const items = g.items.filter((it) => it.bag !== 17
      && (it.bag === 0 || bagReachable(it.bag, !!g.char.mog, nomadOk))
      && (kind !== 'use' || !!it.u)
      && (kind !== 'move' || it.bag !== destId));
    return { char: g.char, items };
  }).filter((g) => g.char.online && g.char.conn != null && g.items.length > 0), [groups, kind, destId, experimental]);
  const total = elig.reduce((n, g) => n + g.items.length, 0);
  const meta = { move: { title: 'Move Items', verb: 'Move', tone: 'accent' as const }, use: { title: 'Use Items', verb: 'Use', tone: 'red' as const }, drop: { title: 'Drop Items', verb: 'Drop', tone: 'red' as const } }[kind];

  const run = () => {
    let count = 0;
    for (const g of elig) {
      const conn = g.char.conn;
      if (conn == null) continue;
      for (const it of g.items) {
        if (kind === 'move') moveItem(conn, it.id, it.bag, destId, it.c, it.s);
        else if (kind === 'drop') dropOne(conn, it.s, it.id, it.bag, it.c);
        else if (kind === 'use') useItem(conn, it.id, true, it.bag, it.s);
        count++;
      }
    }
    const sfx = count === 1 ? '' : 's';
    const words = { move: ['Moving', 'Moved'], drop: ['Dropping', 'Dropped'], use: ['Using', 'Used'] }[kind];
    startBulkOp(`${words[0]} ${count} item${sfx} across ${elig.length} character${elig.length === 1 ? '' : 's'}…`, `${words[1]} ${count} item${sfx}`, count);
    onDone();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,440px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="text-[14px] font-bold text-fg">{meta.title}<span className="text-fg-4 font-medium"> · {elig.length} character{elig.length === 1 ? '' : 's'}</span></div>
          {kind === 'move' && (
            <div className="flex items-center gap-2"><span className="text-[11px] text-fg-4 shrink-0">To bag</span><div className="flex-1 min-w-0">
              <Select value={String(destId)} onChange={(v) => setDestId(Number(v))} options={G_DEST_BAGS.map((b) => String(b.id))} full
                renderValue={(v) => G_DEST_BAGS.find((b) => String(b.id) === v)?.name ?? v} renderOption={(v) => G_DEST_BAGS.find((b) => String(b.id) === v)?.name ?? v} />
            </div></div>
          )}
          <div className="flex flex-col gap-1 max-h-[42vh] overflow-y-auto">
            {elig.map((g) => (
              <div key={g.char.name} className="rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" /><span className="text-[12px] font-semibold text-fg-2 truncate flex-1">{anon(g.char.name)}</span><span className="text-[11px] text-fg-4 tabular-nums shrink-0">{g.items.length}</span></div>
                <div className="flex flex-wrap gap-1">
                  {g.items.map((it) => <div key={`${it.bag}:${it.s}`} title={it.n} className="w-6 h-6 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={24} name={it.n} assets={g.char.assets} bmpHas={iconSet.has(it.id)} /></div>)}
                </div>
              </div>
            ))}
          </div>
          {total === 0 && <div className="text-[11px] text-fg-4">No eligible items{kind === 'use' ? ' (nothing usable)' : ''}. Items in unreachable Mog storage or on offline characters are skipped.</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={run} disabled={total === 0} className={`flex-1 px-3 py-2 text-[12px] font-bold rounded-md disabled:opacity-40 transition-colors ${meta.tone === 'red' ? 'bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25' : 'bg-accent text-on-accent hover:bg-accent-hover'}`}>{meta.verb} {total}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// Cross-character trade: send exactly the selected items to one recipient. Reuses the consolidate
// trade engine (runConsolidateSelection) so all the in-game rules apply -- the recipient can't be
// in a Mog House, and each holder must be within trade range of the recipient (near them in the
// same zone). Holders that can't reach the recipient, or whose selected items are Ex / in
// unreachable storage, are skipped. Progress then shows in the consolidate/trade bar.
function GlobalTradeModal({ groups, known, experimental, onClose, onDone }: {
  groups: { char: KnownChar; items: SelItem[] }[]; known: KnownChar[]; experimental: boolean; onClose: () => void; onDone: () => void;
}) {
  const anon = useAnon();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const [recip, setRecip] = useState('');
  const recipName = recip && online.some((k) => k.name === recip) ? recip : (online[0]?.name ?? '');
  const recipChar = online.find((k) => k.name === recipName);
  const recipInMog = !!recipChar?.mog;

  const senders = useMemo(() => groups.filter((g) => g.char.name !== recipName).map((g) => {
    const inRange = !!recipChar && !recipInMog && !g.char.mog && g.char.online && g.char.conn != null && withinTradeRange(g.char, recipChar);
    const items = inRange ? g.items.filter((it) => bagConsolidatable(g.char, it.bag, experimental) && !(it.f != null && (it.f & FLAG_NOTRADE))) : [];
    return { char: g.char, items };
  }), [groups, recipName, recipChar, recipInMog, experimental]);
  const actionable = senders.filter((s) => s.items.length > 0);
  const blocked = senders.filter((s) => s.items.length === 0);
  const total = actionable.reduce((n, s) => n + s.items.reduce((q, it) => q + it.c, 0), 0);
  const ready = !!recipChar && !recipInMog && actionable.length > 0;

  const run = () => {
    if (!ready) return;
    const bySender: Record<string, Record<number, number>> = {};
    for (const s of actionable) { const m = (bySender[s.char.name] ??= {}); for (const it of s.items) m[it.id] = (m[it.id] ?? 0) + it.c; }
    void runConsolidateSelection(recipName, bySender, experimental);
    onDone();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,440px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="text-[14px] font-bold text-fg">Trade Selection</div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-fg-4 shrink-0">Trade to</span><div className="flex-1 min-w-0"><CharacterSelect value={recipName} onChange={setRecip} chars={online} /></div></div>
          {recipInMog && <div className="text-[11px] text-red-300">{anon(recipName)} is in a Mog House and can't receive trades.</div>}
          <div className="flex flex-col gap-1 max-h-[38vh] overflow-y-auto">
            {actionable.map((s) => {
              const q = s.items.reduce((n, it) => n + it.c, 0);
              return (
                <div key={s.char.name} className="flex items-center gap-2 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-[12px] text-fg-2 truncate flex-1">{anon(s.char.name)}</span>
                  <span className="text-[11px] text-fg-4 tabular-nums shrink-0">{q} item{q === 1 ? '' : 's'}</span>
                </div>
              );
            })}
          </div>
          {blocked.length > 0 && <div className="text-[11px] text-amber-300">{blocked.map((s) => anon(s.char.name)).join(', ')} skipped (not near {anon(recipName)}, in a Mog House, or nothing tradable selected).</div>}
          {actionable.length === 0 && !recipInMog && <div className="text-[11px] text-fg-4">No selected character can trade to {anon(recipName)} right now. They must be standing near {anon(recipName)}.</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={run} disabled={!ready} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Trade To {anon(recipName)}{total ? ` (${total})` : ''}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function BulkModal({ kind, char, items, bags, iconSet, assets, onClose, onDone }: {
  kind: BulkAction; char: KnownChar; items: SelItem[]; bags: InvBag[]; iconSet: Set<number>; assets?: string; onClose: () => void; onDone: () => void;
}) {
  const conn = char.conn;
  const settings = useSettings();
  const exp = settings.experimentalFeatures;
  const server = settings.ahServer;
  const nomadOk = nomadReachable(char, exp);
  const singleSrc = useMemo(() => { const s = new Set(items.map((it) => it.bag)); return s.size === 1 ? [...s][0] : null; }, [items]);
  const dests = useMemo(() => bags.filter((b) => b.id !== singleSrc && b.id !== 17 && (b.id === 0 || bagReachable(b.id, !!char.mog, nomadOk))), [bags, singleSrc, char.mog, nomadOk]);
  const [destName, setDestName] = useState(dests[0] ? bagName(dests[0].id, dests[0].b) : '');
  const dest = dests.find((b) => bagName(b.id, b.b) === destName);
  // Per-item bazaar prices, keyed by inventory slot, pre-filled with each item's AH median when an
  // AH server is configured. "Set all" and "AH median" fill them in bulk; every field is editable.
  const [prices, setPrices] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    for (const it of items) if (it.bag === 0) { const md = server ? getCachedValue(server, it.id)?.median : undefined; if (md && md > 0) m[it.s] = String(md); }
    return m;
  });
  const [bulkPrice, setBulkPrice] = useState('');

  const shown = kind === 'use' ? items.filter((it) => !!it.u)
    : kind === 'sell' ? items.filter((it) => !(it.f && (it.f & 0x10)))
    : kind === 'bazaar' ? items.filter((it) => it.bag === 0)
    : items;

  const meta = {
    move: { title: 'Move Items', verb: `Move ${shown.length}`, tone: 'accent' as const },
    bazaar: { title: 'Bazaar Items', verb: `Bazaar ${shown.length}`, tone: 'accent' as const },
    sell: { title: 'Sell To Vendor', verb: `Sell ${shown.length}`, tone: 'accent' as const },
    drop: { title: 'Drop Items', verb: `Drop ${shown.length}`, tone: 'red' as const },
    use: { title: 'Use Items', verb: `Use ${shown.length}`, tone: 'red' as const },
  }[kind];

  const priceOf = (it: SelItem) => prices[it.s] ?? '';
  const numOf = (v: string) => Math.max(0, Math.floor(Number(String(v).replace(/[^0-9]/g, '')) || 0));
  const setAllPrices = (v: string) => setPrices(() => { const m: Record<number, string> = {}; for (const it of shown) m[it.s] = v; return m; });
  const useMedians = () => setPrices(() => { const m: Record<number, string> = {}; for (const it of shown) { const md = server ? getCachedValue(server, it.id)?.median : undefined; if (md && md > 0) m[it.s] = String(md); } return m; });
  const bazaarPriced = kind === 'bazaar' ? shown.map((it) => ({ s: it.s, price: numOf(priceOf(it)) })).filter((x) => x.price > 0) : [];

  const run = () => {
    if (conn == null) return;
    if (kind === 'move') { if (!dest) return; for (const it of shown) if (it.bag !== dest.id) moveItem(conn, it.id, it.bag, dest.id, it.c, it.s); }
    else if (kind === 'bazaar') bzApply(conn, bazaarPriced.map((x) => ({ index: x.s, price: x.price })));
    else if (kind === 'sell') for (const it of shown) shopSell(conn, it.id, it.c, it.bag, it.s);
    else if (kind === 'drop') for (const it of shown) dropOne(conn, it.s, it.id, it.bag, it.c);
    else if (kind === 'use') for (const it of shown) useItem(conn, it.id, true, it.bag, it.s);
    const n = kind === 'bazaar' ? bazaarPriced.length : shown.length, sfx = n === 1 ? '' : 's';
    const words: Record<BulkAction, [string, string]> = { move: ['Moving', 'Moved'], bazaar: ['Pricing', 'Bazaared'], sell: ['Selling', 'Sold'], drop: ['Dropping', 'Dropped'], use: ['Using', 'Used'] };
    startBulkOp(`${words[kind][0]} ${n} item${sfx}…`, `${words[kind][1]} ${n} item${sfx}`, n);
    onDone();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,420px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="text-[14px] font-bold text-fg">{meta.title}</div>
          {kind === 'move' && (
            <div className="flex items-center gap-2"><span className="text-[11px] text-fg-4 shrink-0">To</span><div className="flex-1 min-w-0"><Select
              value={destName} onChange={setDestName} options={dests.map((b) => bagName(b.id, b.b))} full
              renderOption={(nm) => {
                const b = dests.find((x) => bagName(x.id, x.b) === nm);
                const free = b ? b.max - b.used : 0;
                const c = bagColor(b?.id);
                return (
                  <span className="flex items-center gap-2 min-w-0 w-full">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                    <span className={`truncate ${c.text}`}>{nm}</span>
                    {b && <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${free <= 0 ? 'text-red-300' : free <= 3 ? 'text-amber-300' : 'text-fg-4'}`}>{b.used}/{b.max}</span>}
                  </span>
                );
              }}
            /></div></div>
          )}
          {kind === 'bazaar' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-4 shrink-0">Set all</span>
              <GilInput value={bulkPrice} onChange={(d) => { setBulkPrice(d); setAllPrices(d); }} placeholder="price each" className="flex-1 min-w-0 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
              {server && <button onClick={useMedians} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-accent hover:text-accent-hover transition-colors">AH median</button>}
            </div>
          )}
          <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
            {shown.map((it) => (
              <div key={`${it.bag}:${it.s}`} className="flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={28} name={it.n} assets={assets} bmpHas={iconSet.has(it.id)} /></div>
                <span className="text-[12px] text-fg-2 truncate flex-1">{it.n}</span>
                {it.c > 1 && <span className="text-[11px] text-fg-4 tabular-nums shrink-0">×{it.c}</span>}
                {kind === 'bazaar' && <GilInput value={priceOf(it)} onChange={(d) => setPrices((p) => ({ ...p, [it.s]: d }))} placeholder="price" className="shrink-0 w-24 text-right text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1 text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />}
              </div>
            ))}
          </div>
          {shown.length === 0 && <div className="text-[11px] text-fg-4">No eligible items in the selection.</div>}
          {kind === 'bazaar' && shown.length > 0 && bazaarPriced.length === 0 && <div className="text-[11px] text-amber-300">Set a price to list items.</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={run} disabled={(kind === 'bazaar' ? bazaarPriced.length === 0 : shown.length === 0) || (kind === 'move' && !dest)} className={`flex-1 px-3 py-2 text-[12px] font-bold rounded-md disabled:opacity-40 transition-colors ${meta.tone === 'red' ? 'bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25' : 'bg-accent text-on-accent hover:bg-accent-hover'}`}>{kind === 'bazaar' ? `Bazaar ${bazaarPriced.length}` : meta.verb}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TradeBanner() {
  const job = useTradeJob();
  return (
    <AnimatePresence>
      {job && <TradeBannerInner key={job.id} job={job} />}
    </AnimatePresence>
  );
}

function BulkOpBanner() {
  const op = useBulkOp();
  return (
    <AnimatePresence>
      {op && (
        <motion.div key={op.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }} className="shrink-0 px-3 pt-2">
          <OpCard state={op.state === 'done' ? 'ok' : 'active'} title={op.state === 'done' ? op.done : op.active} count={`${op.count}`} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UseBanner({ char }: { char?: KnownChar }) {
  const up = char?.useProg;
  const conn = char?.conn;
  return (
    <AnimatePresence>
      {up && up.active && conn != null && (
        <motion.div key="usebanner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }} className="shrink-0 px-3 pt-2">
          <OpCard
            state="active"
            title={`Using ${up.name}`}
            count={`${up.done}/${up.total}`}
            pct={up.total > 0 ? Math.round((up.done / up.total) * 100) : 0}
            trailing={<button onClick={() => useStop(conn)} className="shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md border border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors">Stop</button>}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TradeBannerInner({ job }: { job: TradeJob }) {
  const anon = useAnon();
  const result = job.result;
  const pct = job.pct;
  const batchIdx = job.batchIdx;
  const done = result === 'done';
  const failed = result === 'failed' || result === 'failedToStart';
  const tgt = anon(job.target);
  const label = done ? `Traded to ${tgt}` : result === 'failedToStart' ? `Trade did not start, is ${tgt} within 6 yalms?` : result === 'failed' ? `Trade to ${tgt} failed` : `Trading to ${tgt}…${job.batches.length > 1 ? ` (${Math.min(batchIdx + 1, job.batches.length)}/${job.batches.length})` : ''}`;

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }} className="shrink-0 px-3 pt-2">
      <OpCard
        state={done ? 'ok' : failed ? 'fail' : 'active'}
        title={label}
        count={!result ? `${pct}%` : undefined}
        pct={!result ? pct : undefined}
      />
    </motion.div>
  );
}

function TradePlayerModal({ char, items, iconSet, assets, onClose, onStarted }: {
  char: KnownChar; items: InvItem[]; iconSet: Set<number>; assets?: string; onClose: () => void; onStarted?: () => void;
}) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const targets = useMemo(() => (char.mog ? [] : known.filter((k) => k.name !== char.name && k.online && k.conn != null && !k.mog && withinTradeRange(k, char))), [known, char]);
  const tradeable = useMemo(() => items.filter((it) => !(it.f && (it.f & 0x02))), [items]);
  const oneId = useMemo(() => { const ids = [...new Set(tradeable.map((it) => it.id))]; return ids.length === 1 ? ids[0] : null; }, [tradeable]);
  const dropped = items.length - tradeable.length;
  const haveGil = char.gil ?? 0;
  const [destName, setDestName] = useState(targets[0]?.name ?? '');
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(tradeable.map((it) => [it.s, it.c])));
  const [gilAmt, setGilAmt] = useState(0);
  const setGil = (v: number) => setGilAmt(Math.max(0, Math.min(haveGil, Math.floor(v) || 0)));
  const setSlotQty = (slot: number, max: number, v: number) => setQty((q) => ({ ...q, [slot]: Math.max(1, Math.min(max, Math.floor(v) || 1)) }));
  const dest = targets.find((t) => t.name === destName) ?? targets[0];
  const destInv = dest?.inv?.find((b) => b.id === 0);
  const destFree = destInv ? Math.max(0, destInv.max - destInv.used) : 0;
  const roomShort = tradeable.length > destFree;
  const ready = !!dest && dest.conn != null && (tradeable.length > 0 || gilAmt > 0) && !roomShort && gilAmt <= haveGil;
  const batchCount = Math.max(1, Math.ceil(tradeable.length / 8));
  const sendLabel = tradeable.length && gilAmt > 0 ? `Trade ${tradeable.length} + Gil` : gilAmt > 0 ? `Trade ${gilAmt.toLocaleString()} Gil` : `Trade ${tradeable.length}`;

  const submit = (close: () => void) => {
    if (!ready || !dest) return;
    const rows: TradeRow[] = tradeable.map((it) => ({ slot: it.s, id: it.id, count: Math.max(1, Math.min(it.c, qty[it.s] ?? it.c)) }));
    const list: TradeRow[][] = [];
    for (let i = 0; i < rows.length; i += 8) list.push(rows.slice(i, i + 8));
    if (list.length === 0) list.push([]);
    startTradeJob({ charName: char.name, target: dest.name, batches: list, gil: gilAmt });
    onStarted?.();
    close();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,420px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="text-[14px] font-bold text-fg">Trade To Character</div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-4 shrink-0">To</span>
            <div className="flex-1 min-w-0"><Select
              value={destName} onChange={setDestName} options={targets.map((t) => t.name)} full
              renderOption={(nm) => {
                const t = targets.find((x) => x.name === nm);
                const inv = t?.inv?.find((b) => b.id === 0);
                const free = inv ? Math.max(0, inv.max - inv.used) : 0;
                const has = oneId != null ? totalOf(t?.inv, oneId) : null;
                return (
                  <span className="flex items-center gap-2 min-w-0 w-full">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-400" />
                    <span className="truncate">{anon(nm)}</span>
                    {has != null && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-emerald-300/80">has {has}</span>}
                    <span className={`${has != null ? '' : 'ml-auto'} shrink-0 text-[10px] tabular-nums ${free <= 0 ? 'text-red-300' : free <= 3 ? 'text-amber-300' : 'text-fg-4'}`}>{free} free</span>
                  </span>
                );
              }}
            /></div>
          </div>
          <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
            {tradeable.map((it) => {
              const q = Math.max(1, Math.min(it.c, qty[it.s] ?? it.c));
              return (
                <div key={it.s} className="flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                  <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={28} name={it.n} assets={assets} bmpHas={iconSet.has(it.id)} /></div>
                  <span className="text-[12px] text-fg-2 truncate flex-1">{it.n}</span>
                  {it.c > 1 ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setSlotQty(it.s, it.c, q - 1)} disabled={q <= 1} className="le-tap w-6 h-6 grid place-items-center rounded border border-line bg-field text-fg-3 enabled:hover:text-fg disabled:opacity-30 text-[13px] leading-none">-</button>
                      <input type="number" min={1} max={it.c} value={q} onChange={(e) => setSlotQty(it.s, it.c, Number(e.target.value))} className="w-12 bg-field border border-line rounded px-1 py-0.5 text-[12px] text-fg-2 text-center tabular-nums outline-none focus:border-accent/50" />
                      <button onClick={() => setSlotQty(it.s, it.c, q + 1)} disabled={q >= it.c} className="le-tap w-6 h-6 grid place-items-center rounded border border-line bg-field text-fg-3 enabled:hover:text-fg disabled:opacity-30 text-[13px] leading-none">+</button>
                      <button onClick={() => setSlotQty(it.s, it.c, it.c)} disabled={q >= it.c} className="le-tap px-1.5 h-6 rounded border border-line bg-field text-[10px] font-semibold text-fg-4 enabled:hover:text-fg disabled:opacity-30">All</button>
                      <span className="text-[10px] text-fg-5 tabular-nums w-9 text-right">/{it.c}</span>
                    </div>
                  ) : <span className="text-[11px] text-fg-4 tabular-nums shrink-0">×1</span>}
                </div>
              );
            })}
          </div>
          {haveGil > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
              <div className="shrink-0 w-7 h-7 rounded-full bg-amber-400/15 grid place-items-center text-amber-300 text-[13px] font-bold">G</div>
              <span className="text-[12px] text-fg-2 flex-1">Gil</span>
              <GilInput value={gilAmt ? String(gilAmt) : ''} onChange={(d) => setGil(Number(d))} placeholder="0" className="w-28 bg-field border border-line rounded px-2 py-0.5 text-[12px] text-fg-2 text-right tabular-nums outline-none focus:border-accent/50" />
              <button onClick={() => setGil(haveGil)} disabled={gilAmt >= haveGil} className="le-tap px-1.5 h-6 rounded border border-line bg-field text-[10px] font-semibold text-fg-4 enabled:hover:text-fg disabled:opacity-30">All</button>
              <span className="text-[10px] text-fg-5 tabular-nums shrink-0">/ {haveGil.toLocaleString()}</span>
            </div>
          )}
          {items.length > 0 && tradeable.length === 0 && <div className="text-[11px] text-fg-4">No tradeable items in the selection.</div>}
          {dropped > 0 && <div className="text-[11px] text-amber-300">{dropped} item{dropped === 1 ? '' : 's'} skipped (Exclusive).</div>}
          {roomShort && tradeable.length > 0 && <div className="text-[11px] text-red-300">{anon(dest?.name)} has {destFree} free slot{destFree === 1 ? '' : 's'}, needs {tradeable.length}.</div>}
          {!roomShort && batchCount > 1 && <div className="text-[11px] text-fg-4">{tradeable.length} items will trade across {batchCount} chained windows.</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => submit(close)} disabled={!ready} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md disabled:opacity-40 transition-colors bg-accent text-on-accent hover:bg-accent-hover">{sendLabel}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function AddToWatchModal({ item, assets, iconSet, onClose }: { item: InvItem; assets?: string; iconSet: Set<number>; onClose: () => void }) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const watchStore = useWatchStore();
  const chars = useMemo(() => known.filter((c) => c.online && c.conn != null).sort((a, b) => a.name.localeCompare(b.name)), [known]);
  const minOf = (name: string) => watchStore[name]?.items.find((i) => i.id === item.id)?.min;
  const [sel, setSel] = useState<Set<string>>(() => new Set(chars.filter((c) => minOf(c.name) != null).map((c) => c.name)));
  const [amt, setAmt] = useState(12);
  const toggle = (name: string) => setSel((p) => { const s = new Set(p); s.has(name) ? s.delete(name) : s.add(name); return s; });

  const run = () => {
    for (const c of chars) {
      const on = sel.has(c.name);
      const already = minOf(c.name) != null;
      if (on && !already) addWatchItem(c.name, { id: item.id, name: item.n }, amt);
      else if (!on && already) removeWatchItem(c.name, item.id);
    }
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,420px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={item.id} size={28} name={item.n} assets={assets} bmpHas={iconSet.has(item.id)} /></div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-fg leading-tight">Add To Watchlist</div>
              <div className="text-[11px] text-fg-4 truncate">{item.n}</div>
            </div>
          </div>
          {chars.length === 0 ? (
            <div className="text-[12px] text-fg-4">No characters connected.</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-fg-4 shrink-0">Notify below</span>
                <Stepper value={amt} min={0} numW="w-12" onChange={setAmt} />
                <span className="text-[10px] text-fg-5 flex-1 text-right">applies to newly added characters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-fg-4 flex-1">Characters</span>
                <Button variant="ghost" size="xs" onClick={() => setSel(new Set(chars.map((c) => c.name)))}>All</Button>
                <Button variant="ghost" size="xs" onClick={() => setSel(new Set())}>None</Button>
              </div>
              <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                {chars.map((c) => {
                  const on = sel.has(c.name);
                  const cur = minOf(c.name);
                  const total = totalOf(c.inv, item.id);
                  return (
                    <button key={c.name} onClick={() => toggle(c.name)} className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${on ? 'border-accent bg-accent/10' : 'border-line bg-field/40 hover:border-line-2'}`}>
                      <span className={`shrink-0 w-4 h-4 rounded border grid place-items-center ${on ? 'bg-accent border-accent text-on-accent' : 'border-line'}`}>
                        {on && <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>}
                      </span>
                      <span className="text-[12px] text-fg-2 truncate flex-1">{anon(c.name)}</span>
                      <span className="text-[10px] text-fg-4 tabular-nums shrink-0">{total} held{cur != null ? ` · watch ${cur}` : ''}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                <button onClick={run} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Save</button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

const ALL_CHARS = '__ALL_CHARACTERS__';


export default function InventoryView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const acMap = useAcMap();
  const catObjs = useMemo(() => {
    const m = new Map<number, { leaf: string; path: string }>();
    if (!SHOW_INV_AH_CATEGORY) return m;
    for (const [id, ac] of acMap) { const leaf = acLeaf(ac); if (leaf) m.set(id, { leaf, path: acPathLabel(ac) }); }
    return m;
  }, [acMap]);
  const catOf = useMemo(() => (id: number) => catObjs.get(id), [catObjs]);
  const sell = useShopSell();
  const experimental = useSettings().experimentalFeatures;
  // AH prices need a "world" to query. Fall back to a connected character's server when no AH server is set
  // in Settings, matching the drop list -- otherwise players who never set one get NO inventory prices.
  const server = useSettings().ahServer || known.find((c) => c.online)?.server;
  const [name, setName] = useStickyChar();
  const [bagId, setBagId] = useSticky<number | null>('inv.bag', null);
  const [q, setQ] = useSticky('inv.q', '');
  const [globalFind, setGlobalFind] = useSticky('inv.global', false);
  const [sort, setSort] = useStickyPersisted('inv.sort', 'slot' as SortMode);
  const tf = useTagFilter('inventory.tagfilter');
  const jf = useJobFilter('inventory.jobfilter');
  const sortOpts = useMemo(() => [...SORTS, ...tagSorts(tf.tags)], [tf.tags]);
  const [collapsed, setCollapsed] = useSticky<string[]>('inv.collapsed', []);
  const toggleCollapse = (nm: string) => setCollapsed((c) => (c.includes(nm) ? c.filter((x) => x !== nm) : [...c, nm]));
  const [selMode, setSelMode] = useState(false);
  const [selSlots, setSelSlots] = useState<Set<number>>(() => new Set());
  const [lsel, setLsel] = useState<Set<string>>(() => new Set());
  const [sellOpen, setSellOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [gilOpen, setGilOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>(() => {
    try { const m = localStorage.getItem('alexandria-invmode'); return m === 'list' || m === 'compact' ? m : 'list'; } catch { return 'list'; }
  });
  const setModePersist = (m: ViewMode) => { setMode(m); try { localStorage.setItem('alexandria-invmode', m); } catch { /* ignore */ } };

  const active = known.find((k) => k.name === name) ?? known[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  const bags = useMemo(() => (active?.inv ? [...active.inv].sort((a, b) => bagRank(a.id) - bagRank(b.id)) : []), [active?.inv]);
  const bag = bags.find((b) => b.id === bagId) ?? bags[0];
  useEffect(() => { if (bag && bag.id !== bagId) setBagId(bag.id); }, [bag, bagId]);

  const bagOptions = useMemo(() => bags.map((b) => String(b.id)), [bags]);
  const renderBag = (v: string) => {
    const b = bags.find((x) => String(x.id) === v);
    if (!b) return v;
    const c = bagColor(b.id);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
        <span className={`truncate font-medium ${c.text}`}>{bagName(b.id, b.b)}</span>
        <span className={`ml-auto shrink-0 tabular-nums text-[11px] ${c.text}`}>{b.used}/{b.max}</span>
      </span>
    );
  };
  const charOptions = useMemo(() => [ALL_CHARS, ...known.map((c) => c.name)], [known]);
  const onCharChange = (v: string) => {
    startTransition(() => {
      if (v === ALL_CHARS) { setGlobalFind(true); }
      else { setGlobalFind(false); setName(v); }
    });
  };
  const renderChar = (nm: string) => {
    if (nm === ALL_CHARS) {
      return (
        <span className="flex items-center gap-2 min-w-0">
          <svg viewBox="0 0 24 24" width="14" height="14" className="shrink-0 text-fg-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          <span className="truncate">All Characters</span>
        </span>
      );
    }
    const c = known.find((x) => x.name === nm);
    if (!c) return nm;
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
        <span className="truncate">{anon(c.name)}</span>
      </span>
    );
  };
  useEffect(() => { setSelSlots(new Set()); }, [bagId, name, globalFind]);
  useEffect(() => { setSelMode(false); setSelSlots(new Set()); setGsel(new Set()); }, [globalFind]);

  const listedCount = active?.ah?.slots?.filter((s) => s.st !== 'Empty').length ?? 0;
  const freeSlots = Math.max(0, 7 - listedCount);

  const tradeTargets = useMemo(() => (active ? known.filter((k) => k.name !== active.name && k.online && k.conn != null && k.zone != null && k.zone === active.zone) : []), [known, active]);

  const dragRef = useRef<{ add: boolean } | null>(null);
  const applyDrag = (slot: number, add: boolean) => setSelSlots((prev) => {
    const next = new Set(prev);
    if (add) next.add(slot); else next.delete(slot);
    return next;
  });
  const onSelDown = (slot: number) => {
    const add = !selSlots.has(slot);
    dragRef.current = { add };
    applyDrag(slot, add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const onSelEnter = (slot: number) => { if (dragRef.current) applyDrag(slot, dragRef.current.add); };

  const [gsel, setGsel] = useState<Set<string>>(() => new Set());
  const gKey = (charName: string, e: Entry) => `${charName}|${e.bagObj?.id ?? -1}|${e.item.s}`;
  // A hit can only be consolidated if it sits in a tradable, reachable bag and isn't No-Trade.
  // This excludes the Recycle Bin (id 17, not a tradable bag) and unreachable stashes, so the
  // preview count matches what the engine can actually gather.
  const gConsoOk = (c: KnownChar, e: Entry) => {
    const bid = e.bagObj?.id ?? -1;
    return bagConsolidatable(c, bid, experimental) && !(e.item.f != null && (e.item.f & FLAG_NOTRADE));
  };
  const gApply = (key: string, add: boolean) => setGsel((prev) => {
    const next = new Set(prev);
    if (add) next.add(key); else next.delete(key);
    return next;
  });
  const gSelDown = (charName: string, e: Entry) => {
    const key = gKey(charName, e);
    const add = !gsel.has(key);
    dragRef.current = { add };
    gApply(key, add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const gSelEnter = (charName: string, e: Entry) => {
    if (!dragRef.current) return;
    gApply(gKey(charName, e), dragRef.current.add);
  };

  const lKey = (e: Entry) => `${e.bagObj?.id ?? -1}:${e.item.s}`;
  const lApply = (key: string, add: boolean) => setLsel((prev) => { const next = new Set(prev); if (add) next.add(key); else next.delete(key); return next; });
  const lSelDown = (e: Entry) => {
    const add = !lsel.has(lKey(e));
    dragRef.current = { add };
    lApply(lKey(e), add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const lSelEnter = (e: Entry) => { if (dragRef.current) lApply(lKey(e), dragRef.current.add); };

  const enterSelect = () => { setSelMode(true); setSelSlots(new Set()); setGsel(new Set()); setLsel(new Set()); setGMode('menu'); setGBulk(null); setGTrade(false); };
  const exitSelect = () => { setSelMode(false); setSelSlots(new Set()); setGsel(new Set()); setLsel(new Set()); setGMode('menu'); setGBulk(null); setGTrade(false); };
  const [bulk, setBulk] = useState<BulkKind>(null);
  const selAllInBag = () => setSelSlots(new Set((bag?.items ?? []).map((it) => it.s)));

  const canAct = !!active?.online && active.conn != null;
  const search = q.trim().toLowerCase();
  // Defer the heavy all-character search and run the All Characters switch inside a
  // transition, so a spinner shows instead of the main thread freezing on the render.
  const dSearch = useDeferredValue(search);
  const [isPending, startTransition] = useTransition();
  const viewBusy = isPending || (globalFind && search !== dSearch);

  const localResults = useMemo(() => {
    if ((!search && !tf.active && !jf.active) || globalFind) return null;
    const out: Entry[] = [];
    for (const bg of bags) for (const it of bg.items) {
      if (tf.matches && !tf.matches(it.id)) continue;
      if (jf.matches && !jf.matches(it.id)) continue;
      if (!search || itemNameMatches(it.id, it.n, search) || (SHOW_INV_AH_CATEGORY && search.length >= 3 && acPathLabel(acMap.get(it.id)).toLowerCase().includes(search))) out.push({ bag: bg.b, bagObj: bg, item: it });
    }
    return out;
  }, [search, globalFind, bags, acMap, tf.active, tf.matches, jf.active, jf.matches]);

  const selItems = useMemo<SelItem[]>(() => {
    if (localResults) return localResults.filter((e) => lsel.has(lKey(e))).map((e) => ({ ...e.item, bag: e.bagObj?.id ?? 0 }));
    if (bag) return bag.items.filter((it) => selSlots.has(it.s)).map((it) => ({ ...it, bag: bag.id }));
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localResults, lsel, bag, selSlots]);
  const lSelectAll = () => { if (localResults) setLsel(new Set(localResults.map(lKey))); };
  useEffect(() => { setLsel(new Set()); }, [name, globalFind, search, tf.value, jf.value]);

  const globalResults = useMemo(() => {
    if ((!dSearch && !tf.active && !jf.active) || !globalFind) return null;
    const groups: { char: KnownChar; hits: Entry[]; total: number }[] = [];
    for (const c of known) {
      const hits: Entry[] = [];
      let total = 0;
      for (const bg of c.inv ?? []) for (const it of bg.items) {
        if (tf.matches && !tf.matches(it.id)) continue;
        if (jf.matches && !jf.matches(it.id)) continue;
        if (!dSearch || itemNameMatches(it.id, it.n, dSearch) || (SHOW_INV_AH_CATEGORY && dSearch.length >= 3 && acPathLabel(acMap.get(it.id)).toLowerCase().includes(dSearch))) { hits.push({ bag: bg.b, bagObj: bg, item: it }); total += it.c; }
      }
      if (hits.length) groups.push({ char: c, hits, total });
    }
    return groups;
  }, [dSearch, globalFind, known, acMap, tf.active, tf.matches, jf.active, jf.matches]);

  const consoRun = useConsolidate();
  const gplan = useMemo(() => {
    if (!globalFind || !globalResults) return null;
    const bySender: Record<string, Record<number, number>> = {};
    let stacks = 0, qty = 0;
    for (const g of globalResults) for (const e of g.hits) {
      if (!gsel.has(gKey(g.char.name, e)) || !gConsoOk(g.char, e)) continue;
      const m = (bySender[g.char.name] ??= {});
      m[e.item.id] = (m[e.item.id] ?? 0) + e.item.c;
      stacks++; qty += e.item.c;
    }
    return { bySender, stacks, qty };
  }, [globalFind, globalResults, gsel, experimental]);
  const gSelectAll = () => {
    if (!globalResults) return;
    const all = new Set<string>();
    for (const g of globalResults) for (const e of g.hits) all.add(gKey(g.char.name, e));
    setGsel(all);
  };
  // Selected global-search hits, grouped per character, for the cross-character bulk actions.
  const gSelGroups = useMemo(() => {
    const m = new Map<string, { char: KnownChar; items: SelItem[] }>();
    if (!globalResults) return [] as { char: KnownChar; items: SelItem[] }[];
    for (const g of globalResults) for (const e of g.hits) {
      if (!gsel.has(gKey(g.char.name, e))) continue;
      const cur = m.get(g.char.name) ?? { char: g.char, items: [] as SelItem[] };
      cur.items.push({ ...e.item, bag: e.bagObj?.id ?? 0 });
      m.set(g.char.name, cur);
    }
    return [...m.values()];
  }, [globalResults, gsel]);
  const gSelQty = gSelGroups.reduce((n, g) => n + g.items.reduce((s, it) => s + it.c, 0), 0);
  const [gMode, setGMode] = useState<'menu' | 'consolidate'>('menu');
  const [gBulk, setGBulk] = useState<'move' | 'use' | 'drop' | null>(null);
  const [gTrade, setGTrade] = useState(false);

  if (known.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Yet</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">
            Load the Alexandria addon in-game with <span className="text-fg-2 font-mono">//lua load Alexandria</span>. Each character you log in is cached, so it stays searchable here even after logging off.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <>
      <div className="shrink-0 px-3 pt-2 pb-2">
        <div className="rounded-xl border border-line bg-surface-raised p-2 flex flex-col gap-2 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0"><Select value={globalFind ? ALL_CHARS : (active?.name ?? '')} onChange={onCharChange} options={charOptions} renderOption={renderChar} full /></div>
            {!globalFind && active && active.gil != null && (
              <div className="shrink-0 flex items-center gap-1.5 rounded-md border border-line bg-field/50 pl-2.5 pr-1.5 py-1">
                <span className="text-[13px] font-bold tabular-nums text-amber-300">{active.gil.toLocaleString()}</span>
                <span className="shrink-0 w-4 h-4 rounded-full bg-amber-400/15 grid place-items-center text-amber-300 text-[10px] font-bold">G</span>
                <button
                  onClick={() => setGilOpen(true)}
                  disabled={active.gil <= 0 || tradeTargets.length === 0}
                  title={tradeTargets.length === 0 ? 'No same-zone character to trade with' : 'Trade Gil to another character'}
                  className="le-tap px-2 py-0.5 text-[11px] font-semibold rounded border border-line bg-field text-fg-3 enabled:hover:text-fg enabled:hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >Trade</button>
              </div>
            )}
            <ViewModeToggle mode={mode} onChange={setModePersist} />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Select
                value={sort}
                onChange={(v) => setSort(v as SortMode)}
                options={sortOpts.map((s) => s.id)}
                renderOption={(v) => sortOpts.find((s) => s.id === v)?.label ?? v}
                renderValue={(v) => <span className="flex items-center gap-1.5"><svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h12" /><path d="M3 12h9" /><path d="M3 18h6" /><path d="m17 8 4 4-4 4" /></svg><span className="truncate">{sortOpts.find((s) => s.id === v)?.label ?? 'Sort'}</span></span>}
                full
              />
            </div>
            {tf.tags.length > 0 && <div className="flex-1 min-w-0"><TagFilterSelect value={tf.value} onChange={tf.setValue} tags={tf.tags} /></div>}
            <div className="flex-1 min-w-0"><JobFilterSelect value={jf.value} onChange={jf.setValue} /></div>
            {!globalFind && <PullButton char={active} conn={active?.conn ?? undefined} />}
            {((!globalFind && !localResults && bag && bag.items.length > 0) || (!globalFind && localResults && localResults.length > 0) || (globalFind && globalResults && globalResults.length > 0)) && (
              <button
                onClick={selMode ? exitSelect : enterSelect}
                aria-pressed={selMode}
                title={selMode ? 'Done Selecting' : globalFind ? 'Select Items Across Characters' : 'Select Multiple Items'}
                className={`shrink-0 h-[30px] px-3 rounded-md border text-[12px] font-bold tracking-wide transition-colors ${selMode ? 'bg-accent text-on-accent border-transparent' : 'bg-field text-fg-3 border-line hover:text-fg-2 hover:border-accent/40'}`}
              >
                MULTI
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SearchInput
              value={q}
              onChange={setQ}
              wrap="flex-1 min-w-0"
              placeholder={globalFind ? `Find an item across all ${known.length} character${known.length === 1 ? '' : 's'}…` : 'Search...'}
              className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
            {viewBusy && <svg viewBox="0 0 24 24" className="shrink-0 w-4 h-4 text-accent animate-spin" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>}
          </div>

          {!globalFind && active?.inv && !localResults && bags.length > 0 && (
            <Select value={bag ? String(bag.id) : ''} onChange={(v) => setBagId(Number(v))} options={bagOptions} renderOption={renderBag} full />
          )}
        </div>
      </div>

      <TradeBanner />
      <BulkOpBanner />
      <UseBanner char={active} />

      {selMode && (
        <div className="shrink-0 px-4 py-1.5 text-center text-[11px] font-medium text-amber-300 bg-amber-500/10 border-b border-amber-500/25">
          <span className="font-bold">Multi-Select Mode:</span> {'Click & Drag to select multiple items at once.'}
        </div>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto p-4 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
        {globalResults ? (
          globalResults.length === 0 ? (
            <div className="h-full grid place-items-center text-[12px] text-fg-4">{q.trim() ? `No character has an item matching “${q.trim()}”.` : 'No character has an item with that tag.'}</div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3 -mt-1 px-1 text-[11px] text-fg-4">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-accent font-bold tabular-nums">
                  {globalResults.reduce((s, g) => s + g.total, 0).toLocaleString()} total · {globalResults.length} character{globalResults.length === 1 ? '' : 's'}
                </span>
                {globalResults.length > 1 && (
                  <>
                    <Button variant="ghost" size="xs" onClick={() => setCollapsed([])}>Expand All</Button>
                    <Button variant="ghost" size="xs" onClick={() => setCollapsed(globalResults.map((g) => g.char.name))}>Collapse All</Button>
                  </>
                )}
              </div>
              {globalResults.map((g) => {
                const isCollapsed = collapsed.includes(g.char.name);
                return (
                <div key={g.char.name}>
                  <button onClick={() => toggleCollapse(g.char.name)} className="w-full flex items-center gap-2 mb-2 px-1 group">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-fg-4 group-hover:text-fg-2 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}><path d="M9 6l6 6-6 6" /></svg>
                    <span className={`w-2 h-2 rounded-full ${g.char.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                    <span className="text-[12px] font-bold text-fg group-hover:text-accent transition-colors">{anon(g.char.name)}</span>
                    {g.char.main && <span className="text-[11px] text-fg-4">{g.char.main}{g.char.sub ? `/${g.char.sub}` : ''}</span>}
                    <span className="ml-auto text-[11px] text-fg-4 tabular-nums">{isCollapsed ? `${g.hits.length} item${g.hits.length === 1 ? '' : 's'} · ` : ''}{g.total} total</span>
                  </button>
                  {!isCollapsed && (
                    <ItemCollection
                      entries={sortEntries(g.hits, sort, (e) => getMovedAt(g.char.name, e.bagObj?.id ?? -1, e.item.s, e.item.id))}
                      mode={mode}
                      assets={g.char.assets}
                      isSel={selMode ? (_, e) => gsel.has(gKey(g.char.name, e)) : undefined}
                      onSelectDown={selMode ? (_, e) => gSelDown(g.char.name, e) : undefined}
                      onSelectEnter={selMode ? (_, e) => gSelEnter(g.char.name, e) : undefined}
                      renderActions={!selMode ? (it, e) => (e.bagObj ? <RowActions char={g.char} bag={e.bagObj} item={it} canAct={!!g.char.online && g.char.conn != null} bags={[...(g.char.inv ?? [])].sort((a, b) => bagRank(a.id) - bagRank(b.id))} /> : null) : undefined}
                      catOf={catOf}
                      server={server}
                    />
                  )}
                </div>
                );
              })}
            </div>
          )
        ) : globalFind ? (
          <div className="h-full grid place-items-center text-[12px] text-fg-4">Type to find an item across all characters.</div>
        ) : !active?.inv ? (
          <div className="h-full grid place-items-center text-[12px] text-fg-4">Waiting for inventory…</div>
        ) : localResults ? (
          localResults.length === 0 ? (
            <div className="h-full grid place-items-center text-[12px] text-fg-4">{q.trim() ? `No items match “${q.trim()}”.` : 'No items with that tag.'}</div>
          ) : (
            <>
              <div className="text-[11px] text-fg-4 mb-3">{localResults.length} match{localResults.length === 1 ? '' : 'es'}</div>
              <ItemCollection
                entries={sortEntries(localResults, sort, (e) => getMovedAt(active?.name ?? '', e.bagObj?.id ?? -1, e.item.s, e.item.id))}
                mode={mode}
                assets={active?.assets}
                isSel={selMode ? (_, e) => lsel.has(lKey(e)) : undefined}
                onSelectDown={selMode ? (_, e) => lSelDown(e) : undefined}
                onSelectEnter={selMode ? (_, e) => lSelEnter(e) : undefined}
                renderActions={!selMode && active ? (it, e) => (e.bagObj ? <RowActions char={active} bag={e.bagObj} item={it} canAct={canAct} bags={bags} /> : null) : undefined}
                catOf={catOf}
                server={server}
              />
            </>
          )
        ) : (
          <div className="rounded-lg border border-line bg-surface overflow-hidden">
            {!bag || bag.items.length === 0 ? (
              <div className="grid place-items-center py-16 text-[12px] text-fg-4">This container is empty.</div>
            ) : (
              <div className="[&>div]:border-0 [&>div]:rounded-none [&>div]:bg-transparent">
                <ItemCollection
                  key={`${active?.name ?? ''}:${bag.id}`}
                  entries={sortEntries(bag.items.map((it) => ({ item: it })), sort, (e) => getMovedAt(active?.name ?? '', bag.id, e.item.s, e.item.id))}
                  mode={mode}
                  assets={active?.assets}
                  isSel={selMode ? (slot) => selSlots.has(slot) : undefined}
                  onSelectDown={selMode ? onSelDown : undefined}
                  onSelectEnter={selMode ? onSelEnter : undefined}
                  renderActions={!selMode && active && bag ? (it) => <RowActions char={active} bag={bag} item={it} canAct={canAct} bags={bags} /> : undefined}
                  catOf={catOf}
                  server={server}
                  animate
                />
              </div>
            )}
          </div>
        )}
      </div>

      <Collapse open={!!(selMode && !globalFind && active && (localResults || bag))} className="shrink-0">
        {active && (
          <BulkBar
            char={active} items={selItems} bags={bags} canAct={canAct}
            freeSlots={freeSlots} sellAnywhere={sell.anywhere} hasTradeTarget={tradeTargets.length > 0}
            onSelectAll={localResults ? lSelectAll : selAllInBag}
            onClear={() => (localResults ? setLsel(new Set()) : setSelSlots(new Set()))}
            onAh={() => setSellOpen(true)} onTrade={() => setTradeOpen(true)} onBulk={setBulk}
          />
        )}
      </Collapse>

      <Collapse open={!!(globalFind && selMode && (gsel.size > 0 || consoRun.running || consoRun.order.length > 0))} className="shrink-0">
        {gMode === 'consolidate' || consoRun.running || consoRun.order.length > 0 ? (
          <GlobalConsolidateBar
            plan={gplan?.bySender ?? {}} stacks={gplan?.stacks ?? 0} qty={gplan?.qty ?? 0}
            known={known} activeName={active?.name} experimental={experimental}
            onSelectAll={gSelectAll} onClear={() => setGsel(new Set())} onBack={() => setGMode('menu')} onClose={exitSelect}
          />
        ) : (
          <GlobalBulkBar
            groups={gSelGroups} qty={gSelQty}
            onSelectAll={gSelectAll} onClear={() => setGsel(new Set())} onClose={exitSelect}
            onConsolidate={() => setGMode('consolidate')} onTrade={() => setGTrade(true)} onAction={setGBulk}
          />
        )}
      </Collapse>
      {gBulk && globalFind && selMode && (
        <GlobalBulkModal kind={gBulk} groups={gSelGroups} iconSet={iconSet} experimental={experimental}
          onClose={() => setGBulk(null)} onDone={() => { setGBulk(null); exitSelect(); }} />
      )}
      {gTrade && globalFind && selMode && (
        <GlobalTradeModal groups={gSelGroups} known={known} experimental={experimental}
          onClose={() => setGTrade(false)} onDone={() => setGTrade(false)} />
      )}

      {sellOpen && active && (
        <SellDrawer
          char={active}
          items={selItems.filter((it) => !(it.f && (it.f & 0x0A)))}
          iconSet={iconSet}
          onClose={() => setSellOpen(false)}
          onListed={() => { setSellOpen(false); exitSelect(); }}
        />
      )}
      {bulk && active && (
        <BulkModal kind={bulk} char={active} items={selItems} bags={bags} iconSet={iconSet} assets={active.assets} onClose={() => setBulk(null)} onDone={() => { setBulk(null); exitSelect(); }} />
      )}
      {tradeOpen && active && (
        <TradePlayerModal char={active} items={selItems.filter((it) => it.bag === 0)} iconSet={iconSet} assets={active.assets} onClose={() => setTradeOpen(false)} onStarted={exitSelect} />
      )}
      {gilOpen && active && (
        <TradePlayerModal char={active} items={[]} iconSet={iconSet} assets={active.assets} onClose={() => setGilOpen(false)} />
      )}
      </>
    </div>
  );
}
