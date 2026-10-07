import { useEffect, useRef, useState } from 'react';

import type { CerberusRunLine, CerberusRunView } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * A run's newest output line for a Needs-you card's strip, kept live while the run goes.
 *
 * The overview carries `run.lastLine`, but it is read again only when a hint says something moved, at
 * most once a second and not at all while a run is quiet between lines. Each `cerberus_run_output` frame
 * for the run brings its newest line at once, so this shows that line until a read of the overview brings
 * a `lastLine` of its own: a frame's line is only trusted against the overview it arrived after, so a
 * read that moved past it never leaves an older line standing. A run that has ended shows what the
 * overview says, which is final.
 *
 * ONE CASE IT CANNOT TELL: a read that left BEFORE a frame was sent and lands after it differs from the
 * overview the frame arrived after too, and it is older. The overview names its line by text and not by
 * number, so the two look alike, and the older line stands on the card until the run's next frame or the
 * next read. A newest line number on `CerberusRunView` would settle it (follow-up).
 *
 * Used by `NeedFix`, for the strip's second line.
 */
export function useRunLastLine(run: CerberusRunView | null): string | null {
  const { subscribe } = useWebSocket();
  const runId = run?.id ?? null;

  // The newest line a frame carried for this run: its number, its text, and the overview's `lastLine` it
  // arrived after. Essential: it is the only copy of a line the overview has not been read for yet.
  const [frame, setFrame] = useState<{ runId: string; n: number; line: string; after: string | null } | null>(null);

  // The overview's `lastLine` now, read from the frame's handler: it must not re-subscribe on every read.
  const overviewLine = useRef<string | null>(null);
  useEffect(() => {
    overviewLine.current = run?.lastLine ?? null;
  }, [run?.lastLine]);

  useEffect(() => {
    if (runId === null) return undefined;
    return subscribe((event) => {
      if (event.kind !== 'cerberus_run_output' || event.runId !== runId || !Array.isArray(event.lines)) return;
      const lines = event.lines as CerberusRunLine[];
      if (lines.length === 0) return;
      const newest = lines.reduce((best, line) => (line.n > best.n ? line : best));
      setFrame((held) => (
        held !== null && held.runId === runId && held.n >= newest.n && held.after === overviewLine.current
          ? held
          : { runId, n: newest.n, line: newest.line, after: overviewLine.current }
      ));
    });
  }, [runId, subscribe]);

  if (run === null) return null;
  const live = run.result === null && frame !== null && frame.runId === run.id && frame.after === run.lastLine;
  return live ? frame.line : run.lastLine;
}
