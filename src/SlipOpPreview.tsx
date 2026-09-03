import { useEffect, useMemo, useRef, useState } from 'react';
import { IconInner } from './atlasIcon';
import { Modal } from './overlay';
import { useAvailableIcons } from './bridge';
import { useItemCard } from './ItemTooltip';
import { type ReportMove } from './OperationReport';

// Distinct colors per slip so the groups read apart at a glance.
const PALETTE = ['#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#fb7185', '#fb923c', '#a3e635', '#e879f9', '#22d3ee', '#60a5fa'];

type Item = { id: number; n: string; c: number };
type Group = { slip: string; color: string; items: Item[] };

function ItemChip({ it, assets, iconSet, out, onClick }: { it: Item; assets?: string; iconSet: Set<number>; out: boolean; onClick: () => void }) {
  const card = useItemCard();
  const meta = { id: it.id, n: it.n, c: it.c };
  return (
    <button
      onMouseEnter={(e) => card?.hoverOpen(meta, e.currentTarget.getBoundingClientRect(), e.currentTarget)}
      onMouseLeave={() => card?.hoverHide()}
      onClick={onClick}
      className={`relative w-9 h-9 rounded grid place-items-center overflow-hidden border transition-colors ${out ? 'border-line opacity-45' : 'border-accent/60 bg-field hover:border-accent'}`}
    >
      <IconInner id={it.id} size={34} name={it.n} assets={assets} bmpHas={it.id > 0 && iconSet.has(it.id)} />
      {it.c > 1 && <span className="absolute bottom-0 right-0.5 text-[9px] font-bold text-fg-2 tabular-nums drop-shadow">{it.c}</span>}
      {out && (
        <span className="absolute inset-0 bg-surface/55 grid place-items-center">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-rose-300" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </span>
      )}
    </button>
  );
}

// Preview + configure a slip store/retrieve before it fires. Groups by SLIP (the meaningful axis for
// exclusion): for store the slip is the destination, for retrieve it is the source. Tap a piece to drop it,
// or Exclude a whole slip; Confirm fires only what is left in.
export default function SlipOpPreview({ kind, moves, assets, initialExcluded, onExcludedChange, onCancel, onConfirm }: {
  kind: 'store' | 'retrieve';
  moves: ReportMove[];
  assets?: string;
  initialExcluded?: number[];
  onExcludedChange?: (ids: number[]) => void;
  onCancel: () => void;
  onConfirm: (ids: number[]) => void;
}) {
  const iconSet = useAvailableIcons();
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    let i = 0;
    for (const mv of moves) {
      const slip = kind === 'store' ? mv.to : mv.from; // the non-inventory side
      let g = m.get(slip);
      if (!g) { g = { slip, color: PALETTE[i % PALETTE.length], items: [] }; m.set(slip, g); i++; }
      if (!g.items.some((it) => it.id === mv.id)) g.items.push({ id: mv.id, n: mv.n, c: mv.c });
    }
    return [...m.values()];
  }, [moves, kind]);

  const [excluded, setExcluded] = useState<Set<number>>(() => {
    const here = new Set(moves.map((m) => m.id));
    return new Set((initialExcluded ?? []).filter((id) => here.has(id)));
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onExcludedChange?.([...excluded]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excluded]);

  const toggleItem = (id: number) => setExcluded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSlip = (g: Group) => setExcluded((prev) => {
    const n = new Set(prev);
    const anyIn = g.items.some((it) => !n.has(it.id));
    for (const it of g.items) { if (anyIn) n.add(it.id); else n.delete(it.id); } // all-in -> exclude all, else include all
    return n;
  });
  const slipIn = (g: Group) => g.items.filter((it) => !excluded.has(it.id)).length;

  const allIds = useMemo(() => [...new Set(moves.map((m) => m.id))], [moves]);
  const includedIds = allIds.filter((id) => !excluded.has(id));
  const anyIn = includedIds.length > 0;
  const toggleAll = () => setExcluded(() => (anyIn ? new Set(allIds) : new Set()));
  const total = moves.length;
  const verb = kind === 'store' ? 'Store' : 'Retrieve';

  return (
    <Modal onClose={onCancel} panelClass="w-[640px] max-w-[94vw] max-h-[86vh]">{(close) => (
      <>
        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-line">
          <span className="grid place-items-center w-8 h-8 rounded-full bg-accent/15 text-accent">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              {kind === 'store' ? <><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></> : <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>}
            </svg>
          </span>
          <div>
            <div className="text-[14px] font-bold text-fg leading-tight">{verb} Gear</div>
            <div className="text-[11px] text-fg-4">{includedIds.length} of {total} · {groups.length} slip{groups.length === 1 ? '' : 's'}{kind === 'retrieve' ? ' → Inventory' : ''}</div>
          </div>
          <button onClick={close} className="ml-auto grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-field transition-colors" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2.5">
          {groups.map((g) => {
            const inN = slipIn(g);
            const allOut = inN === 0;
            return (
              <div key={g.slip} className={`rounded-lg border border-line bg-surface p-3 transition-opacity ${allOut ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.color }} />
                  <span className="text-[12px] font-bold truncate" style={{ color: g.color }}>{g.slip}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-fg-4">{inN}/{g.items.length}</span>
                  <button onClick={() => toggleSlip(g)} className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-line text-fg-3 hover:text-fg hover:border-line-2 transition-colors">
                    {allOut ? 'Include' : 'Exclude'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((it) => <ItemChip key={it.id} it={it} assets={assets} iconSet={iconSet} out={excluded.has(it.id)} onClick={() => toggleItem(it.id)} />)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-line flex items-center gap-2">
          <button onClick={close} className="px-4 py-1.5 text-[12px] font-bold rounded-md bg-field text-fg-2 hover:text-fg transition-colors">Cancel</button>
          <button onClick={toggleAll} className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg hover:border-line-2 transition-colors">{anyIn ? 'Exclude All' : 'Include All'}</button>
          <button onClick={() => onConfirm(includedIds)} disabled={includedIds.length === 0} className="ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
            {verb}{includedIds.length ? ` ${includedIds.length}` : ''}
          </button>
        </div>
      </>
    )}</Modal>
  );
}
