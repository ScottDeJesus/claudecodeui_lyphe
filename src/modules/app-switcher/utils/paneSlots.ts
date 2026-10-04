import type { PaneSide, PaneSlot } from '@/shared/types';

/** Used by the switcher's context and its front-pane hook: the slot with nothing in it. */
export const EMPTY_SLOT: PaneSlot = { appId: null, src: null, reloadNonce: 0 };

/**
 * A LONE APPLICATION IS A LEFT APPLICATION — the invariant that keeps the state, the pane and the
 * layer saying one thing.
 *
 * `SplitPane` draws its left child whether or not it has a right one, so a single application always
 * FILLS the layer. An app left holding the right slot alone would therefore be drawn in the left half
 * while `panes.right` said otherwise — and the next application the reader chose would remount it into
 * the half it was already occupying. Moving the survivor left closes both at once, and it costs no
 * remount the clear had not already forced: an application coming down takes its frame with it either
 * way.
 *
 * Used by the switcher's context (every act that takes an application down) and its front-pane hook
 * (`closePane`), which is why it lives here and not in the context: the context imports the hook.
 */
export function loneAppOnTheLeft(panes: Record<PaneSide, PaneSlot>): Record<PaneSide, PaneSlot> {
  if (panes.left.appId !== null || panes.right.appId === null) return panes;
  return { left: panes.right, right: EMPTY_SLOT };
}
