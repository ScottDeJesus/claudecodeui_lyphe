import { listOpenFollowups } from '@/modules/followups/index.js';
import { spendFreeWording } from '@/modules/notifications/index.js';
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
 *   - the notification's own title and body — the one wording every channel uses (`spendFreeWording`). The body
 *     is cut at the push channels' 1000 characters (a push service refuses a long payload) EXCEPT a question card's —
 *     a design's questions or an Accept prompt (`AskUserQuestion`) — which she gets WHOLE, because that block runs
 *     past 1000 and she would be told option 2 and nothing after it. Every other body is built from free text (a Bash
 *     command, an error, a message) and stays cut: her 20-alert window is the guard against a flood, and it holds only
 *     while each alert is bounded;
 *   - up to five open follow-ups that chat filed for him (`listOpenFollowups`, newest first);
 *   - for a permission or a question, the ask it waits on in one line (`activityLine`) — only while it is STILL
 *     waiting, so an ask he answered in the meantime is not announced as open.
 *
 * NEVER A WORD ABOUT USAGE OR SPEND (ruling 17). The house's wording for a finished feature ends with what it cost,
 * a budget stop says its figure and its headline says "budget", and an `api.error` names its reason (`rate_limit`).
 * The notifications module owns the one rule that takes all three out (`spendFreeWording`), and the title and body here
 * are its answer; the notification history she reads back is worded by the same function.
 *
 * Consumer: `feeds/alert-feed.ts`.
 */

/** One alert ready to deliver: `envelope` is what she is pushed, `line` the one line her panel logs. Consumed by `alert-feed.ts` (builds them) and `companion.service.ts` (`alert` logs and pushes them). */
export type CompanionAlert = { envelope: string; line: string };

/** How many open follow-ups an alert names: a handful she can say, never the whole backlog. */
const FOLLOWUPS_NAMED = 5;

/** The longest the panel's line for an alert runs, in characters: the panel shows a row, the envelope holds the whole. */
const LOG_LINE_MAX = 280;

/** The kinds whose chat may be waiting on him, so whose ask is read. */
const KINDS_THAT_WAIT: ReadonlySet<CompanionAlertKind> = new Set(['permission', 'asking']);

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
  // The question card is the one body asked for whole (no limit); every other keeps the push cap. `sessionName` is the
  // chat's name as the orchestrator resolves it (meta first, else the session row's, after its provider-id remap and fold).
  const { title, body, sessionName } = spendFreeWording(event, event.meta.toolName === 'AskUserQuestion' ? null : undefined);
  const sessionId = event.sessionId;
  const chat = sessionId === null ? null : optionally('the chat\'s name', event, () => resolveChat(sessionId), null);
  const known = chat?.ok ? chat.chat : null;

  const followups = sessionId === null ? [] : optionally('its follow-ups', event, () => listOpenFollowups(userId, sessionId, FOLLOWUPS_NAMED).map(({ followup }) => followup.text), []);
  const waiting =
    sessionId !== null && KINDS_THAT_WAIT.has(kind)
      ? optionally('the ask it waits on', event, () => (chatState(sessionId) === 'waiting' ? activityLine(sessionId, 'waiting') : null), null)
      : null;

  const envelope = alertEnvelope({
    kind,
    session: known?.name ?? sessionName ?? '',
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
