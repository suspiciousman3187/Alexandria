import { useEffect, useRef } from 'react';
import { useKnownCharacters, axEcho, type KnownChar } from './bridge';
import { usePullRules } from './pullRules';
import { useItemTags } from './itemTags';
import { useSettings } from './settings';
import { firePull, reachableBag } from './pullEngine';

// One in-flight auto-pull we are waiting to land, so we can confirm completion in-game.
type Pending = { name: string; conn: number; ruleName: string; job: string; planned: number; before: Map<number, Map<number, number>>; dests: number[]; landed: number; startedAt: number; lastChange: number };

function countByBag(char: KnownChar, bags: number[]) {
  const m = new Map<number, Map<number, number>>();
  const set = new Set(bags);
  for (const bg of char.inv ?? []) {
    if (!set.has(bg.id)) continue;
    const im = m.get(bg.id) ?? new Map<number, number>();
    for (const it of bg.items) im.set(it.id, (im.get(it.id) ?? 0) + it.c);
    m.set(bg.id, im);
  }
  return m;
}
function landedNow(op: Pending, char: KnownChar) {
  const cur = countByBag(char, op.dests);
  let n = 0;
  for (const bag of op.dests) {
    const bef = op.before.get(bag), cm = cur.get(bag) ?? new Map<number, number>();
    for (const [id, c] of cm) { const d = c - (bef?.get(id) ?? 0); if (d > 0) n += d; }
  }
  return n;
}

// Watches every connected character's main job and, when it changes, runs any pull rule flagged
// autoOnJobChange -- gated per rule (slip pulls need the Porter in range; bag pulls need those bags reachable
// here). Announces the pull when it fires and a confirmation once the gear has landed.
export function usePullAutoRun() {
  const chars = useKnownCharacters();
  const rules = usePullRules();
  const { assign } = useItemTags();
  const exp = useSettings().experimentalFeatures;
  const prev = useRef<Map<string, string>>(new Map());
  const pending = useRef<Pending[]>([]);
  const charsRef = useRef(chars);
  charsRef.current = chars;

  // Confirm each auto-pull once its items have landed (or a stall / timeout).
  useEffect(() => {
    const t = setInterval(() => {
      if (!pending.current.length) return;
      const now = Date.now();
      pending.current = pending.current.filter((op) => {
        const ch = charsRef.current.find((c) => c.name === op.name);
        if (!ch || ch.conn == null) return false;
        const landed = landedNow(op, ch);
        if (landed !== op.landed) { op.landed = landed; op.lastChange = now; }
        const done = landed >= op.planned || now - op.lastChange > 6000 || now - op.startedAt > 60000;
        if (done) {
          const got = Math.min(landed, op.planned);
          axEcho(op.conn, `Auto-pull "${op.ruleName}" complete: ${got} ${op.job} item${got === 1 ? '' : 's'} pulled`);
          return false;
        }
        return true;
      });
    }, 900);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const auto = rules.filter((r) => r.autoOnJobChange);
    for (const ch of chars) {
      if (!ch.online || ch.conn == null) { prev.current.delete(ch.name); continue; }
      const main = ch.main;
      const last = prev.current.get(ch.name);
      if (main) prev.current.set(ch.name, main); else { prev.current.delete(ch.name); continue; }
      if (last === undefined || last === main || auto.length === 0) continue; // first sighting, or no change
      const conn = ch.conn;
      for (const r of auto) {
        const slipsOk = !r.slips || ch.porterNear;                       // slip pulls need the Porter
        const bagsOk = r.bags.every((b) => reachableBag(ch, exp, b));     // bag pulls need those bags reachable
        if (!slipsOk || !bagsOk) continue;
        const before = countByBag(ch, [...new Set([...(r.dest && r.dest.length ? r.dest : [0]), 0])]);
        const res = firePull(ch, conn, r, { assign, exp });
        const n = res.movedItems + res.slipTake;
        if (n > 0) { // one pull per change so the slip ops never collide; announce + track for completion
          axEcho(conn, `Auto-pull "${r.name}": pulling ${n} ${main} item${n === 1 ? '' : 's'}`);
          pending.current.push({ name: ch.name, conn, ruleName: r.name, job: main, planned: n, before, dests: res.tracked, landed: 0, startedAt: Date.now(), lastChange: Date.now() });
          break;
        }
        if (res.blocked.length) axEcho(conn, `Auto-pull "${r.name}" skipped: ${res.blocked[0]}`);
      }
    }
  }, [chars, rules, assign, exp]);
}
