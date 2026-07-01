import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type InvItem = { s: number; id: number; c: number; n: string; u?: number; f?: number; ms?: number; aug?: string[] };
export type InvBag = { b: string; id: number; max: number; used: number; items: InvItem[] };
export type PoolItem = { i: number; id: number; n: string; ts: number; lotter: string | null; lot: number; mylot: number | null };
export type PartyInfo = { key: string; members: string[]; size: number };
export type SlipStored = { id: number; n: string };
export type SlipStorable = { id: number; n: string; c: number };
export type Slip = { sid: number; num: number; name: string; ready: boolean; getable: boolean; loc: number; locname: string; stored: SlipStored[]; storable: SlipStorable[] };
export type PorterProgress = { active: boolean; op?: 'store' | 'retrieve'; total?: number; done?: number };
export type OrgStatus = { active: boolean; total: number; done: number };
export type ConvertProgress = { active: boolean; shop: string; item: number; bought: number; total: number; phase: string };
export type CurioCatalogItem = { id: number; n: string; price: number; opt: number; stack?: number; rare?: boolean; ex?: boolean };
export type CurioScan = { active: boolean; opt: number; max: number; count: number };
export type ResupplyProgress = { active: boolean; item: number; have: number; target: number; phase: string };
export type StoreNpcItem = { id: number; n: string; c: number };
export type StoreNpc = { npc: string; items: StoreNpcItem[] };

// Nomad Moogle zones grant access to Safe / Safe 2 / Locker (and the Delivery Box),
// the same way a Mog House does, except Storage which needs your actual residence.
export const NOMAD_ZONES = new Set([26, 53, 247, 248, 249, 250, 252]);
export const NOMAD_BAGS = new Set([1, 4, 9]);
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
  assets?: string;
  inv?: InvBag[];
  keyItems?: KeyItem[];
  pool?: PoolItem[];
  party?: PartyInfo;
  slips?: Slip[];
  org?: OrgStatus;
  orgPlan?: OrgStep[];
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
  | { t: 'hello'; id: number; name: string; main?: string; main_lvl?: number; sub?: string; sub_lvl?: number; zone?: number; zone_name?: string; assets?: string; apath?: string; av?: string; atah?: boolean; in_town?: boolean; server?: string; gil?: number; mog?: boolean; nomad_near?: boolean }
  | { t: 'self'; id: number; name: string; main?: string; main_lvl?: number; sub?: string; sub_lvl?: number; zone?: number; zone_name?: string; assets?: string; apath?: string; av?: string; atah?: boolean; in_town?: boolean; server?: string; gil?: number; mog?: boolean; nomad_near?: boolean }
  | { t: 'inv'; bags: InvBag[] }
  | { t: 'keyitems'; items: KeyItem[] }
  | { t: 'pool'; items: PoolItem[] }
  | { t: 'party'; key: string; members: string[]; size: number }
  | { t: 'slips'; slips: Slip[] }
  | { t: 'orgstatus'; active: boolean; total: number; done: number }
  | { t: 'orgplan'; steps: OrgStep[] }
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
  | { t: 'storezone'; npcs: StoreNpc[] }
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
      main: b.main, sub: b.sub, zone: b.zone, zoneName: b.zoneName, assets: b.assets,
      inv: b.inv ?? pc?.inv, keyItems: b.keyItems ?? pc?.keyItems, keyAt: b.keyAt ?? pc?.keyAt, pool: b.pool, party: b.party, slips: b.slips, org: b.org, orgPlan: b.orgPlan, orgDone: b.orgDone, orgOk: b.orgOk, cur: b.cur ?? pc?.cur, curAt: b.curAt ?? pc?.curAt, atah: b.atah, inTown: b.inTown, server: b.server, gil: b.gil, mog: b.mog, nomadNear: b.nomadNear, ah: b.ah, dbox: b.dbox, dboxStatus: b.dboxStatus, tradeStatus: b.tradeStatus, shop: b.shop, npcNear: b.npcNear, fixedNear: b.fixedNear, porter: b.porter, porterNear: b.porterNear, vendorNear: b.vendorNear, convert: b.convert, resupply: b.resupply, storeZone: b.storeZone, store: b.store, aug: b.aug, augInfo: b.augInfo, bzSellers: b.bzSellers, bzListings: b.bzListings, bzMy: b.bzMy, bzScan: b.bzScan, bzMem: b.bzMem, savedAt: pc?.savedAt,
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
  if (f.t === 'hello' || f.t === 'self') {
    const next: Box = {
      conn,
      id: f.id,
      name: f.name,
      main: f.main ?? prev?.main,
      mainLvl: f.main_lvl ?? prev?.mainLvl,
      sub: f.sub ?? prev?.sub,
      subLvl: f.sub_lvl ?? prev?.subLvl,
      zone: f.zone ?? prev?.zone,
      zoneName: f.zone_name ?? prev?.zoneName,
      assets: f.assets ?? prev?.assets,
      apath: f.apath ?? prev?.apath,
      av: f.av ?? prev?.av,
      atah: f.atah ?? prev?.atah,
      inTown: f.in_town ?? prev?.inTown,
      server: f.server ?? prev?.server,
      gil: f.gil ?? prev?.gil,
      mog: f.mog ?? prev?.mog,
      nomadNear: f.nomad_near ?? prev?.nomadNear,
      inv: prev?.inv,
      invAt: prev?.invAt ?? 0,
      keyItems: prev?.keyItems,
      party: prev?.party,
      storeZone: prev?.storeZone,
      store: prev?.store,
      pool: prev?.pool,
      slips: prev?.slips,
      org: prev?.org,
      orgPlan: prev?.orgPlan,
      orgDone: prev?.orgDone,
      orgOk: prev?.orgOk,
      cur: prev?.cur,
      curAt: prev?.curAt,
      keyAt: prev?.keyAt,
      ah: prev?.ah,
      dbox: prev?.dbox,
      dboxStatus: prev?.dboxStatus,
      tradeStatus: prev?.tradeStatus,
      shop: prev?.shop,
      npcNear: prev?.npcNear,
      fixedNear: prev?.fixedNear,
      porter: prev?.porter,
      porterNear: prev?.porterNear,
      vendorNear: prev?.vendorNear,
      convert: prev?.convert,
      resupply: prev?.resupply,
      aug: prev?.aug,
      augInfo: prev?.augInfo,
      bzSellers: prev?.bzSellers,
      bzListings: prev?.bzListings,
      bzMy: prev?.bzMy,
      bzScan: prev?.bzScan,
      bzMem: prev?.bzMem,
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
    const bags = mergeInv(prev.inv, f.bags);
    const box: Box = { ...prev, inv: bags, invAt: Date.now(), lastSeen: Date.now() };
    byConn.set(conn, box);
    schedulePersist({
      name: box.name, id: box.id,
      main: box.main, mainLvl: box.mainLvl, sub: box.sub, subLvl: box.subLvl,
      zoneName: box.zoneName, assets: box.assets, inv: bags, savedAt: Date.now(),
    });
    invHook?.(box.name, bags);
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
  } else if (f.t === 'orgstep' && prev) {
    byConn.set(conn, {
      ...prev,
      orgDone: [...(prev.orgDone ?? []), f.i],
      orgOk: f.ok ? [...(prev.orgOk ?? []), f.i] : prev.orgOk,
      lastSeen: Date.now(),
    });
    scheduleRebuild();
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

export type AhListing = { key: number; conn: number; name: string; status: 'pending' | 'ok' | 'fail'; reason?: string; at: number; batchId?: number };
let ahListings: AhListing[] = [];
let listingSeq = 0;
let batchSeq = 0;
const listingListeners = new Set<() => void>();
const notifyListings = () => { ahListings = [...ahListings]; listingListeners.forEach((l) => l()); };
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

export type MarketSale = { date: string; price: number; seller: string; buyer: string };
export type MarketBazaar = { player: string; server: string; price: number; quantity: number; zone: string };
export type MarketData = { stock?: string; rate?: string; median?: string; sales: MarketSale[]; bazaar: MarketBazaar[] };

function parseMarket(html: string): MarketData {
  const out: MarketData = { sales: [], bazaar: [] };
  const salesM = html.match(/Item\.sales\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (salesM) {
    try {
      const arr = JSON.parse(salesM[1]) as { saleon: number; seller_name?: string; buyer_name?: string; price?: number }[];
      out.sales = arr.map((s) => ({
        date: s.saleon ? new Date(s.saleon * 1000).toLocaleDateString() : '',
        price: s.price ?? 0,
        seller: s.seller_name ?? '',
        buyer: s.buyer_name ?? '',
      }));
    } catch { /* ignore */ }
  }
  const bazM = html.match(/Item\.bazaar\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (bazM) {
    try {
      const arr = JSON.parse(bazM[1]) as unknown[][];
      out.bazaar = arr.map((e) => {
        const html0 = typeof e[0] === 'string' ? e[0] : '';
        const m = html0.match(/([^.]+)\.<a href='[^']*\/([^/']+)'/);
        return {
          server: m?.[1] ?? '',
          player: m?.[2] ?? '',
          price: typeof e[1] === 'number' ? e[1] : 0,
          quantity: typeof e[2] === 'number' ? e[2] : 0,
          zone: typeof e[3] === 'string' ? e[3] : '',
        };
      });
    } catch { /* ignore */ }
  }
  out.stock = html.match(/<td>\s*Stock\s*<\/td>\s*<td><span[^>]*>(\d+)<\/span>/)?.[1];
  out.rate = html.match(/Rate<\/td>\s*<td><span[^>]*>([^<]+)<\/span>/)?.[1];
  out.median = html.match(/<td>Median<\/td>\s*<td><span[^>]*>([\d,]+)<\/span>/)?.[1];
  return out;
}

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

const marketInflight = new Map<string, Promise<MarketData>>();
export function fetchMarket(id: number, stack: boolean, server?: string): Promise<MarketData> {
  const sid = ffxiahSid(server);
  const key = `${id}:${stack ? 1 : 0}:${sid ?? ''}`;
  const inflight = marketInflight.get(key);
  if (inflight) return inflight;
  const url = `https://www.ffxiah.com/item/${id}?stack=${stack ? '1' : '0'}`;
  const cookie = sid ? `sid=${sid}` : undefined;
  const p = invoke<string>('http_get', { url, cookie })
    .then(parseMarket)
    .finally(() => marketInflight.delete(key));
  marketInflight.set(key, p);
  return p;
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

export function getConnectedAddonInfo(): AddonInfo | null {
  for (const b of byConn.values()) {
    if (b.apath) return { dir: b.apath.replace(/[\\/]+$/, ''), version: b.av ?? null };
  }
  return null;
}

function addonKey(): string {
  for (const b of liveSnapshot) if (b.apath) return `${b.apath}|${b.av ?? ''}`;
  return '';
}

export function useAddonInfo(): AddonInfo | null {
  const key = useSyncExternalStore(subscribe, addonKey, () => '');
  return useMemo(() => (key ? getConnectedAddonInfo() : null), [key]);
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

let invHook: ((name: string, bags: InvBag[]) => void) | null = null;
export function onInventoryUpdate(fn: (name: string, bags: InvBag[]) => void) { invHook = fn; }
export function axEcho(conn: number, text: string) {
  const clean = text.replace(/[^\x20-\x7E]/g, '').slice(0, 150);
  sendBoxCommand(conn, JSON.stringify({ cmd: 'axecho', text: clean }));
}

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


export type OrganizeRules = {
  alwaysBring: string[];
  keep: string[];
  keepSingle: string[];
  storableBags: number[];
  storeUsable: boolean;
  reserve: number;
};

export function runOrganize(conn: number, rules: OrganizeRules) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'organize', ...rules }));
}

export function broadcastOrganize(rules: OrganizeRules): Promise<number> {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'organize', ...rules }));
}

export function retrieveItems(conn: number, items: string[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'retrieve', items })); }
export function broadcastRetrieve(items: string[]): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'retrieve', items })); }

export function requestCurrency(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'currency' })); }
export function broadcastCurrency(): Promise<number> { return broadcastBoxCommand(JSON.stringify({ cmd: 'currency' })); }

export type PoolRules = { lot: string[]; pass: string[]; drop: string[]; passOnLot?: boolean };

export function lotPool(conn: number, index: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'lot', index })); }
export function passPool(conn: number, index: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'pass', index })); }
export function lotAll(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'lotall' })); }
export function passAll(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'passall' })); }
export function passDone(conn: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'passdone' })); }
export function setPoolRules(conn: number, r: PoolRules) { sendBoxCommand(conn, JSON.stringify({ cmd: 'poolrules', ...r })); }
export function broadcastPoolRules(r: PoolRules) { return broadcastBoxCommand(JSON.stringify({ cmd: 'poolrules', ...r })); }

export function setResupply(conn: number, on: boolean, items: { name: string; min: number }[], options: number[]) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'resupply_set', on, items, options }));
}

let curioCatalogHook: ((server: string | undefined, items: CurioCatalogItem[]) => void) | null = null;
export function onCurioCatalog(fn: (server: string | undefined, items: CurioCatalogItem[]) => void) { curioCatalogHook = fn; }

export function currencyFarmStop(conn: number) {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'farmstop' }));
}
export function currencyConvert(conn: number, shop: 'sparks' | 'unity') {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'currencyfarmall', shop }));
}
export function currencyConvertOn(conn: number, shop?: 'sparks' | 'unity') {
  sendBoxCommand(conn, JSON.stringify({ cmd: 'currencyfarmall', ...(shop ? { shop } : {}) }));
}
export function bulkConvertStop() {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'farmstop' }));
}

export type DropRules = { drop: string[]; autodrop: boolean; delay?: number };
export function broadcastDropRules(r: DropRules) { return broadcastBoxCommand(JSON.stringify({ cmd: 'droprules', drop: r.drop, autodrop: r.autodrop, delay: r.delay ?? 0 })); }
export function broadcastDropNow() { return broadcastBoxCommand(JSON.stringify({ cmd: 'dropnow' })); }
export function dropOne(conn: number, slot: number, id: number, bag = 0, count?: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'dropone', slot, id, bag, ...(count != null ? { count } : {}) })); }
export function dropClean(conn: number, items: string[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'dropclean', items })); }
export function useItem(conn: number, id: number, all: boolean, bag = 0, slot?: number) { sendBoxCommand(conn, JSON.stringify({ cmd: 'use', id, all, bag, ...(slot != null ? { slot } : {}) })); }

export type TradeArg = { id?: number; item?: string; count?: number; times?: number; target_id?: number; target_index?: number };
export function tradeNpc(conn: number, a: TradeArg) { sendBoxCommand(conn, JSON.stringify({ cmd: 'tradenpc', ...a })); }
export function tradePcOffer(conn: number, a: { target?: string; items: { item: string; count: number }[] }) { sendBoxCommand(conn, JSON.stringify({ cmd: 'tradepcoffer', ...a })); }
export function slipStore(conn: number, ids: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'slipstore', ids })); }
export function slipRetrieve(conn: number, ids: number[]) { sendBoxCommand(conn, JSON.stringify({ cmd: 'slipretrieve', ids })); }

export type CapeAugArg = { job: string; material: string; path: string; repeats: number; bag: number; slot: number };
export function augCape(conn: number, a: CapeAugArg) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augcape', ...a })); }
export type CapeSeqStep = { material: string; path: string; repeats: number };
export function augCapeSeq(conn: number, a: { job: string; bag: number; slot: number; steps: CapeSeqStep[] }) { sendBoxCommand(conn, JSON.stringify({ cmd: 'augcapeseq', ...a })); }
export type GearAugArg = { mode: string; item: string; bag?: number; slot?: number; material?: string; style?: string; augment_1?: string; augment_2?: string; augment_3?: string; watch_1?: number; watch_2?: number; watch_3?: number; augment_mode?: 'and' | 'or'; delay?: number; max?: number; manual?: boolean };
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
