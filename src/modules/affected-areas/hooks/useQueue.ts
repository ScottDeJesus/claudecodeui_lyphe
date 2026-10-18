import { useEffect, useRef, useState } from 'react';

import { useLaneRead } from '@/modules/affected-areas/hooks/useLaneRead';
import { answerOutranks } from '@/modules/affected-areas/hooks/useMarkedRegions';
import { panoFor } from '@/modules/affected-areas/hooks/usePano';
import { useWhenShown } from '@/modules/affected-areas/hooks/useViewShown';
import type { PanoDetail, Queue, QueueItem, Region } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { MarkWalk } from '@/shared/types';

/** How many areas one read of the queue brings: the engine's default, and few enough that one batch is read in a breath. */
const BATCH_SIZE = 20;

/** What a queue has skipped before anything is: one shared object, so a queue with no skips is the same value every render. */
const NONE_SKIPPED: Record<string, true> = {};

/** The queue's read, by `mode|kind|round` (the kind blank for every kind): module-level so `useLaneRead` sees the same function every render. */
const queueFor = (key: string) => {
  const [mode, kind] = key.split('|');
  return api.affectedAreas.queue({ mode: mode === 'random' ? 'random' : 'unsure', cls: kind === '' ? undefined : kind, limit: BATCH_SIZE });
};

/**
 * THE WALK THROUGH ONE QUEUE the engine orders (`GET /queue?mode&class&limit=20`): one area at a time, the batch read
 * again when its last area is passed, and on a mode or kind change. `next(answered)` moves on after a press: a mark
 * hands over its answered region, a Skip hands over null and writes nothing. The queue is the engine's: an area it
 * served stays in it until a mark is written, so a skipped area comes back in the next batch.
 *
 * A skipped area is remembered (by region id, until the mode or kind changes) and passed over when the next batch lands, so
 * the screen shown again after Tables comes up where it was left; when every area in hand was skipped the walk starts over
 * on them, since the engine has no other to give. The engine serves a skipped area first of all and has no way to start the
 * queue past it (`limit` is at most 50), so skipping past a whole batch is not possible yet.
 *
 * `left` is what the engine said remained when the batch was read, less the areas of that batch judged here (a skip leaves
 * the area in the queue, so it does not count). A batch read that began before a mark and lands after it still carries the
 * marked area: it is passed over and counted off, never offered again. A mark answered after the operator has moved on
 * (a skip made while it was out) leaves the screen where it is. The area's neighbours — every region of its view, so the
 * others draw dimmed around it — come from its pano, read when the area comes up (a queue item carries its own region and
 * none of its neighbours); a neighbour judged on this screen is drawn as the engine answered it unless the pano read is newer.
 *
 * `shown` is whether the Mark screen is on view. It reads nothing while hidden, and when it turns true again the batch
 * and the area's pano are read again, quietly (the screen stays as it is until the answer lands): an area judged on
 * the pano screen leaves the queue, and the Tables' lines move the order. That is a person's press, never a timer.
 *
 * Used by the affected-areas module's `MarkScreen`.
 */
export function useQueue(mode: Queue['mode'], kind: string | undefined, shown: boolean): MarkWalk {
  // How many batches this mode and kind have spent. It is part of the read's key so that a spent batch is read again
  // under a new key: the screen shows its waiting surface then, not the area just passed.
  const [round, setRound] = useState(0);
  const read = useLaneRead<Queue>(`${mode}|${kind ?? ''}|${round}`, queueFor);
  const batch = read.value;

  // Where the walk stands in the batch it was read for: the place the next area is looked for from. Kept WITH its batch
  // (`of`), so a batch read again starts at its first area without an effect to reset the position.
  const [progress, setProgress] = useState<{ of: Queue | null; at: number }>({ of: null, at: 0 });
  const at = progress.of === batch ? progress.at : 0;
  // The regions judged on this screen, by region id, as the engine answered them. It outlives a batch: the pano read behind
  // the next area, and a batch read that began before a press, may not know the press yet, so each is passed over what
  // this holds.
  const [answers, setAnswers] = useState<Record<string, Region>>({});
  // The areas skipped in this queue, by region id, with the queue (mode and kind) they were skipped in. The engine serves a
  // skipped area again, first of all; this lets the next batch (and the screen shown again after Tables) pass over them and
  // come up where the operator was. A different mode or kind is a new walk and starts with none.
  const queueKey = `${mode}|${kind ?? ''}`;
  const [skipped, setSkipped] = useState<{ queue: string; ids: Record<string, true> }>({ queue: '', ids: {} });
  const skippedIds = skipped.queue === queueKey ? skipped.ids : NONE_SKIPPED;

  // The area on screen: the first from `at` on that has no answer here and was not skipped. When every area left was skipped
  // the engine has nothing else to give, and the walk starts over on them: the skips are forgotten rather than the screen
  // saying that nothing is left to mark.
  const items = batch?.items ?? [];
  const passedOver = (served: QueueItem, forgetSkips: boolean): boolean =>
    answers[served.region.regionId] !== undefined || (!forgetSkips && skippedIds[served.region.regionId] !== undefined);
  let place = at;
  while (place < items.length && passedOver(items[place], false)) place += 1;
  if (place >= items.length && items.slice(at).some((served) => skippedIds[served.region.regionId] !== undefined)) {
    place = at;
    while (place < items.length && passedOver(items[place], true)) place += 1;
  }
  const item = items[place] ?? null;
  // Which area is on screen, for an answer that lands later (a ref: nothing draws from it, and it is written after each render).
  const onScreenRef = useRef<string | null>(null);
  useEffect(() => {
    onScreenRef.current = item?.region.regionId ?? null;
  });
  const panoRead = useLaneRead<PanoDetail>(item === null ? null : `${item.tourId}/${item.panoId}`, panoFor);
  const neighbours = item === null ? [] : panoRead.value?.views.find((view) => view.sha256 === item.view.sha256)?.regions ?? [];

  useWhenShown(shown, () => {
    read.reload();
    panoRead.reload();
  });

  const next = (answered: Region | null) => {
    if (batch === null) return;
    if (answered !== null) {
      setAnswers((previous) => ({ ...previous, [answered.regionId]: answered }));
      // The mark of an area the operator has since skipped past is kept and counted, and the screen stays where it is.
      if (onScreenRef.current !== answered.regionId) return;
    }
    if (item !== null && answered === null) {
      const skippedId = item.region.regionId;
      setSkipped((previous) => ({ queue: queueKey, ids: { ...(previous.queue === queueKey ? previous.ids : {}), [skippedId]: true } }));
    }
    if (place + 1 < items.length) setProgress({ of: batch, at: place + 1 });
    else setRound((spent) => spent + 1);
  };

  return {
    item,
    regions: neighbours.map((region) => {
      const answer = answers[region.regionId];
      return answer !== undefined && answerOutranks(answer, region) ? answer : region;
    }),
    left: batch === null ? null : Math.max(0, batch.remaining - items.filter((served) => answers[served.region.regionId] !== undefined).length),
    trouble: read.trouble,
    next,
    retry: read.retry,
  };
}
