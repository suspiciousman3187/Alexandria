import { useMemo, useState, useEffect, useLayoutEffect, useRef, useContext, createContext, useSyncExternalStore, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useKnownCharacters, useAvailableIcons, reforgeStart, reforgeStop, reforgeStep, reforgeRemGet, reforgePause, reforgeResume, ahBuy, useAhCatalog, type KnownChar, type ReforgeState, type ReforgeStepPlan } from './bridge';
import { IconInner } from './atlasIcon';
import { logicalRect, logicalViewport } from './uiZoom';
import { useItemHover, type HoverMeta } from './ItemTooltip';
import { useStickyChar, useStickyPersisted } from './sticky';
import { CharacterSelect, Select, SearchInput, Button } from './ui';
import { openAhDetail } from './ahNav';
import { useItemValues, useRowMarket } from './priceStore';
import { useSettings } from './settings';
import { runQuantityBuy } from './quantityBuy';
import {
  useReforgeDB, buildOpportunities, setNameFor, vanaState, VANA_DAY_REAL, reforgeCount, heatColor, reforgeNameMap,
  remChapterOf, remStoredCount, ARMOR_LABEL, SLOT_ORDER,
  type ArmorType, type Opportunity, type PathStatus, type ReforgeRef, type IngredientNeed, type VanaClock,
} from './reforge';
import { useActiveReforges, ReforgeMiniCard, phaseOf, fmtCd, useNow, type ActiveReforge } from './reforgeProgress';

const TYPE_COLOR: Record<ArmorType, string> = { artifact: '#5b9be0', empyrean: '#e0b24a', relic: '#c56bd0' };
const TYPE_INK: Record<ArmorType, string> = { artifact: '#fff', empyrean: '#1c1500', relic: '#fff' };
const TAB_ORDER: ArmorType[] = ['artifact', 'relic', 'empyrean'];
const SLOT_LABEL: Record<string, string> = { head: 'Head', body: 'Body', hands: 'Hands', legs: 'Legs', feet: 'Feet' };
const TIER_NAME: Record<string, string> = { af: 'Artifact', reforged: 'Reforged', 'reforged+1': 'Reforged +1', 'reforged+2': 'Reforged +2', 'reforged+3': 'Reforged +3' };
// Display-only alias. The Relic +2/+3 NPC in Ru'Lude Gardens is named "???" in-game, so the plan must
// trade against that literal name; we only show a friendly label here.
const NPC_LABEL: Record<string, string> = { '???': 'Aurix' };
const npcName = (n: string) => NPC_LABEL[n] ?? n;
// Each reforge NPC gets its own hue so they read apart at a glance.
const NPC_COLOR: Record<string, string> = { Monisette: '#5ec9a8', Coelestrox: '#f0a35e', Ruspix: '#e08fd0', '???': '#7ca5f5' };
const npcColor = (n: string) => NPC_COLOR[n] ?? '#8b9bb4';
// Reforge execution (the addon rf_* state machine). Enabled for drive-testing.
const EXECUTION_ENABLED = true;
const TIER_RANK: Record<string, number> = { '+2': 3, '+1': 2, Base: 1 };
const OK = '#4fd1a5', PULL = '#4db2ff', BAD = '#f0766f', CHAIN = '#9b8cf0', STORE = '#f0a35e';
// Availability of a required item: green = enough already in inventory (nothing to do), blue = enough
// obtainable but not in inventory yet (another bag, or a Rem's Tale chapter stored with Monisette) --
// the reforge auto-gathers it, red = not enough anywhere reachable (bags + Monisette storage).
type Avail = 'have' | 'pull' | 'short';
const needAvail = (inInv: number, have: number, need: number): Avail => (have < need ? 'short' : inInv < need ? 'pull' : 'have');
const availColor = (a: Avail): string => (a === 'have' ? OK : a === 'pull' ? PULL : BAD);
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

function pickBest(paths: PathStatus[]): PathStatus | undefined {
  const rank = (p: PathStatus) => TIER_RANK[p.label] ?? 0;
  const doable = paths.filter((p) => p.doable).sort((a, b) => rank(b) - rank(a));
  if (doable.length) return doable[0];
  const owned = paths.filter((p) => p.hasInput).sort((a, b) => rank(b) - rank(a));
  return owned[0] ?? paths[0];
}
function statusOf(o: Opportunity, p?: PathStatus): { c: string; l: string } | null {
  if (!o.owned || !p) return null;
  if (p.doable) return p.needsPull ? { c: PULL, l: 'gathers' } : { c: OK, l: 'ready' };
  return { c: BAD, l: `short ${p.needs.filter((n) => n.have < n.need).length}` };
}

type QueuePart = { items: { id: number; qty: number }[]; currency: { name: string; qty: number }[] };
type QueueEntry = { key: string; type: ArmorType; job: string; slot: string; label: string; npc: string; output: ReforgeRef; input: ReforgeRef; ingredients: { id: number | null; name: string; qty: number; currency?: boolean }[]; pending?: boolean; resumeAfter?: number; resumeWaiting?: boolean; parts?: QueuePart[] };
// Per-day trade lists (items + currency) for a multi-day reforge, for the executor's step expansion.
const partsFromNeeds = (partNeeds?: IngredientNeed[][]): QueuePart[] | undefined => partNeeds?.map((pn) => ({
  items: pn.filter((n) => !n.currency && n.id != null).map((n) => ({ id: n.id as number, qty: n.need })),
  currency: pn.filter((n) => n.currency).map((n) => ({ name: n.name, qty: n.need })),
}));
type IconProps = { assets?: string; iconSet: Set<number> };

// Per-character reforge queues. Each character stages and runs its own queue independently, so several
// characters can be reforging different sets at the same time without one clobbering another.
const EMPTY_QUEUE: QueueEntry[] = [];
const rfQueues = new Map<string, QueueEntry[]>();
const rfQueueSubs = new Set<() => void>();
function useReforgeQueue(name: string | undefined): [QueueEntry[], (v: QueueEntry[] | ((q: QueueEntry[]) => QueueEntry[])) => void] {
  const key = name ?? '';
  const queue = useSyncExternalStore(
    (cb) => { rfQueueSubs.add(cb); return () => { rfQueueSubs.delete(cb); }; },
    () => rfQueues.get(key) ?? EMPTY_QUEUE,
    () => rfQueues.get(key) ?? EMPTY_QUEUE,
  );
  const setQueue = useCallback((v: QueueEntry[] | ((q: QueueEntry[]) => QueueEntry[])) => {
    const cur = rfQueues.get(key) ?? EMPTY_QUEUE;
    const next = typeof v === 'function' ? (v as (q: QueueEntry[]) => QueueEntry[])(cur) : v;
    if (next.length === 0) rfQueues.delete(key); else rfQueues.set(key, next);
    rfQueueSubs.forEach((f) => f());
  }, [key]);
  return [queue, setQueue];
}
// Characters (other than the active one) that currently have a staged queue -- for the cross-character hint.
function useOtherQueuedChars(activeName: string | undefined): { name: string; count: number }[] {
  useSyncExternalStore((cb) => { rfQueueSubs.add(cb); return () => { rfQueueSubs.delete(cb); }; }, () => rfQueues.size, () => rfQueues.size);
  const out: { name: string; count: number }[] = [];
  for (const [n, q] of rfQueues) if (n && n !== activeName && q.length > 0) out.push({ name: n, count: q.length });
  return out;
}

const pullGlyph = (<svg viewBox="0 0 24 24" className="w-3 h-3 inline shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v13" /><path d="m6 12 6 6 6-6" /></svg>);
const chev = (<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>);

function ItemIcon({ id, name, size, assets, iconSet, ring, hover }: { id: number | null; name: string; size: number } & IconProps & { ring?: string; hover?: HoverMeta }) {
  const h = useItemHover(hover ?? null);
  return (
    <div onClick={hover ? h.onClick : undefined} className={`relative shrink-0 rounded-lg bg-field grid place-items-center overflow-hidden${hover ? ' cursor-pointer hover:brightness-125 transition-[filter]' : ''}`} style={{ width: size, height: size, boxShadow: `inset 0 0 0 ${ring ? 1.5 : 1}px ${ring ?? 'var(--color-line)'}` }}>
      <IconInner id={id ?? 0} size={Math.round(size * 0.84)} name={name} assets={assets} bmpHas={id != null && id > 0 && iconSet.has(id)} />
    </div>
  );
}
const hoverOf = (r: ReforgeRef): HoverMeta | undefined => (r.id ? { id: r.id, n: r.name } : undefined);
function Tier({ to, accent }: { to: string; accent: string }) {
  return <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: accent, background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>{TIER_NAME[to] ?? to}</span>;
}
const coinGlyph = (<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10a2 2 0 0 1 4 0c0 1.3-4 1-4 3a2 2 0 0 0 4 0" /></svg>);

const cartGlyph = (<svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2 3h2.3l2.4 12.4a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" /></svg>);
const fmtGil = (n: number) => n.toLocaleString();

// The character who would place the bid (the one selected for the reforge). Buying is only possible
// while that character is standing at an auction house, so the popover reads `atah` to gate itself.
type Buyer = { conn: number; name: string; atah: boolean; gil: number };
type ReforgeBuy = {
  world: string | undefined; buyer: Buyer | null; price: (id: number | null) => number | undefined; ahable: (id: number | null) => boolean;
  // The character is in a zone with an auction house. Reforge NPCs in Reisenjima (Coelestrox) and
  // Leafallia (Ruspix) have no AH, so the buy buttons hide there instead of offering a purchase you can't make.
  canAh: boolean;
  // Rem's Tale chapter retrieval from Monisette (chapters are Empyrean mats she uniquely stores).
  remNear: boolean; remStored: (chapter: number) => number; remGet: (chapter: number, count: number) => void;
  // Is the active character standing next to this reforge NPC? Pieces can only be queued at their own NPC.
  nearNpc: (npc: string) => boolean;
};
const ReforgeBuyCtx = createContext<ReforgeBuy | null>(null);

const retrieveGlyph = (<svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v10m0 0 4-4m-4 4-4-4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>);

// Anchor a portal popover to `rect`, measuring its real height so it never renders off-screen: opens
// below the trigger, flips above when there isn't room, and clamps to the viewport as a last resort.
function usePopoverPos(rect: DOMRect, cardRef: { current: HTMLDivElement | null }, width: number): { left: number; top: number } {
  const [pos, setPos] = useState<{ left: number; top: number }>(() => { const r = logicalRect(rect); return { left: r.left, top: r.bottom + 6 }; });
  useLayoutEffect(() => {
    const el = cardRef.current; if (!el) return;
    // Position in the card's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws it off-screen;
    // see uiZoom.ts. No-op at 100%.
    const M = 8, h = el.offsetHeight;
    const r = logicalRect(rect);
    const vp = logicalViewport();
    let left = r.left; if (left + width > vp.w - M) left = vp.w - width - M; if (left < M) left = M;
    let top = r.bottom + 6;
    if (top + h > vp.h - M) top = r.top - h - 6;   // flip above the trigger
    if (top < M) top = Math.max(M, vp.h - h - M);     // still off-screen: clamp to viewport
    setPos({ left, top });
  }, [rect, cardRef, width]);
  return pos;
}

// Small popover to pull missing Rem's Tale chapters out of Monisette's storage (gated by how many the
// character has stored, per the currency page, and by standing near her). No cost, so it just confirms
// the count. The addon talks to Monisette once per chapter.
function RetrievePopover({ need, chapter, rect, ctx, onClose }: { need: IngredientNeed; chapter: number; rect: DOMRect; ctx: ReforgeBuy; onClose: () => void }) {
  const short = Math.max(1, need.need - need.have);
  const stored = ctx.remStored(chapter);
  const [qtyStr, setQtyStr] = useState(String(Math.max(1, Math.min(short, stored || short))));
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const outside = (e: Event) => { if (!cardRef.current || !cardRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const qty = Math.max(1, Math.min(Math.floor(Number(qtyStr) || 1), Math.max(1, stored)));
  const canGet = ctx.remNear && stored > 0 && !!ctx.buyer;
  const doGet = () => { if (!canGet || !ctx.buyer) return; ctx.remGet(chapter, qty); onClose(); };

  const W = 228;
  const { left, top } = usePopoverPos(rect, cardRef, W);

  return createPortal(
    <div ref={cardRef} className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl p-3 flex flex-col gap-2.5" style={{ left, top, width: W }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-fg truncate">{need.name}</div>
          <div className="text-[10px] text-fg-4 tabular-nums">Short {short} · stored {stored}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-auto shrink-0 text-fg-4 hover:text-fg transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-4 w-14 shrink-0">Retrieve</span>
        <input value={qtyStr} onChange={(e) => setQtyStr(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric"
          className="w-16 text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1 text-fg-2 focus:border-accent/60 outline-none" />
        <span className="ml-auto text-[10px] text-fg-4">of {stored}</span>
      </div>
      {!ctx.buyer ? <div className="text-[10px] text-fg-4">No character selected.</div>
        : stored <= 0 ? <div className="text-[10px] text-amber-300/90">None stored with Monisette.</div>
        : !ctx.remNear ? <div className="text-[10px] text-amber-300/90 leading-snug">Stand near Monisette to retrieve.</div>
        : null}
      <button onClick={doGet} disabled={!canGet}
        className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:opacity-90 disabled:opacity-40 transition-opacity">
        {retrieveGlyph}Retrieve{qty > 1 ? ` ×${qty}` : ''}
      </button>
    </div>,
    document.body,
  );
}

// Small popover to bid on a missing ingredient without leaving the reforge view. Price prefills from
// the cached market median; the bid goes to the reforging character via the same path the Auction
// tab uses. Falls back to a full AH look-up when the character can't buy from here.
// Small inline spinner shown while the AH market (stock + recent sales) is still being fetched, so an
// unpopulated popover reads as "loading" instead of a real "0 on AH / no sales".
function MiniSpin({ className = 'w-3 h-3' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>;
}

function BuyPopover({ need, rect, ctx, onClose }: { need: IngredientNeed; rect: DOMRect; ctx: ReforgeBuy; onClose: () => void }) {
  const short = Math.max(1, need.need - need.have);
  const median = ctx.price(need.id);
  const market = useRowMarket(need.id ?? 0, false, ctx.world, need.id != null);
  const recent = useMemo(() => (market?.sales ?? []).slice(0, 3), [market]);
  const [priceStr, setPriceStr] = useState(median ? String(median) : '');
  const [qtyStr, setQtyStr] = useState(String(short));
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const outside = (e: Event) => { if (!cardRef.current || !cardRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const buyer = ctx.buyer;
  const priceNum = Number(priceStr) || 0;
  const qty = Math.max(1, Math.floor(Number(qtyStr) || 1));
  const total = priceNum * qty;
  const enoughGil = !!buyer && buyer.gil >= total;
  const canBuy = !!buyer && buyer.atah && priceNum > 0 && enoughGil && need.id != null;
  const doBuy = () => {
    if (!canBuy || !buyer || need.id == null) return;
    if (qty > 1) void runQuantityBuy({ conn: buyer.conn, charName: buyer.name, id: need.id, itemName: need.name, single: 1, price: priceNum, target: qty });
    else ahBuy(buyer.conn, need.id, 1, priceNum, 1);
    onClose();
  };

  const W = 228;
  const { left, top } = usePopoverPos(rect, cardRef, W);

  return createPortal(
    <div ref={cardRef} className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl p-3 flex flex-col gap-2.5" style={{ left, top, width: W }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-fg truncate">{need.name}</div>
          <div className="text-[10px] text-fg-4 tabular-nums">
            Short {short} · have {need.have}/{need.need} · {market === undefined
              ? <span className="inline-flex items-center gap-1 align-middle text-fg-4"><MiniSpin className="w-3 h-3" />checking AH</span>
              : <span className="font-semibold" style={{ color: (market?.listedTotal ?? 0) > 0 ? '#4fd1a5' : '#f0766f' }}>{market?.listedTotal ?? 0} on AH</span>}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-auto shrink-0 text-fg-4 hover:text-fg transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-4 w-9 shrink-0">Price</span>
        <input value={priceStr} onChange={(e) => setPriceStr(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder={median ? '' : 'no market data'}
          className="flex-1 min-w-0 text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1 text-fg-2 focus:border-accent/60 outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-4 w-9 shrink-0">Qty</span>
        <input value={qtyStr} onChange={(e) => setQtyStr(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric"
          className="w-16 text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1 text-fg-2 focus:border-accent/60 outline-none" />
        <span className="ml-auto text-[11px] tabular-nums font-semibold text-amber-300">{fmtGil(total)}g</span>
      </div>
      {market === undefined ? (
        <div className="flex items-center gap-1.5 rounded-md bg-field/50 px-2 py-1.5 text-[10px] text-fg-4">
          <MiniSpin className="w-3 h-3" />Loading recent sales…
        </div>
      ) : recent.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-field/50 px-2 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-fg-4">Last {recent.length} sales</span>
          {recent.map((s, i) => (
            <button key={i} onClick={() => setPriceStr(String(s.price))} title="Use this price"
              className="flex items-center justify-between text-[11px] tabular-nums text-fg-2 hover:text-accent transition-colors">
              <span className="font-semibold">{fmtGil(s.price)}g</span>
              <span className="text-fg-4 font-normal">{s.date}</span>
            </button>
          ))}
        </div>
      ) : null}
      {!buyer ? <div className="text-[10px] text-fg-4">No character selected.</div>
        : !buyer.atah ? <div className="text-[10px] text-amber-300/90 leading-snug">Stand at an auction house on {buyer.name} to buy from here.</div>
        : priceNum > 0 && !enoughGil ? <div className="text-[10px] text-red-300/90 tabular-nums">Not enough gil ({fmtGil(buyer.gil)}).</div>
        : null}
      <div className="flex items-center gap-2">
        <button onClick={doBuy} disabled={!canBuy}
          className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:opacity-90 disabled:opacity-40 transition-opacity">
          {cartGlyph}{qty > 1 ? `Buy ×${qty}` : 'Buy'}
        </button>
        {need.id != null && (
          <button onClick={() => { onClose(); openAhDetail({ id: need.id as number, n: need.name, st: 1, back: 'reforge' }); }} title="Open the full auction house view"
            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Look Up</button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function IngChip({ need, assets, iconSet }: { need: IngredientNeed } & IconProps) {
  const av = needAvail(need.inInv, need.have, need.need);
  const buy = useContext(ReforgeBuyCtx);
  const [buyRect, setBuyRect] = useState<DOMRect | null>(null);
  const [retrRect, setRetrRect] = useState<DOMRect | null>(null);
  const short = !need.currency && need.id != null && need.have < need.need;
  const canOfferBuy = short && !!buy && buy.canAh && buy.ahable(need.id);
  const remCh = remChapterOf(need.id);
  const remStoredHere = short && remCh != null && !!buy && buy.remStored(remCh) > 0;
  // Retrieving a Rem's Tale chapter is a TRADE with Monisette, so it only works within range of her. Offer the
  // retrieve button only when actually near Monisette; otherwise the chapter is just as unreachable as storage.
  const canRetrieve = remStoredHere && !!buy && buy.remNear;
  // You already OWN this piece somewhere you can't reach from HERE -- Mog storage (needs a Moogle) or a Monisette
  // chapter while not near her. Flag the chip orange with a lock so a plain red "short" isn't misleading. This is
  // independent of buying: at an AH the Buy button stays enabled alongside it (buy vs. trek to storage yourself).
  const strandedInStorage = short && !canRetrieve && ((need.mog ?? 0) > 0 || remStoredHere);
  const strandedTip = remStoredHere ? 'Stored in Monisette but not near enough to retrieve!' : 'Item exists but is in unreachable bags.';
  // Gallimaufry (currency) can't be pulled, so it only reads as have/short (amber), never yellow.
  const color = need.currency ? (av === 'short' ? BAD : '#e0b24a') : strandedInStorage ? STORE : availColor(av);
  return (
    <div className="flex items-center gap-1.5 rounded-lg border pl-1 pr-2 py-1" style={{ borderColor: tint(color, 42), background: tint(color, 8) }}>
      {need.currency
        ? <div className="w-6 h-6 rounded-md grid place-items-center shrink-0" style={{ background: tint(color, 18), color }}>{coinGlyph}</div>
        : <ItemIcon id={need.id} name={need.name} size={24} assets={assets} iconSet={iconSet} hover={need.id ? { id: need.id, n: need.name } : undefined} />}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] text-fg-2 truncate">{need.name}</div>
        <div className="flex items-center gap-1 text-[10px] tabular-nums font-bold" style={{ color }}>
          &times;{need.need.toLocaleString()} <span className="font-normal opacity-70">({need.have.toLocaleString()})</span>
          {av === 'pull' && !need.currency && <span title={`${need.inInv} in inventory · pull ${need.need - need.inInv}`}>{pullGlyph}</span>}
        </div>
      </div>
      {canRetrieve && (
        <button onClick={(e) => { e.stopPropagation(); setRetrRect(e.currentTarget.getBoundingClientRect()); }}
          title={`Retrieve ${need.name} from Monisette`}
          className="shrink-0 grid place-items-center w-6 h-6 rounded-md border border-line bg-field/80 text-fg-4 hover:text-accent hover:border-accent/50 transition-colors">
          {retrieveGlyph}
        </button>
      )}
      {canOfferBuy && (
        <button onClick={(e) => { e.stopPropagation(); setBuyRect(e.currentTarget.getBoundingClientRect()); }}
          title={`Buy ${need.name} on the auction house`}
          className="shrink-0 grid place-items-center w-6 h-6 rounded-md border border-line bg-field/80 text-fg-4 hover:text-accent hover:border-accent/50 transition-colors">
          {cartGlyph}
        </button>
      )}
      {strandedInStorage && (
        <div title={strandedTip} className="shrink-0 grid place-items-center w-6 h-6 rounded-md border" style={{ borderColor: tint(STORE, 42), background: tint(STORE, 12), color: STORE }}>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </div>
      )}
      {buyRect && buy && <BuyPopover need={need} rect={buyRect} ctx={buy} onClose={() => setBuyRect(null)} />}
      {retrRect && buy && remCh != null && <RetrievePopover need={need} chapter={remCh} rect={retrRect} ctx={buy} onClose={() => setRetrRect(null)} />}
    </div>
  );
}

// Shared Add ("+") button used by both views. Disabled while EXECUTION_ENABLED is false.
function AddButton({ o, path, queued, inProgress, accent, ink, onAdd, qAvail }: { o: Opportunity; path: PathStatus; queued: boolean; inProgress?: boolean; accent: string; ink: string; onAdd: (o: Opportunity, p: PathStatus) => void; qAvail: (id: number | null) => number }) {
  const buy = useContext(ReforgeBuyCtx);
  const npc = o.step.npc ?? 'Monisette';
  const near = buy ? buy.nearNpc(npc) : false;
  const chainInput = qAvail(path.input.id) >= 1;
  const chainDoable = chainInput && path.needs.every((n) => n.currency ? n.have >= n.need : qAvail(n.id) >= n.need);
  // Why this piece can't be queued right now (null = it can), surfaced on the button tooltip.
  const block: string | null = !EXECUTION_ENABLED ? 'Reforge execution is coming soon'
    : !near ? `Stand near ${npcName(npc)} to queue this`
    : !chainInput ? 'Own or queue the base piece first'
    : !chainDoable ? 'Short on materials'
    : null;
  const canAdd = !queued && !inProgress && block == null;

  // Already being made by the running queue: not addable, shown as a hammer so it reads as "reforging"
  // rather than "in your queue" (the checkmark). Takes precedence over the queued check.
  if (inProgress && !queued) {
    return (
      <button disabled aria-label="Reforging" title="Already reforging in the running queue" className="shrink-0 grid place-items-center w-10 h-10 rounded-lg border-2" style={{ borderColor: accent, color: accent }}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" /></svg>
      </button>
    );
  }
  if (queued) {
    return (
      <button disabled aria-label="Queued" title="In the queue" className="shrink-0 grid place-items-center w-10 h-10 rounded-lg" style={{ background: accent, color: ink }}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
    );
  }
  // Green outline = addable; red outline = blocked (the reason rides on the tooltip, not inline text, to
  // keep the row uncramped). aria-disabled (not `disabled`) so the browser still shows the title on hover.
  return (
    <button onClick={() => canAdd && onAdd(o, path)} aria-disabled={!canAdd} aria-label="Add"
      title={canAdd ? 'Add to queue' : block ?? ''}
      className={`shrink-0 grid place-items-center w-10 h-10 rounded-lg border-2 transition-colors ${canAdd ? 'border-[#4fd1a5] text-[#4fd1a5] hover:bg-[#4fd1a5]/15' : 'border-[#f0766f] text-[#f0766f] cursor-not-allowed'}`}>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}

// ---- Concept 2: expandable list row (Ready view) ----
function ListRow({ o, accent, ink, queued, inProgress, onAdd, qAvail, open, onToggle, ...ic }: { o: Opportunity; accent: string; ink: string; queued: boolean; inProgress?: boolean; onAdd: (o: Opportunity, p: PathStatus) => void; qAvail: (id: number | null) => number; open: boolean; onToggle: () => void } & IconProps) {
  const owned = o.paths.filter((p) => p.hasInput);
  const [label, setLabel] = useState<string>(() => pickBest(o.paths)?.label ?? owned[0]?.label ?? '');
  const path = owned.find((p) => p.label === label) ?? pickBest(o.paths);
  if (!path) return null;
  const st = statusOf(o, path);
  const chained = !path.hasInput && qAvail(path.input.id) >= 1;
  const inputCol = chained ? CHAIN : availColor(needAvail(path.inputInInv, path.inputCount, 1));
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden" style={queued || inProgress ? { borderColor: accent } : undefined}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button onClick={onToggle} className="le-tap flex items-center gap-3 min-w-0 flex-1 text-left">
          <ItemIcon id={o.step.output.id} name={o.step.output.name} size={38} ring={accent} hover={hoverOf(o.step.output)} {...ic} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate leading-tight" style={{ color: accent }}>{o.step.output.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-fg-4">{o.slot}</span>
              <Tier to={o.step.to} accent={accent} />
              {o.step.npc && <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: npcColor(o.step.npc) }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: npcColor(o.step.npc) }} />{npcName(o.step.npc)}</span>}
              {path.multiPart && <span title="Two-day reforge: two trades on two Vana'diel days" className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">2-Day</span>}
              {st && <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: st.c }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.c }} />{st.l}</span>}
              {!st && chained && <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: CHAIN }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: CHAIN }} />chained</span>}
            </div>
          </div>
        </button>
        <AddButton o={o} path={path} queued={queued} inProgress={inProgress} accent={accent} ink={ink} onAdd={onAdd} qAvail={qAvail} />
        <button onClick={onToggle} aria-label="Details" className="le-tap shrink-0 text-fg-4 hover:text-fg-2 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>{chev}</button>
      </div>
      {open && (
        <div className="border-t border-line px-3 py-3 bg-field/40 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-fg-4">from</span>
            <ItemIcon id={path.input.id} name={path.input.name} size={28} ring={inputCol} hover={hoverOf(path.input)} {...ic} />
            <span className="text-[12.5px] text-fg-2 font-medium">{path.input.name}</span>
            <span className="text-[11px] font-medium" style={{ color: inputCol }}>{chained ? 'from an earlier queued step' : path.inputBag ? `Acquired · ${path.inputBag}` : `have ${path.inputCount}`}</span>
            {owned.length > 1 && (
              <div className="ml-auto flex rounded-lg border border-line overflow-hidden">
                {owned.map((p) => (
                  <button key={p.label} onClick={() => setLabel(p.label)} title={p.doable ? '' : 'missing ingredients'}
                    className={`px-2.5 py-1 text-[10.5px] font-bold transition-colors ${p.label === label ? '' : 'text-fg-3 hover:text-fg-2 bg-field'} ${p.doable ? '' : 'opacity-60'}`}
                    style={p.label === label ? { background: accent, color: ink } : undefined}>{p.label}</button>
                ))}
              </div>
            )}
          </div>
          {path.multiPart && path.partNeeds ? (
            <div className="flex flex-col gap-2.5">
              {path.partNeeds.map((pn, di) => (
                <div key={di} className="flex items-center gap-2">
                  <span className="shrink-0 w-9 text-[9px] font-extrabold uppercase tracking-wide text-amber-300 text-center py-0.5 rounded bg-amber-500/12">D{di + 1}</span>
                  <div className="grid gap-1.5 flex-1" style={{ gridTemplateColumns: `repeat(${pn.length}, minmax(0, 1fr))` }}>{pn.map((n, i) => <IngChip key={i} need={n} {...ic} />)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${path.needs.length}, minmax(0, 1fr))` }}>{path.needs.map((n, i) => <IngChip key={i} need={n} {...ic} />)}</div>
          )}
          {path.needsPull && <div className="flex items-center gap-1 text-[10.5px] text-sky-300/90">{pullGlyph} Materials will be pulled from your other bags prior to reforging.</div>}
        </div>
      )}
    </div>
  );
}

// ---- Concept 3: set-board row (All / catalog view) ----
function ReqTile({ id, name, avail, ring, hover, size = 32, need, ...ic }: { id: number | null; name: string; avail?: Avail; ring?: string; hover?: HoverMeta; size?: number; need?: IngredientNeed } & IconProps) {
  const h = useItemHover(hover ?? null);
  const col = avail ? availColor(avail) : (ring ?? 'var(--color-line)');
  const buy = useContext(ReforgeBuyCtx);
  const [buyRect, setBuyRect] = useState<DOMRect | null>(null);
  const [retrRect, setRetrRect] = useState<DOMRect | null>(null);
  const shortTile = !!need && !need.currency && need.id != null && need.have < need.need;
  const canOfferBuy = shortTile && !!buy && buy.canAh && buy.ahable(need!.id);
  const remCh = need ? remChapterOf(need.id) : null;
  const canRetrieve = shortTile && remCh != null && !!buy && buy.remStored(remCh) > 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div onClick={hover ? h.onClick : undefined} title={name} className={`w-full h-full rounded-md grid place-items-center overflow-hidden${hover ? ' cursor-pointer hover:brightness-125 transition-[filter]' : ''}`}
        style={{ boxShadow: `inset 0 0 0 1.5px ${col}`, background: avail ? tint(availColor(avail), 12) : 'var(--color-field)' }}>
        {need?.currency
          ? <span style={{ color: col }}>{coinGlyph}</span>
          : <IconInner id={id ?? 0} size={Math.round(size * 0.68)} name={name} assets={ic.assets} bmpHas={id != null && id > 0 && ic.iconSet.has(id)} />}
      </div>
      {canRetrieve ? (
        <button onClick={(e) => { e.stopPropagation(); setRetrRect(e.currentTarget.getBoundingClientRect()); }} title={`Retrieve ${name} from Monisette`}
          className="absolute -right-1.5 -bottom-1.5 grid place-items-center w-[16px] h-[16px] rounded-full border border-line bg-surface-raised text-accent shadow-md hover:brightness-110 transition">
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
        </button>
      ) : canOfferBuy && (
        <button onClick={(e) => { e.stopPropagation(); setBuyRect(e.currentTarget.getBoundingClientRect()); }} title={`Buy ${name}`}
          className="absolute -right-1.5 -bottom-1.5 grid place-items-center w-[16px] h-[16px] rounded-full border border-line bg-surface-raised text-accent shadow-md hover:brightness-110 transition">
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2.3l2.4 12.4a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" /></svg>
        </button>
      )}
      {buyRect && buy && need && <BuyPopover need={need} rect={buyRect} ctx={buy} onClose={() => setBuyRect(null)} />}
      {retrRect && buy && need && remCh != null && <RetrievePopover need={need} chapter={remCh} rect={retrRect} ctx={buy} onClose={() => setRetrRect(null)} />}
    </div>
  );
}
// Lets an in-flight MULTI-day reforge be picked up at the right point: the user says how many days they
// already traded, and the entry carries only the materials for the trades that remain.
function ResumePopover({ o, path, rect, onPick, onClose }: { o: Opportunity; path: PathStatus; rect: DOMRect; onPick: (resumeAfter: number, waiting: boolean) => void; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const outside = (e: Event) => { if (!cardRef.current || !cardRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const days = path.partNeeds?.length ?? 0;
  const W = 248;
  const { left, top } = usePopoverPos(rect, cardRef, W);
  return createPortal(
    <div ref={cardRef} className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl p-3 flex flex-col gap-2" style={{ left, top, width: W }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-fg truncate">{o.step.output.name}</div>
          <div className="text-[10px] text-fg-4 leading-snug">Already in flight -- how many days have you traded to {npcName(o.step.npc ?? 'the NPC')}?</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-auto shrink-0 text-fg-4 hover:text-fg transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {(() => {
        const opts: { after: number; waiting: boolean; label: string; sub: string }[] = [];
        for (let i = 1; i <= days; i++) {
          opts.push({ after: i, waiting: true, label: `Traded Day ${i} -- still cooking`, sub: i < days ? `wait, then Day ${i + 1}` : 'wait, then collect' });
          if (i < days) opts.push({ after: i, waiting: false, label: `Day ${i} done -- trade Day ${i + 1} now`, sub: `${days - i} day${days - i === 1 ? '' : 's'} left` });
        }
        return opts.map((op, k) => (
          <button key={k} onClick={() => { onPick(op.after, op.waiting); onClose(); }}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-line bg-field hover:border-accent/60 hover:bg-accent/10 transition-colors text-left">
            <span className="text-[12px] font-semibold text-fg-2">{op.label}</span>
            <span className="text-[10px] text-fg-4 shrink-0">{op.sub}</span>
          </button>
        ));
      })()}
    </div>,
    document.body,
  );
}

// "Add as already-traded" for the All view: queues a step you already handed to the NPC, NOT gated on
// materials (they're gone) -- only on standing at the NPC. Its output then feeds the chain so the next
// tier can be queued too, which is how a broken queue gets rebuilt. Multi-day pieces open a day picker.
function PendingAddButton({ o, path, queued, inProgress, onAddPending }: { o: Opportunity; path: PathStatus; queued: boolean; inProgress?: boolean; onAddPending: (o: Opportunity, p: PathStatus, resumeAfter?: number, waiting?: boolean) => void }) {
  const buy = useContext(ReforgeBuyCtx);
  const npc = o.step.npc ?? 'Monisette';
  const near = buy ? buy.nearNpc(npc) : false;
  const [pickRect, setPickRect] = useState<DOMRect | null>(null);
  if (queued || inProgress) return null;
  const canAdd = near;
  const multi = path.multiPart && (path.partNeeds?.length ?? 0) > 1;
  return (
    <>
      <button onClick={(e) => { if (!canAdd) return; if (multi) setPickRect(e.currentTarget.getBoundingClientRect()); else onAddPending(o, path); }} aria-disabled={!canAdd}
        title={!canAdd ? `Stand near ${npcName(npc)} to add an in-flight piece`
          : multi ? `Resume an in-flight ${npcName(npc)} reforge -- pick how many days you've traded`
          : `Add as already traded to ${npcName(npc)} (in flight) -- waits for the next day, then collects`}
        className={`shrink-0 grid place-items-center w-10 h-10 rounded-lg border-2 transition-colors ${canAdd ? 'border-accent/70 text-accent hover:bg-accent/15' : 'border-line text-fg-4 cursor-not-allowed'}`}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      </button>
      {pickRect && <ResumePopover o={o} path={path} rect={pickRect} onPick={(after, waiting) => onAddPending(o, path, after, waiting)} onClose={() => setPickRect(null)} />}
    </>
  );
}
function BoardRow({ o, accent, ink, queued, inProgress, onAdd, onAddPending, qAvail, ...ic }: { o: Opportunity; accent: string; ink: string; queued: boolean; inProgress?: boolean; onAdd: (o: Opportunity, p: PathStatus) => void; onAddPending: (o: Opportunity, p: PathStatus, resumeAfter?: number, waiting?: boolean) => void; qAvail: (id: number | null) => number } & IconProps) {
  const path = pickBest(o.paths);
  if (!path) return null;
  const st = statusOf(o, path);
  const chained = !path.hasInput && qAvail(path.input.id) >= 1;
  return (
    <div className="flex items-center gap-3.5 px-3.5 py-3.5 border-b border-line last:border-b-0">
      <span className="w-11 shrink-0 text-[10px] font-extrabold uppercase tracking-wider text-fg-4">{o.slot}</span>
      <ItemIcon id={o.step.output.id} name={o.step.output.name} size={42} ring={o.owned ? accent : undefined} hover={hoverOf(o.step.output)} {...ic} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="min-w-0 truncate text-[15px] font-semibold leading-tight" style={{ color: o.owned ? accent : 'var(--color-fg-2)' }}>{o.step.output.name}</span>
          {o.step.npc && <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold" style={{ color: npcColor(o.step.npc) }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: npcColor(o.step.npc) }} />{npcName(o.step.npc)}</span>}
          {path.multiPart && <span title="Two-day reforge: two trades on two Vana'diel days" className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">2-Day</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <ReqTile id={path.input.id} name={chained ? `from queue: ${path.input.name}` : `from ${path.input.name}`} avail={chained ? undefined : needAvail(path.inputInInv, path.inputCount, 1)} ring={chained ? CHAIN : undefined} hover={hoverOf(path.input)} {...ic} />
          <span className="text-fg-5 mx-0.5 text-[11px]">·</span>
          {path.needs.map((n, i) => <ReqTile key={i} id={n.id} name={n.name} avail={needAvail(n.inInv, n.have, n.need)} hover={n.id ? { id: n.id, n: n.name } : undefined} need={n} {...ic} />)}
          {st && <span className="ml-1 text-[11px] font-semibold" style={{ color: st.c }}>{st.l}</span>}
        </div>
      </div>
      <PendingAddButton o={o} path={path} queued={queued} inProgress={inProgress} onAddPending={onAddPending} />
      <AddButton o={o} path={path} queued={queued} inProgress={inProgress} accent={accent} ink={ink} onAdd={onAdd} qAvail={qAvail} />
    </div>
  );
}

function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
}
function useVanaClock(): VanaClock {
  const [c, setC] = useState(() => vanaState());
  useEffect(() => { const id = setInterval(() => setC(vanaState()), 1000); return () => clearInterval(id); }, []);
  return c;
}
// Real time until the next Vana'diel day. A reforge finishes at the next day boundary, so the readout
// heat-maps toward it: cool/green when the day is far off, hot/red as it nears -- trade when it's hot
// and the piece collects almost instantly.
function VanaClockView() {
  const v = useVanaClock();
  return (
    <div className="shrink-0 flex items-center gap-1.5 text-[11px] rounded-lg border border-line bg-field px-2.5 py-2" title="Real time until the next Vana'diel day. A reforge is ready at the next day, so trading when this is low (green) collects almost instantly.">
      <span className="text-fg-4">Next Gameday</span>
      <span className="font-bold tabular-nums" style={{ color: heatColor(v.realToMidnight, VANA_DAY_REAL) }}>{fmtDur(v.realToMidnight)}</span>
    </div>
  );
}

const runPulse = (<span className="relative w-2 h-2 rounded-full bg-accent shrink-0"><span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-60" /></span>);

// Concept 2 -- pinned strip of every character mid-reforge, soonest-first. Tap a card to switch to it.
function ReforgeStrip({ active, iconSet, onOpen }: { active: ActiveReforge[]; iconSet: Set<number>; onOpen: (name: string) => void }) {
  const now = useNow();
  if (active.length === 0) return null;
  const soonest = active.map((a) => (a.rf.phase === 'wait' && a.rf.readyAt ? Math.max(0, a.rf.readyAt - now) : null)).filter((s): s is number => s != null).sort((x, y) => x - y)[0];
  return (
    <div className="shrink-0 border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
        {runPulse}
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-fg-2">Active Reforges</span>
        <span className="tabular-nums text-[10px] font-extrabold text-on-accent bg-accent rounded-full px-1.5">{active.length}</span>
        {soonest != null && <span className="ml-auto text-[11px] text-fg-4 font-semibold">next ready <span className="tabular-nums" style={{ color: heatColor(soonest) }}>{fmtCd(soonest)}</span></span>}
      </div>
      <div className="pb-2 divide-y divide-line/40">
        {active.map((r) => <ReforgeMiniCard key={r.name} r={r} iconSet={iconSet} accent="var(--color-accent)" onOpen={() => onOpen(r.name)} />)}
      </div>
    </div>
  );
}

// Concept 1 -- while the current character is reforging, the compose footer becomes this: a slim
// always-visible run bar (current piece, phase, live countdown, actions) that expands to the full
// step checklist only on demand, so a long queue never buries the main view.
function ReforgeRunPanel({ rf, conn, names, iconSet, assets }: { rf?: ReforgeState | null; conn?: number; names: Map<number, string>; iconSet: Set<number>; assets?: string }) {
  const now = useNow();
  const [expanded, setExpanded] = useStickyPersisted('reforge.run.expanded', false);
  if (!rf?.active) return null;
  const total = rf.steps ?? 1, cur = rf.step ?? 1;
  const outs = rf.outputs ?? [];
  const left = rf.phase === 'wait' && rf.readyAt ? Math.max(0, rf.readyAt - now) : null;
  const ph = phaseOf(rf);
  const curId = rf.output ?? 0, curName = names.get(curId) ?? '…';
  return (
    <div className="shrink-0 border-t border-line-2 bg-surface-raised">
      <div className="flex items-center gap-2 px-4 py-2.5">
        {runPulse}
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
          <div className="relative shrink-0 w-9 h-9 rounded-lg bg-field grid place-items-center overflow-hidden" style={{ boxShadow: 'inset 0 0 0 1.5px var(--color-accent)' }}>
            <IconInner id={curId} size={30} name={curName} assets={assets} bmpHas={curId > 0 && iconSet.has(curId)} />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold truncate leading-tight">{curName}</div>
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <span className="font-bold" style={{ color: ph.color }}>{rf.awaitStep ? 'Confirm stats' : ph.label}</span>
              <span className="text-fg-4 tabular-nums">· {Math.max(0, cur - 1)}/{total} done</span>
            </div>
          </div>
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-fg-4 transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="m6 15 6-6 6 6" /></svg>
        </button>
        {left != null && <span className="shrink-0 tabular-nums text-[17px] font-bold" style={{ color: heatColor(left) }}>{fmtCd(left)}</span>}
        {rf.awaitStep && conn != null && <button onClick={() => reforgeStep(conn)} className="shrink-0 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 rounded-lg px-2.5 py-1.5 hover:bg-emerald-500/25 transition-colors">Continue</button>}
        {conn != null && <button onClick={() => reforgePause(conn)} title="Pause & save this queue -- resume at the NPC later, even after leaving or reloading" className="shrink-0 text-[11px] font-bold text-amber-300 bg-amber-500/12 border border-amber-500/30 rounded-lg px-2.5 py-1.5 hover:bg-amber-500/20 transition-colors">Pause</button>}
        {conn != null && <button onClick={() => reforgeStop(conn)} className="shrink-0 text-[11px] font-bold text-red-300 bg-red-500/12 border border-red-500/30 rounded-lg px-2.5 py-1.5 hover:bg-red-500/20 transition-colors">Stop</button>}
      </div>
      {expanded && outs.length > 0 && (
        <div className="px-4 pb-3 pt-1.5 border-t border-line/50 flex flex-col gap-0.5 max-h-[34vh] overflow-y-auto">
          {outs.map((id, i) => {
            const done = i < cur - 1, on = i === cur - 1;
            return (
              <div key={i} className={`flex items-center gap-2.5 px-1.5 py-1 rounded-md ${on ? 'bg-accent/[0.06]' : ''}`}>
                <span className={`w-4 h-4 rounded-full grid place-items-center text-[10px] font-extrabold shrink-0 ${done ? 'bg-accent/15 text-accent' : on ? 'bg-accent text-on-accent' : 'text-fg-4'}`} style={done || on ? undefined : { boxShadow: 'inset 0 0 0 1.4px var(--color-line-2)' }}>{done ? '✓' : i + 1}</span>
                <span className={`text-[12.5px] truncate ${on ? 'font-bold text-fg' : done ? 'text-fg-3 font-medium' : 'text-fg-4 font-medium'}`}>{names.get(id) ?? `Item ${id}`}</span>
                {on && <span className="ml-auto text-[10.5px] font-semibold" style={{ color: ph.color }}>{rf.awaitStep ? 'confirm' : ph.label.toLowerCase()}</span>}
                {done && <span className="ml-auto text-[10.5px] text-fg-4 font-medium">collected</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A paused queue (saved to disk) waiting to be resumed. Shows when the character isn't running one but
// has a saved reforge; Resume is enabled once they're standing at the NPC it was paused at.
function ReforgeResumePanel({ rf, conn, near }: { rf?: ReforgeState | null; conn?: number; near: (npc: string) => boolean }) {
  if (!rf || rf.active || !rf.paused) return null;
  const npc = rf.paused.npc || 'Monisette';
  const atNpc = near(npc);
  return (
    <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/[0.07] px-4 py-2.5 flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold text-amber-200">Paused reforge</div>
        <div className="text-[10.5px] text-fg-4">{rf.paused.steps} step{rf.paused.steps === 1 ? '' : 's'} saved at {npcName(npc)}{atNpc ? '' : ` · go to ${npcName(npc)} to resume`}</div>
      </div>
      {conn != null && <button onClick={() => reforgeResume(conn)} disabled={!atNpc} title={atNpc ? 'Resume where you left off' : `Stand near ${npcName(npc)} to resume`}
        className="shrink-0 text-[11.5px] font-bold rounded-lg px-3.5 py-1.5 bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Resume</button>}
    </div>
  );
}

export default function ReforgeView() {
  const db = useReforgeDB();
  const iconSet = useAvailableIcons();
  const known = useKnownCharacters();
  const online = useMemo<KnownChar[]>(() => known.filter((k) => k.online && k.conn != null), [known]);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  const conn = active?.conn;
  const inv = active?.inv;
  const assets = active?.assets;
  const ic = { assets, iconSet };

  const [tab, setTab] = useStickyPersisted<ArmorType>('reforge.tab', 'artifact');
  const [mode, setMode] = useStickyPersisted<'ready' | 'all'>('reforge.mode', 'ready');
  const [qExpanded, setQExpanded] = useStickyPersisted('reforge.queue.expanded', false);
  const [jobFilter, setJobFilter] = useState('');
  const [slotFilter, setSlotFilter] = useState('');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useReforgeQueue(active?.name);
  const otherQueued = useOtherQueuedChars(active?.name);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const accent = TYPE_COLOR[tab], ink = TYPE_INK[tab];

  const opps = useMemo(() => buildOpportunities(db, inv, active?.cur), [db, inv, active?.cur]);
  const activeReforges = useActiveReforges();
  const names = useMemo(() => reforgeNameMap(db), [db]);
  const running = active?.reforge?.active ?? false;
  // Projected item count after running the current queue: real inventory + each queued step's output,
  // minus its input and ingredients. Lets a step whose input is produced by an EARLIER queued step be
  // queued too (queue Chasseur's Gants, then Chasseur's Gants +1 which trades in the reforged one).
  const qAvail = useMemo(() => {
    const delta = new Map<number, number>();
    const bump = (id: number | null, n: number) => { if (id != null) delta.set(id, (delta.get(id) ?? 0) + n); };
    // A pending (already-traded) step only PRODUCES its output; its input + mats were consumed at trade
    // time and aren't in our bags, so don't subtract them.
    for (const e of queue) { bump(e.output.id, 1); if (!e.pending) { bump(e.input.id, -1); for (const ig of e.ingredients) if (!ig.currency && ig.id != null) bump(ig.id, -ig.qty); } }
    // Rem's Tale chapters count what's stored with Monisette (auto-retrieved), so a step gated only on
    // stored chapters is still addable/doable.
    return (id: number | null) => (id == null ? 0 : reforgeCount(inv, id).have + (delta.get(id) ?? 0) + remStoredCount(active?.cur, id));
  }, [queue, inv, active?.cur]);
  const readyCount = useMemo(() => { const m: Record<string, number> = {}; for (const o of opps) if (o.owned) m[o.type] = (m[o.type] ?? 0) + 1; return m; }, [opps]);
  const shown = useMemo(() => opps.filter((o) => o.type === tab && (mode === 'all' || o.owned || o.paths.some((p) => qAvail(p.input.id) >= 1))), [opps, tab, mode, qAvail]);
  const jobs = useMemo(() => { const s = new Set<string>(); for (const o of opps) if (o.type === tab) s.add(o.job); return [...s]; }, [opps, tab]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shown.filter((o) => (jobFilter === '' || o.job === jobFilter)
      && (slotFilter === '' || o.slot === slotFilter)
      && (q === '' || o.job.toLowerCase().includes(q) || o.step.output.name.toLowerCase().includes(q)
        || (db[tab]?.[o.job] ? setNameFor(db[tab][o.job]).toLowerCase().includes(q) : false)));
  }, [shown, jobFilter, slotFilter, search, tab, db]);
  const byJob = useMemo(() => { const m = new Map<string, Opportunity[]>(); for (const o of filtered) { const a = m.get(o.job) ?? []; a.push(o); m.set(o.job, a); } return [...m.entries()]; }, [filtered]);

  // Inline auction-house buying for missing ingredients. Prices come from the cached market medians
  // for exactly the short items on screen; the bid is placed by the reforging character (only while
  // it is at an auction house). See ReforgeBuyCtx / BuyPopover.
  const world = useSettings().ahServer || online.find((k) => k.server)?.server;
  const ahCat = useAhCatalog();
  const ahable = useMemo(() => {
    const ids = new Set(ahCat.items.map((i) => i.id));
    return (id: number | null) => id != null && (ids.size === 0 || ids.has(id));
  }, [ahCat.items]);
  const shortIds = useMemo(() => {
    const s = new Set<number>();
    for (const o of filtered) for (const p of o.paths) for (const n of p.needs) if (!n.currency && n.id != null && n.have < n.need && ahable(n.id)) s.add(n.id);
    return [...s];
  }, [filtered, ahable]);
  const values = useItemValues(world, shortIds);
  const buyer = useMemo<Buyer | null>(() => (active && active.conn != null)
    ? { conn: active.conn, name: active.name, atah: !!(active.atah ?? active.ah?.atah), gil: active.gil ?? active.cur?.gil ?? 0 }
    : null, [active]);
  // Rem's Tale chapters stored with Monisette (from the currency page) gate how many can be pulled;
  // fixedNear lists the storage NPCs in range, so it tells us whether the character is at Monisette.
  const remNear = !!active?.fixedNear?.includes('Monisette');
  const remStored = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of active?.cur?.list ?? []) { const mt = /^Rems Tale Chapter (\d+)$/.exec(e.n); if (mt) m.set(Number(mt[1]), e.v); }
    return (ch: number) => m.get(ch) ?? 0;
  }, [active?.cur]);
  const nearSet = useMemo(() => new Set(active?.fixedNear ?? []), [active?.fixedNear]);
  // The Relic +2/+3 NPC ("???") isn't a fixed storage NPC, so its proximity rides the storage-zone list
  // under its real mob name (Aurix, per NPC_LABEL). Fold that in so nearNpc works at it too.
  const storeNearSet = useMemo(() => new Set((active?.storeZone ?? []).map((z) => z.npc)), [active?.storeZone]);
  const buyCtx = useMemo<ReforgeBuy>(() => ({
    world, buyer, price: (id) => (id == null ? undefined : values.get(id)?.median), ahable,
    canAh: !!active?.inTown,
    remNear, remStored, remGet: (ch: number, count: number) => { if (conn != null) reforgeRemGet(conn, ch, count); },
    nearNpc: (npc: string) => nearSet.has(npc) || storeNearSet.has(NPC_LABEL[npc] ?? npc),
  }), [world, buyer, values, ahable, remNear, remStored, conn, nearSet, storeNearSet, active?.inTown]);

  const queuedKeys = useMemo(() => new Set(queue.map((q) => q.key)), [queue]);
  // Outputs the RUNNING reforge is already making: its current step plus every later one (anything not yet
  // collected). Offering to queue a piece that's already in flight makes no sense, so those rows show
  // "reforging" instead of a +, and add() refuses them as a backstop.
  const inFlight = useMemo(() => {
    const rf = active?.reforge, s = new Set<number>();
    if (rf?.active && rf.outputs) { const cur = rf.step ?? 1; rf.outputs.forEach((id, i) => { if (id > 0 && i >= cur - 1) s.add(id); }); }
    return s;
  }, [active?.reforge]);
  const add = (o: Opportunity, p: PathStatus) => setQueue((q) => (q.some((e) => e.key === o.key) || inFlight.has(o.step.output.id ?? -1)) ? q : [...q, { key: o.key, type: o.type, job: o.job, slot: o.slot, label: p.label, npc: o.step.npc ?? 'Monisette', output: o.step.output, input: p.input, ingredients: p.ingredients, ...(p.multiPart ? { parts: partsFromNeeds(p.partNeeds) } : {}) }]);
  // Add a step you ALREADY traded (piece is in flight at the NPC): not gated on materials, and its output
  // feeds the chain projection so the next tier becomes addable, letting a broken queue be rebuilt. For a
  // multi-day reforge, `resumeAfter` = how many days you've already traded; the entry then carries only the
  // materials for the trades that REMAIN (none once every day is traded and you're just waiting to collect).
  // resumeAfter = days already traded; waiting = the last traded day is still cooking (not yet advanced/
  // collected). The entry carries the materials for whatever trades REMAIN (none once everything is traded).
  const addPending = (o: Opportunity, p: PathStatus, resumeAfter?: number, waiting?: boolean) => {
    const remaining = p.multiPart && resumeAfter != null ? (p.partNeeds ?? []).slice(resumeAfter).flat() : [];
    const ings = remaining.map((n) => ({ id: n.id, name: n.name, qty: n.need, currency: n.currency }));
    setQueue((q) => q.some((e) => e.key === o.key) ? q : [...q, { key: o.key, type: o.type, job: o.job, slot: o.slot, label: p.label, npc: o.step.npc ?? 'Monisette', output: o.step.output, input: p.input, ingredients: ings, pending: true, resumeAfter: p.multiPart ? resumeAfter : undefined, resumeWaiting: p.multiPart ? waiting : undefined, ...(p.multiPart ? { parts: partsFromNeeds(p.partNeeds) } : {}) }]);
  };
  const remove = (key: string) => setQueue((q) => q.filter((e) => e.key !== key));
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const itemIngs = (e: QueueEntry) => e.ingredients.filter((i) => !i.currency && i.id != null).map((i) => ({ id: i.id as number, qty: i.qty }));
  const curIngs = (e: QueueEntry) => e.ingredients.filter((i) => i.currency).map((i) => ({ name: i.name, qty: i.qty }));
  const expand = (e: QueueEntry): ReforgeStepPlan[] => {
    // Multi-day reforge -> one internal step per day (non-final days ADVANCE instead of collect), starting
    // from the resume stage: `resumeAfter` days are already done, and if `resumeWaiting` the last of those
    // is still cooking, so it runs as a pending (trade-skipped) step that just waits + advances/collects.
    if (e.parts && e.parts.length) {
      const N = e.parts.length, startAt = e.resumeAfter ?? 0;
      const mk = (i: number, pending: boolean): ReforgeStepPlan => ({
        npc: e.npc, advance: i < N - 1, ...(pending ? { pending: true } : {}),
        input_id: i === 0 && !pending ? (e.input.id ?? 0) : 0,
        output_id: i === N - 1 ? (e.output.id ?? 0) : 0,
        ingredients: e.parts![i].items, currency: e.parts![i].currency,
      });
      const out: ReforgeStepPlan[] = [];
      if (e.resumeWaiting && startAt >= 1) out.push(mk(startAt - 1, true));
      for (let i = startAt; i < N; i++) out.push(mk(i, false));
      return out;
    }
    if (e.pending) return [{ npc: e.npc, pending: true, input_id: 0, output_id: e.output.id ?? 0, ingredients: itemIngs(e), currency: curIngs(e), ...(e.resumeAfter != null ? { resume_after: e.resumeAfter } : {}) }];
    return [{ npc: e.npc, input_id: e.input.id as number, output_id: e.output.id as number, ingredients: itemIngs(e), currency: curIngs(e) }];
  };
  const start = () => {
    if (conn == null) return;
    // Never queue a step whose input piece did not resolve to an id: a multi-part entry used to pass this
    // filter without an input.id check, and expand() then sent its day-1 step with input_id: 0 -- the addon
    // traded the materials with NO gear and the NPC ate them (the lost-Etched-Memories bug). Require a real
    // input id for any non-pending entry. (A pending entry is a collect of an already-traded piece.)
    const steps = queue.filter((e) => e.pending || (e.input.id != null && ((e.parts && e.parts.length) || e.output.id != null))).flatMap(expand);
    if (steps.length) { reforgeStart(conn, { steps }); setQueue([]); }
  };

  return (
    <ReforgeBuyCtx.Provider value={buyCtx}>
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
          <VanaClockView />
          <div className="shrink-0 flex rounded-lg border border-line overflow-hidden text-[11.5px] font-bold divide-x divide-line">
            <button onClick={() => setMode('ready')} className={`px-3 py-2 transition-colors ${mode === 'ready' ? 'bg-accent text-on-accent' : 'bg-field text-fg-3 hover:text-fg-2'}`}>Ready</button>
            <button onClick={() => setMode('all')} className={`px-3 py-2 transition-colors ${mode === 'all' ? 'bg-accent text-on-accent' : 'bg-field text-fg-3 hover:text-fg-2'}`}>All</button>
          </div>
        </div>
        <div className="flex gap-2">
          {TAB_ORDER.map((t) => {
            const on = tab === t, c = TYPE_COLOR[t];
            return (
              <button key={t} onClick={() => setTab(t)} className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-bold border-2 transition-colors"
                style={on ? { background: c, borderColor: c, color: TYPE_INK[t] } : { background: `color-mix(in srgb, ${c} 9%, transparent)`, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, color: 'var(--color-fg-2)' }}>
                {ARMOR_LABEL[t]}
                {(readyCount[t] ?? 0) > 0 && <span className="tabular-nums text-[11px] font-extrabold px-1.5 rounded-full" style={on ? { background: 'rgba(0,0,0,.2)' } : { background: 'var(--color-field)', color: c }}>{readyCount[t]}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0"><Select value={jobFilter || 'All Jobs'} onChange={(v) => setJobFilter(v === 'All Jobs' ? '' : v)} options={['All Jobs', ...jobs]} full searchable /></div>
          <div className="flex-1 min-w-0"><Select value={slotFilter ? SLOT_LABEL[slotFilter] : 'All Slots'} onChange={(v) => setSlotFilter(v === 'All Slots' ? '' : v.toLowerCase())} options={['All Slots', ...SLOT_ORDER.map((s) => SLOT_LABEL[s])]} full /></div>
          <SearchInput value={search} onChange={setSearch} wrap="flex-[1.4] min-w-0" placeholder="Search pieces…" className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
        </div>
      </div>

      <ReforgeStrip active={activeReforges.filter((r) => r.name !== active?.name)} iconSet={iconSet} onOpen={setName} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {online.length === 0 ? (
          <div className="h-full grid place-items-center text-[12px] text-fg-4 px-6 text-center">Connect a character in-game to scan for reforgeable armor.</div>
        ) : byJob.length === 0 ? (
          <div className="h-full grid place-items-center text-center px-8">
            <div className="max-w-sm">
              <div className="w-14 h-14 mx-auto mb-3 rounded-xl grid place-items-center" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
                <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" /></svg>
              </div>
              <div className="text-[13px] font-semibold text-fg mb-1">No {ARMOR_LABEL[tab]} upgrades ready</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">Own an {ARMOR_LABEL[tab]} piece (or its +1/+2) in {active?.name}'s bags and it shows here. Flip to <b className="text-fg-2">All</b> to browse every recipe.</div>
            </div>
          </div>
        ) : (
          <div className="p-3 flex flex-col gap-4">
            {byJob.map(([job, list]) => {
              const sorted = [...list].sort((a, b) => (SLOT_ORDER as readonly string[]).indexOf(a.slot) - (SLOT_ORDER as readonly string[]).indexOf(b.slot) || a.step.to.localeCompare(b.step.to));
              return (
                <div key={job}>
                  <div className="flex items-baseline gap-2 px-1 mb-1.5">
                    <span className="text-[14px] font-extrabold" style={{ color: accent }}>{job}</span>
                    <span className="text-[11.5px] text-fg-4">{db[tab]?.[job] ? setNameFor(db[tab][job]) : ''}</span>
                    <span className="ml-auto text-[10px] text-fg-4 tabular-nums">{list.length} step{list.length === 1 ? '' : 's'}</span>
                  </div>
                  {mode === 'ready' ? (
                    <div className="flex flex-col gap-2">
                      {sorted.map((o) => <ListRow key={o.key} o={o} accent={accent} ink={ink} queued={queuedKeys.has(o.key)} inProgress={inFlight.has(o.step.output.id ?? -1)} onAdd={add} qAvail={qAvail} open={open.has(o.key)} onToggle={() => toggle(o.key)} {...ic} />)}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-line bg-surface overflow-hidden">
                      {sorted.map((o) => <BoardRow key={o.key} o={o} accent={accent} ink={ink} queued={queuedKeys.has(o.key)} inProgress={inFlight.has(o.step.output.id ?? -1)} onAdd={add} onAddPending={addPending} qAvail={qAvail} {...ic} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ReforgeRunPanel rf={active?.reforge} conn={conn} names={names} iconSet={iconSet} assets={assets} />
      <ReforgeResumePanel rf={active?.reforge} conn={conn} near={(npc) => nearSet.has(npc)} />

      {(queue.length > 0 || otherQueued.length > 0) && (
        <div className="shrink-0 border-t border-line bg-surface-raised">
          {/* Slim always-on bar: count, a compact icon strip of what's queued, and Start. The full,
              removable list only unfolds on demand so it never eats the main view. */}
          <div className="flex items-center gap-2.5 px-4 py-2">
            <button onClick={() => queue.length > 0 && setQExpanded((v) => !v)} disabled={queue.length === 0}
              className="flex items-center gap-2 shrink-0 disabled:opacity-60">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-fg-4 transition-transform" style={{ transform: qExpanded ? 'rotate(180deg)' : 'none' }} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="m6 15 6-6 6 6" /></svg>
              <span className="text-[11px] font-bold uppercase tracking-wide text-fg-3">Queue</span>
              {queue.length > 0 && <span className="tabular-nums text-[11px] font-extrabold text-on-accent bg-accent rounded-full px-1.5">{queue.length}</span>}
            </button>
            {!qExpanded && queue.length > 0 && (
              <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto py-0.5">
                {queue.map((e) => <div key={e.key} className="shrink-0" title={e.pending ? `${e.output.name} (pending / in flight)` : undefined}><ItemIcon id={e.output.id} name={e.output.name} size={24} ring={e.pending ? 'var(--color-accent)' : TYPE_COLOR[e.type]} hover={hoverOf(e.output)} {...ic} /></div>)}
              </div>
            )}
            {queue.length > 0 && (
              <button onClick={start} disabled={conn == null} title={running ? 'Add these to the running queue' : undefined} className="ml-auto shrink-0 px-4 py-1.5 text-[12px] font-bold rounded-lg bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">{running ? 'Add to Queue' : 'Start Reforge'}</button>
            )}
          </div>

          {otherQueued.length > 0 && (
            <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap text-[10.5px] text-fg-4">
              <span>Also queued:</span>
              {otherQueued.map((o) => (
                <button key={o.name} onClick={() => setName(o.name)} title={`Switch to ${o.name}`}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-field px-2 py-0.5 text-fg-3 hover:text-fg hover:border-line-2 transition-colors">
                  {o.name}<span className="tabular-nums font-bold text-fg-4">{o.count}</span>
                </button>
              ))}
            </div>
          )}

          {qExpanded && queue.length > 0 && (
            <div className="px-4 pb-3 flex flex-col gap-2.5 border-t border-line/60 pt-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">{ARMOR_LABEL[queue[0].type]} on {active?.name}</span>
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setQueue([])}>Clear</Button>
              </div>
              <div className="flex flex-col gap-1 max-h-[34vh] overflow-y-auto">
                {queue.map((e, i) => (
                  <div key={e.key} className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 ${e.pending ? 'border-accent/50 bg-accent/[0.08]' : 'border-line bg-field/40'}`}>
                    <span className="shrink-0 w-5 tabular-nums text-[11px] text-fg-4 text-center">{i + 1}</span>
                    <ItemIcon id={e.output.id} name={e.output.name} size={26} ring={e.pending ? 'var(--color-accent)' : TYPE_COLOR[e.type]} hover={hoverOf(e.output)} {...ic} />
                    <span className="min-w-0 truncate text-[12px] font-medium text-fg">{e.output.name}</span>
                    {e.pending
                      ? <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent">{e.resumeAfter != null ? (e.ingredients.length === 0 ? `Collect · D${e.resumeAfter} done` : `Resume · D${e.resumeAfter} done`) : 'Pending'} · {npcName(e.npc)}</span>
                      : <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: TYPE_COLOR[e.type], background: `color-mix(in srgb, ${TYPE_COLOR[e.type]} 14%, transparent)` }}>{ARMOR_LABEL[e.type]} · {e.slot}</span>}
                    <button onClick={() => remove(e.key)} aria-label="Remove" className="shrink-0 text-fg-4 hover:text-red-300 transition-colors">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="text-[10.5px] text-fg-4">Trades all materials at once, waits until the piece is ready (the next Vana'diel day), then auto-collects. Queued pieces run in sequence.</div>
            </div>
          )}
        </div>
      )}
    </div>
    </ReforgeBuyCtx.Provider>
  );
}
