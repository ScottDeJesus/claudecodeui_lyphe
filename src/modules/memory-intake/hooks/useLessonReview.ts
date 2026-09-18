import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, errorMessage, readApiJson, LESSON_LIST_LIMIT } from '@/shared/api';
import type { KanbanLesson, KanbanLessonLean } from '@/shared/kanban-types';

/**
 * THE LESSONS REVIEW LIFECYCLE: the staged list, the one lesson opened whole, and the two reviews.
 *
 * THE SHAPE IS `useMemoryReview`'s, one section over, because the two surfaces are one habit — a
 * person reads what a build proposed and either files it or throws it away. What that hook holds
 * for a MEMORY this one holds for a LESSON: the list a read produced, the row whose write is in
 * flight, and this tab's freshest refusal per id.
 *
 * IT POLLS NOTHING. The Memory tab's own provider is the only timer on this surface
 * (`context/MemoryIntakeContext.tsx`, a minute), and a second one here would double the tab's
 * traffic to learn nothing a person is waiting for: nothing stages a lesson while the list is
 * open, and the reviews happen in this panel. So it reads ON MOUNT and after every write, and
 * that is the whole of its clock.
 *
 * A REFUSED REVIEW IS NOT A FAILURE. The server answers 422 in its own words, naming the state the
 * lesson is actually in — decided in another tab a moment ago, or by this one twice — and that
 * sentence is what the row wears while the row STAYS. A lesson that vanished after a refused press
 * would say it had been reviewed, and it had not.
 */

/** `null` before the first read lands, `'unread'` when it could not be made, else the staged
 *  lessons in the server's own order. Never `[]` for "not asked yet". */
export type StagedLessons = KanbanLessonLean[] | 'unread' | null;

/** The one opened lesson's by-id read. `gone` is a lesson reviewed elsewhere since the list was
 *  read — no longer `staged`, or no longer a row at all. */
export type LessonBody =
  | { state: 'reading' }
  | { state: 'unread' }
  | { state: 'gone' }
  | { state: 'read'; lesson: KanbanLesson };

/** What this surface hands the list that draws it. */
export type LessonReview = {
  lessons: StagedLessons;
  /** The read came back AT THE ROUTE'S CEILING, so what is on screen is the first slice of the
   *  staged lessons and not the whole of them. The index answers with rows and no total, so this is
   *  the most the client can know — and it is the difference between a heading that says "12
   *  staged" and one that says "at least 500", which the section draws in words rather than in a
   *  number it cannot stand behind. */
  capped: boolean;
  /** One by-id read per lesson OPENED, held by id once it lands: the list is lean by contract, and
   *  a lesson nobody has opened has no entry here at all. */
  bodies: Record<string, LessonBody>;
  /** Raised by a row on its OPEN transition — the moment its body is wanted. Closing raises
   *  nothing, and a lesson already read is not read again. */
  onOpen: (lessonId: string) => void;
  /** The lesson whose write is in flight, so its two buttons can refuse a second press. */
  busyId: string | null;
  /** This tab's freshest refusal per lesson id, in the server's own words. */
  refusals: Record<string, string>;
  /** Approve or reject one staged lesson. Answers once the list has been read again. */
  review: (lessonId: string, approve: boolean) => Promise<void>;
};

/**
 * What to say when a review did not land.
 *
 * The server's own sentence is preferred whenever it sent one: a 422 names the state the lesson is
 * actually in, which is the whole of what the person needs in order to understand the row in front
 * of them. Only when no verdict came back — a status with a body this app could not read, or no
 * answer at all — does this supply the words.
 */
function refusalWords(status: number, body: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const said = errorMessage((body as { error?: unknown } | null)?.error);
  if (said) return said;
  if (status === 422) {
    return t('memory.lessons.notStaged', { defaultValue: 'This lesson is no longer staged — it was decided somewhere else.' });
  }
  return t('memory.lessons.unreviewed', { defaultValue: 'The lesson was not reviewed — the board did not answer.' });
}

/** A write's verdict is the server's own body, so it is read before the status is judged — and a
 *  body that is not JSON must not throw over the status. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function useLessonReview(): LessonReview {
  const { t } = useTranslation();

  // Nothing asked yet. A spinner on screen, and never "nothing is staged" — the two are different
  // news and the list draws them with different words.
  const [lessons, setLessons] = useState<StagedLessons>(null);
  // This tab's freshest refusal per lesson id. Essential rather than derived: the refusal arrives
  // in a response body that is read once and then gone, and the row it belongs to is still on
  // screen waiting to be decided. The server records it on the row for every OTHER tab.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  // The lesson whose write is in flight, so its two buttons can refuse a second press.
  const [busyId, setBusyId] = useState<string | null>(null);
  // The lessons that have been opened, whole — the LIST's memory of what it has read, held by id.
  // The region that draws a body unmounts on every collapse, so this cannot live in it: a person
  // who closes a 4000-character lesson and opens it again is handed back what they already had.
  const [bodies, setBodies] = useState<Record<string, LessonBody>>({});

  // Mount flag: a read or a write resolving after this section closed must not set state.
  const mountedRef = useRef(true);
  // The in-flight guard, read synchronously — `busyId` is a render value and lands too late to stop
  // a second press in the same tick.
  const writingRef = useRef(false);
  // That same write, carrying the identity of what it is writing. A press joins it ONLY when it
  // asks for the same lesson and the same verb: handed another lesson's promise, a caller would be
  // told a lesson was reviewed that was never touched.
  const inFlightRef = useRef<{ id: string; approve: boolean; running: Promise<void> } | null>(null);
  // What has already landed, for the one caller that is a PRESS rather than a render: `onOpen` has
  // to know whether this lesson was already read without waiting for a paint to tell it.
  const bodiesRef = useRef(bodies);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    bodiesRef.current = bodies;
  });

  /**
   * The staged list, read on mount and after every write. The answer is taken WHOLE, never merged:
   * the list IS the answer, and a row kept from an earlier reading would be a lesson nobody is
   * being asked about any more.
   */
  const read = useCallback(async () => {
    try {
      const body = await readApiJson<{ lessons: KanbanLessonLean[] }>(await api.kanban.lessons());
      if (!mountedRef.current) return;
      setLessons(Array.isArray(body.lessons) ? body.lessons : []);
    } catch (error) {
      // A read that failed is not a list that is EMPTY — the two are different sentences, and
      // painting them the same would tell a person nothing is waiting for them.
      console.warn('[useLessonReview] the staged lessons could not be read:', error);
      // The list already on screen STAYS: it is the last true reading, and a refusal held against
      // one of its rows would have nowhere left to be said if the rows went away. Only a first read
      // that failed — nothing has ever landed — is 'unread'.
      if (mountedRef.current) setLessons((held) => (held === null ? 'unread' : held));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  /** One lesson read whole, for the one row a person opened. */
  const readBodyFor = useCallback(async (lessonId: string) => {
    let next: LessonBody;
    try {
      const response = await api.kanban.lesson(lessonId);
      if (response.ok) {
        const body = (await response.json()) as { lesson: KanbanLesson };
        next = { state: 'read', lesson: body.lesson };
      } else {
        // A 404 is a lesson decided somewhere else since this list was read — no longer staged,
        // and the row itself will be gone a moment after this lands. Every other status is this
        // app's own footing, and the two are different sentences on the row.
        next = { state: response.status === 404 ? 'gone' : 'unread' };
      }
    } catch {
      next = { state: 'unread' };
    }
    if (mountedRef.current) setBodies((held) => ({ ...held, [lessonId]: next }));
  }, []);

  /** Raised on the OPEN transition only. A lesson already read is not read again, and the row keeps
   *  what it was already given. */
  const onOpen = useCallback((lessonId: string) => {
    if (bodiesRef.current[lessonId]?.state === 'read') return;
    setBodies((held) => ({ ...held, [lessonId]: { state: 'reading' } }));
    void readBodyFor(lessonId);
  }, [readBodyFor]);

  /** Drops a held refusal once its lesson has been decided — it described one attempt, not the row. */
  const forget = useCallback((lessonId: string) => {
    setRefusals((held) => {
      if (!(lessonId in held)) return held;
      const next = { ...held };
      delete next[lessonId];
      return next;
    });
  }, []);

  /**
   * One write, from the press to the re-read. `busyId` brackets exactly this span, so the buttons
   * stay refused until the list a person is looking at is the list after the write.
   */
  const runWrite = useCallback(async (lessonId: string, approve: boolean) => {
    setBusyId(lessonId);
    try {
      const response = await api.kanban[approve ? 'approveLesson' : 'rejectLesson'](lessonId);
      const body = await readBody(response);
      if (response.ok) {
        // Decided: the re-read below takes the row out, and a refusal it may have been wearing
        // described an attempt that is over.
        forget(lessonId);
      } else {
        // A 422 is the server's verdict — the state the lesson is actually in — and a 404 is a
        // lesson decided in another tab, whose own sentence says so. Every other status is this
        // app's own footing. All three are HELD ON THE ROW: the write did not land, and the row is
        // still there to be decided. A row the re-read then removes takes its held words with it,
        // which is why holding them costs nothing in the case they are not needed.
        const words = refusalWords(response.status, body, t);
        setRefusals((held) => ({ ...held, [lessonId]: words }));
      }
    } catch {
      if (mountedRef.current) {
        setRefusals((held) => ({ ...held, [lessonId]: refusalWords(0, null, t) }));
      }
    } finally {
      // After EVERY outcome, whatever it was: a decided lesson leaves the list, and a refused one
      // stays on it and picks up the words above.
      //
      // In a `finally`, and holding the re-read's own failure, because the one thing that must not
      // happen here is the buttons staying refused for the section's life. `read()` swallows its
      // throws today — this release is not a bet on that staying true, the same house shape the
      // memory lane's write keeps.
      try {
        await read();
      } catch {
        // The list keeps the picture it had; the next press is its own reason to read again, and
        // the write's verdict is already decided and about to be shown on the row.
      }
      if (mountedRef.current) setBusyId(null);
    }
  }, [forget, read, t]);

  const review = useCallback((lessonId: string, approve: boolean): Promise<void> => {
    const previous = inFlightRef.current;
    // The same lesson and the same verb pressed twice before the paint caught up: join the write
    // already going rather than open a second one — `busyId` is a render value and lands too late
    // to stop it, which is why this guard is synchronous.
    if (writingRef.current && previous && previous.id === lessonId && previous.approve === approve) {
      return previous.running;
    }
    writingRef.current = true;
    // Any OTHER press takes its turn behind the write in flight. It is never handed that write's
    // answer, and it is never dropped: a press that waits still HAPPENS, on the lesson it was
    // aimed at — the one thing a silently swallowed press can never claim.
    const running = previous
      ? previous.running.then(() => runWrite(lessonId, approve), () => runWrite(lessonId, approve))
      : runWrite(lessonId, approve);
    const entry = { id: lessonId, approve, running };
    inFlightRef.current = entry;
    // Released only once the list has been read again, so the synchronous guard and `busyId` stop
    // being free at the same moment rather than a whole refresh apart.
    void running.finally(() => {
      if (inFlightRef.current !== entry) return;
      inFlightRef.current = null;
      writingRef.current = false;
    });
    return running;
  }, [runWrite]);

  // The list arrived at the ceiling. A corpus of this size and a corpus cut to this size are the
  // same answer from the route, so the section says "at least" — a count presented as exact over a
  // list that was cut is the one thing this surface may not do, given the strip above it counts
  // every staged lesson in the estate.
  const capped = Array.isArray(lessons) && lessons.length >= LESSON_LIST_LIMIT;

  return { lessons, capped, bodies, onOpen, busyId, refusals, review };
}
