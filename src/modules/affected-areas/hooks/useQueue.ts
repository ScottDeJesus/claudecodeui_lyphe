import { useEffect, useRef, useState } from 'react';

import { answerOutranks } from '@/modules/affected-areas/hooks/useMarkedRegions';
import { panoFor } from '@/modules/affected-areas/hooks/usePano';
import { useWhenShown } from '@/modules/affected-areas/hooks/useViewShown';
import type { PanoDetail, Queue, QueueItem, Region } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { MarkWalk } from '@/shared/types';

/** How many areas one read of the queue brings: the engine's default, and few enough that one batch is read in a breath. */
const BATCH_SIZE = 20;

/** The most skipped areas one read sends: the engine's own bound on `skip`. The walk remembers every skip, but only the newest go along. */
const MAX_SKIP_SENT = 50;

/** What a queue has skipped before anything is: one shared object, so a queue with no skips is the same value every render. */
const NONE_SKIPPED: Record<string, true> = {};

/**
 * The queue's read, by `mode|kind|round|skipped` (the kind blank for every kind, the skipped region ids comma-joined, none
 * when blank): module-level so `useLaneRead` sees the same function every render. Neither a mode, a kind nor an id holds a `|`.
 */
const queueFor = (key: string) => {
  const [mode, kind, , skipped] = key.split('|');
  return api.affectedAreas.queue({
    mode: mode === 'random' ? 'random' : 'unsure',
    cls: kind === '' ? undefined : kind,
    limit: BATCH_SIZE,
    skip: skipped === '' ? undefined : skipped.split(','),
  });
};

/** `ids` with `id` as the newest: an area skipped again is the newest skip, not where it first stood. */
const skippedLast = (ids: Record<string, true>, id: string): Record<string, true> => {
  const entries: [string, true][] = Object.keys(ids).filter((known) => known !== id).map((known) => [known, true]);
  return Object.fromEntries([...entries, [id, true]]);
};

/**
 * THE WALK THROUGH ONE QUEUE the engine orders (`GET /queue?mode&class&limit=20&skip`): one area at a time, the batch read
 * again when its last area is passed, and on a mode or kind change. `next(answered)` moves on after a press: a mark
 * hands over its answered region, a Skip hands over null and writes nothing. The queue is the engine's: an area it
 * served stays in it until a mark is written, so a skipped area is still counted in what remains.
 *
 * A skipped area is remembered (by region id, for the mode and kind it was skipped in: the first read of another queue sends
 * none, the walk of another queue starts with none, and a skip made there replaces them) and its newest 50 ride the next batch's read
 * as `skip`, so the engine leaves them out and the batch after a batch of skips brings the next areas, not the same ones.
 * Those skipped in the batch now on screen are passed over locally, and the screen shown again after Tables comes up where it
 * was left. When the engine serves nothing and still counts some, every area left was skipped: the skips are forgotten and
 * the queue is read again from its head, the walk starting over on them. The same is done in the batch in hand when it holds
 * only areas skipped earlier than the newest 50.
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
  // How many batches this mode and kind have spent, and the skipped region ids that went with the read after the last one
  // (the newest 50, of the queue named by `queue`; another queue's are not sent). All of it is the read's key, so a spent
  // batch is read again under a new key, with its skips: the screen shows its waiting surface then, not the area just passed.
  // The skips are fixed when a batch is spent, not as they are pressed: a skip made inside the batch would otherwise read again.
  const [round, setRound] = useState<{ spent: number; queue: string; skip: string[] }>({ spent: 0, queue: '', skip: [] });
  const queueKey = `${mode}|${kind ?? ''}`;
  const sent = round.queue === queueKey ? round.skip : [];
  const read = useLaneRead<Queue>(`${queueKey}|${round.spent}|${sent.join(',')}`, queueFor);
  const batch = read.value;

  // Where the walk stands in the batch it was read for: the place the next area is looked for from. Kept WITH its batch
  // (`of`), so a batch read again starts at its first area without an effect to reset the position.
  const [progress, setProgress] = useState<{ of: Queue | null; at: number }>({ of: null, at: 0 });
  const at = progress.of === batch ? progress.at : 0;
  // The regions judged on this screen, by region id, as the engine answered them. It outlives a batch: the pano read behind
  // the next area, and a batch read that began before a press, may not know the press yet, so each is passed over what
  // this holds.
  const [answers, setAnswers] = useState<Record<string, Region>>({});
  // The areas skipped in this queue, by region id and oldest first, with the queue (mode and kind) they were skipped in. The
  // newest 50 ride the next batch's read as `skip`; the rest, and the ones skipped inside the batch on screen, are passed over
  // here, and the screen shown again after Tables comes up where the operator was. They are kept for the queue they were made
  // in: another mode or kind starts with none, a skip made there replaces them, and coming back before one is made finds them.
  const [skipped, setSkipped] = useState<{ queue: string; ids: Record<string, true> }>({ queue: '', ids: {} });
  const skippedIds = skipped.queue === queueKey ? skipped.ids : NONE_SKIPPED;

  // The area on screen: the first from `at` on that has no answer here and was not skipped. When every area in hand was
  // skipped earlier than the newest 50 (the engine was not told of them), the walk starts over on them: the skips are
  // forgotten rather than the screen saying that nothing is left to mark.
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
  // The engine served nothing and still counts some: it was told of every area left, so the walk has passed them all. The
  // skips are forgotten and the queue is read again from its head, the walk starting over on them.
  // Set while rendering, as React allows for state that follows from what a read brought: the new key sends no skips, so the
  // condition is false on the render that follows and this runs once.
  if (batch !== null && batch.items.length === 0 && batch.remaining > 0 && sent.length > 0) {
    setSkipped({ queue: queueKey, ids: {} });
    setRound((previous) => ({ spent: previous.spent + 1, queue: queueKey, skip: [] }));
  }
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
    let nowSkipped = skippedIds;
    if (item !== null && answered === null) {
      nowSkipped = skippedLast(skippedIds, item.region.regionId);
      setSkipped({ queue: queueKey, ids: nowSkipped });
    }
    if (place + 1 < items.length) setProgress({ of: batch, at: place + 1 });
    else setRound((previous) => ({ spent: previous.spent + 1, queue: queueKey, skip: Object.keys(nowSkipped).slice(-MAX_SKIP_SENT) }));
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
