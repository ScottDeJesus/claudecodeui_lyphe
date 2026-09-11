import type { ChatMessage, ToolGroupItem } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

export const TOOL_GROUP_THRESHOLD = 2;

/** How many of a group's tool inputs the collapsed summary line spells out. */
const PREVIEWED_TOOL_COUNT = 2;


export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

// A question row stands alone: while the run waits on it, it carries the live answer panel
// (QuestionAnswerContent), and a collapsed group would hide the only way to answer.
function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  return Boolean(
    message.isToolUse && message.toolName && message.toolName !== 'AskUserQuestion' && !message.isSubagentContainer,
  );
}

// Messages that render nothing (e.g. reasoning hidden when showThinking is off)
// shouldn't split an otherwise-continuous run of the same tool — providers like
// Codex interleave hidden reasoning between consecutive tool calls.
function rendersNothing(message: ChatMessage, showThinking: boolean): boolean {
  return Boolean(message.isThinking && !showThinking);
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const rawValue = config.getValue?.(parsedInput);
  // A file is named by its basename, as its own row names it.
  const value = config.action === 'open-file' && typeof rawValue === 'string'
    ? rawValue.split('/').pop()
    : rawValue;
  // A shell run is previewed by what it is doing, not by its command line.
  const headline = config.style === 'terminal' ? config.getSecondary?.(parsedInput) : undefined;

  return String(headline || value || title || message.displayText || message.content || '').trim();
}

/**
 * Builds the collapsed group's summary line.
 *
 * Computed here rather than in the component so it happens once per grouping
 * pass instead of once per group render. It is not cached beyond that: grouping
 * re-runs on every 100ms stream tick because visibleMessages is a fresh array,
 * and a run's preview changes as the run grows, so a cache would have to be
 * keyed on the whole run. Measured at 0.18ms per tick over a 100-message window,
 * which is a seventh of what the store's own per-tick merge costs — not worth
 * the staleness risk.
 */
function buildGroupPreview(messages: ChatMessage[]): string {
  const named = messages
    .slice(0, PREVIEWED_TOOL_COUNT)
    .map(getToolInputPreview)
    .filter(Boolean);

  const previewText = named.join(', ');
  // Subtracted from the previews actually printed, not from the two slots the
  // line reserves, so that named + extraCount === messages.length for every
  // input. A tool whose input yields no text — a Read with no file_path, an
  // input still arriving as partial JSON — is genuinely not named, so it
  // belongs in the remainder. Counting slots instead makes a group of three
  // whose first preview is empty render "/b.ts, +1 more" beside an x3 badge.
  const extraCount = messages.length - named.length;

  if (!previewText) {
    return extraCount > 0 ? `+${extraCount} more` : '';
  }

  return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
}

export function groupConsecutiveTools(
  messages: ChatMessage[],
  showThinking: boolean = true,
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (!isGroupableToolMessage(message)) {
      items.push(message);
      index += 1;
      continue;
    }

    const run: ChatMessage[] = [message];
    let nextIndex = index + 1;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      // Skip invisible interleaved messages so they don't break the run.
      if (rendersNothing(candidate, showThinking)) {
        nextIndex += 1;
        continue;
      }

      if (isGroupableToolMessage(candidate) && candidate.toolName === message.toolName) {
        run.push(candidate);
        nextIndex += 1;
        continue;
      }

      break;
    }

    if (run.length >= TOOL_GROUP_THRESHOLD) {
      items.push({
        _isGroup: true,
        toolName: message.toolName,
        messages: run,
        timestamp: message.timestamp,
        preview: buildGroupPreview(run),
      });
    } else {
      items.push(...run);
    }

    index = nextIndex;
  }

  return items;
}

/**
 * Returns true for a message that reads as the model's prose reply — not a
 * tool call, thinking, a task notification or the result it carried, a tool
 * result with nothing to attach to, or a synthetic placeholder the server
 * writes when a turn produced nothing ("No response requested.").
 */
export function isProseReply(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && !message.isToolUse
    && !message.isThinking
    && !message.isTaskNotification
    && !message.isTaskResult
    && !message.isOrphanToolResult
    && message.model !== '<synthetic>'
    && String(message.content || '').trim().length > 0;
}

/**
 * Picks, for every run (the messages between one user turn and the next),
 * the prose reply that closes it: the last reply before the next user turn.
 *
 * A turn is not `[tools…, reply]` but `text → tool → text → tool → text`, so
 * "the reply" is the final prose of the run, not any assistant message. The
 * trailing run — the one no user turn has followed yet — is only closed when
 * `isRunActive` is false: while the model is still working, its latest prose
 * is not the end of anything, and a stamp there would claim it was. Tool
 * calls after the last prose do not move the stamp; it marks the reply, not
 * the last of the work.
 */
export function collectRunTerminalReplies(
  items: MessageListItem[],
  isRunActive = false,
): Set<ChatMessage> {
  const terminal = new Set<ChatMessage>();
  let candidate: ChatMessage | null = null;
  for (const item of items) {
    if (isToolGroupItem(item)) {
      continue;
    }
    if (item.type === 'user') {
      if (candidate) {
        terminal.add(candidate);
      }
      candidate = null;
      continue;
    }
    if (isProseReply(item)) {
      candidate = item;
    }
  }
  if (candidate && !isRunActive) {
    terminal.add(candidate);
  }
  return terminal;
}
