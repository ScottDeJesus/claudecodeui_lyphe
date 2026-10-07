import { Pointer } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
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
 * A REGION A READER CAN FIND. The frame is a landmark named by the open panel's heading ("Details" while the hint
 * shows), so a screen reader that pressed the tree can jump to what the press filled. A row's press hands the
 * keyboard to the new panel's heading (`selectFromRow` names the panel, the effect on `shownKey` focuses it once
 * drawn), since the pressed row goes with the panel it stood in; a press on the tree leaves it on the tree's node.
 *
 * Used by the roadmap module's Roadmap face, `RoadmapTreeFace`, directly under its tree, in both fits.
 */
export function TreePanel({ roadmap, layout, selected, onSelect, fit }: TreePanelProps) {
  const { t } = useTranslation();
  const subject = findSubject(layout, selected);
  const viewport = fit === 'viewport';
  // The open panel's heading id: the frame is named by it, and a feature's Open is described by it.
  const headingId = useId();
  // The frame: the heading a row's press hands the keyboard to is found in it.
  const panelRef = useRef<HTMLDivElement>(null);
  // The item on show, as the scroller's key: a new item draws its panel afresh, at its head.
  const shownKey = selected === null || subject === null ? 'hint' : selected.kind === 'roadmap' ? 'roadmap' : `${selected.kind}:${selected.name}`;
  // The key the panel a row's press selects will be drawn under, held until that panel is on screen; null when no
  // row pressed (the tree's own presses never set it, so they leave focus on the tree's node). A ref: the effect
  // below reads it once the new panel is committed, and nothing is drawn from it.
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const wanted = focusKeyRef.current;
    // Spent on the first panel drawn after the press: a press whose item the picture no longer holds draws the hint, and must not leave a claim for a later tree press.
    focusKeyRef.current = null;
    if (wanted === shownKey) panelRef.current?.querySelector('h2')?.focus();
  }, [shownKey]);
  const selectFromRow = (selection: RoadmapTreeSelection) => {
    focusKeyRef.current = selection.kind === 'roadmap' ? 'roadmap' : `${selection.kind}:${selection.name}`;
    onSelect(selection);
  };

  const body = (() => {
    switch (subject?.kind) {
      case 'roadmap':
        return <RoadmapPanel roadmap={roadmap} headingId={headingId} onSelect={selectFromRow} />;
      case 'milestone':
        return <MilestonePanel roadmap={roadmap} milestone={subject.spot.milestone} n={subject.spot.n} headingId={headingId} onSelect={selectFromRow} />;
      case 'epic':
        return <EpicPanel epic={subject.row.epic} n={subject.spot.n} dots={layout.dots} headingId={headingId} onSelect={selectFromRow} />;
      case 'feature':
        return <FeaturePanel feature={subject.dot.feature} epic={subject.row.epic} milestone={subject.spot.milestone} n={subject.spot.n} dot={subject.dot.state} headingId={headingId} />;
      default:
        return null;
    }
  })();

  return (
    <Card
      ref={panelRef}
      role="region"
      aria-labelledby={body === null ? undefined : headingId}
      aria-label={body === null ? t('roadmap.panel.label') : undefined}
      data-roadmap-panel={subject?.kind ?? 'hint'}
      className={cn('mx-auto flex w-full min-w-0 max-w-3xl flex-col', viewport && 'h-[clamp(9rem,26vh,16rem)] shrink-0 overflow-hidden')}
    >
      <div
        key={shownKey}
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
