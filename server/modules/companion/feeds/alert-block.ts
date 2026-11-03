import { spendFreeWording, wholeBodyKind } from '@/modules/notifications/index.js';
import { isRecord } from '@/shared/document-fields.js';
import { oneLine } from '@/shared/tool-call-hint.js';
import type { NotificationEvent } from '@/shared/types.js';

import { alertEnvelope, type CompanionAlertKind } from '../session/companion-envelopes.js';
import { followupsOpenFirst } from '../tools/followup-list.js';
import { activityLine, chatState, pendingAsksOf, resolveChat } from '../tools/house-reads.js';

import { boundedWholeBody } from './alert-long-body.js';

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
 *     is cut at the push channels' 1000 characters (a push service refuses a long payload) EXCEPT the kinds
 *     `wholeBodyKind` names, which she gets WHOLE because a cut would leave her telling him half of it: a question card —
 *     a design's questions or an Accept prompt (`AskUserQuestion`), whose block runs past 1000 and who would be told
 *     option 2 and nothing after it — a plan awaiting approval (`ExitPlanMode`) and a tool permission shown as its JSON
 *     input, which the push excerpts to 600 and 300 characters and she is not. A question card has no ceiling (a design's and
 *     an Accept census are house-shaped, a chat's own card is model-written, and both reach her whole, as since 2026-10-28);
 *     a plan and a tool's input are free text, so `boundedWholeBody` holds them to a ceiling and, past it, says how much was
 *     left out and where the whole text is. Every other body is built from free text (a Bash command, an error, a message)
 *     and stays cut: her 20-alert window is the guard against a flood, and it holds only while each alert is bounded;
 *   - up to five open follow-ups that chat filed for him, newest first, then up to three the house settled when the feature,
 *     task or epic they named finished, each ending `[done: …]` (`followupsOpenFirst`);
 *   - for a permission or a question, the ask it waits on in one line (`activityLine`) — only while it is STILL
 *     waiting, so an ask he answered in the meantime is not announced as open;
 *   - for a permission, `owed`: the check the session makes at the LAST moment, when her message is built, that the prompt is still
 *     open (`openCheckOf`). A prompt he answers inside the gather window, or while she is mid-sentence, is dropped there and never
 *     said (`session/companion-alert-hold.ts`); the check is a function of the event and reads the house when it is CALLED, never here.
 *
 * NEVER A WORD ABOUT USAGE OR SPEND (ruling 17). The house's wording for a finished feature ends with what it cost,
 * a budget stop says its figure and its headline says "budget", and an `api.error` names its reason (`rate_limit`).
 * The notifications module owns the one rule that takes all three out (`spendFreeWording`), and the title and body here
 * are its answer; the notification history she reads back is worded by the same function.
 *
 * Consumer: `feeds/alert-feed.ts`.
 */

/**
 * One alert ready to deliver: `envelope` is what she is pushed, `line` the one line her panel logs, and `owed` — present only for an
 * alert about a prompt that can be answered — whether that prompt is still open (see `openCheckOf`). Consumed by `alert-feed.ts` (builds
 * them) and `companion.service.ts` (`alert` hands them to the session, which asks `owed` when her message is built).
 */
export type CompanionAlert = { envelope: string; line: string; owed?: () => boolean };

/** How many open follow-ups an alert names, and how many settled ones beside them: a handful she can say, never the whole backlog. */
const FOLLOWUPS_NAMED = 5;
const SETTLED_FOLLOWUPS_NAMED = 3;

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
 * The check that a permission alert's prompt is still open, or `undefined` when the event names nothing a check can find (it is then
 * always said). Two raisers push `permission.required`, and each names its prompt its own way:
 *   - a CHAT's tool permission carries the `requestId` of the attempt and the `promptKey` of the question. It is open while the chat's
 *     pending list holds either: a re-issue of the question gets a fresh request id under the same prompt key and is still the same
 *     question, and a request that resolved (answered, denied, the run aborted) is in neither;
 *   - the dispatcher lane's Accept or questions round carries a `promptKey` and an `askKind` and no request id. It is open while the
 *     lane's book holds it (`askOpen`, the house's door to it): the book drops an ask the moment an answer is carried, and when a picture
 *     shows it closed (approved in a terminal, re-cut).
 * Both are synchronous reads of memory, which the session needs at the moment it builds her message.
 */
function openCheckOf(event: NotificationEvent, askOpen: (promptKey: string) => boolean): (() => boolean) | undefined {
  const { requestId, promptKey, askKind } = event.meta;
  const sessionId = event.sessionId;
  if (typeof requestId === 'string' && sessionId !== null) {
    return () => {
      const pending: unknown[] = pendingAsksOf(sessionId);
      return pending.some((ask) => isRecord(ask) && (ask.requestId === requestId || (typeof promptKey === 'string' && ask.promptKey === promptKey)));
    };
  }
  if (typeof promptKey === 'string' && typeof askKind === 'string') return () => askOpen(promptKey);
  return undefined;
}

/**
 * The alert for `event` as it stands now. Throws only when the wording itself cannot be built; the chat's name, its
 * follow-ups and the ask it waits on are optional (`optionally`), so a read that fails costs that line and not the
 * alert. The caller builds each alert on its own, so one that cannot be built costs only itself.
 * `askOpen` is the dispatcher lane's book (`CompanionHouse.askOpen`), which only a dispatcher prompt's check reads.
 * Consumed by `alert-feed.ts`, once per event that survived its gates.
 */
export function buildAlertBlock(userId: number, event: NotificationEvent, kind: CompanionAlertKind, askOpen: (promptKey: string) => boolean): CompanionAlert {
  // A question card, a plan and a tool's JSON input are asked for whole (no limit); every other body keeps the push cap.
  // `sessionName` is the chat's name as the orchestrator resolves it (meta first, else the session row's, after its
  // provider-id remap and fold).
  const wholeKind = wholeBodyKind(event);
  const wording = spendFreeWording(event, wholeKind === null ? undefined : null);
  const { title, sessionName } = wording;
  // A question card has no ceiling; a plan or a tool's input is free text and is held to one.
  const body = wholeKind === 'excerpt' ? boundedWholeBody(userId, wording.body, title, 'alert-body') : wording.body;
  const sessionId = event.sessionId;
  const chat = sessionId === null ? null : optionally('the chat\'s name', event, () => resolveChat(sessionId), null);
  const known = chat?.ok ? chat.chat : null;

  const followups =
    sessionId === null
      ? []
      : optionally(
          'its follow-ups',
          event,
          () =>
            followupsOpenFirst(userId, sessionId, FOLLOWUPS_NAMED, SETTLED_FOLLOWUPS_NAMED).entries.map(({ followup, mark }) =>
              mark === null ? followup.text : `${followup.text} [${mark}]`
            ),
          []
        );
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
  return { envelope, line, owed: kind === 'permission' ? openCheckOf(event, askOpen) : undefined };
}
