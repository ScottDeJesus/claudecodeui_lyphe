import { useEffect, useLayoutEffect, useRef } from 'react';

import { parseBubble } from '@/modules/upload-runs/utils/uploadsFrames';
import { api } from '@/shared/api';
import type { UploadRunEvent } from '@/shared/upload-runs-types';

/** The kind of bubble a run ends on: after it the engine closes the stream and a re-dial would only be answered 410. */
const ENDING_KIND = 'session_ended';

type RunStreamReader = {
  /** The last `seq` the caller already holds, asked once, as the stream opens: the stream replays what came after it. */
  from: () => number;
  /** One bubble, in the order the registry stamped them. The two synthetic kinds (`replay_gap`, `subscriber_dropped`) have `seq` 0. */
  onBubble: (event: UploadRunEvent) => void;
  /** The stream is over: the run ended, or the lane answered that it is not live (410, 404). What it held is now only in the record, so a caller that shows the run reads the record. */
  onOver?: () => void;
};

/**
 * A live run's own stream: an `EventSource` on the run, open for as long as `sid` is set and closed when it is cleared, when
 * the run ends and when the caller goes. A run that is not live answers 410 and the browser never re-dials it, so the caller
 * is told it is over and can read the stored run instead. A dropped connection is re-dialled by the browser itself, which resends
 * the last `id:` it saw, so no bubble is lost or doubled on the way.
 *
 * `reader` may be a new object each render: the stream is made once per `sid`, and the latest reader is the one it calls.
 *
 * Used by this module's `useLiveRun` (the newest step of the live run) and `useRunSheet` (the open run's lines).
 */
export function useRunStream(sid: string | null, reader: RunStreamReader): void {
  const latest = useRef(reader);
  useLayoutEffect(() => {
    latest.current = reader;
  });

  useEffect(() => {
    if (sid === null) return undefined;
    const source = new EventSource(api.uploadRuns.streamUrl(sid, latest.current.from()));
    source.addEventListener('bubble', (message) => {
      const event = parseBubble(message.data);
      if (event === null) return;
      latest.current.onBubble(event);
      if (event.kind === ENDING_KIND) {
        source.close();
        latest.current.onOver?.();
      }
    });
    source.onerror = () => {
      // CONNECTING is a drop the browser is already re-dialling; CLOSED is the lane saying the run is not live.
      if (source.readyState === EventSource.CLOSED) latest.current.onOver?.();
    };
    return () => source.close();
  }, [sid]);
}
