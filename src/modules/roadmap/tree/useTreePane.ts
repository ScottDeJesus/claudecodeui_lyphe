import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { treeKeyOf } from '@/modules/roadmap/tree/treeKeys';
import type { TreeLayout } from '@/modules/roadmap/utils/treeLayout';
import type { RoadmapTreeSelection } from '@/shared/types';

/**
 * How far in from either end of the drawing the goal is held, in drawing units: its label, up to 48 characters
 * of 18px serif, is about 400 wide, so the goal never runs its words off the drawing's edge.
 */
const GOAL_MARGIN = 200;

/** What the pane shows of the drawing, in px: how far it is scrolled and how wide it is. */
type PaneView = { left: number; width: number };

/**
 * Scrolls the pane sideways so the mark of the node keyed `key` stands at its centre, when that node is not wholly
 * inside the pane's visible width; does nothing when it is, or when the pane draws no such node. The node's mark (a
 * ring, or a dot's hit circle) is its first child: it is what the reader looks for. `scrollTo` is given a `left`
 * alone, so the pane never moves down.
 */
function centreNodeIn(pane: HTMLElement, key: string, behavior: ScrollBehavior): void {
  const node = pane.querySelector(`[data-tree-key="${CSS.escape(key)}"]`);
  if (node === null) return;
  const shown = pane.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  if (box.left >= shown.left && box.right <= shown.right) return;
  const mark = (node.firstElementChild ?? node).getBoundingClientRect();
  pane.scrollTo({ left: pane.scrollLeft + (mark.left + mark.width / 2) - (shown.left + shown.width / 2), behavior });
}

type TreePaneInput = {
  /** The tree's own sideways scroller. */
  paneRef: RefObject<HTMLDivElement>;
  layout: TreeLayout;
  /** The drawing's scale: the svg is drawn `layout.width × scale` wide. */
  scale: number;
  /** The roadmap on screen: the opening scroll is keyed on its name, never on a new frame of it. */
  roadmapName: string;
  /** The name of the roadmap's current milestone; null when every milestone is reached. */
  current: string | null;
  /** The item the face holds selected on this roadmap; null for none. */
  selected: RoadmapTreeSelection | null;
};

/**
 * Everything the tree does with its pane's sideways scroll, in one place:
 *
 * - THE GOAL FOLLOWS THE SCROLL. While the drawing is wider than its pane, the goal stands at the pane's visible
 *   centre, `(scrollLeft + clientWidth / 2) / scale` in drawing units, held within [200, width − 200]; while it
 *   fits, at the drawing's centre. The pane's scroll is read at most once per animation frame (a passive
 *   listener, and a resize observer for a pane that changes width without scrolling), so only the goal's own
 *   group and connectors, which take the returned x, redraw.
 * - THE OPENING SCROLL. On mount and on a roadmap switch, an overflowing pane is set at once (never smooth: it
 *   is where the tree STARTS, not a move the eye follows) so the current milestone's column, else the last,
 *   sits at its centre; and when the roadmap holds a selection that column leaves outside the pane's width (a
 *   roadmap switched back to), the pane is set on that node instead, so the item pressed there is in view. It
 *   is keyed on the roadmap's name alone: a new frame of the same roadmap never takes the pane back from a
 *   reader who has moved along it. A pane with no width (the gutter's widget stays mounted under every other
 *   tab, `display: none`) cannot take a scroll, so its opening is owed: the pane's resize observer runs it the
 *   moment the pane gains a width.
 * - THE SELECTION SCROLL. When the selected node is not wholly inside the pane's visible width, the pane scrolls
 *   sideways to centre its mark, smooth, or instant under `prefers-reduced-motion: reduce`. `scrollTo` takes a
 *   `left` alone, so it never scrolls down, and the goal, which is always in view, is left alone. The commit
 *   of an opening has had its say (above), so it runs no selection scroll of its own.
 * - THE SCALE. A new scale resizes the drawing under the pane, so the drawing's x at the pane's centre is held
 *   across it (while the pane overflowed), and a view the opening set stays on the milestone it set it on when
 *   the face's measured height arrives a frame after the tree.
 *
 * Returns the goal's x in the drawing. Used by the roadmap module's tree, `tree/RoadmapTree`.
 */
export function useTreePane({ paneRef, layout, scale, roadmapName, current, selected }: TreePaneInput): number {
  // What the pane showed when last read, once per animation frame: the goal's x derives from it. Not derivable
  // at render: only the DOM knows how far the reader has scrolled and how wide the pane is. Null until first read.
  const [view, setView] = useState<PaneView | null>(null);
  // The drawing x at the pane's centre as of the last read, while the pane overflows: it is carried across a new
  // scale. A ref: it changes with every scroll and nothing renders from it.
  const anchorRef = useRef<number | null>(null);
  const selectedKey = selected === null || selected.kind === 'roadmap' ? null : treeKeyOf(selected);
  // The layout, scale, current milestone and selected key as of the last commit, for the effects keyed on something else.
  const latest = useRef({ layout, scale, current, selectedKey });
  // Set by the opening, consumed by the selection scroll of the same commit: the opening has seen to the selection.
  const justOpened = useRef(false);
  // Whether an opening is still owed: the pane had no width when it was due (hidden under another tab), so the
  // pane's resize observer runs it once it has one. A ref: it changes outside any render and nothing is drawn from it.
  const openingOwed = useRef(false);

  useLayoutEffect(() => {
    latest.current = { layout, scale, current, selectedKey };
  });

  const read = useCallback(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    const next = { left: pane.scrollLeft, width: pane.clientWidth };
    const { layout: drawn, scale: drawnAt } = latest.current;
    anchorRef.current = drawn.width * drawnAt > next.width ? (next.left + next.width / 2) / drawnAt : null;
    setView((held) => (held !== null && held.left === next.left && held.width === next.width ? held : next));
  }, [paneRef]);

  // The scale: hold the drawing's centre. Declared before the opening, which wins when both run in one commit.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const anchor = anchorRef.current;
    if (pane === null || anchor === null) return;
    pane.scrollTo({ left: anchor * scale - pane.clientWidth / 2, behavior: 'instant' });
    read();
  }, [paneRef, scale, read]);

  // The opening: set the pane on the current milestone (or the held selection). A pane with no width cannot take it, so it is owed until one arrives.
  const open = useCallback(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    openingOwed.current = pane.clientWidth === 0;
    if (openingOwed.current) return;
    const { layout: drawn, scale: drawnAt, current: wanted, selectedKey: held } = latest.current;
    if (drawn.width * drawnAt > pane.clientWidth) {
      const spot = drawn.milestones.find((item) => item.milestone.name === wanted) ?? drawn.milestones.at(-1);
      if (spot !== undefined) pane.scrollTo({ left: spot.x * drawnAt - pane.clientWidth / 2, behavior: 'instant' });
      // A held selection the current column leaves outside the pane's width wins: it is what the reader left on.
      if (held !== null) centreNodeIn(pane, held, 'instant');
    }
  }, [paneRef]);

  useLayoutEffect(() => {
    justOpened.current = true;
    open();
    read();
  }, [roadmapName, open, read]);

  // The selection: a press on a node in view needs no travel, and one the panel's rows made may need a lot.
  useEffect(() => {
    if (justOpened.current) {
      justOpened.current = false;
      return;
    }
    const pane = paneRef.current;
    if (pane === null || selectedKey === null) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    centreNodeIn(pane, selectedKey, still ? 'instant' : 'smooth');
  }, [paneRef, selectedKey, roadmapName]);

  // The goal: once per frame, whatever moved the pane.
  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return undefined;
    let frame = 0;
    const onFrame = () => {
      frame = 0;
      read();
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(onFrame);
    };
    pane.addEventListener('scroll', schedule, { passive: true });
    // A pane that gains its width (shown again under its tab) takes the opening it was owed, then is read as any other.
    const resizing = new ResizeObserver(() => {
      if (openingOwed.current) open();
      schedule();
    });
    resizing.observe(pane);
    return () => {
      pane.removeEventListener('scroll', schedule);
      resizing.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [paneRef, read, open]);

  // A pane not yet read, or not drawn (width 0), reads as holding the whole drawing.
  const holdsAll = view === null || view.width === 0 || layout.width * scale <= view.width;
  if (holdsAll) return layout.width / 2;
  return Math.min(layout.width - GOAL_MARGIN, Math.max(GOAL_MARGIN, (view.left + view.width / 2) / scale));
}
