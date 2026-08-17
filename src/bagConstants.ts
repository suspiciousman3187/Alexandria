// Canonical FFXI bag-id groupings, shared so every view agrees on which bags live where.
// Reachability rules differ per feature (mail vs trade vs resupply), so each view keeps its
// own predicate; only these id sets and item-flag bits are shared.
export const ALWAYS_BAGS = new Set([0, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]); // inventory + carry + wardrobes
export const MOG_ONLY_BAGS = new Set([1, 2, 4, 9]); // Safe, Storage, Locker, Safe 2

// The Temporary bag. Its contents (event/battlefield temp items) cannot be moved,
// traded, stored, or tagged, so tagging and Organize ignore anything held here.
export const TEMPORARY_BAG = 3;

export const FLAG_NOTRADE = 0x02;
export const FLAG_NOSEND = 0x20;
