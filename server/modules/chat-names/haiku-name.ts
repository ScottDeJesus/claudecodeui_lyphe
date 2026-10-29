import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { launchAccountEnv } from '@/modules/providers/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { countWords, hasScriptWithoutSpaces, isSayableName } from '@/shared/sayable-name.js';
import type { ChatFirstExchange } from '@/shared/types.js';
import { errorReason } from '@/shared/utils.js';

/**
 * The naming pass's one model call, shaped like the Cerberus summary audit (`cerberus/diagnosis/diagnosis-audit.ts`): a single
 * `query()` with its own system prompt, no tools, no settings, no session of its own and one turn, on Haiku.
 *
 * WHY HAIKU, AND WHY NOTHING IS TRUSTED. A name is two to four words; the cheapest model reads a first message and a first reply well
 * enough to say what a chat is about. What it answers is cleaned and CHECKED before anything is written (`cleanedName`): a reply that
 * is not two to four words, or that a person could not say aloud, is no name at all, and the chat keeps what it has.
 *
 * IT NEVER BECOMES A CHAT. `persistSession: false` writes no transcript, and the hidden working directory
 * (`~/.claude/state/chat-names`, under a hidden project root) keeps even a stray launch out of every project list.
 */

/** How long Haiku has before the chat is left as it is; the pass runs in the background, so this only bounds a stuck process. */
const NAMING_TIMEOUT_MS = 30_000;

const FEWEST_NAME_WORDS = 2;
const MOST_NAME_WORDS = 4;
/**
 * A name in a script without spaces may stand one over `MOST_NAME_WORDS`: `countWords` counts such a name by dictionary pieces, and the
 * dictionary divides finer than a reader hears (measured 2026-10-28, 22 Haiku answers to Japanese, Chinese and Thai chats: "数据库连接排查",
 * three words to a reader, counts 5 — "数据|库|连接|排|查" — and was refused at a ceiling of 4; the names of three to four words count 3 to 4).
 */
const SEGMENT_COUNT_OVERRUN = 1;

const NAMING_SYSTEM_PROMPT =
  'You name a chat session for a person who refers to it aloud. Read the session\'s first message and first reply, and answer with a name of two to four plain words saying what the chat is about, the way a person would call it in conversation, for example Kanban board, Login fix, Estimate drafts. No punctuation, no quotes, no emoji, no file names, no paths, no slash commands. Reply with the name only.';

/** Quote marks a model wraps a name in, straight and curly. */
const QUOTE_MARKS = /^["'`“”‘’]+|["'`“”‘’]+$/g;
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/;

/** `~/.claude/state/chat-names`, made if absent: a hidden root the naming session is launched in and reads nothing from. */
function namingWorkingDirectory(): string {
  const directory = path.join(os.homedir(), '.claude', 'state', 'chat-names');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Haiku's reply as a name, or null when it is not one. The prompt asks for the name alone, one line, no emoji: a reply of several lines
 * (two lines stitched by the space collapse would read as one longer name) or holding an emoji is refused. Outer quotes and trailing
 * punctuation are dropped (repeatedly, so a quoted name with a full stop either side of the quote goes the same way), spaces collapse,
 * the first letter is capitalized, and the result must be two to four words (`countWords`: a reply in a script written without spaces is
 * counted by its dictionary pieces, not as one word, and may stand one piece over) that pass `isSayableName`.
 */
function cleanedName(reply: string): string | null {
  const trimmed = reply.trim();
  if (/[\r\n]/.test(trimmed) || /\p{Extended_Pictographic}/u.test(trimmed)) return null;
  let name = trimmed.replace(/\s+/g, ' ');
  let previous: string;
  do {
    previous = name;
    name = name.replace(QUOTE_MARKS, '').replace(TRAILING_PUNCTUATION, '').trim();
  } while (name !== previous);
  name = name.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
  const words = countWords(name);
  const mostWords = hasScriptWithoutSpaces(name) ? MOST_NAME_WORDS + SEGMENT_COUNT_OVERRUN : MOST_NAME_WORDS;
  if (words < FEWEST_NAME_WORDS || words > mostWords) return null;
  return isSayableName(name) ? name : null;
}

/**
 * Asks Haiku to name a chat from its first exchange: the cleaned, checked name (two to four words a person could say aloud), or null
 * when it cannot — the SDK fails, 30 seconds pass, `signal` fires, the session holds a tool, or the answer fails the check. Each of
 * those logs one "[Chat names]" line and writes nothing; the namer treats null as "leave the name as it is". Never rejects.
 *
 * Consumers: `chat-namer.service.ts`, once per chat per attempt, with a signal that ends with the namer's `stop()`.
 */
export async function askHaikuForName(exchange: ChatFirstExchange, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null;
  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NAMING_TIMEOUT_MS);
  const followNamer = (): void => abortController.abort();
  const stoppedBecause = (): string | null => {
    if (timedOut) return `Haiku did not answer within ${NAMING_TIMEOUT_MS / 1000} seconds`;
    return signal.aborted ? 'the naming pass was stopped before Haiku answered' : null;
  };
  signal.addEventListener('abort', followNamer, { once: true });
  try {
    const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    // The naming pass is a Claude launch too: it starts on the account the house chose. The door cannot throw
    // (one that cannot answer yields no environment), so the pass's own bound is unaffected.
    const account = await launchAccountEnv();
    const conversation = query({
      prompt: `FIRST MESSAGE:\n${exchange.ask}\n\nFIRST REPLY:\n${exchange.reply}`,
      options: {
        model: 'haiku',
        systemPrompt: NAMING_SYSTEM_PROMPT,
        tools: [],
        strictMcpConfig: true,
        settingSources: [],
        // The operator's auto-memory is keyed to the git root of the cwd; this launch must read and write none of it.
        settings: { autoMemoryEnabled: false },
        persistSession: false,
        cwd: namingWorkingDirectory(),
        maxTurns: 1,
        abortController,
        env: { ...userFacingEnv(), ...account.env },
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    try {
      for await (const message of conversation) {
        // The options are a promise; the CLI's own tool list in its init message is the check.
        if (message.type === 'system' && message.subtype === 'init' && message.tools.length > 0) {
          console.warn(`[Chat names] the naming session held tools (${message.tools.join(', ')}); it was not run and the chat keeps its name`);
          return null;
        }
        if (message.type !== 'result') continue;
        // A turn that ended on an API error arrives as subtype 'success' with `is_error` true and the error text in `result`
        // ("Prompt is too long", "Connection error"): that text is no answer, and a short one would pass the name check.
        if (message.subtype !== 'success' || message.is_error) break;
        const name = cleanedName(message.result);
        if (name === null) console.warn(`[Chat names] Haiku's answer is not a name a person could say (${JSON.stringify(message.result.slice(0, 80))}); the chat keeps its name`);
        return name;
      }
    } finally {
      conversation.close();
    }
    // An abort ends the stream quietly or throws, depending on where it lands; both are told by what stopped it.
    console.warn(`[Chat names] ${stoppedBecause() ?? 'the naming session ended without an answer'}; the chat keeps its name`);
    return null;
  } catch (error) {
    console.warn(`[Chat names] ${stoppedBecause() ?? `the naming session could not run (${errorReason(error)})`}; the chat keeps its name`);
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', followNamer);
  }
}
