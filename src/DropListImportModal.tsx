import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Modal } from './overlay';
import { useDrop, setDrop } from './drop';
import { parseSellList } from './sellListShare';

// Import a shared drop list (same tolerant name-list format as the sell list). Only items not already on
// your drop list are offered, each selectable, and nothing is applied until Confirm -- a merge, not a replace.
export default function DropListImportModal({ onClose }: { onClose: () => void }) {
  const cfg = useDrop();
  const [parsed, setParsed] = useState<string[] | null>(null);
  const [source, setSource] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const have = useMemo(() => new Set(cfg.drop.map((x) => x.toLowerCase())), [cfg.drop]);
  const fresh = useMemo(() => (parsed ?? []).filter((n) => !have.has(n.toLowerCase())), [parsed, have]);
  const dupes = (parsed?.length ?? 0) - fresh.length;

  const loadFrom = async (path: string) => {
    setBusy(true); setErr('');
    try {
      const txt = await invoke<string>('read_text_file', { path });
      const items = parseSellList(txt);
      if (!items.length) { setErr('That file has no item names.'); setParsed(null); }
      else { setParsed(items); setSource(path); setChecked(new Set(items.filter((n) => !have.has(n.toLowerCase())))); }
    } catch { setErr('Could not read that file.'); setParsed(null); }
    setBusy(false);
  };
  const pickFile = async () => {
    const picked = await openDialog({ multiple: false, title: 'Select a shared drop list', filters: [{ name: 'Drop List', extensions: ['json', 'txt'] }] });
    if (typeof picked === 'string') void loadFrom(picked);
  };

  const toggle = (n: string) => setChecked((c) => { const next = new Set(c); next.has(n) ? next.delete(n) : next.add(n); return next; });
  const total = checked.size;
  const confirm = () => {
    const add = fresh.filter((n) => checked.has(n));
    if (add.length) setDrop({ ...cfg, drop: [...cfg.drop, ...add] });
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,480px)] max-h-[90vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Import Drop List</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Add items from a shared drop list to your own. Pick which to include; nothing is added until you confirm.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Source</span>
              <span className="flex-1 min-w-0 truncate text-[11px] text-fg-4" title={source}>{busy ? 'Reading…' : source || 'No file loaded'}</span>
              <button onClick={pickFile} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Choose File</button>
            </div>

            {err && <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-300">{err}</div>}

            {parsed && (
              <div className="rounded-lg border border-line bg-surface overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-field/40">
                  <span className="text-[12px] font-bold text-fg">Items</span>
                  <span className="text-[11px] text-fg-4 tabular-nums">{checked.size}/{fresh.length} new{dupes > 0 ? ` · ${dupes} already listed` : ''}</span>
                  {fresh.length > 0 && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => setChecked(new Set(fresh))} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">All</button>
                      <button onClick={() => setChecked(new Set())} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">None</button>
                    </div>
                  )}
                </div>
                {fresh.length === 0 ? (
                  <div className="px-3 py-2.5 text-[11px] text-fg-4">Nothing new to add. Every item is already on your drop list.</div>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-line">
                    {fresh.map((n) => (
                      <label key={n} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-field/40 transition-colors">
                        <input type="checkbox" checked={checked.has(n)} onChange={() => toggle(n)} className="accent-[var(--color-accent)] shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{n}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-line flex items-center gap-2">
            <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={confirm} disabled={total === 0} className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
              {total === 0 ? 'Nothing To Add' : `Add ${total} Item${total === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
