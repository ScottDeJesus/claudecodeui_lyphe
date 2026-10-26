import { Milestone, Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { CelebrationLayer } from '@/modules/roadmap/CelebrationLayer';
import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import type { FaceDialog, RoadmapFace } from '@/modules/roadmap/faceContext';
import { useCelebrations } from '@/modules/roadmap/hooks/useCelebrations';
import { useMilestoneMomentInView } from '@/modules/roadmap/hooks/useMilestoneMomentInView';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { useTreeRoom } from '@/modules/roadmap/hooks/useTreeRoom';
import { OpenDialog } from '@/modules/roadmap/modals/OpenDialog';
import { TreePanel } from '@/modules/roadmap/panel/TreePanel';
import { RoadmapPicker } from '@/modules/roadmap/RoadmapPicker';
import { RoadmapTree } from '@/modules/roadmap/tree/RoadmapTree';
import { UnplacedBanner } from '@/modules/roadmap/UnplacedBanner';
import { layoutTree } from '@/modules/roadmap/utils/treeLayout';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapTreeSelection } from '@/shared/types';
import { EmptyState, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

type RoadmapTreeFaceProps = {
  /**
   * `viewport`: the whole face fits the box it is given (the tree takes the height the panel's band leaves it,
   * down to a floor). `column`: a gutter cell too small for a legible tree and a panel side by side, so the
   * picker, the tree at its natural size and the panel scroll as one.
   */
  fit: 'viewport' | 'column';
  /** Shows a feature's live card, when the surface has a tab to turn to In flight; `null` where it has none (the landing is then `?runner=<plan>`). */
  openCard: ((plan: string) => void) | null;
  /** Pinned below the column's scroller while a roadmap is on screen: the surface's own way on. */
  foot?: ReactNode;
};

/** Whether the roadmap still holds the item a press named: the goal always, a milestone, epic or feature while the picture has it. */
function holdsItem(roadmap: Roadmap, item: RoadmapTreeSelection): boolean {
  if (item.kind === 'roadmap') return true;
  if (item.kind === 'milestone') return roadmap.milestones.some((milestone) => milestone.name === item.name);
  const epics = roadmap.milestones.flatMap((milestone) => milestone.epics);
  if (item.kind === 'epic') return epics.some((epic) => epic.name === item.name);
  return epics.some((epic) => epic.features.some((feature) => feature.name === item.name));
}

/**
 * THE ROADMAP FACE, drawn once for every surface that shows the roadmap: the picker, then one roadmap as a
 * tree (`RoadmapTree`) from its goal down to every feature's dot, with the details panel (`TreePanel`) under
 * it that the pressed item fills. It owns everything such a surface needs: the face context, the celebrations,
 * the one dialog slot, the states that come before a tree (the picture still on its way, no roadmap at all, a
 * roadmap with no milestone yet), and the one piece of state the tree and the panel share, the selection.
 *
 * TWO FITS, one component. In `viewport` fit the face fills its box and nothing in it scrolls: what the store
 * holds that no roadmap reaches stands first, then the picker row, then a body that holds the tree and, under
 * it, the panel's fixed band, and the tree is handed the height the band leaves (`useTreeRoom`). In `column`
 * fit one scroller holds the picker row, the tree at its natural size (in its own sideways pane) and the panel
 * at its natural height, with `foot` pinned below; a press on the tree brings the panel's head into view.
 *
 * THE SELECTION is held here, per roadmap (by name), so a switch to the other roadmap and back returns to the
 * item pressed there. Each render resolves it against the roadmap on screen: a name the picture no longer holds
 * reads as nothing selected, and the panel shows its hint.
 *
 * THE FACE'S BOX IS THE CELEBRATIONS' BOX. `rootRef` is what `useCelebrations` watches (a moment plays only
 * while this face is on screen), and its `relative` box is what `CelebrationLayer` covers, as its last child,
 * outside every scroller, so the milestone's banner centres in what the reader sees. The face provides
 * `CelebrationContext`, which the tree's nodes read to play their own part of a moment. A milestone moment
 * brings its ring into view first (`useMilestoneMomentInView`, handed the tree's own pane in viewport fit and
 * the column's scroller in column fit, the one that can hide it).
 *
 * ONE DIALOG AT A TIME, mounted in one slot: every press under the face that opens a dialog (a panel's menu
 * item, an Add, a row's Open, the picker's New roadmap…, Place…) opens it through the opener the face provides.
 * A feature dialog's Open its card and Answer on its card close it first, then show the card: through
 * `openCard` where the surface has a tab, else through `useRevealCard`'s `?runner=` landing.
 *
 * `data-roadmap-face` marks the root in viewport fit and `data-roadmap-widget` in column fit;
 * `data-roadmap-header` (the roadmap's name) marks the picker row in viewport fit only.
 *
 * Used by `RoadmapTab`, in viewport fit, as its Roadmap face (so also by `RoadmapWidgetFullscreenBody`, which
 * draws the tab), and by `RoadmapWidgetBody`, in column fit, as the chat gutter's Roadmap widget.
 */
export function RoadmapTreeFace({ fit, openCard, foot }: RoadmapTreeFaceProps) {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  const viewport = fit === 'viewport';
  // The face's own box: the celebrations play only while it is on screen, and the moment's layer covers it.
  const rootRef = useRef<HTMLDivElement>(null);
  // The tree's own sideways scroller: it opens on the current milestone and a milestone moment scrolls it to its ring.
  const paneRef = useRef<HTMLDivElement>(null);
  // The column's scroller (column fit), which can hide a milestone's ring below the fold.
  const columnScrollRef = useRef<HTMLDivElement>(null);
  // The viewport body that holds the tree and the panel (viewport fit), measured for the tree's room.
  const bodyRef = useRef<HTMLDivElement>(null);
  const { moment, skip, active } = useCelebrations(selected, rootRef);
  useMilestoneMomentInView(moment, viewport ? paneRef : columnScrollRef);
  const reveal = useRevealCard();

  const goalText = selected?.goal ?? t('roadmap.goal.missing');
  const layout = useMemo(() => (selected === null ? null : layoutTree(selected, goalText)), [selected, goalText]);
  const hasTree = selected !== null && layout !== null && selected.milestones.length > 0;
  const treeRoom = useTreeRoom(bodyRef, viewport && hasTree);

  // Which dialog is open, for which item, adding or editing: one at a time, as a dialog is modal. `null` for none.
  // Its setter is the face context's `openDialog`, so any press under the face can put one up.
  const [dialog, setDialog] = useState<FaceDialog | null>(null);
  const face = useMemo<RoadmapFace>(() => ({ openDialog: setDialog }), []);

  // The item the operator pressed, kept per roadmap (by name) so a switch to the other roadmap and back returns to
  // the item he pressed there. Not derivable: only his press says it.
  const [pressedBy, setPressedBy] = useState<Record<string, RoadmapTreeSelection>>({});
  const selectedName = selected?.name ?? null;
  const pressed = selectedName === null ? null : pressedBy[selectedName] ?? null;
  // Each render holds the entry against the roadmap on screen: a name the picture no longer holds reads as nothing selected.
  const selection = selected !== null && pressed !== null && holdsItem(selected, pressed) ? pressed : null;
  const select = useCallback((item: RoadmapTreeSelection) => {
    if (selectedName !== null) setPressedBy((held) => ({ ...held, [selectedName]: item }));
  }, [selectedName]);

  // Set by a press on the TREE (a press on a panel row is already at the panel), and spent by the effect below
  // once the panel that press filled is drawn. A ref: the effect reads it after the commit, and nothing is drawn from it.
  const revealPanelRef = useRef(false);
  const selectOnTree = useCallback((item: RoadmapTreeSelection) => {
    revealPanelRef.current = !viewport;
    select(item);
  }, [select, viewport]);
  useEffect(() => {
    if (!revealPanelRef.current) return;
    revealPanelRef.current = false;
    const panel = columnScrollRef.current?.querySelector<HTMLElement>('[data-roadmap-panel]');
    (panel?.querySelector<HTMLElement>('h2') ?? panel)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  /**
   * The picker, in its row. In viewport fit the row names the roadmap on screen for the probes
   * (`data-roadmap-header`); the column draws no such mark, so a page that holds the gutter's widget and the
   * Roadmap tab at once has one header, the tab's.
   */
  const pickerRow = (rowClass: string) => selected !== null && (
    <div data-roadmap-header={viewport ? selected.name : undefined} className={rowClass}>
      <div className="w-64 max-w-full">
        <RoadmapPicker size="sm" />
      </div>
    </div>
  );

  /** A roadmap with no milestone yet draws no tree: it says how to start one. */
  const noPath = selected !== null && (
    <div className={cn('flex items-center justify-center', viewport ? 'flex-1 p-6' : 'p-3')}>
      <div className="w-full max-w-md">
        <EmptyState
          icon={Milestone}
          title={t('roadmap.empty.noPath')}
          actionLabel={t('roadmap.menu.addMilestone')}
          onAction={() => setDialog({ dialog: 'add', kind: 'milestone', parent: selected })}
        />
      </div>
    </div>
  );

  /** The tree, then the panel under it: the same two pieces in both fits, differing in the room the tree is given and the panel's height. */
  const treeAndPanel = hasTree && (
    <>
      <RoadmapTree
        roadmap={selected}
        layout={layout}
        maxHeight={viewport ? treeRoom : null}
        selected={selection}
        onSelect={selectOnTree}
        paneRef={paneRef}
      />
      <TreePanel roadmap={selected} layout={layout} selected={selection} onSelect={select} fit={fit} />
    </>
  );

  const unplacedCount = picture === null ? 0 : picture.unplaced.epics.length + picture.unplaced.features.length;

  return (
    <RoadmapFaceContext.Provider value={face}>
      <CelebrationContext.Provider value={active}>
        <div
          ref={rootRef}
          className="relative flex h-full min-h-0 flex-col"
          data-roadmap-face={viewport || undefined}
          data-roadmap-widget={!viewport || undefined}
        >
          {loading ? (
            <div className="grid flex-1 place-items-center p-6">
              <Spinner size={viewport ? undefined : 32} label={t('roadmap.loading')} />
            </div>
          ) : selected === null ? (
            <div className={cn('flex flex-1 items-center justify-center', viewport ? 'p-6' : 'p-3')}>
              <div className={cn('w-full', viewport && 'max-w-md')}>
                <EmptyState
                  icon={Route}
                  title={t('roadmap.empty.none')}
                  message={t('roadmap.empty.noneMessage')}
                  actionLabel={t('roadmap.picker.new')}
                  onAction={() => setDialog({ dialog: 'add', kind: 'roadmap', parent: null })}
                />
              </div>
            </div>
          ) : viewport ? (
            <>
              {unplacedCount > 0 && picture !== null && (
                // A long list scrolls inside its own strip, so it cannot squeeze the tree's body out of the face.
                <div className="scrollbar-thin max-h-[32vh] shrink-0 overflow-y-auto px-4 pt-3 lg:px-6">
                  <UnplacedBanner
                    unplaced={picture.unplaced}
                    onPlace={(item) => setDialog({ dialog: 'move', kind: item.kind, name: item.name })}
                  />
                </div>
              )}
              {pickerRow('shrink-0 px-4 pt-3 lg:px-6')}
              {hasTree ? (
                <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3 lg:px-6">
                  {treeAndPanel}
                </div>
              ) : noPath}
            </>
          ) : (
            <>
              <div ref={columnScrollRef} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {pickerRow('px-3 pt-3')}
                {hasTree ? <div className="flex min-w-0 flex-col gap-3 p-3">{treeAndPanel}</div> : noPath}
              </div>
              {foot}
            </>
          )}

          {/* A feature dialog's Open its card and Answer close it BEFORE they show the card: in the column the gutter stays mounted behind `hidden` under the tab the landing brings forward, and a dialog is a portal no hidden pane hides. */}
          {dialog !== null && <OpenDialog dialog={dialog} onClose={() => setDialog(null)} onOpenCard={(plan) => { setDialog(null); (openCard ?? reveal)(plan); }} />}
          <CelebrationLayer moment={moment} onSkip={skip} scope={viewport ? 'face' : 'frame'} />
        </div>
      </CelebrationContext.Provider>
    </RoadmapFaceContext.Provider>
  );
}
