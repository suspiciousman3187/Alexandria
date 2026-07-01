import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { useKnownCharacters, appDataPath, inTauri } from './bridge';
import { useMenuShortcuts, type MenuShortcut } from './menuShortcuts';
import { Group, Row, RowStacked, Select, CharacterSelect, Stepper } from './ui';
import { useSeqRun, runSequence, stopSequence, type Step } from './seq';
import { bagColor } from './bagColors';
import { useAnon } from './anonymize';

const BAGS = [
  { id: 0, name: 'Inventory' }, { id: 8, name: 'Wardrobe' }, { id: 5, name: 'Satchel' }, { id: 6, name: 'Sack' }, { id: 7, name: 'Case' },
  { id: 1, name: 'Safe' }, { id: 9, name: 'Safe 2' }, { id: 2, name: 'Storage' }, { id: 4, name: 'Locker' },
  { id: 10, name: 'Wardrobe 2' }, { id: 11, name: 'Wardrobe 3' }, { id: 12, name: 'Wardrobe 4' }, { id: 13, name: 'Wardrobe 5' }, { id: 14, name: 'Wardrobe 6' }, { id: 15, name: 'Wardrobe 7' }, { id: 16, name: 'Wardrobe 8' },
];
const bagName = (id: number) => BAGS.find((b) => b.id === id)?.name ?? `Bag ${id}`;
const renderBagOpt = (v: string) => {
  const c = bagColor(Number(v));
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      <span className={`truncate ${c.text}`}>{bagName(Number(v))}</span>
    </span>
  );
};

function stepSummary(s: Step): string {
  if (s.type === 'use') return `Use ${s.count}× ${s.item}`;
  if (s.type === 'buy') return `Buy ${s.count}× ${s.item}`;
  if (s.type === 'trade') return `Trade ${s.count}× ${s.item} → ${s.to}`;
  if (s.type === 'npcopen') return `Open ${s.label} · ${s.npc}`;
  if (s.type === 'move') return `Move ${s.count}× ${s.item} · ${bagName(s.from)} → ${bagName(s.to)}`;
  return `Wait ${s.seconds}s`;
}

type Store = { current: string; sequences: Record<string, Step[]> };
const DEFAULT_STORE: Store = { current: 'New Sequence', sequences: { 'New Sequence': [] } };

const STATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', running: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };

const TYPE_LABELS: Record<Step['type'], string> = { use: 'Use Item', buy: 'Buy Item', trade: 'Trade Item', npcopen: 'Open Shop', move: 'Move Item', wait: 'Wait' };
const shortcutKey = (s: MenuShortcut) => `${s.npc}:${s.option}`;

function AddStep({ onAdd, recipients, shortcuts }: { onAdd: (s: Step) => void; recipients: string[]; shortcuts: MenuShortcut[] }) {
  const [type, setType] = useState<Step['type']>('use');
  const [item, setItem] = useState('');
  const [count, setCount] = useState(1);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(8);
  const [seconds, setSeconds] = useState(2);
  const [recipient, setRecipient] = useState('');
  const [shortcut, setShortcut] = useState('');

  const hasItemField = type === 'use' || type === 'buy' || type === 'trade';
  const rcpt = recipient || recipients[0] || '';
  const sc = shortcuts.find((s) => shortcutKey(s) === shortcut) ?? shortcuts[0];

  const add = () => {
    if (type === 'wait') { onAdd({ type: 'wait', seconds: Math.max(0, seconds) }); return; }
    if (type === 'npcopen') { if (sc) onAdd({ type: 'npcopen', npc: sc.npc, option: sc.option, label: sc.label }); return; }
    const n = item.trim();
    if (!n) return;
    if (type === 'use') onAdd({ type: 'use', item: n, count: Math.max(1, count) });
    else if (type === 'buy') onAdd({ type: 'buy', item: n, count: Math.max(1, count) });
    else if (type === 'trade') { if (rcpt) onAdd({ type: 'trade', item: n, count: Math.max(1, count), to: rcpt }); else return; }
    else onAdd({ type: 'move', item: n, from, to, count: Math.max(1, count) });
    setItem('');
  };

  return (
    <RowStacked label="Add Step" desc="Build the sequence one action at a time">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-28 shrink-0"><Select value={type} onChange={(v) => setType(v as Step['type'])} options={['use', 'buy', 'trade', 'npcopen', 'move', 'wait']} renderOption={(v) => TYPE_LABELS[v as Step['type']] ?? v} full /></div>
          {hasItemField && <input value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="Item name" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />}
          {type === 'wait' && <Stepper value={seconds} min={0} onChange={setSeconds} className="shrink-0" />}
          {type === 'wait' && <span className="text-[11px] text-fg-4">seconds</span>}
          {(hasItemField && type !== 'trade') && <Stepper value={count} min={1} onChange={setCount} title="Count" className="shrink-0" />}
        </div>
        {type === 'move' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-4">from</span>
            <div className="flex-1 min-w-0"><Select value={String(from)} onChange={(v) => setFrom(Number(v))} options={BAGS.map((b) => String(b.id))} renderOption={renderBagOpt} full /></div>
            <span className="text-[11px] text-fg-4">to</span>
            <div className="flex-1 min-w-0"><Select value={String(to)} onChange={(v) => setTo(Number(v))} options={BAGS.map((b) => String(b.id))} renderOption={renderBagOpt} full /></div>
          </div>
        )}
        {type === 'trade' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-4">qty</span>
            <Stepper value={count} min={1} onChange={setCount} className="shrink-0" />
            <span className="text-[11px] text-fg-4">to</span>
            {recipients.length ? <div className="flex-1 min-w-0"><Select value={rcpt} onChange={setRecipient} options={recipients} full /></div> : <span className="text-[11px] text-red-300">No other character connected</span>}
          </div>
        )}
        {type === 'npcopen' && (
          shortcuts.length ? <div className="flex-1 min-w-0"><Select value={sc ? shortcutKey(sc) : ''} onChange={setShortcut} options={shortcuts.map(shortcutKey)} renderOption={(k) => { const m = shortcuts.find((s) => shortcutKey(s) === k); return m ? `${m.label} · ${m.npc}` : k; }} full /></div>
            : <span className="text-[11px] text-fg-4">No saved shops yet. Open a shop NPC in-game once to learn it.</span>
        )}
        {type === 'buy' && <span className="text-[11px] text-fg-4">Buy resolves against the shop open in-game when the sequence runs.</span>}
        {type === 'trade' && <span className="text-[11px] text-fg-4">Recipient must be near the runner in-game. Same-PC characters auto-accept.</span>}
        <button onClick={add} className="le-tap self-start px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Add Step</button>
      </div>
    </RowStacked>
  );
}

export default function SequencesView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const shortcuts = useMenuShortcuts();
  const run = useSeqRun();

  const [store, setStore] = useState<Store>(DEFAULT_STORE);
  const [name, setName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const loaded = useRef(false);

  const active = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  useEffect(() => {
    if (!inTauri) { loaded.current = true; return; }
    (async () => {
      try {
        const s = JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('sequences.json') })) as Store;
        if (s.sequences && s.current) setStore(s);
      } catch { /* fresh */ }
      loaded.current = true;
    })();
  }, []);

  const persist = (s: Store) => {
    setStore(s);
    if (inTauri) void (async () => { try { await invoke('write_text_file', { path: await appDataPath('sequences.json'), contents: JSON.stringify(s) }); } catch { /* ignore */ } })();
  };

  const seqNames = Object.keys(store.sequences);
  const steps = store.sequences[store.current] ?? [];
  const setSteps = (next: Step[]) => persist({ ...store, sequences: { ...store.sequences, [store.current]: next } });

  const addSeq = () => {
    const n = newName.trim();
    if (!n || store.sequences[n]) return;
    persist({ current: n, sequences: { ...store.sequences, [n]: [] } });
    setNewName('');
  };
  const deleteSeq = (n: string) => {
    if (seqNames.length <= 1) return;
    const rest = { ...store.sequences }; delete rest[n];
    persist({ current: n === store.current ? Object.keys(rest)[0] : store.current, sequences: rest });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; setSteps(next);
  };

  const showRun = run.seqName === store.current && run.charName === active?.name;
  const start = () => { if (active && steps.length) void runSequence(active, { name: store.current, steps }); };

  const items = useMemo(() => steps, [steps]);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Sequences run on a live character. Load the Alexandria addon in-game to use them.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-5">
      <Group>
        <Row label="Sequence"><div className="w-52"><Select value={store.current} onChange={(v) => persist({ ...store, current: v })} options={seqNames} full /></div></Row>
        <Row label="Run On">{online.length > 1 ? <div className="w-52"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div> : <span className="text-[12px] text-fg-3">{anon(active?.name)}</span>}</Row>
        <RowStacked label="New Sequence" desc="Create another preset">
          <div className="flex items-center gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSeq(); }} placeholder="Sequence name" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
            <button onClick={addSeq} disabled={!newName.trim()} className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Add</button>
            <button onClick={() => deleteSeq(store.current)} disabled={seqNames.length <= 1} className="le-tap shrink-0 grid place-items-center w-8 h-8 rounded-md text-fg-4 hover:text-fg hover:bg-line disabled:opacity-30 transition-colors" aria-label="Delete sequence">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /></svg>
            </button>
          </div>
        </RowStacked>
      </Group>

      <Group title={`Steps · ${steps.length}`}>
        {steps.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12px] text-fg-4">No steps yet. Add one below.</div>
        ) : items.map((s, i) => {
          const st = showRun ? run.statuses[i] : undefined;
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
              <Row label={stepSummary(s)} desc={`Step ${i + 1}`}>
                <div className="flex items-center gap-1">
                  {st && <span className={`w-2 h-2 rounded-full mr-1 ${STATUS_DOT[st]}`} />}
                  <button onClick={() => move(i, -1)} disabled={i === 0 || run.running} aria-label="Up" className="le-tap grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-fg hover:bg-line disabled:opacity-30">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === steps.length - 1 || run.running} aria-label="Down" className="le-tap grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-fg hover:bg-line disabled:opacity-30">↓</button>
                  <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} disabled={run.running} aria-label="Remove" className="le-tap grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-fg hover:bg-line disabled:opacity-30">×</button>
                </div>
              </Row>
            </motion.div>
          );
        })}
        {!run.running && <AddStep onAdd={(s) => setSteps([...steps, s])} recipients={online.filter((k) => k.name !== active?.name).map((k) => k.name)} shortcuts={shortcuts} />}
      </Group>

      <AnimatePresence mode="wait" initial={false}>
        {run.running && showRun ? (
          <motion.button key="stop" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }} onClick={stopSequence} className="le-tap w-full px-3 py-2.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">
            Stop · Step {run.stepIndex + 1} / {steps.length}
          </motion.button>
        ) : (
          <motion.button key="run" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }} onClick={start} disabled={steps.length === 0 || run.running} className="le-tap w-full px-3 py-2.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
            {run.running ? 'A Sequence Is Running…' : `Run "${store.current}"`}
          </motion.button>
        )}
      </AnimatePresence>
      {showRun && run.error && <p className="mt-2 text-[11px] text-red-300">{run.error}</p>}
      <p className="mt-2 text-[10px] text-fg-4 leading-snug">Steps: Use, Buy, Trade, Open Shop, Move, and Wait. Trades between your own characters auto-accept.</p>
    </div>
  );
}
