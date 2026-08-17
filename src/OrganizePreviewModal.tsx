import { useEffect, useState } from 'react';
import { runOrganizePreview, type KnownChar, type OrganizeRules } from './bridge';
import { Modal } from './overlay';
import { IconInner } from './atlasIcon';
import type { LayoutEntry } from './storagePrefs';

// Shared Organize dry-run preview. On open it asks each target character's addon
// for the exact plan it would run (without moving anything), then shows it grouped
// by character. Used by both the Library and the Tools Organize view.
export function OrganizePreviewModal({ targets, rules, layoutForChar, iconSet, grouped, title, onRun, onClose }: {
  targets: KnownChar[];
  rules: OrganizeRules;
  layoutForChar: (ch: KnownChar) => LayoutEntry[];
  iconSet: Set<number>;
  grouped: boolean;
  title: string;
  onRun: () => void;
  onClose: () => void;
}) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    for (const ch of targets) if (ch.conn != null) runOrganizePreview(ch.conn, rules, layoutForChar(ch));
    const t = window.setTimeout(() => setWaited(true), 9000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byChar = targets.map((ch) => ({ char: ch.name, steps: ch.orgPreview, assets: ch.assets }));
  const ready = byChar.filter((p) => p.steps !== undefined);
  const pending = byChar.some((p) => p.steps === undefined);
  const loading = !waited && pending;
  const noResponse = waited && byChar.length > 0 && ready.length === 0;
  const missing = waited && ready.length > 0 && pending;
  const total = ready.reduce((n, p) => n + (p.steps?.length ?? 0), 0);

  return (
    <Modal onClose={onClose} panelClass="w-[min(92vw,440px)] max-h-[80vh]">{(close) => (
      <>
        <div className="px-4 py-3 border-b border-line">
          <div className="text-[13px] font-bold text-fg">{title}</div>
          <div className="text-[11px] text-fg-3 mt-0.5">{loading ? 'Calculating every move Organize will make…' : noResponse ? 'Could not get a preview from the addon.' : total ? `${total} move${total === 1 ? '' : 's'} planned, using the bags reachable right now.` : 'Nothing to organize. Everything is already sorted.'}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading
            ? <div className="flex items-center justify-center gap-2 p-10 text-[12px] text-fg-4"><svg viewBox="0 0 24 24" className="w-4 h-4 text-accent animate-spin" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>Calculating the plan…</div>
            : noResponse
              ? <div className="m-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-[12px] text-amber-200"><div className="font-bold mb-1">The addon did not answer the preview.</div>Reload Alexandria in-game with <span className="font-mono text-amber-100">//lua reload Alexandria</span>, then open Organize again.</div>
              : <>
                  {missing && <div className="m-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"><span className="font-bold">{byChar.filter((p) => p.steps === undefined).length} character(s) didn't answer</span> the preview and aren't shown. Reload Alexandria on those clients: <span className="font-mono text-amber-100">//lua reload Alexandria</span></div>}
                  {total === 0
                    ? <div className="text-[12px] text-fg-4 p-8 text-center">Nothing to move. {missing ? 'The characters that answered are already sorted.' : 'Your inventory is already organized.'}</div>
                    : byChar.filter((p) => p.steps && p.steps.length > 0).map(({ char, steps, assets }) => (
                      <div key={char} className="rounded-lg border border-line bg-surface overflow-hidden mb-2">
                        {grouped && (
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-surface-raised">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-[12px] font-bold text-fg truncate">{char}</span>
                            <span className="ml-auto text-[10px] tabular-nums text-fg-4">{steps!.length} move{steps!.length === 1 ? '' : 's'}</span>
                          </div>
                        )}
                        <div className="divide-y divide-line">
                          {steps!.map((m, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                              <div className="shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={m.id} size={24} name={m.n} assets={assets} bmpHas={m.id > 0 && iconSet.has(m.id)} /></div>
                              <div className="min-w-0 flex-1 text-[11px] text-fg-2 truncate">{m.n}{m.c > 1 ? <span className="text-fg-4"> ×{m.c}</span> : ''}<span className="text-fg-4"> from {m.from.replace('Mog ', '')}</span></div>
                              <span className="shrink-0 text-accent text-[13px]">→</span>
                              <span className="shrink-0 text-[11px] font-medium text-fg-3 max-w-[110px] truncate">{m.to.replace('Mog ', '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </>}
        </div>
        <div className="px-4 py-3 border-t border-line flex gap-2">
          <button onClick={close} className="flex-1 py-1.5 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
          <button onClick={() => { onRun(); close(); }} disabled={loading} className="flex-1 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">Organize Now{!loading && total ? ` (${total})` : ''}</button>
        </div>
      </>
    )}</Modal>
  );
}
