import { summarizeTranscript } from '@/modules/compaction/index.js';
import type { CompanionLogEntry } from '@/shared/companion-types.js';

import { companionTranscriptPath } from './companion-launch.js';

/**
 * The handover of a conversation she is made to drop. When her tools or her prompt changed (`companion-shape.ts`), her held CLI
 * conversation is not resumed and she starts fresh; so that the fresh start is not a stranger, the summarizer reads the thread she
 * is leaving (her CLI transcript, `companionTranscriptPath`) and writes a few spoken lines of it, which her first message after the
 * start carries once as `<handover>` (`companion-envelopes.ts`, `companion-message.ts`). What the thread leaves out is hers by other
 * means: his unanswered messages, her focus, draft and walk, and her memory bank.
 *
 * THE SUMMARIZER is the house verb behind the chat compaction (`summarizeTranscript`, the compaction barrel). It is bent two ways
 * for this caller, which its comment explains: the NEWEST exchange is not in what it summarizes, so it is told in the instructions
 * (taken from her log, `lastWordsOf`); and a thread with one exchange only is refused by the verb ("nothing before it"), so that
 * thread, which IS its newest exchange, is handed over as that exchange alone, with no summarizer (`newestExchangeAlone`).
 * It is slow (7 to 30 s measured on her real threads), so the wait is bounded (`HANDOVER_WAIT_MS`): a handover that cannot be
 * written is a sentence on her panel and a journal line, and she starts fresh without it. Nothing of hers goes to CloudCLI's
 * database but the text on her row until a message carries it.
 *
 * Consumers: `session/companion-session.ts` (the refused resume), `companion-account.ts` (the log reader).
 */

/** How long a handover may take before she starts fresh without it. The verb is stopped at the limit. Consumed by this file only. */
const HANDOVER_WAIT_MS = 90_000;
/** The most characters of handover she is given: about eight short lines are 1,000, so this leaves room and keeps her reading short. */
const HANDOVER_MAX_CHARS = 2_000;
/** The most characters of either of the newest exchange's two sides that the instructions quote. */
const LAST_WORDS_MAX_CHARS = 500;

/** The newest exchange of her log, which the summarizer is not shown: what she answered, and what she answered it to (`null` when nothing precedes her turn). Consumed by `companion-account.ts` and `companion-session-types.ts`. */
export type LastWords = { before: { by: 'operator' | 'alert'; text: string } | null; reply: string };

/** What writing a handover came to: the text with the verb's model and tokens (`null` and 0 when no summarizer was needed), or the one sentence that says why there is none. */
type HandoverOutcome =
  | { kind: 'written'; text: string; model: string | null; tokensIn: number; tokensOut: number }
  | { kind: 'failed'; cause: string };

/**
 * `text` cut to at most `limit` characters at the end of a sentence (the last one that ends in the second half of the limit), else at a
 * word with an ellipsis: never in the middle of a word.
 */
function cutAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const ends = [...text.slice(0, limit + 1).matchAll(/[.!?](?=\s)/g)];
  const last = ends.at(-1);
  if (last !== undefined && last.index + 1 >= limit / 2) return text.slice(0, last.index + 1);
  const wordEnd = text.slice(0, limit + 1).search(/\s\S*$/);
  return `${text.slice(0, wordEnd > 0 ? wordEnd : limit).trimEnd()}…`;
}

/** The verb's summary as a handover: its `### ` headings dropped (the verb forbids them; a stray one would look like a transcript turn), blank runs folded, cut at a sentence. */
function tidyHandover(summary: string): string {
  const lines = summary.split('\n').filter((line) => !line.startsWith('### '));
  return cutAtSentence(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), HANDOVER_MAX_CHARS);
}

/**
 * Her newest exchange as her log holds it: the rows of her last turn (her sentences, joined) and the operator's or the house's row that
 * she answered (system lines between are skipped). `null` when she has said nothing. His unanswered messages, which are newer, are
 * not it: they come to her as the messages themselves. Consumed by `companion-account.ts`, which reads the log.
 */
export function lastWordsOf(log: readonly CompanionLogEntry[]): LastWords | null {
  let end = log.length - 1;
  while (end >= 0 && log[end].role !== 'kaylee') end -= 1;
  if (end < 0) return null;
  const turnId = log[end].turnId;
  let start = end;
  while (start > 0 && log[start - 1].role === 'kaylee' && log[start - 1].turnId === turnId) start -= 1;
  const reply = log.slice(start, end + 1).map((entry) => entry.text.trim()).join(' ');
  let before = start - 1;
  while (before >= 0 && log[before].role === 'system') before -= 1;
  const prompt = before >= 0 ? log[before] : null;
  const asked = prompt !== null && (prompt.role === 'operator' || prompt.role === 'alert') ? { by: prompt.role, text: prompt.text.trim() } : null;
  return { before: asked, reply };
}

/**
 * The handover of a thread that is only its newest exchange, which the summarizer cannot be asked about (it has nothing before it): that
 * exchange, in her second person, from her log. Short by construction (each side is cut at `LAST_WORDS_MAX_CHARS`).
 */
function newestExchangeAlone(operatorName: string, last: LastWords): string {
  const he = operatorName.trim() || 'the operator';
  const reply = cutAtSentence(last.reply, LAST_WORDS_MAX_CHARS);
  if (last.before === null) return `Before this fresh start you had only said: "${reply}"`;
  const said = last.before.by === 'alert' ? 'The house told you' : `${he} said`;
  return `Before this fresh start you and ${he} had only one exchange. ${said}: "${cutAtSentence(last.before.text, LAST_WORDS_MAX_CHARS)}" You answered: "${reply}"`;
}

/**
 * What the summarizer is asked, in her register: a handover she can speak from (about eight short spoken lines in the second person), in
 * the order of what she needs on waking, and the verb's usual five-section summary set aside. The newest exchange follows when her log
 * has one, because the verb does not show it. `operatorName` and `name` are the settings' (his and hers). The verb takes at most 8 KB.
 */
function handoverInstructions(operatorName: string, name: string, last: LastWords | null): string {
  const he = operatorName.trim() || 'the operator';
  const she = name.trim() || 'Kaylee';
  const lines = [
    `This is not a compaction of a coding chat. The conversation above is between ${he} (the User) and ${she}, his voice companion (the Assistant). ${she} is starting a new conversation and keeps nothing of this one except what you write now: write the handover she reads first thing, so she can pick the thread up by voice.`,
    '',
    `Write to her, in the second person ("you and ${he} were…"), in plain spoken words and short sentences: no headings, no numbering, no lists of ids, no citations, no markdown, no quoted messages. At most eight short lines, one idea each, in this order, leaving out any line that has nothing to say:`,
    `- what you and ${he} were discussing;`,
    '- which chat or session was in focus, and why;',
    `- what ${he} decided;`,
    `- what you offered or asked him that he has not answered yet.`,
    'Ignore the five-section shape and every other rule about the length and form of a summary: this handover replaces it. Your reply is the handover and nothing else.',
  ];
  if (last !== null) {
    const said = last.before === null ? '' : `${last.before.by === 'alert' ? 'The house told you' : `${he} said`}: "${cutAtSentence(last.before.text, LAST_WORDS_MAX_CHARS)}" `;
    lines.push('', `The newest exchange is not in the transcript above; it is the end of the conversation. ${said}You answered: "${cutAtSentence(last.reply, LAST_WORDS_MAX_CHARS)}" An offer or a question in that answer is still open.`);
  }
  return lines.join('\n');
}

/**
 * Makes the handover of the conversation `sessionId` and journals it: one line with the verb's model, its tokens and the text's length, or
 * one with the cause when there is none. Never rejects. `signal` stops the verb (Clear, a shutdown). Consumed by `companion-session.ts`.
 */
export async function makeHandover(input: {
  userId: number;
  sessionId: string;
  operatorName: string;
  name: string;
  last: LastWords | null;
  signal: AbortSignal;
}): Promise<HandoverOutcome> {
  const { userId, sessionId } = input;
  const failed = (cause: string): HandoverOutcome => {
    // A write stopped on purpose (Clear, a shutdown) is not a failure to journal.
    if (!input.signal.aborted) console.warn(`[Companion] account ${userId}: the handover of session ${sessionId} could not be written: ${cause}`);
    return { kind: 'failed', cause };
  };
  const transcriptPath = companionTranscriptPath(userId, sessionId);
  if (transcriptPath === null) return failed('its transcript is gone');
  const answer = await summarizeTranscript({
    transcriptPath,
    providerSessionId: sessionId,
    instructions: handoverInstructions(input.operatorName, input.name, input.last),
    waitMs: HANDOVER_WAIT_MS,
    signal: input.signal,
  });
  if (!answer.ok && answer.nothingBefore && input.last !== null) {
    const text = newestExchangeAlone(input.operatorName, input.last);
    console.log(`[Companion] account ${userId}: handover of session ${sessionId} written from her newest exchange alone (the thread has nothing before it to summarize), no summarizer: ${text.length} characters`);
    return { kind: 'written', text, model: null, tokensIn: 0, tokensOut: 0 };
  }
  if (!answer.ok) return failed(answer.sentence);
  const text = tidyHandover(answer.summary);
  if (text === '') return failed('the summary was empty');
  console.log(
    `[Companion] account ${userId}: handover of session ${sessionId} written by ${answer.model}: ${answer.tokensIn} tokens in, ${answer.tokensOut} out, ${text.length} characters`
  );
  return { kind: 'written', text, model: answer.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut };
}
