import { useEffect, useRef, useState } from 'react';

import { troubleOfFailure, troubleOfResponse } from '@/modules/affected-areas/utils/laneTrouble';
import { FACES, needsRead } from '@/modules/affected-areas/utils/tourModel';
import type { PanoEntry, ReadResult } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { TourReaderProgress } from '@/shared/types';

/** The walk of one tour as the screens draw it, with the tour it belongs to. */
type WalkRecord = { tourId: string; progress: TourReaderProgress };

/** One walk in hand: the tour it reads, and whether it was asked to end (Stop, the tour closing, the view hiding). */
type Run = { tourId: string; stopped: boolean };

const IDLE: TourReaderProgress = { running: false, index: 0, total: 0, lastRefusal: null, skipped: 0 };

/**
 * Refusals that belong to the one pano pressed, not to the run: the next pano may be read, so the walk goes past them
 * (counting them) where it stops at the others. The engine's own walker draws the same line (`_STOPS` in
 * `core/affected_areas/read.py` holds only what every later pano would meet too: budget, a switch, a dead key).
 */
const PER_PANO_REFUSALS = ['views_refused'];

/** What the walk needs of the view root: whether the view can be seen, and a word after each answer. */
type WalkAround = {
  /** Asked before each press: a hidden view sends no more, so nothing is spent where no one can see the meter or press Stop. */
  isShown: () => boolean;
  /** Told after each answer, with the pano it concerned: the progress is the answer, so the root reads the tour again. */
  onAnswer: (panoId: string) => void;
};

/**
 * The panos with a view that needs a read (`needsRead`: none yet, or one made under an older contract or model), in the
 * order they were captured: a pano never cut has none read, so it is one. Panos with no capture time come last; panos
 * captured together keep the tour's own order.
 */
function unreadInCaptureOrder(panos: PanoEntry[]): PanoEntry[] {
  const unread = panos.filter((pano) => pano.views.filter((view) => !needsRead(view)).length < FACES.length);
  return unread
    .map((pano, position) => ({ pano, position }))
    .sort((a, b) => {
      if (a.pano.capturedAt !== b.pano.capturedAt) {
        if (a.pano.capturedAt === null) return 1;
        if (b.pano.capturedAt === null) return -1;
        return a.pano.capturedAt < b.pano.capturedAt ? -1 : 1;
      }
      return a.position - b.position;
    })
    .map(({ pano }) => pano);
}

/**
 * Presses one pano's armed read and says why it was refused: the engine's reason code, or the lane's trouble when no
 * answer came, or null when the pano was read, served or part read (a part read goes on to the next pano; a wall the
 * next one would meet too is refused there, and ends the walk there).
 */
async function pressOnePano(tourId: string, panoId: string): Promise<string | null> {
  try {
    const response = await api.affectedAreas.readPano(tourId, panoId, { armed: true, force: false });
    if (!response.ok) return await troubleOfResponse(response);
    const answer = (await response.json()) as ReadResult;
    return answer.status === 'refused' ? answer.reason ?? 'failed' : null;
  } catch (failure) {
    return troubleOfFailure(failure);
  }
}

/**
 * READ THE REST OF A TOUR: the unread panos walked one armed press at a time, in capture order. Each answer is the
 * progress (`index` of `total`, 1-based, the pano in hand); nothing polls, and no press goes out until the last one
 * answered. The walk stops at a refusal, whose reason is `lastRefusal` and whose pano is `index`, except a refusal of
 * that pano alone (`PER_PANO_REFUSALS`: its photo cannot be cut), which it passes and counts in `skipped`; at `stop`,
 * after the pano in hand; when the tour closes; and when the view is hidden, again after the pano in hand. A browser
 * closed mid-walk leaves the rest unread, and `start` again reads what is left (a pano passed over is among them).
 *
 * Used by the affected-areas module's view root, which draws `walk` on the tour screen and the pano screen.
 */
export function useTourReader(
  tourId: string | null,
  panos: PanoEntry[],
  around: WalkAround,
): { walk: TourReaderProgress; start: () => void; stop: () => void } {
  // The walk's progress with the tour it belongs to, so a tour that changed shows none of the old one's meter or
  // refusal, and an old walk finishing late cannot draw over the new tour's.
  const [record, setRecord] = useState<WalkRecord | null>(null);
  // The walk in hand, if any. A ref: the loop reads it between answers, and nothing draws from it.
  const runRef = useRef<Run | null>(null);
  // The root's latest words for the loop, which outlives the render that started it.
  const aroundRef = useRef(around);
  useEffect(() => {
    aroundRef.current = around;
  });

  // A tour that closes (or a view that goes) ends its walk after the pano in hand.
  useEffect(() => () => {
    if (runRef.current !== null) runRef.current.stopped = true;
  }, [tourId]);

  const start = () => {
    if (tourId === null || (runRef.current !== null && !runRef.current.stopped)) return;
    const queue = unreadInCaptureOrder(panos);
    if (queue.length === 0) return;
    const run: Run = { tourId, stopped: false };
    runRef.current = run;
    const report = (progress: TourReaderProgress) => {
      if (runRef.current === run) setRecord({ tourId, progress });
    };

    void (async () => {
      let index = 0;
      let skipped = 0;
      let refusal: string | null = null;
      for (const pano of queue) {
        if (run.stopped || !aroundRef.current.isShown()) break;
        index += 1;
        report({ running: true, index, total: queue.length, lastRefusal: null, skipped });
        refusal = await pressOnePano(tourId, pano.panoId);
        aroundRef.current.onAnswer(pano.panoId);
        if (refusal !== null && PER_PANO_REFUSALS.includes(refusal)) {
          skipped += 1;
          refusal = null;
        } else if (refusal !== null) {
          break;
        }
      }
      report({ running: false, index, total: queue.length, lastRefusal: refusal, skipped });
      if (runRef.current === run) runRef.current = null;
    })();
  };

  const stop = () => {
    if (runRef.current !== null) runRef.current.stopped = true;
  };

  return { walk: record !== null && record.tourId === tourId ? record.progress : IDLE, start, stop };
}
