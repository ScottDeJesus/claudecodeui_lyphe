import { memo } from 'react';

import type { ChatMessage } from '@/shared/types';
import { usePinnedSubagentRows } from '@/modules/chat/hooks/usePinnedSubagentRows';
import PinnedAgentRow from '@/modules/chat/transcript/PinnedAgentRow';
import SoulLaunchPinRow from '@/modules/chat/transcript/SoulLaunchPinRow';

/**
 * The agents of this conversation, held above the transcript: the ones running now, and the ones
 * that finished until the reader dismisses them.
 *
 * A subagent's own row scrolls away the moment it starts working — the agent then streams nothing
 * into the main thread for minutes, so the one line saying it exists is the first thing to leave
 * the screen. This keeps it in view, with the newest thing it did or said and what it has spent so
 * far — its context window and what it has written, live, each request moving the figures (the
 * operator's ask of 2026-09-10: "live usage of tokens and token counts in the pinned subagents") —
 * and when it finishes the row STAYS, marked with its finish time, so the reader learns it ended
 * without having been there to see it. Only the reader's own dismissal removes a finished row (the
 * operator's ruling of 2026-09-10: "dismiss it when it unpins, not when it's done"); a dismissal is
 * remembered in this browser, so a reload does not bring the row back.
 *
 * TWO KINDS OF PIN SIT IN THIS ONE STRIP. An `Agent`-tool subagent is a row in the transcript; a
 * launcher soul started by `/dispatch` is a detached child that writes nothing here, so its pin is
 * joined in from the server's lane by launch id (`src/modules/dispatch-souls/`) against the ids
 * the transcript's own tool results name. They are sorted into ONE list, because the reader is
 * asking one question of the strip — what is working for me right now — and the answer would be a
 * lie if half of it were somewhere else. Only the drawing differs, and only in the mark: the agent
 * carries the robot, the soul carries the icon of the provider paying for it.
 *
 * It sits ABOVE THE CHAT BOX whenever the desktop chat gutters are not showing; while they show,
 * the same rows live in the gutter's Subagents widget and this strip is not drawn — `ChatInterface`
 * reads the gutter's claim and drops it before the composer ever sees it.
 *
 * The rows themselves are derived by `hooks/usePinnedSubagentRows.ts`, which the gutter's widget
 * reads too: this file is only the drawing and the memo boundary.
 */
type PinnedSubagentsProps = {
  messages: ChatMessage[];
  /**
   * The launch ids THIS conversation started, read off its own tool results by the session-state
   * hook. Passed in rather than scanned in the row hook because the scan has to be memoized against
   * a transcript that changes on every streamed token, and `messages` is the strip's memo key.
   */
  soulLaunchIds: string[];
};

function PinnedSubagents({ messages, soulLaunchIds }: PinnedSubagentsProps) {
  const { rows, dismiss } = usePinnedSubagentRows(messages, soulLaunchIds);

  if (rows.length === 0) {
    return null;
  }

  return (
    // `mb-8` leaves room for the activity tab, which floats above the input in that gap.
    <div className="mx-auto mb-8 w-full max-w-[54.25rem]" data-testid="pinned-subagents-strip">
      {/* Capped and scrollable: a fan-out of six agents is ordinary here, and at ~44px a row
        * an uncapped strip took a third of a phone's reading area for the whole run. */}
      <div className="scrollbar-thin flex max-h-44 flex-col gap-1 overflow-y-auto rounded-xl border border-purple-500/25 bg-popover/95 p-1.5 shadow-sm backdrop-blur-sm dark:border-purple-400/25">
        {rows.map((entry) =>
          entry.kind === 'agent' ? (
            <PinnedAgentRow
              key={entry.key}
              id={entry.id}
              latest={entry.latest}
              summary={entry.summary}
              onDismiss={dismiss}
            />
          ) : (
            <SoulLaunchPinRow key={entry.key} launch={entry.launch} onDismiss={dismiss} />
          ),
        )}
      </div>
    </div>
  );
}

/** Memoized: the pane re-renders on every streamed row and this strip only moves when an agent starts, works, finishes or is dismissed. */
export default memo(PinnedSubagents);
