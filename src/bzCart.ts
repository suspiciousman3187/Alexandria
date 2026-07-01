import { useSyncExternalStore } from 'react';

export type CartEntry = {
  key: string;
  sellerId: number;
  sellerIndex: number;
  bidx: number;
  id: number;
  n: string;
  seller: string;
  price: number;
  qty: number;
  maxQty: number;
};

export const cartKey = (sellerId: number, bidx: number) => `${sellerId}-${bidx}`;

let cart: CartEntry[] = [];
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

export function addToCart(e: CartEntry) {
  const i = cart.findIndex((x) => x.key === e.key);
  if (i >= 0) {
    const next = [...cart];
    next[i] = { ...next[i], qty: Math.min(e.maxQty, next[i].qty + e.qty), price: e.price, maxQty: e.maxQty };
    cart = next;
  } else {
    cart = [...cart, e];
  }
  notify();
}
export function setCartQty(key: string, qty: number) {
  cart = cart.map((x) => (x.key === key ? { ...x, qty: Math.max(1, Math.min(x.maxQty, qty)) } : x));
  notify();
}
export function removeFromCart(key: string) { cart = cart.filter((x) => x.key !== key); notify(); }
export function clearCart() { cart = []; notify(); }

export function getCart(): CartEntry[] { return cart; }
export function useCart(): CartEntry[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cart, () => cart);
}
