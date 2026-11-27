import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useLaneWatch } from '@/shared/hooks/useLaneWatch';
import { useServerFrame } from '@/shared/hooks/useServerFrame';
import type { ServerEvent, SubagentTranscriptResult, SubagentTranscriptTarget } from '@/shared/types';

/** The server's tail of watched transcripts (`subagent-transcript-watch.service.ts`). */
const TRANSCRIPT_LANE = 'subagent_transcript';
/** The frame the tail sends when a watched transcript moved; it names the key it is about. */
const TRANSCRIPT_CHANGED_KIND = 'subagent_transcript_changed';
const TRANSCRIPT_FRAME_KINDS: readonly string[] = [TRANSCRIPT_CHANGED_KIND];

/**
 * One read's outcome, tagged with the target it belongs to. The tag is what makes a switch of
 * target read as a fresh view: an answer under the previous key is simply not this view's answer,
 * so nothing has to be cleared when the reader opens another row.
 */
type TranscriptRead = {
  key: string;
  result: SubagentTranscriptResult | null;
  failed: boolean;
};

/** Which target a read belongs to. `null` for no target at all. */
function keyOf(target: SubagentTranscriptTarget | null): string | null {
  return target === null ? null : `${target.kind}:${target.id}`;
}

/**
 * The key the server's tail knows this target by: `agent:<appSessionId>:<toolUseId>` or
 * `soul:<launchId>`. `null` for an agent row with no chat open, which has nothing to watch.
 */
function laneKeyOf(sessionId: string | null, kind: SubagentTranscriptTarget['kind'] | null, id: string | null): string | null {
  if (kind === null || id === null) return null;
  if (kind === 'soul') return `soul:${id}`;
  return sessionId === null ? null : `agent:${sessionId}:${id}`;
}

/**
 * The read for this target, or `null` when it cannot be asked. ONE ROUTE PER KIND, and the two are
 * mutually exclusive: an agent row is addressed through the chat's own session id, a launcher soul by
 * its launch id. A soul read needs no chat session and is never sent down the agent route; an agent
 * row with no chat open keeps its loading line rather than reading a stranger's.
 */
function transcriptRequest(
  sessionId: string | null,
  kind: SubagentTranscriptTarget['kind'] | null,
  id: string | null,
): (() => Promise<SubagentTranscriptResult>) | null {
  if (kind === null || id === null) return null;
  if (kind === 'soul') return () => api.subagentTranscripts.soul(id);
  if (sessionId === null) return null;
  return () => api.subagentTranscripts.agent(sessionId, id);
}

/** The key a frame names, read off the wire without trusting its shape. */
function frameKeyOf(event: ServerEvent): string | null {
  const key: unknown = Reflect.get(event, 'key');
  return typeof key === 'string' ? key : null;
}

/**
 * One subagent's transcript, read on demand and kept live while there is more to arrive.
 *
 * READS ON DEMAND, NOT FROM THE STREAM. The history path caps a subagent's timeline at 200 entries
 * counted from its head, and a launcher soul has no entry there at all, so the only honest source
 * for a transcript view is the file itself: read when the reader opens the row and whenever the row
 * starts or stops running.
 *
 * TOLD, NOT ASKED. While the row is running or the last answer says the file is still being written
 * (`inFlight`), the view watches its key on the socket (`useLaneWatch`); the server tails the
 * directory the route reads and sends `subagent_transcript_changed` with that key at most once a
 * second, and once more when the `inFlight` window lapses with nothing written. The view reads again
 * on each frame whose key is its own, and on a reconnect. A finished transcript is watched no longer.
 * There is no timer: a failed read is retried by the next frame or by the reconnect.
 *
 * THE API MEMBER HANDS BACK THE BARE RESULT for both routes, one of which wraps its answer in an
 * envelope, so this hook unwraps nothing, and a transcript that is not on disk is a `found: false`
 * reading rather than a thrown error. The one refusal that IS a failure is an id the route's own
 * registry does not hold.
 *
 * THE NEWEST READ WINS. Each read takes a number, and an answer carrying an older one is dropped
 * rather than written, so a slow first response cannot land after a fast second one and send the
 * list backwards.
 *
 * Read by the chat module's `subagents/SubagentTranscriptView.tsx`, which is opened by the chat's own
 * rows and by the kanban card drawer's step transcripts, which open a `soul` target.
 */
export function useSubagentTranscript(
  sessionId: string | null,
  target: SubagentTranscriptTarget | null,
  running: boolean,
): { result: SubagentTranscriptResult | null; failed: boolean } {
  const [latest, setLatest] = useState<TranscriptRead | null>(null);
  /** The newest read's number. A ref, because bumping it must not repaint anything by itself. */
  const tokenRef = useRef(0);

  const key = keyOf(target);
  const kind = target?.kind ?? null;
  const id = target?.id ?? null;
  const laneKey = laneKeyOf(sessionId, kind, id);
  const request = useMemo(() => transcriptRequest(sessionId, kind, id), [sessionId, kind, id]);

  const read = useCallback(async (): Promise<void> => {
    if (request === null || key === null) return;
    const token = ++tokenRef.current;
    let next: SubagentTranscriptResult;
    try {
      next = await request();
    } catch {
      if (tokenRef.current !== token) return;
      // The read itself failed: the route refused it, or the network dropped. Say so and KEEP the
      // last result, because a transcript that had already rendered must not blank out on a blip.
      setLatest((previous) => ({
        key,
        result: previous !== null && previous.key === key ? previous.result : null,
        failed: true,
      }));
      return;
    }
    if (tokenRef.current !== token) return;
    setLatest({ key, result: next, failed: false });
  }, [request, key]);

  // `running`: the row starting or stopping is news the file may not show yet, so it reads again.
  useEffect(() => {
    void read();
  }, [read, running]);

  // A read under another key is another view's answer, so this one asks again from the top.
  const current = latest !== null && latest.key === key ? latest : null;
  const isWatching = laneKey !== null && (running || current?.result?.inFlight === true);

  useLaneWatch(TRANSCRIPT_LANE, laneKey, isWatching);
  useServerFrame(TRANSCRIPT_FRAME_KINDS, (event) => {
    if (!isWatching) return;
    if (event.kind === TRANSCRIPT_CHANGED_KIND && frameKeyOf(event) !== laneKey) return;
    void read();
  });

  return { result: current?.result ?? null, failed: current?.failed ?? false };
}
