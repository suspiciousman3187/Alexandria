import { createContext, useContext, useState, useRef, useMemo, useEffect, cloneElement, type ReactNode, type ReactElement, type MouseEvent } from 'react';
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
import { Button } from './ui';

export type HoverMeta = { id: number; n?: string; c?: number; ms?: number; f?: number; aug?: string[] };
type HoverState = { meta: HoverMeta; rect: DOMRect; anchor: Element } | null;

type CardApi = {
  open: (m: HoverMeta, rect: DOMRect, anchor: Element) => void;
  hide: () => void;
  hoverOpen: (m: HoverMeta, rect: DOMRect, anchor: Element) => void;
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
      open: (meta, rect, anchor) => { clear(); setSt((cur) => (cur && cur.anchor === anchor ? null : { meta, rect, anchor })); },
      hide: () => { clear(); setSt(null); },
      hoverOpen: (meta, rect, anchor) => { clear(); setSt({ meta, rect, anchor }); },
      hoverHide: () => { clear(); hideT.current = window.setTimeout(() => setSt(null), 160); },
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
        {st && <Card key={st.meta.id} meta={st.meta} rect={st.rect} cardRef={cardRef} onClose={api.hide} onCardEnter={api.cancelHide} onCardLeave={api.hoverHide} />}
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

function locate(id: number, chars: KnownChar[]) {
  const byChar: { name: string; online: boolean; spots: { bag: string; bagId: number; c: number }[]; total: number }[] = [];
  let total = 0;
  for (const ch of chars) {
    if (!ch.inv) continue;
    const spots: { bag: string; bagId: number; c: number }[] = [];
    let ct = 0;
    for (const bag of ch.inv) {
      let n = 0;
      for (const it of bag.items) if (it.id === id) n += it.c;
      if (n > 0) { spots.push({ bag: bag.b, bagId: bag.id, c: n }); ct += n; }
    }
    if (ct > 0) { byChar.push({ name: ch.name, online: !!ch.online, spots, total: ct }); total += ct; }
  }
  byChar.sort((a, b) => b.total - a.total);
  return { byChar, total };
}

export function WhereOwned({ id, collapsible = true, defaultOpen = false }: { id: number; collapsible?: boolean; defaultOpen?: boolean }) {
  const chars = useKnownCharacters();
  const loc = useMemo(() => locate(id, chars), [id, chars]);
  const [open, setOpen] = useState(defaultOpen);
  const showBags = collapsible ? open : true;

  if (loc.byChar.length === 0) return <div className="text-[11px] text-fg-4">Not in any connected inventory.</div>;

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
        {loc.byChar.map((c) => (
          <div key={c.name}>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-amber-300 font-bold tabular-nums">×{c.total.toLocaleString()}</span>
            </div>
            <Collapse open={showBags}>
              <div className="ml-3 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] tabular-nums">
                {c.spots.map((s) => <span key={s.bag} className="whitespace-nowrap"><span className={`font-medium ${bagColor(s.bagId).text}`}>{s.bag}</span> <span className="text-sky-300 font-semibold">×{s.c.toLocaleString()}</span></span>)}
              </div>
            </Collapse>
          </div>
        ))}
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

function Card({ meta, rect, onClose, cardRef, onCardEnter, onCardLeave }: { meta: HoverMeta; rect: DOMRect; onClose: () => void; cardRef: React.RefObject<HTMLDivElement | null>; onCardEnter?: () => void; onCardLeave?: () => void }) {
  const icons = useAvailableIcons();
  const desc = useItemDescription(meta.id);
  const chars = useKnownCharacters();
  const ahCat = useAhCatalog();
  const tagStore = useItemTags();
  const assets = useMemo(() => chars.find((c) => c.assets)?.assets, [chars]);

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
  let left = r.right + M;
  if (left + W > vp.w) left = r.left - W - M;
  if (left < M) left = M;
  let top: number, maxHeight: number;
  if (big) {
    top = M;
    maxHeight = vp.h - 2 * M;
  } else {
    top = Math.max(M, Math.min(r.top, vp.h - 200));
    maxHeight = vp.h - top - M;
  }

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

  return createPortal(
    <motion.div
      ref={cardRef}
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
      className="fixed z-[80] rounded-lg border border-line bg-popover shadow-2xl p-3 overscroll-contain"
      style={{ left, top, width: W, maxHeight, overflowY: 'auto' }}
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

      {meta.aug && meta.aug.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-line">
          <div className="text-[10px] font-bold uppercase tracking-wide text-violet-300 mb-1">Augments</div>
          <div className="flex flex-col gap-0.5 text-[11px]">
            {meta.aug.map((a, i) => <DescLine key={i} line={a} />)}
          </div>
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
        <WhereOwned id={meta.id} />
      </div>
    </motion.div>,
    document.body,
  );
}
