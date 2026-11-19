import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSchedulingOverview } from '@/modules/scheduling-report/hooks/useSchedulingOverview';
import { entriesToBuckets } from '@/modules/scheduling-report/utils/entriesToBuckets';
import type { SchedulingFilters, SchedulingRead, SchedulingWindow } from '@/modules/scheduling-report/utils/schedulingModel';
import { troubleSentence } from '@/modules/scheduling-report/utils/schedulingWords';
import { api } from '@/shared/api';
import { useCoalescedCall } from '@/shared/hooks/useCoalescedCall';
import { useEventFeed, useFeedEvents } from '@/shared/hooks/useEventFeed';
import type { EventFeed } from '@/shared/hooks/useEventFeed';
import type { SchedulingFeedFrame } from '@/shared/scheduling-report-types';

/** Frames within this long of the first are one re-read: a form's report and its presses land as a burst of rows. */
const FRAME_COALESCE_MS = 1000;

/** The scheduling record's feed as its readers hold it: they subscribe, never open a connection of their own. Exported: useEntrySheet takes it. */
export type SchedulingFeed = EventFeed<SchedulingFeedFrame>;

/**
 * The feed's edge, where text becomes a frame. The frame carries no row, id or account, only that something changed.
 */
function parseChangedFrame(data: string): SchedulingFeedFrame | null {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch (failure) {
    console.warn('The scheduling report feed sent something that is not JSON; it was skipped.', failure);
    return null;
  }
  if (typeof body === 'object' && body !== null && !Array.isArray(body) && 'type' in body && body.type === 'changed') {
    return { type: 'changed' };
  }
  console.warn('The scheduling report feed sent a frame this build has no shape for; it was skipped.');
  return null;
}

type SchedulingAsk = {
  /** Whether the Cerberus tab is showing the view. Hidden, the feed is closed and nothing is read. */
  shown: boolean;
  window: SchedulingWindow;
  filters: SchedulingFilters;
};

/**
 * The window's read and the presses that read it again. `feed` is the one connection to the scheduling record's feed, which the
 * open sheet's read subscribes to as well. `readAt` is when the newest read of the overview settled, answered or failed, as
 * epoch ms (0 before the first): the clock is read afresh from it.
 */
type SchedulingReader = {
  read: SchedulingRead;
  feed: SchedulingFeed;
  readAt: number;
  /** Refresh: reads the overview again and dials the feed again if it was refused, keeping the screen as it is until the new answer lands. */
  refresh: () => void;
  /** Try again: reads the overview again when it failed, and dials a refused feed. */
  retry: () => void;
};

/**
 * THE SCHEDULING VIEW'S READ OF ITS WINDOW. Told, not asking: reads the overview when the view is shown (the first time and
 * every return), when the window or a filter the server is asked for changes, and on a press; while shown it is told by the
 * scheduling record's feed, a content-free pulse each time a row of either table is written, and reads again a second after
 * the first of a burst; every (re)open of the feed reads it at once. No timer polls; hidden, the feed is closed and nothing is
 * read (MAN-8918). The feed's one retry after a refused dial is the redial `useEventFeed` carries.
 *
 * Used by this module's root, `SchedulingView`, which hands `feed` on to the sheet's read (`useEntrySheet`).
 */
export function useSchedulingRead({ shown, window: days, filters }: SchedulingAsk): SchedulingReader {
  const { t } = useTranslation();
  const lane = useSchedulingOverview(shown, days, filters);
  const feed = useEventFeed({ url: api.schedulingReport.feedUrl, parse: parseChangedFrame, active: shown, name: 'scheduling report' });
  const askAgain = useCoalescedCall(lane.reload, FRAME_COALESCE_MS, shown);
  useFeedEvents(feed, (event) => {
    // A (re)dial means frames may have been lost, so the overview is read at once; a frame waits a second for the rest of its burst.
    if (event.kind === 'open') lane.reload();
    else askAgain();
  });

  const overview = lane.overview;
  const buckets = useMemo(() => (overview === null ? null : entriesToBuckets(overview)), [overview]);

  const read: SchedulingRead = {
    phase: overview !== null ? 'ready' : lane.trouble !== null ? 'trouble' : 'loading',
    overview,
    trouble: lane.trouble === null ? null : troubleSentence(t, lane.trouble, 'overview'),
    stale: overview !== null && lane.trouble !== null,
    days: buckets?.days ?? [],
    hours: buckets?.hours ?? [],
  };

  return {
    read,
    feed,
    readAt: lane.readAt,
    refresh: () => {
      feed.redial();
      lane.reload();
    },
    retry: () => {
      feed.redial();
      if (lane.trouble !== null) lane.retry();
    },
  };
}
