import { useEffect, useRef, useState } from 'react';

import { useLaneRead } from '@/modules/affected-areas/hooks/useLaneRead';
import { troubleOfFailure, troubleOfResponse } from '@/modules/affected-areas/utils/laneTrouble';
import type { PanoDetail, PanoEntry, ReadResult } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasRead, AffectedAreasTrouble, PanoPress } from '@/shared/types';

/**
 * What the pano's press knows, kept for the pano it was made for (`key`): its `PanoPress` but for `pressing` (which
 * outlives the record: see `inFlight`), and `cut`, the pano as the latest dry run or press answered it (the only copy of
 * a pano never cut, which the lane has no detail for).
 */
type PressRecord = Omit<PanoPress, 'pressing'> & { key: string; cut: PanoDetail | null };

/** The pano's read, by `tourId/panoId`: module-level so `useLaneRead` sees the same function every render. */
const panoFor = (key: string) => {
  const [tourId, panoId] = key.split('/');
  return api.affectedAreas.pano(tourId, panoId);
};

const blankPress = (key: string): PressRecord => ({ key, plan: null, last: null, trouble: null, cut: null });

/** The state update that changes what the press holds for `key`, starting afresh when the record belongs to another pano. */
const patched = (key: string, changes: Partial<PressRecord>) => (previous: PressRecord | null): PressRecord => ({
  ...(previous !== null && previous.key === key ? previous : blankPress(key)),
  ...changes,
});

/**
 * The same update, for an answer that may come after the person went to another pano: a record that belongs to ANOTHER
 * pano is left as it is (it is the pano on screen now, and the answer is not about it); one that is this pano's, or none,
 * takes the change.
 */
const patchedUnlessElsewhere = (key: string, changes: Partial<PressRecord>) => (previous: PressRecord | null): PressRecord | null =>
  previous !== null && previous.key !== key ? previous : patched(key, changes)(previous);

/**
 * A pano the tour lists with no views, drawn as the pano it is: the lane has no detail to give for it (its GET answers
 * 404 until the views are cut), so the screen is handed this, with no views, until the dry run's cut pano replaces it.
 */
const uncutDetail = (tourId: string, listed: PanoEntry): PanoDetail => ({
  tourId, panoId: listed.panoId, roomName: listed.roomName, roomKey: listed.roomKey, floor: listed.floor,
  capturedAt: listed.capturedAt, views: [],
});

/**
 * What a read would buy once an answer has come back, counted off the pano the answer holds: its views that carry
 * no read are the ones left to buy, the others are served. The dry run's own words, so the screen says "all read" the
 * moment a press lands without asking the lane again. Null when the answer holds no pano (the views were refused).
 */
function planAfter(answer: ReadResult): ReadResult | null {
  if (answer.pano === null) return null;
  const unread = answer.pano.views.filter((view) => view.read?.status !== 'read').length;
  return {
    ...answer, status: 'planned', reason: null, viewsToRead: unread, viewsRead: 0,
    viewsCached: answer.pano.views.length - unread, viewsFailed: 0, pano: null,
  };
}

/**
 * The open pano and its read press. The pano is read when it opens (a null pano reads nothing), and beside it the dry
 * run (`readPano` unarmed: it buys nothing) says what a read would cost. A pano the tour lists with no views is NOT
 * read: the lane answers its GET 404 ("no kept views"), which the screen would say as "no longer on its tour". Its dry
 * run is what cuts it, its answer's pano brings the six views, and until then the screen is handed the pano as the
 * tour lists it, with none. A dry run or a press that gets no answer sets `press.trouble`, so "Working out…" never hangs.
 *
 * A pano the tour lists with no views whose cut brought no answer is drawn as a pano that did not answer: no value, and
 * the dry run's trouble as the pano's own, so the screen says it with Try again (which asks the cut again).
 *
 * `pressRead(force)` is the armed press, which spends: one at a time per pano, with the 120 s deadline of
 * `api.affectedAreas`, and still out when the person leaves the pano and comes back (the press shows as busy then, and
 * a second is not offered). Its answer, a refusal included, is `press.last`; the pano it holds replaces the pano on
 * screen and the plan is counted off it at once, unless the person has gone to another pano by then (the answer is then
 * about a pano that is not on screen, and writes nothing of it). It outranks any read of the pano that began before it.
 * `onAnswer` is told each answer, and each cut, so the view root can read the tour again. `reload` reads the pano and
 * the dry run again quietly, for an answer the walk brought to this pano.
 *
 * Used by the affected-areas module's view root.
 */
export function usePano(
  tourId: string | null,
  panoId: string | null,
  listed: PanoEntry | null,
  onAnswer: () => void,
): AffectedAreasRead<PanoDetail> & { press: PanoPress; pressRead: (force: boolean) => void; reload: () => void } {
  const key = tourId !== null && panoId !== null ? `${tourId}/${panoId}` : null;
  // The tour lists the pano with no views: it is known to be uncut, and its GET is known to be a 404.
  const uncut = listed !== null && listed.views.length === 0;
  const read = useLaneRead<PanoDetail>(uncut ? null : key, panoFor);

  // The press, with the pano it was made for, so a pano that changed shows none of the old one's plan or answer at once.
  const [record, setRecord] = useState<PressRecord | null>(null);
  // The armed presses that are out, by pano. Apart from `record`, which belongs to the pano on screen: a press is out for
  // seconds, a person can leave its pano and come back, and the record is gone by then, so a press kept only there would
  // be forgotten and offered again (a second "Read again" buys twice).
  const [inFlight, setInFlight] = useState<Record<string, 'read' | 'again'>>({});
  // How many times Try again, or a reload, asked for the dry run; the effect asks the lane when it moves.
  const [dryRuns, setDryRuns] = useState(0);
  const mine = record !== null && record.key === key ? record : blankPress(key ?? '');

  // The pano open now, the root's latest `onAnswer` and whether the tour lists the pano uncut: all read by an answer that
  // comes back after the render that asked, which must judge by what is true when it lands. Refs: nothing draws from them.
  const openKeyRef = useRef(key);
  const answerRef = useRef(onAnswer);
  const uncutRef = useRef(uncut);
  useEffect(() => {
    openKeyRef.current = key;
    answerRef.current = onAnswer;
    uncutRef.current = uncut;
  });

  useEffect(() => {
    if (key === null || tourId === null || panoId === null) return undefined;
    // A pano that changed, or a view that went, must not receive the dry run it left behind.
    let current = true;
    const fail = (trouble: AffectedAreasTrouble) => {
      if (current) setRecord(patched(key, { trouble }));
    };
    void (async () => {
      try {
        const response = await api.affectedAreas.readPano(tourId, panoId, { armed: false, force: false });
        if (!current) return;
        if (!response.ok) {
          fail(await troubleOfResponse(response));
          return;
        }
        const plan = (await response.json()) as ReadResult;
        if (!current) return;
        setRecord(patched(key, { plan, cut: plan.pano, trouble: null }));
        // The dry run cut a pano the tour lists with no views: the listing is behind, and so is its gallery tile.
        if (uncutRef.current && plan.pano !== null && plan.pano.views.length > 0) answerRef.current();
      } catch (failure) {
        fail(troubleOfFailure(failure));
      }
    })();
    return () => {
      current = false;
    };
  }, [key, tourId, panoId, dryRuns]);

  const pressRead = (force: boolean) => {
    if (key === null || tourId === null || panoId === null || inFlight[key] !== undefined) return;
    setInFlight((out) => ({ ...out, [key]: force ? 'again' : 'read' }));
    setRecord(patched(key, { trouble: null }));
    void (async () => {
      try {
        const response = await api.affectedAreas.readPano(tourId, panoId, { armed: true, force });
        if (!response.ok) {
          setRecord(patchedUnlessElsewhere(key, { trouble: await troubleOfResponse(response) }));
          return;
        }
        const answer = (await response.json()) as ReadResult;
        const plan = planAfter(answer);
        // The pano as it stands after the read goes on screen at once, under the key the press was made for (the render
        // that made it may have held no key yet: the tour had not listed the pano as cut). Only if this pano is still the
        // one open: the pano on screen now has its own value, which this answer would overwrite.
        if (answer.pano !== null && openKeyRef.current === key) read.replace(answer.pano, key);
        setRecord(patchedUnlessElsewhere(key, {
          last: answer, trouble: null, ...(plan === null ? {} : { plan }), ...(answer.pano === null ? {} : { cut: answer.pano }),
        }));
        answerRef.current();
      } catch (failure) {
        setRecord(patchedUnlessElsewhere(key, { trouble: troubleOfFailure(failure) }));
      } finally {
        setInFlight((out) => Object.fromEntries(Object.entries(out).filter(([outKey]) => outKey !== key)));
      }
    })();
  };

  // A pano the tour lists with no views whose cut brought no answer: nothing to draw but the header and the trouble.
  const cutFailed = uncut && mine.cut === null && mine.trouble !== null;
  // The lane's pano once it has one; else the pano as the dry run or a press answered it; else, for a pano the tour lists
  // with no views, that pano with none, so the screen draws what a never-cut pano is rather than a read in flight.
  const value = cutFailed
    ? null
    : read.value ?? mine.cut ?? (uncut && listed !== null && tourId !== null ? uncutDetail(tourId, listed) : null);
  return {
    value,
    trouble: read.trouble ?? (cutFailed ? mine.trouble : null),
    retry: () => {
      read.retry();
      if (key !== null) setRecord(patched(key, { trouble: null }));
      setDryRuns((asked) => asked + 1);
    },
    reload: () => {
      read.reload();
      setDryRuns((asked) => asked + 1);
    },
    press: { plan: mine.plan, pressing: key === null ? null : inFlight[key] ?? null, last: mine.last, trouble: mine.trouble },
    pressRead,
  };
}
