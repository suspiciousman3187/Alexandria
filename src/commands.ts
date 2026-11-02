import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  appDataPath, inTauri, getKnownCharacters, axEcho, onAxCommand, stackBag,
  ahMenu, ahBuy, ahSell, ahClearSold, fetchMarket, bzApply, lotAll, passAll, passDone, dropOne, useItem,
  broadcastDropRules, runOrganize, normalizeOrganizeRules, storeRequest, NOMAD_BAGS, inNomadZone,
  type KnownChar, type OrganizeRules,
} from './bridge';
import { resolveItemName, itemNameMatches, itemFullName } from './itemNames';
import { openUseAll } from './useAllHost';
import { isPoolOverlay, isGearsetWindow } from './overlayWindow';
import { addRuleToChars, removeRuleFromChar } from './poolRules';
import { findEntriesFor, getFindCache, type FindEntry } from './findCache';
import { MOG_ONLY_BAGS } from './bagConstants';
import { runStep, runSequence, type Step } from './seq';
import { runConsolidate } from './consolidate';
import { getDrop, setDrop, dropItemEverywhere } from './drop';
import { getSettings } from './settings';
import { addWatchItem, removeWatchItem } from './watch';

export type Alias = { name: string; script: string };
type Store = { aliases: Alias[] };

let store: Store = { aliases: [] };
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('commands.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p?.aliases)) { store = { aliases: p.aliases }; notify(); }
  } catch { /* none yet */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('commands.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function getAliases(): Alias[] { return store.aliases; }
export function setAliases(next: Alias[]) { store = { aliases: next }; notify(); void save(); }
export function useCommands(): Alias[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store.aliases, () => store.aliases);
}

function fresh(name: string): KnownChar | undefined {
  return getKnownCharacters().find((k) => k.name.toLowerCase() === name.toLowerCase());
}
function onlineFleet(): KnownChar[] {
  return getKnownCharacters().filter((k) => k.online && k.conn != null);
}
const unquote = (s: string): string => s.trim().replace(/^['"]+/, '').replace(/['"]+$/, '').trim();

function searchInv(c: KnownChar | undefined, lc: string): { id: number; n: string } | null {
  // Match against BOTH the shown (abbreviated) name and the full name -- FFXI truncates long item names,
  // so "Ra'Kaznar Starstone" only matches the stored "Ra'Ka. Starstone" via the full name.
  const items: { id: number; n: string; ln: string; fl?: string }[] = [];
  for (const b of c?.inv ?? []) for (const it of b.items) items.push({ id: it.id, n: it.n, ln: it.n.toLowerCase(), fl: itemFullName(it.id) });
  // Exact name (shown or full) always wins, in both modes.
  for (const it of items) if (it.ln === lc || it.fl === lc) return { id: it.id, n: it.n };
  // Strict (the default, matching original Itemizer): exact only. Loose adds substring + multi-token matching.
  // Explicit wildcards (*/?) are handled separately via globToRe and stay available regardless of this setting.
  if (getSettings().itemizerMatch === 'strict') return null;
  for (const it of items) if (it.ln.includes(lc) || (it.fl != null && it.fl.includes(lc))) return { id: it.id, n: it.n };
  const toks = lc.split(/[^a-z0-9]+/).filter(Boolean);
  if (toks.length > 1) for (const it of items) if (toks.every((t) => it.ln.includes(t) || (it.fl != null && it.fl.includes(t)))) return { id: it.id, n: it.n };
  return null;
}
function globToRe(glob: string): RegExp | null {
  if (!/[*?]/.test(glob)) return null;
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}
function matchInvAll(c: KnownChar | undefined, re: RegExp): { id: number; n: string }[] {
  const seen = new Map<number, string>();
  for (const b of c?.inv ?? []) for (const it of b.items) { const fl = itemFullName(it.id); if (re.test(it.n) || (fl != null && re.test(fl))) seen.set(it.id, it.n); }
  return [...seen].map(([id, n]) => ({ id, n }));
}
function resolveItem(char: KnownChar | undefined, name: string): { id: number; n: string } | null {
  const lc = unquote(name).toLowerCase();
  if (!lc) return null;
  const own = searchInv(char, lc);
  if (own) return own;
  for (const c of onlineFleet()) { const r = searchInv(c, lc); if (r) return r; }
  return null;
}

const BAGS: Record<string, number> = {
  inventory: 0, inv: 0, satchel: 5, sack: 6, case: 7, safe: 1, safe2: 9, storage: 2, locker: 4,
  wardrobe: 8, wardrobe2: 10, wardrobe3: 11, wardrobe4: 12, wardrobe5: 13, wardrobe6: 14, wardrobe7: 15, wardrobe8: 16,
};
const bagId = (s: string): number | null => {
  const k = s.trim().toLowerCase().replace(/\s+/g, '');
  if (k in BAGS) return BAGS[k];
  return /^\d+$/.test(k) ? Number(k) : null;
};
const ALL = 999;

const MOG_BAGS = MOG_ONLY_BAGS;
const bagReach = (char: KnownChar | undefined, bag: number): boolean =>
  !MOG_BAGS.has(bag) || !!char?.mog || (NOMAD_BAGS.has(bag) && inNomadZone(char?.zone));

function bagsHolding(char: KnownChar | undefined, id: number, onlyBag?: number): { bag: number; count: number }[] {
  const out: { bag: number; count: number }[] = [];
  for (const b of char?.inv ?? []) {
    if (onlyBag != null && b.id !== onlyBag) continue;
    let c = 0;
    for (const it of b.items) if (it.id === id) c += it.c;
    if (c > 0) out.push({ bag: b.id, count: c });
  }
  return out;
}

// How many of an item the character's main inventory (bag 0) can still hold: free slots x stack
// size, plus room left in existing partial stacks. Lets "get all" pull as much as fits instead of a
// fixed cap.
// Room for an item in a specific bag: free slots x stack size, plus space left in existing partial stacks.
function bagCapacityFor(char: KnownChar | undefined, id: number, bagId: number): number {
  const bag = char?.inv?.find((b) => b.id === bagId);
  if (!bag) return 0;
  let stack = 1;
  for (const b of char?.inv ?? []) { const it = b.items.find((x) => x.id === id && x.ms); if (it?.ms) { stack = it.ms; break; } }
  let partial = 0;
  for (const it of bag.items) if (it.id === id) partial += Math.max(0, stack - it.c);
  return Math.max(0, bag.max - bag.used) * stack + partial;
}
function invCapacityFor(char: KnownChar | undefined, id: number): number {
  const inv = char?.inv?.find((b) => b.id === 0);
  if (!inv) return ALL;
  let stack = 1;
  for (const b of char?.inv ?? []) { const it = b.items.find((x) => x.id === id && x.ms); if (it?.ms) { stack = it.ms; break; } }
  let partial = 0;
  for (const it of inv.items) if (it.id === id) partial += Math.max(0, stack - it.c);
  return Math.max(0, inv.max - inv.used) * stack + partial;
}

// ── Gearsets: move a piece out of an un-equippable bag into one it can be equipped from ────────────────
// Equippable bags = main inventory + the 8 wardrobes (GearSwap only equips out of these).
export const USABLE_GEAR_BAGS = [0, 8, 10, 11, 12, 13, 14, 15, 16];
// Whether a bag is reachable right now (mog storage needs a Mog House / Nomad Moogle).
export function canReachBag(char: KnownChar | undefined, bag: number): boolean { return bagReach(char, bag); }
// Usable (equippable) bags that exist for this character, each with its free slot count, for the move picker.
export function usableGearBags(char: KnownChar | undefined): { id: number; free: number }[] {
  const out: { id: number; free: number }[] = [];
  for (const id of USABLE_GEAR_BAGS) {
    const b = char?.inv?.find((x) => x.id === id);
    if (b) out.push({ id, free: Math.max(0, b.max - b.used) });
  }
  return out;
}
// Move one copy of a gear piece from its current bag into a usable bag. Throws if the source isn't reachable.
export async function moveGearToBag(char: KnownChar | undefined, item: { id: number; n: string }, fromBag: number, toBag: number): Promise<void> {
  if (!char || !char.online) throw new Error('character is offline');
  if (!bagReach(char, fromBag)) throw new Error('go to a Mog House or Nomad Moogle to reach that bag');
  await runStep(char, { type: 'move', item: item.n, from: fromBag, to: toBag, count: 1 });
}

function popCount(toks: string[], forceAll: boolean, min = 2): number {
  if (forceAll) return ALL;
  if (toks.length >= min) {
    const last = toks[toks.length - 1].toLowerCase();
    if (last === 'all') { toks.pop(); return ALL; }
    if (/^\d+$/.test(last)) { toks.pop(); return Math.max(1, Number(last)); }
  }
  return 1;
}

async function moveAcross(ctx: Ctx, it: { id: number; n: string }, sources: { bag: number; count: number }[], to: number, count: number): Promise<number> {
  let remaining = count;
  let moved = 0;
  for (const s of sources) {
    if (remaining <= 0) break;
    const n = Math.min(remaining, s.count);
    await runStep(ctx.char, { type: 'move', item: it.n, from: s.bag, to, count: n });
    moved += n;
    remaining -= n;
  }
  return moved;
}

async function doGet(ctx: Ctx, a: string[], forceAll: boolean): Promise<string> {
  const toks = [...a];
  const count = popCount(toks, forceAll);
  const pullAll = count === ALL;  // "get all"/`//gets`: pull up to inventory capacity, not a fixed cap
  let bag: number | null = null;
  if (toks.length > 1) { const b = bagId(toks[toks.length - 1]); if (b != null) { bag = b; toks.pop(); } }
  const name = toks.join(' ').trim();
  if (!name) throw new Error('get <item> [bag] [count]');
  const re = globToRe(name);
  if (re) {
    const matches = matchInvAll(ctx.char, re);
    if (!matches.length) throw new Error(`no match: ${name}`);
    const got: string[] = [];
    let mogOnly = false;
    for (const m of matches) {
      const all = bagsHolding(ctx.char, m.id, bag ?? undefined).filter((s) => s.bag !== 0);
      const src = all.filter((s) => bagReach(ctx.char, s.bag));
      if (!src.length) { if (all.length) mogOnly = true; continue; }
      const n = await moveAcross(ctx, m, src, 0, pullAll ? invCapacityFor(ctx.char, m.id) : count);
      if (n > 0) got.push(`${n}x ${m.n}`);
    }
    if (!got.length) throw new Error(mogOnly ? `${name}: needs a Mog House or Nomad Moogle to reach` : `${name}: nothing to get (already in inventory?)`);
    return `got ${got.join(', ')}`;
  }
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const sources = bagsHolding(ctx.char, it.id, bag ?? undefined).filter((s) => s.bag !== 0);
  if (!sources.length) throw new Error(`${it.n} not in ${bag != null ? 'that bag' : 'any bag'}`);
  const reach = sources.filter((s) => bagReach(ctx.char, s.bag));
  if (!reach.length) throw new Error(`${it.n} needs a Mog House or Nomad Moogle to reach`);
  const moved = await moveAcross(ctx, it, reach, 0, pullAll ? invCapacityFor(ctx.char, it.id) : count);
  return `got ${moved}x ${it.n}`;
}

// Bags `keep` stores leftovers INTO, in order: Satchel/Sack/Case (reachable anywhere), then Mog storage
// (only at a Mog House / Nomad Moogle). Mirrors where `get` pulls FROM.
const KEEP_STORE_BAGS = [5, 6, 7, 1, 2, 4, 9];

// `keep <item> <count>`: make the main inventory hold EXACTLY <count>. Pulls the shortfall from storage when
// short, and stores the leftovers back into a bag when over (the Itemizer habit). Idempotent, unlike `get`
// which withdraws <count> every run. Built for job-change macros that want a fixed amount of a consumable.
async function doKeep(ctx: Ctx, a: string[]): Promise<string> {
  const toks = [...a];
  if (!(toks.length >= 2 && /^\d+$/.test(toks[toks.length - 1]))) throw new Error('keep <item> <count>  (makes inventory hold exactly count)');
  const target = Math.max(0, Number(toks.pop()));
  let bag: number | null = null;
  if (toks.length > 1) { const b = bagId(toks[toks.length - 1]); if (b != null) { bag = b; toks.pop(); } }
  const name = toks.join(' ').trim();
  if (!name) throw new Error('keep <item> <count>');
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const have = bagsHolding(ctx.char, it.id, 0).reduce((n, s) => n + s.count, 0);
  const diff = target - have;
  if (diff === 0) return `${it.n}: already ${have} in inventory`;
  if (diff > 0) {
    // Short: pull the shortfall from reachable storage.
    const sources = bagsHolding(ctx.char, it.id, bag ?? undefined).filter((s) => s.bag !== 0);
    if (!sources.length) throw new Error(`${it.n}: need ${diff} more but none in storage`);
    const reach = sources.filter((s) => bagReach(ctx.char, s.bag));
    if (!reach.length) throw new Error(`${it.n} needs a Mog House or Nomad Moogle to reach`);
    const moved = await moveAcross(ctx, it, reach, 0, diff);
    return `kept ${it.n} at ${have + moved}/${target}`;
  }
  // Over: store the leftovers back into a bag, spilling across bags as each fills. Order follows the user's
  // preference (Settings > Behavior), falling back to the default when they haven't set one.
  let excess = have - target;
  const inInv = bagsHolding(ctx.char, it.id, 0);
  const pref = getSettings().keepStoreBags;
  const order = bag != null ? [bag] : (pref && pref.length ? pref : KEEP_STORE_BAGS);
  const dests = order.filter((b) => b !== 0 && bagReach(ctx.char, b));
  let stored = 0;
  for (const db of dests) {
    if (excess <= 0) break;
    const take = Math.min(excess, bagCapacityFor(ctx.char, it.id, db));
    if (take <= 0) continue;
    const n = await moveAcross(ctx, it, inInv, db, take);
    stored += n; excess -= n;
  }
  if (stored <= 0) throw new Error(`${it.n}: no reachable bag with room to store the extra ${have - target}`);
  return `kept ${it.n} at ${have - stored}/${target}, stored ${stored}`;
}

async function doPut(ctx: Ctx, a: string[], forceAll: boolean): Promise<string> {
  const toks = [...a];
  const count = popCount(toks, forceAll);
  const bag = bagId(toks.pop() ?? '');
  const name = toks.join(' ').trim();
  if (bag == null || !name) throw new Error('put <item> <bag> [count]');
  if (!bagReach(ctx.char, bag)) throw new Error('that bag needs a Mog House or Nomad Moogle');
  const re = globToRe(name);
  if (re) {
    const matches = matchInvAll(ctx.char, re);
    if (!matches.length) throw new Error(`no match: ${name}`);
    const put: string[] = [];
    for (const m of matches) {
      const inInv = bagsHolding(ctx.char, m.id, 0);
      if (!inInv.length) continue;
      const n = await moveAcross(ctx, m, inInv, bag, count);
      if (n > 0) put.push(`${n}x ${m.n}`);
    }
    if (!put.length) throw new Error(`${name}: nothing in inventory to put`);
    return `put ${put.join(', ')}`;
  }
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const inInv = bagsHolding(ctx.char, it.id, 0);
  if (!inInv.length) throw new Error(`${it.n} not in inventory`);
  const moved = await moveAcross(ctx, it, inInv, bag, count);
  return `put ${moved}x ${it.n}`;
}

async function doMove(ctx: Ctx, a: string[], forceAll: boolean): Promise<string> {
  const toks = [...a];
  const count = popCount(toks, forceAll);
  const to = bagId(toks.pop() ?? '');
  if (to == null) throw new Error('move <item> [from] <to> [count]');
  if (!bagReach(ctx.char, to)) throw new Error('destination bag needs a Mog House or Nomad Moogle');
  let from: number | null = null;
  if (toks.length > 1) { const b = bagId(toks[toks.length - 1]); if (b != null) { from = b; toks.pop(); } }
  const name = toks.join(' ').trim();
  if (!name) throw new Error('move <item> [from] <to> [count]');
  const re = globToRe(name);
  if (re) {
    const matches = matchInvAll(ctx.char, re);
    if (!matches.length) throw new Error(`no match: ${name}`);
    const movedList: string[] = [];
    let mogOnly = false;
    for (const m of matches) {
      const all = from != null ? bagsHolding(ctx.char, m.id, from) : bagsHolding(ctx.char, m.id).filter((s) => s.bag !== to);
      if (!all.length) continue;
      const src = all.filter((s) => bagReach(ctx.char, s.bag));
      if (!src.length) { mogOnly = true; continue; }
      const n = await moveAcross(ctx, m, src, to, count === 1 ? ALL : count);
      if (n > 0) movedList.push(`${n}x ${m.n}`);
    }
    if (!movedList.length) throw new Error(mogOnly ? `${name}: needs a Mog House or Nomad Moogle to reach` : `${name}: nothing to move`);
    return `moved ${movedList.join(', ')}`;
  }
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const all = from != null ? bagsHolding(ctx.char, it.id, from) : bagsHolding(ctx.char, it.id).filter((s) => s.bag !== to);
  if (!all.length) throw new Error(`${it.n} not found to move`);
  const sources = all.filter((s) => bagReach(ctx.char, s.bag));
  if (!sources.length) throw new Error(`${it.n} needs a Mog House or Nomad Moogle to reach`);
  const moved = await moveAcross(ctx, it, sources, to, count === 1 ? ALL : count);
  return `moved ${moved}x ${it.n}`;
}

const STORE_ALIAS: Record<string, string> = { alex: 'Paparoon', rem: 'Monisette', seal: 'Shami', crystal: 'Ephemeral Moogle' };
async function doStore(ctx: Ctx, a: string[]): Promise<string> {
  const key = (a[0] ?? '').toLowerCase();
  const npc = STORE_ALIAS[key];
  if (!npc) throw new Error('store <alex|rem|seal|crystal>');
  let sent = 0;
  let chars = 0;
  for (const c of onlineFleet()) {
    const z = (c.storeZone ?? []).find((x) => x.npc === npc);
    if (!z || c.conn == null) continue;
    let any = false;
    for (const it of z.items) {
      if (it.c > 0) { storeRequest(c.conn, npc, it.id, it.c); sent++; any = true; }
    }
    if (any) chars++;
  }
  if (sent === 0) throw new Error(`nothing to store: no character in ${npc}'s zone holds any`);
  return `storing ${key} across ${chars} character${chars === 1 ? '' : 's'}`;
}

function doFind(ctx: Ctx, a: string[], selfDefault: boolean, exact = false): string {
  const include = new Set<string>();
  const exclude = new Set<string>();
  const terms: string[] = [];
  for (const tk of a) {
    if (tk.startsWith(':') && tk.length > 1) include.add(tk.slice(1).toLowerCase());
    else if (tk.startsWith('!') && tk.length > 1) exclude.add(tk.slice(1).toLowerCase());
    else terms.push(tk);
  }
  if (selfDefault) include.add(ctx.charName.toLowerCase());
  const q = terms.join(' ').trim().toLowerCase();
  if (!q && include.size === 0) return 'find <item> [:char] [!char]';
  const lines: string[] = [];
  let total = 0;
  const online = getKnownCharacters().filter((c) => c.online && c.conn != null);
  const onlineNames = new Set(online.map((c) => c.name.toLowerCase()));
  const searched: { name: string; entries: FindEntry[] }[] = online.map((c) => ({ name: c.name, entries: findEntriesFor(c) }));
  for (const [name, entries] of Object.entries(getFindCache())) {
    if (!onlineNames.has(name.toLowerCase())) searched.push({ name, entries });
  }
  searched.sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, entries } of searched) {
    const ln = name.toLowerCase();
    if (include.size && !include.has(ln)) continue;
    if (exclude.has(ln)) continue;
    // Merge the same item held in the same bag into one line: a stack split across
    // several slots would otherwise print once per slot (findAll sums them). Key on
    // name too so key items (all id 0) stay distinct.
    const merged = new Map<string, { loc: string; id: number; n: string; c: number }>();
    for (const it of entries) {
      // exact = match the whole item/KI name only (so "moglophone" won't also list "Moglophone II");
      // otherwise the normal fuzzy/prefix match.
      if (q && (exact ? it.n.toLowerCase() !== q : !itemNameMatches(it.id, it.n, q, getSettings().itemizerMatch !== 'strict'))) continue;
      const k = `${it.loc}|${it.id}|${it.n}`;
      const m = merged.get(k);
      if (m) m.c += it.c; else merged.set(k, { loc: it.loc, id: it.id, n: it.n, c: it.c });
    }
    for (const m of [...merged.values()].sort((a, b) => a.n.localeCompare(b.n) || a.loc.localeCompare(b.loc))) {
      if (m.id > 0) total += m.c;
      lines.push(`${name}/${m.loc}: ${m.n}${m.c > 1 ? ` (${m.c})` : ''}`);
    }
  }
  for (const l of lines) axEcho(ctx.conn, l);
  if (!lines.length) return q ? `no match: ${q}` : 'nothing found';
  const more = total > 0 ? `, ${total} total` : '';
  return `${lines.length} match${lines.length === 1 ? '' : 'es'}${more}`;
}

function parsePrice(s: string): number | null {
  const n = Number((s ?? '').replace(/[.,_\s]/g, ''));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function parseStack(s: string): number | null {
  const v = (s ?? '').toLowerCase();
  if (v === 'stack' || v === '1') return 0;
  if (v === 'single' || v === '0') return 1;
  return null;
}

async function doAh(ctx: Ctx, a: string[]): Promise<string> {
  const sub = (a[0] ?? '').toLowerCase();
  if (!sub) { ahMenu(ctx.conn); return 'opening auction house'; }
  if (sub === 'clear') { ahClearSold(ctx.conn); return 'cleared sold/unsold slots'; }
  if (sub === 'buy' || sub === 'bid' || sub === 'sell') {
    const rest = a.slice(1);
    if (rest.length < 3) throw new Error(`ah ${sub} <item> <stack|single> <price>`);
    const price = parsePrice(rest[rest.length - 1]);
    const single = parseStack(rest[rest.length - 2]);
    if (price == null) throw new Error('invalid price');
    if (single == null) throw new Error('specify stack or single');
    const name = rest.slice(0, -2).join(' ').trim();
    const it = resolveItemName(name);
    if (!it) throw new Error(`unknown item: ${name}`);
    const kind = single === 1 ? 'single' : 'stack';
    if (sub === 'buy' || sub === 'bid') { ahBuy(ctx.conn, it.id, single, price, 1); return `bid ${price} on ${it.n} (${kind})`; }
    ahSell(ctx.conn, it.id, single, price, 1);
    return `listing ${it.n} (${kind}) at ${price}`;
  }
  return doAhPrice(ctx, a);
}

function saleAge(ts?: number): string {
  if (!ts) return '';
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 90) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(sec / 3600);
  if (h < 72) return `${h}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

async function doAhPrice(ctx: Ctx, a: string[]): Promise<string> {
  let stack = false;
  const rest = a.filter((t) => {
    const lc = t.toLowerCase();
    if (lc === '-s' || lc === '--stack' || lc === '-stack') { stack = true; return false; }
    return true;
  });
  const name = unquote(rest.join(' '));
  if (!name) throw new Error('ah [-s] <item>  |  ah [buy|sell|clear]');
  const it = resolveItemName(name);
  if (!it) throw new Error(`unknown item: ${name}`);
  const kind = stack ? 'stack' : 'single';
  const m = await fetchMarket(it.id, stack, ctx.char.server);
  const parts: string[] = [];
  parts.push(m.median ? `{price|${m.median}}g median` : 'no recent sales');
  if (m.listedTotal != null) parts.push(`{stock|${m.listedTotal}} listed`);
  if (m.rate) parts.push(`{rate|${m.rate}}/day`);
  const srv = ctx.char.server ? ` @ ${ctx.char.server}` : '';
  axEcho(ctx.conn, `${it.n} ${kind}${srv}: ${parts.join(', ')}`);
  // Sort by the same timestamp that renders the "Xh ago" label so the shown ages are
  // always newest-first (and we pick the true 5 most recent, not just the first 5).
  const recent = [...m.sales].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, 5);
  for (const s of recent) {
    axEcho(ctx.conn, `  {price|${s.price.toLocaleString()}}g  ${saleAge(s.ts) || s.date}`);
  }
  if (!recent.length) axEcho(ctx.conn, '  no recent sales on record');
  return '';
}

async function doBazaar(ctx: Ctx, a: string[]): Promise<string> {
  const toks = [...a];
  const price = parsePrice(toks.pop() ?? '');
  if (price == null) throw new Error('bazaar <item> <price>');
  const name = toks.join(' ').trim();
  if (!name) throw new Error('bazaar <item> <price>');
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const slots: { index: number; price: number }[] = [];
  for (const b of ctx.char.inv ?? []) if (b.id === 0) for (const x of b.items) if (x.id === it.id) slots.push({ index: x.s, price });
  if (!slots.length) throw new Error(`${it.n} not in inventory`);
  bzApply(ctx.conn, slots);
  return `bazaar ${it.n} x${slots.length} @ ${price}`;
}

function invSlots(char: KnownChar | undefined, id?: number): { slot: number; id: number; count: number }[] {
  const out: { slot: number; id: number; count: number }[] = [];
  for (const b of char?.inv ?? []) if (b.id === 0) for (const x of b.items) if (x.id > 0 && (id == null || x.id === id)) out.push({ slot: x.s, id: x.id, count: x.c });
  return out;
}

async function doDrop(ctx: Ctx, a: string[]): Promise<string> {
  const op = (a[0] ?? '').toLowerCase();
  if (op === 'add' || op === 'remove') {
    const name = unquote(a.slice(1).join(' '));
    if (!name) throw new Error('drop <add|remove> <item>');
    const cfg = getDrop();
    const has = cfg.drop.some((x) => x.toLowerCase() === name.toLowerCase());
    const next = op === 'add' ? (has ? cfg.drop : [...cfg.drop, name]) : cfg.drop.filter((x) => x.toLowerCase() !== name.toLowerCase());
    setDrop({ ...cfg, drop: next });
    void broadcastDropRules({ drop: next, autodrop: cfg.autoDrop, delay: cfg.dropDelay ?? 0 });
    return `${op === 'add' ? 'drop+' : 'drop-'} ${name}`;
  }
  if (op === 'all') {
    const all = invSlots(ctx.char);
    if (!all.length) return 'inventory empty';
    if ((a[1] ?? '').toLowerCase() !== 'confirm') return `drops your ENTIRE inventory (${all.length} items). confirm: drop all confirm`;
    for (const s of all) dropOne(ctx.conn, s.slot, s.id);
    return `dropping ${all.length} inventory item(s)`;
  }
  const name = unquote(a.join(' '));
  if (!name) throw new Error('drop <item> | drop <add|remove> <item> | drop all');
  const it = searchInv(ctx.char, name.toLowerCase());
  if (!it) throw new Error(`no item: ${name}`);
  const slots = invSlots(ctx.char, it.id);
  if (!slots.length) throw new Error(`${it.n} not in inventory`);
  for (const s of slots) dropOne(ctx.conn, s.slot, s.id);
  // Each slot drops its whole stack, so report the actual item total, not the number of stacks.
  const total = slots.reduce((n, s) => n + (s.count || 1), 0);
  return `dropped ${total}x ${it.n}`;
}

// Like `drop <item>` but fleet-wide: drops every reachable copy on every connected
// character. Shares dropItemEverywhere with the "Drop All On Party" action.
async function doDropAll(ctx: Ctx, a: string[]): Promise<string> {
  const name = unquote(a.join(' '));
  if (!name) throw new Error('dropall <item>');
  const it = resolveItem(undefined, name);
  if (!it) throw new Error(`no item: ${name}`);
  const { items, chars } = dropItemEverywhere(it.id, getSettings().experimentalFeatures);
  if (items === 0) throw new Error(`no ${it.n} on any connected character`);
  return `dropping ${items}x ${it.n} across ${chars} character${chars === 1 ? '' : 's'}`;
}

async function doPoolRule(ctx: Ctx, kind: 'lot' | 'pass', a: string[]): Promise<string> {
  const op = (a[0] ?? '').toLowerCase();
  if (op === 'all') {
    if (kind === 'lot') lotAll(ctx.conn); else passAll(ctx.conn);
    return `${kind === 'lot' ? 'lotting' : 'passing'} all pool items`;
  }
  const name = unquote(a.slice(1).join(' '));
  if (!name || (op !== 'add' && op !== 'remove')) throw new Error(`${kind} <add|remove|all> <item>`);
  let entries: string[];
  if (name.toLowerCase() === 'pool') {
    entries = [...new Set((ctx.char.pool ?? []).map((p) => p.n).filter(Boolean))];
    if (!entries.length) throw new Error('pool is empty');
  } else {
    entries = [name];
  }
  for (const e of entries) {
    if (op === 'add') addRuleToChars([ctx.charName], kind, e);
    else removeRuleFromChar(ctx.charName, kind, e);
  }
  return `${kind}${op === 'add' ? '+' : '-'} ${entries.length > 1 ? `${entries.length} items` : name}`;
}

function splitCount(tokens: string[]): { name: string; count: number } {
  if (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) {
    return { name: tokens.slice(0, -1).join(' '), count: Math.max(1, Number(tokens[tokens.length - 1])) };
  }
  return { name: tokens.join(' '), count: 1 };
}

// Bags the addon uses/pulls from when using an item (inventory + satchel/sack/case).
const USE_BAGS = new Set([0, 3, 5, 6, 7]); // + Temporary (3): usable in place via /item
function useableTotal(char: KnownChar, id: number): number {
  let n = 0;
  for (const b of char.inv ?? []) if (USE_BAGS.has(b.id)) for (const it of b.items) if (it.id === id) n += it.c;
  return n;
}

// Drive the addon's native use loop (the same one behind the UI's Use One / Use Amount /
// Use All) and block until it finishes, so chained `//ax use` calls run in order.
async function runCliUse(ctx: Ctx, id: number, all: boolean, count: number): Promise<void> {
  useItem(ctx.conn, id, all, 0, undefined, all ? undefined : (count > 1 ? count : undefined));
  await new Promise((r) => setTimeout(r, 350)); // let the addon start the loop
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    if (fresh(ctx.charName)?.useProg?.active !== true) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function readJson<T>(rel: string): Promise<T | null> {
  if (!inTauri) return null;
  try { return JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath(rel) })) as T; } catch { return null; }
}
async function writeJson(rel: string, data: unknown) {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath(rel), contents: JSON.stringify(data) }); } catch { /* ignore */ }
}

const ORG_STORAGE = [5, 6, 7, 1, 9, 2, 4];
const ORG_DEFAULT: OrganizeRules = { alwaysBring: [], keep: [], keepSingle: [], keepQty: [], storableBags: [5, 6, 7], storeUsable: true, reserve: 3, strictInventory: false, taggedOnly: false };

type Ctx = { conn: number; charName: string; target?: string; char: KnownChar };
type Verb = { usage: string; run: (ctx: Ctx, args: string[]) => Promise<string> };

const VERBS: Record<string, Verb> = {
  use: {
    usage: 'use <item> [count|all]',
    run: async (ctx, a) => {
      // Trailing "all" -> use ONE on every connected character (Use One Everywhere). A trailing
      // number uses that many on the caller; otherwise one on the caller.
      const everyChar = a.length > 1 && (a[a.length - 1] ?? '').toLowerCase() === 'all';
      if (everyChar) {
        const it = resolveItem(ctx.char, a.slice(0, -1).join(' '));
        if (!it) throw new Error(`no item: ${a.slice(0, -1).join(' ')}`);
        openUseAll(it.id, it.n, false);
        return `using one ${it.n} on every character`;
      }
      const { name, count } = splitCount(a);
      const it = resolveItem(ctx.char, name);
      if (!it) throw new Error(`no item: ${name}`);
      const n = Math.min(count, useableTotal(ctx.char, it.id));
      if (n <= 0) throw new Error(`no ${it.n} to use`);
      await runCliUse(ctx, it.id, false, n);
      return `used ${n}x ${it.n}`;
    },
  },
  move: { usage: 'move <item> [from] <to> [count]', run: (ctx, a) => doMove(ctx, a, false) },
  moves: { usage: 'moves <item> [from] <to>', run: (ctx, a) => doMove(ctx, a, true) },
  store: { usage: 'store <alex|rem|seal|crystal>', run: (ctx, a) => doStore(ctx, a) },
  get: { usage: 'get <item> [bag] [count]', run: (ctx, a) => doGet(ctx, a, false) },
  gets: { usage: 'gets <item> [bag]', run: (ctx, a) => doGet(ctx, a, true) },
  keep: { usage: 'keep <item> <count>', run: (ctx, a) => doKeep(ctx, a) },
  put: { usage: 'put <item> <bag> [count]', run: (ctx, a) => doPut(ctx, a, false) },
  puts: { usage: 'puts <item> <bag>', run: (ctx, a) => doPut(ctx, a, true) },
  stack: { usage: 'stack', run: async (ctx) => { stackBag(ctx.conn); return 'stacking all bags'; } },
  find: { usage: 'find <item> [:char] [!char]', run: async (ctx, a) => doFind(ctx, a, true) },
  findall: { usage: 'findall <item> [:char] [!char]', run: async (ctx, a) => doFind(ctx, a, false) },
  findone: { usage: 'findone <exact name> [:char] [!char]', run: async (ctx, a) => doFind(ctx, a, true, true) },
  findallone: { usage: 'findallone <exact name> [:char] [!char]', run: async (ctx, a) => doFind(ctx, a, false, true) },
  ah: { usage: 'ah [-s] <item> (price check) | ah buy|bid|sell <item> <stack|single> <price> | ah clear', run: (ctx, a) => doAh(ctx, a) },
  bazaar: { usage: 'bazaar <item> <price>', run: (ctx, a) => doBazaar(ctx, a) },
  buy: {
    usage: 'buy <item> <count>',
    run: async (ctx, a) => {
      const { name, count } = splitCount(a);
      if (!name) throw new Error('buy <item> <count>');
      await runStep(ctx.char, { type: 'buy', item: name, count });
      return `bought ${count}x ${name}`;
    },
  },
  trade: {
    usage: 'trade <player> <item> [count]',
    run: async (ctx, a) => {
      if (a.length < 2) throw new Error('trade <player> <item> [n]');
      const to = a[0];
      const { name, count } = splitCount(a.slice(1));
      const it = resolveItem(ctx.char, name);
      if (!it) throw new Error(`no item: ${name}`);
      await runStep(ctx.char, { type: 'trade', item: it.n, count, to });
      return `traded ${count}x ${it.n} to ${to}`;
    },
  },
  seq: {
    usage: 'seq <name>',
    run: async (ctx, a) => {
      const name = a.join(' ').trim();
      const s = await readJson<{ sequences: Record<string, Step[]> }>('sequences.json');
      const key = s && Object.keys(s.sequences ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!s || !key) throw new Error(`no sequence: ${name}`);
      void runSequence(ctx.char, { name: key, steps: s.sequences[key] });
      return `running "${key}"`;
    },
  },
  consolidate: {
    usage: 'consolidate [collector] <item>[, item2 ...]',
    run: async (ctx, a) => {
      let collector = ctx.charName;
      let rest = a;
      if (a.length > 1 && onlineFleet().some((k) => k.name.toLowerCase() === a[0].toLowerCase())) {
        collector = fresh(a[0])!.name;
        rest = a.slice(1);
      }
      const names = rest.join(' ').split(',').map((s) => s.trim()).filter(Boolean);
      const ids: number[] = [];
      for (const nm of names) { const it = resolveItem(undefined, nm); if (it && !ids.includes(it.id)) ids.push(it.id); }
      if (!ids.length) throw new Error('no tradeable items matched');
      void runConsolidate(collector, ids);
      return `consolidating ${ids.length} item kind(s) to ${collector}`;
    },
  },
  organize: { usage: 'organize', run: async (ctx) => { await doOrganize(ctx, false); return `organizing ${ctx.charName}`; } },
  'light-organize': { usage: 'light-organize', run: async (ctx) => { await doOrganize(ctx, true); return `light organizing ${ctx.charName}`; } },
  drop: { usage: 'drop <item> | drop <add|remove> <item> | drop all confirm', run: (ctx, a) => doDrop(ctx, a) },
  dropall: { usage: 'dropall <item> (drops it on every connected character)', run: (ctx, a) => doDropAll(ctx, a) },
  lot: { usage: 'lot <add|remove|all> <item>', run: (ctx, a) => doPoolRule(ctx, 'lot', a) },
  pass: { usage: 'pass <add|remove|all> <item>', run: (ctx, a) => doPoolRule(ctx, 'pass', a) },
  lotall: { usage: 'lotall', run: async (ctx) => { lotAll(ctx.conn); return 'lotting all pool items'; } },
  passall: { usage: 'passall', run: async (ctx) => { passAll(ctx.conn); return 'passing all pool items'; } },
  done: { usage: 'done', run: async (ctx) => { passDone(ctx.conn); return 'passing pool items you have not lotted'; } },
  watch: {
    usage: 'watch <add|remove> <item> [threshold]',
    run: async (ctx, a) => {
      const op = (a[0] ?? '').toLowerCase();
      if (op !== 'add' && op !== 'remove') throw new Error('watch <add|remove> <item> [n]');
      const { name, count } = splitCount(a.slice(1));
      const it = resolveItem(ctx.char, name);
      if (!it) throw new Error(`no item: ${name}`);
      if (!ctx.char) throw new Error('no character');
      if (op === 'add') { addWatchItem(ctx.char.name, { id: it.id, name: it.n }, Math.max(1, count)); return `watch ${it.n} < ${Math.max(1, count)}`; }
      removeWatchItem(ctx.char.name, it.id);
      return `unwatch ${it.n}`;
    },
  },
};

async function doOrganize(ctx: Ctx, light: boolean) {
  // Use the SAME rules the Organize button uses: the live, edited set in organize_rules.json. The command used
  // to read only organize_presets.json, so it ran the saved preset (or the default) and ignored whatever the
  // user had actually configured in the Organize tab -- "the command doesn't respect the button" bug. Fall back
  // to the current preset, then the default, exactly like the view's own load order, and normalize identically.
  let raw = await readJson<OrganizeRules>('organize_rules.json');
  if (!raw) {
    const presets = await readJson<{ current: string; presets: Record<string, OrganizeRules> }>('organize_presets.json');
    raw = (presets?.presets?.[presets.current]) ?? ORG_DEFAULT;
  }
  let rules = normalizeOrganizeRules({ ...ORG_DEFAULT, ...raw });
  if (light) {
    const present = new Set<number>();
    for (const b of ctx.char.inv ?? []) if (ORG_STORAGE.includes(b.id)) present.add(b.id);
    const avail = ORG_STORAGE.filter((id) => present.has(id));
    rules = { ...rules, storableBags: avail.length ? avail : ORG_STORAGE };
  }
  runOrganize(ctx.conn, rules);
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function expandAlias(script: string, me: string, target: string | undefined, rest: string[]): string[][] {
  const sub = (tok: string) => tok
    .replace(/\$me\b/gi, me)
    .replace(/\$target\b/gi, target ?? '')
    .replace(/\$(\d+)/g, (_, d) => rest[Number(d) - 1] ?? '');
  return script.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean)
    .map((line) => tokenize(line).map(sub).filter((t) => t.length > 0));
}

async function runVerb(ctx: Ctx, toks: string[], echo: (t: string) => void) {
  const v = VERBS[(toks[0] ?? '').toLowerCase()];
  if (!v) { echo(`unknown: ${toks[0]} (//ax help)`); return; }
  try { const r = await v.run(ctx, toks.slice(1)); if (r) echo(r); }
  catch (e) { echo('x ' + (e instanceof Error ? e.message : String(e))); }
}

export async function runAxCommand(conn: number, charName: string, target: string | undefined, args: string[]) {
  const echo = (t: string) => axEcho(conn, t);
  if (!args.length) { echo('type a command or alias. //ax help'); return; }
  const head = args[0].toLowerCase();
  if (head === 'help') { echo('verbs: ' + Object.keys(VERBS).join(' ')); return; }
  if (head === 'list' || head === 'commands') {
    const al = getAliases();
    echo(al.length ? 'aliases: ' + al.map((a) => a.name).join(' ') : 'no aliases yet (add them in the app)');
    return;
  }
  const char = fresh(charName);
  if (!char || char.conn == null) { echo('character not connected to app'); return; }
  const ctx: Ctx = { conn, charName: char.name, target, char };

  const alias = getAliases().find((a) => a.name.toLowerCase() === head);
  if (alias) {
    for (const toks of expandAlias(alias.script, char.name, target, args.slice(1))) {
      if (toks.length) await runVerb(ctx, toks, echo);
    }
    return;
  }
  await runVerb(ctx, args, echo);
}

export const VERB_USAGES: string[] = Object.values(VERBS).map((v) => v.usage);

export type ParamKind = 'item' | 'items' | 'count' | 'threshold' | 'bag' | 'player' | 'op' | 'seq' | 'query';
export type Param = { kind: ParamKind; label: string; optional?: boolean };
export const VERB_FORMS: { verb: string; params: Param[] }[] = [
  { verb: 'use', params: [{ kind: 'item', label: 'Item' }, { kind: 'count', label: 'Count', optional: true }] },
  { verb: 'find', params: [{ kind: 'query', label: 'Item' }] },
  { verb: 'get', params: [{ kind: 'item', label: 'Item' }, { kind: 'bag', label: 'From', optional: true }, { kind: 'count', label: 'Count', optional: true }] },
  { verb: 'keep', params: [{ kind: 'item', label: 'Item' }, { kind: 'count', label: 'Keep' }] },
  { verb: 'put', params: [{ kind: 'item', label: 'Item' }, { kind: 'bag', label: 'To' }, { kind: 'count', label: 'Count', optional: true }] },
  { verb: 'move', params: [{ kind: 'item', label: 'Item' }, { kind: 'bag', label: 'From', optional: true }, { kind: 'bag', label: 'To' }, { kind: 'count', label: 'Count', optional: true }] },
  { verb: 'stack', params: [] },
  { verb: 'buy', params: [{ kind: 'item', label: 'Item' }, { kind: 'count', label: 'Count' }] },
  { verb: 'trade', params: [{ kind: 'player', label: 'To' }, { kind: 'item', label: 'Item' }, { kind: 'count', label: 'Count', optional: true }] },
  { verb: 'seq', params: [{ kind: 'seq', label: 'Sequence' }] },
  { verb: 'consolidate', params: [{ kind: 'player', label: 'Collector', optional: true }, { kind: 'items', label: 'Items' }] },
  { verb: 'organize', params: [] },
  { verb: 'light-organize', params: [] },
  { verb: 'drop', params: [{ kind: 'op', label: 'Action' }, { kind: 'item', label: 'Item' }] },
  { verb: 'dropall', params: [{ kind: 'item', label: 'Item' }] },
  { verb: 'lot', params: [{ kind: 'op', label: 'Action' }, { kind: 'item', label: 'Item' }] },
  { verb: 'pass', params: [{ kind: 'op', label: 'Action' }, { kind: 'item', label: 'Item' }] },
  { verb: 'lotall', params: [] },
  { verb: 'passall', params: [] },
  { verb: 'done', params: [] },
  { verb: 'watch', params: [{ kind: 'op', label: 'Action' }, { kind: 'item', label: 'Item' }, { kind: 'threshold', label: 'Threshold', optional: true }] },
];

if (!isPoolOverlay() && !isGearsetWindow()) onAxCommand(runAxCommand);
