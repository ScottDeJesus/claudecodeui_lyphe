import { getToolConfig } from '@/modules/chat/tools';
import { shellDoingOf } from '@/modules/chat/utils/shellDoing';
import { parseToolInput } from '@/modules/chat/utils/toolGrouping';
import type { ChatMessage } from '@/shared/types';

/** What a chat is doing while its turn runs, as its core shows it: its reply arriving, a read, a change, or thought. */
export type CoreDoing = 'thinking' | 'reading' | 'writing' | 'speaking';

/** The tools that only read: a file, a search of files or of the web, a list it keeps. */
const READS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoRead', 'TaskList', 'TaskGet']);

/** The tools that send an agent out. Sent out, a helper is the chat's writing to something else: the core reaches for it. */
const SENDS: ReadonlySet<string> = new Set(['Agent', 'Task']);

/** What one tool call is doing: `reading`, `writing`, or `thinking` for a tool that neither reads nor writes files. */
function toolDoingOf(message: ChatMessage): CoreDoing {
  const name = message.toolName ?? '';
  if (READS.has(name)) return 'reading';
  const config = getToolConfig(name).input;
  if (SENDS.has(name) || config.contentType === 'diff') return 'writing';
  // A shell tool (the bulk of a turn's tools on this box) is judged by its command: a look at files reads, a change writes.
  if (config.style === 'terminal') {
    const command = config.getValue?.(parseToolInput(message.toolInput));
    if (typeof command === 'string') {
      const shell = shellDoingOf(command);
      if (shell !== 'running') return shell;
    }
  }
  return 'thinking';
}

/**
 * WHAT THE CHAT IS DOING NOW, read off the end of its transcript while a turn runs, for the form its core takes (`ChatCore`):
 *
 * - its reply is arriving: `speaking`;
 * - its last step is a tool call: `reading` for one that only reads (`READS`, or a shell command that only looks at files),
 *   `writing` for one that changes a file (a tool the chat draws as a diff, a shell command that writes) or sends an agent out
 *   (`SENDS`), and `thinking` for anything else (a program run, a tool of a server's, one this build does not know);
 * - otherwise it is `thinking`: the turn has begun and nothing has come of it yet, or its thought or words came last.
 *
 * A tool call's form holds after it answers, until the chat's next step lands: a read or an edit is out for a fifth of a second
 * (the median on this box), shorter than the form takes to open, while the chat works through what it read or wrote for seconds
 * after. Keyed to the call alone, the core never visibly read or wrote.
 *
 * It reads the last message alone, so it costs nothing as the transcript grows. Called by `ChatInterface` for the composer's core;
 * what it says is used only while the turn runs.
 */
export function coreDoingOf(messages: readonly ChatMessage[]): CoreDoing {
  const last = messages[messages.length - 1];
  if (!last) return 'thinking';
  if (last.isToolUse) return toolDoingOf(last);
  if (last.type === 'assistant' && last.isStreaming && !last.isThinking) return 'speaking';
  return 'thinking';
}
