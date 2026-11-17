import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCoalescedCall } from '@/modules/upload-runs/hooks/useCoalescedCall';
import { useHealSessions } from '@/modules/upload-runs/hooks/useHealSessions';
import { useHealSignature } from '@/modules/upload-runs/hooks/useHealSignature';
import { useLiveRun } from '@/modules/upload-runs/hooks/useLiveRun';
import { useOverviewRead } from '@/modules/upload-runs/hooks/useOverviewRead';
import { useFeedEvents, useRunsFeed } from '@/modules/upload-runs/hooks/useRunsFeed';
import type { RunsFeed } from '@/modules/upload-runs/hooks/useRunsFeed';
import { useThrottledCall } from '@/modules/upload-runs/hooks/useThrottledCall';
import { bucketDays } from '@/modules/upload-runs/utils/bucketDays';
import { bucketHours } from '@/modules/upload-runs/utils/bucketHours';
import { sessionIdsOf } from '@/modules/upload-runs/utils/healAnswer';
import { healedCounts, joinFriction } from '@/modules/upload-runs/utils/joinFriction';
import { typeRegression } from '@/modules/upload-runs/utils/typeRegression';
import type { UploadsFilters, UploadsRead, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
import { troubleSentence } from '@/modules/upload-runs/utils/uploadsWords';

/** Frames that come within this long of the first are one re-read: a walk writes a step every few seconds, a run edge comes in a burst. */
const FRAME_COALESCE_MS = 1000;

/** Refresh acts at once, and presses that follow it within this long are one more read at the end of it, not one each. */
const REFRESH_GAP_MS = 1000;

const NO_REGRESSION: UploadsRead['regression'] = { initial: false, final: false };

type UploadsAsk = {
  /** Whether the Cerberus tab is showing the view. Hidden, the feed is closed and nothing is read. */
  shown: boolean;
  window: UploadsWindow;
  filters: UploadsFilters;
};

/**
 * The window's read and the presses that read it again. `feed` is the one connection to the run record's feed, which the
 * open sheet's read subscribes to as well. `readAt` is when the newest read of the overview settled, answered or failed, as
 * epoch ms (0 before the first): the clock is read afresh from it.
 */
type UploadsReader = {
  read: UploadsRead;
  feed: RunsFeed;
  readAt: number;
  /** Refresh: reads the overview and the heal answer again, and dials the feed again if it was refused, keeping the screen as it is until the new answer lands. */
  refresh: () => void;
  /** Try again: reads again whichever of the overview and the heal answer failed, and dials the feed again if it was refused. */
  retry: () => void;
};

/**
 * THE UPLOADS VIEW'S READ OF ITS WINDOW. Told, not asking: it reads the overview when the view is shown (the first time and
 * every return), when the window or a filter the server is asked for changes, and on a press; and while the view is shown it
 * is told by the run record's feed, a frame after any run edge or walk step, and reads again a second after the first of a
 * burst. It holds no timer that polls, and while the view is hidden the feed is closed and nothing is read (MAN-8918).
 *
 * THE OVERVIEW comes first (`useOverviewRead`). THE HEAL ANSWER follows: the heal worker's rows and heals for the Claude
 * sessions of the overview's runs, 200 ids a read, joined to the runs here in the browser by `claude_session_id`, each owner
 * keeping its own door (`useHealSessions`). The ledger offers no event, so it is read again when the show, a frame or a press
 * reads the overview, when the overview names other sessions, and when the app's heal context (`useHeal`, which already reads
 * the worker once a minute for the Inbox) reports a heal that changed: that minute-long read is the only interval, and this
 * view adds none. A heal answer that failed is `frictionFailed`, never an empty friction.
 *
 * A BURST IS BOUNDED. Frames within a second are one read; presses of Refresh act at once and the ones that follow within a
 * second are one more (`useThrottledCall`); the heal answer is read one at a time (`useHealSessions`).
 *
 * THE LIVE RUN's newest step comes from `useLiveRun` and is `read.live`. The pure fills (`joinFriction`, `typeRegression`,
 * `bucketDays`, `bucketHours`) are made from the answers in hand.
 *
 * Used by this module's root, `UploadsView`.
 */
export function useUploadsRead({ shown, window: days, filters }: UploadsAsk): UploadsReader {
  const { t } = useTranslation();
  const lane = useOverviewRead(shown, days, filters);
  const feed = useRunsFeed(shown);
  const overview = lane.overview;

  // How many times the overview was read again by a frame or a press. The heal answer reads again with it, in step with the
  // overview and not after it, because the ids rarely change; when they do, the new ones are asked as the overview lands.
  const [rereads, setRereads] = useState(0);
  const reread = () => {
    lane.reload();
    setRereads((count) => count + 1);
  };
  const askAgain = useCoalescedCall(reread, FRAME_COALESCE_MS, shown);
  // A press of Refresh also dials a feed that was refused, which is the one thing it can do for a view that is not being told.
  const refresh = useThrottledCall(() => {
    feed.redial();
    reread();
  }, REFRESH_GAP_MS);
  useFeedEvents(feed, (event) => {
    // A dial means frames may have been lost, so the overview is read at once; the heal answer waits for a frame or a press.
    if (event.kind === 'open') lane.reload();
    else askAgain();
  });

  const healSignature = useHealSignature();
  const ids = useMemo(() => (overview === null ? null : sessionIdsOf(overview.runs)), [overview]);
  const heal = useHealSessions(ids, shown, `${healSignature}|${rereads}`);
  const answer = heal.answer;

  const friction = useMemo(() => (answer === null ? null : joinFriction(answer)), [answer]);
  const healed = useMemo(() => (answer === null ? null : healedCounts(answer)), [answer]);
  const regression = useMemo(() => (answer === null || overview === null ? NO_REGRESSION : typeRegression(answer, overview.runs)), [answer, overview]);
  // Counted from the day the answer was made, so the window's last column is the day its newest runs fell on.
  const bucketsDays = useMemo(
    () => (overview === null ? [] : bucketDays(overview.runs, overview.window.days, Date.parse(overview.generated_at))),
    [overview],
  );
  const bucketsHours = useMemo(() => (overview === null ? [] : bucketHours(overview.runs)), [overview]);

  const live = useLiveRun(shown ? overview?.live ?? null : null, feed);

  const read: UploadsRead = {
    phase: overview !== null ? 'ready' : lane.trouble !== null ? 'trouble' : 'loading',
    overview,
    trouble: lane.trouble === null ? null : troubleSentence(t, lane.trouble, 'overview'),
    stale: overview !== null && lane.trouble !== null,
    friction,
    frictionFailed: heal.failed,
    healed,
    regression,
    days: bucketsDays,
    hours: bucketsHours,
    live,
  };

  return {
    read,
    feed,
    readAt: lane.readAt,
    refresh,
    retry: () => {
      feed.redial();
      if (lane.trouble !== null) lane.retry();
      if (heal.failed) heal.retry();
    },
  };
}
