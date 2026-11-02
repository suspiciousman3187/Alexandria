// JS motion tokens mirroring the CSS --dur-*/--ease-* in styles.css (shared with Sage's system) so
// motion/react animations and CSS transitions stay in lockstep. Prefer the ready-made T_* transitions.
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]; // --ease-out
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1]; // --ease-in
export const EASE_SPRING: [number, number, number, number] = [0.34, 1.4, 0.64, 1]; // --ease-spring

export const DUR = {
  instant: 0.09, fast: 0.14, base: 0.2, slow: 0.32, page: 0.42,
} as const;

export const T_FLYOUT = { duration: DUR.fast, ease: EASE_OUT } as const;
export const T_TAB = { duration: DUR.base, ease: EASE_OUT } as const;
export const T_POP = { duration: DUR.fast, ease: EASE_OUT } as const;
export const T_MODAL = { duration: DUR.base, ease: EASE_SPRING } as const;
// The signature sliding active-indicator (segmented tabs, pills): a soft spring settle.
export const T_INDICATOR = { duration: DUR.base, ease: EASE_SPRING } as const;
