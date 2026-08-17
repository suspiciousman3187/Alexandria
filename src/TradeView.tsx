import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { useKnownCharacters, tradeNpc, tradePcOffer, appDataPath, inTauri, type KnownChar, type InvItem } from './bridge';
import { Group, Row, RowStacked, CharacterSelect, SectionTabs, Stepper } from './ui';
import { Crossfade } from './overlay';
import { ItemHoverTarget } from './ItemTooltip';
import { useSticky, useStickyChar } from './sticky';
import { itemNameMatches } from './itemNames';

type Alias = { label: string; item: string; count: number; times?: number };

function uniqueItems(char?: KnownChar): InvItem[] {
  if (!char?.inv) return [];
  const seen = new Map<number, InvItem>();
  for (const b of char.inv) for (const it of b.items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => a.n.localeCompare(b.n));
}

function ItemSearch({ items, value, onChange, onPick, count, onCount }: { items: InvItem[]; value: string; onChange: (v: string) => void; onPick: (it: InvItem) => void; count: number; onCount: (n: number) => void }) {
  const matches = useMemo(() => {
    const s = value.trim().toLowerCase();
    if (!s) return [];
    return items.filter((it) => itemNameMatches(it.id, it.n, s)).slice(0, 8);
  }, [value, items]);
  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Item name" className="flex-1 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
        <Stepper value={count} min={1} onChange={onCount} className="shrink-0" />
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {matches.map((it) => (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                <ItemHoverTarget meta={{ id: it.id, n: it.n, c: it.c, ms: it.ms, f: it.f }}>
                  <button onClick={() => onPick(it)} className="px-2.5 py-1 text-[11px] rounded-md bg-surface-raised border border-line text-fg-2 hover:border-accent/50">
                    {it.n} <span className="text-fg-4">x{it.c}</span>
                  </button>
                </ItemHoverTarget>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function NpcPanel({ active, items }: { active?: KnownChar; items: InvItem[] }) {
  const [q, setQ] = useSticky('trade.npc.q', '');
  const [sel, setSel] = useSticky<{ id: number; n: string } | null>('trade.npc.sel', null);
  const [count, setCount] = useSticky('trade.npc.count', 1);
  const [times, setTimes] = useSticky('trade.npc.times', 1);

  const [aliases, setAliases] = useState<Alias[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!inTauri) { loaded.current = true; return; }
    (async () => {
      try { setAliases(JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('trade_aliases.json') }))); } catch { /* none */ }
      loaded.current = true;
    })();
  }, []);
  const saveAliases = (a: Alias[]) => {
    setAliases(a);
    if (inTauri) void (async () => { try { await invoke('write_text_file', { path: await appDataPath('trade_aliases.json'), contents: JSON.stringify(a) }); } catch { /* ignore */ } })();
  };

  const [newLabel, setNewLabel] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newCount, setNewCount] = useState(99);
  const [newTimes, setNewTimes] = useState(1);

  const arg = () => (sel ? { id: sel.id, count } : q.trim() ? { item: q.trim(), count } : null);
  const doNpc = () => { const a = arg(); if (a && active?.conn != null) tradeNpc(active.conn, { ...a, times }); };

  return (
    <>
      <Group title="Trade To NPC">
        <RowStacked label="Item" desc="Target the NPC in-game first. Search this character's inventory or type a name.">
          <ItemSearch
            items={items}
            value={sel ? sel.n : q}
            onChange={(v) => { setSel(null); setQ(v); }}
            onPick={(it) => { setSel({ id: it.id, n: it.n }); setQ(''); setCount(it.c); }}
            count={count}
            onCount={setCount}
          />
        </RowStacked>
        <Row label="Trade" desc="Repeat loops the trade to your target until the item runs out">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-4">Repeat</span>
            <Stepper value={times} min={1} max={30} onChange={setTimes} />
            <button onClick={doNpc} className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Trade To Target</button>
          </div>
        </Row>
      </Group>

      <Group title="Quick Trades">
        {aliases.length === 0 ? (
          <div className="px-3.5 py-2.5 text-[11px] text-fg-4">No saved trades yet. Add one below.</div>
        ) : aliases.map((a, i) => (
          <motion.div key={i} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            <Row label={a.label} desc={`${a.item} x${a.count}${a.times && a.times > 1 ? ` · repeat ${a.times}` : ''}`}>
              <div className="flex items-center gap-1.5">
                <button onClick={() => active?.conn != null && tradeNpc(active.conn, { item: a.item, count: a.count, times: a.times ?? 1 })} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Trade</button>
                <button onClick={() => saveAliases(aliases.filter((_, j) => j !== i))} aria-label="Remove" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line">×</button>
              </div>
            </Row>
          </motion.div>
        ))}
        <RowStacked label="Add Quick Trade" desc="Trades the item to your current target">
          <div className="flex items-center gap-1.5">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" className="flex-1 min-w-0 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 outline-none focus:border-accent/50" />
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Item" className="flex-1 min-w-0 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 outline-none focus:border-accent/50" />
            <Stepper value={newCount} min={1} onChange={setNewCount} title="Count" className="shrink-0" />
            <Stepper value={newTimes} min={1} max={30} onChange={setNewTimes} title="Repeat" className="shrink-0" />
            <button
              onClick={() => { if (newLabel.trim() && newItem.trim()) { saveAliases([...aliases, { label: newLabel.trim(), item: newItem.trim(), count: newCount, times: newTimes }]); setNewLabel(''); setNewItem(''); setNewCount(99); setNewTimes(1); } }}
              className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors"
            >Add</button>
          </div>
        </RowStacked>
      </Group>
    </>
  );
}

function PcPanel({ active, items }: { active?: KnownChar; items: InvItem[] }) {
  const [target, setTarget] = useSticky('trade.pc.target', '');
  const [list, setList] = useSticky<{ item: string; count: number }[]>('trade.pc.list', []);
  const [q, setQ] = useSticky('trade.pc.q', '');
  const [count, setCount] = useSticky('trade.pc.count', 1);

  const add = (name: string, c: number) => {
    const n = name.trim();
    if (!n || list.length >= 8) return;
    setList([...list, { item: n, count: c }]);
    setQ(''); setCount(1);
  };
  const offer = () => { if (active?.conn != null && !active.mog && list.length) tradePcOffer(active.conn, { target: target.trim() || undefined, items: list }); };

  return (
    <>
      <Group title="Trade Partner">
        <RowStacked label="Player" desc="Type a name, or leave blank to use your current target in-game">
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Player name (blank = current target)" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
        </RowStacked>
      </Group>

      <Group title={`Items${list.length > 0 ? ` · ${list.length}/8` : ''}`}>
        {list.length === 0 ? (
          <div className="px-3.5 py-2.5 text-[11px] text-fg-4">No items added. Search below to add up to 8.</div>
        ) : list.map((it, i) => (
          <motion.div key={i} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            <Row label={it.item} desc={`x${it.count}`}>
              <button onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line">×</button>
            </Row>
          </motion.div>
        ))}
        {list.length < 8 && (
          <RowStacked label="Add Item" desc="From this character's inventory">
            <div className="flex flex-col gap-2">
              <ItemSearch items={items} value={q} onChange={setQ} onPick={(it) => add(it.n, Math.min(count, it.c))} count={count} onCount={setCount} />
              {q.trim() && <button onClick={() => add(q, count)} className="self-start px-2.5 py-1 text-[11px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Add "{q.trim()}"</button>}
            </div>
          </RowStacked>
        )}
      </Group>

      <button
        onClick={offer}
        disabled={list.length === 0 || active?.conn == null || !!active?.mog}
        className="w-full px-3 py-2.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors"
      >
        {active?.mog ? 'Offer Trade · Leave Mog House First' : 'Offer Trade'}
      </button>
      <p className="mt-2 text-[10px] text-fg-4 leading-snug">Opens the trade window, adds the items, and offers. Confirm the final accept in-game once your partner offers back.</p>
    </>
  );
}

export default function TradeView() {
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);
  const [tab, setTab] = useSticky<'pc' | 'npc'>('trade.tab', 'pc');
  const items = useMemo(() => uniqueItems(active), [active]);
  // Player trade: only items actually in inventory (bag 0) and not Ex/No-Trade (0x02).
  const pcItems = useMemo(() => {
    const inv0 = active?.inv?.find((b) => b.id === 0);
    const seen = new Map<number, InvItem>();
    for (const it of inv0?.items ?? []) if (it.id && !(it.f && it.f & 0x02) && !seen.has(it.id)) seen.set(it.id, it);
    return [...seen.values()].sort((a, b) => a.n.localeCompare(b.n));
  }, [active]);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Trading acts on a live character. Load the Alexandria addon in-game to trade from here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        {online.length > 1 && <CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} />}
        <SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'pc', label: 'Player' }, { id: 'npc', label: 'NPC' }]} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          <Crossfade id={tab}>{tab === 'pc' ? <PcPanel active={active} items={pcItems} /> : <NpcPanel active={active} items={items} />}</Crossfade>
        </div>
      </div>
    </div>
  );
}
