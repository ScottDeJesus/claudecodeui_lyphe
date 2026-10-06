import { Pointer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EpicPanel } from '@/modules/roadmap/panel/EpicPanel';
import { FeaturePanel } from '@/modules/roadmap/panel/FeaturePanel';
import { MilestonePanel } from '@/modules/roadmap/panel/MilestonePanel';
import { RoadmapPanel } from '@/modules/roadmap/panel/RoadmapPanel';
import type { TreeDotSpot, TreeEpicSpot, TreeLayout, TreeMilestoneSpot } from '@/modules/roadmap/utils/treeLayout';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapTreeSelection } from '@/shared/types';
import { Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * What the panel draws: the roadmap, or one item as the layout holds it, with the spots above it (a
 * milestone's spot carries its place `n`, an epic's row its milestone's, a dot its state).
 */
type PanelSubject =
  | { kind: 'roadmap' }
  | { kind: 'milestone'; spot: TreeMilestoneSpot }
  | { kind: 'epic'; spot: TreeMilestoneSpot; row: TreeEpicSpot }
  | { kind: 'feature'; spot: TreeMilestoneSpot; row: TreeEpicSpot; dot: TreeDotSpot };

/**
 * The selection found in the layout the tree draws, so the panel and the tree judge alike what the picture
 * still holds: null for no selection, and for a name the picture no longer holds.
 */
function findSubject(layout: TreeLayout, selected: RoadmapTreeSelection | null): PanelSubject | null {
  if (selected === null) return null;
  if (selected.kind === 'roadmap') return { kind: 'roadmap' };
  for (const spot of layout.milestones) {
    if (selected.kind === 'milestone' && spot.milestone.name === selected.name) return { kind: 'milestone', spot };
    for (const row of spot.epics) {
      if (selected.kind === 'epic' && row.epic.name === selected.name) return { kind: 'epic', spot, row };
      const dot = selected.kind === 'feature' ? row.dots.find((item) => item.feature.name === selected.name) : undefined;
      if (dot !== undefined) return { kind: 'feature', spot, row, dot };
    }
  }
  return null;
}

type TreePanelProps = {
  roadmap: Roadmap;
  /** The roadmap laid out (`layoutTree`), the tree's own: the panel finds its item there and paints its rows' dots from `dots`. */
  layout: TreeLayout;
  /** The item the face holds selected on this roadmap; null for none. */
  selected: RoadmapTreeSelection | null;
  /** A press on a row, which moves the selection to the row's item. */
  onSelect: (selection: RoadmapTreeSelection) => void;
  /** `viewport`: a fixed band under a tree fitted to the face, its inside scrolling. `column`: its natural height, in a column that scrolls as one. */
  fit: 'viewport' | 'column';
};

/**
 * The details panel under the roadmap's tree. It covers nothing, and its width is its own: the library card,
 * centred, as wide as a reading measure (`max-w-3xl`) whatever the tree's width.
 *
 * IN VIEWPORT FIT IT IS A FIXED BAND (`h-[clamp(9rem,26vh,16rem)]`), so the tree's scale never changes as the
 * panel fills: what the band cannot hold scrolls inside it, in the house's thin bar, and a swipe past its end
 * stays in it. In column fit it takes its natural height, in a column that scrolls as one.
 *
 * WHAT IT SHOWS: with nothing selected, or with the selected item gone from the picture, the hint, which says
 * what to press; otherwise the selected item's own panel, `data-roadmap-panel` naming which. Each item's panel
 * is drawn afresh (its scroller keyed by the item), so a new selection opens at its head and its quote folded.
 *
 * Used by the roadmap module's Roadmap face, `RoadmapPath`, directly under its tree.
 */
export function TreePanel({ roadmap, layout, selected, onSelect, fit }: TreePanelProps) {
  const { t } = useTranslation();
  const subject = findSubject(layout, selected);
  const viewport = fit === 'viewport';

  const body = (() => {
    switch (subject?.kind) {
      case 'roadmap':
        return <RoadmapPanel roadmap={roadmap} onSelect={onSelect} />;
      case 'milestone':
        return <MilestonePanel roadmap={roadmap} milestone={subject.spot.milestone} n={subject.spot.n} onSelect={onSelect} />;
      case 'epic':
        return <EpicPanel epic={subject.row.epic} n={subject.spot.n} dots={layout.dots} onSelect={onSelect} />;
      case 'feature':
        return <FeaturePanel feature={subject.dot.feature} epic={subject.row.epic} milestone={subject.spot.milestone} n={subject.spot.n} dot={subject.dot.state} />;
      default:
        return null;
    }
  })();

  return (
    <Card
      data-roadmap-panel={subject?.kind ?? 'hint'}
      className={cn('mx-auto flex w-full min-w-0 max-w-3xl flex-col', viewport && 'h-[clamp(9rem,26vh,16rem)] shrink-0 overflow-hidden')}
    >
      <div
        key={selected === null || subject === null ? 'hint' : selected.kind === 'roadmap' ? 'roadmap' : `${selected.kind}:${selected.name}`}
        className={cn('min-w-0', viewport && 'min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin')}
      >
        {body === null ? (
          <div className={cn('flex flex-col items-center justify-center gap-2 px-6 text-center', viewport ? 'h-full py-4' : 'py-6')}>
            <Pointer aria-hidden="true" className="size-4 text-muted-foreground" />
            <p className="max-w-md text-balance text-sm text-muted-foreground">{t('roadmap.panel.hint')}</p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3 px-4 py-3.5">{body}</div>
        )}
      </div>
    </Card>
  );
}
