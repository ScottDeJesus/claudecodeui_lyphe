import { memo, useCallback, useState } from 'react';
import { Bot, X } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import {
  describeLatestActivity,
  describeSubagentUsage,
  formatSubagentFinishTime,
  readSubagentSummary,
} from '@/modules/chat/utils/subagentSummary';

/**
 * The agents of this conversation, held above the transcript: the ones running now, and the
 * ones that finished until the reader dismisses them.
 *
 * A subagent's own row scrolls away the moment it starts working — the agent then streams
 * nothing into the main thread for minutes, so the one line saying it exists is the first
 * thing to leave the screen. This keeps it in view, with the newest thing it did or said and
 * what it has spent so far — its context window and what it has written, live, each request
 * moving the figures (the operator's ask of 2026-09-10: "live usage of tokens and token
 * counts in the pinned subagents") — and
 * when it finishes the row STAYS, marked with its finish time, so the reader learns it ended
 * without having been there to see it. Only the reader's own dismissal removes a finished row
 * (the operator's ruling of 2026-09-10: "dismiss it when it unpins, not when it's done"); a
 * dismissal is remembered in this browser, so a reload does not bring the row back.
 *
 * It sits ABOVE THE CHAT BOX, at the top of the composer's shell — outside the transcript's
 * scroller, so the transcript ends above it and no message is ever under it (the operator's
 * ruling of 2026-09-10, after a sticky strip at the top of the scroller read as "floating").
 */
type PinnedSubagentsProps = {
  messages: ChatMessage[];
};

/**
 * How long a "running" agent is still believed. A backgrounded agent is only ever declared
 * finished by its task-notification, and that notification can be compacted out of a transcript
 * — leaving a stored row that says `running` forever and would otherwise re-pin a long-dead
 * agent every time the conversation is opened. Well past any real run; short of a day.
 */
const RUNNING_BELIEVED_FOR_MS = 4 * 60 * 60 * 1000;

/**
 * How long a FINISHED agent stays offered for dismissal. Not a substitute for the reader's
 * dismissal — it bounds a reopened conversation, whose every agent of the last week would
 * otherwise pile into the strip at once.
 */
const FINISHED_SHOWN_FOR_MS = 2 * 60 * 60 * 1000;

/** The ids this browser's reader has dismissed. One list for every conversation; ids are unique. */
const DISMISSED_STORAGE_KEY = 'cloudcli.pinned-agents.dismissed';
const DISMISSED_CAP = 500;

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids].slice(-DISMISSED_CAP)));
  } catch {
    // Storage full or unavailable: the dismissal still holds for this page's life.
  }
}

function PinnedSubagents({ messages }: PinnedSubagentsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const dismiss = useCallback((id: string) => {
    setDismissed((previous) => {
      const next = new Set(previous);
      next.add(id);
      writeDismissed(next);
      return next;
    });
  }, []);

  const now = Date.now();
  const rows = messages
    .filter((message) => message.isSubagentContainer)
    .map((message) => ({
      id: String(message.toolId ?? ''),
      startedAt: new Date(message.timestamp).getTime(),
      latest: describeLatestActivity(message.subagentActivity),
      summary: readSubagentSummary({
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        toolResultAt: message.toolResultAt as string | number | Date | undefined,
        subagent: message.subagent,
        activity: message.subagentActivity,
        usage: message.subagentUsage,
      }),
    }))
    .filter((entry) => !dismissed.has(entry.id))
    .filter((entry) => {
      if (entry.summary.status === 'running') {
        return !Number.isFinite(entry.startedAt) || now - entry.startedAt < RUNNING_BELIEVED_FOR_MS;
      }
      const finishedAt = entry.summary.finishedAt ? new Date(entry.summary.finishedAt).getTime() : entry.startedAt;
      return !Number.isFinite(finishedAt) || now - finishedAt < FINISHED_SHOWN_FOR_MS;
    })
    // Running first, oldest launch on top; then the finished, newest finish on top.
    .sort((a, b) => {
      const aRunning = a.summary.status === 'running';
      const bRunning = b.summary.status === 'running';
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      if (aRunning) return a.startedAt - b.startedAt;
      const aEnd = a.summary.finishedAt ? new Date(a.summary.finishedAt).getTime() : a.startedAt;
      const bEnd = b.summary.finishedAt ? new Date(b.summary.finishedAt).getTime() : b.startedAt;
      return bEnd - aEnd;
    });

  if (rows.length === 0) {
    return null;
  }

  return (
    // `mb-8` leaves room for the activity tab, which floats above the input in that gap.
    <div className="mx-auto mb-8 w-full max-w-[54.25rem]" data-testid="pinned-subagents">
      {/* Capped and scrollable: a fan-out of six agents is ordinary here, and at ~44px a row
        * an uncapped strip took a third of a phone's reading area for the whole run. */}
      <div className="scrollbar-thin flex max-h-44 flex-col gap-1 overflow-y-auto rounded-xl border border-purple-500/25 bg-popover/95 p-1.5 shadow-sm backdrop-blur-sm dark:border-purple-400/25">
        {rows.map(({ id, latest, summary }) => {
          const running = summary.status === 'running';
          const tokens = describeSubagentUsage(summary.usage);
          return (
            <div
              key={id}
              data-testid="pinned-subagent-row"
              data-status={summary.status}
              data-tool-id={id}
              // Square on the left, rounded on the right: a rounded corner under a 2px left
              // border draws it as an arc, which reads as a stray mark rather than a rule.
              className={`flex flex-col gap-0.5 rounded-r-lg border-l-2 px-2 py-1 text-xs ${
                running
                  ? 'border-l-purple-500 dark:border-l-purple-400'
                  : summary.status === 'failed'
                    ? 'border-l-red-500 dark:border-l-red-400'
                    : summary.status === 'stopped'
                      ? 'border-l-amber-500 dark:border-l-amber-400'
                      : 'border-l-emerald-500 dark:border-l-emerald-400'
              } text-muted-foreground`}
            >
              <div className="flex items-center gap-1.5">
                <Bot className={`h-3.5 w-3.5 flex-shrink-0 ${running ? 'text-purple-500 dark:text-purple-400' : 'text-muted-foreground/70'}`} />
                <span className="flex-shrink-0 font-medium text-foreground">{summary.label || 'Agent'}</span>
                {summary.description && (
                  <>
                    <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
                    <span className="min-w-0 flex-1 truncate">{summary.description}</span>
                  </>
                )}
                {summary.nickname && (
                  <span className="flex-shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground/70">
                    {summary.nickname}
                  </span>
                )}
                {running ? (
                  // "running" ALWAYS, with the count beside it rather than instead of it: a bare
                  // "4 tools" is precisely the panel's finished label, so the pin read as a summary
                  // of something already over the moment its first tool landed.
                  <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-600 dark:text-purple-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
                    running
                    {summary.toolCount > 0 && (
                      <span className="text-muted-foreground/70">
                        · {summary.toolCount} {summary.toolCount === 1 ? 'tool' : 'tools'}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 text-[11px]">
                    {/* "stopped" is the reader's own Stop or an interrupt, in amber: nothing
                      * went wrong, so it is not painted as a failure. */}
                    <span className={
                      summary.status === 'failed'
                        ? 'text-red-600 dark:text-red-400'
                        : summary.status === 'stopped'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }>
                      {summary.status === 'failed' ? 'failed' : summary.status === 'stopped' ? 'stopped' : 'finished'}
                      {summary.finishedAt && ` ${formatSubagentFinishTime(summary.finishedAt)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismiss(id)}
                      aria-label="Dismiss this agent from the pinned strip"
                      title="Dismiss"
                      className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
              {/* The second line: what it is doing on the left, what it has spent on the right.
                * The figures sit apart from the status chip so a row's header keeps one shape
                * whether the agent is running or done, and they stay legible on a phone where
                * the header line has no room left. */}
              {(latest || tokens) && (
                <div className="flex items-baseline gap-2 pl-5 text-[11px] text-muted-foreground/80">
                  {latest && (
                    <span className="min-w-0 flex-1 truncate font-mono" title={latest}>
                      {latest}
                    </span>
                  )}
                  {tokens && (
                    <span
                      className="ml-auto flex-shrink-0 tabular-nums"
                      title={tokens.long}
                      data-testid="pinned-subagent-tokens"
                    >
                      {tokens.short}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Memoized: the pane re-renders on every streamed row and this strip only moves when an agent starts, works, finishes or is dismissed. */
export default memo(PinnedSubagents);
