import { memo, type KeyboardEvent } from 'react';
import { Bot, X } from 'lucide-react';

import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { describeSubagentUsage, formatSubagentFinishTime, type SubagentMarkProvider, type SubagentSummary } from '@/modules/chat/utils/subagentSummary';

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
  /** The provider it ran on: its mark is the row's, Claude's being the mascot the chat draws. The robot stands in only when none is known. */
  provider?: SubagentMarkProvider;
  /** The name a person calls the model it runs on (`Opus 5.5`), drawn after the agent's name. Absent while its record names no model, or one nothing names. */
  modelLabel?: string | null;
  onDismiss: (id: string) => void;
  /** Opens this row's transcript — in place in the gutter's widget, in a dialog from the strip. */
  onOpen: () => void;
  /** What the row announces as a button, naming which agent it opens. */
  openLabel: string;
};

function PinnedAgentRow({ id, latest, summary, provider, modelLabel, onDismiss, onOpen, openLabel }: PinnedAgentRowProps) {
  const running = summary.status === 'running';
  const tokens = describeSubagentUsage(summary.usage);
  // How far a running agent has got. Beside the status on a wide card; on a phone, where the status chip leaves the
  // header, on the second line with the figures (below).
  const toolCountText = running && summary.toolCount > 0 ? `${summary.toolCount} ${summary.toolCount === 1 ? 'tool' : 'tools'}` : '';

  // The row is a button, mouse and keyboard both. A key pressed on the dismiss X inside it bubbles
  // here too; only a key on the row itself opens it, so Enter on the X still dismisses.
  const openProps = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': openLabel,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen();
    },
  };

  return (
    <div
      {...openProps}
      data-testid="pinned-subagent-row"
      data-status={summary.status}
      data-tool-id={id}
      data-provider={provider}
      // The mark sits beside BOTH lines, centred on the row's height; the lines stack to its right.
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground"
    >
      {/* Defensive: every normalized message carries a provider today. Keep the branch —
        * `LLMProviderLogo` defaults to Claude, so passing an unknown provider straight in would
        * dress it in Claude's mark instead of the neutral robot. */}
      {provider ? (
        // The mascot for Claude, as the chat's own assistant turns wear it: this row is the same
        // agent at work, drawn again while it runs.
        <LLMProviderLogo provider={provider} claudeMark="mascot" className="h-4 w-4 flex-shrink-0" />
      ) : (
        <Bot className={`h-4 w-4 flex-shrink-0 ${running ? 'text-purple-500 dark:text-purple-400' : 'text-muted-foreground/70'}`} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Wraps rather than clips the description: it keeps a floor of `basis-40` (10rem), so on a phone,
          * where the name, the model and the status leave it less, it takes a line of its own beside the
          * status and reads in full. A wide card stays one line. The `/` is part of the description's own
          * flex item, so it wraps with the description and never hangs at the end of the line above. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="flex-shrink-0 font-medium text-foreground">{summary.label || 'Agent'}</span>
          {modelLabel && (
            <>
              <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">·</span>
              <span className="flex-shrink-0" data-testid="pinned-subagent-model">{modelLabel}</span>
            </>
          )}
          {summary.description && (
            <span className="flex min-w-0 shrink grow basis-40 items-center gap-1.5">
              <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
              <span className="min-w-0 flex-1 truncate">{summary.description}</span>
            </span>
          )}
          {summary.nickname && (
            <span className="flex-shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground/70">
              {summary.nickname}
            </span>
          )}
          {running ? (
            // "running" ALWAYS, with the count beside it rather than instead of it: a bare "4 tools"
            // is precisely the panel's finished label, so the pin read as a summary of something
            // already over the moment its first tool landed. On a phone the whole chip leaves the header
            // — the word and the count with it — and the pulsing dot, lit in its colour, says "running"
            // from the second line, where the count joins the figures. The description keeps the room
            // the chip took, and a lone dot never wraps onto a line of its own.
            <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-600 dark:text-purple-300 max-sm:hidden">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
              running
              {toolCountText && <span className="text-muted-foreground/70">· {toolCountText}</span>}
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
          * running or done, and they stay legible on a phone where the header line has no room left.
          * A running agent's pulsing dot leads the line and its tool count joins the figures on a phone
          * only (`sm:hidden`); a wide card shows both in the header chip, so a line holding nothing but
          * those two is not drawn there. */}
        {(latest || tokens || running) && (
          <div className={cn('flex items-baseline gap-2 text-[11px] text-muted-foreground/80', !latest && !tokens && 'sm:hidden')}>
            {running && (
              <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse self-center rounded-full bg-purple-500 dark:bg-purple-400 sm:hidden" />
            )}
            {latest && (
              <span className="min-w-0 flex-1 truncate font-mono" title={latest}>
                {latest}
              </span>
            )}
            {(toolCountText || tokens) && (
              // Without tokens it holds only the phone's count, so a wide card drops it (and its gap) altogether.
              <span className={cn('ml-auto flex flex-shrink-0 items-baseline gap-1.5 tabular-nums', !tokens && 'sm:hidden')}>
                {toolCountText && (
                  <span className="sm:hidden" data-testid="pinned-subagent-tool-count">
                    {tokens ? `${toolCountText} ·` : toolCountText}
                  </span>
                )}
                {tokens && (
                  <span title={tokens.long} data-testid="pinned-subagent-tokens">
                    {tokens.short}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PinnedAgentRow);
