import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { TreeHalo } from '@/modules/roadmap/tree/TreeHalo';
import { TreeRing } from '@/modules/roadmap/tree/TreeRing';
import type { TreeMilestoneSpot } from '@/modules/roadmap/utils/treeLayout';
import { ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import { cn } from '@/shared/utils';

// One milestone's column in the tree: its edges (the spine its epics hang from, and each row's tick) and its
// node (the eyebrow, the ring with its number, the title and its line). The two are drawn apart, edges under
// every node, and its epics are nodes of their own beside it, never inside its button.

/**
 * A milestone's spine and its rows' ticks, in `--border-strong`. The stem leaves the milestone's x at the
 * spine's top, runs out to the spine and down to the last row's centre, and turns `--accent` once the
 * milestone is reached; each tick runs from the spine to just short of its epic's ring and turns `--accent`
 * once that epic is complete. A milestone with no epic has no spine. An edge: drawn under every node.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, one per milestone after the goal's connectors.
 */
export function TreeMilestoneEdges({ spot }: { spot: TreeMilestoneSpot }) {
  const { milestone, spine, epics } = spot;
  if (epics.length === 0) return null;
  return (
    <>
      <path
        d={`M ${spot.x} ${spine.top} H ${spine.x} V ${spine.bottom}`}
        strokeWidth={1.4}
        className={cn('fill-none', milestone.word === 'reached' ? 'stroke-primary' : 'stroke-input')}
      />
      {epics.map((row) => (
        <path
          key={row.epic.name}
          d={`M ${spine.x} ${row.y} H ${row.tickTo}`}
          strokeWidth={1.4}
          className={cn('fill-none', row.epic.word === 'complete' ? 'stroke-primary' : 'stroke-input')}
        />
      ))}
    </>
  );
}

type TreeMilestoneNodeProps = {
  spot: TreeMilestoneSpot;
  /** The milestone is the roadmap's current one, the first not reached. */
  current: boolean;
  /** The milestone is what the tree has selected. */
  selected: boolean;
  /** The words the tip says of the milestone, as one line: the node's accessible name. */
  label: string;
};

/**
 * One milestone, top to bottom: the eyebrow ("MILESTONE n", 9px, tracked .14em, `--ink-muted`), its completion
 * ring (r 22, stroke 3, the share of its features shipped) with n inside at 12px semibold, its title in the
 * layout's two lines (12px semibold, `--ink`), and its line, "x of y features · <word>", or the word alone
 * while it holds no feature.
 *
 * It is a button (`data-tree-key="milestone:<name>"`, Enter or Space selects it), `aria-current="step"` while
 * it is the roadmap's current milestone. `data-roadmap-milestone` is what `CelebrationLayer` finds it by: it
 * measures this group's FIRST child, the ring's track, for the burst's origin, and focuses the group when the
 * moment ends, so the ring is always drawn first.
 *
 * THE MILESTONE MOMENT is the ring's: its last share draws itself and it blooms, while the goal's connector to
 * it draws itself (`TreeGoalConnectors`). Under reduced motion it is still, and the halo holds a solid accent
 * ring for as long as the moment names it.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, each milestone before its epics.
 */
export function TreeMilestoneNode({ spot, current, selected, label }: TreeMilestoneNodeProps) {
  const { t } = useTranslation();
  const active = useContext(CelebrationContext);
  const { milestone, n, x, y, r } = spot;
  const moment = active.milestone === milestone.name;
  const { features, shipped } = milestone.standing;
  const word = t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]);

  return (
    <g
      data-tree-key={`milestone:${milestone.name}`}
      data-roadmap-milestone={milestone.name}
      data-celebrating={moment ? 'milestone' : undefined}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-current={current ? 'step' : undefined}
      aria-label={label}
      // `outline-none` alone loses to tokens.css's `[tabindex]:focus-visible` outline (0,2,0); the halo is the ring.
      className="group cursor-pointer outline-none focus-visible:outline-none"
    >
      <TreeRing cx={x} cy={y} r={r} strokeWidth={3} shipped={shipped} total={features} moment={moment} />
      <TreeHalo cx={x} cy={y} r={r} mark="ring" selected={selected} celebrating={moment} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-foreground text-[12px] font-semibold tabular-nums">
        {n}
      </text>
      <text x={x} y={spot.eyebrowY} textAnchor="middle" className="fill-muted-foreground text-[9px] uppercase tracking-[.14em]">
        {t('roadmap.tree.milestone', { n })}
      </text>
      {spot.titleLines.map((line, index) => (
        <text key={index} x={x} y={spot.titleBaselines[index]} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">
          {line}
        </text>
      ))}
      <text x={x} y={spot.lineY} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
        {features === 0 ? word : t('roadmap.tree.milestoneLine', { shipped, count: features, word })}
      </text>
    </g>
  );
}
