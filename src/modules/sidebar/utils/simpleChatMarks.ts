import type { SimpleChatMark } from '@/shared/types';

/**
 * The marks rule in its one home: which of the four marks one chat draws, and which single mark a
 * folder's dot wears.
 *
 * Read by `SidebarSimpleListRow` and `SidebarSessionPickerRow` — the app's two drawings of a chat,
 * which must agree on every ink — and by `SidebarSimpleListItems` for a folder's one dot.
 */

/**
 * The precedence a mark is picked by when one has to stand for several: the folder's single dot
 * wears the first of these that any of its chats carries, so a question waiting outranks everything
 * and a reply not read outranks a run.
 */
const MARK_PRECEDENCE: readonly SimpleChatMark[] = ['awaitingInput', 'unread', 'running', 'subagents'];

/** Which of its four marks one chat draws: the one written form of the rule. */
export function chatMarks(facts: {
  unread: boolean;
  isSelected: boolean;
  isRunning: boolean;
  isAwaitingInput: boolean;
  isSubagentRunning: boolean;
}): Record<SimpleChatMark, boolean> {
  return {
    // A question, or a permission prompt, waits on the reader: it is drawn whether or not the chat
    // is on screen, because it outlives the turn that asked it.
    awaitingInput: facts.isAwaitingInput,
    // A reply that arrived while the chat was out of sight. Never drawn beside a run or a question:
    // both of those mean a turn is still on, and the reader has nothing new to pick up.
    unread: facts.unread && !facts.isSelected && !facts.isRunning && !facts.isAwaitingInput,
    // The chat's own turn. A question replaces the spinner: the turn is waiting on the reader.
    running: facts.isRunning && !facts.isAwaitingInput,
    // Beside whichever mark above applies, never instead of one: a subagent often outlives the turn.
    subagents: facts.isSubagentRunning,
  };
}

/** The most pressing mark any of a folder's chats draws, which is what its one dot wears. Null when none draws any. */
export function folderDot(marks: Record<SimpleChatMark, boolean>[]): SimpleChatMark | null {
  for (const mark of MARK_PRECEDENCE) {
    if (marks.some((entry) => entry[mark])) return mark;
  }
  return null;
}
