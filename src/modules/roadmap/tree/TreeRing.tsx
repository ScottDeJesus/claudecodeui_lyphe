import { cn } from '@/shared/utils';

// The completion ring a milestone and an epic share in the roadmap's tree: a track, the share shipped in
// accent on top of it, and, while the item's moment plays, that last share drawing itself as the ring blooms.

/**
 * What a ring's pieces carry while its moment plays: the swell (`roadmap-bloom`, 900 ms) and, once it ends,
 * the size it settles at (`scale-110`), held for as long as the moment is named. Under reduced motion none
 * of it applies; the node's halo marks the moment instead.
 */
const BLOOM = 'motion-safe:scale-110 motion-safe:animate-roadmap-bloom';

/**
 * What every piece of a ring carries, playing or not: it scales about its own centre (`fill-box`, so the
 * origin is the ring's box and not the drawing's corner), and eases back to its size when a moment lets go.
 */
const ABOUT_ITS_CENTRE = '[transform-box:fill-box] origin-center motion-safe:transition-transform motion-safe:duration-move';

/** A point of the ring round (`cx`, `cy`) of radius `r`, `share` of the way round clockwise from twelve o'clock. */
function ringPoint(cx: number, cy: number, r: number, share: number): string {
  const angle = share * 2 * Math.PI;
  return `${(cx + r * Math.sin(angle)).toFixed(3)} ${(cy - r * Math.cos(angle)).toFixed(3)}`;
}

/** The whole ring as one path that starts and ends at twelve o'clock, so a draw along it starts there too. */
function wholeRing(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
}

type TreeRingProps = {
  /** The ring's centre and radius, in the drawing's units. */
  cx: number;
  cy: number;
  r: number;
  strokeWidth: number;
  /** How many of the item's features have shipped. */
  shipped: number;
  /** How many features the item holds; with none, the track is drawn dashed and faint. */
  total: number;
  /** The item's own moment is playing: its last share draws itself and the ring blooms. */
  moment: boolean;
};

/**
 * One completion ring: shipped over features, read before any word.
 *
 * - The TRACK comes first, in `--border-strong` on the surface's fill; an item that holds no feature has a
 *   dashed (3 3) track in `--ink-faint`. It is the first element drawn, so a node that draws this ring first
 *   has the track circle as its first child, which `CelebrationLayer` measures for its burst.
 * - The SHIPPED ARC runs clockwise from twelve o'clock in `--accent`, with round caps. It is drawn as the whole
 *   circle with one dash (`pathLength` 1, dashed `share` on, the rest off, its start turned back a quarter to
 *   twelve o'clock), so no transform turns it and the bloom's transform is free to scale it.
 * - While `moment`, the last feature's share is an arc of its own that draws itself on `roadmap-draw`
 *   (`pathLength` 1 and a dash of 1, as that animation's comment asks; a one-feature item's last share is the
 *   whole ring), and the track and the arcs bloom together about the ring's centre. A moment is a completion,
 *   so the arcs then close the ring and the arcs' group has the ring's own box to bloom about.
 *
 * Decorative to a screen reader: its node's label says the same count. Used by the roadmap module's tree:
 * `TreeMilestoneNode` (r 22, stroke 3) and `TreeEpicNode` (r 17, stroke 2.5), each as the first thing in
 * its node.
 */
export function TreeRing({ cx, cy, r, strokeWidth, shipped, total, moment }: TreeRingProps) {
  const share = total === 0 ? 0 : Math.min(1, shipped / total);
  // What stood before the moment: the share less the last feature's, while the moment plays.
  const before = moment && total > 0 ? Math.max(0, shipped - 1) / total : share;
  const drawn = share - before;
  const circle = { cx, cy, r };

  return (
    <>
      <circle
        {...circle}
        strokeWidth={strokeWidth}
        strokeDasharray={total === 0 ? '3 3' : undefined}
        className={cn('fill-card', total === 0 ? 'stroke-ink-faint' : 'stroke-input', ABOUT_ITS_CENTRE, moment && BLOOM)}
      />
      {share > 0 && (
        <g strokeWidth={strokeWidth} strokeLinecap="round" className={cn('fill-none stroke-primary', ABOUT_ITS_CENTRE, moment && BLOOM)}>
          {before >= 1 && <circle {...circle} />}
          {before > 0 && before < 1 && <circle {...circle} pathLength={1} strokeDasharray={`${before} ${1 - before}`} strokeDashoffset={0.25} />}
          {drawn > 0 && (
            <path
              d={drawn >= 1 ? wholeRing(cx, cy, r) : `M ${ringPoint(cx, cy, r, before)} A ${r} ${r} 0 ${drawn > 0.5 ? 1 : 0} 1 ${ringPoint(cx, cy, r, share)}`}
              pathLength={1}
              strokeDasharray={1}
              className="motion-safe:animate-roadmap-draw"
            />
          )}
        </g>
      )}
    </>
  );
}
