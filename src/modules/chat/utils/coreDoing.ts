import { getToolConfig } from '@/modules/chat/tools';
import type { ChatMessage } from '@/shared/types';

/** What a chat is doing while its turn runs, as its core shows it: its reply arriving, a read, a change, or thought. */
export type CoreDoing = 'thinking' | 'reading' | 'writing' | 'speaking';

/** The tools that only read: a file, a search of files or of the web, a list it keeps. */
const READS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoRead', 'TaskList', 'TaskGet']);

/** The tools that send an agent out. Sent out, a helper is the chat's writing to something else: the core reaches for it. */
const SENDS: ReadonlySet<string> = new Set(['Agent', 'Task']);

/**
 * WHAT THE CHAT IS DOING NOW, read off the end of its transcript while a turn runs, for the form its core takes (`ChatCore`):
 *
 * - its reply is arriving: `speaking`;
 * - a tool is out and has not answered: `reading` for a tool that only reads (`READS`), `writing` for one that changes a file (a
 *   tool the chat draws as a diff: Edit, Write, a patch) or sends an agent out (`SENDS`), and `thinking` for anything else (a
 *   command, a tool of a server's, one this build does not know);
 * - otherwise it is `thinking`: the turn has begun and nothing has come of it yet, or a tool has just answered.
 *
 * It reads the last message alone, so it costs nothing as the transcript grows. Called by `ChatInterface` for the composer's core;
 * what it says is used only while the turn runs.
 */
export function coreDoingOf(messages: readonly ChatMessage[]): CoreDoing {
  const last = messages[messages.length - 1];
  if (!last) return 'thinking';
  if (last.isToolUse) {
    // A tool that has answered is behind it: it is thinking about what came back.
    if (last.toolResult) return 'thinking';
    const name = last.toolName ?? '';
    if (READS.has(name)) return 'reading';
    if (SENDS.has(name) || getToolConfig(name).input.contentType === 'diff') return 'writing';
    return 'thinking';
  }
  if (last.type === 'assistant' && last.isStreaming && !last.isThinking) return 'speaking';
  return 'thinking';
}
