import { memo } from 'react';
import { Bot } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import { readSubagentSummary } from '@/modules/chat/utils/subagentSummary';

/**
 * The agents running right now, held above the transcript while they run.
 *
 * A subagent's own row scrolls away the moment it starts working — the agent then streams
 * nothing into the main thread for minutes, so the one line saying it exists is the first
 * thing to leave the screen. This keeps it in view until it finishes, and then lets it go:
 * a finished agent belongs back in the timeline where it happened, with the time it ended.
 *
 * It is `sticky`, not `fixed` or an overlay, so it takes part in the scroller's flow and the
 * messages start below it rather than under it.
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

function PinnedSubagents({ messages }: PinnedSubagentsProps) {
  const now = Date.now();
  const running = messages
    .filter((message) => message.isSubagentContainer)
    .map((message) => ({
      id: String(message.toolId ?? ''),
      startedAt: new Date(message.timestamp).getTime(),
      summary: readSubagentSummary({
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        toolResultAt: message.toolResultAt as string | number | Date | undefined,
        subagent: message.subagent,
        activity: message.subagentActivity,
      }),
    }))
    .filter((entry) => entry.summary.status === 'running')
    .filter((entry) => !Number.isFinite(entry.startedAt) || now - entry.startedAt < RUNNING_BELIEVED_FOR_MS);

  if (running.length === 0) {
    return null;
  }

  return (
    // `pr-14` keeps the strip clear of the export button, which is its own sticky corner.
    <div className="sticky top-0 z-20 mx-auto mb-2 w-full max-w-[54.25rem] px-4 pr-14 sm:pr-4">
      {/* Capped and scrollable: a fan-out of six agents is ordinary here, and at ~25px a row
        * an uncapped strip took a third of a phone's reading area for the whole run. */}
      <div className="scrollbar-thin flex max-h-[9rem] flex-col gap-1 overflow-y-auto rounded-xl border border-purple-500/25 bg-popover/95 p-1.5 shadow-sm backdrop-blur-sm dark:border-purple-400/25">
        {running.map(({ id, summary }) => (
          <div
            key={id}
            // Square on the left, rounded on the right: a rounded corner under a 2px left
            // border draws it as an arc, which reads as a stray mark rather than a rule.
            className="flex items-center gap-1.5 rounded-r-lg border-l-2 border-l-purple-500 px-2 py-1 text-xs text-muted-foreground dark:border-l-purple-400"
          >
            <Bot className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 dark:text-purple-400" />
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
            {/* "running" ALWAYS, with the count beside it rather than instead of it: a bare
              * "4 tools" is precisely the panel's finished label, so the pin read as a summary
              * of something already over the moment its first tool landed. */}
            <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-600 dark:text-purple-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
              running
              {summary.toolCount > 0 && (
                <span className="text-muted-foreground/70">
                  · {summary.toolCount} {summary.toolCount === 1 ? 'tool' : 'tools'}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Memoized: the pane re-renders on every streamed row and this strip only moves when an agent starts, works or finishes. */
export default memo(PinnedSubagents);
