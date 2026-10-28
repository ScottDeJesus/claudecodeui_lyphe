import { useEffect, useRef, useState } from 'react';

import { useDrawingUrls } from '@/modules/affected-areas/hooks/useImageUrl';
import { useLayoutPlan } from '@/modules/affected-areas/hooks/useLayoutPlan';
import { useLayoutWalk } from '@/modules/affected-areas/hooks/useLayoutWalk';
import { layoutQueue, layoutUnread } from '@/modules/affected-areas/utils/tourModel';
import type { LayoutReadResult, TourDetail } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasTrouble, DayOneSection } from '@/shared/types';
import { troubleOfFailure, troubleOfResponse } from '@/shared/utils';

/** The press's latest word on one tour: an answer (the dry run's, then each the walk lands) or the lane's fault when the dry run brought none. */
type Press = { answer: LayoutReadResult | null; trouble: AffectedAreasTrouble | null };

/** What the view root lends the day-one hook: whether it is shown, whether the press can be seen right now, and what to do when the plan moves. */
type DayOneAround = {
  /** The view is shown (a switch, not a measurement): the open's dry run and rebuild wait for it, so a hidden view sends nothing. */
  shown: boolean;
  /** Asked before each press of the walk: whether the sketch's press (its meter and Stop) is on screen now, not only the view. */
  isShown: () => boolean;
  /** An answer of the walk moved the plan: the root reads the tour again quietly (and the open pano, whose placements it may have moved). */
  onPlanMoved: () => void;
};

/** The state update that sets what the press holds for one tour. A late answer writes to its own tour's record. */
const pressing = (tourId: string, press: Press) => (all: Record<string, Press>): Record<string, Press> => ({ ...all, [tourId]: press });

/**
 * THE DAY-ONE SKETCH'S DATA for the open tour: everything `DayOneSketch` is handed but the verbs that open a pano.
 * - The plan in force (`useLayoutPlan`): the tour's own, or a newer answer of the open's one rebuild of a stale plan.
 * - The drawings of its floors through the token, as object URLs (`useDrawingUrls`), read again by `onRetryDrawing`.
 * - The press: on open, ONE unarmed layout press for the first pano that needs a read (the dry run, which buys nothing; none
 *   when nothing is left to read), whose answer and budget make the press's line; then the walk (`useLayoutWalk`), whose each
 *   answer replaces the dry run's and whose `layout` replaces the section's status at once; the tour is then read again (as
 *   the reader's walk reads it after each answer), so the drawing, the status and the counts follow the plan the press rebuilt.
 * - What is left to read, counted off the tour's views (`layoutUnread`).
 * The dry run goes when the tour opens and when the view comes back into sight, never on a timer, and an answer of the walk
 * outranks a dry run still out. Nothing here computes a position or a size: the plan is the engine's.
 *
 * Used by the affected-areas module's view root, which hands the result to the tour screen.
 */
export function useDayOne(tourId: string | null, detail: TourDetail | null, around: DayOneAround): DayOneSection {
  const plan = useLayoutPlan(tourId, detail, around.shown);
  // The press's word on each tour opened, by tour: a late answer writes to ITS tour, never over the open one's.
  const [presses, setPresses] = useState<Record<string, Press>>({});
  // How many times Try again asked for the drawings: a drawing that did not arrive is fetched once per key, so it is asked
  // for again only by this moving.
  const [drawingAttempt, setDrawingAttempt] = useState(0);
  // The latest panos, for the dry run, which is sent on the open and not on every reload. A ref: nothing draws from it.
  const panosRef = useRef(detail?.panos ?? []);
  useEffect(() => {
    panosRef.current = detail?.panos ?? [];
  });
  // How many armed answers the walk has landed. A ref: a dry run still out compares it with the count it began under, and
  // is dropped on arrival when the walk has answered since, so its older numbers never land over a newer answer.
  const armedAnswersRef = useRef(0);

  // The dry run's trigger: the open tour once its detail is in and the view is shown. A reload keeps it, so it is not repeated.
  const openTour = detail !== null && around.shown ? tourId : null;
  useEffect(() => {
    if (openTour === null) return undefined;
    const first = layoutQueue(panosRef.current)[0];
    if (first === undefined) return undefined;
    // A tour that closed, or a view that went, must not receive the dry run it left behind.
    let current = true;
    const armedAtStart = armedAnswersRef.current;
    const settle = (press: Press) => {
      if (current && armedAnswersRef.current === armedAtStart) setPresses(pressing(openTour, press));
    };
    void (async () => {
      try {
        const response = await api.affectedAreas.readLayout(openTour, first.panoId, { armed: false, force: false });
        if (!response.ok) {
          settle({ answer: null, trouble: await troubleOfResponse(response) });
          return;
        }
        settle({ answer: (await response.json()) as LayoutReadResult, trouble: null });
      } catch (failure) {
        settle({ answer: null, trouble: troubleOfFailure(failure) });
      }
    })();
    return () => {
      current = false;
    };
  }, [openTour]);

  const reader = useLayoutWalk(tourId, detail?.panos ?? [], {
    isShown: around.isShown,
    onAnswer: (answeredTour, answer) => {
      armedAnswersRef.current += 1;
      setPresses(pressing(answeredTour, { answer, trouble: null }));
      // An answer that bought or served a read rebuilt the plan (`layout` set): the status says so now, and the tour read
      // again brings the plan itself. A refusal or a dry run changed nothing.
      if (answer.layout !== null) {
        plan.adopt(answeredTour, answer.layout);
        around.onPlanMoved();
      }
    },
  });
  const drawings = useDrawingUrls(plan.floors.map((floor) => floor.drawingSha), drawingAttempt);
  const unread = layoutUnread(detail?.panos ?? []);
  const press = tourId === null ? undefined : presses[tourId];

  return {
    floors: plan.floors,
    layout: plan.layout,
    drawings,
    rebuilding: plan.rebuilding,
    lastAnswer: press?.answer ?? null,
    pressTrouble: press?.trouble ?? plan.trouble,
    walk: reader.walk,
    unreadPanos: unread.panos,
    unreadViews: unread.views,
    onRetryDrawing: () => setDrawingAttempt((asked) => asked + 1),
    onReadLayout: reader.start,
    onStopLayout: reader.stop,
  };
}
