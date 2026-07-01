import { useSyncExternalStore } from 'react';
import type { Section } from './NavRail';

export type AhSellContext = { conn: number; bagId: number; slot: number; count: number; charName: string; fromBag: boolean };
export type AhDetailTarget = {
  id: number;
  n: string;
  st: number;
  ac?: number;
  lvl?: number;
  j?: string[];
  cat?: string;
  back: Section;
  sell?: AhSellContext;
};

let target: AhDetailTarget | null = null;
let navTo: Section | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());
const sub = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

export function openAhDetail(t: AhDetailTarget) { target = t; navTo = 'auction'; notify(); }
export function closeAhDetail() {
  const back = target?.back ?? null;
  target = null;
  navTo = back;
  notify();
}
export function clearNavTo() { navTo = null; notify(); }

export function useAhDetailTarget(): AhDetailTarget | null {
  return useSyncExternalStore(sub, () => target, () => target);
}
export function useNavTo(): Section | null {
  return useSyncExternalStore(sub, () => navTo, () => navTo);
}
