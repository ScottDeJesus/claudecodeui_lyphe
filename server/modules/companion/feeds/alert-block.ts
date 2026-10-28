import { listOpenFollowups } from '@/modules/followups/index.js';
import { buildNotificationPayload } from '@/modules/notifications/index.js';
import { oneLine } from '@/shared/tool-call-hint.js';
import type { NotificationEvent } from '@/shared/types.js';

import { alertEnvelope, type CompanionAlertKind } from '../session/companion-envelopes.js';
import { activityLine, chatState, resolveChat } from '../tools/house-reads.js';

/**
 * One house notification made into what she is told and what the panel shows: the `<alert>` envelope, and one
 * line for her log. Split from `alert-feed.ts` by cohesion — that file decides WHICH events reach her and WHEN,
 * this one decides what an event says.
 *
 * What an `<alert>` carries, each read at the moment it is built (which is when the gather window closes, a few
 * seconds after the event, so an ask the runtime registers just AFTER it raised the notification is already there):
 *   - the kind in words, and the chat's name and project (`resolveChat`; an event of a chat that is not one of his
 *     falls back to the name the notification carries, and a dispatcher ending belongs to no chat at all);
 *   - the notification's own title and body — `buildNotificationPayload`, the one wording every channel uses;
 *   - up to five open follow-ups that chat filed for him (`listOpenFollowups`, newest first);
 *   - for a permission or a question, the ask it waits on in one line (`activityLine`) — only while it is STILL
 *     waiting, so an ask he answered in the meantime is not announced as open.
 *
 * NEVER A WORD ABOUT USAGE OR SPEND (ruling 17). The house's wording for a finished feature ends with what it cost,
 * a budget stop says its figure and its headline says "budget", and an `api.error` names its reason (`rate_limit`):
 * the figures are taken out of the event's `meta` before the wording is built, a usage reason is put in neutral words,
 * and a budget stop's headline and body are replaced ("Run stopped at a limit"). The rest of every sentence is the
 * house's own.
 *
 * Consumer: `feeds/alert-feed.ts`.
 */

/** One alert ready to deliver: `envelope` is what she is pushed, `line` the one line her panel logs. Consumed by `alert-feed.ts` (builds them) and `companion.service.ts` (`alert` logs and pushes them). */
export type CompanionAlert = { envelope: string; line: string };

/** The `meta` keys that carry a cost or a token count (the dispatcher's endings and a budget stop): removed before the wording is built. */
const SPEND_META_KEYS = ['costUsd', 'totalCostUsd', 'tokens', 'tokensIn', 'tokensOut'] as const;

/** How many open follow-ups an alert names: a handful she can say, never the whole backlog. */
const FOLLOWUPS_NAMED = 5;

/** The longest the panel's line for an alert runs, in characters: the panel shows a row, the envelope holds the whole. */
const LOG_LINE_MAX = 280;

/** The kinds whose chat may be waiting on him, so whose ask is read. */
const KINDS_THAT_WAIT: ReadonlySet<CompanionAlertKind> = new Set(['permission', 'asking']);

/** The `api.error` reasons that are about usage, not about the request (`rate_limit`, a quota, credits): she is told the request failed, never that a limit was hit. */
const USAGE_REASON = /limit|quota|credit|billing|overage|usage/i;

/** The event's `meta` as the wording is built from it: no cost or token figure, and no usage reason in an `api.error`. */
function metaForHer(event: NotificationEvent): Record<string, unknown> {
  const meta = { ...event.meta };
  for (const key of SPEND_META_KEYS) delete meta[key];
  // The house's sentence is "<reason> after N retries"; with the reason put in neutral words it still reads true.
  if (event.code === 'api.error' && typeof meta.reason === 'string' && USAGE_REASON.test(meta.reason)) meta.reason = 'A request could not be made';
  return meta;
}

/** An optional part of an alert: when its read fails the alert goes without it and the fault is logged, so the alert itself is never lost for a missing line. */
function optionally<T>(part: string, event: NotificationEvent, read: () => T, without: T): T {
  try {
    return read();
  } catch (error) {
    console.error(`[Companion] an alert for ${event.code} (session ${event.sessionId ?? 'none'}) went without ${part}`, error);
    return without;
  }
}

/**
 * The alert for `event` as it stands now. Throws only when the wording itself cannot be built; the chat's name, its
 * follow-ups and the ask it waits on are optional (`optionally`), so a read that fails costs that line and not the
 * alert. The caller builds each alert on its own, so one that cannot be built costs only itself.
 * Consumed by `alert-feed.ts`, once per event that survived its gates.
 */
export function buildAlertBlock(userId: number, event: NotificationEvent, kind: CompanionAlertKind): CompanionAlert {
  const payload = buildNotificationPayload({ ...event, meta: metaForHer(event) });
  const sessionId = event.sessionId;
  const chat = sessionId === null ? null : optionally('the chat\'s name', event, () => resolveChat(sessionId), null);
  const known = chat?.ok ? chat.chat : null;

  const followups = sessionId === null ? [] : optionally('its follow-ups', event, () => listOpenFollowups(userId, sessionId, FOLLOWUPS_NAMED).map(({ followup }) => followup.text), []);
  const waiting =
    sessionId !== null && KINDS_THAT_WAIT.has(kind)
      ? optionally('the ask it waits on', event, () => (chatState(sessionId) === 'waiting' ? activityLine(sessionId, 'waiting') : null), null)
      : null;

  // A run that stopped at its BUDGET is a spend word, and the house's headline says it: she is told it stopped at a limit.
  const budgetStop = event.code === 'run.limit' && event.meta.limit === 'budget';
  const title = budgetStop ? `Run stopped at a limit${payload.data.sessionName ? ` · ${payload.data.sessionName}` : ''}` : payload.title;
  const body = budgetStop ? 'The run stopped at a limit it was given' : payload.body;

  const envelope = alertEnvelope({
    kind,
    session: known?.name ?? payload.data.sessionName ?? '',
    sessionId: sessionId ?? '',
    project: known?.project ?? '',
    title,
    body,
    followups,
    waiting,
  });
  const line = Array.from(oneLine(`${title}: ${body}`)).slice(0, LOG_LINE_MAX).join('');
  return { envelope, line };
}
