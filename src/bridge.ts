import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { logPriceSnapshot } from './priceStore';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type InvItem = { s: number; id: number; c: number; n: string; u?: number; f?: number; ms?: number; aug?: string[]; bz?: number };
export type InvBag = { b: string; id: number; max: number; used: number; items: InvItem[] };
export type SelItem = InvItem & { bag: number };
export type PoolItem = { i: number; id: number; n: string; ts: number; lotter: string | null; lot: number; mylot: number | null };
export type PartyInfo = { key: string; members: string[]; size: number };
export type SlipStored = { id: number; n: string };
export type SlipStorable = { id: number; n: string; c: number };
export type Slip = { sid: number; num: number; name: string; ready: boolean; getable: boolean; owned?: boolean; loc: number; locname: string; stored: SlipStored[]; storable: SlipStorable[] };
export type PorterProgress = { active: boolean; op?: 'store' | 'retrieve'; total?: number; done?: number };
export type OrgStatus = { active: boolean; total: number; done: number };
export type ConvertProgress = { active: boolean; shop: string; item: number; bought: number; total: number; phase: string };
export type CurioCatalogItem = { id: number; n: string; price: number; opt: number; stack?: number; rare?: boolean; ex?: boolean };
export type CurioScan = { active: boolean; opt: number; max: number; count: number };
export type ResupplyProgress = { active: boolean; item: number; have: number; target: number; phase: string };
export type UseProgress = { active: boolean; id: number; name: string; done: number; total: number };
export type StoreNpcItem = { id: number; n: string; c: number };
export type StoreNpc = { npc: string; items: StoreNpcItem[]; batch?: number };

// Nomad Moogle zones grant access to Safe / Safe 2 / Locker (and the Delivery Box),
// the same way a Mog House does, except Storage which needs your actual residence.
export const NOMAD_ZONES = new Set([26, 53, 247, 248, 249, 250, 252]);
export const NOMAD_BAGS = new Set([1, 4, 9]);

export const TRADE_RANGE = 7;
export function withinTradeRange(a?: KnownChar, b?: KnownChar): boolean {
  if (!a || !b) return false;
  if (a.zone == null || b.zone == null || a.zone !== b.zone) return false;
  if (a.px == null || a.py == null || b.px == null || b.py == null) return true;
  return Math.hypot(a.px - b.px, a.py - b.py) <= TRADE_RANGE;
}
export const inNomadZone = (zone?: number): boolean => zone != null && NOMAD_ZONES.has(zone);
export const nomadReachable = (char: { zone?: number; nomadNear?: boolean } | undefined, experimental: boolean): boolean =>
  !!char && (experimental ? inNomadZone(char.zone) : !!char.nomadNear);
export type StoreProgress = { active: boolean; item: number; done: number; total: number; phase: string };
export type OrgStep = { i: number; id: number; n: string; c: number; from: string; to: string };
export type CurrencyEntry = { n: string; v: number };
export type Currency = { gil: number; list: CurrencyEntry[] };
export type AhSlot = { s: number; st: string; id: number; n: string; c: number; p: number; ts: number };
export type AhState = { atah: boolean; init: boolean; qn: number; slots: AhSlot[] };
export type AhCatItem = { id: number; n: string; cat: string; lvl: number; il?: number; j: string[]; st: number; ac?: number };

export type DboxSlot = { s: number; id: number; c: number; n: string; who: string; ts: number; gil?: boolean };
export type DboxState = { in: DboxSlot[]; out: DboxSlot[] };
export type DboxStatus = { busy: boolean; queue: number; kind: string; phase: string; note: string; cooldown?: number; opening?: boolean; loading?: boolean; open?: string };
export type TradeStatus = { active: boolean; stage?: string; done?: number; total?: number; target?: string; result?: string };

export type ShopItem = { idx: number; id: number; price: number; n: string; rank?: number; skill?: number };
export type ShopState = { items: ShopItem[] };

export type NpcNear = { name: string | null; id?: number; index?: number };
export type NpcLearn = { conn: number; npc: string; option: number; at: number };

export type AugState = { active: boolean; mode?: string; attempts?: number; total?: number; status?: string; results?: Record<string, number>; manual?: boolean; awaitDecision?: boolean; item?: string; id?: number; multi?: boolean; step?: number; stepCount?: number; augs?: string[] };
export type AugInfo = { cape: string | null; augments?: string[] };

export type BazaarSeller = { name: string; id: number; index: number; dist: number; inrange: boolean };
export type BazaarItem = { id: number; n: string; price: number; qty: number; tax: number; bidx: number };
export type BazaarListing = { seller: string; sellerId: number; sellerIndex: number; items: BazaarItem[]; at: number };
export type MyBazaarItem = { slot: number; id: number; n: string; count: number; listed: boolean; price: number };
export type BazaarScan = { active: boolean; total: number; done: number; current?: string };
export type BazaarBuyResult = { conn: number; ok: boolean; name: string; reason: string; at: number };

export type KeyItem = { id: number; n: string };

export type Box = {
  conn: number;
  id: number;
  name: string;
  main?: string;
  mainLvl?: number;
  sub?: string;
  subLvl?: number;
  zone?: number;
  zoneName?: string;
  px?: number;
  py?: number;
  assets?: string;
  apath?: string;
  av?: string;
  atah?: boolean;
  inTown?: boolean;
  server?: string;
  gil?: number;
  mog?: boolean;
  nomadNear?: boolean;
  ah?: AhState;
  dbox?: DboxState;
  dboxStatus?: DboxStatus;
  tradeStatus?: TradeStatus;
  shop?: ShopState;
  npcNear?: NpcNear;
  fixedNear?: string[];
  porter?: PorterProgress;
  porterNear?: boolean;
  vendorNear?: { sparks: boolean; unity: boolean; curio: boolean };
  convert?: ConvertProgress;
  resupply?: ResupplyProgress;
  pvendor?: ResupplyProgress;
  pvendorNear?: string | null;
  useProg?: UseProgress;
  storeZone?: StoreNpc[];
  store?: StoreProgress;
  aug?: AugState;
  augInfo?: AugInfo;
  bzSellers?: BazaarSeller[];
  bzListings?: Record<number, BazaarListing>;
  bzMy?: MyBazaarItem[];
  bzScan?: BazaarScan;
  bzMem?: boolean;
  inv?: InvBag[];
  invAt: number;
  keyItems?: KeyItem[];
  pool?: PoolItem[];
  party?: PartyInfo;
  slips?: Slip[];
  org?: OrgStatus;
  orgPlan?: OrgStep[];
  orgPreview?: OrgStep[];
  orgDone?: number[];
  orgOk?: number[];
  cur?: Currency;
  curAt?: number;
  keyAt?: number;
  lastSeen: number;
};

export type PersistedChar = {
  name: string;
  id?: number;
  main?: string;
  mainLvl?: number;
  sub?: string;
  subLvl?: number;
  zoneName?: string;
  assets?: string;
  inv?: InvBag[];
  keyItems?: KeyItem[];
  keyAt?: number;
  cur?: Currency;
  curAt?: number;
  savedAt: number;
};

export type KnownChar = {
  name: string;
  id?: number;
  online: boolean;
  conn?: number;
  main?: string;
  sub?: string;
  zone?: number;
  zoneName?: string;
  px?: number;
  py?: number;
  assets?: string;
  inv?: InvBag[];
  keyItems?: KeyItem[];
  pool?: PoolItem[];
  party?: PartyInfo;
  slips?: Slip[];
  org?: OrgStatus;
  orgPlan?: OrgStep[];
  orgPreview?: OrgStep[];
  orgDone?: number[];
  orgOk?: number[];
  cur?: Currency;
  atah?: boolean;
  inTown?: boolean;
  server?: string;
  gil?: number;
  mog?: boolean;
  nomadNear?: boolean;
  ah?: AhState;
  dbox?: DboxState;
  dboxStatus?: DboxStatus;
  tradeStatus?: TradeStatus;
  shop?: ShopState;
  npcNear?: NpcNear;
  fixedNear?: string[];
  porter?: PorterProgress;
  porterNear?: boolean;
  vendorNear?: { sparks: boolean; unity: boolean; curio: boolean };
  convert?: ConvertProgress;
  resupply?: ResupplyProgress;
  pvendor?: ResupplyProgress;
  pvendorNear?: string | null;
  useProg?: UseProgress;
  storeZone?: StoreNpc[];
  store?: StoreProgress;
  aug?: AugState;
  augInfo?: AugInfo;
  bzSellers?: BazaarSeller[];
  bzListings?: Record<number, BazaarListing>;
  bzMy?: MyBazaarItem[];
  bzScan?: BazaarScan;
  bzMem?: boolean;
  curAt?: number;
  keyAt?: number;
  savedAt?: number;
};

type Frame =
  | { t: 'hello'; id: number; name: string; main?: string; main_lvl?: number; sub?: string; sub_lvl?: number; zone?: number; zone_name?: string; px?: number; py?: number; assets?: string; apath?: string; av?: string; atah?: boolean; in_town?: boolean; server?: string; gil?: number; mog?: boolean; nomad_near?: boolean }
  | { t: 'self'; id: number; name: string; main?: string; main_lvl?: number; sub?: string; sub_lvl?: number; zone?: number; zone_name?: string; px?: number; py?: number; assets?: string; apath?: string; av?: string; atah?: boolean; in_town?: boolean; server?: string; gil?: number; mog?: boolean; nomad_near?: boolean }
  | { t: 'inv'; id?: number; bags: InvBag[] }
  | { t: 'keyitems'; items: KeyItem[] }
  | { t: 'pool'; items: PoolItem[] }
  | { t: 'autolot'; on: boolean; all?: boolean }
  | { t: 'party'; key: string; members: string[]; size: number }
  | { t: 'slips'; slips: Slip[] }
  | { t: 'orgstatus'; active: boolean; total: number; done: number }
  | { t: 'orgplan'; steps: OrgStep[] }
  | { t: 'orgpreview'; steps: OrgStep[] }
  | { t: 'orgstep'; i: number; ok: boolean }
  | { t: 'dropmap'; map: Record<string, number> }
  | { t: 'currency'; gil: number; list: CurrencyEntry[] }
  | { t: 'ah'; atah: boolean; init: boolean; qn: number; slots: AhSlot[] }
  | { t: 'dbox'; in: DboxSlot[]; out: DboxSlot[] }
  | { t: 'dboxstatus'; busy: boolean; queue: number; kind: string; phase: string; note: string; cooldown?: number; opening?: boolean; loading?: boolean; open?: string }
  | { t: 'tradestatus'; active: boolean; stage?: string; done?: number; total?: number; target?: string; result?: string }
  | { t: 'shop'; items: ShopItem[] }
  | { t: 'porter'; active: boolean; op?: 'store' | 'retrieve'; total?: number; done?: number }
  | { t: 'portermoogle'; near: boolean }
  | { t: 'vendornear'; sparks: boolean; unity: boolean; curio: boolean }
  | { t: 'convert'; active: boolean; shop: string; item: number; bought: number; total: number; phase: string }
  | { t: 'resupply'; active: boolean; item: number; have: number; target: number; phase: string }
  | { t: 'pvendor'; active: boolean; item: number; have: number; target: number; phase: string }
  | { t: 'pvendornear'; name: string | null }
  | { t: 'use'; active: boolean; id: number; name: string; done: number; total: number }
  | { t: 'storezone'; npcs: StoreNpc[] }
  | { t: 'storelearn'; npc: string; zone: number; id: number; index: number; items: number[]; batch?: number }
  | { t: 'store'; active: boolean; item?: number; done?: number; total?: number; phase?: string }
  | { t: 'curioscan'; active: boolean; opt: number; max: number; count: number }
  | { t: 'curiocatalog'; items: CurioCatalogItem[] }
  | { t: 'npcnear'; name: string | null; id?: number; index?: number }
  | { t: 'fixednear'; names: string[] }
  | { t: 'npclearn'; npc: string; option: number }
  | { t: 'aug'; active: boolean; mode?: string; attempts?: number; total?: number; status?: string; results?: Record<string, number>; multi?: boolean; step?: number; stepCount?: number; augs?: string[]; item?: string; id?: number }
  | { t: 'auginfo'; cape: string | null; augments?: string[] }
  | { t: 'bzsellers'; list: BazaarSeller[]; mem?: boolean }
  | { t: 'bzitems'; seller: string | null; id?: number; index?: number; items: BazaarItem[] }
  | { t: 'bzmy'; items: MyBazaarItem[] }
  | { t: 'bzscan'; active: boolean; total: number; done: number; current?: string }
  | { t: 'bzbuy'; ok: boolean; name: string; reason: string; sellerid: number; bidx: number; qty: number }
  | { t: 'bzclear' }
  | { t: 'ahmsg'; ok: boolean; text: string }
  | { t: 'ahlisted'; ok: boolean; id: number; n: string; c: number; p: number; reason: string }
  | { t: 'ahcatstart'; n: number }
  | { t: 'ahcat'; items: AhCatItem[] }
  | { t: 'ahcatend' }
  | { t: 'iconjob'; done: number; total: number; running: boolean }
  | { t: 'seqack'; seq: number; ok: boolean; reason?: string }
  | { t: 'axcmd'; char: string; target?: string; args: string[] };

const byConn = new Map<number, Box>();
const persisted = new Map<string, PersistedChar>();
const listeners = new Set<() => void>();
let liveSnapshot: Box[] = [];
let knownSnapshot: KnownChar[] = [];
let started = false;

function rebuild() {
  liveSnapshot = [...byConn.values()].sort((a, b) => a.name.localeCompare(b.name));
  const known = new Map<string, KnownChar>();
  for (const [name, pc] of persisted) {
    known.set(name, { name, online: false, main: pc.main, sub: pc.sub, zoneName: pc.zoneName, assets: pc.assets, inv: pc.inv, keyItems: pc.keyItems, keyAt: pc.keyAt, cur: pc.cur, curAt: pc.curAt, savedAt: pc.savedAt });
  }
  for (const b of liveSnapshot) {
    const pc = persisted.get(b.name);
    known.set(b.name, {
      name: b.name, id: b.id, online: true, conn: b.conn,
      main: b.main, sub: b.sub, zone: b.zone, zoneName: b.zoneName, px: b.px, py: b.py, assets: b.assets,
      inv: b.inv ?? pc?.inv, keyItems: b.keyItems ?? pc?.keyItems, keyAt: b.keyAt ?? pc?.keyAt, pool: b.pool, party: b.party, slips: b.slips, org: b.org, orgPlan: b.orgPlan, orgPreview: b.orgPreview, orgDone: b.orgDone, orgOk: b.orgOk, cur: b.cur ?? pc?.cur, curAt: b.curAt ?? pc?.curAt, atah: b.atah, inTown: b.inTown, server: b.server, gil: b.gil, mog: b.mog, nomadNear: b.nomadNear, ah: b.ah, dbox: b.dbox, dboxStatus: b.dboxStatus, tradeStatus: b.tradeStatus, shop: b.shop, npcNear: b.npcNear, fixedNear: b.fixedNear, porter: b.porter, porterNear: b.porterNear, vendorNear: b.vendorNear, convert: b.convert, resupply: b.resupply, pvendor: b.pvendor, pvendorNear: b.pvendorNear, useProg: b.useProg, storeZone: b.storeZone, store: b.store, aug: b.aug, augInfo: b.augInfo, bzSellers: b.bzSellers, bzListings: b.bzListings, bzMy: b.bzMy, bzScan: b.bzScan, bzMem: b.bzMem, savedAt: pc?.savedAt,
    });
  }
  knownSnapshot = [...known.values()].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1));
  listeners.forEach((l) => l());
  syncTradeWhitelist();
}

let rebuildPending = false;
function scheduleRebuild() {
  if (rebuildPending) return;
  rebuildPending = true;
  setTimeout(() => { rebuildPending = false; rebuild(); }, 150);
}

export async function appDataPath(rel: string): Promise<string> {
  const base = (await appLocalDataDir()).replace(/[\\/]+$/, '');
  return `${base}/${rel}`;
}

let cacheDirCache: string | null = null;
async function cacheDir(): Promise<string> {
  if (cacheDirCache) return cacheDirCache;
  cacheDirCache = await appDataPath('characters');
  return cacheDirCache;
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9]/g, '_');

async function writeCharFile(pc: PersistedChar) {
  if (!inTauri) return;
  try {
    const dir = await cacheDir();
    await invoke('write_text_file', { path: `${dir}/${safeName(pc.name)}.json`, contents: JSON.stringify(pc) });
  } catch { /* ignore */ }
}

const diskTimers = new Map<string, number>();
function schedulePersist(pc: PersistedChar) {
  const prevPc = persisted.get(pc.name);
  persisted.set(pc.name, prevPc ? { ...prevPc, ...pc } : pc);
  if (!inTauri || diskTimers.has(pc.name)) return;
  const t = window.setTimeout(() => {
    diskTimers.delete(pc.name);
    const latest = persisted.get(pc.name);
    if (latest) void writeCharFile(latest);
  }, 3000);
  diskTimers.set(pc.name, t);
}

async function loadPersisted() {
  if (!inTauri) return;
  try {
    const dir = await cacheDir();
    const files = await invoke<string[]>('list_dir', { path: dir });
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      try {
        const txt = await invoke<string>('read_text_file', { path: f });
        const pc = JSON.parse(txt) as PersistedChar;
        if (pc && pc.name) persisted.set(pc.name, pc);
      } catch { /* skip bad file */ }
    }
    rebuild();
  } catch { /* ignore */ }
}

// Drop a character's cached currency snapshot from memory and disk. For a character that can't be
// logged in to self-correct (e.g. a mule that inherited another character's Currency 2 before the
// addon ownership fix), this is the only way to clear a stale value. It repopulates correctly if
// the character ever connects again.
export async function clearCharCurrency(name: string): Promise<void> {
  const pc = persisted.get(name);
  if (pc) {
    const next = { ...pc }; delete next.cur; delete next.curAt;
    persisted.set(name, next);
    if (inTauri) {
      try { await invoke('write_text_file', { path: `${await cacheDir()}/${safeName(name)}.json`, contents: JSON.stringify(next) }); } catch { /* ignore */ }
    }
  }
  for (const [conn, b] of byConn) {
    if (b.name === name && b.cur) { const next = { ...b }; delete next.cur; delete next.curAt; byConn.set(conn, next); }
  }
  rebuild();
}

// Unregister a character from Alexandria entirely: delete its cached snapshot (currency, inventory,
// key items, slips, everything) from memory and disk. It reappears only if that character logs in
// again, which re-registers it fresh. Only meaningful for offline characters -- an online one keeps
// broadcasting and would just re-register on the next frame.
export async function removeChar(name: string): Promise<void> {
  const t = diskTimers.get(name);
  if (t != null) { clearTimeout(t); diskTimers.delete(name); }
  persisted.delete(name);
  if (inTauri) {
    try { await invoke('delete_file', { path: `${await cacheDir()}/${safeName(name)}.json` }); } catch { /* ignore */ }
  }
  for (const [conn, b] of byConn) if (b.name === name) byConn.delete(conn);
  rebuild();
}

function mergeInv(prev: InvBag[] | undefined, next: InvBag[]): InvBag[] {
  if (!prev || prev.length === 0) return next;
  const have = new Set(next.map((b) => b.id));
  const kept = prev.filter((b) => !have.has(b.id));
  return kept.length ? [...next, ...kept] : next;
}

function onLine(conn: number, line: string) {
  let f: Frame;
  try { f = JSON.parse(line) as Frame; } catch { return; }
  const prev = byConn.get(conn);
  if (f.t === 'seqack') { resolveSeqAck(f.seq, f.ok, f.reason); return; }
  if (f.t === 'axcmd') { axHandler?.(conn, f.char, f.target, f.args); return; }
  // One character learned a storage NPC — rebroadcast it to the whole fleet so every
  // connected addon registers it immediately (already-running characters don't re-read
  // the shared discovered file on their own).
  if (f.t === 'storelearn') {
    void broadcastBoxCommand(JSON.stringify({ cmd: 'storeadd', npc: f.npc, zone: f.zone, id: f.id, index: f.index, items: f.items, ...(f.batch != null ? { batch: f.batch } : {}) }));
    return;
  }
  if (f.t === 'hello' || f.t === 'self') {
    // A DIFFERENT character identifying on this same connection (a shared POL client swap)
    // must start clean -- otherwise it inherits the previous character's inventory, slips,
    // currency, etc. (and mergeInv then grafts the old bags onto the new character). Only
    // reuse prior per-character data when the very same character is reconnecting.
    const sameChar = !!prev && prev.id === f.id;
    const carry = sameChar ? prev : undefined;
    // Seed the online box from THIS character's own persisted snapshot (looked up by name,
    // so never another character's). Mog storage -- Locker/Safe/Storage -- only loads at a
    // Moogle and reads empty in the field, so without a seed the first live report would
    // shadow the last-known contents and the Locker would vanish. Seeding lets mergeInv
    // keep it through field reports.
    const pc = persisted.get(f.name);
    const next: Box = {
      conn,
      id: f.id,
      name: f.name,
      main: f.main ?? carry?.main,
      mainLvl: f.main_lvl ?? carry?.mainLvl,
      sub: f.sub ?? carry?.sub,
      subLvl: f.sub_lvl ?? carry?.subLvl,
      zone: f.zone ?? carry?.zone,
      zoneName: f.zone_name ?? carry?.zoneName,
      px: f.px ?? carry?.px,
      py: f.py ?? carry?.py,
      assets: f.assets ?? carry?.assets,
      apath: f.apath ?? carry?.apath,
      av: f.av ?? carry?.av,
      atah: f.atah ?? carry?.atah,
      inTown: f.in_town ?? carry?.inTown,
      server: f.server ?? carry?.server,
      gil: f.gil ?? carry?.gil,
      mog: f.mog ?? carry?.mog,
      nomadNear: f.nomad_near ?? carry?.nomadNear,
      inv: carry?.inv ?? pc?.inv,
      invAt: carry?.invAt ?? 0,
      keyItems: carry?.keyItems ?? pc?.keyItems,
      party: carry?.party,
      storeZone: carry?.storeZone,
      store: carry?.store,
      pool: carry?.pool,
      slips: carry?.slips,
      org: carry?.org,
      orgPlan: carry?.orgPlan,
      orgPreview: carry?.orgPreview,
      orgDone: carry?.orgDone,
      orgOk: carry?.orgOk,
      cur: carry?.cur ?? pc?.cur,
      curAt: carry?.curAt ?? pc?.curAt,
      keyAt: carry?.keyAt ?? pc?.keyAt,
      ah: carry?.ah,
      dbox: carry?.dbox,
      dboxStatus: carry?.dboxStatus,
      tradeStatus: carry?.tradeStatus,
      shop: carry?.shop,
      npcNear: carry?.npcNear,
      fixedNear: carry?.fixedNear,
      porter: carry?.porter,
      porterNear: carry?.porterNear,
      vendorNear: carry?.vendorNear,
      convert: carry?.convert,
      resupply: carry?.resupply,
      pvendor: carry?.pvendor,
      pvendorNear: carry?.pvendorNear,
      useProg: carry?.useProg,
      aug: carry?.aug,
      augInfo: carry?.augInfo,
      bzSellers: carry?.bzSellers,
      bzListings: carry?.bzListings,
      bzMy: carry?.bzMy,
      bzScan: carry?.bzScan,
      bzMem: carry?.bzMem,
      lastSeen: Date.now(),
    };
    byConn.set(conn, next);
    noteAssetsDir(next.assets);
    // Rebuild React only when UI-visible state changed, not on a heartbeat-only lastSeen bump.
    const changed = !prev
      || prev.name !== next.name || prev.main !== next.main || prev.sub !== next.sub
      || prev.zoneName !== next.zoneName || prev.assets !== next.assets || prev.inv !== next.inv
      || prev.atah !== next.atah || prev.server !== next.server || prev.gil !== next.gil || prev.mog !== next.mog || prev.nomadNear !== next.nomadNear;
    if (changed) scheduleRebuild();
  } else if (f.t === 'inv' && prev) {
    // Inventory is attributed by connection, not by name. On a shared-client swap the
    // identity ('self') can lag the incoming character's loading bags by up to a send
    // cycle, so an inv feed whose id doesn't match this box belongs to the character that
    // just logged out -- drop it instead of corrupting the previous character's snapshot.
    if (f.id != null && prev.id != null && f.id !== prev.id) return;
    const bags = mergeInv(prev.inv, f.bags);
    const box: Box = { ...prev, inv: bags, invAt: Date.now(), lastSeen: Date.now() };
    byConn.set(conn, box);
    schedulePersist({
      name: box.name, id: box.id,
      main: box.main, mainLvl: box.mainLvl, sub: box.sub, subLvl: box.subLvl,
      zoneName: box.zoneName, assets: box.assets, inv: bags, savedAt: Date.now(),
    });
    invHooks.forEach((fn) => fn(box.name, bags));
    scheduleRebuild();
  } else if (f.t === 'keyitems' && prev) {
    const now = Date.now();
    byConn.set(conn, { ...prev, keyItems: f.items, keyAt: now, lastSeen: now });
    schedulePersist({
      name: prev.name, id: prev.id,
      main: prev.main, mainLvl: prev.mainLvl, sub: prev.sub, subLvl: prev.subLvl,
      zoneName: prev.zoneName, assets: prev.assets, keyItems: f.items, keyAt: now, savedAt: now,
    });
    scheduleRebuild();
  } else if (f.t === 'pool' && prev) {
    byConn.set(conn, { ...prev, pool: f.items, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'party' && prev) {
    byConn.set(conn, { ...prev, party: { key: f.key, members: f.members, size: f.size }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'slips' && prev) {
    byConn.set(conn, { ...prev, slips: f.slips, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'currency' && prev) {
    const now = Date.now();
    const cur = { gil: f.gil, list: f.list };
    byConn.set(conn, { ...prev, cur, curAt: now, lastSeen: now });
    schedulePersist({
      name: prev.name, id: prev.id,
      main: prev.main, mainLvl: prev.mainLvl, sub: prev.sub, subLvl: prev.subLvl,
      zoneName: prev.zoneName, assets: prev.assets, cur, curAt: now, savedAt: now,
    });
    scheduleRebuild();
  } else if (f.t === 'orgstatus' && prev) {
    byConn.set(conn, { ...prev, org: { active: f.active, total: f.total, done: f.done }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'orgplan' && prev) {
    byConn.set(conn, { ...prev, orgPlan: f.steps, orgDone: [], orgOk: [], lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'orgpreview' && prev) {
    byConn.set(conn, { ...prev, orgPreview: f.steps, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'orgstep' && prev) {
    byConn.set(conn, {
      ...prev,
      orgDone: [...(prev.orgDone ?? []), f.i],
      orgOk: f.ok ? [...(prev.orgOk ?? []), f.i] : prev.orgOk,
      lastSeen: Date.now(),
    });
    scheduleRebuild();
  } else if (f.t === 'autolot') {
    autoLotFeedCb?.(prev?.name, f.on, !!f.all);
  } else if (f.t === 'ah' && prev) {
    byConn.set(conn, { ...prev, ah: { atah: f.atah, init: f.init, qn: f.qn, slots: f.slots }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'dbox' && prev) {
    byConn.set(conn, { ...prev, dbox: { in: f.in, out: f.out }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'dboxstatus' && prev) {
    byConn.set(conn, { ...prev, dboxStatus: { busy: f.busy, queue: f.queue, kind: f.kind, phase: f.phase, note: f.note, cooldown: f.cooldown, opening: f.opening, loading: f.loading, open: f.open }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'tradestatus' && prev) {
    byConn.set(conn, { ...prev, tradeStatus: { active: f.active, stage: f.stage, done: f.done, total: f.total, target: f.target, result: f.result }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'shop' && prev) {
    byConn.set(conn, { ...prev, shop: { items: f.items }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'porter' && prev) {
    byConn.set(conn, { ...prev, porter: { active: f.active, op: f.op, total: f.total, done: f.done }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'portermoogle' && prev) {
    byConn.set(conn, { ...prev, porterNear: f.near, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'vendornear' && prev) {
    byConn.set(conn, { ...prev, vendorNear: { sparks: f.sparks, unity: f.unity, curio: f.curio }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'convert' && prev) {
    byConn.set(conn, { ...prev, convert: { active: f.active, shop: f.shop, item: f.item, bought: f.bought, total: f.total, phase: f.phase }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'resupply' && prev) {
    byConn.set(conn, { ...prev, resupply: { active: f.active, item: f.item, have: f.have, target: f.target, phase: f.phase }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'pvendor' && prev) {
    byConn.set(conn, { ...prev, pvendor: { active: f.active, item: f.item, have: f.have, target: f.target, phase: f.phase }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'pvendornear' && prev) {
    byConn.set(conn, { ...prev, pvendorNear: f.name, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'use' && prev) {
    byConn.set(conn, { ...prev, useProg: { active: f.active, id: f.id, name: f.name, done: f.done, total: f.total }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'storezone' && prev) {
    byConn.set(conn, { ...prev, storeZone: f.npcs, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'store' && prev) {
    byConn.set(conn, { ...prev, store: { active: f.active, item: f.item ?? 0, done: f.done ?? 0, total: f.total ?? 0, phase: f.phase ?? '' }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'curiocatalog') {
    curioCatalogHook?.(prev?.server, f.items);
  } else if (f.t === 'npcnear' && prev) {
    byConn.set(conn, { ...prev, npcNear: { name: f.name, id: f.id, index: f.index }, lastSeen: Date.now() });
  } else if (f.t === 'fixednear' && prev) {
    byConn.set(conn, { ...prev, fixedNear: f.names, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'aug' && prev) {
    byConn.set(conn, { ...prev, aug: { active: f.active, mode: f.mode, attempts: f.attempts, total: f.total, status: f.status, results: f.results, multi: f.multi, step: f.step, stepCount: f.stepCount, augs: f.augs, item: f.item, id: f.id }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'auginfo' && prev) {
    byConn.set(conn, { ...prev, augInfo: { cape: f.cape, augments: f.augments }, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzsellers' && prev) {
    let listings = prev.bzListings;
    if (f.mem && listings) {
      const present = new Set(f.list.map((s) => s.id));
      let changed = false;
      const kept: Record<number, BazaarListing> = {};
      for (const k in listings) { const id = Number(k); if (present.has(id)) kept[id] = listings[id]; else changed = true; }
      if (changed) listings = kept;
    }
    byConn.set(conn, { ...prev, bzSellers: f.list, bzMem: f.mem, bzListings: listings, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzitems' && prev) {
    const listings = { ...(prev.bzListings ?? {}) };
    if (f.id != null) listings[f.id] = { seller: f.seller ?? '', sellerId: f.id, sellerIndex: f.index ?? 0, items: f.items, at: Date.now() };
    byConn.set(conn, { ...prev, bzListings: listings, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzmy' && prev) {
    byConn.set(conn, { ...prev, bzMy: f.items, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzscan' && prev) {
    const freshStart = f.active && f.done === 0;
    byConn.set(conn, { ...prev, bzScan: { active: f.active, total: f.total, done: f.done, current: f.current }, bzListings: freshStart ? {} : prev.bzListings, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzclear' && prev) {
    byConn.set(conn, { ...prev, bzListings: {}, bzScan: undefined, lastSeen: Date.now() });
    scheduleRebuild();
  } else if (f.t === 'bzbuy') {
    if (f.ok && prev && f.sellerid && f.bidx >= 0) {
      const listings = { ...(prev.bzListings ?? {}) };
      const l = listings[f.sellerid];
      if (l) {
        const items = l.items.map((it) => (it.bidx === f.bidx ? { ...it, qty: it.qty - f.qty } : it)).filter((it) => it.qty > 0);
        listings[f.sellerid] = { ...l, items };
        byConn.set(conn, { ...prev, bzListings: listings, lastSeen: Date.now() });
        scheduleRebuild();
      }
    }
    pushBzBuy({ conn, ok: f.ok, name: f.name, reason: f.reason, at: Date.now() });
  } else if (f.t === 'npclearn') {
    lastLearn = { conn, npc: f.npc, option: f.option, at: Date.now() };
    learnListeners.forEach((l) => l());
  } else if (f.t === 'ahmsg') {
    pushAhMsg({ conn, ok: f.ok, text: f.text, at: Date.now() });
  } else if (f.t === 'ahlisted') {
    resolveListing(conn, f.ok, f.n, f.reason);
  } else if (f.t === 'ahcatstart') {
    ahCatBuf = [];
    ahCatExpected = f.n;
    ahCatLoading = true;
    ahCatListeners.forEach((l) => l());
  } else if (f.t === 'ahcat') {
    for (const it of f.items) ahCatBuf.push(it);
    ahCatListeners.forEach((l) => l());
  } else if (f.t === 'ahcatend') {
    // Streamed items have no AH category; backfill from the bundled map by id.
    ahCat = ahCatBuf.map((it) => (it.ac != null ? it : { ...it, ac: bundledAcMap.get(it.id) ?? 0 }));
    ahCatBuf = [];
    ahCatLoading = false;
    void saveCatalog();
    ahCatListeners.forEach((l) => l());
  } else if (f.t === 'iconjob') {
    if (!f.running) void refreshIconSet();
  } else if (f.t === 'dropmap') {
    const next = { ...dropIconMap };
    let changed = false;
    for (const k in f.map) { if (next[k] !== f.map[k]) { next[k] = f.map[k]; changed = true; } }
    if (changed) { dropIconMap = next; dropMapListeners.forEach((l) => l()); }
  }
}

export type AhMsg = { conn: number; ok: boolean; text: string; at: number };
let ahMsgs: AhMsg[] = [];
const ahMsgListeners = new Set<() => void>();
let ahMsgSeq = 0;
function pushAhMsg(m: AhMsg) {
  ahMsgSeq++;
  ahMsgs = [{ ...m, at: m.at + ahMsgSeq / 1000 }, ...ahMsgs].slice(0, 6);
  ahMsgListeners.forEach((l) => l());
}
export function useAhMessages(): AhMsg[] {
  return useSyncExternalStore((cb) => { ahMsgListeners.add(cb); return () => ahMsgListeners.delete(cb); }, () => ahMsgs, () => ahMsgs);
}

export function nextAhMsg(conn: number, timeoutMs = 10000): Promise<AhMsg | null> {
  const startAt = ahMsgs.find((m) => m.conn === conn)?.at ?? 0;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: AhMsg | null) => { if (done) return; done = true; ahMsgListeners.delete(cb); clearTimeout(to); resolve(v); };
    const cb = () => { const m = ahMsgs.find((x) => x.conn === conn); if (m && m.at > startAt) finish(m); };
    const to = setTimeout(() => finish(null), timeoutMs);
    ahMsgListeners.add(cb);
  });
}

export type AhListing = { key: number; conn: number; name: string; status: 'pending' | 'ok' | 'fail'; reason?: string; at: number; batchId?: number };
let ahListings: AhListing[] = [];
let listingSeq = 0;
let batchSeq = 0;
const listingListeners = new Set<() => void>();
const notifyListings = () => { ahListings = ahListings.length > 300 ? ahListings.slice(-300) : [...ahListings]; listingListeners.forEach((l) => l()); };
function removeListingLater(key: number, ms: number) {
  setTimeout(() => { ahListings = ahListings.filter((l) => l.key !== key); listingListeners.forEach((l) => l()); }, ms);
}
export function newBatchId(): number { batchSeq += 1; return batchSeq; }
export function addPendingListing(conn: number, name: string, batchId?: number): number {
  listingSeq += 1;
  const key = listingSeq;
  ahListings.push({ key, conn, name, status: 'pending', at: Date.now(), batchId });
  notifyListings();
  // Backstop: if no result ever arrives (e.g. a cross-bag move was blocked), fail it.
  setTimeout(() => {
    const e = ahListings.find((l) => l.key === key);
    if (e && e.status === 'pending') { e.status = 'fail'; e.reason = 'Timed out waiting for the auction house'; notifyListings(); }
  }, 60000);
  return key;
}
function resolveListing(conn: number, ok: boolean, name: string, reason: string) {
  const e = ahListings.find((l) => l.conn === conn && l.status === 'pending');
  if (e) {
    e.status = ok ? 'ok' : 'fail';
    e.reason = ok ? undefined : reason;
    if (!e.name && name) e.name = name;
  } else {
    listingSeq += 1;
    ahListings.push({ key: listingSeq, conn, name, status: ok ? 'ok' : 'fail', reason: ok ? undefined : reason, at: Date.now() });
  }
  notifyListings();
  // Single (non-batch) successes auto-dismiss; batch entries persist until the
  // batch panel is cleared so the progress view stays complete.
  const resolved = e ?? ahListings[ahListings.length - 1];
  if (ok && !resolved.batchId) removeListingLater(resolved.key, 4000);
}
export function dismissListing(key: number) { ahListings = ahListings.filter((l) => l.key !== key); listingListeners.forEach((l) => l()); }
export function dismissBatch(batchId: number) { ahListings = ahListings.filter((l) => l.batchId !== batchId); listingListeners.forEach((l) => l()); }
export function useAhListings(): AhListing[] {
  return useSyncExternalStore((cb) => { listingListeners.add(cb); return () => listingListeners.delete(cb); }, () => ahListings, () => ahListings);
}

export function ahMenu(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahmenu' })); }
export function ahSlots(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahslots' })); }
export function ahBuy(conn: number, id: number, single: number, price: number, qty: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahbuy', id, single, price, qty })); }
export function ahSell(conn: number, id: number, single: number, price: number, qty: number, bag?: number, slot?: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'ahsell', id, single, price, qty, ...(bag != null ? { bag, slot } : {}) }));
}
export function ahClearSlot(conn: number, slot: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahclearslot', slot })); }
export function ahCancel(conn: number, slot: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahcancel', slot })); }
export function ahClearSold(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahclearsold' })); }
export function requestAhCatalog(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'ahcatalog' })); }
export function requestIcons(conn: number, ids: number[]) { if (ids.length) sendBoxCommand(conn, JSON.stringify({ cmd: 'iconreq', ids })); }

let ahCat: AhCatItem[] = [];
let ahCatBuf: AhCatItem[] = [];
let ahCatExpected = 0;
let ahCatLoading = false;
let ahCatStarted = false;
let bundledAcMap = new Map<number, number>();
const ahCatListeners = new Set<() => void>();

async function loadCatalog() {
  if (ahCatStarted) return;
  ahCatStarted = true;

  // Bundled pack is authoritative (has AH categories); the streamed "Refresh From Game" cache only adds items the bundle is missing, enriched by id where possible.
  let bundled: AhCatItem[] = [];
  try {
    const resp = await fetch('/ah_catalog.json');
    if (resp.ok) { const p = await resp.json(); if (Array.isArray(p)) bundled = p; }
  } catch { /* no bundled pack (dev without build:catalog) */ }

  let cached: AhCatItem[] | null = null;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('ah_catalog.json') });
      const p = JSON.parse(txt);
      if (Array.isArray(p) && p.length) cached = p;
    } catch { /* no cache */ }
  }

  bundledAcMap = new Map(bundled.map((b) => [b.id, b.ac ?? 0]));
  if (bundled.length) {
    const have = new Set(bundled.map((b) => b.id));
    const extras = (cached ?? []).filter((it) => !have.has(it.id)).map((it) => ({ ...it, ac: it.ac ?? 0 }));
    ahCat = extras.length ? [...bundled, ...extras] : bundled;
  } else {
    ahCat = cached ?? [];
  }
  ahCatListeners.forEach((l) => l());
}
async function saveCatalog() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('ah_catalog.json'), contents: JSON.stringify(ahCat) }); } catch { /* ignore */ }
}
void loadCatalog();

export type AhCatalog = { items: AhCatItem[]; loading: boolean; loaded: number; expected: number };
export function useAhCatalog(): AhCatalog {
  const snap = useSyncExternalStore(
    (cb) => { ahCatListeners.add(cb); return () => ahCatListeners.delete(cb); },
    () => `${ahCat.length}|${ahCatBuf.length}|${ahCatLoading ? 1 : 0}|${ahCatExpected}`,
    () => '0|0|0|0',
  );
  return useMemo(() => ({
    items: ahCatLoading ? ahCatBuf : ahCat,
    loading: ahCatLoading,
    loaded: ahCatLoading ? ahCatBuf.length : ahCat.length,
    expected: ahCatExpected,
  }), [snap]);
}

// Reactive id -> AH category id map, from the loaded catalog.
export function useAcMap(): Map<number, number> {
  const snap = useSyncExternalStore(
    (cb) => { ahCatListeners.add(cb); return () => ahCatListeners.delete(cb); },
    () => ahCat.length,
    () => 0,
  );
  return useMemo(() => {
    const m = new Map<number, number>();
    for (const it of ahCat) if (it.ac) m.set(it.id, it.ac);
    return m;
  }, [snap]);
}

export type MarketSale = { date: string; price: number; seller: string; buyer: string; ts?: number };
export type MarketData = { stock?: string; rate?: string; median?: string; sales: MarketSale[]; listedTotal?: number };

let descMap: Record<string, string> | null = null;
let descLoading = false;
const descListeners = new Set<() => void>();
async function ensureDescriptions() {
  if (descMap || descLoading) return;
  descLoading = true;
  try { const r = await fetch('/ah_descriptions.json'); if (r.ok) descMap = await r.json(); } catch { /* no bundled descriptions */ }
  descLoading = false;
  descListeners.forEach((l) => l());
}
export function useItemDescription(id: number): string | null {
  useSyncExternalStore((cb) => { descListeners.add(cb); return () => descListeners.delete(cb); }, () => (descMap ? 1 : 0), () => 0);
  useEffect(() => { void ensureDescriptions(); }, []);
  return descMap ? (descMap[String(id)] ?? null) : null;
}

export const FFXIAH_SID: Record<string, number> = {
  Asura: 28, Bahamut: 1, Bismarck: 25, Carbuncle: 6, Cerberus: 23, Fenrir: 7,
  Lakshmi: 27, Leviathan: 11, Odin: 12, Phoenix: 5, Quetzalcoatl: 16, Ragnarok: 20,
  Shiva: 2, Siren: 17, Sylph: 8, Valefor: 9,
};

export function ffxiahSid(server?: string): number | undefined {
  if (!server) return undefined;
  const t = server.trim();
  if (FFXIAH_SID[t] != null) return FFXIAH_SID[t];
  const lc = t.toLowerCase();
  for (const k in FFXIAH_SID) if (k.toLowerCase() === lc) return FFXIAH_SID[k];
  return undefined;
}

type AhSale = { price: number; date: number; seller: string; buyer: string };
type AhHistory = { item: number; count: number; cat: number; sales: AhSale[] };
type AhListingCount = { id: number; single: number; stack: number };
type AhCategory = { total: number; items: AhListingCount[] };

const IP_PREFIX = '124.150.154.';
const WORLD_OFFSET: Record<string, number> = {
  Bahamut: 0, Shiva: 1, Phoenix: 2, Carbuncle: 3, Fenrir: 4, Sylph: 5, Valefor: 6, Leviathan: 7,
  Odin: 8, Quetzalcoatl: 9, Siren: 10, Ragnarok: 11, Cerberus: 12, Bismarck: 13, Lakshmi: 14, Asura: 15,
};
const WORLD_COUNT = 16;
const DEFAULT_BASE = 61;
const DEFAULT_WORLD = 'Siren';
const PROBE_ITEM = 4096;

let ipBase = DEFAULT_BASE;
let ahHealth: 'ok' | 'degraded' | 'unknown' = 'unknown';
let ahLastOkAt = 0;
let ahFails = 0;
let ahScanning = false;
let ahLastScanAt = 0;
let ahLoaded = false;
let ahSaveT: number | null = null;

export type AhServerHealth = { health: 'ok' | 'degraded' | 'unknown'; base: number; scanning: boolean; lastOkAt: number };
let ahSnap: AhServerHealth = { health: 'unknown', base: DEFAULT_BASE, scanning: false, lastOkAt: 0 };
const ahHealthSubs = new Set<() => void>();
function notifyAhHealth() {
  ahSnap = { health: ahHealth, base: ipBase, scanning: ahScanning, lastOkAt: ahLastOkAt };
  ahHealthSubs.forEach((f) => f());
}

function canonWorld(server?: string): string {
  const t = (server ?? '').trim();
  if (WORLD_OFFSET[t] != null) return t;
  const lc = t.toLowerCase();
  for (const k in WORLD_OFFSET) if (k.toLowerCase() === lc) return k;
  return DEFAULT_WORLD;
}

function searchServerIp(server?: string): string {
  return `${IP_PREFIX}${ipBase + WORLD_OFFSET[canonWorld(server)]}`;
}

async function loadAhBase() {
  if (ahLoaded) return;
  ahLoaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('ah_servers.json') });
    const p = JSON.parse(txt);
    if (p && typeof p.base === 'number' && p.base >= 1 && p.base + WORLD_COUNT - 1 <= 254) { ipBase = p.base; notifyAhHealth(); }
  } catch { /* none saved */ }
}

function saveAhBase() {
  if (!inTauri || ahSaveT != null) return;
  ahSaveT = window.setTimeout(async () => {
    ahSaveT = null;
    try { await invoke('write_text_file', { path: await appDataPath('ah_servers.json'), contents: JSON.stringify({ base: ipBase }) }); } catch { /* ignore */ }
  }, 500);
}

async function probeIp(ip: string, timeoutMs = 1800): Promise<boolean> {
  try {
    const res = await Promise.race([
      invoke<AhHistory>('ah_history', { host: ip, itemId: PROBE_ITEM, stack: false }),
      new Promise<null>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return !!res && (res as AhHistory).item === PROBE_ITEM;
  } catch { return false; }
}

function noteAhOk() {
  ahLastOkAt = Date.now();
  ahFails = 0;
  if (ahHealth !== 'ok') ahHealth = 'ok';
  notifyAhHealth();
}

function noteAhFail() {
  ahFails++;
  if (ahFails >= 3) {
    if (ahHealth !== 'degraded') { ahHealth = 'degraded'; notifyAhHealth(); }
    void healServers(false);
  }
}

async function healServers(manual: boolean): Promise<boolean> {
  if (ahScanning) return false;
  const now = Date.now();
  if (!manual && now - ahLastScanAt < 5 * 60 * 1000) return false;
  ahScanning = true; ahLastScanAt = now; notifyAhHealth();
  try {
    const live: boolean[] = new Array(255).fill(false);
    const octets: number[] = [];
    for (let o = 1; o <= 254; o++) octets.push(o);
    let idx = 0;
    const worker = async () => {
      while (idx < octets.length) {
        const o = octets[idx++];
        live[o] = await probeIp(`${IP_PREFIX}${o}`);
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    let found = -1;
    for (let s = 1; s + WORLD_COUNT - 1 <= 254; s++) {
      let all = true;
      for (let k = 0; k < WORLD_COUNT; k++) if (!live[s + k]) { all = false; break; }
      if (!all) continue;
      const boundedBelow = s === 1 || !live[s - 1];
      const boundedAbove = s + WORLD_COUNT > 254 || !live[s + WORLD_COUNT];
      if (boundedBelow && boundedAbove) { found = s; break; }
    }
    if (found > 0) {
      ipBase = found; saveAhBase();
      ahFails = 0; ahHealth = 'ok'; ahLastOkAt = Date.now();
      return true;
    }
    return false;
  } finally { ahScanning = false; notifyAhHealth(); }
}

export function useAhServerHealth(): AhServerHealth {
  return useSyncExternalStore(
    (cb) => { ahHealthSubs.add(cb); return () => { ahHealthSubs.delete(cb); }; },
    () => ahSnap,
    () => ahSnap,
  );
}

export function rescanAhServers(): Promise<boolean> { return healServers(true); }

function medianOf(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// FFXI players wash-transfer gil by listing cheap stackables near the 999,999,999
// cap, and those "sales" poison a plain median. A real price is orders of magnitude
// below a wash price, so drop anything >30x the cheapest sale. Legit recent sales
// rarely span 30x, so clean data is untouched. Shared with the price chart so the
// median and the plotted points hide the same wash trades, with no blacklist.
export function washCap(prices: number[]): number {
  let min = Infinity;
  for (const p of prices) if (p > 0 && p < min) min = p;
  return Number.isFinite(min) ? min * 30 : Infinity;
}
function robustMedianOf(nums: number[]): number | undefined {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (s.length < 2) return s.length ? s[0] : undefined;
  const cap = washCap(s);
  const kept = s.filter((p) => p <= cap);
  return medianOf(kept.length ? kept : s);
}

const NO_LISTING = 0xffffffff;
const marketInflight = new Map<string, Promise<MarketData>>();
const catCache = new Map<string, { at: number; p: Promise<AhCategory> }>();
const CAT_TTL = 60 * 1000;

function ahCategoryCached(ip: string, cat: number): Promise<AhCategory> {
  const k = `${ip}:${cat}`;
  const e = catCache.get(k);
  if (e && Date.now() - e.at < CAT_TTL) return e.p;
  const entry = { at: Date.now(), p: invoke<AhCategory>('ah_category', { host: ip, cat }) };
  catCache.set(k, entry);
  entry.p.catch(() => { if (catCache.get(k) === entry) catCache.delete(k); });
  return entry.p;
}

export function fetchMarket(id: number, stack: boolean, server?: string): Promise<MarketData> {
  void loadAhBase();
  const ip = searchServerIp(server);
  const key = `${id}:${stack ? 1 : 0}:${ip}`;
  const inflight = marketInflight.get(key);
  if (inflight) return inflight;
  const p = (async (): Promise<MarketData> => {
    let hist: AhHistory;
    try {
      hist = await invoke<AhHistory>('ah_history', { host: ip, itemId: id, stack });
    } catch (e) { noteAhFail(); throw e; }
    noteAhOk();
    const ordered = [...hist.sales].sort((a, b) => b.date - a.date);
    const sales: MarketSale[] = ordered.map((s) => ({
      date: s.date ? new Date(s.date * 1000).toLocaleDateString() : '',
      price: s.price, seller: s.seller, buyer: s.buyer, ts: s.date || undefined,
    }));
    const median = robustMedianOf(hist.sales.map((s) => s.price));
    const times = hist.sales.map((s) => s.date).filter((n) => n > 0);
    let rate: string | undefined;
    if (times.length >= 2) {
      const span = (Math.max(...times) - Math.min(...times)) / 86400;
      if (span > 0) rate = String(+((times.length - 1) / span).toFixed(2));
    }
    let stock: string | undefined;
    let listedTotal: number | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const c = await ahCategoryCached(ip, hist.cat);
        const row = c.items.find((it) => it.id === id);
        const single = row && row.single !== NO_LISTING ? row.single : 0;
        const stk = row && row.stack !== NO_LISTING ? row.stack : 0;
        stock = String(stack ? stk : single);
        listedTotal = stack ? stk : single;
        break;
      } catch { /* retry once */ }
    }
    if (median != null && median > 0) await logPriceSnapshot(server ?? '', id, stack, median, listedTotal ?? 0);
    return { median: median != null ? median.toLocaleString() : undefined, stock, rate, sales, listedTotal };
  })().finally(() => marketInflight.delete(key));
  marketInflight.set(key, p);
  return p;
}

export async function fetchCategoryCounts(server: string | undefined, cat: number): Promise<Record<number, { single: number; stack: number }>> {
  const ip = searchServerIp(server);
  const c = await ahCategoryCached(ip, cat);
  const out: Record<number, { single: number; stack: number }> = {};
  for (const it of c.items) out[it.id] = { single: it.single === NO_LISTING ? 0 : it.single, stack: it.stack === NO_LISTING ? 0 : it.stack };
  return out;
}

let dropIconMap: Record<string, number> = {};
const dropMapListeners = new Set<() => void>();
export function useDropIconMap(): Record<string, number> {
  return useSyncExternalStore((cb) => { dropMapListeners.add(cb); return () => dropMapListeners.delete(cb); }, () => dropIconMap, () => dropIconMap);
}

export async function startBridge() {
  if (started || !inTauri) return;
  started = true;
  await listen<{ conn: number; line: string }>('alexandria://box-msg', (e) => onLine(e.payload.conn, e.payload.line));
  await listen<number>('alexandria://box-gone', (e) => { byConn.delete(e.payload); rebuild(); });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useBoxes(): Box[] {
  return useSyncExternalStore(subscribe, () => liveSnapshot, () => liveSnapshot);
}

export function useKnownCharacters(): KnownChar[] {
  return useSyncExternalStore(subscribe, () => knownSnapshot, () => knownSnapshot);
}

export function getKnownCharacters(): KnownChar[] {
  return knownSnapshot;
}

export type AddonInfo = { dir: string; version: string | null };

const ADDON_DIR_KEY = 'alexandria-addon-dir';
const ADDON_VER_KEY = 'alexandria-addon-ver';
const ADDON_DIR_MANUAL_KEY = 'alexandria-addon-dir-manual';

const addonManualSubs = new Set<() => void>();

function persistAddon(info: AddonInfo): void {
  try {
    localStorage.setItem(ADDON_DIR_KEY, info.dir);
    localStorage.setItem(ADDON_VER_KEY, info.version ?? '');
  } catch { /* ignore */ }
}

function readPersistedAddon(): AddonInfo | null {
  try {
    const dir = localStorage.getItem(ADDON_DIR_KEY);
    if (dir) return { dir, version: localStorage.getItem(ADDON_VER_KEY) || null };
  } catch { /* ignore */ }
  return null;
}

export function getManualAddonDir(): string | null {
  try { return localStorage.getItem(ADDON_DIR_MANUAL_KEY) || null; } catch { return null; }
}

export function setManualAddonDir(dir: string | null): void {
  try {
    if (dir) localStorage.setItem(ADDON_DIR_MANUAL_KEY, dir.replace(/[\\/]+$/, ''));
    else localStorage.removeItem(ADDON_DIR_MANUAL_KEY);
  } catch { /* ignore */ }
  addonManualSubs.forEach((f) => f());
}

export function getConnectedAddonInfo(): AddonInfo | null {
  for (const b of byConn.values()) {
    if (b.apath) {
      const info = { dir: b.apath.replace(/[\\/]+$/, ''), version: b.av ?? null };
      persistAddon(info);
      return info;
    }
  }
  return null;
}

export function getAddonInfo(): AddonInfo | null {
  const manual = getManualAddonDir();
  const live = getConnectedAddonInfo();
  if (manual) return { dir: manual, version: live?.dir === manual ? live.version : null };
  return live ?? readPersistedAddon();
}

function addonKey(): string {
  let live = '';
  for (const b of liveSnapshot) if (b.apath) { live = `${b.apath}|${b.av ?? ''}`; break; }
  return `${getManualAddonDir() ?? ''}#${live}`;
}

export function useAddonInfo(): AddonInfo | null {
  const key = useSyncExternalStore(
    (cb) => { const un = subscribe(cb); addonManualSubs.add(cb); return () => { un(); addonManualSubs.delete(cb); }; },
    addonKey,
    () => '#',
  );
  return useMemo(() => getAddonInfo(), [key]);
}

// Which item-icon BMPs exist on disk, so the UI never requests a not-yet-extracted icon (404 spam); refreshed as the addon fills the folder.
let iconSet = new Set<number>();
const iconListeners = new Set<() => void>();
let iconAssetsDir: string | null = null;

async function refreshIconSet() {
  if (!inTauri || !iconAssetsDir) return;
  try {
    const files = await invoke<string[]>('list_dir', { path: iconAssetsDir });
    const next = new Set<number>();
    for (const f of files) {
      const m = /icon_(\d+)\.bmp$/i.exec(f);
      if (m) next.add(Number(m[1]));
    }
    if (next.size !== iconSet.size) {
      iconSet = next;
      iconListeners.forEach((l) => l());
    }
  } catch { /* ignore */ }
}

function noteAssetsDir(dir?: string) {
  if (!dir) return;
  if (dir !== iconAssetsDir) { iconAssetsDir = dir; void refreshIconSet(); }
}

export function useAvailableIcons(): Set<number> {
  return useSyncExternalStore(
    (cb) => { iconListeners.add(cb); return () => iconListeners.delete(cb); },
    () => iconSet,
    () => iconSet,
  );
}

export function sendBoxCommand(conn: number, line: string) {
  if (inTauri) void invoke('send_box_command', { conn, line }).catch(() => {});
}

type AxHandler = (conn: number, char: string, target: string | undefined, args: string[]) => void;
let axHandler: AxHandler | null = null;
export function onAxCommand(fn: AxHandler) { axHandler = fn; }

const invHooks = new Set<(name: string, bags: InvBag[]) => void>();
export function onInventoryUpdate(fn: (name: string, bags: InvBag[]) => void) { invHooks.add(fn); return () => invHooks.delete(fn); }
export function axEcho(conn: number, text: string) {
  const clean = text.replace(/[^\x20-\x7E]/g, '').slice(0, 150);
  sendBoxCommand(conn, JSON.stringify({ cmd: 'axecho', text: clean }));
}
export function useStop(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'usestop' })); }

let seqCounter = 1;
export function nextSeq(): number { return seqCounter++; }
export type SeqAck = { ok: boolean; reason?: string };
const seqWaiters = new Map<number, (a: SeqAck) => void>();
function resolveSeqAck(seq: number, ok: boolean, reason?: string) {
  const w = seqWaiters.get(seq);
  if (w) { seqWaiters.delete(seq); w({ ok, reason }); }
}
export function awaitSeqAck(seq: number, timeoutMs: number): Promise<SeqAck> {
  return new Promise((resolve) => {
    const to = window.setTimeout(() => { seqWaiters.delete(seq); resolve({ ok: false, reason: 'timeout' }); }, timeoutMs);
    seqWaiters.set(seq, (a) => { window.clearTimeout(to); resolve(a); });
  });
}

export function moveItem(conn: number, id: number, from: number, to: number, count: number, slot?: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'move', id, from, to, count, ...(slot != null ? { slot } : {}) }));
}

export function dboxOpen(conn: number, which: 'in' | 'out', cd?: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxopen', which, ...(cd != null ? { cd } : {}) }));
}

export function dboxClose(conn: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxclose' }));
}


export function dboxTake(conn: number, slots: number[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxtake', slots }));
}

export function dboxTakeAll(conn: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxtakeall' }));
}

export function dboxReturn(conn: number, slots: number[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxreturn', slots }));
}

export type DboxSendItem = { id: number; bag: number; slot: number; count: number; target: string };

export function dboxSendMany(conn: number, items: DboxSendItem[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxsendmany', items }));
}

export const GIL_MAIL_CAP = 1000000;
export function dboxSendGil(conn: number, amount: number, target: string) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxsendgil', amount, target }));
}

export function dboxCancel(conn: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'dboxcancel' }));
}

export function shopBuy(conn: number, idx: number, qty: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'shopbuy', idx, qty }));
}

export function shopSell(conn: number, id: number, qty: number, bag = 0, slot?: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'shopsell', id, qty, bag, ...(slot != null ? { slot } : {}) }));
}

export function broadcastShopSell(ids: number[], auto: boolean, anywhere: boolean) {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'shopsell_set', ids, auto, anywhere }));
}

export function npcSelect(conn: number, option: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'npcselect', option }));
}

export function tradeTo(conn: number, target: string, items: { id: number; count: number; slot?: number }[], gil = 0) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'trade', target, items, gil }));
}

export function armTradeReceiver(conn: number, from: string, fromId?: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'tradearm', from, fromId }));
}

export function setTradeWhitelist(conn: number, names: string[], ids: number[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'tradewl_set', names, ids }));
}

let lastTradeWlKey = '';
export function syncTradeWhitelist() {
  const chars = knownSnapshot.filter((k) => k.online && k.conn != null);
  const names = chars.map((c) => c.name);
  const ids = chars.map((c) => c.id).filter((x): x is number => x != null);
  const key = chars.map((c) => `${c.conn}:${c.id ?? '?'}`).sort().join(',');
  if (key === lastTradeWlKey) return;
  lastTradeWlKey = key;
  for (const c of chars) setTradeWhitelist(c.conn!, names, ids);
}

export function broadcastShopNpcs(names: string[]) {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'shopnpc_set', names }));
}

let lastLearn: NpcLearn | null = null;
const learnListeners = new Set<() => void>();
export function clearNpcLearn() { lastLearn = null; learnListeners.forEach((l) => l()); }
export function useNpcLearn(): NpcLearn | null {
  return useSyncExternalStore((cb) => { learnListeners.add(cb); return () => learnListeners.delete(cb); }, () => lastLearn, () => lastLearn);
}

let lastBzBuy: BazaarBuyResult | null = null;
const bzBuyListeners = new Set<() => void>();
function pushBzBuy(v: BazaarBuyResult) { lastBzBuy = v; bzBuyListeners.forEach((l) => l()); }
export function useBzBuy(): BazaarBuyResult | null {
  return useSyncExternalStore((cb) => { bzBuyListeners.add(cb); return () => bzBuyListeners.delete(cb); }, () => lastBzBuy, () => lastBzBuy);
}

// Resolves on the next bzbuy result frame (or null on timeout). Used to drive the
// sequential Buy Multiple queue — the addon serializes buys one at a time.
export function nextBzBuy(timeoutMs = 8000): Promise<BazaarBuyResult | null> {
  const startAt = lastBzBuy?.at ?? 0;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: BazaarBuyResult | null) => { if (done) return; done = true; bzBuyListeners.delete(cb); clearTimeout(to); resolve(v); };
    const cb = () => { if (lastBzBuy && lastBzBuy.at > startAt) finish(lastBzBuy); };
    const to = setTimeout(() => finish(null), timeoutMs);
    bzBuyListeners.add(cb);
  });
}

export function stackBag(conn: number, bag?: number) {
  sendBoxCommand(conn, JSON.stringify(bag === undefined ? { cmd: 'stack' } : { cmd: 'stack', bag }));
}


export type KeepQtyRule = { item: string; qty: number; stacks?: boolean };
export type OrganizeRules = {
  alwaysBring: string[];
  keep: string[];
  keepSingle: string[];
  keepQty: KeepQtyRule[];
  storableBags: number[];
  storeUsable: boolean;
  reserve: number;
  strictInventory: boolean;
};

export const DEFAULT_ORGANIZE_RULES: OrganizeRules = { alwaysBring: [], keep: [], keepSingle: [], keepQty: [], storableBags: [5, 6, 7], storeUsable: true, reserve: 3, strictInventory: false };

// Migrate the old passive modes into the active model: Keep All -> Bring everything
// to inventory (alwaysBring), Keep 1 Stack -> Bring 1 stack (keepQty stacks=1).
export function normalizeOrganizeRules(r: OrganizeRules): OrganizeRules {
  if ((r.keep?.length ?? 0) === 0 && (r.keepSingle?.length ?? 0) === 0) return r;
  return {
    ...r,
    alwaysBring: [...r.alwaysBring, ...(r.keep ?? [])],
    keepQty: [...r.keepQty, ...(r.keepSingle ?? []).map((n) => ({ item: n, qty: 1, stacks: true }))],
    keep: [],
    keepSingle: [],
  };
}

export function runOrganize(conn: number, rules: OrganizeRules, layout?: { item: string; bags: number[] }[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'organize', ...rules, ...(layout && layout.length ? { layout } : {}) }));
}

// Dry-run: the addon computes the full organize plan and reports it via the
// `orgpreview` feed (stored as `orgPreview`) without moving anything. Clears any
// stale preview first so the UI shows a loading state until fresh data arrives.
export function runOrganizePreview(conn: number, rules: OrganizeRules, layout?: { item: string; bags: number[] }[]) {
  const prev = byConn.get(conn);
  if (prev) { byConn.set(conn, { ...prev, orgPreview: undefined }); scheduleRebuild(); }
  sendBoxCommand(conn, JSON.stringify({ cmd: 'organizepreview', ...rules, ...(layout && layout.length ? { layout } : {}) }));
}

export function broadcastOrganize(rules: OrganizeRules): Promise<number> {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'organize', ...rules }));
}

export function retrieveItems(conn: number, items: string[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'retrieve', items })); }
export function broadcastRetrieve(items: string[]): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'retrieve', items })); }

export function localConsolidate(conn: number, bags?: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'localconsolidate', ...(bags && bags.length ? { bags } : {}) })); }

export function broadcastSortBag(bags: number[]): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'sortbag', bags })); }
export function sortBag(conn: number, bags: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'sortbag', bags })); }

export function requestCurrency(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'currency' })); }
export function broadcastCurrency(): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'currency' })); }
export function broadcastSync(): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'sync' })); }

export type PoolRules = { lot: string[]; pass: string[]; drop: string[]; passOnLot?: boolean; autoLot?: boolean };

export function lotPool(conn: number, index: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'lot', index })); }
export function passPool(conn: number, index: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'pass', index })); }
export function lotAll(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'lotall' })); }
export function passAll(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'passall' })); }
export function passDone(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'passdone' })); }
let autoLotFeedCb: ((name: string | undefined, on: boolean, all: boolean) => void) | null = null;
// poolRules registers here so a //ax autolot toggle typed in-game flows back to the
// desktop (updates the UI + persists), without bridge importing poolRules (circular).
export function onAutoLotFeed(cb: (name: string | undefined, on: boolean, all: boolean) => void) { autoLotFeedCb = cb; }
export function setPoolRules(conn: number, r: PoolRules) { sendBoxCommand(conn, JSON.stringify({ cmd: 'poolrules', ...r })); }
export function broadcastPoolRules(r: PoolRules) { return broadcastBoxCommand(JSON.stringify({ cmd: 'poolrules', ...r })); }

export function setResupply(conn: number, on: boolean, items: { name: string; min: number }[], options: number[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'resupply_set', on, items, options }));
}

export function setVendors(conn: number, on: boolean, items: { name: string; min: number }[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'pvendor_set', on, items }));
}

let curioCatalogHook: ((server: string | undefined, items: CurioCatalogItem[]) => void) | null = null;
export function onCurioCatalog(fn: (server: string | undefined, items: CurioCatalogItem[]) => void) { curioCatalogHook = fn; }

export function currencyFarmStop(conn: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'farmstop' }));
}
export function currencyConvert(conn: number, shop: 'sparks' | 'unity', delay = 0) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'currencyfarmall', shop, delay }));
}
export function currencyConvertOn(conn: number, shop?: 'sparks' | 'unity', delay = 0) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'currencyfarmall', ...(shop ? { shop } : {}), delay }));
}
export function bulkConvertStop() {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'farmstop' }));
}

export type DropRules = { drop: string[]; autodrop: boolean; delay?: number };
export function broadcastDropRules(r: DropRules) { return broadcastBoxCommand(JSON.stringify({ cmd: 'droprules', drop: r.drop, autodrop: r.autodrop, delay: r.delay ?? 0 })); }
export function sendDropRules(conn: number, r: DropRules) { sendBoxCommand(conn, JSON.stringify({ cmd: 'droprules', drop: r.drop, autodrop: r.autodrop, delay: r.delay ?? 0 })); }
export function broadcastDropNow() { return broadcastBoxCommand(JSON.stringify({ cmd: 'dropnow' })); }
export function dropOne(conn: number, slot: number, id: number, bag = 0, count?: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'dropone', slot, id, bag, ...(count != null ? { count } : {}) })); }
export function dropClean(conn: number, items: string[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'dropclean', items })); }
export function useItem(conn: number, id: number, all: boolean, bag = 0, slot?: number, count?: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'use', id, all, bag, ...(slot != null ? { slot } : {}), ...(count != null && count > 0 ? { count } : {}) })); }

export type TradeArg = { id?: number; item?: string; count?: number; times?: number; target_id?: number; target_index?: number };
export function tradeNpc(conn: number, a: TradeArg) { sendBoxCommand(conn, JSON.stringify({ cmd: 'tradenpc', ...a })); }
export function tradePcOffer(conn: number, a: { target?: string; items: { item: string; count: number }[] }) { sendBoxCommand(conn, JSON.stringify({ cmd: 'tradepcoffer', ...a })); }
export function slipStore(conn: number, ids: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'slipstore', ids })); }
export function slipRetrieve(conn: number, ids: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'slipretrieve', ids })); }

export type CapeAugArg = { job: string; material: string; path: string; repeats: number; bag: number; slot: number };
export function augCape(conn: number, a: CapeAugArg) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augcape', ...a })); }
export type CapeSeqStep = { material: string; path: string; repeats: number };
export function augCapeSeq(conn: number, a: { job: string; bag: number; slot: number; steps: CapeSeqStep[] }) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augcapeseq', ...a })); }
export type GearAugArg = { mode: string; item: string; bag?: number; slot?: number; material?: string; style?: string; augment_1?: string; augment_2?: string; augment_3?: string; watch_1?: number; watch_2?: number; watch_3?: number; augment_mode?: 'and' | 'or'; delay?: number; max?: number; manual?: boolean; dm?: number; dm_all?: boolean };
export function augGear(conn: number, a: GearAugArg) { sendBoxCommand(conn, JSON.stringify({ cmd: 'auggear', ...a })); }
export function augStop(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augstop' })); }
export function augKeep(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augkeep' })); }
export function augReroll(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augreroll' })); }
export function augStopAll(): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'augstop' })); }

export function storeRequest(conn: number, npc: string, id: number, want: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'store', npc, id, want })); }
export function storeStop(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'storestop' })); }

export function bzOpen(conn: number, id: number, index: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzopen', id, index })); }
export function bzApply(conn: number, items: { index: number; price: number }[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzapply', items })); }
export function bzClose(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzclose' })); }
export function bzMySync(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzmy' })); }
export function bzRange(conn: number, range: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzrange', range })); }
export function bzScan(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzscan' })); }
export function bzDeepScan(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzdeepscan' })); }
export function bzWatch(conn: number, on: boolean) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzwatch', on })); }
export function bzScanStop(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzscanstop' })); }
export function bzBuy(conn: number, a: { sellerid: number; sellerindex: number; bidx: number; id: number; price: number; qty: number }) { sendBoxCommand(conn, JSON.stringify({ cmd: 'bzbuy', ...a })); }

export function broadcastBoxCommand(line: string): Promise<number> {
  return inTauri ? invoke<number>('broadcast_box_command', { line }).catch(() => 0) : Promise.resolve(0);
}

export function openExternal(url: string) {
  if (inTauri) void invoke('open_url', { url }).catch(() => {});
  else window.open(url, '_blank');
}

if (inTauri) {
  void startBridge();
  void loadPersisted();
}
