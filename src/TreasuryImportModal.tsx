import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Modal } from './overlay';
import { CharacterSelect } from './ui';
import { useKnownCharacters, getAddonInfo } from './bridge';
import { emptyRules, usePoolStore, setCharRules } from './poolRules';
import { useDrop, setDrop } from './drop';
import { useAnon } from './anonymize';
import { parseTreasury, treasurySettingsPath, type TreasuryLists } from './treasuryImport';

type ListKey = 'drop' | 'pass' | 'lot';
const LABELS: Record<ListKey, string> = { drop: 'Drop List', pass: 'Pass Rules', lot: 'Lot Rules' };

function Section({ title, items, present, checked, onToggle, onAll, onNone }: {
  title: string; items: string[]; present: number; checked: Set<string>;
  onToggle: (n: string) => void; onAll: () => void; onNone: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-field/40">
        <span className="text-[12px] font-bold text-fg">{title}</span>
        <span className="text-[11px] text-fg-4 tabular-nums">{checked.size}/{items.length} new{present > 0 ? ` · ${present} already in list` : ''}</span>
        {items.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={onAll} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">All</button>
            <button onClick={onNone} className="le-tap px-2 py-0.5 text-[10px] font-semibold rounded border border-line bg-field text-fg-3 hover:text-fg transition-colors">None</button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-[11px] text-fg-4">Nothing new to add.</div>
      ) : (
        <div className="max-h-48 overflow-y-auto divide-y divide-line">
          {items.map((n) => (
            <label key={n} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-field/40 transition-colors">
              <input type="checkbox" checked={checked.has(n)} onChange={() => onToggle(n)} className="accent-[var(--color-accent)] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TreasuryImportModal({ onClose, defaultTarget }: { onClose: () => void; defaultTarget?: string }) {
  const known = useKnownCharacters();
  const anon = useAnon();
  const poolStore = usePoolStore();
  const cfg = useDrop();
  const [parsed, setParsed] = useState<TreasuryLists | null>(null);
  const [source, setSource] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const chars = useMemo(() => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)), [known]);
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (target) return;
    if (defaultTarget && chars.some((c) => c.name === defaultTarget)) setTarget(defaultTarget);
    else if (chars[0]) setTarget(chars[0].name);
  }, [chars, target, defaultTarget]);

  const loadFrom = async (path: string) => {
    setBusy(true); setErr('');
    try {
      const txt = await invoke<string>('read_text_file', { path });
      const p = parseTreasury(txt);
      if (!p.drop.length && !p.pass.length && !p.lot.length) { setErr('That file has no Drop, Pass, or Lot lists.'); setParsed(null); }
      else { setParsed(p); setSource(path); }
    } catch { setErr('Could not read that file.'); setParsed(null); }
    setBusy(false);
  };

  useEffect(() => {
    const auto = treasurySettingsPath(getAddonInfo()?.dir ?? null);
    if (auto) void loadFrom(auto);
    else { setBusy(false); setErr('Connect a character so Alexandria can find your Windower folder, or choose the file manually.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFile = async () => {
    const picked = await openDialog({ multiple: false, title: 'Select Treasury settings (.xml or .lua)', filters: [{ name: 'Treasury', extensions: ['xml', 'lua', 'txt'] }] });
    if (typeof picked === 'string') void loadFrom(picked);
  };

  const rules = poolStore[target] ?? emptyRules();
  const notIn = (arr: string[], list: string[]) => { const s = new Set(list.map((x) => x.toLowerCase())); return arr.filter((n) => !s.has(n.toLowerCase())); };
  const dropNew = useMemo(() => (parsed ? notIn(parsed.drop, cfg.drop) : []), [parsed, cfg.drop]);
  const passNew = useMemo(() => (parsed ? notIn(parsed.pass, rules.pass) : []), [parsed, rules.pass]);
  const lotNew = useMemo(() => (parsed ? notIn(parsed.lot, rules.lot) : []), [parsed, rules.lot]);

  const [checked, setChecked] = useState<Record<ListKey, Set<string>>>({ drop: new Set(), pass: new Set(), lot: new Set() });
  useEffect(() => {
    setChecked({ drop: new Set(dropNew), pass: new Set(passNew), lot: new Set(lotNew) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, target]);

  const toggle = (k: ListKey, n: string) => setChecked((c) => { const next = new Set(c[k]); if (next.has(n)) next.delete(n); else next.add(n); return { ...c, [k]: next }; });
  const setAll = (k: ListKey, items: string[], on: boolean) => setChecked((c) => ({ ...c, [k]: on ? new Set(items) : new Set() }));

  const total = checked.drop.size + checked.pass.size + checked.lot.size;
  const canConfirm = total > 0 && !!target;

  const confirm = () => {
    const dsel = dropNew.filter((n) => checked.drop.has(n));
    if (dsel.length) setDrop({ ...cfg, drop: [...cfg.drop, ...dsel] });
    const psel = passNew.filter((n) => checked.pass.has(n));
    const lsel = lotNew.filter((n) => checked.lot.has(n));
    if (target && (psel.length || lsel.length)) {
      const cur = poolStore[target] ?? emptyRules();
      setCharRules(target, { ...cur, pass: [...cur.pass, ...psel], lot: [...cur.lot, ...lsel] });
    }
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,520px)] max-h-[90vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Import From Treasury</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Drop items go to your global Drop List. Pass and Lot rules go to the character you choose. Nothing is applied until you confirm.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Source</span>
              <span className="flex-1 min-w-0 truncate text-[11px] text-fg-4" title={source}>{busy ? 'Reading…' : source || 'No file loaded'}</span>
              <button onClick={pickFile} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Choose File</button>
            </div>

            {err && <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-300">{err}</div>}

            {parsed && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">Pass / Lot To</span>
                  <div className="flex-1 min-w-0"><CharacterSelect value={target} onChange={setTarget} chars={chars} /></div>
                </div>
                <Section title={LABELS.drop} items={dropNew} present={parsed.drop.length - dropNew.length} checked={checked.drop} onToggle={(n) => toggle('drop', n)} onAll={() => setAll('drop', dropNew, true)} onNone={() => setAll('drop', dropNew, false)} />
                <Section title={`${LABELS.pass}${target ? ` (${anon(target)})` : ''}`} items={passNew} present={parsed.pass.length - passNew.length} checked={checked.pass} onToggle={(n) => toggle('pass', n)} onAll={() => setAll('pass', passNew, true)} onNone={() => setAll('pass', passNew, false)} />
                <Section title={`${LABELS.lot}${target ? ` (${anon(target)})` : ''}`} items={lotNew} present={parsed.lot.length - lotNew.length} checked={checked.lot} onToggle={(n) => toggle('lot', n)} onAll={() => setAll('lot', lotNew, true)} onNone={() => setAll('lot', lotNew, false)} />
              </>
            )}
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-line flex items-center gap-2">
            <button onClick={close} className="shrink-0 px-4 py-2 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={confirm} disabled={!canConfirm} className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
              {total === 0 ? 'Nothing To Add' : `Add ${total} Item${total === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
