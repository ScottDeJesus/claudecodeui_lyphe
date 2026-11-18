import { sessionsService } from '@/modules/providers/index.js';
import type { ChatFirstExchange, NormalizedMessage } from '@/shared/types.js';

/** How much of each side the naming pass keeps: a name needs the subject, and Haiku is paid by the token. */
const MOST_CHARACTERS_PER_SIDE = 2_000;

/** Wrappers a harness puts in a user turn that no person typed; the history reader hides most of them, and a survivor must not name a chat. */
const INJECTED_USER_PREFIXES = ['<system-reminder>', '<task-notification>'] as const;

/** `text` cut to the ceiling without splitting a surrogate pair (an emoji cut in half is not a character). */
function cutToCeiling(text: string): string {
  const cut = text.slice(0, MOST_CHARACTERS_PER_SIDE);
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < text.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A user `text` row he wrote himself: a tool result is another kind, a compaction summary and a command's stdout are assistant-side rows, and an injected wrapper is dropped here. */
function isHisOwnMessage(message: NormalizedMessage): boolean {
  if (message.kind !== 'text' || message.role !== 'user') return false;
  const text = (message.content ?? '').trim();
  return text !== '' && !INJECTED_USER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/**
 * An assistant `text` row that answers: not a compaction summary, not a local command's output, and not the CLI's `<synthetic>` row
 * (an API error, a rate-limit refusal, "No response requested") — those say nothing about what the chat is about.
 */
function isAnswer(message: NormalizedMessage): boolean {
  if (message.kind !== 'text' || message.role !== 'assistant') return false;
  if (message.isCompactSummary === true || message.isLocalCommandStdout === true || message.model === '<synthetic>') return false;
  return (message.content ?? '').trim() !== '';
}

/**
 * The chat's first exchange: the first message he wrote himself and the first answer after it, each cut to 2,000 characters; `null` when
 * the transcript holds no such pair yet (a chat still on its first turn, or one made only of commands). A slash command he typed is his
 * own message, so `/review` followed by the model's answer reads as an exchange.
 *
 * It reads through `sessionsService.fetchHistory` — the transcript store the chat itself reads, with its cache — so a name is drawn from
 * the same rows the person sees. Rejects when the chat is gone or its transcript cannot be read; the namer logs and moves on.
 *
 * Consumers: `chat-namer.service.ts`, which hands the pair to `askHaikuForName`.
 */
export async function readFirstExchange(sessionId: string): Promise<ChatFirstExchange | null> {
  const history = await sessionsService.fetchHistory(sessionId, { limit: null });
  const askIndex = history.messages.findIndex(isHisOwnMessage);
  if (askIndex === -1) return null;
  const reply = history.messages.slice(askIndex + 1).find(isAnswer);
  if (!reply) return null;
  return {
    ask: cutToCeiling((history.messages[askIndex].content ?? '').trim()),
    reply: cutToCeiling((reply.content ?? '').trim()),
  };
}
