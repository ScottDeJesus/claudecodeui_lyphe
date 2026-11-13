import { useTranslation } from 'react-i18next';

import { useCoalescedCall } from '@/modules/upload-runs/hooks/useCoalescedCall';
import { useHealSessions } from '@/modules/upload-runs/hooks/useHealSessions';
import { useHealSignature } from '@/modules/upload-runs/hooks/useHealSignature';
import { useRunEvents } from '@/modules/upload-runs/hooks/useRunEvents';
import { useFeedEvents } from '@/modules/upload-runs/hooks/useRunsFeed';
import type { RunsFeed } from '@/modules/upload-runs/hooks/useRunsFeed';
import { useRunStream } from '@/modules/upload-runs/hooks/useRunStream';
import { sessionIdsOf } from '@/modules/upload-runs/utils/healAnswer';
import type { RunSheetRead } from '@/modules/upload-runs/utils/uploadsModel';
import { troubleSentence } from '@/modules/upload-runs/utils/uploadsWords';
import { api } from '@/shared/api';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { UploadRunWhole } from '@/shared/upload-runs-types';

/** Frames that come within this long of the first are one read of the run. */
const FRAME_COALESCE_MS = 1000;

/** The run whole for the key it was asked for, which is the run's session id. Module-level, as `useLaneRead` needs it. */
const fetchRun = (sid: string) => api.uploadRuns.run(sid);

/** The open run's read and the presses that move or repeat it. */
type RunSheetReader = {
  sheet: RunSheetRead;
  /** Show earlier: reads the 500 events before the oldest on screen and puts them above. */
  showEarlier: () => void;
  /** Try again: reads again whichever of the run, its events and the heal answer failed. */
  retry: () => void;
};

/**
 * THE OPEN RUN, read for its sheet: the run whole (its walks, what came after, the verdict), its events, and the heal
 * ledger's answer for its one Claude session. `sid` is null while the sheet is closed and while the view is hidden, and
 * then nothing is read and no stream is open.
 *
 * THE EVENTS are the newest 500 (`useRunEvents`; Show earlier reads the 500 before the first one on screen). ON A LIVE RUN the
 * run's own stream is opened after the newest event read and its lines are put at the foot as they come; the sheet follows
 * the newest line unless the reader has scrolled up (`RunEvents`). THE RUN is read again a second after a frame of the feed
 * names it (it opened, moved, ended, or a walk of it wrote a step), after the stream says the run is over, and when the
 * feed (re)dials: its verdict, its walks and what came after follow the run. The heal answer is read again when a heal
 * changes and when the run ends. No timer polls, and closing the sheet or hiding the view closes the stream. A read of the
 * run that fails while the sheet holds it as live is a fault the sheet says, never a run that goes on looking live.
 *
 * `RunSheetRead.whole` is held back until the first page of events is in hand, so the sheet shows its waiting surface
 * instead of a pane that says the run has no events for the moment the page is out.
 *
 * Used by this module's root, `UploadsView`.
 */
export function useRunSheet(sid: string | null, feed: RunsFeed): RunSheetReader {
  const { t } = useTranslation();
  const whole = useLaneRead<UploadRunWhole>(sid, fetchRun);
  const run = whole.value?.run ?? null;
  const events = useRunEvents(sid, run);

  const live = run !== null && run.verdict === 'live' && events.status === 'ready';
  const reloadRun = useCoalescedCall(whole.reload, FRAME_COALESCE_MS, sid !== null);
  useRunStream(live ? sid : null, {
    from: () => events.heldUpTo,
    onBubble: events.append,
    // The run ended (or was never live to this stream): what the stream held is now in the record, and the record is read.
    onOver: reloadRun,
  });
  useFeedEvents(feed, (event) => {
    if (sid !== null && (event.kind === 'open' || event.frame.session_id === sid)) reloadRun();
  });

  const healSignature = useHealSignature();
  const heal = useHealSessions(run === null ? null : sessionIdsOf([run]), sid !== null, `${healSignature}|${run?.verdict ?? ''}|${run?.ended_at ?? ''}`);

  // A re-read that failed leaves the run it held on screen. For a run that had ended that is the truth; for one held as LIVE it
  // may be a lie (it may have ended since, and its sheet would go on saying "still running" with a Following badge), so it is
  // a fault, with Try again: a monitor that cannot see must never look current.
  const runFault = whole.trouble !== null && (whole.value === null || whole.value.run.verdict === 'live') ? whole.trouble : null;
  const eventsFault = events.status === 'trouble' ? events.trouble : null;
  const fault = runFault ?? eventsFault;
  const ready = fault === null && whole.value !== null && events.status === 'ready';

  const sheet: RunSheetRead = {
    phase: fault !== null ? 'trouble' : ready ? 'ready' : 'loading',
    whole: ready ? whole.value : null,
    events: events.events,
    hasEarlier: events.hasEarlier,
    live,
    friction: heal.answer,
    frictionFailed: heal.failed,
    trouble: fault === null ? null : troubleSentence(t, fault, 'run'),
  };

  return {
    sheet,
    showEarlier: events.showEarlier,
    retry: () => {
      if (runFault !== null) whole.retry();
      if (eventsFault !== null) events.retry();
      if (heal.failed) heal.retry();
    },
  };
}
