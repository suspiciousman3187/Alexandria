import { useEffect, useRef, useState } from 'react';

export type AnimNode<T> = { key: string; item: T; leaving: boolean };

export function useAnimatedList<T>(items: T[], keyOf: (t: T) => string, duration = 240): AnimNode<T>[] {
  const [leaving, setLeaving] = useState<Map<string, { item: T; pred: string | null }>>(new Map());
  const prevList = useRef<{ key: string; item: T }[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const cur = items.map((it) => ({ key: keyOf(it), item: it }));
    const incoming = new Set(cur.map((c) => c.key));
    const removed: { key: string; item: T; pred: string | null }[] = [];
    for (let i = 0; i < prevList.current.length; i++) {
      const p = prevList.current[i];
      if (incoming.has(p.key)) continue;
      let pred: string | null = null;
      for (let j = i - 1; j >= 0; j--) { if (incoming.has(prevList.current[j].key)) { pred = prevList.current[j].key; break; } }
      removed.push({ key: p.key, item: p.item, pred });
    }
    const reAdded: string[] = [];
    for (const k of incoming) if (leaving.has(k)) reAdded.push(k);

    if (removed.length || reAdded.length) {
      setLeaving((prev) => {
        const next = new Map(prev);
        for (const r of removed) {
          if (next.has(r.key)) continue;
          next.set(r.key, { item: r.item, pred: r.pred });
          const t = setTimeout(() => {
            timers.current.delete(r.key);
            setLeaving((c) => { const m = new Map(c); m.delete(r.key); return m; });
          }, duration);
          timers.current.set(r.key, t);
        }
        for (const k of reAdded) {
          const t = timers.current.get(k);
          if (t) clearTimeout(t);
          timers.current.delete(k);
          next.delete(k);
        }
        return next;
      });
    }
    prevList.current = cur;
  });

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  const incoming = new Set(items.map(keyOf));
  const result: AnimNode<T>[] = items.map((it) => ({ key: keyOf(it), item: it, leaving: false }));
  for (const [k, info] of leaving) {
    if (incoming.has(k)) continue;
    const idx = info.pred ? result.findIndex((r) => r.key === info.pred) : -1;
    const node: AnimNode<T> = { key: k, item: info.item, leaving: true };
    if (idx >= 0) result.splice(idx + 1, 0, node);
    else result.unshift(node);
  }
  return result;
}
