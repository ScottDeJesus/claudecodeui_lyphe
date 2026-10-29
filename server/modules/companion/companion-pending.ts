import type { CompanionActionKind, CompanionActionTarget, CompanionCarriedLine, CompanionOpenTarget, CompanionPendingAction } from '@/shared/companion-types.js';
import { isCount, isList, isRecord, isText, isTextOrNull, isWholeFrom } from '@/shared/document-fields.js';
import type { DispatcherAsk } from '@/shared/types.js';
import { isStoreStamp } from '@/shared/utils.js';

/**
 * The server's side of the one action waiting for his word: the stored shape (the wire's `CompanionPendingAction` plus the
 * `pin` the prepare took), the shape check a `pending_json` column is read through, and the cut that takes the pin off before
 * anything is sent to a page.
 *
 * THE PIN IS THE SERVER'S ALONE. What the prepare pinned — the ask and its lock token, the chain, the follow-up's id, the open's
 * target — is what `take_action` fires, so the action fires on what he heard read back and not on whatever the house holds by
 * then. A page never needs the pin: the ask as an object, with the token the dispatcher guards an answer by, stays on the server.
 * (The census on the card, `prompt`, ends with the prompt's own `lock:` footer, which the Plans card draws as well and which
 * `dispatcher_state` already carries; no authority travels with it.) `withoutPin` names the wire's fields one by one instead of dropping `pin` from a copy, so a field added to the stored
 * shape later is never sent until someone puts it on the wire on purpose.
 *
 * Consumer: `companion-store.ts`, which reads `pending_json` through `isStoredPending`, writes it, and puts only `withoutPin`'s
 * result on the picture and on `companion_pending`.
 */

/**
 * What the prepare pinned for the take: `ask` (the Accept or questions prompt, with its lock token) for a queue, hide, rework or
 * answer at a prompt, `chainId` for a resume of a run, `followupId` for a close, `open` for an open, and for an answer round
 * `questions`: the number (from 1) of the question each carried group answers, in group order. Each is absent when the
 * action has no use for it. Consumed by the hands, which write it at prepare and read it at take.
 */
export type CompanionPin = { ask?: DispatcherAsk; chainId?: string; followupId?: number; open?: CompanionOpenTarget; questions?: number[] };

/** The action as the store holds it: the wire's shape with its pin. Server-only — a page's picture and frames carry `CompanionPendingAction`. */
export type CompanionStoredPending = CompanionPendingAction & { pin: CompanionPin };

/** Row and follow-up numbers count from 1 and are whole: 1.5, 0 and -3 name no row. */
const isRowId = isWholeFrom(1);

/** Every kind, as a record so that a kind added to the contract fails to compile here until the shape check knows it. */
const ACTION_KINDS: Record<CompanionActionKind, true> = {
  queue: true, hide: true, show: true, rework: true, answer: true, recut: true,
  stop: true, resume: true, kick: true, resume_run: true, open: true, close_followup: true, clear_memory: true,
};

const isActionKind = (value: unknown): value is CompanionActionKind => isText(value) && Object.hasOwn(ACTION_KINDS, value);

const isTarget = (value: unknown): value is CompanionActionTarget => {
  if (!isRecord(value) || !isText(value.spoken)) return false;
  switch (value.kind) {
    case 'card':
      return isText(value.name) && isTextOrNull(value.arc);
    case 'run':
      return isText(value.runId) && isTextOrNull(value.plan);
    case 'page':
      return isText(value.pageId) && isTextOrNull(value.blockId);
    case 'chat':
      return isText(value.sessionId);
    case 'followup':
      return isRowId(value.id) && isText(value.sessionId) && isText(value.text);
    case 'memory':
      return isCount(value.count);
    default:
      return false;
  }
};

const isOpenTarget = (value: unknown): value is CompanionOpenTarget =>
  isRecord(value)
  && ((value.kind === 'chat' && isText(value.sessionId))
    || (value.kind === 'card' && isText(value.plan))
    || (value.kind === 'page' && isText(value.pageId) && isTextOrNull(value.blockId)));

const isCarriedLine = (value: unknown): value is CompanionCarriedLine =>
  isRecord(value) && isRowId(value.logId) && isText(value.at) && isText(value.text);

const isCarriedGroup = (value: unknown): boolean =>
  isRecord(value) && isTextOrNull(value.label) && isList(value.lines) && value.lines.every(isCarriedLine);

/** Enough of an ask to be sure it is one: the prompt's plan and kind. The dispatcher's own reader judged the rest when it was put up. */
const isAsk = (value: unknown): value is DispatcherAsk =>
  isRecord(value) && isText(value.plan) && (value.kind === 'accept' || value.kind === 'questions');

/** A key a pin may leave out is absent (`JSON.stringify` drops `undefined`), so `undefined` passes and anything present must be its shape. */
const isPin = (value: unknown): value is CompanionPin =>
  isRecord(value)
  && (value.ask === undefined || isAsk(value.ask))
  && (value.chainId === undefined || isText(value.chainId))
  && (value.followupId === undefined || isRowId(value.followupId))
  && (value.open === undefined || isOpenTarget(value.open))
  && (value.questions === undefined || (isList(value.questions) && value.questions.every(isRowId)));

/**
 * Whether a parsed `pending_json` has every part the take and the card read. Passed to the store's JSON-column reader, so a value
 * that is not this (a hand edit, a later build's shape) reads as no pending action. The two stamps must be real stored stamps
 * (`isStoreStamp`): `heardSince(preparedAt)` and every lapse test hang on them, and an empty or unparseable one would read the whole log as
 * "after the card went up" and make the action never lapse.
 */
export function isStoredPending(value: unknown): value is CompanionStoredPending {
  return isRecord(value)
    && isText(value.id)
    && isActionKind(value.action)
    && isTarget(value.target)
    && isTextOrNull(value.prompt)
    && isList(value.carried)
    && value.carried.every(isCarriedGroup)
    && isText(value.say)
    && isStoreStamp(value.preparedAt)
    && isStoreStamp(value.expiresAt)
    && isPin(value.pin);
}

/** The action as a page may hold it: every wire field, and never the pin. */
export function withoutPin(stored: CompanionStoredPending): CompanionPendingAction {
  return {
    id: stored.id,
    action: stored.action,
    target: stored.target,
    prompt: stored.prompt,
    carried: stored.carried,
    say: stored.say,
    preparedAt: stored.preparedAt,
    expiresAt: stored.expiresAt,
  };
}
