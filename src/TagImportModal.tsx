import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Modal } from './overlay';
import { useItemTags, mergeTagStore, type TagStore } from './itemTags';
import { parseTagShare } from './tagShare';

// Import shared item tags. The incoming tags are listed with how many items each carries and whether you
// already have a same-named tag; you pick which to import and only those (with their assignments) are
// merged into your tags -- existing item tags are kept, never replaced.
export default function TagImportModal({ onClose }: { onClose: () => void }) {
  const mine = useItemTags();
  const [parsed, setParsed] = useState<TagStore | null>(null);
  const [source, setSource] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const haveNames = useMemo(() => new Set(mine.tags.map((t) => t.name.toLowerCase())), [mine.tags]);
  // items carrying each incoming tag id
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (parsed) for (const k in parsed.assign) for (const tid of parsed.assign[Number(k)]) m.set(tid, (m.get(tid) ?? 0) + 1);
    return m;
  }, [parsed]);

  const loadFrom = async (path: string) => {
    setBusy(true); setErr('');
    try {
      const txt = await invoke<string>('read_text_file', { path });
      const store = parseTagShare(txt);
      if (store.tags.length === 0) { setErr('That file has no item tags.'); setParsed(null); }
      else { setParsed(store); setSource(path); setChecked(new Set(store.tags.map((t) => t.id))); }
    } catch { setErr('Could not read that file.'); setParsed(null); }
    setBusy(false);
  };
  const pickFile = async () => {
    const picked = await openDialog({ multiple: false, title: 'Select a shared item-tags file', filters: [{ name: 'Item Tags', extensions: ['json'] }] });
    if (typeof picked === 'string') void loadFrom(picked);
  };

  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalItems = useMemo(() => {
    if (!parsed) return 0;
    let n = 0;
    for (const k in parsed.assign) if (parsed.assign[Number(k)].some((tid) => checked.has(tid))) n++;
    return n;
  }, [parsed, checked]);

  const confirm = () => {
    if (!parsed) return;
    const tags = parsed.tags.filter((t) => checked.has(t.id));
    const assign: Record<number, string[]> = {};
    for (const k in parsed.assign) {
      const id = Number(k);
      const keep = parsed.assign[id].filter((tid) => checked.has(tid));
      if (keep.length) assign[id] = keep;
    }
    mergeTagStore({ tags, assign });
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,480px)] max-h-[90vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Import Item Tags</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Merge an outside tag set into your own tag list.</p>
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
                  <span className="text-[12px] font-bold text-fg">Tags</span>
                  <span className="text-[11px] text-fg-4 tabular-nums">{checked.size}/{parsed.tags.length} selected · {totalItems} item{totalItems === 1 ? '' : 's'}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => setChecked(new Set(parsed.tags.map((t) => t.id)))} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">All</button>
                    <button onClick={() => setChecked(new Set())} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">None</button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-line">
                  {parsed.tags.map((t) => {
                    const have = haveNames.has(t.name.toLowerCase());
                    return (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-field/40 transition-colors">
                        <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--color-accent)] shrink-0" />
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{t.name}</span>
                        {have && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-fg-4">have</span>}
                        <span className="shrink-0 text-[10px] tabular-nums text-fg-4">{counts.get(t.id) ?? 0}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-line flex items-center gap-2">
            <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={confirm} disabled={checked.size === 0} className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
              {checked.size === 0 ? 'Nothing Selected' : `Merge ${checked.size} Tag${checked.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
