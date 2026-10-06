import { Flag } from 'lucide-react';
import { useContext } from 'react';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { TreeHalo } from '@/modules/roadmap/tree/TreeHalo';
import type { TreeLayout } from '@/modules/roadmap/utils/treeLayout';
import { cn } from '@/shared/utils';

// The tree's apex: the goal's flag ring and label, and one connector from under the label to each milestone.
// Both take the goal's x as a prop, because the tree moves it as its pane scrolls sideways; they are the only
// part of the drawing that redraws then.

/** How far above a milestone's eyebrow its connector stops, so the line ends short of the words. */
const CONNECTOR_END_ABOVE_EYEBROW = 14;

/**
 * The connector's two control points: straight down from its start by the first, straight up from its end
 * by the second, the prototype's own curve (tree-prototype.html:55). It leaves the goal downward, sweeps out
 * level and drops into its milestone.
 */
const CONNECTOR_PULL = { down: 40, up: 28 } as const;

/** The flag inside the goal's ring, in the drawing's units. */
const FLAG_SIZE = 12;

type TreeGoalConnectorsProps = {
  layout: TreeLayout;
  /** The goal's x in the drawing: its centre, or the pane's visible centre while the drawing overflows. */
  goalX: number;
};

/**
 * One cubic per milestone, from (goal x, the goal's bottom), below its label and never through it, to
 * (milestone x, its eyebrow less 14). `--border-strong` at 1.4, and `--accent` once that milestone's word is
 * reached. While the milestone's moment plays, its connector draws itself on `roadmap-draw` (`pathLength` 1
 * and a dash of 1); under reduced motion it is simply drawn. An edge: drawn under every node.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, first among its edges.
 */
export function TreeGoalConnectors({ layout, goalX }: TreeGoalConnectorsProps) {
  const active = useContext(CelebrationContext);
  const { bottom } = layout.goal;
  return (
    <>
      {layout.milestones.map((spot) => {
        const endY = spot.eyebrowY - CONNECTOR_END_ABOVE_EYEBROW;
        const drawing = active.milestone === spot.milestone.name;
        return (
          <path
            key={spot.milestone.name}
            d={`M ${goalX} ${bottom} C ${goalX} ${bottom + CONNECTOR_PULL.down} ${spot.x} ${endY - CONNECTOR_PULL.up} ${spot.x} ${endY}`}
            strokeWidth={1.4}
            pathLength={drawing ? 1 : undefined}
            strokeDasharray={drawing ? 1 : undefined}
            className={cn('fill-none', spot.milestone.word === 'reached' ? 'stroke-primary' : 'stroke-input', drawing && 'motion-safe:animate-roadmap-draw')}
          />
        );
      })}
    </>
  );
}

type TreeGoalProps = {
  layout: TreeLayout;
  goalX: number;
  /** The roadmap has no goal written: the label is the layout's "missing" words, set in italic and muted. */
  missing: boolean;
  /** The roadmap itself is what the tree has selected. */
  selected: boolean;
  /** The words the tip says of the goal, as one line: the node's accessible name. */
  label: string;
};

/**
 * The goal at the apex: a flag ring (r 12, `--ink` at 1.6 on the surface, lucide's Flag 12px at its centre)
 * and the goal's label under it, the display serif at 18px in `--ink`, centred on the goal's x, in the lines
 * and baselines the layout wrapped it to. A roadmap with no goal shows its "missing" words there, in italic
 * `--ink-muted`.
 *
 * A press on any of it selects the roadmap itself: the group is a button (`data-tree-key="roadmap"`, Enter
 * or Space), wears no outline, and draws its halo as its focus ring. `data-roadmap-goal` marks it for a probe.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, first among its nodes.
 */
export function TreeGoal({ layout, goalX, missing, selected, label }: TreeGoalProps) {
  const { y, r, lines, baselines } = layout.goal;
  return (
    <g
      data-tree-key="roadmap"
      data-roadmap-goal
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      // `outline-none` alone loses to tokens.css's `[tabindex]:focus-visible` outline (0,2,0); the halo is the ring.
      className="group cursor-pointer outline-none focus-visible:outline-none"
    >
      <circle cx={goalX} cy={y} r={r} strokeWidth={1.6} className="fill-card stroke-foreground" />
      <Flag
        aria-hidden="true"
        x={goalX - FLAG_SIZE / 2}
        y={y - FLAG_SIZE / 2}
        size={FLAG_SIZE}
        strokeWidth={2.25}
        className="pointer-events-none text-foreground"
      />
      <TreeHalo cx={goalX} cy={y} r={r} mark="ring" selected={selected} celebrating={false} />
      {lines.map((line, index) => (
        <text
          key={index}
          x={goalX}
          y={baselines[index]}
          textAnchor="middle"
          className={cn('font-serif text-[18px]', missing ? 'fill-muted-foreground italic' : 'fill-foreground')}
        >
          {line}
        </text>
      ))}
    </g>
  );
}
