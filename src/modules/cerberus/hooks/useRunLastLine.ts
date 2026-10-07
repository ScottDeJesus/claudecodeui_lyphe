import { useEffect, useState } from 'react';

import type { CerberusRunLine, CerberusRunView } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * A run's newest output line for a Needs-you card's strip, kept live while the run goes.
 *
 * The overview carries `run.lastLine` and its number `run.lastN`, but it is read again only when a hint says
 * something moved, at most once a second and not at all while a run is quiet between lines. Each
 * `cerberus_run_output` frame for the run brings its newest line at once, so this shows that line while it is
 * NEWER than the overview's (its `n` is past `run.lastN`) and the overview's `lastLine` from the moment a read
 * has caught up with it. Lines are compared by number, never by text, so a read that left before a frame and
 * lands after it cannot put its older line back over the frame's. A run that has ended shows what the overview
 * says, which is final. An overview from an API that does not send `lastN` is read as having no line yet, so
 * the newest frame's line stands until the run ends.
 *
 * Used by `NeedFix`, for the strip's second line.
 */
export function useRunLastLine(run: CerberusRunView | null): string | null {
  const { subscribe } = useWebSocket();
  const runId = run?.id ?? null;

  // The newest line a frame carried for this run: its number and its text. Essential: it is the only copy of
  // a line the overview has not been read for yet.
  const [frame, setFrame] = useState<{ runId: string; n: number; line: string } | null>(null);

  useEffect(() => {
    if (runId === null) return undefined;
    return subscribe((event) => {
      if (event.kind !== 'cerberus_run_output' || event.runId !== runId || !Array.isArray(event.lines)) return;
      const lines = event.lines as CerberusRunLine[];
      if (lines.length === 0) return;
      const newest = lines.reduce((best, line) => (line.n > best.n ? line : best));
      setFrame((held) => (held !== null && held.runId === runId && held.n >= newest.n ? held : { runId, n: newest.n, line: newest.line }));
    });
  }, [runId, subscribe]);

  if (run === null) return null;
  const live = run.result === null && frame !== null && frame.runId === run.id && frame.n > (run.lastN ?? 0);
  return live ? frame.line : run.lastLine;
}
