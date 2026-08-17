import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, shopBuy, shopSell, npcSelect, useNpcLearn, clearNpcLearn, type KnownChar, type ShopItem, type InvItem, type NpcLearn } from './bridge';
import { useShopSell, setShopSell } from './shop';
import { useMenuShortcuts, addShortcut, removeShortcut, type MenuShortcut } from './menuShortcuts';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { useSticky, useStickyChar } from './sticky';
import { CharacterSelect, SectionTabs, Stepper } from './ui';
import { Crossfade } from './overlay';

const fmtGil = (v: number) => v.toLocaleString();

export function Icon({ id, n, assets, iconSet }: { id: number; n: string; assets?: string; iconSet: Set<number> }) {
  const hover = useItemHover({ id, n });
  return (
    <div {...hover} className="relative shrink-0 w-8 h-8 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={32} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function BuyRow({ it, assets, iconSet, gil, onBuy }: { it: ShopItem; assets?: string; iconSet: Set<number>; gil: number; onBuy: (qty: number) => void }) {
  const [qty, setQty] = useState(1);
  const afford = gil >= it.price * qty;
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-field transition-colors">
      <Icon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-fg truncate">{it.n}</div>
        <div className={`text-[11px] tabular-nums ${afford ? 'text-fg-4' : 'text-red-400'}`}>{fmtGil(it.price)} gil{qty > 1 ? ` · ${fmtGil(it.price * qty)} total` : ''}</div>
      </div>
      <Stepper value={qty} min={1} max={99} onChange={setQty} className="shrink-0" />
      <button
        onClick={() => onBuy(qty)}
        disabled={!afford}
        className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        Buy
      </button>
    </div>
  );
}

function SellRow({ it, assets, iconSet, marked, onToggle, onSell, canSell }: { it: InvItem; assets?: string; iconSet: Set<number>; marked: boolean; onToggle: () => void; onSell: () => void; canSell: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-field transition-colors">
      <Icon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg truncate">{it.n}</span>
          {it.c > 1 && <span className="shrink-0 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-field text-fg-3">×{it.c}</span>}
        </div>
      </div>
      <button
        onClick={onToggle}
        title={marked ? 'On Sell List' : 'Add to Sell List'}
        className={`shrink-0 grid place-items-center w-8 h-8 rounded-md border transition-colors ${marked ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-fg-4 border-line bg-field hover:text-fg-2'}`}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill={marked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" /></svg>
      </button>
      <button
        onClick={onSell}
        disabled={!canSell}
        title={canSell ? 'Sell Now' : 'Open a shop in-game to sell'}
        className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md border border-line bg-field text-fg-2 enabled:hover:text-fg disabled:opacity-30 transition-colors"
      >
        Sell
      </button>
    </div>
  );
}

function MoogleShops({ npcName, shortcuts, onSelect, onRemove }: { npcName: string; shortcuts: MenuShortcut[]; onSelect: (option: number) => void; onRemove: (s: MenuShortcut) => void }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-2.5 flex flex-col gap-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-fg-3 px-0.5 truncate">{npcName}</div>
      {shortcuts.length === 0 ? (
        <div className="text-[11px] text-fg-4 px-0.5">No saved shops for this NPC yet. Open one in-game to learn it.</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {shortcuts.map((s) => (
            <div key={`${s.npc}:${s.option}`} className="group relative flex">
              <button onClick={() => onSelect(s.option)} className="flex-1 px-3 py-2 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg hover:border-fg-4 transition-colors text-left truncate">{s.label}</button>
              <button onClick={() => onRemove(s)} title="Remove" className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-fg-4 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LearnBanner({ learn, onSave, onDismiss }: { learn: NpcLearn; onSave: (label: string) => void; onDismiss: () => void }) {
  const [label, setLabel] = useState('');
  useEffect(() => { setLabel(''); }, [learn.npc, learn.option]);
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-center gap-2">
      <span className="text-[11px] text-amber-200 flex-1 min-w-0">New shop opened at {learn.npc}. Save it?</span>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="w-28 shrink-0 text-[12px] rounded-md border border-line bg-field px-2 py-1 text-fg-2" />
      <button onClick={() => label.trim() && onSave(label.trim())} disabled={!label.trim()} className="shrink-0 px-2.5 py-1 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:opacity-90 disabled:opacity-40 transition-opacity">Save</button>
      <button onClick={onDismiss} title="Dismiss" className="shrink-0 text-fg-4 hover:text-fg-2 text-[14px] px-1">×</button>
    </div>
  );
}

export default function ShopView() {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const sell = useShopSell();
  const [name, setName] = useStickyChar();
  const [tab, setTab] = useSticky<'buy' | 'sell'>('shop.tab', 'buy');

  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const active: KnownChar | undefined = online.find((c) => c.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  const shortcuts = useMenuShortcuts();
  const learn = useNpcLearn();
  const conn = active?.conn;
  const gil = active?.gil ?? active?.cur?.gil ?? 0;
  const shopItems = active?.shop?.items ?? [];
  const shopOpen = shopItems.length > 0;
  const inv = useMemo(() => (active?.inv?.find((b) => b.id === 0)?.items ?? []).filter((it) => !(it.f && (it.f & 0x10))), [active?.inv]);

  const npcNear = active?.npcNear;
  const nearName = npcNear?.name ?? null;
  const matching = useMemo(() => shortcuts.filter((s) => nearName && s.npc === nearName), [shortcuts, nearName]);
  const showLearn = !!learn && learn.conn === conn && !shortcuts.some((s) => s.npc === learn.npc && s.option === learn.option);

  const markedNames = useMemo(() => new Set(sell.items.map((n) => n.toLowerCase())), [sell.items]);
  const toggleMark = (itemName: string) => {
    const lc = itemName.toLowerCase();
    const next = markedNames.has(lc) ? sell.items.filter((n) => n.toLowerCase() !== lc) : [...sell.items, itemName];
    setShopSell({ items: next, auto: sell.auto, anywhere: sell.anywhere });
  };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Log a character in-game with the Alexandria addon loaded. Open a shop NPC to buy and sell from here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} />
          </div>
          <div className="shrink-0 flex items-center gap-1.5 rounded-md border border-line bg-field/50 pl-2.5 pr-1.5 py-1">
            <span className="text-[13px] font-bold tabular-nums text-amber-300">{fmtGil(gil)}</span>
            <span className="shrink-0 w-4 h-4 rounded-full bg-amber-400/15 grid place-items-center text-amber-300 text-[10px] font-bold">G</span>
          </div>
        </div>
        <SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' }]} />
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <Crossfade id={tab}>
          {tab === 'buy' ? (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {nearName && (
                  <motion.div key="moogle" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                    <MoogleShops npcName={nearName} shortcuts={matching} onSelect={(o) => conn != null && npcSelect(conn, o)} onRemove={(s) => removeShortcut(s.npc, s.option)} />
                  </motion.div>
                )}
                {showLearn && learn && (
                  <motion.div key="learn" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                    <LearnBanner learn={learn} onSave={(label) => { addShortcut({ npc: learn.npc, option: learn.option, label }); clearNpcLearn(); }} onDismiss={clearNpcLearn} />
                  </motion.div>
                )}
              </AnimatePresence>
              {shopOpen ? (
                <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
                  {shopItems.map((it, i) => (
                    <motion.div key={it.idx} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.015, 0.2) }}>
                      <BuyRow it={it} assets={active?.assets} iconSet={iconSet} gil={gil} onBuy={(q) => conn != null && shopBuy(conn, it.idx, q)} />
                    </motion.div>
                  ))}
                </div>
              ) : !nearName ? (
                <div className="grid place-items-center text-center px-6 py-16">
                  <div className="max-w-sm">
                    <div className="text-[13px] font-semibold text-fg-2 mb-1">No Shops Nearby</div>
                    <div className="text-[12px] text-fg-4 leading-relaxed">Open a shop ingame to populate this section.</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
              {inv.length === 0 ? (
                <div className="text-[12px] text-fg-4 px-1 py-4 text-center">Inventory is empty.</div>
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  {inv.map((it) => (
                    <motion.div
                      key={it.s}
                      layout
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <SellRow
                        it={it}
                        assets={active?.assets}
                        iconSet={iconSet}
                        marked={markedNames.has(it.n.toLowerCase())}
                        onToggle={() => toggleMark(it.n)}
                        onSell={() => conn != null && shopSell(conn, it.id, it.c, 0, it.s)}
                        canSell={shopOpen}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          )}
        </Crossfade>
      </div>
    </div>
  );
}
