/**
 * The two rules that read a measured `DOMRect`, and nothing else.
 *
 * The dock hands over what `getBoundingClientRect()` said about the sidebar header's leading slot;
 * these decide whether that measurement may be believed and whether it is news. Both are plain
 * functions over a rect, so they live beside the other browser rules this module keeps
 * (`resolveAppUrl.ts`) rather than inside the provider that calls them.
 */

/**
 * The rect the FAB may dock to, or null — the two rules a measured rect has to pass before it is
 * believed.
 *
 * A NON-ZERO RECT IS NOT ENOUGH. The sidebar's mobile drawer is hidden with `invisible opacity-0`,
 * and `visibility: hidden` KEEPS the layout box: `getBoundingClientRect()` answers the dock's full
 * size from a point a drawer's width off the left edge, roughly 85vw away. A record reading
 * `docked: true` against that rect paints the FAB off-screen — and the FAB is the reader's only way
 * out of a pane. So the rect must also INTERSECT THE VIEWPORT.
 *
 * Null in, null out, and null is a real answer rather than an error: it means the FAB has nowhere to
 * dock and the kit floats it at its clamped resting corner instead of at a remembered ghost.
 */
export function dockableRect(rect: DOMRect | null): DOMRect | null {
  if (rect === null || rect.width === 0 || rect.height === 0) return null;
  const intersectsViewport =
    rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  return intersectsViewport ? rect : null;
}

/**
 * Whether two rects are the same place. The dock re-measures on every resize and on every transition
 * that could have moved it — including this module's own FAB transitions — so an unchanged
 * measurement has to leave the state object it found: a fresh `DOMRect` with the same numbers would
 * re-render the provider, and a re-render that moved the FAB would ask for another measurement.
 */
export function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
