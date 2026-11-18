/**
 * Layout breakpoints shared by JavaScript and documented for CSS.
 *
 * CSS media queries cannot import TypeScript, so `features/shell/shell.css`
 * repeats the number in a comment next to `.nav-rail.is-narrow`. Keeping the
 * value here at least makes the JavaScript side a single source.
 */
export const BREAKPOINTS = {
  /** Below this width the navigation rail folds to its icon track. */
  narrowRail: 900,
} as const;

export const NARROW_RAIL_MEDIA_QUERY = `(max-width: ${BREAKPOINTS.narrowRail}px)`;
