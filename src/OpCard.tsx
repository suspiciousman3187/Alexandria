import { type ReactNode } from 'react';

// Shared progress UI (spinner resolving to check/x + title + sublabel + optional bar), used both as stacked toasts and inline cards so every operation reads the same.
export type OpState = 'active' | 'ok' | 'fail';

const TONE: Record<OpState, string> = {
  active: 'border-line bg-surface-raised',
  ok: 'border-emerald-500/40 bg-emerald-500/15',
  fail: 'border-red-500/40 bg-red-500/15',
};
const BAR: Record<OpState, string> = {
  active: 'bg-accent',
  ok: 'bg-emerald-400',
  fail: 'bg-red-400',
};

export function OpGlyph({ state, className = 'w-4 h-4' }: { state: OpState; className?: string }) {
  if (state === 'ok') return <svg viewBox="0 0 24 24" className={`${className} text-emerald-300`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
  if (state === 'fail') return <svg viewBox="0 0 24 24" className={`${className} text-red-300`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>;
  return <svg viewBox="0 0 24 24" className={`${className} animate-spin text-accent`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>;
}

export function OpCard({ state, title, sublabel, count, pct, trailing, children, className = '' }: {
  state: OpState;
  title: ReactNode;
  sublabel?: ReactNode;
  count?: ReactNode;
  pct?: number;
  trailing?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border ${TONE[state]} ${className}`}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="shrink-0 w-4 h-4 grid place-items-center"><OpGlyph state={state} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-fg-2 truncate">{title}</div>
          {sublabel != null && sublabel !== '' && <div className="text-[10px] text-fg-4 leading-snug truncate">{sublabel}</div>}
        </div>
        {count != null && count !== '' && <span className="shrink-0 text-[11px] tabular-nums text-fg-4">{count}</span>}
        {trailing}
      </div>
      {pct != null && (
        <div className="px-3 pb-2 -mt-0.5">
          <div className="h-1.5 rounded-full bg-field overflow-hidden">
            <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${BAR[state]}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
        </div>
      )}
      {children != null && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}
