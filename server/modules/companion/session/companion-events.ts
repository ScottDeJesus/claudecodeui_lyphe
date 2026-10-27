import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * What each message of her CLI's stream MEANS to her session, read once and in one place: the SDK's
 * message shapes stop here, and `companion-session.ts` reasons about five events. PURE — no I/O, no
 * state — so it is proven on messages recorded from the real CLI.
 *
 * Measured on the live CLI (2026-10-26, streaming input, Haiku):
 *   - `system`/`init` arrives at the start of EVERY turn, not once per process, with the same
 *     `session_id` each time; a launch's first one is the proof the process is up.
 *   - `result` echoes, in `user_message_uuids`, the uuid of every message of ours the turn consumed — a
 *     message folded in mid-turn is listed on the result of the turn that took it. That is how a result
 *     is matched to the turn it ends (`companion-turns.ts`).
 *   - A refused `resume` answers a `result` of subtype `error_during_execution` with no uuids and the
 *     text "No conversation found with session ID: …", and THEN the iterator throws.
 *   - An auth or API failure is a `result` of subtype `success` with `is_error: true`; its text is in
 *     `result`. The CLI writes that text as a synthetic assistant message, not as stream deltas, so it
 *     is never fed to the sentence stream — a failure of her account is never something she says.
 *
 * Consumers: `session/companion-session.ts` (reads every message of her loop through `readLoopEvent`,
 * and words a thrown error through `failureSentence`).
 */

/**
 * One thing her loop must react to. `init` carries the session id the CLI filed her conversation
 * under, the tools it listed and the model it runs; `text` is a streamed delta of her speech and
 * `block_end` the end of a content block (the sentence stream is flushed there); `compacted` says her
 * memory was summarised; `result` ends a turn — `answered` lists the uuids of our messages it consumed,
 * `failure` is the sentence for the panel when the turn failed (`null` when it succeeded) and
 * `resumeRefused` is set when the CLI says the conversation she was asked to resume does not exist.
 * Consumed by `companion-session.ts`, which reacts to each.
 */
export type CompanionLoopEvent =
  | { kind: 'init'; sessionId: string; tools: string[]; model: string }
  | { kind: 'text'; delta: string }
  | { kind: 'block_end' }
  | { kind: 'compacted' }
  | { kind: 'result'; answered: string[]; failure: string | null; resumeRefused: boolean };

const RESUME_REFUSED = /No conversation found with session ID/i;

/**
 * A sentence of advice to a developer, not an account of what happened: a flag to pass ("Run --model …"),
 * an SDK option to set ("… specify a valid path with options.pathToClaudeCodeExecutable.") or a usage
 * line ("Usage: claude -p --resume …"). The operator has no flag and no option to set (INV-7173).
 */
const DEVELOPER_ADVICE = /^(?:Run --|Please ensure\b|Usage:)|\boptions\.[A-Za-z]+/;

/**
 * The line for the panel from a reason the CLI or the SDK gave: its sentences of advice to a developer
 * left out, the closing period of what remains dropped before ours is added so a reason that already
 * ended in one does not end in two. Consumed by `companion-session.ts` for a thrown error and here for
 * a failed result.
 */
export function failureSentence(lead: string, reason: string): string {
  const sentences = reason.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z-])/);
  const account = sentences.filter((sentence) => !DEVELOPER_ADVICE.test(sentence));
  // A reason that is nothing but advice is still better shown than dropped.
  return `${lead}: ${(account.length > 0 ? account : sentences).join(' ').replace(/[.\s]+$/, '')}.`;
}

/** The failure sentence of a result, or `null` for a turn that succeeded. */
function resultFailure(result: SDKResultMessage): string | null {
  if (result.subtype === 'success') return result.is_error ? failureSentence('Her answer failed', result.result) : null;
  if (result.subtype === 'error_max_turns') return 'Her turn ran out of steps before she finished.';
  return failureSentence('Her answer failed', result.errors.join('; ') || result.subtype);
}

/** Reads one message of her stream; `null` for every message her session has no use for. Consumed by `companion-session.ts`. */
export function readLoopEvent(message: SDKMessage): CompanionLoopEvent | null {
  if (message.type === 'system') {
    if (message.subtype === 'init') return { kind: 'init', sessionId: message.session_id, tools: message.tools, model: message.model };
    return message.subtype === 'compact_boundary' ? { kind: 'compacted' } : null;
  }
  if (message.type === 'stream_event') {
    // She has no sub-agents, so a delta that belongs to one is not hers to speak.
    if (message.parent_tool_use_id) return null;
    const { event } = message;
    if (event.type === 'content_block_delta') {
      // Thinking and tool-input deltas are never speech.
      return event.delta.type === 'text_delta' ? { kind: 'text', delta: event.delta.text } : null;
    }
    return event.type === 'content_block_stop' ? { kind: 'block_end' } : null;
  }
  if (message.type === 'result') {
    const answered = message.user_message_uuids ?? (message.user_message_uuid ? [message.user_message_uuid] : []);
    const resumeRefused = message.subtype !== 'success' && message.errors.some((line) => RESUME_REFUSED.test(line));
    // A refused resume is not a failed turn: the session relaunches without it and the turn goes on.
    return { kind: 'result', answered, failure: resumeRefused ? null : resultFailure(message), resumeRefused };
  }
  return null;
}
