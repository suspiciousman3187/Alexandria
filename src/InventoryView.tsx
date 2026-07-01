import { memo, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Modal, Popover, Collapse } from './overlay';
import { useTradeJob, startTradeJob, type TradeJob, type TradeRow } from './tradeJob';
import { useKnownCharacters, useAvailableIcons, useItemDescription, moveItem, dropOne, useItem, shopSell, bzApply, NOMAD_BAGS, nomadReachable, type InvItem, type InvBag, type KnownChar } from './bridge';
import { useSettings } from './settings';
import { useShopSell } from './shop';
import { IconInner } from './atlasIcon';
import { useSticky, useStickyChar } from './sticky';
import { useRowMarket } from './rowMarket';
import { openAhDetail } from './ahNav';
import { useWatchStore, addWatchItem, removeWatchItem, totalOf } from './watch';
import { useWishlist, addWish, removeWish } from './wishlist';
import { useDrop, setDrop } from './drop';
import { SellDrawer } from './SellDrawer';
import { useAnimatedList } from './useAnimatedList';
import { useItemHover } from './ItemTooltip';
import { Select, Stepper, GilInput, CharacterSelect, BagTag, SearchInput } from './ui';
import { bagColor } from './bagColors';
import { useConsolidate, runConsolidateSelection, stopConsolidate, clearConsolidate, consolidableTotal } from './consolidate';
import { useAnon } from './anonymize';
import { OpCard } from './OpCard';
import { ALWAYS_BAGS, MOG_ONLY_BAGS } from './bagConstants';

type ViewMode = 'list' | 'compact';
type Entry = { item: InvItem; bag?: string; bagObj?: InvBag };
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
export const ItemRow = memo(function ItemRow({ item, bag, bagId, assets, selected, onClick, onPointerDown, onPointerEnter, dense, actions }: { item: InvItem; bag?: string; bagId?: number; assets?: string; selected?: boolean; onClick?: () => void; onPointerDown?: () => void; onPointerEnter?: () => void; dense?: boolean; actions?: ReactNode }) {
  const icons = useAvailableIcons();
  const hover = useItemHover(item);
  return (
    <div className={`relative group flex items-center transition-colors ${selected ? 'bg-accent/15' : 'hover:bg-field'}`}>
      <button
        onClick={onClick ?? hover.onClick}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        className={`min-w-0 flex-1 text-left flex items-center transition-colors cursor-pointer ${onPointerDown ? 'select-none' : ''} ${dense ? 'gap-2 px-2.5 py-1' : 'gap-3 px-3 py-1.5'}`}
      >
        <div className={`relative shrink-0 rounded bg-field grid place-items-center overflow-hidden ${dense ? 'w-5 h-5' : 'w-7 h-7'}`}>
          <IconInner id={item.id} size={dense ? 20 : 28} name={item.n} assets={assets} bmpHas={item.id > 0 && icons.has(item.id)} />
        </div>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className={`min-w-0 truncate text-fg-2 ${dense ? 'text-[11px]' : 'text-[12px]'}`}>{item.n}</span>
          {item.c > 1 && <span className={`shrink-0 tabular-nums font-bold text-accent rounded bg-accent/15 leading-none ${dense ? 'text-[10px] px-1 py-0.5' : 'text-[12px] px-1.5 py-0.5'}`}>×{item.c}</span>}
          {item.aug && item.aug.length > 0 && <span title="Augmented" className={`shrink-0 font-bold rounded leading-none border border-amber-500/40 bg-amber-500/10 text-amber-300 ${dense ? 'text-[8px] px-1 py-0.5' : 'text-[9px] px-1.5 py-0.5'}`}>AUG</span>}
        </div>
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

const noop = () => {};
function ItemCollection({ entries, mode, assets, isSel, onSelect, onSelectDown, onSelectEnter, renderActions, animate }: { entries: Entry[]; mode: ViewMode; assets?: string; isSel?: (slot: number, entry: Entry) => boolean; onSelect?: (slot: number, entry: Entry) => void; onSelectDown?: (slot: number, entry: Entry) => void; onSelectEnter?: (slot: number, entry: Entry) => void; renderActions?: (item: InvItem, entry: Entry) => ReactNode; animate?: boolean }) {
  const animated = useAnimatedList(animate ? entries : NO_ENTRIES, entryKey, 240);
  const nodes = animate ? animated : entries.map((e) => ({ key: entryKey(e), item: e, leaving: false }));
  const drag = !!onSelectDown;

  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
      {nodes.map((n) => {
        const slot = n.item.item.s;
        return (
        <div key={n.key} className={animate ? (n.leaving ? 'le-row-out' : 'le-row-in') : undefined}>
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

function ActBtn({ onClick, title, active, tone = 'neutral', sm, children }: { onClick: () => void; title: string; active?: boolean; tone?: 'accent' | 'amber' | 'red' | 'neutral'; sm?: boolean; children: ReactNode }) {
  const on = { accent: 'border-accent bg-accent/15 text-accent', amber: 'border-amber-500/60 bg-amber-500/15 text-amber-300', red: 'border-red-500/60 bg-red-500/15 text-red-300', neutral: 'border-line-2 bg-field text-fg' }[tone];
  const off = tone === 'red' ? 'border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300' : 'border-line text-fg-3 hover:text-fg hover:border-line-2';
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active} className={`shrink-0 grid place-items-center rounded-md border transition-colors ${sm ? 'w-7 h-7' : 'w-8 h-8'} ${active ? on : off}`}>
      {children}
    </button>
  );
}

const SVG = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function DropConfirmModal({ kind, item, charName, fromBag, allCount, onCancel, onConfirm }: { kind: 'now' | 'list' | 'all'; item: InvItem; charName: string; fromBag?: string; allCount?: { items: number; chars: number }; onCancel: () => void; onConfirm: () => void }) {
  const anon = useAnon();
  const action = useRef(onCancel);
  return (
    <Modal onClose={() => action.current()} panelClass="w-[min(92vw,360px)] p-4">
      {(close) => (
        <>
          <div className="text-[13px] font-bold text-fg mb-1.5">{kind === 'now' ? 'Drop This Item?' : kind === 'all' ? 'Drop Across All Characters?' : 'Add to Drop List?'}</div>
          <div className="text-[12px] text-fg-3 leading-relaxed mb-3.5">
            {kind === 'now' ? (
              fromBag ? (
                <><span className="font-semibold text-fg-2">{item.n}{item.c > 1 ? ` x${item.c}` : ''}</span> will be moved from {anon(charName)}'s <span className="font-semibold text-fg-2">{fromBag}</span> to inventory and dropped.</>
              ) : (
                <><span className="font-semibold text-fg-2">{item.n}{item.c > 1 ? ` x${item.c}` : ''}</span> will be dropped from {anon(charName)}'s inventory now.</>
              )
            ) : kind === 'all' ? (
              <><span className="font-semibold text-fg-2">{item.n}</span> will be added to the drop list, then dropped from every connected character that has it{allCount ? <> (<span className="font-semibold text-fg-2">{allCount.items}</span> across {allCount.chars} character{allCount.chars === 1 ? '' : 's'})</> : ''}, moving from other reachable bags to inventory first. Dropped items are gone for good.</>
            ) : (
              <><span className="font-semibold text-fg-2">{item.n}</span> will be added to the drop list. When Auto-Drop is on, connected characters drop it from inventory automatically.</>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { action.current = onCancel; close(); }} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={() => { action.current = onConfirm; close(); }} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">{kind === 'now' ? 'Drop' : kind === 'all' ? `Drop All${allCount?.items ? ` (${allCount.items})` : ''}` : 'Add to Drop'}</button>
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
  retrieve: <svg {...SVG}><path d="M3 12a9 9 0 1 0 2.6-6.4" /><path d="M3 3v4h4" /></svg>,
  move: <svg {...SVG}><path d="M4 8h12" /><path d="M13 5l3 3-3 3" /><path d="M20 16H8" /><path d="M11 13l-3 3 3 3" /></svg>,
  trade: <svg {...SVG}><circle cx="8" cy="7" r="3" /><path d="M2 21v-1a5 5 0 0 1 5-5h2" /><path d="M14 11l3 3-3 3" /><path d="M22 14h-7" /></svg>,
  wishlist: <svg {...SVG}><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" /></svg>,
  more: <svg {...SVG}><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></svg>,
};

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
    left = Math.max(8, rect.right - W);
    const estH = actions.length * 32 + 8;
    if (rect.bottom + 4 + estH > window.innerHeight && rect.top - estH - 4 > 8) { top = rect.top - estH - 4; up = true; }
    else top = rect.bottom + 4;
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
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const [confirm, setConfirm] = useState<null | 'now' | 'list' | 'all'>(null);
  const [moving, setMoving] = useState(false);
  const [movingInv, setMovingInv] = useState(false);
  const [selling, setSelling] = useState(false);
  const [trading, setTrading] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const isRecycle = bag.id === 17;
  const canDrop = canAct && !isRecycle;
  const usable = canAct && !isRecycle && !!item.u;
  const atah = !!(char.atah ?? char.ah?.atah);
  const canAuction = canAct && !isRecycle && atah && !(item.f && (item.f & 0x0A));
  const canMove = canAct && bags.some((b) => b.id !== bag.id);
  const canMoveToInv = canAct && bag.id !== 0 && bag.id !== 17;
  const reachable = bag.id === 0 || bagReachable(bag.id, !!char.mog, nomadReachable(char, exp));
  const rsuf = (base: string) => (reachable ? base : `${base} · Mog House Or Nomad Moogle`);
  const vendorable = canAct && !isRecycle && !(item.f && (item.f & 0x10));
  const sellOk = vendorable && sell.anywhere && exp && !!char.inTown && reachable;
  const tradeTargets = useMemo(() => known.filter((k) => k.name !== char.name && k.online && k.conn != null && k.zone != null && k.zone === char.zone), [known, char.name, char.zone]);
  const canTrade = canAct && bag.id === 0 && !(item.f && (item.f & 0x02)) && tradeTargets.length > 0;
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

  const allMatches = useMemo(() => {
    let items = 0;
    let chars = 0;
    for (const c of known) {
      if (!c.online || c.conn == null) continue;
      let cn = 0;
      for (const bg of c.inv ?? []) {
        if (bg.id === 17 || !(bg.id === 0 || bagReachable(bg.id, !!c.mog, nomadReachable(c, exp)))) continue;
        for (const it of bg.items) if (it.id === item.id) cn += it.c;
      }
      if (cn > 0) { items += cn; chars += 1; }
    }
    return { items, chars };
  }, [known, item.id]);
  const dropEverywhere = () => {
    if (!inDrop) setDrop({ ...drop, drop: [...drop.drop, item.n] });
    for (const c of known) {
      if (!c.online || c.conn == null) continue;
      for (const bg of c.inv ?? []) {
        if (bg.id === 17 || !(bg.id === 0 || bagReachable(bg.id, !!c.mog, nomadReachable(c, exp)))) continue;
        for (const it of bg.items) if (it.id === item.id) dropOne(c.conn, it.s, it.id, bg.id, it.c);
      }
    }
    setConfirm(null);
  };

  const verbs: MenuAction[] = [];
  if (isRecycle && canAct) verbs.push({ icon: ICN.retrieve, label: 'Retrieve To Inventory', tone: 'accent', onClick: doRetrieve });
  if (canMoveToInv) verbs.push({ icon: ICN.retrieve, label: rsuf('Move To Inventory'), tone: 'accent', disabled: !reachable, onClick: doMoveToInv });
  if (canMove) verbs.push({ icon: ICN.move, label: rsuf('Move To Another Bag'), disabled: !reachable, onClick: () => setMoving(true) });
  if (canTrade) verbs.push({ icon: ICN.trade, label: 'Trade To Character', tone: 'accent', onClick: () => setTrading(true) });
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
  if (usable) {
    verbs.push({ icon: ICN.use, label: rsuf('Use One'), disabled: !reachable, onClick: () => { if (char.conn != null) useItem(char.conn, item.id, false, bag.id, item.s); } });
    if (item.c > 1) verbs.push({ icon: ICN.use, label: reachable ? `Use All (${item.c})` : `Use All · Mog House Or Nomad Moogle`, disabled: !reachable, onClick: () => { if (char.conn != null) useItem(char.conn, item.id, true, bag.id, item.s); } });
  }
  if (vendorable) verbs.push({
    icon: ICN.sell,
    label: sellOk ? 'Sell…' : !reachable ? 'Sell · Mog House Or Nomad Moogle' : !exp ? 'Sell · Requires Experimental Features' : !sell.anywhere ? 'Sell · Enable Auto-Sell In Towns' : 'Sell · Not In A Town',
    disabled: !sellOk,
    onClick: () => setSelling(true),
  });
  if (canDrop) verbs.push({ icon: ICN.drop, label: reachable ? 'Drop' : 'Drop · Mog House Or Nomad Moogle', tone: 'red', disabled: !reachable, onClick: askDropNow });
  verbs.push({ icon: ICN.drop, label: `Add To Drop List & Drop All${allMatches.items ? ` (${allMatches.items})` : ''}`, tone: 'red', onClick: () => setConfirm('all') });

  return (
    <>
      <ActBtn sm tone="accent" active={watched} onClick={() => setWatchOpen(true)} title="Add To Watchlist">{ICN.watch}</ActBtn>
      <ActBtn sm tone="accent" active={wished} onClick={() => (wished ? removeWish(item.id) : addWish({ id: item.id, n: item.n }, (item.ms ?? 1) > 1))} title={wished ? 'On AH Wishlist' : 'Add to AH Wishlist'}>{ICN.wishlist}</ActBtn>
      <ActBtn sm tone="amber" active={inDrop} onClick={toggleDrop} title={inDrop ? 'On Drop List' : 'Add to Drop List'}>{ICN.ban}</ActBtn>
      {verbs.length > 0 && <ActionMenu actions={verbs} />}
      {confirm && <DropConfirmModal kind={confirm} item={item} charName={char.name} fromBag={bag.id !== 0 ? bagName(bag.id, bag.b) : undefined} allCount={confirm === 'all' ? allMatches : undefined} onCancel={() => setConfirm(null)} onConfirm={confirm === 'now' ? doDropNow : confirm === 'all' ? dropEverywhere : confirmAddList} />}
      {moving && <MoveModal char={char} fromBag={bag} item={item} bags={bags} onClose={() => setMoving(false)} />}
      {trading && <TradePlayerModal char={char} items={[item]} iconSet={iconSet} assets={char.assets} onClose={() => setTrading(false)} />}
      {watchOpen && <AddToWatchModal item={item} assets={char.assets} iconSet={iconSet} onClose={() => setWatchOpen(false)} />}
      {movingInv && <MoveToInvModal char={char} bag={bag} item={item} onClose={() => setMovingInv(false)} />}
      {selling && <SellModal char={char} bag={bag} item={item} onClose={() => setSelling(false)} />}
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

function BulkBar({ char, bag, items, canAct, freeSlots, sellAnywhere, hasTradeTarget, onSelectAll, onClear, onAh, onTrade, onBulk }: {
  char: KnownChar; bag: InvBag; items: InvItem[]; bags: InvBag[]; canAct: boolean; freeSlots: number; sellAnywhere: boolean; hasTradeTarget: boolean;
  onSelectAll: () => void; onClear: () => void; onAh: () => void; onTrade: () => void; onBulk: (k: BulkAction) => void;
}) {
  const n = items.length;
  const exp = useSettings().experimentalFeatures;
  const reachable = bag.id === 0 || bagReachable(bag.id, !!char.mog, nomadReachable(char, exp));
  const ahCount = items.filter((it) => !(it.f && (it.f & 0x0A))).length;
  const tradeN = items.filter((it) => !(it.f && (it.f & 0x02))).length;
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
        {bag.id === 0 && <Btn label={`Trade${tradeN ? ` (${Math.min(tradeN, 8)})` : ''}`} disabled={!has || tradeN === 0 || !hasTradeTarget} onClick={onTrade} />}
        <Btn label={`List${ahCount ? ` (${Math.min(ahCount, freeSlots)})` : ''}`} tone="accent" disabled={!has || ahCount === 0 || freeSlots === 0} onClick={onAh} />
        {bag.id === 0 && <Btn label="Bazaar" disabled={!has} onClick={() => onBulk('bazaar')} />}
        <Btn label="Sell" disabled={!has || vendorN === 0 || !(sellAnywhere && exp) || !char.inTown || !reachable} onClick={() => onBulk('sell')} />
        {usableN > 0 && <Btn label={`Use (${usableN})`} disabled={!has || !reachable} onClick={() => onBulk('use')} />}
        <Btn label="Drop" tone="red" disabled={!has || !reachable} onClick={() => onBulk('drop')} />
      </div>
    </div>
  );
}

const CSTATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const CSTATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

function GlobalConsolidateBar({ plan, stacks, qty, known, activeName, experimental, onSelectAll, onClear, onClose }: {
  plan: Record<string, Record<number, number>>; stacks: number; qty: number; known: KnownChar[]; activeName?: string; experimental: boolean; onSelectAll: () => void; onClear: () => void; onClose: () => void;
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
          {outOfZone.length > 0 && <span className="text-amber-300 truncate">· {outOfZone.map((s) => anon(s.name)).join(', ')} not parked with {anon(collName)} (skipped)</span>}
          {inMog.length > 0 && <span className="text-amber-300 truncate">· {inMog.map((s) => anon(s.name)).join(', ')} in a Mog House (can't trade)</span>}
          {blocked.length > 0 && <span className="text-amber-300 truncate">· {blocked.map((s) => anon(s.name)).join(', ')} have nothing tradable reachable here</span>}
        </div>
        {collInMog ? <span className="shrink-0 text-red-300 font-semibold">{anon(collName)} Is In A Mog House</span>
          : collFree === 0 ? <span className="shrink-0 text-red-300 font-semibold">No Free Slots In Inventory</span>
          : <span className="shrink-0 text-fg-4"><span className={`font-bold tabular-nums ${collFree <= 3 ? 'text-amber-400' : 'text-emerald-400'}`}>{collFree}</span> Free Slot{collFree === 1 ? '' : 's'} In Inventory</span>}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2.5">
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

function BulkModal({ kind, char, bag, items, bags, iconSet, assets, onClose, onDone }: {
  kind: BulkAction; char: KnownChar; bag: InvBag; items: InvItem[]; bags: InvBag[]; iconSet: Set<number>; assets?: string; onClose: () => void; onDone: () => void;
}) {
  const conn = char.conn;
  const exp = useSettings().experimentalFeatures;
  const nomadOk = nomadReachable(char, exp);
  const dests = useMemo(() => bags.filter((b) => b.id !== bag.id && b.id !== 17 && (b.id === 0 || bagReachable(b.id, !!char.mog, nomadOk))), [bags, bag.id, char.mog, nomadOk]);
  const [destName, setDestName] = useState(dests[0] ? bagName(dests[0].id, dests[0].b) : '');
  const dest = dests.find((b) => bagName(b.id, b.b) === destName);
  const [price, setPrice] = useState(1000);

  const shown = kind === 'use' ? items.filter((it) => !!it.u) : kind === 'sell' ? items.filter((it) => !(it.f && (it.f & 0x10))) : items;

  const meta = {
    move: { title: 'Move Items', verb: `Move ${shown.length}`, tone: 'accent' as const },
    bazaar: { title: 'Bazaar Items', verb: `Bazaar ${shown.length}`, tone: 'accent' as const },
    sell: { title: 'Sell To Vendor', verb: `Sell ${shown.length}`, tone: 'accent' as const },
    drop: { title: 'Drop Items', verb: `Drop ${shown.length}`, tone: 'red' as const },
    use: { title: 'Use Items', verb: `Use ${shown.length}`, tone: 'red' as const },
  }[kind];

  const run = () => {
    if (conn == null) return;
    if (kind === 'move') { if (!dest) return; for (const it of shown) moveItem(conn, it.id, bag.id, dest.id, it.c, it.s); }
    else if (kind === 'bazaar') bzApply(conn, shown.map((it) => ({ index: it.s, price })));
    else if (kind === 'sell') for (const it of shown) shopSell(conn, it.id, it.c, bag.id, it.s);
    else if (kind === 'drop') for (const it of shown) dropOne(conn, it.s, it.id, bag.id, it.c);
    else if (kind === 'use') for (const it of shown) useItem(conn, it.id, true, bag.id, it.s);
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
            <div className="flex items-center gap-2"><span className="text-[11px] text-fg-4 shrink-0">Price each</span><GilInput value={String(price)} onChange={(d) => setPrice(Math.max(1, Number(d) || 1))} className="flex-1 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 outline-none focus:border-accent/50" /></div>
          )}
          <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
            {shown.map((it) => (
              <div key={it.s} className="flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={28} name={it.n} assets={assets} bmpHas={iconSet.has(it.id)} /></div>
                <span className="text-[12px] text-fg-2 truncate flex-1">{it.n}</span>
                {it.c > 1 && <span className="text-[11px] text-fg-4 tabular-nums shrink-0">×{it.c}</span>}
              </div>
            ))}
          </div>
          {shown.length === 0 && <div className="text-[11px] text-fg-4">No eligible items in the selection.</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={run} disabled={shown.length === 0 || (kind === 'move' && !dest)} className={`flex-1 px-3 py-2 text-[12px] font-bold rounded-md disabled:opacity-40 transition-colors ${meta.tone === 'red' ? 'bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25' : 'bg-accent text-on-accent hover:bg-accent-hover'}`}>{meta.verb}</button>
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
  const targets = useMemo(() => known.filter((k) => k.name !== char.name && k.online && k.conn != null && k.zone != null && k.zone === char.zone), [known, char.name, char.zone]);
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
                <button onClick={() => setSel(new Set(chars.map((c) => c.name)))} className="le-tap text-[10px] font-semibold text-fg-4 hover:text-fg-2">All</button>
                <button onClick={() => setSel(new Set())} className="le-tap text-[10px] font-semibold text-fg-4 hover:text-fg-2">None</button>
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

const SELECT_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>;

export default function InventoryView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const sell = useShopSell();
  const experimental = useSettings().experimentalFeatures;
  const [name, setName] = useStickyChar();
  const [bagId, setBagId] = useSticky<number | null>('inv.bag', null);
  const [q, setQ] = useSticky('inv.q', '');
  const [globalFind, setGlobalFind] = useSticky('inv.global', false);
  const [collapsed, setCollapsed] = useSticky<string[]>('inv.collapsed', []);
  const toggleCollapse = (nm: string) => setCollapsed((c) => (c.includes(nm) ? c.filter((x) => x !== nm) : [...c, nm]));
  const [selMode, setSelMode] = useState(false);
  const [selSlots, setSelSlots] = useState<Set<number>>(() => new Set());
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
    if (v === ALL_CHARS) { setGlobalFind(true); }
    else { setGlobalFind(false); setName(v); }
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
  const gSelEnter = (charName: string, e: Entry) => { if (dragRef.current) gApply(gKey(charName, e), dragRef.current.add); };

  const enterSelect = () => { setSelMode(true); setSelSlots(new Set()); setGsel(new Set()); };
  const exitSelect = () => { setSelMode(false); setSelSlots(new Set()); setGsel(new Set()); };
  const [bulk, setBulk] = useState<BulkKind>(null);
  const selItems = useMemo(() => (bag ? bag.items.filter((it) => selSlots.has(it.s)) : []), [bag, selSlots]);
  const selAllInBag = () => setSelSlots(new Set((bag?.items ?? []).map((it) => it.s)));

  const canAct = !!active?.online && active.conn != null;
  const search = q.trim().toLowerCase();

  const localResults = useMemo(() => {
    if (!search || globalFind) return null;
    const out: Entry[] = [];
    for (const bg of bags) for (const it of bg.items) {
      if (it.n.toLowerCase().includes(search)) out.push({ bag: bg.b, bagObj: bg, item: it });
    }
    return out;
  }, [search, globalFind, bags]);

  const globalResults = useMemo(() => {
    if (!search || !globalFind) return null;
    const groups: { char: KnownChar; hits: Entry[]; total: number }[] = [];
    for (const c of known) {
      const hits: Entry[] = [];
      let total = 0;
      for (const bg of c.inv ?? []) for (const it of bg.items) {
        if (it.n.toLowerCase().includes(search)) { hits.push({ bag: bg.b, bagObj: bg, item: it }); total += it.c; }
      }
      if (hits.length) groups.push({ char: c, hits, total });
    }
    return groups;
  }, [search, globalFind, known]);

  const consoRun = useConsolidate();
  const gplan = useMemo(() => {
    if (!globalFind || !globalResults) return null;
    const bySender: Record<string, Record<number, number>> = {};
    let stacks = 0, qty = 0;
    for (const g of globalResults) for (const e of g.hits) {
      if (!gsel.has(gKey(g.char.name, e))) continue;
      const m = (bySender[g.char.name] ??= {});
      m[e.item.id] = (m[e.item.id] ?? 0) + e.item.c;
      stacks++; qty += e.item.c;
    }
    return { bySender, stacks, qty };
  }, [globalFind, globalResults, gsel]);
  const gSelectAll = () => {
    if (!globalResults) return;
    const all = new Set<string>();
    for (const g of globalResults) for (const e of g.hits) all.add(gKey(g.char.name, e));
    setGsel(all);
  };

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
          </div>

          <div className="flex items-center gap-2">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder={globalFind ? `Find an item across all ${known.length} character${known.length === 1 ? '' : 's'}…` : 'Search items in this character…'}
              className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
            {((!globalFind && !localResults && bag && bag.items.length > 0) || (globalFind && globalResults && globalResults.length > 0)) && (
              <button
                onClick={selMode ? exitSelect : enterSelect}
                aria-pressed={selMode}
                title={selMode ? 'Done Selecting' : globalFind ? 'Select Items To Consolidate' : 'Select Multiple Items'}
                className={`shrink-0 grid place-items-center w-[30px] h-[30px] rounded-md border transition-colors ${selMode ? 'bg-accent text-on-accent border-transparent' : 'bg-field text-fg-3 border-line hover:text-fg-2'}`}
              >
                {selMode
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  : SELECT_ICON}
              </button>
            )}
            <ViewModeToggle mode={mode} onChange={setModePersist} />
          </div>

          {!globalFind && active?.inv && !localResults && bags.length > 0 && (
            <Select value={bag ? String(bag.id) : ''} onChange={(v) => setBagId(Number(v))} options={bagOptions} renderOption={renderBag} full />
          )}
        </div>
      </div>

      <TradeBanner />

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {globalResults ? (
          globalResults.length === 0 ? (
            <div className="h-full grid place-items-center text-[12px] text-fg-4">No character has an item matching “{q.trim()}”.</div>
          ) : (
            <div className="flex flex-col gap-5">
              {globalResults.length > 1 && (
                <div className="flex items-center gap-3 -mt-1 px-1 text-[11px] text-fg-4">
                  <button onClick={() => setCollapsed([])} className="hover:text-fg-2 transition-colors">Expand All</button>
                  <button onClick={() => setCollapsed(globalResults.map((g) => g.char.name))} className="hover:text-fg-2 transition-colors">Collapse All</button>
                </div>
              )}
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
                      entries={g.hits}
                      mode={mode}
                      assets={g.char.assets}
                      isSel={selMode ? (_, e) => gsel.has(gKey(g.char.name, e)) : undefined}
                      onSelectDown={selMode ? (_, e) => gSelDown(g.char.name, e) : undefined}
                      onSelectEnter={selMode ? (_, e) => gSelEnter(g.char.name, e) : undefined}
                      renderActions={!selMode ? (it, e) => (e.bagObj ? <RowActions char={g.char} bag={e.bagObj} item={it} canAct={!!g.char.online && g.char.conn != null} bags={[...(g.char.inv ?? [])].sort((a, b) => bagRank(a.id) - bagRank(b.id))} /> : null) : undefined}
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
            <div className="h-full grid place-items-center text-[12px] text-fg-4">No items match “{q.trim()}”.</div>
          ) : (
            <>
              <div className="text-[11px] text-fg-4 mb-3">{localResults.length} match{localResults.length === 1 ? '' : 'es'}</div>
              <ItemCollection
                entries={localResults}
                mode={mode}
                assets={active?.assets}
                renderActions={active ? (it, e) => (e.bagObj ? <RowActions char={active} bag={e.bagObj} item={it} canAct={canAct} bags={bags} /> : null) : undefined}
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
                  entries={bag.items.map((it) => ({ item: it }))}
                  mode={mode}
                  assets={active?.assets}
                  isSel={selMode ? (slot) => selSlots.has(slot) : undefined}
                  onSelectDown={selMode ? onSelDown : undefined}
                  onSelectEnter={selMode ? onSelEnter : undefined}
                  renderActions={!selMode && active && bag ? (it) => <RowActions char={active} bag={bag} item={it} canAct={canAct} bags={bags} /> : undefined}
                  animate
                />
              </div>
            )}
          </div>
        )}
      </div>

      <Collapse open={!!(selMode && !globalFind && !localResults && bag && active)} className="shrink-0">
        {active && bag && (
          <BulkBar
            char={active} bag={bag} items={selItems} bags={bags} canAct={canAct}
            freeSlots={freeSlots} sellAnywhere={sell.anywhere} hasTradeTarget={tradeTargets.length > 0}
            onSelectAll={selAllInBag} onClear={() => setSelSlots(new Set())}
            onAh={() => setSellOpen(true)} onTrade={() => setTradeOpen(true)} onBulk={setBulk}
          />
        )}
      </Collapse>

      <Collapse open={!!(globalFind && selMode && ((gplan && gplan.stacks > 0) || consoRun.running || consoRun.order.length > 0))} className="shrink-0">
        <GlobalConsolidateBar
          plan={gplan?.bySender ?? {}} stacks={gplan?.stacks ?? 0} qty={gplan?.qty ?? 0}
          known={known} activeName={active?.name} experimental={experimental}
          onSelectAll={gSelectAll} onClear={() => setGsel(new Set())} onClose={exitSelect}
        />
      </Collapse>

      {sellOpen && active && bag && (
        <SellDrawer
          char={active}
          bag={bag}
          items={bag.items.filter((it) => selSlots.has(it.s) && !(it.f && (it.f & 0x0A)))}
          iconSet={iconSet}
          onClose={() => setSellOpen(false)}
          onListed={() => { setSellOpen(false); exitSelect(); }}
        />
      )}
      {bulk && active && bag && (
        <BulkModal kind={bulk} char={active} bag={bag} items={selItems} bags={bags} iconSet={iconSet} assets={active.assets} onClose={() => setBulk(null)} onDone={() => { setBulk(null); exitSelect(); }} />
      )}
      {tradeOpen && active && bag && (
        <TradePlayerModal char={active} items={selItems} iconSet={iconSet} assets={active.assets} onClose={() => setTradeOpen(false)} onStarted={exitSelect} />
      )}
      {gilOpen && active && (
        <TradePlayerModal char={active} items={[]} iconSet={iconSet} assets={active.assets} onClose={() => setGilOpen(false)} />
      )}
      </>
    </div>
  );
}
