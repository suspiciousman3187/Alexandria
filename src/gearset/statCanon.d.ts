// Types for statCanon.js (the shared stat-canonicalization module).
export declare function canonStat(name: string): string | null;
export declare function unwrapLines(enText: string): string[];
export declare const ASSIGN: RegExp;
export declare const COLON: RegExp;
export declare const DOWN: RegExp;
export declare const CUT: RegExp;
export declare const COND: RegExp;
