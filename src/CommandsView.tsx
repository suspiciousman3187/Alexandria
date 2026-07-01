import { useEffect, useId, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useKnownCharacters, appDataPath, inTauri } from './bridge';
import { Group, Row, RowStacked, Select, CharacterSelect, SearchInput } from './ui';
import { useCommands, setAliases, runAxCommand, VERB_USAGES, VERB_FORMS, type Alias, type Param } from './commands';
import { useSticky, useStickyChar } from './sticky';
import { useAnon } from './anonymize';

const BAG_OPTS: [string, string][] = [
  ['inventory', 'Inventory'], ['satchel', 'Satchel'], ['sack', 'Sack'], ['case', 'Case'],
  ['safe', 'Safe'], ['safe2', 'Safe 2'], ['storage', 'Storage'], ['locker', 'Locker'], ['wardrobe', 'Wardrobe'],
];

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

function compose(verb: string, params: Param[], vals: string[]): string {
  const parts = [verb];
  params.forEach((p, i) => {
    const v = (vals[i] ?? '').trim();
    if (!v) return;
    if (verb === 'consolidate' && p.kind === 'player' && v === '$me') return;
    parts.push(p.kind === 'item' || p.kind === 'seq' || p.kind === 'query' ? quote(v) : v);
  });
  return parts.join(' ');
}

function defFor(verb: string, p: Param, players: string[]): string {
  if (p.kind === 'op') return 'add';
  if (p.kind === 'bag') return p.label === 'To' ? 'inventory' : 'satchel';
  if (p.kind === 'player') return verb === 'consolidate' ? '$me' : (players[0] ?? '$target');
  if (p.kind === 'count' || p.kind === 'threshold') return '';
  return '';
}

function Builder({ players, items, seqs, onAdd }: { players: string[]; items: string[]; seqs: string[]; onAdd: (line: string) => void }) {
  const dlId = useId();
  const [vi, setVi] = useSticky('cmd.vi', 0);
  const form = VERB_FORMS[vi];
  const [vals, setVals] = useState<string[]>([]);
  const [chip, setChip] = useState('');

  useEffect(() => { setVals(form.params.map((p) => defFor(form.verb, p, players))); setChip(''); }, [vi]);

  const set = (i: number, v: string) => setVals((cur) => { const n = [...cur]; n[i] = v; return n; });
  const line = compose(form.verb, form.params, vals);

  const playerOpts = ['$me', '$target', ...players];
  const chips = (i: number) => (vals[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const addChip = (i: number) => { const c = chip.trim(); if (!c) return; const cur = chips(i); if (!cur.some((x) => x.toLowerCase() === c.toLowerCase())) set(i, [...cur, c].join(', ')); setChip(''); };
  const rmChip = (i: number, c: string) => set(i, chips(i).filter((x) => x !== c).join(', '));

  return (
    <div className="flex flex-col gap-2.5">
      <datalist id={dlId}>{items.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fg-4 w-16 shrink-0">Function</span>
        <div className="flex-1 min-w-0"><Select value={String(vi)} onChange={(v) => setVi(Number(v))} options={VERB_FORMS.map((_, i) => String(i))} renderOption={(v) => VERB_FORMS[Number(v)].verb} full /></div>
      </div>

      {form.params.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[11px] text-fg-4 w-16 shrink-0">{p.label}{p.optional ? '' : ''}</span>
          <div className="flex-1 min-w-0">
            {p.kind === 'item' && <input list={dlId} value={vals[i] ?? ''} onChange={(e) => set(i, e.target.value)} placeholder="Item name or $1" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />}
            {p.kind === 'query' && <SearchInput list={dlId} value={vals[i] ?? ''} onChange={(v) => set(i, v)} wrap="" placeholder="Search all characters" className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />}
            {p.kind === 'seq' && (seqs.length ? <Select value={vals[i] ?? ''} onChange={(v) => set(i, v)} options={seqs} full /> : <input value={vals[i] ?? ''} onChange={(e) => set(i, e.target.value)} placeholder="Sequence name" className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />)}
            {p.kind === 'bag' && <Select value={vals[i] ?? 'satchel'} onChange={(v) => set(i, v)} options={BAG_OPTS.map((b) => b[0])} renderOption={(v) => BAG_OPTS.find((b) => b[0] === v)?.[1] ?? v} full />}
            {p.kind === 'op' && <Select value={vals[i] ?? 'add'} onChange={(v) => set(i, v)} options={['add', 'remove']} renderOption={(v) => (v === 'add' ? 'Add' : 'Remove')} full />}
            {p.kind === 'player' && <Select value={vals[i] ?? playerOpts[0]} onChange={(v) => set(i, v)} options={playerOpts} renderOption={(v) => (v === '$me' ? '$me (this character)' : v === '$target' ? '$target' : v)} full />}
            {(p.kind === 'count' || p.kind === 'threshold') && <input inputMode="numeric" value={vals[i] ?? ''} onChange={(e) => set(i, e.target.value.replace(/\D/g, ''))} placeholder={p.optional ? 'optional' : '1'} className="w-24 bg-field border border-line rounded-md px-2 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />}
            {p.kind === 'items' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input list={dlId} value={chip} onChange={(e) => setChip(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(i); } }} placeholder="Add item…" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
                  <button onClick={() => addChip(i)} disabled={!chip.trim()} className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Add</button>
                </div>
                {chips(i).length > 0 && <div className="flex flex-wrap gap-1.5">{chips(i).map((c) => <span key={c} className="inline-flex items-center gap-1 rounded bg-field px-2 py-0.5 text-[11px] text-fg-2">{c}<button onClick={() => rmChip(i, c)} className="text-fg-4 hover:text-red-400">×</button></span>)}</div>}
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-fg-3 bg-field/60 border border-line rounded-md px-2.5 py-1.5">{line}</code>
        <button onClick={() => onAdd(line)} className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Add Line</button>
      </div>
    </div>
  );
}

export default function CommandsView() {
  const anon = useAnon();
  const aliases = useCommands();
  const known = useKnownCharacters();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);

  const [name, setName] = useSticky('cmd.name', '');
  const [script, setScript] = useSticky('cmd.script', '');
  const [refOpen, setRefOpen] = useState(false);
  const [testChar, setTestChar] = useStickyChar();
  const [testLine, setTestLine] = useSticky('cmd.test', '');
  const [ran, setRan] = useState<string | null>(null);
  const [seqNames, setSeqNames] = useState<string[]>([]);

  const itemNames = useMemo(() => {
    const set = new Set<string>();
    for (const k of known) for (const b of k.inv ?? []) for (const it of b.items) set.add(it.n);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [known]);

  useEffect(() => {
    if (!inTauri) return;
    void (async () => {
      try {
        const s = JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('sequences.json') }));
        if (s?.sequences) setSeqNames(Object.keys(s.sequences));
      } catch { /* none */ }
    })();
  }, []);

  const active = online.find((k) => k.name === testChar) ?? online[0];
  const editing = aliases.some((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  const addLine = (line: string) => setScript((s) => (s.trim() ? `${s.replace(/\s+$/, '')}\n${line}` : line));

  const saveAlias = () => {
    const n = name.trim();
    if (!n || !script.trim()) return;
    const rest = aliases.filter((a) => a.name.toLowerCase() !== n.toLowerCase());
    setAliases([...rest, { name: n, script: script.trim() }].sort((a, b) => a.name.localeCompare(b.name)));
    setName(''); setScript('');
  };
  const edit = (a: Alias) => { setName(a.name); setScript(a.script); };
  const del = (n: string) => { setAliases(aliases.filter((a) => a.name !== n)); if (n.toLowerCase() === name.trim().toLowerCase()) { setName(''); setScript(''); } };

  const runTest = () => {
    const toks = tokenize(testLine.trim());
    if (!toks.length || !active?.conn) return;
    void runAxCommand(active.conn, active.name, undefined, toks);
    setRan(`Ran on ${anon(active.name)} · output shows in-game`);
    window.setTimeout(() => setRan(null), 4000);
  };

  return (
    <div className="max-w-2xl mx-auto p-5">
      <Group title="Build a Command">
        <div className="px-3.5 py-3">
          <Builder players={online.map((k) => k.name)} items={itemNames} seqs={seqNames} onAdd={addLine} />
        </div>
      </Group>

      <Group>
        <RowStacked label="" desc="Each line is one action. Use $1 $2 for arguments, $me for the typing character, $target for the current target. Edit freely.">
          <div className="flex flex-col gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alias name (e.g. lamprun)" className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
            <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder={'Build lines above, or type here:\nseq "Lamp Run"\nconsolidate $me Grape Daifuku'} rows={3} className="bg-field border border-line rounded-md px-3 py-2 text-xs font-mono text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 resize-y" />
            <button onClick={saveAlias} disabled={!name.trim() || !script.trim()} className="le-tap self-start px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">{editing ? 'Update' : 'Save'} Alias</button>
          </div>
        </RowStacked>
      </Group>

      <Group title={`Aliases · ${aliases.length}`}>
        {aliases.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12px] text-fg-4">No aliases yet. Build one above.</div>
        ) : aliases.map((a) => (
          <Row key={a.name} label={a.name} desc={a.script.replace(/\s*\n\s*/g, ' · ')}>
            <div className="flex items-center gap-1">
              <button onClick={() => edit(a)} className="le-tap px-2 py-1 text-[11px] rounded text-fg-3 hover:text-fg hover:bg-line transition-colors">Edit</button>
              <button onClick={() => del(a.name)} aria-label="Delete" className="le-tap grid place-items-center w-7 h-7 rounded text-fg-4 hover:text-red-400 hover:bg-line transition-colors">×</button>
            </div>
          </Row>
        ))}
      </Group>

      <Group>
        <RowStacked label="Test" desc={active ? `Run a command line as ${anon(active.name)} (output prints in-game)` : 'No connected character'}>
          <div className="flex flex-col gap-2">
            {online.length > 1 && <div className="w-52"><CharacterSelect value={active?.name ?? ''} onChange={setTestChar} chars={online} /></div>}
            <div className="flex items-center gap-2">
              <input value={testLine} onChange={(e) => setTestLine(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runTest(); }} placeholder="e.g. consolidate Grape Daifuku" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs font-mono text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50" />
              <button onClick={runTest} disabled={!testLine.trim() || !active} className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors">Run</button>
            </div>
            {ran && <span className="text-[11px] text-emerald-300">{ran}</span>}
          </div>
        </RowStacked>
      </Group>

      <Group title="Verb Reference">
        <button onClick={() => setRefOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2 text-left hover:bg-field/40 transition-colors">
          <svg className={`w-3.5 h-3.5 shrink-0 text-fg-4 transition-transform ${refOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          <span className="text-[12px] text-fg-3">{VERB_USAGES.length} built-in verbs</span>
        </button>
        {refOpen && (
          <div className="px-3.5 pb-3 flex flex-col gap-1">
            {VERB_USAGES.map((u) => <code key={u} className="text-[11px] font-mono text-fg-3">{u}</code>)}
            <code className="text-[11px] font-mono text-fg-4 mt-1">help · list</code>
          </div>
        )}
      </Group>

      <p className="mt-2 text-[10px] text-fg-4 leading-snug">In-game: <span className="font-mono text-fg-3">//ax &lt;alias-or-verb&gt;</span> (or //alex). Results print to your chat log.</p>
    </div>
  );
}
