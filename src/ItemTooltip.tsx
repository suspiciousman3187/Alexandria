import { createContext, useContext, useState, useRef, useMemo, useEffect, useLayoutEffect, cloneElement, type ReactNode, type ReactElement, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { IconInner } from './atlasIcon';
import { useAvailableIcons, useItemDescription, useKnownCharacters, openExternal, useAhCatalog, type KnownChar } from './bridge';
import { useItemTags, bulkSetTag } from './itemTags';
import { openAhDetail } from './ahNav';
import { bagColor } from './bagColors';
import { Collapse } from './overlay';
import { useSettings } from './settings';
import { logicalRect, logicalViewport } from './uiZoom';
import { itemJobs } from './itemNames';
import { augStats, pieceMods, fmtStat, statLabel, useItemMods, STAT_GROUPS } from './gearset/gearsetStats';

// Category grouping for the condensed stat card, matching the main gear-stats UI. A stat's category comes
// from the curated STAT_GROUPS first, then a name-based fallback (mirrors bucketStat in GearsetView).
const STAT_CAT_ORDER = ['Attributes', 'Offensive Stats', 'Defensive Stats', 'Pet', 'Skills', 'Utility Stats & Other'];
const STAT_CAT_SHORT: Record<string, string> = { 'Offensive Stats': 'Offense', 'Defensive Stats': 'Defense', 'Utility Stats & Other': 'Utility' };
const STAT_CAT_COLOR: Record<string, string> = {
  Attributes: 'var(--gl-gold)', 'Offensive Stats': '#ef9aa0', 'Defensive Stats': '#8fc7f0',
  Pet: '#a985e0', Skills: '#5f9fd7', 'Utility Stats & Other': '#5fc7ad',
};
const STAT_CAT_INDEX: Record<string, string> = (() => { const m: Record<string, string> = {}; for (const g of STAT_GROUPS) for (const k of g.keys) if (!(k in m)) m[k] = g.title; return m; })();
function statCategory(n: string): string {
  if (STAT_CAT_INDEX[n]) return STAT_CAT_INDEX[n];
  if (/^(Pet|Avatar|Automaton|Wyvern|Luopan)\b/i.test(n) || /blood pact|perpetuation/i.test(n)) return 'Pet';
  if (/ skills?$/i.test(n)) return 'Skills';
  if (/taken|resist|\bblock\b|stoneskin|aquaveil|phalanx|mana wall|evasion|defense|status ailment/i.test(n)) return 'Defensive Stats';
  if (/attack|accuracy|\bacc\b|damage|dmg|crit|magic|burst|weapon skill|\btp\b|daken|shot|skillchain|kick|double|triple|quad|zanshin|drain|aspir|enspell/i.test(n)) return 'Offensive Stats';
  return 'Utility Stats & Other';
}
import { Button } from './ui';

export type HoverMeta = { id: number; n?: string; c?: number; ms?: number; f?: number; aug?: string[] };
// `pinned` cards come from a click and stay interactive (scroll, links). Hover cards are previews: they are
// click-through (pointer-events: none) so moving onto the next item never gets blocked by the card.
// `variant`: 'full' is the complete card; 'condensed' is a stats + jobs preview for hover in the gear grid.
type CardVariant = 'full' | 'condensed';
type HoverState = { meta: HoverMeta; rect: DOMRect; anchor: Element; pinned: boolean; variant: CardVariant } | null;

type CardApi = {
  open: (m: HoverMeta, rect: DOMRect, anchor: Element) => void;
  hide: () => void;
  hoverOpen: (m: HoverMeta, rect: DOMRect, anchor: Element, variant?: CardVariant) => void;
  hoverHide: () => void;
  cancelHide: () => void;
};
const Ctx = createContext<CardApi | null>(null);

export function useItemHover(meta: HoverMeta | null | undefined) {
  const ctx = useContext(Ctx);
  const id = meta?.id ?? 0;
  return useMemo(() => ({
    onClick: (e: MouseEvent) => {
      if (!ctx || id <= 0 || !meta) return;
      e.stopPropagation();
      // Clicking the same icon again closes it; clicking a different one moves the card there.
      ctx.open(meta, e.currentTarget.getBoundingClientRect(), e.currentTarget);
    },
  }), [ctx, id, meta?.n, meta?.c, meta?.ms, meta?.f, meta?.aug?.join('|')]);
}

// Raw card controls, for callers that open the card on HOVER (grace-delayed) rather than click.
export function useItemCard(): CardApi | null { return useContext(Ctx); }

export function ItemHoverTarget({ meta, children }: { meta: HoverMeta; children: ReactElement }) {
  const hover = useItemHover(meta);
  return cloneElement(children, hover as Partial<unknown>);
}

export function ItemHoverProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<HoverState>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hideT = useRef<number | undefined>(undefined);
  const api = useMemo<CardApi>(() => {
    const clear = () => { if (hideT.current) { clearTimeout(hideT.current); hideT.current = undefined; } };
    return {
      open: (meta, rect, anchor) => { clear(); setSt((cur) => (cur && cur.anchor === anchor && cur.pinned ? null : { meta, rect, anchor, pinned: true, variant: 'full' })); },
      hide: () => { clear(); setSt(null); },
      hoverOpen: (meta, rect, anchor, variant = 'full') => { clear(); setSt({ meta, rect, anchor, pinned: false, variant }); },
      hoverHide: () => { clear(); hideT.current = window.setTimeout(() => setSt((cur) => (cur && cur.pinned ? cur : null)), 160); },
      cancelHide: clear,
    };
  }, []);

  useEffect(() => {
    if (!st) return;
    const outside = (e: Event) => { if (!cardRef.current || !cardRef.current.contains(e.target as Node)) setSt(null); };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [st]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <AnimatePresence>
        {st && <Card key={st.meta.id} meta={st.meta} rect={st.rect} pinned={st.pinned} variant={st.variant} cardRef={cardRef} onClose={api.hide} onCardEnter={api.cancelHide} onCardLeave={api.hoverHide} />}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

// Job palette shared with Sage (BoT JobIcon.tsx) so job codes read the same across the tools.
const JOB_COLORS: Record<string, string> = {
  WAR: '#e05545', MNK: '#e0913f', WHM: '#d8d0c0', BLM: '#9a6fd6', RDM: '#e0607e', THF: '#67b04f',
  PLD: '#6fb2e6', DRK: '#a24e78', BST: '#b98f57', BRD: '#d96ac8', RNG: '#3f9e6f', SAM: '#d95f38',
  NIN: '#8790cc', DRG: '#5772d6', SMN: '#4fb59a', BLU: '#4f9be0', COR: '#e0b64a', PUP: '#b3763c',
  DNC: '#ef9ab6', SCH: '#74c0a0', GEO: '#aac24f', RUN: '#57c4cc',
};

function flagBadges(f?: number) {
  const out: { label: string; cls: string }[] = [];
  if (!f) return out;
  if (f & 0x01) out.push({ label: 'Rare', cls: 'text-amber-200 border-amber-500/40 bg-amber-500/10' });
  if (f & 0x02) out.push({ label: 'Ex', cls: 'text-rose-200 border-rose-500/40 bg-rose-500/10' });
  if (f & 0x08) out.push({ label: 'No AH', cls: 'text-fg-3 border-line bg-field' });
  if (f & 0x10) out.push({ label: 'No NPC', cls: 'text-fg-3 border-line bg-field' });
  if (f & 0x20) out.push({ label: 'No Delivery', cls: 'text-fg-3 border-line bg-field' });
  return out;
}

// Each distinct instance is grouped by (bag + its exact augments), so copies with different augments show
// separately with their location, rather than all augments being merged into one blob.
type Group = { bagId: number; bag: string; augs: string[]; c: number };
function locate(id: number, chars: KnownChar[]) {
  const byChar: { name: string; online: boolean; total: number; groups: Group[] }[] = [];
  let total = 0;
  for (const ch of chars) {
    if (!ch.inv) continue;
    const map = new Map<string, Group>();
    let ct = 0;
    for (const bag of ch.inv) {
      for (const it of bag.items) {
        if (it.id !== id) continue;
        const augs = it.aug && it.aug.length ? it.aug : [];
        const key = `${bag.id}\u0001${augs.join('\u0002')}`;
        const g = map.get(key);
        if (g) g.c += it.c;
        else map.set(key, { bagId: bag.id, bag: bag.b, augs, c: it.c });
        ct += it.c;
      }
    }
    if (ct > 0) {
      const groups = [...map.values()].sort((a, b) => (b.augs.length ? 1 : 0) - (a.augs.length ? 1 : 0) || a.bagId - b.bagId);
      byChar.push({ name: ch.name, online: !!ch.online, total: ct, groups });
      total += ct;
    }
  }
  byChar.sort((a, b) => b.total - a.total);
  return { byChar, total };
}

export function WhereOwned({ id, collapsible = true, defaultOpen = false, max }: { id: number; collapsible?: boolean; defaultOpen?: boolean; max?: number }) {
  const chars = useKnownCharacters();
  const loc = useMemo(() => locate(id, chars), [id, chars]);
  const [open, setOpen] = useState(defaultOpen);
  const showBags = collapsible ? open : true;

  if (loc.byChar.length === 0) return <div className="text-[11px] text-fg-4">Not in any connected inventory.</div>;

  // On a non-scrollable hover card, cap the owner list so the card can't grow past the window; the full list
  // is on the pinned (right-click) card, which scrolls.
  const shown = max != null && loc.byChar.length > max ? loc.byChar.slice(0, max) : loc.byChar;
  const hiddenCount = loc.byChar.length - shown.length;

  return (
    <>
      {collapsible ? (
        <button onClick={() => setOpen((o) => !o)} className="le-tap w-full flex items-center gap-1.5 mb-1.5 text-left">
          <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Where · <span className="text-emerald-300 tabular-nums">{loc.total.toLocaleString()}</span> total</span>
          <span className="ml-auto text-[9px] text-fg-4">{open ? 'Hide bags' : 'Show bags'}</span>
          <svg viewBox="0 0 24 24" className={`w-3 h-3 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 mb-2 text-[11px]">
          <span className="text-fg-4">Owned by <span className="text-fg-2 font-semibold">{loc.byChar.length}</span> character{loc.byChar.length === 1 ? '' : 's'}</span>
          <span className="ml-auto text-emerald-300 font-bold tabular-nums">{loc.total.toLocaleString()} total</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {shown.map((c) => (
          <div key={c.name}>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-amber-300 font-bold tabular-nums">×{c.total.toLocaleString()}</span>
            </div>
            <Collapse open={showBags}>
              <div className="ml-3 mt-0.5 flex flex-col gap-1">
                {c.groups.map((g, i) => (
                  <div key={i} className="text-[10px]">
                    <div className="flex items-center gap-1.5 tabular-nums">
                      <span className={`font-medium ${bagColor(g.bagId).text}`}>{g.bag}</span>
                      <span className="text-sky-300 font-semibold">×{g.c.toLocaleString()}</span>
                    </div>
                    {g.augs.length > 0 && <div className="ml-2 flex flex-col text-violet-300/90">{g.augs.map((a, k) => <DescLine key={k} line={a} />)}</div>}
                  </div>
                ))}
              </div>
            </Collapse>
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="text-[10px] text-fg-4 pt-0.5">+{hiddenCount} more character{hiddenCount === 1 ? '' : 's'} · right-click to see all</div>
        )}
      </div>
    </>
  );
}

function tokenize(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("[^"]+"|\(Max\.\s*\d+\)|[+\-]?\d+(?:～\d+)?%?)/g;
  let last = 0, i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const cls = t[0] === '"' ? 'text-amber-200 font-semibold'
      : t[0] === '(' ? 'text-fg-4'
        : 'text-emerald-300 font-medium';
    out.push(<span key={i} className={cls}>{t}</span>);
    last = m.index + t.length; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichDescription({ text, className }: { text: string; className?: string }) {
  return <div className={className ?? 'text-[11px] leading-relaxed flex flex-col gap-0.5'}>{text.split('\n').map((ln, i) => <DescLine key={i} line={ln} />)}</div>;
}

function DescLine({ line }: { line: string }) {
  if (line.trim() === '') return <div className="h-1" />;
  const lm = line.match(/^([A-Za-z][A-Za-z.\s'-]*?:)(\s*)(.*)$/);
  if (lm) return <div><span className="text-sky-300 font-semibold">{lm[1]}</span>{lm[2]}{tokenize(lm[3])}</div>;
  if (!/[+\d%"]/.test(line)) return <div className="italic text-fg-3">{line}</div>;
  return <div className="text-fg-2">{tokenize(line)}</div>;
}

function Card({ meta, rect, pinned, variant, onClose, cardRef, onCardEnter, onCardLeave }: { meta: HoverMeta; rect: DOMRect; pinned: boolean; variant: CardVariant; onClose: () => void; cardRef: React.RefObject<HTMLDivElement | null>; onCardEnter?: () => void; onCardLeave?: () => void }) {
  const icons = useAvailableIcons();
  const desc = useItemDescription(meta.id);
  const chars = useKnownCharacters();
  const ahCat = useAhCatalog();
  const tagStore = useItemTags();
  const assets = useMemo(() => chars.find((c) => c.assets)?.assets, [chars]);
  // Resolved augment stats (system-4 path/rank from aug_db + flat hidden stats) that the visible description
  // never carries. `mods` identity changes once the aug DB finishes loading, so the memo recomputes then.
  const mods = useItemMods();
  const augMods = useMemo(() => augStats(meta.id, meta.aug), [meta.id, meta.aug?.join('|'), mods]);
  const augKeys = Object.keys(augMods);
  // Full item stats (base description + augments) for the condensed hover preview.
  const itemStats = useMemo(() => pieceMods(meta.id, meta.aug), [meta.id, meta.aug?.join('|'), mods]);
  const itemStatKeys = Object.keys(itemStats);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const big = useSettings().bigItemCard;
  const M = 8;
  // "Large" mode is about HEIGHT, not width: it gives the card the full height of the screen so
  // long items (many tags + description + owners) fit without scrolling. It keeps the same 300px
  // width and the anchor beside the clicked item; only the available height changes.
  const W = 300;
  // Position in the popover's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws the card
  // off-screen; see uiZoom.ts. No-op at 100%.
  const r = logicalRect(rect);
  const vp = logicalViewport();
  // Prefer sitting the card BESIDE the anchor (right, else left) so the hovered item stays uncovered. In a
  // narrow window where neither side has room, stack it BELOW (or above) the anchor instead of clamping it on
  // top of the item -- otherwise the card covers the very item you want to click (e.g. to retrieve a slip).
  const fitsRight = r.right + M + W <= vp.w;
  const fitsLeft = r.left - M - W >= 0;
  const beside = fitsRight || fitsLeft;
  const left = fitsRight ? r.right + M : fitsLeft ? r.left - W - M : Math.max(M, Math.min(r.left, vp.w - W - M));
  let top: number, maxHeight: number;
  if (big) {
    top = M;
    maxHeight = vp.h - 2 * M;
  } else if (beside) {
    top = Math.max(M, Math.min(r.top, vp.h - 200));
    maxHeight = vp.h - top - M;
  } else {
    // Stacked: open below the anchor if there's more room there, else above it.
    const below = vp.h - r.bottom - M;
    const above = r.top - M;
    if (below >= above) { top = r.bottom + M; maxHeight = below; }
    else { maxHeight = Math.min(above, vp.h - 2 * M); top = Math.max(M, r.top - M - maxHeight); }
  }

  // A HOVER card (condensed or full) is click-through (pointer-events:none), so an overflow scrollbar is
  // unusable -- a card taller than the space below the cursor gets cut off (the "tooltip cut off when the
  // window is small" report). Measure the card after layout and shift it UP so the whole thing fits; only
  // fall back to a (useless-on-hover) scroll region in the rare case it is taller than the viewport itself,
  // which the owner-list cap below keeps rare. Pinned cards are interactive and scroll normally.
  const [fit, setFit] = useState<{ top: number; scroll: boolean } | null>(null);
  useLayoutEffect(() => {
    if (pinned) { if (fit) setFit(null); return; }
    const el = cardRef.current;
    if (!el) return;
    const h = el.scrollHeight;
    const maxH = vp.h - 2 * M;
    const next = h <= maxH
      ? { top: Math.max(M, Math.min(top, vp.h - h - M)), scroll: false }
      : { top: M, scroll: true };
    if (!fit || fit.top !== next.top || fit.scroll !== next.scroll) setFit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, pinned, meta.id, meta.aug?.join('|'), itemStatKeys.length, top, vp.h]);

  const name = meta.n || `Item ${meta.id}`;
  const badges = flagBadges(meta.f);
  const jobInfo = itemJobs(meta.id);
  const noAh = !!((meta.f ?? 0) & 0x08);
  const ahItem = ahCat.items.find((i) => i.id === meta.id);
  const sellable = ahCat.items.length > 0 ? !!ahItem : !noAh;
  const stack = meta.ms ? ` · ${meta.c ?? 0} / ${meta.ms}` : (meta.c && meta.c > 1 ? ` · x${meta.c}` : '');
  const nameSlug = encodeURIComponent(name.replace(/ /g, '_'));
  const links = [
    { label: 'BG Wiki', url: `https://www.bg-wiki.com/ffxi/${nameSlug}` },
    { label: 'Wiki', url: `https://ffxi.gamerescape.com/wiki/${nameSlug}` },
    { label: 'FFXIAH', url: `https://www.ffxiah.com/item/${meta.id}` },
  ];

  if (variant === 'condensed' && !pinned) {
    return createPortal(
      <motion.div
        ref={cardRef}
        className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl px-3 py-2.5 overscroll-contain"
        style={{
          left,
          top: fit ? fit.top : top,
          width: 304,
          maxHeight: fit && !fit.scroll ? undefined : maxHeight,
          overflowY: fit && !fit.scroll ? 'visible' : 'auto',
          pointerEvents: 'none',
          // Hide the first pre-measure frame (positioned with the clamped/clipped top) until the layout
          // effect has placed the card, so it never flashes half-off-screen.
          visibility: fit ? 'visible' : 'hidden',
        }}
        initial={{ opacity: 0, scale: 0.97, y: -3 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-7 h-7 rounded bg-field grid place-items-center overflow-hidden shrink-0"><IconInner id={meta.id} size={28} name={name} assets={assets} bmpHas={meta.id > 0 && icons.has(meta.id)} /></span>
          <span className="text-[12px] font-bold text-fg leading-tight truncate">{name}</span>
        </div>
        {itemStatKeys.length > 0 ? (
          STAT_CAT_ORDER.map((cat) => {
            const keys = itemStatKeys.filter((k) => statCategory(k) === cat);
            if (!keys.length) return null;
            const col = STAT_CAT_COLOR[cat];
            return (
              <div key={cat} className="mt-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.14em]" style={{ color: col }}>{STAT_CAT_SHORT[cat] ?? cat}</span>
                  <span className="flex-1 h-px" style={{ background: 'var(--color-line-2)' }} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-[2px] text-[11px]">
                  {keys.map((k) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 leading-[1.4]">
                      <span className="text-fg-2 truncate min-w-0" title={statLabel(k)}>{statLabel(k)}</span>
                      <span className="font-mono font-bold tabular-nums shrink-0" style={{ color: itemStats[k] < 0 ? '#7fd6ad' : 'var(--color-fg)' }}>{fmtStat(k, itemStats[k])}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : desc ? (
          // No passive stats, but the item has descriptive text (an enchantment / latent / "on use"
          // effect that the stat engine intentionally excludes). Show it so the card isn't a bare "No stats".
          <div className="mt-1.5 text-[10.5px] leading-relaxed text-fg-2 flex flex-col gap-0.5">
            {desc.split('\n').map((ln, i) => <div key={i}>{ln}</div>)}
          </div>
        ) : <div className="mt-1 text-[10.5px] text-fg-4">No stats</div>}
        {jobInfo && (jobInfo.all || jobInfo.jobs.length > 0) && (
          <div className="mt-2 pt-1.5 border-t border-line flex flex-wrap gap-1">
            {jobInfo.all
              ? <span className="px-1.5 py-[1px] rounded text-[9px] font-bold border border-accent/50 text-accent bg-accent/10">ALL</span>
              : jobInfo.jobs.map((j) => { const col = JOB_COLORS[j] ?? 'var(--color-fg-2)'; return <span key={j} className="px-1 py-[1px] rounded text-[9px] font-bold border" style={{ color: col, borderColor: `${col}66`, backgroundColor: `${col}1f` }}>{j}</span>; })}
          </div>
        )}
      </motion.div>,
      document.body,
    );
  }

  return createPortal(
    <motion.div
      ref={cardRef}
      onMouseEnter={pinned ? onCardEnter : undefined}
      onMouseLeave={pinned ? onCardLeave : undefined}
      className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl p-3 overscroll-contain"
      style={{
        left,
        // Pinned cards scroll normally; hover cards shift up to fit (fit is only measured when !pinned).
        top: !pinned && fit ? fit.top : top,
        width: W,
        maxHeight: !pinned && fit && !fit.scroll ? undefined : maxHeight,
        overflowY: !pinned && fit && !fit.scroll ? 'visible' : 'auto',
        pointerEvents: pinned ? 'auto' : 'none',
        visibility: pinned || fit ? 'visible' : 'hidden',
      }}
      initial={{ opacity: 0, scale: 0.97, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        onClick={onClose}
        className="le-tap absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-md text-fg-4 hover:text-fg hover:bg-field transition-colors"
        aria-label="Close"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <div className="flex gap-3 pr-6">
        <div className="shrink-0 w-12 h-12 rounded-md bg-field grid place-items-center overflow-hidden">
          <IconInner id={meta.id} size={32} name={name} assets={assets} bmpHas={meta.id > 0 && icons.has(meta.id)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-fg leading-tight">{name}</div>
          <div className="text-[10px] text-fg-4 mt-0.5 tabular-nums">#{meta.id}{stack}{jobInfo?.level ? ` · Lv ${jobInfo.level}` : ''}</div>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {badges.map((b) => <span key={b.label} className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${b.cls}`}>{b.label}</span>)}
            </div>
          )}
        </div>
      </div>

      {tagStore.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4 mr-0.5">Tags</span>
          {tagStore.tags.map((t) => {
            const has = (tagStore.assign[meta.id] ?? []).includes(t.id);
            return (
              <button key={t.id} onClick={() => bulkSetTag([meta.id], t.id, !has)} title={has ? `Remove ${t.name}` : `Tag as ${t.name}`}
                className="px-2 py-0.5 rounded text-[10px] border font-semibold flex items-center gap-1 transition-colors"
                style={has ? { backgroundColor: `${t.color}26`, color: t.color, borderColor: `${t.color}66` } : { color: t.color, borderColor: 'var(--color-line)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />{t.name}
              </button>
            );
          })}
        </div>
      )}

      {desc && (
        <div className="mt-2.5 text-[11px] leading-relaxed flex flex-col gap-0.5">
          {desc.split('\n').map((ln, i) => <DescLine key={i} line={ln} />)}
        </div>
      )}

      {jobInfo && (jobInfo.all || jobInfo.jobs.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4 mr-0.5">Jobs</span>
          {jobInfo.all
            ? <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-accent/50 text-accent bg-accent/10">All Jobs</span>
            : jobInfo.jobs.map((j) => { const col = JOB_COLORS[j] ?? 'var(--color-fg-2)'; return <span key={j} className="px-1.5 py-0.5 rounded text-[10px] font-bold border" style={{ color: col, borderColor: `${col}66`, backgroundColor: `${col}1f` }}>{j}</span>; })}
        </div>
      )}

      {(augKeys.length > 0 || (meta.aug && meta.aug.length > 0)) && (
        <div className="mt-2.5 pt-2.5 border-t border-line">
          <div className="text-[10px] font-bold uppercase tracking-wide text-violet-300 mb-1">Augments</div>
          {augKeys.length > 0 && (
            <div className="flex flex-col gap-0.5 text-[11px] mb-1.5">
              {augKeys.map((k) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="text-fg-2">{statLabel(k)}</span>
                  <span className="font-mono font-semibold text-emerald-300 tabular-nums">{fmtStat(k, augMods[k])}</span>
                </div>
              ))}
            </div>
          )}
          {meta.aug && meta.aug.length > 0 && (
            <div className="flex flex-col gap-0.5 text-[10px] text-fg-4">
              {meta.aug.map((a, i) => <DescLine key={i} line={a} />)}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 pt-2.5 border-t border-line flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Info</span>
        {links.map((l) => (
          <Button key={l.label} variant="link" onClick={() => openExternal(l.url)}>[{l.label}]</Button>
        ))}
      </div>

      {sellable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            openAhDetail({ id: meta.id, n: name, st: meta.ms ?? 1, ac: ahItem?.ac, lvl: ahItem?.lvl, j: ahItem?.j, cat: ahItem?.cat, back: 'inventory' });
          }}
          className="le-tap mt-2.5 w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-field text-[11px] font-semibold text-fg-3 hover:text-fg hover:border-line-2 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 4.4-4.4a2 2 0 0 1 1.4-.6h8.4a2 2 0 0 1 1.4.6L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M2 7h20" /></svg>
          Look Up On Auction House
        </button>
      )}

      <div className="mt-2.5 pt-2.5 border-t border-line">
        <WhereOwned id={meta.id} max={pinned ? undefined : 12} />
      </div>
    </motion.div>,
    document.body,
  );
}
