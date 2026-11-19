import { useTranslation } from 'react-i18next';

import type { SchedulingFeed } from '@/modules/scheduling-report/hooks/useSchedulingRead';
import type { EntrySheetRead } from '@/modules/scheduling-report/utils/schedulingModel';
import { troubleSentence } from '@/modules/scheduling-report/utils/schedulingWords';
import { api } from '@/shared/api';
import { useCoalescedCall } from '@/shared/hooks/useCoalescedCall';
import { useFeedEvents } from '@/shared/hooks/useEventFeed';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { SchedulingEntryWhole } from '@/shared/scheduling-report-types';

/** Frames that come within this long of the first are one read of the entry. */
const FRAME_COALESCE_MS = 1000;

/** The entry whole for the key it was asked for, which is the entry's id. Module-level, as `useLaneRead` needs it. */
const fetchEntry = (id: string) => api.schedulingReport.entry(id);

/** The open entry's read and the press that asks it again. */
type EntrySheetReader = {
  sheet: EntrySheetRead;
  /** Try again: reads the entry again when its read failed. */
  retry: () => void;
};

/**
 * THE OPEN ENTRY, read for its sheet: the entry whole (its form's report, its presses, the visit as it stands, what came
 * after). Read on open, and again a second after a feed event while open; nothing while the sheet is shut or the view
 * hidden; no timer.
 *
 * `id` is null while the sheet is shut and while the view is hidden, and then nothing is read. A re-read that fails after
 * a good one keeps the entry on screen: an entry is a finished record, so the last answer stays true enough to read
 * (unlike a live run).
 *
 * Used by this module's root, `SchedulingView`.
 */
export function useEntrySheet(id: string | null, feed: SchedulingFeed): EntrySheetReader {
  const { t } = useTranslation();
  const whole = useLaneRead<SchedulingEntryWhole>(id, fetchEntry);
  const reloadEntry = useCoalescedCall(whole.reload, FRAME_COALESCE_MS, id !== null);
  useFeedEvents(feed, () => {
    // Every event, frame or (re)open: the frame carries no id, so any change may be this entry's (a later act on its
    // visit), and an open means frames may have been lost.
    if (id !== null) reloadEntry();
  });

  const sheet: EntrySheetRead = {
    phase: whole.value !== null ? 'ready' : whole.trouble !== null ? 'trouble' : 'loading',
    whole: whole.value,
    trouble: whole.value === null && whole.trouble !== null ? troubleSentence(t, whole.trouble, 'entry') : null,
  };

  return {
    sheet,
    retry: () => {
      if (whole.trouble !== null) whole.retry();
    },
  };
}
