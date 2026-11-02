import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useSettings, setSettings, KEEP_STORE_BAGS_DEFAULT } from './settings';
import { Group, RowStacked, Chip } from './ui';
import { STORABLE_BAGS } from './storagePrefs';

const bagName = (id: number) => STORABLE_BAGS.find((b) => b.id === id)?.name ?? `Bag ${id}`;

// Pointer-based drag reorder, the same lane the tag-priority list uses (this webview blocks HTML5 drag). Press
// a row and drag it to a new slot. First in the list is tried first; a bag that fills spills into the next.
export function KeepBagsSettings() {
  const settings = useSettings();
  const order = settings.keepStoreBags ?? KEEP_STORE_BAGS_DEFAULT;
  const set = (bags: number[]) => setSettings({ ...settings, keepStoreBags: bags });
  const available = STORABLE_BAGS.filter((b) => !order.includes(b.id));
  const isDefault = order.length === KEEP_STORE_BAGS_DEFAULT.length && order.every((x, i) => x === KEEP_STORE_BAGS_DEFAULT[i]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; pos: 'before' | 'after' } | null>(null);

  const startDrag = (e: RPointerEvent, id: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    let curOver: { id: number; pos: 'before' | 'after' } | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 5 && Math.abs(ev.clientX - sx) < 5) return;
      if (!moved) { moved = true; setDragId(id); }
      let found: { id: number; pos: 'before' | 'after' } | null = null;
      listRef.current?.querySelectorAll('[data-bagrow]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top - 2 && ev.clientY <= r.bottom + 2) found = { id: Number(el.getAttribute('data-bagrow')), pos: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' };
      });
      curOver = found; setOver(found);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved && curOver && curOver.id !== id) {
        const ids = order.filter((x) => x !== id);
        let to = ids.indexOf(curOver.id);
        if (to < 0) to = ids.length; else if (curOver.pos === 'after') to += 1;
        ids.splice(to, 0, id);
        set(ids);
      }
      setDragId(null); setOver(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <Group title="Keep Overflow Bags" right={!isDefault ? <button onClick={() => set([...KEEP_STORE_BAGS_DEFAULT])} className="le-tap px-2.5 py-1 text-[11px] rounded-md border border-line text-fg-4 hover:text-fg-2 transition-colors">Reset To Default</button> : undefined}>
      <RowStacked label="Store Leftovers Into" desc="Define the priority to store overflow items into when using //keep.">
        <div className="flex flex-col gap-1.5">
          {order.length === 0 ? (
            <div className="text-[11px] text-fg-4">No bags selected. Add one below, or keep will have nowhere to put overflow.</div>
          ) : (
            <div ref={listRef} className="flex flex-col gap-1.5">
              {order.map((id, i) => (
                <div
                  key={id}
                  data-bagrow={id}
                  onPointerDown={(e) => startDrag(e, id)}
                  className={`relative flex items-center gap-2 rounded-md border border-line bg-field px-2.5 py-1.5 cursor-grab active:cursor-grabbing select-none touch-none transition-colors ${dragId === id ? 'opacity-40' : ''}`}
                >
                  {over?.id === id && dragId != null && <span className={`absolute left-1 right-1 h-0.5 rounded-full bg-accent ${over.pos === 'before' ? '-top-1' : '-bottom-1'}`} />}
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-fg-4" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
                  <span className="w-4 text-[10px] font-bold tabular-nums text-fg-4">{i + 1}</span>
                  <span className="flex-1 text-[12px] text-fg-2">{bagName(id)}</span>
                  <button onClick={() => set(order.filter((x) => x !== id))} aria-label="Remove" className="le-tap grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-red-400 transition-colors">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {available.map((b) => <Chip key={b.id} on={false} onChange={() => set([...order, b.id])}>+ {b.name}</Chip>)}
            </div>
          )}
        </div>
      </RowStacked>
    </Group>
  );
}
