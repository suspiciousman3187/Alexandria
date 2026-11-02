// A stable fingerprint for ONE physical item copy, derived from its augments. Two items of the same
// item id are told apart only by their augment set (the same precedent the addon's Ambuscade-cape flow
// relies on). The signature is normalized -- trimmed, empty-dropped, sorted -- so slot order or
// whitespace noise can never split one real piece into two keys. Re-augmenting a piece changes its
// signature on purpose: an exact-piece tag follows the exact augment set, not the inventory slot.
export function augSig(aug?: string[]): string {
  if (!aug || aug.length === 0) return '';
  const parts = aug.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean);
  if (!parts.length) return '';
  return parts.slice().sort().join('|');
}

// The composite tag-store key for an exact augmented copy of item `id`. Only meaningful when the item
// actually carries augments: an un-augmented item has no signature, so exact-piece tagging falls back
// to the plain id (every copy is identical anyway). Callers gate exact tagging on `hasAug` below.
export function pieceKey(id: number, aug?: string[]): string {
  const sig = augSig(aug);
  return sig ? `${id}#${sig}` : String(id);
}

// True when a physical item has distinguishing augments (so "tag this exact piece" is distinct from
// "tag every copy of this item").
export function hasAug(aug?: string[]): boolean {
  return augSig(aug) !== '';
}

// Split a composite piece key back into its numeric item id (the part before '#'). Returns NaN if the
// key is a plain id with no signature -- callers that only want augmented keys should check for '#'.
export function pieceKeyId(key: string): number {
  const hash = key.indexOf('#');
  return Number(hash === -1 ? key : key.slice(0, hash));
}
