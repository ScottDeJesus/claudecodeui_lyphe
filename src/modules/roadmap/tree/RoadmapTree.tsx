import { Fragment, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { TreeEpicNode } from '@/modules/roadmap/tree/TreeEpicNode';
import { TreeGoal, TreeGoalConnectors } from '@/modules/roadmap/tree/TreeGoal';
import { selectionUnder } from '@/modules/roadmap/tree/treeKeys';
import { TreeMilestoneEdges, TreeMilestoneNode } from '@/modules/roadmap/tree/TreeMilestoneNode';
import { TreeTip } from '@/modules/roadmap/tree/TreeTip';
import { TreeZoomControls } from '@/modules/roadmap/tree/TreeZoomControls';
import { useTreeWords } from '@/modules/roadmap/tree/treeWords';
import { useTreePane } from '@/modules/roadmap/tree/useTreePane';
import { useTreeZoom } from '@/modules/roadmap/tree/useTreeZoom';
import type { TreeLayout } from '@/modules/roadmap/utils/treeLayout';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapTreeSelection } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The least the drawing is scaled to fit a height: its 11.5px titles stay at 6.9px. Held there, the pane scrolls down too. */
const SCALE_FLOOR = 0.6;

/** What the pane keeps under the drawing for its own sideways scrollbar, in px. */
const SCROLLBAR_ALLOWANCE = 8;

/** The tip's gap from the pointer, right of it and below it, in px. */
const TIP_GAP = 14;

/** Nearer than this to the wrapper's right edge, the pointer's tip flips to its left (the prototype's own rule). */
const TIP_FLIP_WITHIN = 250;

/** The least room a flipped chip is given left of the pointer: with less, it stays right of it and wraps to the room it has there. */
const TIP_FLIP_MIN_ROOM = 120;

/**
 * Where the tip stands and what it names: the item under the pointer, and the chip's place in the wrapper, in px.
 * Right of the pointer it is `left` from the wrapper's left edge; flipped, it is `right` from the wrapper's right
 * edge, so its own right edge stands the gap left of the pointer whatever its width.
 */
type TipSpot = { item: RoadmapTreeSelection; top: number; left?: number; right?: number };

type RoadmapTreeProps = {
  roadmap: Roadmap;
  /** The roadmap laid out (`layoutTree`): every position, wrapped line and dot state the drawing reads. */
  layout: TreeLayout;
  /** The px of height the face can give the tree; `null` draws it at its natural size. */
  maxHeight: number | null;
  /** The item the face holds selected on this roadmap, which wears the dotted halo; `null` for none. */
  selected: RoadmapTreeSelection | null;
  /** A press, Enter or Space on the goal, a milestone or an epic, or a press on a feature's dot. */
  onSelect: (selection: RoadmapTreeSelection) => void;
  /** The tree's own sideways scroller, which the face also hands a milestone moment's in-view scroll. */
  paneRef: RefObject<HTMLDivElement>;
};

/** The name `selected` holds when it is of `kind`, else null. */
function selectedOf(selected: RoadmapTreeSelection | null, kind: 'milestone' | 'epic' | 'feature'): string | null {
  return selected !== null && selected.kind !== 'roadmap' && selected.kind === kind ? selected.name : null;
}

/**
 * The roadmap as one SVG tree, drawn from its layout: the goal at the apex with a connector to each milestone,
 * a ring per milestone in a row beneath, and under each a spine of epic rings with their titles, feature dots
 * and lines.
 *
 * THE FIT. The fit never grows the drawing past its natural size: its scale is 1, or, given a `maxHeight`, the
 * height less the scrollbar's allowance over the natural height, clamped to [0.6, 1]. The svg is drawn at the
 * fit times the user's zoom (its viewBox the layout's own), centred while it is narrower than its pane. The pane
 * (`data-roadmap-tree`) scrolls sideways in its own thin bar, and takes `maxHeight` and scrolls down as well
 * while the 0.6 floor holds the scale or the zoom is above 1. A swipe past its sideways end stays in it
 * (`overscroll-x-contain`), never chaining to the page's back gesture. It bleeds 4px above the drawing
 * (`-mt-1 pt-1`) and the svg paints past its box, so the goal's halo, whose top stands above the drawing's, is
 * not cut flat. The drawing's words are not selectable (`select-none`): a double press is a press, never a
 * highlighted title.
 *
 * THE ZOOM. `useTreeZoom` multiplies the fit by a zoom of 1 to 2.5, set by a pinch, `ctrl`+wheel, a double-tap or
 * the three buttons of `TreeZoomControls` (pinned in the wrapper's corner), and keeps the drawing point under the
 * gesture where it was; the pane keeps its native scrolling, and carries `touch-action: pan-x pan-y` so a
 * two-finger pinch reaches the page rather than being taken by the browser's own scroll.
 *
 * WHAT IS DRAWN, in paint order: the edges first (the goal's connectors, each milestone's spine and ticks), then
 * the nodes (the goal, then each milestone followed by its epics, which is also the order a Tab walks), so
 * every node paints over every edge. The goal and its connectors take the goal's x, which follows the pane's
 * scroll (`useTreePane`, which also opens the pane on the current milestone and scrolls it to a selection);
 * everything else is memoised on the layout and the selection, so a scroll redraws only them.
 *
 * Every node and dot carries `data-tree-key` (`roadmap`, `milestone:<name>`, `epic:<name>`, `feature:<name>`),
 * the one key a press reads off the nearest node; the goal, the milestones and the epics are buttons, a dot is
 * not a tab stop. `data-roadmap-goal`, `-milestone`, `-epic` and `-feature` mark them for `CelebrationLayer`
 * and the probes; `data-selected` the selected item; `data-celebrating` what a moment names. The tip
 * (`data-roadmap-tip`) stands in the tree's `relative` wrapper, out of the pane's clip.
 *
 * Used by the roadmap module's Roadmap face, `RoadmapTreeFace`, under its picker row, in both fits.
 */
export function RoadmapTree({ roadmap, layout, maxHeight, selected, onSelect, paneRef }: RoadmapTreeProps) {
  const { t } = useTranslation();
  const words = useTreeWords(roadmap, layout);

  const fit = maxHeight === null ? 1 : (maxHeight - SCROLLBAR_ALLOWANCE) / layout.height;
  const fitScale = Math.min(1, Math.max(SCALE_FLOOR, fit));
  // The floor holds the scale: the drawing is taller than the height it was given, and the pane scrolls down.
  const floored = maxHeight !== null && fit < SCALE_FLOOR;

  // The user's zoom over the fit, and the scale the svg is drawn at. Called BEFORE `useTreePane`: it places the
  // pane for a zoom in its layout effect, and the pane hook's own hold of the centre skips a zoom.
  const { zoom, scale, canZoomIn, canZoomOut, zoomIn, zoomOut, zoomToFit } = useTreeZoom({ paneRef, roadmapName: roadmap.name, fitScale });
  // Zoomed, the drawing outgrows the height it was given and the pane scrolls down in it. The column's tree has
  // no `maxHeight`, so a zoomed pane keeps the height the drawing takes at the fit and scrolls inside it,
  // rather than pushing the panel away.
  const scrollsDown = floored || zoom > 1;
  const zoomedHeight = maxHeight ?? layout.height * fitScale + SCROLLBAR_ALLOWANCE;

  // The goal's x in the drawing: its centre while the drawing fits its pane, else the pane's visible centre in
  // drawing units, (scrollLeft + clientWidth / 2) / scale, kept within [200, width − 200]. The same hook opens
  // the pane on the current milestone and scrolls it to a selection.
  const goalX = useTreePane({ paneRef, layout, scale, zoom, roadmapName: roadmap.name, current: roadmap.current, selected });

  // The `relative` box the tip stands in: its corner is the origin of the tip's left and top, and its right edge of the tip's right.
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The chip the pointer raises over a node or a dot: the item it names and where it stands in the wrapper,
  // 14px off the pointer and flipped to its left within 250px of the wrapper's right edge; null while the
  // pointer rests on neither. Not derivable: only the pointer's last move says it.
  const [tip, setTip] = useState<TipSpot | null>(null);

  // The tip follows a mouse or a pen over the drawing; a finger has no hover, and its press is the selection.
  const followPointer = (event: PointerEvent<SVGSVGElement>) => {
    const wrapper = wrapperRef.current;
    const item = selectionUnder(event.target);
    if (event.pointerType === 'touch' || wrapper === null || item === null) {
      setTip(null);
      return;
    }
    const box = wrapper.getBoundingClientRect();
    const x = event.clientX - box.left;
    const top = event.clientY - box.top + TIP_GAP;
    // Flipped, the chip is anchored by its right edge, so it grows leftward and wraps to the room the pointer
    // leaves it: it never crosses the wrapper's left edge. A pointer too near that edge to leave it a useful
    // chip keeps the chip on its right, where it wraps to the room instead.
    const flips = box.width - x < TIP_FLIP_WITHIN && x - TIP_GAP >= TIP_FLIP_MIN_ROOM;
    setTip(flips ? { item, top, right: box.width - x + TIP_GAP } : { item, top, left: x + TIP_GAP });
  };

  // Enter and Space press a focused node as a click does. The target must be the node itself (a button of the
  // tree): a dot is no tab stop, so a key never reaches one. Space is kept from scrolling the page.
  const pressWithKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target instanceof Element) || !event.target.matches('[role="button"][data-tree-key]')) return;
    const item = selectionUnder(event.target);
    if (item === null) return;
    event.preventDefault();
    onSelect(item);
  };

  // The spines and ticks: they move only with the layout.
  const edges = useMemo(() => layout.milestones.map((spot) => <TreeMilestoneEdges key={spot.milestone.name} spot={spot} />), [layout]);

  // Each milestone, then its epics: memoised on what they draw, so the goal's scroll leaves them be.
  const { current } = roadmap;
  const nodes = useMemo(() => {
    const label = (item: RoadmapTreeSelection) => {
      const { head, line } = words(item);
      return `${head} — ${line}`;
    };
    const milestone = selectedOf(selected, 'milestone');
    const epic = selectedOf(selected, 'epic');
    const feature = selectedOf(selected, 'feature');
    return layout.milestones.map((spot) => (
      <Fragment key={spot.milestone.name}>
        <TreeMilestoneNode
          spot={spot}
          current={spot.milestone.name === current}
          selected={spot.milestone.name === milestone}
          label={label({ kind: 'milestone', name: spot.milestone.name })}
        />
        {spot.epics.map((row) => (
          <TreeEpicNode
            key={row.epic.name}
            spot={row}
            selected={row.epic.name === epic}
            selectedFeature={row.dots.some((dot) => dot.feature.name === feature) ? feature : null}
            label={label({ kind: 'epic', name: row.epic.name })}
          />
        ))}
      </Fragment>
    ));
  }, [layout, current, selected, words]);

  const goal = words({ kind: 'roadmap' });
  // The words of the item the pointer last rested on: empty once a frame has taken that item away, and an empty chip is never drawn.
  const tipWords = tip === null ? null : words(tip.item);

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={paneRef}
        data-roadmap-tree
        // `touch-pan-x touch-pan-y` (`pan-x pan-y`): both scroll axes stay native, and the browser's own pinch is
        // left out, so two fingers reach `useTreeZoom` instead of being claimed by the page.
        className={cn('scrollbar-thin touch-pan-x touch-pan-y -mt-1 overflow-x-auto overscroll-x-contain pt-1', scrollsDown ? 'overflow-y-auto' : 'overflow-y-hidden')}
        style={scrollsDown ? { maxHeight: zoomedHeight } : undefined}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width * scale}
          height={layout.height * scale}
          role="group"
          aria-label={t('roadmap.tree.label')}
          className="mx-auto block select-none overflow-visible"
          // One delegated press: the nearest `[data-tree-key]` to its target names the item, so a dot's own key wins over its epic's.
          onClick={(event) => {
            const item = selectionUnder(event.target);
            if (item !== null) onSelect(item);
          }}
          onKeyDown={pressWithKey}
          onPointerMove={followPointer}
          onPointerLeave={() => setTip(null)}
        >
          <g aria-hidden="true">
            <TreeGoalConnectors layout={layout} goalX={goalX} />
            {edges}
          </g>
          <TreeGoal
            layout={layout}
            goalX={goalX}
            missing={roadmap.goal === null}
            selected={selected?.kind === 'roadmap'}
            label={`${goal.head} — ${goal.line}`}
          />
          {nodes}
        </svg>
      </div>
      <TreeZoomControls canZoomIn={canZoomIn} canZoomOut={canZoomOut} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={zoomToFit} />
      {tip !== null && tipWords !== null && tipWords.head !== '' && <TreeTip {...tipWords} left={tip.left} right={tip.right} top={tip.top} />}
    </div>
  );
}
