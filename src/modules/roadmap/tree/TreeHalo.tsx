import { cn } from '@/shared/utils';

/** How far outside its mark the halo stands: 6 round a ring, 3.5 round a feature's dot. */
const HALO_GAP: Record<'ring' | 'dot', number> = { ring: 6, dot: 3.5 };

/**
 * The halo's stroke: 1.5 round a ring; 2 round a dot, whose halo (r 6.3) is small enough that a thinner dashed
 * ring breaks into specks among its neighbours.
 */
const HALO_WIDTH: Record<'ring' | 'dot', number> = { ring: 1.5, dot: 2 };

/** The clear ground a dot's cut-out (`TreeDotCut`) leaves either side of its halo. */
const CUT_MARGIN = 0.75;

/** A point of the drawing: a dot's centre. */
type DotAt = { x: number; y: number };

type TreeHaloProps = {
  /** The centre and radius of the MARK it rings; the halo stands `HALO_GAP` outside it. */
  cx: number;
  cy: number;
  r: number;
  /** A ring belongs to a node that takes keyboard focus (the goal, a milestone, an epic); a dot never does. */
  mark: 'ring' | 'dot';
  /** The item is the one the tree has selected. */
  selected: boolean;
  /** A moment names the item right now. */
  celebrating: boolean;
};

/**
 * The circle a node wears round its mark, one circle for three states:
 *
 * - SELECTED: dashed (2 3) in `--ink`, the prototype's dotted halo;
 * - KEYBOARD FOCUS on a ring's node: solid `--accent`, the house focus ring's ink. The node's own `<g>` is the
 *   Tailwind `group` and wears no outline, so this is the ring a Tab lands on. Never on a dot, which sits inside
 *   its epic's `group`: an epic in focus must not ring every dot it holds;
 * - NAMED BY A MOMENT under reduced motion, where nothing moves: solid `--accent`, held for as long as the moment
 *   names it. With motion, the moment is the node's own motion and this stays as it was.
 *
 * Hidden otherwise. It never takes the pointer, so a press through it lands on the mark beneath. A dot's halo is
 * stroked 2 wide and stands in its cut-out (`TreeDotCut`), which cuts the neighbours it passes over back to the
 * ground. Used by the roadmap module's tree: `TreeGoal`, `TreeMilestoneNode` and `TreeEpicNode` (round its ring
 * and round a dot).
 */
export function TreeHalo({ cx, cy, r, mark, selected, celebrating }: TreeHaloProps) {
  return (
    <circle
      data-tree-halo={mark}
      aria-hidden="true"
      cx={cx}
      cy={cy}
      r={r + HALO_GAP[mark]}
      strokeWidth={HALO_WIDTH[mark]}
      className={cn(
        'pointer-events-none fill-none',
        selected ? 'stroke-foreground [stroke-dasharray:2_3]' : 'hidden stroke-primary',
        celebrating && 'motion-reduce:block motion-reduce:stroke-primary motion-reduce:[stroke-dasharray:none]',
        mark === 'ring' && 'group-focus-visible:block group-focus-visible:stroke-primary group-focus-visible:[stroke-dasharray:none] group-focus-visible:[stroke-width:2]',
      )}
    />
  );
}

/** A closed circle as two arcs: one subpath of a path that holds several. */
function circlePath({ x, y }: DotAt, r: number): string {
  return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

type TreeDotCutProps = {
  /** The mask's id: an epic's dots that wear no halo take it as their `mask` while any dot of it wears one. */
  id: string;
  /** Every dot of the epic: the mask covers their box. */
  dots: DotAt[];
  /** A dot's radius: its halo stands `HALO_GAP.dot` outside it. */
  r: number;
  /** The selected dot, whose halo always shows; null when no dot of this epic is selected. */
  selected: DotAt | null;
  /** The dots a moment names, whose halo shows under reduced motion only. */
  celebrating: DotAt[];
};

/**
 * The cut-out a dot's halo stands in. A dot's halo (r 6.3) passes over the dots beside it, eight apart, so its
 * dashes would read as specks on a row of dots. This mask takes an annulus out of those neighbours, the halo's
 * own width and 0.75 either side, so they are cut back to half-moons and the dashes stand on the tree's own
 * ground, whatever that ground is (the tab's canvas, a widget card's surface): a mask paints nothing, so it
 * needs no ground colour. It is an alpha mask (`mask-type: alpha`, inline so no generated class can fail it),
 * one even-odd path of the dots' box with the annuli as holes. A celebrating dot's annulus is cut under reduced
 * motion only, where its halo shows; with motion its moment is its own bloom. A mask leaves hit-testing alone,
 * so a cut-back neighbour still takes its press, and the haloed dots never take the mask, so no cut bites them.
 *
 * Used by the roadmap module's tree, `tree/TreeEpicNode`, while one of its dots wears a halo.
 */
export function TreeDotCut({ id, dots, r, selected, celebrating }: TreeDotCutProps) {
  const radius = r + HALO_GAP.dot;
  const half = HALO_WIDTH.dot / 2 + CUT_MARGIN;
  const reach = radius + half;
  const left = Math.min(...dots.map((dot) => dot.x)) - reach;
  const top = Math.min(...dots.map((dot) => dot.y)) - reach;
  const width = Math.max(...dots.map((dot) => dot.x)) + reach - left;
  const height = Math.max(...dots.map((dot) => dot.y)) + reach - top;
  const box = `M ${left} ${top} h ${width} v ${height} h ${-width} Z`;
  const annulus = (dot: DotAt) => `${circlePath(dot, radius + half)} ${circlePath(dot, radius - half)}`;
  const always = selected === null ? [] : [annulus(selected)];

  return (
    <mask id={id} maskUnits="userSpaceOnUse" x={left} y={top} width={width} height={height} style={{ maskType: 'alpha' }}>
      <path d={[box, ...always].join(' ')} fillRule="evenodd" className="fill-foreground motion-reduce:hidden" />
      <path d={[box, ...always, ...celebrating.map(annulus)].join(' ')} fillRule="evenodd" className="hidden fill-foreground motion-reduce:block" />
    </mask>
  );
}
