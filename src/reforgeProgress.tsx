import { useSyncExternalStore, useMemo } from 'react';
import { useKnownCharacters, useAvailableIcons, type ReforgeState } from './bridge';
import { useReforgeDB, reforgeNameMap, heatColor } from './reforge';
import { useStickyPersisted } from './sticky';
import { IconInner } from './atlasIcon';

// A single shared 1s ticker so every live countdown re-renders together and no interval runs when
// nothing is on screen (subscribe count gates it).
let nowSec = Math.floor(Date.now() / 1000);
const nowSubs = new Set<() => void>();
let nowIv: ReturnType<typeof setInterval> | null = null;
export function useNow(): number {
  return useSyncExternalStore((cb) => {
    nowSubs.add(cb);
    if (!nowIv) nowIv = setInterval(() => { nowSec = Math.floor(Date.now() / 1000); nowSubs.forEach((f) => f()); }, 1000);
    return () => { nowSubs.delete(cb); if (nowSubs.size === 0 && nowIv) { clearInterval(nowIv); nowIv = null; } };
  }, () => nowSec, () => nowSec);
}

// Phase -> user-facing label + semantic color (kept aligned with the app's blue/amber/green hues).
const PHASE: Record<string, { label: string; color: string }> = {
  prep: { label: 'Gathering', color: '#8a999e' },
  trade: { label: 'Trading', color: '#5b9be0' },
  await_trade: { label: 'Trading', color: '#5b9be0' },
  wait: { label: 'Waiting', color: '#f2c94e' },
  collect: { label: 'Collecting', color: '#4fd1a5' },
  await_collect: { label: 'Collecting', color: '#4fd1a5' },
  collected: { label: 'Collecting', color: '#4fd1a5' },
  confirm: { label: 'Confirm', color: '#4fd1a5' },
  done: { label: 'Done', color: '#4fd1a5' },
  error: { label: 'Error', color: '#f0766f' },
  stopped: { label: 'Stopped', color: '#8a999e' },
};
export function phaseOf(rf: ReforgeState): { label: string; color: string } {
  return PHASE[rf.phase ?? ''] ?? { label: rf.status || '…', color: '#8a999e' };
}
export function fmtCd(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export type ActiveReforge = { name: string; conn?: number; assets?: string; rf: ReforgeState; piece: string; paused?: boolean };

// Every character with a reforge in progress (running OR paused), soonest-to-finish first; paused ones
// sort to the end. Both show in the ambient tracker so a paused queue is never silently forgotten.
export function useActiveReforges(): ActiveReforge[] {
  const known = useKnownCharacters();
  const db = useReforgeDB();
  const names = useMemo(() => reforgeNameMap(db), [db]);
  useNow(); // re-sort as clocks tick
  return useMemo(() => {
    const out: ActiveReforge[] = [];
    for (const k of known) {
      const rf = k.reforge;
      if (rf?.active) out.push({ name: k.name, conn: k.conn ?? undefined, assets: k.assets, rf, piece: names.get(rf.output ?? 0) ?? '…' });
      else if (rf?.paused) out.push({ name: k.name, conn: k.conn ?? undefined, assets: k.assets, rf, piece: '', paused: true });
    }
    const key = (a: ActiveReforge) => (a.paused ? Number.MAX_SAFE_INTEGER : a.rf.phase === 'wait' ? (a.rf.readyAt ?? Number.MAX_SAFE_INTEGER - 1) : nowSec);
    out.sort((a, b) => key(a) - key(b));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, names, nowSec]);
}

// Count of characters with a reforge in progress (running or paused), without the per-second ticker --
// for the nav badge, which only needs the count, not the countdowns.
export function useActiveReforgeCount(): number {
  const known = useKnownCharacters();
  return useMemo(() => known.reduce((n, k) => n + (k.reforge?.active || k.reforge?.paused ? 1 : 0), 0), [known]);
}

function secsLeft(rf: ReforgeState, now: number): number | null {
  return rf.phase === 'wait' && rf.readyAt ? Math.max(0, rf.readyAt - now) : null;
}

// Compact one-line card: character, current piece, progress dots, and a live countdown / phase.
export function ReforgeMiniCard({ r, iconSet, accent, onOpen }: { r: ActiveReforge; iconSet: Set<number>; accent: string; onOpen?: () => void }) {
  const now = useNow();
  const rf = r.rf;
  if (r.paused) {
    return (
      <button onClick={onOpen} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field/60 transition-colors">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
        <span className="text-[12.5px] font-bold truncate w-[110px] shrink-0">{r.name}</span>
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        <div className="min-w-0 flex-1 text-[11px] text-fg-4 truncate">{rf.paused?.steps} step{rf.paused?.steps === 1 ? '' : 's'} · {rf.paused?.npc}</div>
        <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded bg-amber-500/15 text-amber-300">Paused</span>
      </button>
    );
  }
  const left = secsLeft(rf, now);
  const ph = phaseOf(rf);
  const total = rf.steps ?? 1, cur = rf.step ?? 1;
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-field/60 transition-colors relative overflow-hidden">
      <span className="absolute left-0 bottom-0 h-[2px]" style={{ width: `${Math.round((Math.max(0, cur - 1) / total) * 100)}%`, background: accent, opacity: 0.9 }} />
      <div className="w-[110px] shrink-0 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: rf.awaitStep ? '#f2c94e' : '#4fd1a5' }} />
        <span className="text-[12.5px] font-bold truncate">{r.name}</span>
      </div>
      <div className="relative shrink-0 w-7 h-7 rounded-md bg-field grid place-items-center overflow-hidden" style={{ boxShadow: `inset 0 0 0 1.3px ${accent}` }}>
        <IconInner id={rf.output ?? 0} size={22} name={r.piece} assets={r.assets} bmpHas={rf.output != null && rf.output > 0 && iconSet.has(rf.output)} />
      </div>
      {/* Piece name dropped: it truncated to a single illegible letter here. The icon (with its hover
          tooltip) plus the character name already identify the row; the dots carry step progress. */}
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i < cur - 1 ? accent : i === cur - 1 ? accent : 'var(--color-line-2)', boxShadow: i === cur - 1 ? `0 0 0 2px color-mix(in srgb, ${accent} 25%, transparent)` : undefined }} />
        ))}
      </div>
      {left != null
        ? <span className="shrink-0 tabular-nums text-[14px] font-bold" style={{ color: heatColor(left) }}>{fmtCd(left)}</span>
        : <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded" style={{ color: ph.color, background: `color-mix(in srgb, ${ph.color} 14%, transparent)` }}>{rf.awaitStep ? 'Confirm' : ph.label}</span>}
    </button>
  );
}

// Hammer -- matches the Reforge icon on the nav rail so the tracker reads as the same feature.
const trackerGlyph = (<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" /></svg>);

// Concept 3: an ambient tracker that floats over any view while reforges run, collapsible to a pill.
// Hidden while the Reforge tab is open (the pinned strip covers it there).
export function GlobalReforgeTracker({ hidden, onOpen }: { hidden?: boolean; onOpen?: (name: string) => void }) {
  const active = useActiveReforges();
  const iconSet = useAvailableIcons();
  const [collapsed, setCollapsed] = useStickyPersisted('reforge.tracker.collapsed', false);
  const now = useNow();
  if (hidden || active.length === 0) return null;
  const soonest = active.map((a) => (a.paused ? null : secsLeft(a.rf, now))).filter((s): s is number => s != null).sort((x, y) => x - y)[0];
  const anyReady = active.some((a) => !a.paused && ((secsLeft(a.rf, now) ?? 1) <= 0 || a.rf.awaitStep));
  const anyPaused = active.some((a) => a.paused);

  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} title="Show reforge tracker"
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2.5 rounded-full border border-line-2 bg-surface-raised/95 backdrop-blur px-3.5 py-2 shadow-[0_16px_34px_-14px_rgba(0,0,0,.7)] hover:border-accent/50 transition-colors">
        <span className={anyPaused && soonest == null ? 'text-amber-300' : 'text-accent'}>{trackerGlyph}</span>
        <span className="text-[12px] font-bold tabular-nums">{active.length}</span>
        {soonest != null
          ? <><span className="w-px h-3.5 bg-line-2" /><span className="tabular-nums text-[13px] font-bold" style={{ color: anyReady ? '#4fd1a5' : heatColor(soonest) }}>{anyReady ? 'ready' : fmtCd(soonest)}</span></>
          : anyPaused
          ? <><span className="w-px h-3.5 bg-line-2" /><span className="text-[11px] font-extrabold uppercase tracking-wide text-amber-300">paused</span></>
          : null}
      </button>
    );
  }
  return (
    <div className="fixed right-4 bottom-4 z-40 w-[256px] rounded-xl border border-line-2 bg-surface-raised/95 backdrop-blur shadow-[0_20px_40px_-14px_rgba(0,0,0,.7)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <span className="text-accent">{trackerGlyph}</span>
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-fg-2">Reforging</span>
        <span className="tabular-nums text-[10px] font-extrabold text-on-accent bg-accent rounded-full px-1.5">{active.length}</span>
        <button onClick={() => setCollapsed(true)} aria-label="Collapse" className="ml-auto text-fg-4 hover:text-fg-2 transition-colors">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div className="max-h-[40vh] overflow-y-auto divide-y divide-line/50">
        {active.map((r) => <ReforgeMiniCard key={r.name} r={r} iconSet={iconSet} accent="var(--color-accent)" onOpen={() => onOpen?.(r.name)} />)}
      </div>
    </div>
  );
}
