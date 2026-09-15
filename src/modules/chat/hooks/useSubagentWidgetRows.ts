import type { ChatMessage } from '@/shared/types';
import { usePinnedSubagentRows, type PinnedSubagentRow } from '@/modules/chat/hooks/usePinnedSubagentRows';
import { useSubagentSource } from '@/modules/chat/subagents/subagentSource';

/**
 * The empty stand-ins a widget with no chat reads. Module-level and never written, because the row
 * hook re-derives on the identity of what it is handed: a fresh `[]` per render would be a new
 * array every time, and the rows would be rebuilt on every frame the gutter draws.
 */
const NO_AGENT_MESSAGES: ChatMessage[] = [];
const NO_SOUL_LAUNCH_IDS: string[] = [];

/**
 * The pinned rows of whichever chat this widget is showing, and the reader's act on them.
 *
 * The rows are the STRIP'S OWN, not a second derivation: the chat publishes its source
 * (`subagents/subagentSource.ts`) and this hook hands exactly those arrays to
 * `usePinnedSubagentRows`, the same call `transcript/PinnedSubagents.tsx` makes. The two surfaces
 * therefore agree row for row — same elements, same order, same windows — which is the point:
 * they are two drawings of one answer to "what is working for me right now", and a widget that
 * re-derived its own list could only ever disagree with the strip.
 *
 * A source tagged with another chat, or none at all (a gutter with no chat open), is `null`, and
 * the shared empties above yield no rows rather than the last chat's.
 *
 * Called by the chat-gutters module (`ChatGutterLayout.tsx`, whose Subagents widget body draws the
 * rows) and by `subagents/SubagentWidgetBody.tsx` beneath it.
 */
export function useSubagentWidgetRows(
  sessionId: string | null,
): { rows: PinnedSubagentRow[]; dismiss: (id: string) => void } {
  const source = useSubagentSource(sessionId);
  return usePinnedSubagentRows(
    source?.agentMessages ?? NO_AGENT_MESSAGES,
    source?.soulLaunchIds ?? NO_SOUL_LAUNCH_IDS,
  );
}

/**
 * How many rows this widget holds, for the count beside the Subagents tab. It is the very same
 * derivation the list draws — deliberately, since a count computed another way is a second opinion
 * the tab and the list could disagree on.
 *
 * Called by the chat-gutters module (`ChatGutterLayout.tsx`).
 */
export function useSubagentWidgetCount(sessionId: string | null): number {
  return useSubagentWidgetRows(sessionId).rows.length;
}
