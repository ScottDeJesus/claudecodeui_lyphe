import { useCallback, useState } from 'react';

import type { SchedulingFilters, SchedulingWindow } from '@/modules/scheduling-report/utils/schedulingModel';
import { api } from '@/shared/api';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { SchedulingOverview } from '@/shared/scheduling-report-types';
import type { AffectedAreasTrouble } from '@/shared/types';

/** What the window's read holds: the answer on screen, and why the last read failed, if it did. */
type SchedulingOverviewRead = {
  /** The newest good answer; null before the first, and after a read for a changed window or filter has failed. */
  overview: SchedulingOverview | null;
  /** Why the newest read failed; null while it has not. With an `overview` beside it, the answer is the last good one and is stale. */
  trouble: AffectedAreasTrouble | null;
  /** When the newest read settled, answered or failed, as epoch ms; 0 before the first. The clock is read afresh from it. */
  readAt: number;
  /** Reads again quietly: the answer on screen stays until the new one lands. */
  reload: () => void;
  /** Try again: clears the failure so the waiting surface shows while the read is out. */
  retry: () => void;
};

/**
 * The scheduling record's overview for one window and one set of filters, read through `useLaneRead`: when the view is
 * shown (the first time and every return), when the window, the person or Machine calls change, and on `reload` and
 * `retry`. Never on a timer, and nothing while hidden: a null key reads nothing. Speed bumps only is the browser's own
 * and is not asked.
 *
 * TWO THINGS `useLaneRead` DOES NOT DO ARE DONE HERE. A key that changed shows nothing of the old answer under it (the old
 * window never stands under the new one's name), and a hidden view has no key, so by itself every press of a chip and every
 * visit to another tab would blank the view and unmount its body, losing the rows the reader had opened. So the last good
 * answer is kept and shown while the next read for a changed key is OUT. It is dropped when that read FAILS: then there is no
 * answer for what was asked, and the view says so. A read that fails for the SAME key keeps the answer the lane holds, with
 * `trouble` beside it, which the view words as the last answer and its age.
 *
 * `readAt` says when a read settled, failures included: the age of the answer on screen is counted to it, and a failed read
 * changes nothing else the view could count from (the answer keeps its own `generated_at`).
 *
 * Used by this module's `useSchedulingRead`.
 */
export function useSchedulingOverview(shown: boolean, days: SchedulingWindow, filters: SchedulingFilters): SchedulingOverviewRead {
  const { by, machines } = filters;
  // When the newest read settled. Essential and not derivable: a read that fails changes no other value this view holds.
  const [readAt, setReadAt] = useState(0);
  // The lane reads with what the window and the filters are now; this function changes only when they do, which is the
  // moment the key below changes too, so the lane reads once for each change.
  const fetchOverview = useCallback(async () => {
    try {
      return await api.schedulingReport.overview({ days, by: by ?? undefined, machines });
    } finally {
      setReadAt(Date.now());
    }
  }, [days, by, machines]);
  const key = shown ? JSON.stringify([days, by, machines]) : null;
  const lane = useLaneRead<SchedulingOverview>(key, fetchOverview);

  // The last good answer, kept across a hidden view and across a changed key. Adjusted during render, React's own pattern for
  // state that follows a value: a render React draws is never one behind it.
  const [kept, setKept] = useState<SchedulingOverview | null>(null);
  if (lane.value !== null && lane.value !== kept) setKept(lane.value);
  if (lane.value === null && lane.trouble !== null && kept !== null) setKept(null);

  return {
    overview: lane.value ?? (lane.trouble === null ? kept : null),
    trouble: lane.trouble,
    readAt,
    reload: lane.reload,
    retry: lane.retry,
  };
}
