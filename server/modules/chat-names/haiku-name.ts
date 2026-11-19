import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';

import { launchAccountEnv } from '@/modules/providers/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { countWords, hasScriptWithoutSpaces, isSayableName } from '@/shared/sayable-name.js';
import type { ChatExchange, ChatLabelVerdict } from '@/shared/types.js';
import { errorReason } from '@/shared/utils.js';

/**
 * The naming pass's model calls, shaped like the Cerberus summary audit (`cerberus/diagnosis/diagnosis-audit.ts`): two questions over
 * one `query()`, each with its own system prompt, no tools, no settings, no session of its own and one turn, on Haiku. One names a
 * chat from its first exchange; the other keeps or renames its label from its latest exchange.
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

/**
 * Leans to KEEP: a label that moves at every turn is one he cannot find again, and the operator asked that it change only when the
 * topic does. It is asked only about a label a pass already gave; a placeholder (the opening words, or a name that cannot be said
 * aloud) is decided by the namer from data and named with `NAMING_SYSTEM_PROMPT`, since Haiku at low effort kept such labels.
 */
const RELABEL_SYSTEM_PROMPT =
  'You keep the label of a chat session for a person who refers to it aloud. You are given the chat\'s current label, the first message of the chat, and its latest exchange. Answer with the single word KEEP unless the subject of the chat has clearly moved to something the current label does not cover. Never rename for a rewording, a sharper phrasing or a sub-step of the same subject; when in doubt, answer KEEP. When you do rename, answer with a name of two to four plain words saying what the chat is about now, the way a person would call it in conversation, for example Kanban board, Login fix, Estimate drafts. No punctuation, no quotes, no emoji, no file names, no paths, no slash commands. Reply with KEEP or the name only.';

/** Low effort, as the operator asked: a keep-or-rename answer needs no deliberation, and this question runs at every turn. */
const RELABEL_EFFORT: EffortLevel = 'low';

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
 * Whether Haiku's reply is KEEP. KEEP is one word, which `cleanedName` refuses, so it is read here first, with the same outer quotes
 * and trailing punctuation dropped.
 */
function isKeep(reply: string): boolean {
  let word = reply.trim();
  let previous: string;
  do {
    previous = word;
    word = word.replace(QUOTE_MARKS, '').replace(TRAILING_PUNCTUATION, '').trim();
  } while (word !== previous);
  return word.toLowerCase() === 'keep';
}

/**
 * Asks Haiku to name a chat from its first exchange: the cleaned, checked name (two to four words a person could say aloud), or null
 * when it cannot — the SDK fails, 30 seconds pass, `signal` fires, the session holds a tool, or the answer fails the check. Each of
 * those logs one "[Chat names]" line and writes nothing; the namer treats null as "leave the name as it is". Never rejects.
 *
 * Consumers: `chat-namer.service.ts`: for a chat created before the namer's cutoff, once per chat per process; for one created at or
 * after it, at every turn while its label is still a placeholder.
 */
export async function askHaikuForName(exchange: ChatExchange, signal: AbortSignal): Promise<string | null> {
  const reply = await askHaiku(
    { prompt: `FIRST MESSAGE:\n${exchange.ask}\n\nFIRST REPLY:\n${exchange.reply}`, systemPrompt: NAMING_SYSTEM_PROMPT },
    signal,
  );
  if (reply === null) return null;
  const name = cleanedName(reply);
  if (name === null) console.warn(`[Chat names] Haiku's answer is not a name a person could say (${JSON.stringify(reply.slice(0, 80))}); the chat keeps its name`);
  return name;
}

/**
 * Asks Haiku whether a chat keeps its current label, from its first message and its latest exchange: `keep`, `rename` with a checked
 * name, or null with one "[Chat names]" line when the SDK fails, 30 seconds pass, `signal` fires, the session holds a tool, or the
 * answer is neither KEEP nor a name. Never rejects; runs at low effort on Haiku. It does not compare a new name with the current one;
 * the namer does.
 *
 * Consumers: `chat-namer.service.ts`, for a chat created at or after its cutoff whose label a pass already gave, at every turn while
 * the name is not his.
 */
export async function askHaikuToKeepOrRename(
  currentName: string | null,
  first: ChatExchange,
  latest: ChatExchange,
  signal: AbortSignal,
): Promise<ChatLabelVerdict | null> {
  const reply = await askHaiku(
    {
      prompt: `CURRENT LABEL:\n${currentName ?? '(none)'}\n\nFIRST MESSAGE:\n${first.ask}\n\nLATEST MESSAGE:\n${latest.ask}\n\nLATEST REPLY:\n${latest.reply}`,
      systemPrompt: RELABEL_SYSTEM_PROMPT,
      effort: RELABEL_EFFORT,
    },
    signal,
  );
  if (reply === null) return null;
  if (isKeep(reply)) return { verdict: 'keep' };
  const name = cleanedName(reply);
  if (name === null) {
    console.warn(`[Chat names] Haiku's answer is not a name a person could say (${JSON.stringify(reply.slice(0, 80))}); the chat keeps its name`);
    return null;
  }
  return { verdict: 'rename', name };
}

/**
 * The one `query()` both questions share: Haiku's raw answer (`message.result`) on a good result, or null when the call fails, each
 * failure logged as a "[Chat names]" line. Each question checks its own answer; the call only asks and reports.
 */
async function askHaiku(request: { prompt: string; systemPrompt: string; effort?: EffortLevel }, signal: AbortSignal): Promise<string | null> {
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
      prompt: request.prompt,
      options: {
        model: 'haiku',
        systemPrompt: request.systemPrompt,
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
        ...(request.effort ? { effort: request.effort } : {}),
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
        return message.result;
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
