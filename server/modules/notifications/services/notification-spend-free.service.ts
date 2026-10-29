import type { NotificationEvent } from '@/shared/types.js';

import { buildNotificationText } from './notification-copy.service.js';
import { buildNotificationPayload } from './notification-orchestrator.service.js';

/**
 * THE HOUSE'S WORDING WITH EVERY FIGURE TAKEN OUT (ruling 1: never usage or spend). `buildNotificationPayload` words a
 * finished feature with what it cost, a budget stop with its figure under the headline "Max budget reached", and an
 * `api.error` with its reason (`rate_limit`, a quota, credits). Anything that carries a notification's wording into
 * Kaylee's reach — the `<alert>` she is pushed, and the history she reads back — says it through this one function, so the
 * rule is written once and no copy of the wording can put a cost in her context.
 *
 * The figures are taken out of the event's `meta` BEFORE the wording is built, a usage reason is put in neutral words, a
 * budget stop's headline and body are replaced ("Run stopped at a limit"), and the free text some wordings are built from — a
 * failed run's own error, a compaction's reason, a dispatcher pause's or relaunch's detail — is left out of the sentence when it
 * speaks of usage or spend (the CLI's own "usage limit reached" is exactly a failed run's error). The rest of every sentence
 * is the house's own.
 *
 * Consumers: the companion module's alert block (`buildAlertBlock`, what she is told unasked) and this module's history
 * service (what is kept of each event). Both reach it through the module barrel.
 */

/** The `meta` keys that carry a cost or a token count (the dispatcher's endings and a budget stop): removed before the wording is built. */
const SPEND_META_KEYS = ['costUsd', 'totalCostUsd', 'tokens', 'tokensIn', 'tokensOut'] as const;

/** The `api.error` reasons that are about usage, not about the request (`rate_limit`, a quota, credits): it is said that the request failed, never that a limit was hit. */
const USAGE_REASON = /limit|quota|credit|billing|overage|usage/i;

/**
 * Usage or spend in free text: the word "usage", a rate limit, a quota, credits, billing, an overage, a dollar figure, and the
 * words budget, spend, spent, cost and tokens (plural: a count; "token" alone is an auth word and is left). Narrower than
 * `USAGE_REASON`, which judges a one-word reason: free text says "limit" and "credit" about plenty that is not usage.
 */
const USAGE_OR_SPEND_TEXT = /\busage\b|rate.?limit|\bquota\b|\bcredits?\b|\bbilling\b|\boverage\b|\$\s?\d|\b(?:budget|spend|spent|costs?|tokens)\b/i;

/** The `meta` field each code's wording takes free text from, or `null` for a code whose wording holds none: a run's own error, a compaction's reason, a dispatcher event's detail. */
function freeTextFieldOf(code: string): 'error' | 'reason' | 'detail' | null {
  if (code === 'run.failed') return 'error';
  if (code === 'compaction.failed') return 'reason';
  return code.startsWith('dispatcher.') ? 'detail' : null;
}

/** The event's `meta` as the wording is built from it: no cost or token figure, no usage reason in an `api.error`, and no free text that speaks of usage or spend. */
function metaWithoutSpend(event: NotificationEvent): Record<string, unknown> {
  const meta = { ...event.meta };
  for (const key of SPEND_META_KEYS) delete meta[key];
  // The house's sentence is "<reason> after N retries"; with the reason put in neutral words it still reads true.
  if (event.code === 'api.error' && typeof meta.reason === 'string' && USAGE_REASON.test(meta.reason)) meta.reason = 'A request could not be made';
  // Dropped, not reworded: each wording reads whole without its free text ("The run encountered an error", "Task … was taken up again").
  const freeTextField = freeTextFieldOf(event.code);
  const freeText = freeTextField === null ? undefined : meta[freeTextField];
  if (freeTextField !== null && typeof freeText === 'string' && USAGE_OR_SPEND_TEXT.test(freeText)) delete meta[freeTextField];
  return meta;
}

/**
 * An event's wording as `spendFreeWording` answers it: the headline and body every channel would show, and the chat's name
 * the wording was built with (the event's own `meta.sessionName`, else the session row's, after the orchestrator's
 * provider-id remap and 80-character fold), `null` when the event names none.
 */
export type SpendFreeWording = { title: string; body: string; sessionName: string | null };

/**
 * `event`'s title and body as the house words them, with no cost, token or usage figure in either. The body is cut at the push
 * channels' 1000 characters, as every push is; `bodyLimit` of `null` asks for the whole body (the alert block, for a question
 * card, which she must not be told half of) and a number cuts there. A caller passing `null` owns the bound: a body built
 * from free text (a Bash command, an error message) is unbounded. Never throws for an event the wording does not know: an
 * unknown code is the generic copy.
 * Consumed by `buildAlertBlock` (companion alert feed) and `startNotificationHistory`; exported through the module barrel.
 */
export function spendFreeWording(event: NotificationEvent, bodyLimit?: number | null): SpendFreeWording {
  const wording = { ...event, meta: metaWithoutSpend(event) };
  const payload = buildNotificationPayload(wording);
  const sessionName: string | null = payload.data.sessionName ?? null;
  // A run that stopped at its BUDGET is a spend word, and the house's headline says it: it is said to have stopped at a limit.
  if (event.code === 'run.limit' && event.meta.limit === 'budget') {
    return { title: `Run stopped at a limit${sessionName ? ` · ${sessionName}` : ''}`, body: 'The run stopped at a limit it was given', sessionName };
  }
  // The payload's own body is already cut at the push cap; a different limit asks the copy again, with the name the payload resolved.
  const body = bodyLimit === undefined ? payload.body : buildNotificationText({ ...wording, sessionName }, bodyLimit).body;
  return { title: payload.title, body, sessionName };
}
