import { useEffect, useRef, useState } from 'react';

import { layoutQueue } from '@/modules/affected-areas/utils/tourModel';
import type { LayoutReadResult, PanoEntry } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasTrouble, TourReaderProgress } from '@/shared/types';
import { troubleOfFailure, troubleOfResponse } from '@/shared/utils';

/** The walk of one tour as the section draws it, with the tour it belongs to. */
type WalkRecord = { tourId: string; progress: TourReaderProgress };

/** One walk in hand: the tour it reads, and whether it was asked to end (Stop, the tour closing, the view hiding). */
type Run = { tourId: string; stopped: boolean };

const IDLE: TourReaderProgress = { running: false, index: 0, total: 0, lastRefusal: null, skipped: 0 };

/**
 * Refusals that belong to the one pano pressed, not to the run: its views could not be cut, and the next pano's may be, so
 * the walk goes past it (counting it). The engine's own layout run draws the same line (`_STOPS` in
 * `core/affected_areas/layout/run.py` holds only what every later pano would meet too: budget, a switch, a dead key).
 */
const PER_PANO_REFUSALS = ['views_refused'];

/**
 * Panos in a row that bought nothing and failed (`viewsFailed` with no `viewsRead`: every view timed out, or came back paid and
 * failed the contract gate, which keeps nothing), after which the walk gives up on the door: the engine's own `_DEAD_PANOS`
 * (`core/affected_areas/layout/run.py`). Such a pano is `partial`, not `refused`, so the refusal rule alone would press on
 * through every pano of the tour, paying for each.
 */
const DEAD_PANOS = 2;

/** The reason a walk ends with when the door has failed `DEAD_PANOS` panos running: the walk's own word, which `DayOnePress` words. */
const FAILING = 'failing';

/** What one press came to: the engine's answer (a refusal included), or the lane's fault when no answer came. */
type Pressed = { answer: LayoutReadResult } | { trouble: AffectedAreasTrouble };

/** What the walk needs of the day-one hook: whether the press can be seen, and a word after each answer. */
type LayoutWalkAround = {
  /** Asked before each press: a press out of sight sends no more, so nothing is spent where no one can see the meter or press Stop. */
  isShown: () => boolean;
  /** Told after each answer the engine gave, with the tour it concerned: its `layout` replaces the section's status. */
  onAnswer: (tourId: string, answer: LayoutReadResult) => void;
};

/** One armed press of a pano's room layout, said as the lane answered it. */
async function pressOnce(tourId: string, panoId: string): Promise<Pressed> {
  try {
    const response = await api.affectedAreas.readLayout(tourId, panoId, { armed: true, force: false });
    if (!response.ok) return { trouble: await troubleOfResponse(response) };
    return { answer: (await response.json()) as LayoutReadResult };
  } catch (failure) {
    return { trouble: troubleOfFailure(failure) };
  }
}

/**
 * One pano's press, pressed AGAIN once when no answer arrived in time (`unreachable`: the lane's 270 s, or no connection).
 * why: the engine shields its calls and records each read, so by the second press its run has finished or still holds the
 * tour's lock, and the second press finds the reads cached — it buys nothing twice. Any other fault is final: a retry
 * would meet it again.
 */
async function pressOnePano(tourId: string, panoId: string): Promise<Pressed> {
  const first = await pressOnce(tourId, panoId);
  if ('answer' in first || first.trouble !== 'unreachable') return first;
  return pressOnce(tourId, panoId);
}

/**
 * READ THE ROOM LAYOUT OF A TOUR: the panos with a view whose layout read is missing or not current, walked one armed press
 * at a time, in capture order. Each answer is the progress (`index` of `total`, 1-based, the pano in hand) and is handed to
 * `onAnswer`; nothing polls, and no press goes out until the last one answered. The walk stops at a refusal, whose reason is
 * `lastRefusal` and whose pano is `index`, except a refusal of that pano alone (`PER_PANO_REFUSALS`), which it passes and
 * counts in `skipped`; after `DEAD_PANOS` panos in a row whose every view failed (`lastRefusal` is then `failing`); at `stop`,
 * after the pano in hand; when the tour closes; and when the press is out of sight (the view hidden, another surface, a pano
 * open: its meter and Stop are nowhere else), again after the pano in hand.
 *
 * It is `useTourReader`'s walk over the layout press: the same shape and the same progress, so the section draws it as the
 * tour screen draws Read the rest. A browser closed mid-walk leaves the rest unread, and `start` again reads what is left.
 *
 * Used by the affected-areas module's `useDayOne`, which draws `walk` in the day-one sketch's press.
 */
export function useLayoutWalk(
  tourId: string | null,
  panos: PanoEntry[],
  around: LayoutWalkAround,
): { walk: TourReaderProgress; start: () => void; stop: () => void } {
  // The walk's progress with the tour it belongs to, so a tour that changed shows none of the old one's meter or refusal,
  // and an old walk finishing late cannot draw over the new tour's.
  const [record, setRecord] = useState<WalkRecord | null>(null);
  // The walk in hand, if any. A ref: the loop reads it between answers, and nothing draws from it.
  const runRef = useRef<Run | null>(null);
  // The latest words of the hook's owner for the loop, which outlives the render that started it.
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
    const queue = layoutQueue(panos);
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
      // Panos in a row that bought nothing and failed: the door may be dead, and each press of it is paid for.
      let dead = 0;
      for (const pano of queue) {
        if (run.stopped || !aroundRef.current.isShown()) break;
        index += 1;
        report({ running: true, index, total: queue.length, lastRefusal: null, skipped });
        const pressed = await pressOnePano(tourId, pano.panoId);
        if ('answer' in pressed) {
          aroundRef.current.onAnswer(tourId, pressed.answer);
          refusal = pressed.answer.status === 'refused' ? pressed.answer.reason ?? 'failed' : null;
          dead = pressed.answer.viewsFailed > 0 && pressed.answer.viewsRead === 0 ? dead + 1 : 0;
        } else {
          refusal = pressed.trouble;
        }
        if (refusal !== null && PER_PANO_REFUSALS.includes(refusal)) {
          skipped += 1;
          refusal = null;
        } else if (refusal !== null) {
          break;
        } else if (dead >= DEAD_PANOS) {
          refusal = FAILING;
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
