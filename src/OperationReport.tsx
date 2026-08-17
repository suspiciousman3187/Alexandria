import { useMemo } from 'react';
import { IconInner } from './atlasIcon';
import { Modal } from './overlay';
import { useAvailableIcons } from './bridge';

export type ReportMove = { id: number; n: string; c: number; from: string; to: string; fromId: number; toId: number };
export type ReportBlock = { name: string; assets?: string; moves: ReportMove[]; skipped: ReportMove[] };
export type ReportData = { kind: 'organize' | 'consolidate'; blocks: ReportBlock[] };

// Tailwind -400 hex for each bag id, matching bagColors.ts so the report reads
// with the same bag colors as the rest of Library.
export const BAG_HEX: Record<number, string> = {
  0: '#34d399', 1: '#38bdf8', 9: '#2dd4bf', 2: '#fbbf24', 4: '#a78bfa', 5: '#fb7185',
  6: '#fb923c', 7: '#a3e635', 8: '#818cf8', 10: '#e879f9', 11: '#22d3ee', 12: '#f472b6',
  13: '#60a5fa', 14: '#c084fc', 15: '#facc15', 16: '#4ade80', 17: '#a1a1aa', 3: '#94a3b8',
};
const hex = (id: number) => BAG_HEX[id] ?? '#69776f';

function Grouped({ block, iconSet }: { block: ReportBlock; iconSet: Set<number> }) {
  const byDest = useMemo(() => {
    const m = new Map<string, { toId: number; total: number; items: Map<string, { id: number; n: string; c: number; froms: Map<string, number> }> }>();
    for (const mv of block.moves) {
      let g = m.get(mv.to);
      if (!g) { g = { toId: mv.toId, total: 0, items: new Map() }; m.set(mv.to, g); }
      g.total += mv.c;
      let it = g.items.get(mv.n);
      if (!it) { it = { id: mv.id, n: mv.n, c: 0, froms: new Map() }; g.items.set(mv.n, it); }
      it.c += mv.c; it.froms.set(mv.from, mv.fromId);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [block]);
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {byDest.map(([dest, g]) => (
        <div key={dest} className="rounded-lg border border-line bg-surface overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-surface-raised">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hex(g.toId) }} />
            <span className="text-[12px] font-bold truncate" style={{ color: hex(g.toId) }}>{dest}</span>
            <span className="ml-auto text-[10px] tabular-nums text-fg-4">{g.total}</span>
          </div>
          <div>
            {[...g.items.values()].map((it) => (
              <div key={it.n} className="flex items-center gap-2 px-3 py-1.5 border-t border-line first:border-t-0">
                <div className="shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={24} name={it.n} assets={block.assets} bmpHas={it.id > 0 && iconSet.has(it.id)} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-fg-2 truncate">{it.n}</div>
                  <div className="text-[10px] text-fg-4 truncate">
                    from {[...it.froms.entries()].map(([n, id], i) => (
                      <span key={n}><span className="font-medium" style={{ color: hex(id) }}>{n}</span>{i < it.froms.size - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-emerald-300">+{it.c}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OperationReport({ report, onClose }: { report: ReportData; onClose: () => void }) {
  const iconSet = useAvailableIcons();
  const totMoves = report.blocks.reduce((s, b) => s + b.moves.length, 0);
  const totItems = report.blocks.reduce((s, b) => s + b.moves.reduce((n, m) => n + m.c, 0), 0);
  const totSkip = report.blocks.reduce((s, b) => s + b.skipped.length, 0);
  const multi = report.blocks.length > 1;
  const title = report.kind === 'organize' ? 'Organize Complete' : 'Consolidate Complete';
  return (
    <Modal onClose={onClose} panelClass="w-[720px] max-w-[94vw] max-h-[86vh]">{(close) => (
      <>
        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-line">
          <span className="grid place-items-center w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-300">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div>
            <div className="text-[14px] font-bold text-fg leading-tight">{title}</div>
            <div className="text-[11px] text-fg-4">{totItems.toLocaleString()} items in {totMoves} move{totMoves === 1 ? '' : 's'}{totSkip ? ` · ${totSkip} skipped` : ''}{multi ? ` · ${report.blocks.length} characters` : ''}</div>
          </div>
          <button onClick={close} className="ml-auto grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-field transition-colors" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5">
          {report.blocks.map((block, bi) => (
            <div key={block.name} className="flex flex-col gap-3" style={{ animation: `le-rise .45s cubic-bezier(.22,1,.36,1) ${bi * 0.08}s both` }}>
              {multi && (
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[13px] font-bold text-fg">{block.name}</span>
                  <span className="text-[10px] text-fg-4 tabular-nums">{block.moves.reduce((n, m) => n + m.c, 0)} items · {block.moves.length} moves</span>
                </div>
              )}
              <Grouped block={block} iconSet={iconSet} />
              {block.skipped.length > 0 && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300 mb-1">{block.skipped.length} skipped</div>
                  <div className="flex flex-col gap-0.5">
                    {block.skipped.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-fg-3">
                        <span className="truncate">{m.n}{m.c > 1 ? ` ×${m.c}` : ''}</span>
                        <span className="text-fg-4"><span style={{ color: hex(m.fromId) }}>{m.from}</span> → <span style={{ color: hex(m.toId) }}>{m.to}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-line flex">
          <button onClick={close} className="ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Done</button>
        </div>
      </>
    )}</Modal>
  );
}
