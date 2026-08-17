import { useSyncExternalStore } from 'react';
import DistributeModal from './DistributeModal';

// A distribute is launched from transient UI -- an inventory row's actions, a Library
// right-click menu -- that unmounts the moment the item leaves the holder's bag (which
// is exactly what a big distribution does). Hosting the modal here, mounted once at the
// app root, keeps the progress UI alive for the whole operation no matter what launched
// it or which view is showing.
type Req = { holder: string; items: { id: number; n: string }[] } | null;

let req: Req = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

export function openDistribute(holder: string, items: { id: number; n: string }[]) {
  if (!holder || items.length === 0) return;
  req = { holder, items };
  notify();
}
export function closeDistribute() { req = null; notify(); }

function useReq(): Req {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => req, () => req);
}

export function DistributeHost() {
  const r = useReq();
  if (!r) return null;
  return <DistributeModal holder={r.holder} items={r.items} onClose={closeDistribute} />;
}
