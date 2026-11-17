import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EventsReadFault, readEventsPage } from '@/modules/upload-runs/utils/readEventsPage';
import { lastSeqOf } from '@/modules/upload-runs/utils/lastSeq';
import type { AffectedAreasTrouble } from '@/shared/types';
import type { UploadRunEvent, UploadRunSummary } from '@/shared/upload-runs-types';
import { troubleOfFailure } from '@/shared/utils';

/** A page of a run's events: the sheet opens on the newest of these, and Show earlier reads the one before. */
const PAGE_SIZE = 500;

/** The most pages the first read follows to reach the newest event. One is the rule; the rest only absorb a `last_seq` that was read stale. */
const MAX_PAGES_TO_NEWEST = 20;

/** The page of events on screen, for one run: `earliestAfter` is the `after` its oldest page was read from (0: nothing older is left to ask for). */
type EventsPage = { sid: string; events: UploadRunEvent[]; earliestAfter: number };

/** The newest page failed to read, for one run. */
type EventsFailure = { sid: string; trouble: AffectedAreasTrouble };

/** One run's events as the sheet draws them, and the presses and appends that move them. */
type RunEvents = {
  /** In order, oldest first. Empty until the first page answers. */
  events: UploadRunEvent[];
  /** Older events were not asked for yet. */
  hasEarlier: boolean;
  status: 'loading' | 'ready' | 'trouble';
  trouble: AffectedAreasTrouble | null;
  /** The highest `seq` held, which a live stream is opened after. */
  heldUpTo: number;
  /** Puts one event the live stream told at the foot; one already held, or older than the newest held, is dropped. */
  append: (event: UploadRunEvent) => void;
  /** Reads the page before the oldest on screen and puts it above. */
  showEarlier: () => void;
  /** Reads the newest page again, for a read that failed. */
  retry: () => void;
};

const NO_EVENTS: UploadRunEvent[] = [];

/** The events from `after` on, following `next` to the newest. */
async function readThroughNewest(sid: string, after: number): Promise<UploadRunEvent[]> {
  const events: UploadRunEvent[] = [];
  let cursor = after;
  for (let pages = 0; pages < MAX_PAGES_TO_NEWEST; pages += 1) {
    const page = await readEventsPage(sid, cursor, PAGE_SIZE);
    events.push(...page.events);
    if (page.next === null) break;
    cursor = page.next;
  }
  return events;
}

const troubleOf = (failure: unknown): AffectedAreasTrouble => (failure instanceof EventsReadFault ? failure.trouble : troubleOfFailure(failure));

/**
 * THE OPEN RUN'S EVENTS: the newest 500 first (`after` is the run's last `seq` less 500, so the pane opens at the run's foot
 * and never on its oldest page), the 500 before the oldest on screen on Show earlier, and the lines a live stream tells at
 * the foot. The run's `last_seq` is not on the wire; `lastSeqOf` makes it from the counts.
 *
 * WHERE THE FIRST PAGE STARTS IS FIXED THE FIRST TIME THE RUN IS KNOWN. A live run's `last_seq` moves with every read of the
 * run, and a first page that followed it would be read again and lose the lines the stream added; so it is read once per
 * run, from the `after` the first answer named, and the stream adds to it.
 *
 * Used by this module's `useRunSheet`.
 */
export function useRunEvents(sid: string | null, run: UploadRunSummary | null): RunEvents {
  // Where this run's newest page starts, fixed when its first answer arrives (see above). Essential and not derivable: it must not follow the run's later reads.
  const [anchor, setAnchor] = useState<{ sid: string; after: number } | null>(null);
  if (sid !== null && run !== null && anchor?.sid !== sid) setAnchor({ sid, after: Math.max(0, lastSeqOf(run) - PAGE_SIZE) });
  const anchorAfter = anchor !== null && anchor.sid === sid ? anchor.after : null;

  // The page on screen for the run, and why the newest page could not be read. Essential and not derivable: they accumulate from reads and from the stream.
  const [page, setPage] = useState<EventsPage | null>(null);
  const [failure, setFailure] = useState<EventsFailure | null>(null);
  // How many times Try again was pressed; the newest page is read again when it moves.
  const [round, setRound] = useState(0);
  // Whether a Show earlier read is out, so a second press cannot start another over the same page. A ref: it gates a press and nothing draws from it.
  const earlierBusy = useRef(false);

  useEffect(() => {
    if (sid === null || anchorAfter === null) return undefined;
    // A newer read, a changed run or the sheet closing must not receive the answer of the read it left behind.
    let current = true;
    void (async () => {
      try {
        const events = await readThroughNewest(sid, anchorAfter);
        if (!current) return;
        setFailure(null);
        setPage({ sid, events, earliestAfter: anchorAfter });
      } catch (fault) {
        console.warn(`The newest events of run ${sid} could not be read.`, fault);
        if (current) setFailure({ sid, trouble: troubleOf(fault) });
      }
    })();
    return () => {
      current = false;
    };
  }, [sid, anchorAfter, round]);

  const showEarlier = useCallback(() => {
    if (sid === null || page === null || page.sid !== sid || page.earliestAfter === 0 || earlierBusy.current) return;
    earlierBusy.current = true;
    const before = page.earliestAfter;
    const after = Math.max(0, before - PAGE_SIZE);
    void (async () => {
      try {
        const older = await readEventsPage(sid, after, before - after);
        // Only what is older than the page: a run with gaps in its `seq`s fills the page past `before`.
        const earlier = older.events.filter((event) => event.seq <= before);
        setPage((now) => (now !== null && now.sid === sid && now.earliestAfter === before ? { ...now, events: [...earlier, ...now.events], earliestAfter: after } : now));
      } catch (fault) {
        console.warn(`The events of run ${sid} before ${before} could not be read.`, fault);
        setFailure({ sid, trouble: troubleOf(fault) });
      } finally {
        earlierBusy.current = false;
      }
    })();
  }, [sid, page]);

  const append = useCallback((event: UploadRunEvent) => {
    setPage((now) => {
      if (now === null || now.sid !== sid) return now;
      const newest = now.events.reduce((highest, held) => Math.max(highest, held.seq), now.earliestAfter);
      // `seq` 0 is one of the stream's two synthetic lines (a gap, a dropped watcher): never held, always shown.
      return event.seq !== 0 && event.seq <= newest ? now : { ...now, events: [...now.events, event] };
    });
  }, [sid]);

  const retry = useCallback(() => {
    setFailure(null);
    setPage(null);
    setRound((asked) => asked + 1);
  }, []);

  const mine = page !== null && page.sid === sid ? page : null;
  const failed = failure !== null && failure.sid === sid ? failure : null;
  const heldUpTo = useMemo(
    () => (mine === null ? 0 : mine.events.reduce((highest, held) => Math.max(highest, held.seq), mine.earliestAfter)),
    [mine],
  );

  return {
    events: mine?.events ?? NO_EVENTS,
    hasEarlier: mine !== null && mine.earliestAfter > 0,
    status: failed !== null ? 'trouble' : mine !== null ? 'ready' : 'loading',
    trouble: failed?.trouble ?? null,
    heldUpTo,
    append,
    showEarlier,
    retry,
  };
}
