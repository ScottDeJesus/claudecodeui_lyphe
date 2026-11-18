import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { StackOf } from '@/modules/roadmap/stack/StackOf';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { RoadmapStackRest } from '@/shared/types';
import { Button } from '@/shared/ui';
import { OWNS_ESCAPE, modalInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

type RoadmapCircleProps = {
  /** Where the circle rests, in the pixels of the box this is laid over: its middle and its radius. The page keeps that place clear for it. */
  rest: RoadmapStackRest;
  /**
   * How many times the reader has come back to this page from one where the stack stood: each time the count goes up, the circle is shown
   * standing for an instant and lies down into its place, so the one drawing is seen to come back. Absent, or zero: it is simply there.
   */
  returns?: number;
};

/**
 * THE ROADMAP ON A PAGE THAT IS NOT THE ROADMAP'S: one small circle that takes little room until it is pressed. The circle is the roadmap on screen
 * (`useRoadmap`'s selected one) seen from above, an arc for each feature the ring holds: what is finished and not yet dismissed (in the positive colour
 * until he has opened it), what is being built, and what is ready to be started. One press, or one tap, stands it up as the ring over
 * the page (`StackOf`), in the same drawing; the back arrow where the circle was, or Escape, lays it down again.
 *
 * IT LIES OVER ITS OWNER'S WHOLE BOX (`absolute inset-0`, so the owner is a positioned box) and takes no press but the circle's while it is small: the
 * page under it stays in reach. Standing, it covers the page with the page's own ground and states that it owns Escape (`OWNS_ESCAPE`, present only while
 * it stands). Its own Escape stands down for whatever is open in front of it: a feature's card, one of the roadmap's dialogs.
 *
 * Nothing is drawn while there is nothing to draw: the picture still on its way, no roadmap, a roadmap with no milestone yet.
 *
 * The roadmap's dialogs (a feature's questions) open over the page through `RoadmapDialogHost`.
 *
 * Exported through the roadmap barrel for project-workspace's sessions home (`WorkspaceHome`), at its head's start side.
 */
export function RoadmapCircle({ rest, returns }: RoadmapCircleProps) {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  const hostWindow = useHostWindow();
  const isPageHeld = useIsPageHeld();
  const reveal = useRevealCard();
  const rootRef = useRef<HTMLDivElement>(null);
  // Whether the stack stands over the page. His press alone says so: nothing in the picture stands it up or lays it down.
  const [standing, setStanding] = useState(false);
  const layDown = useCallback(() => setStanding(false), []);

  const drawable = picture !== null && selected !== null && selected.milestones.length > 0;
  // A roadmap that leaves while its stack stands leaves nothing standing.
  if (!drawable && standing) setStanding(false);

  // Escape lays it down, unless something in front of it owns the key (the open card, a dialog) or its page is held under another.
  useEffect(() => {
    if (!standing) return undefined;
    const hostDocument = hostWindow.document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isPageHeld()) return;
      event.preventDefault();
      if (modalInFrontHoldsEscape(rootRef.current, hostDocument)) return;
      event.stopPropagation();
      layDown();
    };
    hostWindow.addEventListener('keydown', onKeyDown, true);
    return () => hostWindow.removeEventListener('keydown', onKeyDown, true);
  }, [standing, hostWindow, isPageHeld, layDown]);

  if (!drawable || selected === null) return null;
  return (
    <div
      ref={rootRef}
      data-roadmap-circle={standing ? 'standing' : 'small'}
      {...(standing ? OWNS_ESCAPE : {})}
      className={cn('absolute inset-0', standing ? 'z-20' : 'pointer-events-none')}
    >
      <RoadmapDialogHost onOpenCard={reveal}>
        {() => (
          // Keyed by the roadmap: another roadmap is another stack, arriving on its own current milestone.
          <StackOf
            key={selected.name}
            roadmap={selected}
            rest={rest}
            standing={standing}
            onStand={() => setStanding(true)}
            returns={returns}
            restLabel={t('roadmap.stack.open', { title: selected.title })}
          />
        )}
      </RoadmapDialogHost>
      {standing && (
        <Button
          data-roadmap-circle-back
          variant="outline"
          size="icon"
          className="absolute size-11 bg-background"
          // Where the circle was: the way back is where the way in stood.
          style={{ left: rest.cx - 22, top: rest.cy - 22 }}
          aria-label={t('roadmap.stack.back')}
          title={t('roadmap.stack.back')}
          onClick={layDown}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
