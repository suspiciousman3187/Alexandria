import { canonSlot, SLOT_ALIASES, type SlotKey } from './slotLayout';

export type GearEntry =
  | { kind: 'item'; name: string; augments?: string[]; bag?: string; priority?: number }
  | { kind: 'dynamic'; raw: string };

export type ParsedSet = {
  path: string[];
  key: string;
  slots: Partial<Record<SlotKey, GearEntry>>;
  combineBase?: string;
  nonSlotKeys: number;
  valueSpan: [number, number];
};

export type ParsedGearsets = { sets: ParsedSet[]; byKey: Map<string, ParsedSet> };

type Node =
  | { kind: 'string'; value: string }
  | { kind: 'scalar'; raw: string }
  | { kind: 'dynamic'; raw: string }
  | { kind: 'table'; entries: TEntry[] }
  | { kind: 'combine'; base: string; overrides: Node };
type TEntry = { key: string | null; value: Node; span: [number, number] };

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);

function longBracketLevel(src: string, i: number): { level: number; bodyStart: number } | null {
  if (src[i] !== '[') return null;
  let j = i + 1, level = 0;
  while (src[j] === '=') { level++; j++; }
  if (src[j] === '[') return { level, bodyStart: j + 1 };
  return null;
}
function skipLongBracket(src: string, i: number): number {
  const lb = longBracketLevel(src, i);
  if (!lb) return i + 1;
  const close = ']' + '='.repeat(lb.level) + ']';
  const idx = src.indexOf(close, lb.bodyStart);
  return idx < 0 ? src.length : idx + close.length;
}
function skipQuoted(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === q) return j + 1;
    j++;
  }
  return src.length;
}
function readQuoted(src: string, i: number): { value: string; end: number } {
  const q = src[i];
  let j = i + 1, out = '';
  while (j < src.length) {
    if (src[j] === '\\') { out += src[j + 1] ?? ''; j += 2; continue; }
    if (src[j] === q) return { value: out, end: j + 1 };
    out += src[j]; j++;
  }
  return { value: out, end: src.length };
}
function skipTrivia(src: string, i: number): number {
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '[') {
        const lb = longBracketLevel(src, i + 2);
        if (lb) { i = skipLongBracket(src, i + 2); continue; }
      }
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    break;
  }
  return i;
}
function readIdent(src: string, i: number): string {
  let j = i;
  while (j < src.length && isIdent(src[j])) j++;
  return src.slice(i, j);
}
function matchBrace(src: string, i: number): number {
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") { j = skipQuoted(src, j); continue; }
    if (c === '-' && src[j + 1] === '-') { j = skipTrivia(src, j); continue; }
    if (c === '[') { const lb = longBracketLevel(src, j); if (lb) { j = skipLongBracket(src, j); continue; } }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return src.length;
}
function readRawExprEnd(src: string, i: number): number {
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") { j = skipQuoted(src, j); continue; }
    if (c === '-' && src[j + 1] === '-') break;
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { if (depth === 0) break; depth--; }
    else if ((c === ',' || c === '\n' || c === ';') && depth === 0) break;
    j++;
  }
  return j;
}
function splitEntries(src: string, start: number, end: number): { start: number; end: number }[] {
  const entries: { start: number; end: number }[] = [];
  let i = skipTrivia(src, start);
  while (i < end) {
    const eStart = i;
    let depth = 0, j = i;
    while (j < end) {
      const c = src[j];
      if (c === '"' || c === "'") { j = skipQuoted(src, j); continue; }
      if (c === '-' && src[j + 1] === '-') { j = skipTrivia(src, j); continue; }
      if (c === '{' || c === '(' || c === '[') { if (c === '[') { const lb = longBracketLevel(src, j); if (lb) { j = skipLongBracket(src, j); continue; } } depth++; j++; continue; }
      if (c === '}' || c === ')' || c === ']') { depth--; j++; continue; }
      if (c === ',' && depth === 0) break;
      j++;
    }
    const raw = src.slice(eStart, j).trim();
    if (raw) entries.push({ start: eStart, end: j });
    i = skipTrivia(src, j + 1);
  }
  return entries;
}
function readValueBracketKey(src: string, i: number): { key: string; end: number } | null {
  let j = skipTrivia(src, i + 1);
  if (src[j] === '"' || src[j] === "'") {
    const s = readQuoted(src, j);
    const k = skipTrivia(src, s.end);
    if (src[k] === ']') return { key: s.value, end: k + 1 };
  }
  const raw = readRawExprEnd(src, j);
  const k = skipTrivia(src, raw);
  if (src[k] === ']') return { key: src.slice(j, raw).trim(), end: k + 1 };
  return null;
}
function readValue(src: string, j: number): { node: Node; end: number } {
  j = skipTrivia(src, j);
  const c = src[j];
  if (c === '{') { const end = matchBrace(src, j); return { node: parseTable(src, j, end), end }; }
  if (c === '"' || c === "'") { const s = readQuoted(src, j); return { node: { kind: 'string', value: s.value }, end: s.end }; }
  if (isIdentStart(c)) {
    const id = readIdent(src, j);
    if (id === 'set_combine') return readSetCombine(src, j + id.length);
    if (id === 'true' || id === 'false') return { node: { kind: 'scalar', raw: id }, end: j + id.length };
  }
  if (/[-0-9]/.test(c)) { const end = readRawExprEnd(src, j); return { node: { kind: 'scalar', raw: src.slice(j, end).trim() }, end }; }
  const end = readRawExprEnd(src, j);
  return { node: { kind: 'dynamic', raw: src.slice(j, end).trim() }, end };
}
function readSetCombine(src: string, afterName: number): { node: Node; end: number } {
  let j = skipTrivia(src, afterName);
  if (src[j] !== '(') { const end = readRawExprEnd(src, j); return { node: { kind: 'dynamic', raw: src.slice(afterName, end).trim() }, end }; }
  j = skipTrivia(src, j + 1);
  let depth = 0, k = j;
  while (k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'") { k = skipQuoted(src, k); continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) break;
    k++;
  }
  const base = src.slice(j, k).trim();
  let overrides: Node = { kind: 'table', entries: [] };
  let m = skipTrivia(src, k + 1);
  if (src[m] === '{') { const oe = matchBrace(src, m); overrides = parseTable(src, m, oe); m = oe; }
  let d2 = 1, p = m;
  while (p < src.length && d2 > 0) {
    const c = src[p];
    if (c === '"' || c === "'") { p = skipQuoted(src, p); continue; }
    if (c === '(') d2++;
    else if (c === ')') d2--;
    p++;
  }
  return { node: { kind: 'combine', base, overrides }, end: p };
}
function parseTable(src: string, open: number, close: number): Node {
  const raws = splitEntries(src, open + 1, close - 1);
  const entries: TEntry[] = [];
  for (const e of raws) {
    let i = skipTrivia(src, e.start);
    let key: string | null = null;
    if (src[i] === '[') {
      const bk = readValueBracketKey(src, i);
      if (bk) { key = bk.key; i = skipTrivia(src, bk.end); }
    } else if (isIdentStart(src[i])) {
      const id = readIdent(src, i);
      const after = skipTrivia(src, i + id.length);
      if (src[after] === '=' && src[after + 1] !== '=') { key = id; i = after; }
      else { i = e.start; }
    }
    let valueNode: Node;
    if (key !== null) { const eq = skipTrivia(src, i + 1); valueNode = readValue(src, eq).node; }
    else { valueNode = readValue(src, e.start).node; }
    entries.push({ key, value: valueNode, span: [e.start, e.end] });
  }
  return { kind: 'table', entries };
}

function toGear(node: Node): GearEntry | null {
  if (node.kind === 'string') return { kind: 'item', name: node.value };
  if (node.kind === 'dynamic') return { kind: 'dynamic', raw: node.raw };
  if (node.kind === 'combine') return { kind: 'dynamic', raw: `set_combine(${node.base}, ...)` };
  if (node.kind === 'scalar') return { kind: 'dynamic', raw: node.raw };
  if (node.kind === 'table') {
    const g: { name?: string; augments?: string[]; bag?: string; priority?: number } = {};
    for (const en of node.entries) {
      const k = (en.key || '').toLowerCase();
      if (k === 'name' && en.value.kind === 'string') g.name = en.value.value;
      else if (k === 'augments' && en.value.kind === 'table') g.augments = en.value.entries.filter((x) => x.value.kind === 'string').map((x) => (x.value as { value: string }).value);
      else if (k === 'augment' && en.value.kind === 'string') g.augments = [en.value.value];
      else if (k === 'bag' && en.value.kind === 'string') g.bag = en.value.value;
      else if (k === 'priority' && en.value.kind === 'scalar') g.priority = Number(en.value.raw);
    }
    if (g.name) return { kind: 'item', name: g.name, augments: g.augments, bag: g.bag, priority: g.priority };
    return { kind: 'dynamic', raw: 'table' };
  }
  return null;
}
function tableToSlots(node: Node): { slots: Partial<Record<SlotKey, GearEntry>>; nonSlotKeys: number } {
  const slots: Partial<Record<SlotKey, GearEntry>> = {};
  let nonSlotKeys = 0;
  if (node.kind !== 'table') return { slots, nonSlotKeys };
  for (const en of node.entries) {
    if (!en.key) continue;
    if (SLOT_ALIASES.has(en.key.toLowerCase())) {
      const sk = canonSlot(en.key);
      const g = toGear(en.value);
      if (sk && g) slots[sk] = g;
    } else nonSlotKeys++;
  }
  return { slots, nonSlotKeys };
}

export type ResolvedSlot = { entry: GearEntry; inherited: boolean; source?: string };

// A set_combine base reference like `sets.OffenseMode.TP` or `sets.WS['Savage Blade']`
// mapped to the same key format the parser produces (dot-joined path segments).
function refToKey(ref: string): string | null {
  const s = ref.trim();
  if (!s.startsWith('sets')) return null;
  let i = 4;
  const path: string[] = [];
  while (i < s.length) {
    if (s[i] === '.') {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      if (j === i + 1) break;
      path.push(s.slice(i + 1, j));
      i = j;
    } else if (s[i] === '[') {
      const m = /^\[\s*(['"])([\s\S]*?)\1\s*\]/.exec(s.slice(i));
      if (!m) break;
      path.push(m[2]);
      i += m[0].length;
    } else break;
  }
  return path.length ? path.join('.') : null;
}

// Flatten a set's set_combine chain (base first, own overrides last) into the effective
// per-slot gear, tagging which slots were inherited from a base set.
export function resolveSet(set: ParsedSet, byKey: Map<string, ParsedSet>): Partial<Record<SlotKey, ResolvedSlot>> {
  const chain: ParsedSet[] = [];
  const seen = new Set<string>();
  let cur: ParsedSet | undefined = set;
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key);
    chain.push(cur);
    const bk: string | null = cur.combineBase ? refToKey(cur.combineBase) : null;
    cur = bk ? byKey.get(bk) : undefined;
  }
  const out: Partial<Record<SlotKey, ResolvedSlot>> = {};
  for (let idx = chain.length - 1; idx >= 0; idx--) {
    const s = chain[idx];
    const self = idx === 0;
    for (const slot of Object.keys(s.slots) as SlotKey[]) {
      out[slot] = { entry: s.slots[slot]!, inherited: !self, source: self ? undefined : s.key };
    }
  }
  return out;
}

export function parseGearsetFile(src: string): ParsedGearsets {
  const sets: ParsedSet[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { i = skipTrivia(src, i); continue; }
    if (c === '"' || c === "'") { i = skipQuoted(src, i); continue; }
    if (c === '[') { const lb = longBracketLevel(src, i); if (lb) { i = skipLongBracket(src, i); continue; } }
    if (isIdentStart(c)) {
      const id = readIdent(src, i);
      const idEnd = i + id.length;
      if (id === 'sets') {
        const path: string[] = [];
        let p = idEnd;
        for (;;) {
          if (src[p] === '.') { const seg = readIdent(src, p + 1); if (!seg) break; path.push(seg); p += 1 + seg.length; }
          else if (src[p] === '[') { const bk = readValueBracketKey(src, p); if (!bk) break; path.push(bk.key); p = bk.end; }
          else break;
        }
        const q = skipTrivia(src, p);
        if (path.length && src[q] === '=' && src[q + 1] !== '=') {
          const v = readValue(src, q + 1);
          if (v.node.kind === 'table') {
            const t = tableToSlots(v.node);
            sets.push({ path, key: path.join('.'), slots: t.slots, nonSlotKeys: t.nonSlotKeys, valueSpan: [q + 1, v.end] });
          } else if (v.node.kind === 'combine') {
            const t = tableToSlots(v.node.overrides);
            sets.push({ path, key: path.join('.'), slots: t.slots, combineBase: v.node.base, nonSlotKeys: t.nonSlotKeys, valueSpan: [q + 1, v.end] });
          }
          i = v.end;
          continue;
        }
        i = idEnd;
        continue;
      }
      i = idEnd;
      continue;
    }
    i++;
  }
  const byKey = new Map<string, ParsedSet>();
  for (const s of sets) byKey.set(s.key, s);
  return { sets, byKey };
}
