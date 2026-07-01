import { getStickyPersisted } from './sticky';
import { VIEW_TRADE_TYPES, TRADE_TYPES, type TradeType } from './augData';
import type { InvBag, GearAugArg } from './bridge';

export type GearInst = { key: string; name: string; bagId: number; bagName: string; slot: number; aug: string[] };

export function gearInstancesFor(view: string, inv?: InvBag[]): GearInst[] {
  const types = VIEW_TRADE_TYPES[view] ?? ['Cape'];
  const allow = new Set<string>();
  for (const tid of types) for (const g of TRADE_TYPES[tid].gear) allow.add(g.toLowerCase());
  const out: GearInst[] = [];
  const seen = new Set<string>();
  for (const bag of inv ?? []) for (const it of bag.items) {
    if (!it.n || !allow.has(it.n.toLowerCase())) continue;
    if (seen.has(it.n)) continue;
    seen.add(it.n);
    out.push({ key: it.n, name: it.n, bagId: bag.id, bagName: bag.b, slot: it.s, aug: it.aug ?? [] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.bagName.localeCompare(b.bagName));
}

// Resolve a saved selection to a gear instance by IDENTITY (item name), so a configured
// roll keeps working wherever the item is in the bags. New selections store the item name.
// Legacy selections stored "bag:slot": recover those by reading the item that now sits
// there and matching it by name, so old configs aren't silently lost.
export function resolveSel(selKey: string, instances: GearInst[], inv?: InvBag[]): GearInst | undefined {
  if (!selKey) return undefined;
  const byName = instances.find((i) => i.key === selKey);
  if (byName) return byName;
  const m = /^(\d+):(\d+)$/.exec(selKey);
  if (m && inv) {
    const bagId = Number(m[1]), slot = Number(m[2]);
    const it = inv.find((b) => b.id === bagId)?.items.find((x) => x.s === slot);
    if (it) return instances.find((i) => i.name.toLowerCase() === it.n.toLowerCase());
  }
  return undefined;
}

export const augKey = (view: string, char: string, field: string) => `aug.${view}.${char}.${field}`;

export type GearCfg = {
  item: string; inst?: GearInst; material: string; style: string;
  a1: string; v1: number; a2: string; v2: number; a3: string; v3: number;
  amode: 'and' | 'or'; delay: number; max: number;
};

const clean = (s: string) => (s === '(any)' ? '' : s);

export function gearTypeOf(view: string, item: string): TradeType | undefined {
  const types = VIEW_TRADE_TYPES[view] ?? ['Cape'];
  for (const tid of types) if (TRADE_TYPES[tid].gear.some((g) => g.toLowerCase() === item.toLowerCase())) return TRADE_TYPES[tid];
  return undefined;
}

function effMaterial(view: string, cfg: GearCfg): string {
  const t = gearTypeOf(view, cfg.item);
  if (!t) return cfg.material;
  if (cfg.material && t.material.includes(cfg.material)) return cfg.material;
  return t.material.length === 1 ? t.material[0] : '';
}

export function readGearCfg(view: string, char: string, inv?: InvBag[]): GearCfg {
  const k = (f: string) => augKey(view, char, f);
  const selKey = getStickyPersisted(k('sel'), '');
  const inst = resolveSel(selKey, gearInstancesFor(view, inv), inv);
  return {
    item: inst?.name ?? (selKey.includes(':') ? '' : selKey),
    inst,
    material: getStickyPersisted(k('mat'), ''),
    style: getStickyPersisted(k('style'), 'Melee'),
    a1: getStickyPersisted(k('a1'), '(any)'), v1: getStickyPersisted(k('v1'), 0),
    a2: getStickyPersisted(k('a2'), '(any)'), v2: getStickyPersisted(k('v2'), 0),
    a3: getStickyPersisted(k('a3'), '(any)'), v3: getStickyPersisted(k('v3'), 0),
    amode: getStickyPersisted(k('amode'), 'and'),
    delay: getStickyPersisted(k('delay'), 2),
    max: getStickyPersisted(k('max'), 50),
  };
}

export function cfgReady(view: string, cfg: GearCfg): { ready: boolean; readyAuto: boolean } {
  const t = gearTypeOf(view, cfg.item);
  const ready = !!t && cfg.item !== '' && effMaterial(view, cfg) !== '';
  const readyAuto = ready && (clean(cfg.a1) !== '' || clean(cfg.a2) !== '' || clean(cfg.a3) !== '');
  return { ready, readyAuto };
}

export function wantedSummary(cfg: GearCfg): string {
  const parts: string[] = [];
  for (const [a, v] of [[cfg.a1, cfg.v1], [cfg.a2, cfg.v2], [cfg.a3, cfg.v3]] as const) {
    const c = clean(a as string);
    if (c) parts.push(v ? `${c} ${v}+` : c);
  }
  return parts.join(cfg.amode === 'or' ? ' / ' : ', ');
}

export function buildGearArg(view: string, cfg: GearCfg): GearAugArg | null {
  if (!cfg.inst) return null;
  const t = gearTypeOf(view, cfg.item);
  const material = effMaterial(view, cfg);
  if (!t || material === '') return null;
  return {
    mode: t.mode, item: cfg.item, bag: cfg.inst.bagId, slot: cfg.inst.slot, material,
    style: t.style ? cfg.style : undefined,
    augment_1: clean(cfg.a1), augment_2: clean(cfg.a2), augment_3: clean(cfg.a3),
    watch_1: cfg.v1, watch_2: cfg.v2, watch_3: cfg.v3,
    augment_mode: cfg.amode, delay: cfg.delay, max: cfg.max, manual: false,
  };
}
