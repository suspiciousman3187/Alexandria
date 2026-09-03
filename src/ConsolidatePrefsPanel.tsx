import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useAnon } from './anonymize';
import { useItemNames, itemNameMatches, type ItemName } from './itemNames';
import { IconInner } from './atlasIcon';
import { Select } from './ui';
import { Popover } from './overlay';
import { useConsolidatePrefs, addConsolidateItem, addConsolidateItems, removeConsolidateItem, removeConsolidateItems } from './consolidatePrefs';
import { useItemTags, itemsWithTag, countForTag } from './itemTags';
import { FLAG_NOTRADE } from './bagConstants';
import ConsolidatePrefsModal from './ConsolidatePrefsModal';

const PICK_TILE_CV: CSSProperties = { contentVisibility: 'auto', containIntrinsicSize: '34px 34px' };

export default function ConsolidatePrefsPanel() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const prefs = useConsolidatePrefs();
  const db = useItemNames();
  const [modalOpen, setModalOpen] = useState(false);

  const tags = useItemTags().tags;
  const chars = useMemo(() => known.map((k) => k.name).sort((a, b) => a.localeCompare(b)), [known]);
  const [char, setChar] = useState('');
  const activeChar = char || chars[0] || '';
  const [q, setQ] = useState('');
  const inputWrap = useRef<HTMLDivElement | null>(null);

  const idByName = useMemo(() => { const m = new Map<string, number>(); for (const it of db) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); } return m; }, [db]);
  const nameById = useMemo(() => { const m = new Map<number, string>(); for (const it of db) if (!m.has(it.id)) m.set(it.id, it.n); return m; }, [db]);

  // Bulk add to a preference list: a tag (items the user already grouped) OR a drag-select over the tiles of a
  // chosen bag -- instead of searching + clicking each of 70-80 items one at a time.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [viewChar, setViewChar] = useState('');
  const [viewBag, setViewBag] = useState('');
  const anyAssets = useMemo(() => known.find((k) => k.assets)?.assets, [known]);
  const invCharNames = useMemo(() => known.filter((k) => (k.inv?.length ?? 0) > 0).map((k) => k.name), [known]);
  const activeViewChar = viewChar || invCharNames[0] || '';
  const viewBags = useMemo(() => (known.find((k) => k.name === activeViewChar)?.inv ?? []).filter((b) => b.items.length > 0), [known, activeViewChar]);
  const activeViewBag = (viewBag && viewBags.some((b) => String(b.id) === viewBag)) ? viewBag : (viewBags[0] ? String(viewBags[0].id) : '');
  // Unique item TYPES in the viewed bag (a bag can hold several copies of an id; the user picks WHICH items to
  // consolidate, so collapse to one tile per id).
  const bagItems = useMemo(() => {
    const bag = viewBags.find((b) => String(b.id) === activeViewBag);
    const m = new Map<number, string>();
    // Skip No-Trade items -- they can't be traded to another player, so they can never be consolidated.
    for (const it of bag?.items ?? []) { if ((it.f ?? 0) & FLAG_NOTRADE) continue; if (!m.has(it.id)) m.set(it.id, it.n); }
    return [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => a.n.localeCompare(b.n));
  }, [viewBags, activeViewBag]);
  // Drag-paint multi-select, same shape as the inventory grid: the first tile sets add-vs-remove, dragging over
  // tiles applies it, pointerup ends. Selection is per-viewed-bag (reset when the bag/char changes) so it stays
  // WYSIWYG.
  const dragRef = useRef<{ add: boolean } | null>(null);
  const applyPick = (id: number, add: boolean) => setPicked((prev) => { const n = new Set(prev); if (add) n.add(id); else n.delete(id); return n; });
  const pickDown = (id: number) => {
    const add = !picked.has(id);
    dragRef.current = { add };
    applyPick(id, add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const pickEnter = (id: number) => { if (dragRef.current) applyPick(id, dragRef.current.add); };
  const bulkAddTag = (tagId: string) => {
    const names = itemsWithTag(tagId).map((id) => nameById.get(id)).filter((n): n is string => !!n);
    if (names.length && activeChar) addConsolidateItems(activeChar, names);
  };
  const addPicked = () => {
    const nm = new Map(bagItems.map((it) => [it.id, it.n]));
    const names = [...picked].map((id) => nm.get(id) ?? nameById.get(id)).filter((n): n is string => !!n);
    if (names.length && activeChar) { addConsolidateItems(activeChar, names); setPicked(new Set()); }
  };
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [] as ItemName[];
    const out: ItemName[] = [];
    const seen = new Set<string>();
    for (const it of db) { const ln = it.n.toLowerCase(); if (seen.has(ln) || !itemNameMatches(it.id, it.n, s)) continue; seen.add(ln); out.push(it); if (out.length >= 8) break; }
    return out;
  }, [db, q]);

  const entries = useMemo(() => Object.entries(prefs).filter(([, v]) => v.length).sort((a, b) => a[0].localeCompare(b[0])), [prefs]);
  const total = entries.reduce((s, [, v]) => s + v.length, 0);
  const assetsFor = (name: string) => known.find((k) => k.name === name)?.assets;
  const iconId = (n: string) => idByName.get(n.toLowerCase()) ?? 0;

  // Drag-select + bulk delete on the preference chips. Key = `${char}|${itemName}`; drag-paint across a
  // character's chips, then Delete drops them all in one write.
  const [delSel, setDelSel] = useState<Set<string>>(new Set());
  const delDragRef = useRef<{ add: boolean } | null>(null);
  const delKey = (char: string, name: string) => `${char}|${name}`;
  const applyDel = (key: string, add: boolean) => setDelSel((prev) => { const n = new Set(prev); if (add) n.add(key); else n.delete(key); return n; });
  const delDown = (key: string) => {
    const add = !delSel.has(key);
    delDragRef.current = { add };
    applyDel(key, add);
    const end = () => { delDragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const delEnter = (key: string) => { if (delDragRef.current) applyDel(key, delDragRef.current.add); };
  const deleteSelected = () => {
    const byChar: Record<string, string[]> = {};
    for (const key of delSel) { const i = key.indexOf('|'); if (i < 0) continue; (byChar[key.slice(0, i)] ??= []).push(key.slice(i + 1)); }
    removeConsolidateItems(byChar);
    setDelSel(new Set());
  };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => setModalOpen(true)} disabled={total === 0} className="le-tap w-full px-3 py-2.5 text-[13px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate By Preference</button>
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-fg">Preference List</span>
          <span className="text-[11px] text-fg-4 tabular-nums">{total} item{total === 1 ? '' : 's'} · {entries.length} character{entries.length === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-fg-4 mt-2">Items defined here will be consolidated to the designated character(s) when using Consolidate By Preference.</div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="w-40 shrink-0"><Select value={activeChar} onChange={setChar} options={chars} renderOption={(n) => anon(n)} renderValue={(n) => anon(n)} full /></div>
          <div ref={inputWrap} className="relative flex-1 min-w-0">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item to add…" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
            <Popover open={matches.length > 0} anchor={inputWrap} className="rounded-md border border-line bg-popover shadow-2xl max-h-56 overflow-y-auto">
              {matches.map((it) => (
                <button key={it.id} onMouseDown={(e) => { e.preventDefault(); if (activeChar) addConsolidateItem(activeChar, it.n); setQ(''); }} className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-field transition-colors">
                  <div className="shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={20} name={it.n} assets={assetsFor(activeChar)} bmpHas={iconSet.has(it.id)} /></div>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{it.n}</span>
                </button>
              ))}
            </Popover>
          </div>
          <button type="button" onClick={() => setBulkOpen((v) => !v)} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-accent/40 transition-colors">Bulk Add</button>
        </div>
        {bulkOpen && (
          <div className="mt-2.5 rounded-lg border border-line bg-field/30 p-3 flex flex-col gap-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4">Bulk add to <span className="text-accent">{anon(activeChar)}</span></div>
            <div>
              <div className="text-[11px] text-fg-3 mb-1.5">From a tag</div>
              {tags.length === 0 ? (
                <div className="text-[11px] text-fg-4">No tags yet. Create them in the Tagging view.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => { const n = countForTag(t.id); return (
                    <button key={t.id} type="button" disabled={!n} onClick={() => bulkAddTag(t.id)} title={`Add ${n} item${n === 1 ? '' : 's'} tagged ${t.name} to ${anon(activeChar)}`} className="le-tap inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg-2 enabled:hover:border-accent/50 disabled:opacity-40 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="truncate max-w-[140px]">{t.name}</span>
                      <span className="text-fg-4 tabular-nums">{n}</span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] text-fg-3 shrink-0">Pick from</span>
                <div className="w-28 shrink-0"><Select value={activeViewChar} onChange={(v) => { setViewChar(v); setViewBag(''); setPicked(new Set()); }} options={invCharNames} renderOption={(n) => anon(n)} renderValue={(n) => anon(n)} full /></div>
                <div className="w-24 shrink-0"><Select value={activeViewBag} onChange={(v) => { setViewBag(v); setPicked(new Set()); }} options={viewBags.map((b) => String(b.id))} renderOption={(v) => viewBags.find((b) => String(b.id) === v)?.b ?? v} renderValue={(v) => viewBags.find((b) => String(b.id) === v)?.b ?? v} full /></div>
                <button type="button" onClick={addPicked} disabled={!picked.size || !activeChar} className="le-tap ml-auto shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Add{picked.size ? ` ${picked.size}` : ''}</button>
              </div>
              {invCharNames.length === 0 ? (
                <div className="text-center text-[11px] text-fg-4 py-4 rounded-md border border-line bg-surface">No character inventories loaded.</div>
              ) : bagItems.length === 0 ? (
                <div className="text-center text-[11px] text-fg-4 py-4 rounded-md border border-line bg-surface">This bag is empty.</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1.5 text-[10px] text-fg-4">
                    <span>Click &amp; drag to select</span>
                    <button type="button" onClick={() => setPicked(new Set(bagItems.map((it) => it.id)))} className="hover:text-accent transition-colors">All</button>
                    <button type="button" onClick={() => setPicked(new Set())} className="hover:text-accent transition-colors">None</button>
                    <span className="ml-auto tabular-nums">{picked.size}/{bagItems.length}</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-line bg-surface p-2">
                    <div className="grid gap-[3px] content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, 34px)' }}>
                      {bagItems.map((it) => {
                        const on = picked.has(it.id);
                        return (
                          <div key={it.id} onPointerDown={() => pickDown(it.id)} onPointerEnter={() => pickEnter(it.id)} title={it.n} style={PICK_TILE_CV}
                            className={`relative w-[34px] h-[34px] rounded bg-field grid place-items-center overflow-hidden cursor-pointer select-none touch-none transition-all ${on ? 'ring-2 ring-accent z-[1]' : 'hover:ring-1 hover:ring-line-2'}`}>
                            <IconInner id={it.id} size={32} name={it.n} assets={anyAssets} bmpHas={iconSet.has(it.id)} />
                            {on && <span className="absolute top-0 right-0 grid place-items-center w-3.5 h-3.5 rounded-bl bg-accent text-on-accent"><svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg></span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center text-[12px] text-fg-4 py-8">No preferences yet. Pick a character and add the items they should always hold.</div>
      ) : (
        <>
          {delSel.size > 0 && (
            <div className="sticky top-0 z-[1] flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 backdrop-blur-sm">
              <span className="text-[11px] font-semibold text-red-300 tabular-nums">{delSel.size} selected</span>
              <button type="button" onClick={deleteSelected} className="le-tap px-2.5 py-1 text-[11px] font-bold rounded-md bg-red-500/80 text-white hover:bg-red-500 transition-colors">Delete {delSel.size}</button>
              <button type="button" onClick={() => setDelSel(new Set())} className="le-tap ml-auto px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Clear</button>
            </div>
          )}
          {entries.map(([name, items]) => {
            const selHere = items.filter((n) => delSel.has(delKey(name, n))).length;
            return (
              <div key={name} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${known.find((k) => k.name === name)?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                  <span className="text-[12px] font-bold text-fg truncate">{anon(name)}</span>
                  {selHere > 0 && <span className="text-[10px] text-red-300 tabular-nums">{selHere} selected</span>}
                  <button type="button" onClick={() => { const s = new Set(delSel); if (selHere === items.length) items.forEach((n) => s.delete(delKey(name, n))); else items.forEach((n) => s.add(delKey(name, n))); setDelSel(s); }} className="text-[10px] text-fg-4 hover:text-accent transition-colors">{selHere === items.length ? 'None' : 'All'}</button>
                  <span className="ml-auto text-[11px] text-fg-4 tabular-nums">{items.length}</span>
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  {items.map((n) => {
                    const key = delKey(name, n);
                    const on = delSel.has(key);
                    return (
                      <div key={n} onPointerDown={() => delDown(key)} onPointerEnter={() => delEnter(key)}
                        className={`flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] cursor-pointer select-none touch-none transition-colors ${on ? 'border-red-400 bg-red-500/15 text-fg' : 'border-line bg-field text-fg-2 hover:border-line-2'}`}>
                        <div className="shrink-0 w-4 h-4 rounded bg-surface grid place-items-center overflow-hidden"><IconInner id={iconId(n)} size={16} name={n} assets={assetsFor(name)} bmpHas={iconId(n) > 0 && iconSet.has(iconId(n))} /></div>
                        <span className="min-w-0 flex-1 truncate">{n}</span>
                        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); applyDel(key, false); removeConsolidateItem(name, n); }} aria-label="Remove" className="shrink-0 grid place-items-center w-4 h-4 rounded text-fg-4 hover:text-red-400 transition-colors">×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
      {modalOpen && <ConsolidatePrefsModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
