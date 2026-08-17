import { useMemo, useState } from 'react';
import { useKnownCharacters, useAvailableIcons, type KnownChar } from './bridge';
import { useVendorStore, setVendorChar, emptyVendor, type VendorChar } from './vendors';
import { VENDOR_ITEMS, vendorsSelling, type VendorItem } from './vendorCatalog';
import { IconInner } from './atlasIcon';
import { Collapse } from './overlay';
import { Stepper, Toggle } from './ui';
import { OpGlyph } from './OpCard';
import { useAnon } from './anonymize';
import { ALWAYS_BAGS } from './bagConstants';

const fmt = (v: number) => v.toLocaleString();

// Count what a character carries across every carry bag (inventory + satchel/sack/case +
// wardrobes), matching how the addon counts owned stock so organized surplus reads as owned.
function ownedOf(char: KnownChar, id: number): number {
  let n = 0;
  for (const bag of char.inv ?? []) {
    if (!ALWAYS_BAGS.has(bag.id)) continue;
    for (const it of bag.items) if (it.id === id) n += it.c;
  }
  return n;
}

function SmallIcon({ id, n, assets, iconSet }: { id: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function VendorPill({ near, enabled }: { near?: string | null; enabled: boolean }) {
  if (!enabled) return null;
  const state = near === undefined ? 'unknown' : near ? 'near' : 'far';
  const cls = state === 'near' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : state === 'far' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-field text-fg-4 border-line';
  const dot = state === 'near' ? 'bg-emerald-400' : state === 'far' ? 'bg-amber-400' : 'bg-fg-4';
  const label = state === 'near' ? `Near ${near}` : state === 'far' ? 'No Vendor In Range' : 'Locating…';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{label}
    </span>
  );
}

function ItemRow({ it, char, min, iconSet, assets, onSet }: {
  it: VendorItem; char: KnownChar; min: number; iconSet: Set<number>; assets?: string; onSet: (min: number) => void;
}) {
  const owned = ownedOf(char, it.id);
  const on = min > 0;
  const met = on && owned >= min;
  const soldBy = vendorsSelling(it.id).join(', ');
  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2 border-b border-line last:border-b-0 ${on ? '' : 'opacity-55'}`}>
      <SmallIcon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-fg-2 truncate">{it.n}</span>
          {met && (
            <span className="shrink-0 text-emerald-400" title="Already stocked">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>
            </span>
          )}
        </div>
        <div className="text-[10px] tabular-nums flex items-center gap-1.5 flex-wrap">
          <span className="text-fg-4">sold by {soldBy}</span>
          {on && <span className={met ? 'text-emerald-400' : 'text-amber-400'}>· have {fmt(owned)} / {fmt(min)}</span>}
        </div>
      </div>
      <Stepper value={min} min={0} max={999} numW="w-12" onChange={onSet} />
    </div>
  );
}

function CharCard({ char, iconSet, assets, onApplyAll }: { char: KnownChar; iconSet: Set<number>; assets?: string; onApplyAll: (items: { name: string; min: number }[]) => void }) {
  const anon = useAnon();
  const store = useVendorStore();
  const cfg: VendorChar = store[char.name] ?? emptyVendor();
  const update = (r: VendorChar) => setVendorChar(char.name, r);
  const [open, setOpen] = useState(true);

  const minOf = (name: string) => cfg.items.find((i) => i.name.toLowerCase() === name.toLowerCase())?.min ?? 0;
  const setMin = (name: string, min: number) => {
    const rest = cfg.items.filter((i) => i.name.toLowerCase() !== name.toLowerCase());
    update({ ...cfg, items: min > 0 ? [...rest, { name, min }] : rest });
  };

  const configured = cfg.items.length;
  const stocked = cfg.items.filter((i) => {
    const it = VENDOR_ITEMS.find((x) => x.n.toLowerCase() === i.name.toLowerCase());
    return it && ownedOf(char, it.id) >= i.min;
  }).length;

  const rp = char.pvendor;
  const rpItem = rp && rp.item ? VENDOR_ITEMS.find((x) => x.id === rp.item) : undefined;
  const rpPct = rp && rp.target > 0 ? Math.min(100, Math.round((rp.have / rp.target) * 100)) : 0;

  return (
    <div className={`rounded-xl bg-surface border overflow-hidden ${rp?.active ? 'border-accent/40' : 'border-line'}`}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </span>
          <span className="text-[13px] font-semibold text-fg-2 truncate">{anon(char.name)}</span>
          {configured > 0 && (
            <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${stocked === configured ? 'text-emerald-400' : 'text-fg-4'}`}>{stocked}/{configured} stocked</span>
          )}
        </button>
        <VendorPill near={char.pvendorNear} enabled={cfg.enabled} />
        {configured > 0 && (
          <button onClick={() => onApplyAll(cfg.items)} title="Copy these targets to every character" className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg transition-colors">Apply To All</button>
        )}
        <Toggle on={cfg.enabled} onChange={(v) => update({ ...cfg, enabled: v })} />
      </div>
      <Collapse open={!!rp?.active}>{rp?.active && (
        <div className="px-3.5 pb-2.5 -mt-0.5">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-accent font-semibold flex items-center gap-1.5 min-w-0">
              <OpGlyph state="active" className="w-3 h-3 shrink-0" />
              <span className="truncate">Restocking{rpItem ? ` · ${rpItem.n}` : '…'}</span>
            </span>
            {rp.target > 0 && <span className="tabular-nums text-fg-4 shrink-0">{fmt(rp.have)} / {fmt(rp.target)}</span>}
          </div>
          <div className="h-1 rounded-full bg-field overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-[width] duration-300 ease-out" style={{ width: `${rpPct}%` }} />
          </div>
        </div>
      )}</Collapse>
      <Collapse open={open}>
        <div className="border-t border-line">
          {VENDOR_ITEMS.map((it) => (
            <ItemRow key={it.id} it={it} char={char} min={minOf(it.n)} iconSet={iconSet} assets={assets} onSet={(m) => setMin(it.n, m)} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

export default function VendorsView() {
  const known = useKnownCharacters();
  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const store = useVendorStore();
  const iconSet = useAvailableIcons();
  const assetsAny = useMemo(() => known.find((c) => c.assets)?.assets, [known]);

  const setAllEnabled = (on: boolean) => {
    for (const c of online) {
      const cfg = store[c.name] ?? emptyVendor();
      setVendorChar(c.name, { ...cfg, enabled: on });
    }
  };
  const applyToAll = (items: { name: string; min: number }[]) => {
    for (const c of online) {
      const cfg = store[c.name] ?? emptyVendor();
      setVendorChar(c.name, { ...cfg, items: items.map((i) => ({ ...i })) });
    }
  };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Load the Alexandria addon in-game. Vendors tops up the items you list when a character nears one of the proximity vendors (Sortie sodas, throwing weapons, and more).</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex items-center gap-2 max-w-2xl w-full mx-auto">
        <div className="flex-1 text-[12px] text-fg-3 px-1">Set a target count per item; each character buys it from whichever cataloged vendor it nears.</div>
        <button onClick={() => setAllEnabled(true)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Enable All</button>
        <button onClick={() => setAllEnabled(false)} className="le-tap shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Disable All</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 max-w-2xl w-full mx-auto flex flex-col gap-3">
          {online.map((c) => <CharCard key={c.name} char={c} iconSet={iconSet} assets={assetsAny} onApplyAll={applyToAll} />)}
        </div>
      </div>
    </div>
  );
}
