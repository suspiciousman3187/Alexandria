import { onInventoryUpdate, type InvBag } from './bridge';

type SlotState = { id: number; c: number };
const prevByChar = new Map<string, Map<number, Map<number, SlotState>>>();
const movedAt = new Map<string, number>();
const seen = new Set<string>();

const k = (name: string, bag: number, slot: number, id: number) => `${name}|${bag}|${slot}|${id}`;

function track(name: string, bags: InvBag[]): void {
  const now = Date.now();
  const baseline = !seen.has(name);
  seen.add(name);
  const prevBags = prevByChar.get(name);
  const nextBags = new Map<number, Map<number, SlotState>>();
  for (const bag of bags) {
    const nextSlots = new Map<number, SlotState>();
    const prevSlots = prevBags?.get(bag.id);
    for (const it of bag.items) {
      if (!it.id) continue;
      nextSlots.set(it.s, { id: it.id, c: it.c });
      if (!baseline) {
        const p = prevSlots?.get(it.s);
        if (!p || p.id !== it.id || it.c > p.c) movedAt.set(k(name, bag.id, it.s, it.id), now);
      }
    }
    nextBags.set(bag.id, nextSlots);
  }
  prevByChar.set(name, nextBags);
  if (movedAt.size > 8000) {
    const oldest = [...movedAt.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < oldest.length - 5000; i++) movedAt.delete(oldest[i][0]);
  }
}

let inited = false;
export function initMovedTracker(): void {
  if (inited) return;
  inited = true;
  onInventoryUpdate(track);
}

export function getMovedAt(name: string, bag: number, slot: number, id: number): number {
  return movedAt.get(k(name, bag, slot, id)) ?? 0;
}
