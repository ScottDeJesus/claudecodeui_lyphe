import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, SubagentTranscriptTarget } from '@/shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { usePinnedSubagentRows } from '@/modules/chat/hooks/usePinnedSubagentRows';
import { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';
import { rowId, rowLabel, rowRunning } from '@/modules/chat/subagents/subagentRow';
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
 * launcher soul a session started by hand is a detached child that writes nothing here, so its pin is
 * joined in from the server's lane by launch id (`src/modules/dispatch-souls/`) against the ids
 * the transcript's own tool results name. They are sorted into ONE list, because the reader is
 * asking one question of the strip — what is working for me right now — and the answer would be a
 * lie if half of it were somewhere else. Both carry the logo of the provider they run on, centred
 * beside their two lines (an agent whose provider is unknown falls back to the robot); what tells a
 * soul from an agent is its name and its figures, not the mark.
 *
 * It sits ABOVE THE CHAT BOX whenever the desktop chat gutters are not showing; while they show,
 * the same rows live in the gutter's Subagents widget and this strip is not drawn — `ChatInterface`
 * reads the gutter's claim and drops it before the composer ever sees it.
 *
 * A PRESS OPENS THE ROW'S TRANSCRIPT, as it does in the gutter's widget — here in a dialog over the
 * chat, since the strip has no room of its own. The open row is tagged with the chat it was opened
 * in, so switching chats closes it rather than leaving another conversation's agent on screen (and
 * coming back reopens it, as the widget does). When the gutters claim the rows the strip unmounts,
 * dialog and all; the same rows then open from the widget.
 *
 * The rows themselves are derived by `hooks/usePinnedSubagentRows.ts`, which the gutter's widget
 * reads too: this file is only the drawing, the open dialog and the memo boundary.
 */
type PinnedSubagentsProps = {
  messages: ChatMessage[];
  /**
   * The launch ids THIS conversation started, read off its own tool results by the session-state
   * hook. Passed in rather than scanned in the row hook because the scan has to be memoized against
   * a transcript that changes on every streamed token, and `messages` is the strip's memo key.
   */
  soulLaunchIds: string[];
  /** The open chat, which a transcript is read through and which an open dialog belongs to. */
  sessionId: string | null;
};

/** The row whose transcript is open, tagged with the chat it was opened in. */
type OpenedTranscript = {
  sessionId: string | null;
  target: SubagentTranscriptTarget & { label: string };
};

function PinnedSubagents({ messages, soulLaunchIds, sessionId }: PinnedSubagentsProps) {
  const { t } = useTranslation();
  const { rows, dismiss } = usePinnedSubagentRows(messages, soulLaunchIds);
  const [opened, setOpened] = useState<OpenedTranscript | null>(null);

  const target = opened !== null && opened.sessionId === sessionId ? opened.target : null;
  // The open row can be gone (dismissed or aged out) while its dialog is up; then nothing is known
  // to still be running, and the transcript reads as a record.
  const openRow = target === null ? null : rows.find((row) => rowId(row) === target.id) ?? null;

  if (rows.length === 0 && target === null) {
    return null;
  }

  return (
    <>
      {rows.length > 0 ? (
    // `mb-8` leaves room for the activity tab, which floats above the input in that gap.
    <div className="mx-auto mb-8 w-full max-w-[54.25rem]" data-testid="pinned-subagents-strip">
      {/* Capped and scrollable: a fan-out of six agents is ordinary here, and at ~44px a row
        * an uncapped strip took a third of a phone's reading area for the whole run. */}
      <div className="scrollbar-thin flex max-h-44 flex-col gap-1 overflow-y-auto rounded-xl border border-purple-500/25 bg-popover/95 p-1.5 shadow-sm backdrop-blur-sm dark:border-purple-400/25">
        {rows.map((entry) => {
          const id = rowId(entry);
          const label = rowLabel(entry);
          const open = () => setOpened({ sessionId, target: { kind: entry.kind, id, label } });
          const openLabel = t('gutters.subagents.openRow', { name: label });
          return entry.kind === 'agent' ? (
            <PinnedAgentRow
              key={entry.key}
              id={entry.id}
              latest={entry.latest}
              summary={entry.summary}
              provider={entry.provider}
              onDismiss={dismiss}
              onOpen={open}
              openLabel={openLabel}
            />
          ) : (
            <SoulLaunchPinRow
              key={entry.key}
              launch={entry.launch}
              onDismiss={dismiss}
              onOpen={open}
              openLabel={openLabel}
            />
          );
        })}
      </div>
    </div>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(next) => !next && setOpened(null)}>
        <DialogContent
          data-testid="pinned-subagent-dialog"
          aria-label={target?.label || t('gutters.subagents.title')}
          className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border-border/80 p-0 shadow-2xl sm:w-[min(94vw,48rem)]"
        >
          {target !== null ? (
            <>
              <DialogTitle className="sr-only">{target.label}</DialogTitle>
              {/* No top padding: a sticky header sticks inside the scroller's padding, and the transcript would show through the gap above it. */}
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <SubagentTranscriptView
                  sessionId={sessionId}
                  target={target}
                  label={target.label}
                  running={openRow !== null && rowRunning(openRow)}
                  onBack={() => setOpened(null)}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Memoized: the pane re-renders on every streamed row and this strip only moves when an agent starts, works, finishes or is dismissed. */
export default memo(PinnedSubagents);
