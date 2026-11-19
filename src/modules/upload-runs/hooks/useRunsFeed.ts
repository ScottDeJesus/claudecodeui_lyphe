import { parseFrame } from '@/modules/upload-runs/utils/uploadsFrames';
import { api } from '@/shared/api';
import { useEventFeed } from '@/shared/hooks/useEventFeed';
import type { EventFeed } from '@/shared/hooks/useEventFeed';
import type { UploadRunsFrame } from '@/shared/upload-runs-types';

/**
 * The run record's feed as its readers hold it: they subscribe, and never open a connection of their own.
 */
export type RunsFeed = EventFeed<UploadRunsFrame>;

/**
 * THE ONE FEED CONNECTION of the Uploads view: an `EventSource` on the run record's feed, open only while the view is shown
 * and closed the moment it is hidden. The feed tells that a run opened, moved or ended and that a walk wrote progress, after
 * the change committed; the readers of it (`useUploadsRead`, `useLiveRun`, `useRunSheet`) re-read what the frame names and
 * poll nothing. The browser re-dials a dropped connection by itself, and each dial is told to the readers as `open`.
 *
 * The connection, its hub and its redial after a refused dial are `useEventFeed`'s.
 *
 * Used by this module's `useUploadsRead`, which hands the feed on to the sheet's read.
 */
export function useRunsFeed(active: boolean): RunsFeed {
  return useEventFeed({ url: api.uploadRuns.feedUrl, parse: parseFrame, active, name: 'upload runs' });
}
