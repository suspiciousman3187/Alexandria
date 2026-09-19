import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './overlay';
import { useSticky } from './sticky';
import { useKnownCharacters, useAvailableIcons, useAcMap } from './bridge';
import { useItemNames, itemNameMatches, nameMatches } from './itemNames';
import { IconInner } from './atlasIcon';
import { AH_CATEGORY_TREE, AH_CATEGORY_TOP } from './ahCategories';
import { Segmented, Select, Button } from './ui';
import { setTip, clearTip, suppressTip, HoverTip } from './hoverTip';
import { logicalRect, logicalViewport } from './uiZoom';
import { useItemTags, createTag, renameTag, recolorTag, deleteTag, reorderTags, bulkSetTag, countForTag, TAG_COLORS, type TagDef } from './itemTags';
import { exportTags } from './tagShare';
import TagImportModal from './TagImportModal';
import { TEMPORARY_BAG } from './bagConstants';

type Row = { id: number; n: string };
type Box = { x0: number; y0: number; x1: number; y1: number };

const inputCls = 'bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors';
const caret = <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>;

function TagDropdown({ label, primary, fill, tags, empty, disabled, onPick }: { label: string; primary?: boolean; fill?: boolean; tags: TagDef[]; empty: string; disabled?: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const raw = btnRef.current?.getBoundingClientRect();
    // Position in the menu's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws it off-screen;
    // see uiZoom.ts. No-op at 100%.
    if (raw) { const r = logicalRect(raw); setPos({ left: Math.max(6, Math.min(r.left, logicalViewport().w - 186)), top: r.bottom + 4 }); }
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <>
      <Button ref={btnRef} variant={primary ? 'primary' : 'secondary'} size="sm" disabled={disabled} onClick={() => setOpen((o) => !o)} className={fill ? 'flex-1 whitespace-nowrap' : 'shrink-0'}>{label}{caret}</Button>
      {open && pos && createPortal(
        <div ref={menuRef} className="fixed z-[9990] w-[180px] rounded-md border border-line bg-popover shadow-2xl p-1 max-h-72 overflow-y-auto" style={{ left: pos.left, top: pos.top }}>
          {tags.length === 0 ? <div className="px-2 py-2 text-[11px] text-fg-4">{empty}</div> : tags.map((t) => (
            <button key={t.id} onClick={() => { onPick(t.id); setOpen(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12px] text-fg-2 hover:bg-field transition-colors">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}

function TagRow({ tag, total, active, editing, dragging, dropBefore, dropAfter, dropTarget, onPointerDown, onEdit, onRename, onColor, onDelete }: {
  tag: TagDef; total: number; active: boolean; editing: boolean; dragging: boolean; dropBefore: boolean; dropAfter: boolean; dropTarget?: boolean;
  onPointerDown: (e: React.PointerEvent) => void; onEdit: () => void; onRename: (n: string) => void; onColor: (c: string) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(tag.name);
  return (
    <div data-tagrow={tag.id} className={`relative group rounded-lg transition-colors ${dragging ? 'opacity-40' : ''} ${dropTarget ? 'ring-2 ring-accent ring-inset' : ''} ${active ? '' : 'hover:bg-field/50'}`} style={active || dropTarget ? { backgroundColor: `${tag.color}${dropTarget ? '33' : '1f'}` } : undefined}>
      {dropBefore && <div className="absolute left-1 right-1 -top-px h-0.5 rounded-full bg-accent z-[1]" />}
      {dropAfter && <div className="absolute left-1 right-1 -bottom-px h-0.5 rounded-full bg-accent z-[1]" />}
      <div onPointerDown={onPointerDown} className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 cursor-grab active:cursor-grabbing select-none" title="Show items with this tag">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: active ? tag.color : undefined }}>{tag.name}</span>
        <div className="shrink-0 grid w-5 h-5 place-items-center">
          <span className="col-start-1 row-start-1 text-[10px] text-fg-4 tabular-nums pointer-events-none transition-opacity group-hover:opacity-0">{total}</span>
          <button onClick={onEdit} title="Edit tag" className="col-start-1 row-start-1 grid place-items-center w-5 h-5 rounded text-[11px] text-fg-4 opacity-0 pointer-events-none transition-all group-hover:opacity-100 group-hover:pointer-events-auto hover:text-fg hover:bg-line">{'✎'}</button>
        </div>
      </div>
      {editing && (
        <div className="px-2.5 pb-2 flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onRename(name)} onKeyDown={(e) => { if (e.key === 'Enter') onRename(name); }} className={inputCls} />
          <div className="flex flex-wrap items-center gap-1.5">
            {TAG_COLORS.map((c) => (
              <button key={c} onClick={() => onColor(c)} title="Recolor" className="w-5 h-5 rounded-full transition-transform hover:scale-110" style={{ backgroundColor: c, boxShadow: tag.color === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
          <button onClick={onDelete} className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" /></svg>
            Delete Tag
          </button>
        </div>
      )}
    </div>
  );
}

export default function TagBuilderView() {
  const { tags, assign } = useItemTags();
  const [importOpen, setImportOpen] = useState(false);
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const acMap = useAcMap();
  const db = useItemNames();
  const assets = useMemo(() => known.find((c) => c.assets)?.assets, [known]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const [source, setSource] = useState<'inv' | 'all'>('inv');
  const [q, setQ] = useState('');
  const [catTop, setCatTop] = useState('All');
  const [filter, setFilter] = useState<string | null>(null); // tag id, 'untagged', or null
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [itemDrag, setItemDrag] = useState<{ x: number; y: number; count: number; over: string | null } | null>(null);
  const [tipDismissed, setTipDismissed] = useSticky<boolean>('tagging.selectTip', false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tagListRef = useRef<HTMLDivElement | null>(null);
  const lastIdx = useRef<number | null>(null);

  // Pointer-based tag reorder (this webview blocks HTML5 drag-and-drop, but pointer
  // events work — same lane the grid marquee uses). Press a tag row: a move past
  // threshold drags it to a new PRIORITY slot (topmost ruled tag wins conflicts);
  // a press without moving just filters the grid to that tag.
  const startTagDrag = (e: React.PointerEvent, tagId: string) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('input')) return;
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    let curOver: { id: string; pos: 'before' | 'after' } | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 5 && Math.abs(ev.clientX - sx) < 5) return;
      if (!moved) { moved = true; setDragId(tagId); }
      let found: { id: string; pos: 'before' | 'after' } | null = null;
      tagListRef.current?.querySelectorAll('[data-tagrow]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top - 2 && ev.clientY <= r.bottom + 2) found = { id: el.getAttribute('data-tagrow') as string, pos: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' };
      });
      curOver = found;
      setOver(found);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        if (curOver && curOver.id !== tagId) {
          const ids = tags.map((tg) => tg.id).filter((id) => id !== tagId);
          let to = ids.indexOf(curOver.id);
          if (to < 0) to = ids.length; else if (curOver.pos === 'after') to += 1;
          ids.splice(to, 0, tagId);
          reorderTags(ids);
        }
      } else {
        setFilter((f) => (f === tagId ? null : tagId));
      }
      setDragId(null); setOver(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ownedMeta = useMemo(() => {
    const m = new Map<number, { n: string; f?: number }>();
    // Skip the Temporary bag: its items cannot be moved, so tagging them is meaningless.
    for (const c of known) for (const b of c.inv ?? []) { if (b.id === TEMPORARY_BAG) continue; for (const it of b.items) if (!m.has(it.id)) m.set(it.id, { n: it.n, f: it.f }); }
    return m;
  }, [known]);
  const myItems = useMemo(() => [...ownedMeta.entries()].map(([id, v]) => ({ id, n: v.n })).sort((a, b) => a.n.localeCompare(b.n)), [ownedMeta]);
  const nameById = useMemo(() => { const m = new Map<number, string>(); for (const it of db) if (!m.has(it.id)) m.set(it.id, it.n); for (const [id, v] of ownedMeta) if (!m.has(id)) m.set(id, v.n); return m; }, [db, ownedMeta]);
  const catOptions = useMemo(() => ['All', ...AH_CATEGORY_TREE.map((g) => g.top)], []);
  const untaggedCount = useMemo(() => myItems.reduce((n, it) => n + (assign[it.id]?.length ? 0 : 1), 0), [myItems, assign]);

  const CAP = 2000;
  const shown = useMemo<Row[]>(() => {
    const s = q.trim().toLowerCase();
    let base: Row[];
    if (filter && filter !== 'untagged') {
      base = [];
      for (const k in assign) if (assign[k].includes(filter)) { const id = Number(k); base.push({ id, n: nameById.get(id) ?? `#${id}` }); }
      base.sort((a, b) => a.n.localeCompare(b.n));
      if (s) base = base.filter((it) => nameMatches(it.n, s));
    } else if (source === 'all') {
      if (s.length < 2) return [];
      base = []; const seen = new Set<number>();
      for (const it of db) { if (seen.has(it.id) || !itemNameMatches(it.id, it.n, s)) continue; seen.add(it.id); base.push({ id: it.id, n: it.n }); if (base.length >= CAP) break; }
    } else {
      base = s ? myItems.filter((it) => nameMatches(it.n, s)) : myItems;
    }
    if (catTop !== 'All') base = base.filter((it) => AH_CATEGORY_TOP[acMap.get(it.id) ?? 0] === catTop);
    if (filter === 'untagged') base = base.filter((it) => !(assign[it.id]?.length));
    return base;
  }, [filter, source, q, catTop, myItems, db, acMap, assign, nameById]);

  const capped = shown.length > CAP;
  const view = capped ? shown.slice(0, CAP) : shown;
  const allSelected = view.length > 0 && view.every((r) => sel.has(r.id));
  const selArr = useMemo(() => [...sel], [sel]);
  const tagsOnSel = useMemo(() => (sel.size === 0 ? [] : tags.filter((t) => selArr.some((id) => (assign[id] ?? []).includes(t.id)))), [tags, selArr, assign, sel.size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(view.map((r) => r.id))); }
      else if (e.key === 'Escape') { setSel(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  // A press anywhere in the grid starts a potential drag-select — including on top
  // of a tile. If the pointer moves past a small threshold it becomes a marquee;
  // if it doesn't, it's a click (toggle that tile, or clear on empty space).
  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    clearTip();
    const tileEl = (e.target as HTMLElement).closest('[data-tile]') as HTMLElement | null;
    const startId = tileEl ? Number(tileEl.getAttribute('data-id')) : null;
    const startIdx = tileEl ? Number(tileEl.getAttribute('data-idx')) : null;
    const start = { x: e.clientX, y: e.clientY };
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    // Drag a live selection onto a tag row in the left rail to add that tag. Only when
    // pressing an already-selected tile with no modifier; otherwise fall through to the
    // marquee/click handling below.
    if (startId != null && sel.has(startId) && !additive) {
      const dragIds = [...sel];
      let moved2 = false; let over2: string | null = null;
      const dmove = (ev: PointerEvent) => {
        if (!moved2 && Math.abs(ev.clientX - start.x) < 4 && Math.abs(ev.clientY - start.y) < 4) return;
        if (!moved2) { moved2 = true; suppressTip(true); }
        let found: string | null = null;
        tagListRef.current?.querySelectorAll('[data-tagrow]').forEach((el) => {
          const rc = el.getBoundingClientRect();
          if (ev.clientX >= rc.left && ev.clientX <= rc.right && ev.clientY >= rc.top && ev.clientY <= rc.bottom) found = el.getAttribute('data-tagrow');
        });
        over2 = found;
        setItemDrag({ x: ev.clientX, y: ev.clientY, count: dragIds.length, over: found });
      };
      const dup = () => {
        window.removeEventListener('pointermove', dmove);
        window.removeEventListener('pointerup', dup);
        suppressTip(false); setItemDrag(null);
        if (moved2) { if (over2) bulkSetTag(dragIds, over2, true); }
        else { setSel((prev) => { const n = new Set(prev); n.delete(startId); return n; }); if (startIdx !== null) lastIdx.current = startIdx; }
      };
      window.addEventListener('pointermove', dmove);
      window.addEventListener('pointerup', dup);
      return;
    }
    const marqueeBase = additive ? new Set(sel) : new Set<number>();
    let moved = false; let raf = 0;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start.x) < 4 && Math.abs(ev.clientY - start.y) < 4) return;
      if (!moved) { moved = true; suppressTip(true); }
      const l = Math.min(start.x, ev.clientX), tp = Math.min(start.y, ev.clientY), r = Math.max(start.x, ev.clientX), b = Math.max(start.y, ev.clientY);
      setBox({ x0: l, y0: tp, x1: r, y1: b });
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const hits = new Set(marqueeBase);
        gridRef.current?.querySelectorAll('[data-tile]').forEach((el) => {
          const q2 = el.getBoundingClientRect();
          if (q2.right >= l && q2.left <= r && q2.bottom >= tp && q2.top <= b) { const idv = el.getAttribute('data-id'); if (idv) hits.add(Number(idv)); }
        });
        setSel(hits);
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      setBox(null); suppressTip(false);
      if (moved) return;
      if (startId != null) {
        if (ev.shiftKey && lastIdx.current !== null && startIdx !== null) {
          const lo = Math.min(lastIdx.current, startIdx), hi = Math.max(lastIdx.current, startIdx);
          setSel((prev) => { const n = new Set(prev); for (let i = lo; i <= hi; i++) if (view[i]) n.add(view[i].id); return n; });
        } else {
          setSel((prev) => { const n = new Set(prev); n.has(startId) ? n.delete(startId) : n.add(startId); return n; });
          if (startIdx !== null) lastIdx.current = startIdx;
        }
      } else if (!additive) {
        setSel(new Set());
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {importOpen && <TagImportModal onClose={() => setImportOpen(false)} />}
      <div className="flex-1 min-h-0 min-w-0 flex">
        {/* Left: navigate / filter */}
        <aside className="w-44 @min-[760px]:w-56 shrink-0 flex flex-col border-r border-line">
          <form onSubmit={(e) => { e.preventDefault(); const id = createTag(newName); if (id) { setNewName(''); setFilter(id); } }} className="flex gap-1.5 p-2.5 border-b border-line">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New tag…" className={`flex-1 min-w-0 ${inputCls}`} />
            <Button type="submit" variant="primary" size="sm" disabled={!newName.trim()} className="shrink-0" aria-label="Add tag">+</Button>
          </form>
          <div className="flex gap-1.5 px-2.5 py-2 border-b border-line">
            <Button variant="secondary" size="sm" className="flex-1 whitespace-nowrap" onClick={() => void exportTags({ tags, assign })} disabled={tags.length === 0} title="Save your tags to a file to share">Export</Button>
            <Button variant="secondary" size="sm" className="flex-1 whitespace-nowrap" onClick={() => setImportOpen(true)} title="Merge a shared tag file into yours">Import</Button>
          </div>
          <div ref={tagListRef} className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-0.5">
            <button onClick={() => setFilter((f) => (f === 'untagged' ? null : 'untagged'))} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${filter === 'untagged' ? 'bg-accent/15 text-accent' : 'text-fg-3 hover:bg-field/50'}`}>
              <span className="w-2.5 h-2.5 rounded-full border border-fg-4/50 shrink-0" />
              <span className="flex-1 text-left">Untagged</span>
              <span className="text-[10px] text-fg-4 tabular-nums">{untaggedCount}</span>
            </button>
            <div className="my-1.5 border-t border-line" />
            {tags.map((t) => (
              <TagRow
                key={t.id} tag={t} total={countForTag(t.id)} active={filter === t.id} editing={editing === t.id}
                dragging={dragId === t.id}
                dropBefore={over?.id === t.id && over.pos === 'before' && dragId !== null && dragId !== t.id}
                dropAfter={over?.id === t.id && over.pos === 'after' && dragId !== null && dragId !== t.id}
                dropTarget={itemDrag?.over === t.id}
                onPointerDown={(e) => startTagDrag(e, t.id)}
                onEdit={() => setEditing(editing === t.id ? null : t.id)}
                onRename={(n) => renameTag(t.id, n)}
                onColor={(c) => recolorTag(t.id, c)}
                onDelete={() => setConfirmDel(t.id)}
              />
            ))}
            {tags.length === 0 && <div className="text-[11px] text-fg-4 px-2 py-3 leading-relaxed">No tags yet. Add one above, select items, then use Add Tag.</div>}
          </div>
        </aside>

        {/* Right: browse + select */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="border-b border-line flex flex-col gap-2 px-2.5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex-1"><Segmented full value={source} onChange={(v) => { setSource(v as 'inv' | 'all'); setFilter(null); }} options={[{ v: 'inv', label: 'Owned' }, { v: 'all', label: 'All Items' }]} /></div>
              <div className="flex-1"><Select value={catTop} onChange={setCatTop} options={catOptions} full /></div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" className="flex-1 whitespace-nowrap" onClick={() => setSel(new Set(view.map((r) => r.id)))} disabled={view.length === 0 || allSelected}>Select All</Button>
              <TagDropdown label="Tag" primary fill tags={tags} empty="No tags yet." disabled={sel.size === 0} onPick={(id) => bulkSetTag(selArr, id, true)} />
              <TagDropdown label="Untag" fill tags={tagsOnSel} empty="Selection has no tags." disabled={sel.size === 0} onPick={(id) => bulkSetTag(selArr, id, false)} />
              <Button variant="secondary" size="sm" className="flex-1 whitespace-nowrap" onClick={() => setSel(new Set())} disabled={sel.size === 0}>Clear</Button>
            </div>
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={source === 'all' && !filter ? 'Search all items…' : 'Search…'} className={`w-full pr-8 ${inputCls}`} />
              {q && (
                <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          </div>

          {!tipDismissed && (
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-line text-[11px] text-fg-4">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
              <span><span className="font-semibold text-fg-3">Click &amp; Drag</span> to Select Multiple Items.</span>
              <button onClick={() => setTipDismissed(true)} aria-label="Dismiss tip" className="ml-auto shrink-0 w-5 h-5 grid place-items-center rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          <div ref={gridRef} onPointerDown={onGridDown} className="flex-1 min-h-0 overflow-y-auto p-2.5 content-start flex flex-wrap gap-1">
            {view.map((r, idx) => {
              const ids = assign[r.id] ?? [];
              const selected = sel.has(r.id);
              return (
                <div key={r.id} data-tile data-id={r.id} data-idx={idx}
                  onMouseEnter={(e) => setTip({ id: r.id, n: r.n, c: 1, f: ownedMeta.get(r.id)?.f }, e.currentTarget.getBoundingClientRect())}
                  onMouseLeave={clearTip}
                  className={`relative w-9 h-9 rounded bg-field grid place-items-center overflow-hidden select-none transition-shadow ${selected ? 'ring-2 ring-accent z-[1] cursor-grab' : 'cursor-pointer hover:ring-1 hover:ring-line-2'}`}>
                  <IconInner id={r.id} size={34} name={r.n} assets={assets} bmpHas={iconSet.has(r.id)} />
                  {ids.length > 0 && (
                    <div className="absolute bottom-0 right-0 flex gap-px p-[1px] bg-black/40 rounded-tl pointer-events-none">
                      {ids.slice(0, 4).map((tid) => { const t = tagById.get(tid); return t ? <span key={tid} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} /> : null; })}
                    </div>
                  )}
                </div>
              );
            })}
            {view.length === 0 && (
              <div className="w-full text-center text-[12px] text-fg-4 py-12">
                {filter && filter !== 'untagged' ? 'Nothing carries this tag yet. Select items and use Add Tag.'
                  : source === 'all' && !filter ? 'Type at least 2 letters to search every item.'
                    : known.length === 0 ? 'Connect a character in-game to see your items.' : 'No items match.'}
              </div>
            )}
          </div>

        </section>
      </div>

      {itemDrag && createPortal(
        <div className="fixed z-[100] pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded-md bg-accent text-on-accent text-[11px] font-bold shadow-lg whitespace-nowrap" style={{ left: itemDrag.x, top: itemDrag.y - 12 }}>
          {itemDrag.count} item{itemDrag.count === 1 ? '' : 's'}{itemDrag.over ? ` → ${tagById.get(itemDrag.over)?.name ?? ''}` : ''}
        </div>,
        document.body,
      )}

      {confirmDel && (() => {
        const t = tagById.get(confirmDel);
        const n = countForTag(confirmDel);
        return (
          <Modal onClose={() => setConfirmDel(null)} panelClass="w-[min(92vw,340px)]">{(close) => (
            <div className="p-4">
              <div className="text-[14px] font-bold text-fg mb-1.5">Delete tag?</div>
              <div className="text-[12px] text-fg-3 leading-relaxed mb-4">
                <span className="inline-flex items-center gap-1 font-semibold" style={{ color: t?.color }}><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t?.color }} />{t?.name}</span> will be removed from {n.toLocaleString()} item{n === 1 ? '' : 's'}. This can’t be undone.
              </div>
              <div className="flex gap-2">
                <button onClick={close} className="flex-1 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg hover:bg-field transition-colors">Cancel</button>
                <button onClick={() => { deleteTag(confirmDel); if (filter === confirmDel) setFilter(null); setEditing(null); setConfirmDel(null); close(); }} className="flex-1 py-2 text-[12px] font-bold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors">Delete Tag</button>
              </div>
            </div>
          )}</Modal>
        );
      })()}

      {box && <div className="fixed z-50 pointer-events-none border border-accent/70 bg-accent/10 rounded-sm" style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }} />}
      <HoverTip assets={assets} iconSet={iconSet} />
    </div>
  );
}
