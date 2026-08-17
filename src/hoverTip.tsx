import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { IconInner } from './atlasIcon';
import { useItemDescription, useAhCatalog } from './bridge';
import { acPathLabel } from './ahCategories';
import { RichDescription, WhereOwned } from './ItemTooltip';
import { getCachedValue } from './priceStore';

const fmtGil = (n: number) => Math.round(n).toLocaleString();

function flagBadges(f?: number): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  if (!f) return out;
  if (f & 0x01) out.push({ label: 'Rare', cls: 'text-amber-200 border-amber-500/40 bg-amber-500/10' });
  if (f & 0x02) out.push({ label: 'Ex', cls: 'text-rose-200 border-rose-500/40 bg-rose-500/10' });
  if (f & 0x08) out.push({ label: 'No AH', cls: 'text-fg-3 border-line bg-field' });
  if (f & 0x20) out.push({ label: 'No Delivery', cls: 'text-fg-3 border-line bg-field' });
  return out;
}

// Instant themed hover tooltip, shared by the Library grid and the Tag builder. A
// single element driven by a tiny store, so hovering tiles never re-renders the
// grid; the <HoverTip> instance is the only subscriber. Fire setTip on mouseenter,
// clearTip on mouseleave/pointerdown, and drop one <HoverTip/> in the host view.
export type TipMeta = { id: number; n: string; c: number; f?: number; aug?: string[]; fleet?: number };
let tipState: { meta: TipMeta; rect: DOMRect } | null = null;
let tipSuppressed = false;
const tipSubs = new Set<() => void>();
export const setTip = (meta: TipMeta, rect: DOMRect) => { if (tipSuppressed) return; tipState = { meta, rect }; tipSubs.forEach((f) => f()); };
export const clearTip = () => { if (tipState) { tipState = null; tipSubs.forEach((f) => f()); } };
export const suppressTip = (on: boolean) => { tipSuppressed = on; if (on) clearTip(); };

export function HoverTip({ assets, iconSet, server }: { assets?: string; iconSet: Set<number>; server?: string }) {
  const st = useSyncExternalStore((cb) => { tipSubs.add(cb); return () => tipSubs.delete(cb); }, () => tipState, () => tipState);
  const desc = useItemDescription(st?.meta.id ?? 0);
  const ahCat = useAhCatalog();
  if (!st) return null;
  const { meta, rect } = st;
  const W = 256;
  let left = rect.left - 4;
  if (left + W > window.innerWidth) left = window.innerWidth - W - 6;
  if (left < 6) left = 6;
  const below = rect.bottom + 240 < window.innerHeight;
  const top = below ? rect.bottom + 6 : Math.max(6, rect.top - 6);
  const maxH = Math.max(200, below ? window.innerHeight - top - 8 : rect.top - 12);
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
