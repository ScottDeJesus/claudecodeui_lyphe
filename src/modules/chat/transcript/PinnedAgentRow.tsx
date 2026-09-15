import { memo, type KeyboardEvent } from 'react';
import { Bot, X } from 'lucide-react';

import { describeSubagentUsage, formatSubagentFinishTime, type SubagentSummary } from '@/modules/chat/utils/subagentSummary';

/**
 * One `Agent`-tool subagent as a row.
 *
 * Read by the chat module's pinned strip (`PinnedSubagents.tsx`), which draws it above the chat box
 * when the desktop gutters are not showing, and by `subagents/SubagentWidgetBody.tsx`, the gutter's
 * Subagents widget, which draws the same rows while they are.
 *
 * Extracted verbatim from the strip that used to draw it inline (`PinnedSubagents.tsx`), when that
 * strip grew a SECOND kind of pin beside it. The move is pure: same markup, same classes, same
 * `data-testid`, so anything reading this row sees what it saw before. It is a component now
 * because the strip's job became sorting two kinds of row into one list, and a row's own drawing
 * is not that job.
 */

type PinnedAgentRowProps = {
  id: string;
  latest: string;
  summary: SubagentSummary;
  onDismiss: (id: string) => void;
  /**
   * Opens this row's transcript. Optional: the strip above the chat box has nowhere to open it TO,
   * while the gutter's Subagents widget does, so the strip passes nothing and the row is what it
   * always was. Given, the row becomes a button — mouse and keyboard both.
   */
  onOpen?: () => void;
  /** What the row announces as a button, naming which agent it opens. */
  openLabel?: string;
};

function PinnedAgentRow({ id, latest, summary, onDismiss, onOpen, openLabel }: PinnedAgentRowProps) {
  const running = summary.status === 'running';
  const tokens = describeSubagentUsage(summary.usage);

  // Spread onto the root only when the row opens something. Every value is `undefined` without
  // `onOpen`, so React omits the attributes and the drawn row is byte-identical to the strip's.
  const openProps = {
    role: onOpen ? ('button' as const) : undefined,
    tabIndex: onOpen ? 0 : undefined,
    'aria-label': openLabel,
    onClick: onOpen,
    onKeyDown: onOpen
      ? (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen();
        }
      : undefined,
  };

  return (
    <div
      {...openProps}
      data-testid="pinned-subagent-row"
      data-status={summary.status}
      data-tool-id={id}
      // Square on the left, rounded on the right: a rounded corner under a 2px left border draws it
      // as an arc, which reads as a stray mark rather than a rule.
      className={`flex flex-col gap-0.5 rounded-r-lg border-l-2 px-2 py-1 text-xs ${onOpen ? 'cursor-pointer ' : ''}${
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
          // "running" ALWAYS, with the count beside it rather than instead of it: a bare "4 tools"
          // is precisely the panel's finished label, so the pin read as a summary of something
          // already over the moment its first tool landed.
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
            {/* "stopped" is the reader's own Stop or an interrupt, in amber: nothing went wrong, so
             * it is not painted as a failure. */}
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
              data-testid="pinned-row-dismiss"
              // The row itself may be a button; dismissing must not also open the transcript.
              onClick={(event) => {
                event.stopPropagation();
                onDismiss(id);
              }}
              aria-label="Dismiss this agent from the pinned strip"
              title="Dismiss"
              className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {/* The second line: what it is doing on the left, what it has spent on the right. The figures
        * sit apart from the status chip so a row's header keeps one shape whether the agent is
        * running or done, and they stay legible on a phone where the header line has no room left. */}
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
}

export default memo(PinnedAgentRow);
