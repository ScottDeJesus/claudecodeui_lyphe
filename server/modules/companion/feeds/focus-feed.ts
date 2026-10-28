import { writeFileSync } from 'node:fs';

import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { CompanionSessionRef } from '@/shared/companion-types.js';

import type { CompanionService } from '../companion.service.js';
import { sessionNewsEnvelope } from '../session/companion-envelopes.js';
import { resolveChat } from '../tools/house-reads.js';
import { companionScratchDir, FOCUS_NEWS_BRIEF, nextScratchFile, pruneScratch, runDactylRead } from '../tools/transcript-render.js';

/**
 * The focus chat's own news between alerts: when the chat she is focused on finishes a run, she is told what it
 * said — `<session event="finished">`. It rides `chatRunRegistry.onRunCompleted`, so nothing polls, and the run's
 * events are read from the registry's buffer (kept for five minutes after the run, `replayEvents(id, 0)`).
 *
 * It applies when the run was not aborted (an aborted run was a stop), did not fail and she is live;
 * `companion.service.ts` (`runCompleted`) decides the account, Live and failure, this file reads the run and writes
 * the envelope. A failed run is already a `failed` alert, and the runtime does NOT leave an `error` row for most
 * failures: a failed result raises `run.failed` / `run.limit` and then still sends a `complete` with exit code 0.
 * So the alert feed marks the chat when it hears such a code (`service.runFailed`) and `runCompleted` consumes the
 * mark; an `error` row (the runtime's catch path) is the second sign, read here. Starting and working are not
 * pushed: the roster at her next message carries them.
 *
 * A reply of at most 1,500 characters (as a person counts them: an emoji is one) goes in as it is. A longer one is written to her scratch folder and a dactyl
 * answers the fixed focus-news brief about it, so she is told what it reports rather than a wall to read aloud;
 * should the dactyl not answer, she gets the reply's opening and the news is not lost.
 *
 * Consumers: `companion.module.ts` (`startFocusFeed`) and `companion.service.ts` (`readRunReply`, `focusNewsEnvelope`).
 */

/** A reply this long or shorter is handed to her whole. */
const INLINE_REPLY_MAX = 1_500;

/** How much of a long reply she is given when the dactyl could not digest it. */
const OPENING_WHEN_UNDIGESTED = 600;

/** A text's length in characters as a person counts them (code points): an emoji is one, not two UTF-16 units. A text no longer than the limit in units is no longer in characters, so the walk is for the long ones only. */
function characterCount(text: string): number {
  return text.length <= INLINE_REPLY_MAX ? text.length : Array.from(text).length;
}

/**
 * Subscribes to run completion and hands each run that ended to `service.runCompleted`. Answers the unsubscribe.
 * Consumed by `companion.module.ts`.
 */
export function startFocusFeed(service: CompanionService): () => void {
  return chatRunRegistry.onRunCompleted((sessionId, { aborted }) => service.runCompleted(sessionId, aborted));
}

/**
 * What the chat's run just said: every assistant text of the run in order, blank-line separated. `null` when the
 * run has an `error` row (it failed, and says so on its own) or said nothing in words (it only worked). A failure
 * with no `error` row is the caller's to rule out first (`service.runFailed`, see above).
 * SYNCHRONOUS on purpose: the registry calls its listeners as the run's terminal `complete` is recorded, and the
 * next run of the same chat may replace this buffer soon after, so the caller reads the reply before it awaits anything.
 * Consumed by `companion.service.ts`, once per finished run.
 */
export function readRunReply(sessionId: string): string | null {
  const events = chatRunRegistry.replayEvents(sessionId, 0);
  if (events.some((event) => event.kind === 'error')) return null;
  const blocks = events
    .filter((event) => event.kind === 'text' && event.role === 'assistant')
    .map((event) => (event.content ?? '').trim())
    .filter((text) => text !== '');
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/** A dactyl's digest of `reply`, or the reply's opening with a note when none could be made. The reply is written to the account's scratch folder first, which is pruned after. */
async function digestOf(userId: number, sessionId: string, reply: string): Promise<string> {
  const scratch = companionScratchDir(userId);
  // Named and written in the same tick: `nextScratchFile` takes the next number from what is on disk.
  const file = nextScratchFile(scratch, 'focus-news');
  writeFileSync(file, `# The reply of a session that just finished\n\n${reply}\n`, 'utf8');
  const answer = await runDactylRead([file], FOCUS_NEWS_BRIEF);
  try {
    pruneScratch(scratch);
  } catch (error) {
    console.error(`[Companion] account ${userId}: her scratch folder could not be pruned`, error);
  }
  if (answer.ok) return answer.text;
  console.error(`[Companion] account ${userId}: no digest of the reply of session ${sessionId}: ${answer.error}`);
  return `(no digest could be made) it opens: ${Array.from(reply).slice(0, OPENING_WHEN_UNDIGESTED).join('')}`;
}

/**
 * The `<session event="finished">` envelope for `reply`, the words the focus chat's run just ended with: the reply
 * itself when short, a dactyl's digest of it when long. The chat is named as it is called NOW (it may have been
 * renamed since she focused it). Can take as long as a dactyl does (up to its 180 s bound).
 * Consumed by `companion.service.ts`.
 */
export async function focusNewsEnvelope(userId: number, focus: CompanionSessionRef, reply: string): Promise<string> {
  const chat = resolveChat(focus.sessionId);
  const base = { sessionId: focus.sessionId, name: chat.ok ? chat.chat.name : focus.name, event: 'finished' } as const;
  const characters = characterCount(reply);
  if (characters <= INLINE_REPLY_MAX) return sessionNewsEnvelope({ ...base, reply: { kind: 'whole', text: reply } });
  const digest = await digestOf(userId, focus.sessionId, reply);
  return sessionNewsEnvelope({ ...base, reply: { kind: 'long', characters, digest } });
}
