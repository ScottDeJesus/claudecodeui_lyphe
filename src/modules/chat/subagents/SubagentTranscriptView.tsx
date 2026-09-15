import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SubagentTranscriptTarget } from '@/shared/types';
import { Badge, Button, Spinner } from '@/shared/ui';
import { useSubagentTranscript } from '@/modules/chat/hooks/useSubagentTranscript';
import { SubagentNote } from '@/modules/chat/tools/SubagentNote';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

/** How many of the newest steps are drawn at once. */
const INITIALLY_DRAWN_STEPS = 100;

/** How many older steps one press of "show earlier" adds. */
const EARLIER_STEP = 100;

/**
 * One subagent's transcript, opened from its row: what it has done, newest at the bottom, live
 * until it is finished.
 *
 * THE ROW SAID WHAT; THIS SAYS HOW. A pinned row carries the agent's latest line and its figures,
 * which is the whole of what a person needs while it works — but the work itself is the file the
 * agent writes, and a reader who opens the row has asked for it. `useSubagentTranscript` reads
 * that file on demand and keeps reading it while there is more to arrive.
 *
 * THE PANEL IS NOT THIS VIEW. `tools/SubagentPanel.tsx` is the in-transcript rendering of the same
 * agent: a collapsible row built for the transcript's own flow, drawing the history the browser
 * already holds and capped at its first 200 entries. Here the reader asked a question, so the
 * answer is the file's tail, uncollapsed, read fresh.
 *
 * THE LAST HUNDRED ARE DRAWN, EARLIER ONES ON REQUEST. A single entry can expand into a diff, so
 * mounting all of the server's 1000 at once would be a thousand tool renderers the moment the row
 * is opened — and the newest steps are the ones the reader came for.
 *
 * Drawn by the chat module's `subagents/SubagentWidgetBody.tsx`, in the desktop chat gutter's
 * Subagents widget.
 */
export function SubagentTranscriptView({
  sessionId,
  target,
  label,
  running,
  onBack,
}: {
  sessionId: string | null;
  target: SubagentTranscriptTarget;
  label: string;
  running: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  // The result is already bare: the api member unwraps the one route that answers in an envelope.
  const { result, failed } = useSubagentTranscript(sessionId, target, running);
  // One calculator for the whole view. `ToolRenderer` reads it per entry, and building one per
  // entry would throw away the diff cache between two steps of the same file.
  const createDiff = useMemo(() => createCachedDiffCalculator(), []);
  // How far back the reader has reached, raised by the "show earlier" press below. It is the one
  // thing on this view that is genuinely the reader's, and it survives the polling reads.
  const [shown, setShown] = useState(INITIALLY_DRAWN_STEPS);

  // Whether this transcript is still being written, in the words a person reads: the row is
  // running, or the server said the file is still growing. Either alone is enough.
  const live = running || result?.inFlight === true;
  const activity = result?.activity ?? [];
  const visible = activity.slice(-shown);

  /** The sentinel drawn after the last step: seeing it IS being at the bottom. */
  const endRef = useRef<HTMLDivElement | null>(null);
  // A ref, not state: this flips on scroll frames and nothing about the drawing reads it.
  const atEnd = useRef(true);
  const hasTimeline = result !== null && result.found;

  useEffect(() => {
    const node = endRef.current;
    if (!hasTimeline || node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) atEnd.current = entry.isIntersecting;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasTimeline]);

  // A step arrived and the sentinel moved with it: a reader who was at the bottom is taken back
  // down to the newest one, and a reader who scrolled up to read something is left where they are.
  const activityLength = activity.length;
  useEffect(() => {
    if (activityLength === 0 || !atEnd.current) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [activityLength]);

  return (
    <div
      data-testid="subagent-transcript"
      data-kind={target.kind}
      data-row-id={target.id}
      data-live={String(live)}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          data-testid="subagent-transcript-back"
          size="icon"
          variant="ghost"
          onClick={onBack}
          aria-label={t('gutters.subagents.back')}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        {/* A word, not only a colour or a pulse (design doctrine): the reader is told which of the
          * two things they are looking at — a run still happening, or a record of one. */}
        {live ? <Badge tone="info">{t('gutters.subagents.live')}</Badge> : null}
      </div>

      {result === null ? (
        failed ? (
          <p className="text-xs text-muted-foreground">{t('gutters.subagents.failed')}</p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <Spinner />
            <p className="text-xs text-muted-foreground">{t('gutters.subagents.loading')}</p>
          </div>
        )
      ) : !result.found ? (
        <p className="text-xs text-muted-foreground">{t('gutters.subagents.notFound')}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {activity.length > shown ? (
            <Button
              data-testid="subagent-transcript-earlier"
              variant="ghost"
              size="sm"
              onClick={() => setShown((previous) => previous + EARLIER_STEP)}
            >
              {t('gutters.subagents.showEarlier')}
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-col gap-2 border-l border-border/60 pl-2">
            {visible.map((entry, index) => (
              <div
                // A tool entry carries the id of the call it ran, so it keeps its identity across
                // reads. An entry without one falls back to its place in the DRAWN SLICE —
                // unique, and stable while `shown` holds, but NOT the entry's position in the whole
                // timeline: raising `shown` renumbers the slice, so the notes it reaches remount.
                // That churn is the price of the fallback, and it is why the fallback is only for
                // entries with no id of their own.
                key={entry.toolId ?? String(result.total - activity.length + index)}
                data-testid="subagent-transcript-entry"
                className="min-w-0"
              >
                {entry.kind === 'tool' ? (
                  <ToolRenderer
                    toolName={entry.toolName || 'UnknownTool'}
                    toolInput={entry.toolInput}
                    toolResult={entry.toolResult}
                    toolId={entry.toolId}
                    mode="input"
                    createDiff={createDiff}
                  />
                ) : (
                  <SubagentNote activity={entry} />
                )}
              </div>
            ))}
          </div>
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
