import { Milestone, Route } from 'lucide-react';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { RoadmapPicker } from '@/modules/roadmap/RoadmapPicker';
import { StackOf } from '@/modules/roadmap/stack/StackOf';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import { EmptyState, Spinner } from '@/shared/ui';

type RoadmapStackFaceProps = {
  /** Shows a feature's live card on the In flight face, for a roadmap dialog's Open its card; `null` where the surface has no tab to turn (the landing is then `?runner=<plan>`). */
  openCard: ((plan: string) => void) | null;
};

/** The face under its dialog host: the states that come before a stack, the picker, then the stack of the roadmap on screen. */
function StackFaceBody() {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  const { openDialog } = useContext(RoadmapFaceContext);
  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  if (loading) {
    return <div className="grid flex-1 place-items-center p-6"><Spinner label={t('roadmap.loading')} /></div>;
  }
  if (selected === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyState
            icon={Route}
            title={t('roadmap.empty.none')}
            message={t('roadmap.empty.noneMessage')}
            actionLabel={t('roadmap.picker.new')}
            onAction={() => openDialog({ dialog: 'add', kind: 'roadmap', parent: null })}
          />
        </div>
      </div>
    );
  }
  return (
    <>
      <div data-roadmap-header={selected.name} className="shrink-0 px-4 pt-3 lg:px-6">
        <div className="w-64 max-w-full"><RoadmapPicker size="sm" /></div>
      </div>
      {selected.milestones.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            <EmptyState
              icon={Milestone}
              title={t('roadmap.empty.noPath')}
              actionLabel={t('roadmap.menu.addMilestone')}
              onAction={() => openDialog({ dialog: 'add', kind: 'milestone', parent: selected })}
            />
          </div>
        </div>
      ) : (
        // Keyed by the roadmap: another roadmap is another stack, arriving on its own current milestone with no card open.
        <div className="min-h-0 flex-1"><StackOf key={selected.name} roadmap={selected} /></div>
      )}
    </>
  );
}

/**
 * THE ROADMAP AS A STACK, as a face of the Roadmap tab: the picker, then the roadmap on screen as rings (`StackOf`),
 * one per milestone, the current one standing open with a wall for every feature. One object is the way round the
 * roadmap, the measure of how far along it is, and the gauge of what asks for the operator; it is quiet until pressed,
 * and what a press opens is that feature's own card, in place (`StackCard`).
 *
 * It keeps the states every roadmap surface has before there is something to draw (the picture still on its way, no
 * roadmap at all, a roadmap with no milestone yet), with the same words and the same presses as the tree's face.
 *
 * WHAT SHIPPED WHILE HE WAS AWAY STANDS OVER THE REST, in the positive colour, until he opens it: measured against the
 * roadmap's seen stamp as it stood when the visit began (`utils/seenStamp`, the one the celebrations move), and the
 * stamp moves on once every such feature has been opened.
 *
 * The roadmap's own dialogs open over it through `RoadmapDialogHost`: an epic's menu and its Add a feature, and the
 * empty states' New roadmap and Add a milestone. A feature dialog's Open its card goes to `openCard`, the tab's turn to
 * In flight, or to the `?runner=` landing where there is no tab.
 *
 * `data-roadmap-stack-face` marks its root; `data-roadmap-header` (the roadmap's name) its picker row.
 *
 * Used by `RoadmapTab`, as its Stack face.
 */
export function RoadmapStackFace({ openCard }: RoadmapStackFaceProps) {
  const reveal = useRevealCard();
  return (
    <div data-roadmap-stack-face className="relative flex h-full min-h-0 flex-col">
      <RoadmapDialogHost onOpenCard={openCard ?? reveal}>
        {() => <StackFaceBody />}
      </RoadmapDialogHost>
    </div>
  );
}
