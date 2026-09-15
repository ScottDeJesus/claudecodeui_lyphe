import { useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { SubagentTranscriptResult, SubagentTranscriptTarget } from '@/shared/types';

/**
 * How long between two reads of a transcript that is still being written. Two seconds: the file
 * behind this is appended to by another process, and a list of steps that arrives in one piece
 * every couple of seconds beats one that repaints per line.
 */
const TRANSCRIPT_POLL_MS = 2000;

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
 * One subagent's transcript, read on demand and kept live while there is more to arrive.
 *
 * READS ON DEMAND, NOT FROM THE STREAM. The history path caps a subagent's timeline at 200 entries
 * counted from its head, and a launcher soul has no entry there at all, so the only honest source
 * for a transcript view is the file itself — read once when the reader opens the row, then again
 * every `TRANSCRIPT_POLL_MS` while the row is running or the server says the file is still being
 * written. A finished transcript is read once and the timer is not re-armed: polling a file nobody
 * is writing would be a request per two seconds for an answer that cannot change.
 *
 * THE API MEMBER HANDS BACK THE BARE RESULT — both routes, one of which wraps its answer in an
 * envelope — so this hook unwraps nothing, and a "not found" is a `found: false` reading rather
 * than a thrown error.
 *
 * THE NEWEST READ WINS. Each effect takes a number, and an answer carrying an older one is dropped
 * rather than written, so a slow first response cannot land after a fast second one and send the
 * list backwards. The timer is cleared on unmount and on a target change; a late answer from the
 * abandoned read is ignored.
 *
 * Read by the chat module's `subagents/SubagentTranscriptView.tsx`.
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

  useEffect(() => {
    if (key === null || kind === null || id === null) return;
    // An agent row is addressed through the chat's own session id, and a gutter with no chat open
    // has nothing to ask about: the view keeps its loading line rather than reading a stranger's.
    if (kind === 'agent' && sessionId === null) return;
    // Non-null by the guard above: an agent transcript is only ever read through a chat.
    const agentSessionId = sessionId as string;

    let cancelled = false;
    let timer: number | undefined;
    const token = ++tokenRef.current;

    const run = async (): Promise<void> => {
      let next: SubagentTranscriptResult;
      try {
        next = kind === 'soul'
          ? await api.subagentTranscripts.soul(id)
          : await api.subagentTranscripts.agent(agentSessionId, id);
      } catch {
        if (cancelled || tokenRef.current !== token) return;
        // The read itself failed — the route refused it, or the network dropped. Say so and KEEP
        // the last result: a transcript that had already rendered must not blank out on a blip.
        setLatest((previous) => ({
          key,
          result: previous !== null && previous.key === key ? previous.result : null,
          failed: true,
        }));
        if (running) timer = window.setTimeout(() => void run(), TRANSCRIPT_POLL_MS);
        return;
      }
      if (cancelled || tokenRef.current !== token) return;
      setLatest({ key, result: next, failed: false });
      // The next read is armed only while something is still on its way: the row is running, or
      // the server says the file is still being written.
      if (running || next.inFlight) {
        timer = window.setTimeout(() => void run(), TRANSCRIPT_POLL_MS);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [key, kind, id, sessionId, running]);

  // A read under another key is another view's answer, so this one asks again from the top.
  const current = latest !== null && latest.key === key ? latest : null;
  return { result: current?.result ?? null, failed: current?.failed ?? false };
}
