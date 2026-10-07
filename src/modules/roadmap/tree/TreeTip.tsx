type TreeTipProps = {
  /** The item's name: a title, or "Goal". */
  head: string;
  /** What it stands at: its word and its counts. */
  line: string;
  /** The chip's top edge in the tree's `relative` wrapper, in px. */
  top: number;
  /** The chip's left edge from the wrapper's left edge, in px: the chip stands right of that point. */
  left?: number;
  /** Or its right edge from the wrapper's right edge, in px: the chip stands left of that point and wraps to the room there. */
  right?: number;
};

/**
 * The tip a pointer raises over a node or a dot: Verve's tooltip chip (`.vv-tooltip`, ink ground and canvas
 * text) at most 240px wide, its head over its line. It stands where the tree puts it in its wrapper and never
 * takes the pointer itself, since a chip under the pointer would steal the hover that raised it. A screen
 * reader skips it: every node's `aria-label` already says these words.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, as the last child of its wrapper.
 */
export function TreeTip({ head, line, left, right, top }: TreeTipProps) {
  return (
    <div data-roadmap-tip aria-hidden="true" className="vv-tooltip pointer-events-none absolute z-10 max-w-60" style={{ left, right, top }}>
      <span className="block font-semibold leading-snug">{head}</span>
      <span className="block text-xs font-normal leading-snug">{line}</span>
    </div>
  );
}
