import { useSyncExternalStore } from 'react';
import { sendBoxCommand, nextSeq, awaitSeqAck, shopBuy, tradeTo, npcSelect, getKnownCharacters, type KnownChar } from './bridge';

export type Step =
  | { type: 'use'; item: string; count: number }
  | { type: 'buy'; item: string; count: number }
  | { type: 'trade'; item: string; count: number; to: string }
  | { type: 'npcopen'; npc: string; option: number; label: string }
  | { type: 'move'; item: string; from: number; to: number; count: number }
  | { type: 'wait'; seconds: number };

export type Sequence = { name: string; steps: Step[] };

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail';
export type SeqRunState = {
  running: boolean;
  seqName: string | null;
  charName: string | null;
  stepIndex: number;
  statuses: StepStatus[];
  error: string | null;
};

let state: SeqRunState = { running: false, seqName: null, charName: null, stepIndex: -1, statuses: [], error: null };
const listeners = new Set<() => void>();
function patch(p: Partial<SeqRunState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }

export function useSeqRun(): SeqRunState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
}

let stopFlag = false;
export function stopSequence() { stopFlag = true; }

function resolveItemId(char: KnownChar, name: string): number | null {
  const lc = name.trim().toLowerCase();
  for (const b of char.inv ?? []) for (const it of b.items) if (it.n.toLowerCase() === lc) return it.id;
  for (const b of char.inv ?? []) for (const it of b.items) if (it.n.toLowerCase().includes(lc)) return it.id;
  return null;
}

function freshChar(char: KnownChar): KnownChar {
  return getKnownCharacters().find((k) => (char.conn != null && k.conn === char.conn) || k.name === char.name) ?? char;
}

function countItem(char: KnownChar, id: number): number {
  let n = 0;
  for (const b of char.inv ?? []) for (const it of b.items) if (it.id === id) n += it.c;
  return n;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

async function pollUntil(pred: () => boolean, timeoutMs: number, interval = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopFlag || pred()) return pred();
    await sleep(interval);
  }
  return pred();
}

export async function runStep(char: KnownChar, step: Step): Promise<void> {
  if (step.type === 'wait') { await sleep(Math.max(0, step.seconds) * 1000); return; }
  if (char.conn == null) throw new Error('character offline');
  if (step.type === 'npcopen') {
    npcSelect(char.conn, step.option);
    const ok = await pollUntil(() => (freshChar(char).shop?.items?.length ?? 0) > 0, 8000);
    if (stopFlag) return;
    if (!ok) throw new Error(`shop didn't open at ${step.npc}`);
    return;
  }
  if (step.type === 'trade') {
    const target = getKnownCharacters().find((k) => k.name === step.to && k.online);
    if (!target) throw new Error(`recipient not connected: ${step.to}`);
    const id = resolveItemId(freshChar(char), step.item);
    if (!id) throw new Error(`item not found: ${step.item}`);
    const want = Math.max(1, step.count);
    const before = countItem(freshChar(target), id);
    tradeTo(char.conn, step.to, [{ id, count: want }]);
    const ok = await pollUntil(() => countItem(freshChar(target), id) >= before + want, 15000);
    if (stopFlag) return;
    if (!ok) throw new Error(`trade not confirmed: ${countItem(freshChar(target), id) - before}/${want} to ${step.to}`);
    return;
  }
  if (step.type === 'buy') {
    const cur = freshChar(char);
    const shopItems = cur.shop?.items ?? [];
    if (shopItems.length === 0) throw new Error('no shop open');
    const lc = step.item.trim().toLowerCase();
    const si = shopItems.find((s) => s.n.toLowerCase() === lc) ?? shopItems.find((s) => s.n.toLowerCase().includes(lc));
    if (!si) throw new Error(`not for sale here: ${step.item}`);
    const want = Math.max(1, step.count);
    const before = countItem(cur, si.id);
    shopBuy(char.conn, si.idx, want);
    const ok = await pollUntil(() => countItem(freshChar(char), si.id) >= before + want, 8000);
    if (stopFlag) return;
    if (!ok) throw new Error(`bought ${countItem(freshChar(char), si.id) - before}/${want} ${si.n}`);
    return;
  }
  const id = resolveItemId(char, step.item);
  if (!id) throw new Error(`item not found: ${step.item}`);
  if (step.type === 'use') {
    const n = Math.max(1, step.count);
    for (let k = 0; k < n; k++) {
      if (stopFlag) return;
      const seq = nextSeq();
      sendBoxCommand(char.conn, JSON.stringify({ cmd: 'use', id, all: false, seq }));
      const ack = await awaitSeqAck(seq, 6000);
      if (!ack.ok) throw new Error(`use failed: ${ack.reason ?? 'unknown'}`);
    }
    return;
  }
  const seq = nextSeq();
  sendBoxCommand(char.conn, JSON.stringify({ cmd: 'move', id, from: step.from, to: step.to, count: Math.max(1, step.count), seq }));
  const ack = await awaitSeqAck(seq, 8000);
  if (!ack.ok) throw new Error(`move failed: ${ack.reason ?? 'unknown'}`);
}

export async function runSequence(char: KnownChar, seq: Sequence): Promise<void> {
  if (state.running) return;
  stopFlag = false;
  patch({ running: true, seqName: seq.name, charName: char.name, stepIndex: -1, statuses: seq.steps.map(() => 'pending'), error: null });
  for (let i = 0; i < seq.steps.length; i++) {
    if (stopFlag) break;
    const s1 = [...state.statuses]; s1[i] = 'running'; patch({ stepIndex: i, statuses: s1 });
    try {
      await runStep(char, seq.steps[i]);
      const s2 = [...state.statuses]; s2[i] = 'ok'; patch({ statuses: s2 });
    } catch (e) {
      const s3 = [...state.statuses]; s3[i] = 'fail'; patch({ statuses: s3, error: e instanceof Error ? e.message : String(e) });
      break;
    }
  }
  patch({ running: false, stepIndex: -1 });
}
