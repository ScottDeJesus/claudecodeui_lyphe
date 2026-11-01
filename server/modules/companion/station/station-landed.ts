import { sessionsDb, type NotificationHistoryRow } from '@/modules/database/index.js';
import type { DispatcherPicture } from '@/modules/dispatcher/index.js';
import { listNotificationHistorySince, NOTIFICATION_HISTORY_WINDOW_MS } from '@/modules/notifications/index.js';
import type { StationLanded, StationLandedKind } from '@/shared/station-types.js';

import type { CompanionHouse } from '../house.js';
import { chatNameOf } from '../tools/house-reads.js';

/**
 * WHAT LANDED, READ FROM WHAT THE HOUSE TOLD HIM. The strip "since you last looked" on Kaylee Station draws the landings of the
 * last seven days. It reads them from the notification history and from nowhere else: that table keeps one row for every event the
 * orchestrator is handed, its wording already taken clear of every figure (`spendFreeWording`), written on the orchestrator's own
 * seam. A second reader of the runs or of the souls lane would be a second answer to "what finished", free to disagree with what
 * he was told. The same rows reach his pages as they are kept, through `onHistoryKept` (`station-landed-feed.ts`).
 *
 * THE WEEK IS THE HISTORY'S: `stationLanded` reads every row the history keeps of the last seven days (`listNotificationHistorySince`
 * over `NOTIFICATION_HISTORY_WINDOW_MS`, the window the history's own prune never cuts into), by time and not by a count of rows.
 * A landing the house never kept has no row, and nothing here derives one from the dispatcher store or the souls lane.
 *
 * WHAT COUNTS AS LANDED has one home, `LANDED_KIND_BY_CODE`: five codes. A feature of an epic finishing is one of them
 * (`dispatcher.feature_finished`, a `record`: kept for this strip and pushed nowhere, so the strip draws it as `shipped` though the
 * phone is told only of the epic). Every other code (an ask, a failure, a pause, the usage family and `dispatcher.limit_paused`) is
 * news and not a landing, and is left out. Ruling 17: never a word about usage or spend. An entry's `title` is the row's own, as
 * kept, and no `meta` is read, so no figure reaches the strip.
 *
 * THE CHAT THAT DID IT, by kind:
 *   - `shipped` and `epic`: the row's own `session_id` first, the chat that asked for the work as the dispatcher's endings hand it;
 *     else the dispatcher plan's chat (`session_app_id`) while the dispatcher lane still holds the plan, which it does for a day after
 *     the plan ends, and for an epic the chat of its lead plan (`planChatOf`). A landing kept before the house handed the chat, and
 *     older than the lane's day, honestly names none.
 *   - `landed`: the chat the background work finished in, the history row's own `session_id`.
 *   - `recovered`: none, a check recovering was no chat's doing.
 * A chat is named as the sidebar names it (`chatNameOf`). A chat the house no longer holds names none, whichever kind it came
 * through: a chat deleted since it landed, an id that matches no chat (`resolveAppSessionId` hands an unmatched id back
 * unchanged) and an empty id each leave `sessionId` and `chat` `null`, so the page never offers a press on an id no chat holds.
 *
 * Consumers: `landed.routes.ts` (`stationLanded`, through the companion service) and `station-landed-feed.ts` (`landedOf`, `planChatOf`,
 * `landsThroughLane`, `dispatcherPictureOrNull`).
 */

/**
 * The most entries the strip is answered, newest first: 300, the most a strip draws (`LANDED_HELD`, `StationLandedContext.tsx`), so the
 * week stays whole however busy the house was. His week is about 140 landings once a feature of an epic is kept.
 */
const LANDED_MAX = 300;

/**
 * Every code that means something landed, and the kind the strip draws it as. The one home of the rule; consumed by `landedOf`
 * here and, through it, by the route and the feed.
 */
export const LANDED_KIND_BY_CODE: ReadonlyMap<string, StationLandedKind> = new Map<string, StationLandedKind>([
  ['dispatcher.finished', 'shipped'],
  ['dispatcher.feature_finished', 'shipped'],
  ['dispatcher.epic_finished', 'epic'],
  ['run.background_completed', 'landed'],
  ['cerberus.recovered', 'recovered'],
]);

/**
 * The chat of a dispatcher card by its name, read off one picture of the lane: a plan's own `session_app_id`, or for an epic the
 * chat of its lead plan (the first of the epic's plans the lane still holds that names a chat; the plans of an epic are cut in one
 * chat). `null` for a name the lane does not hold, a card that names no chat, and every name when the lane has not landed
 * (`picture` null). A plan's name and an epic's never collide (a feature of an epic is `<epic>--<feature>`). Consumed by
 * `stationLanded` here and by the station's landed feed, which reads the picture once per landing.
 */
export function planChatOf(picture: DispatcherPicture | null): (plan: string) => string | null {
  if (picture === null) return () => null;
  const plans = new Map(picture.plans.map((plan) => [plan.name, plan]));
  const arcs = new Map(picture.arcs.map((arc) => [arc.name, arc]));
  return (name) => {
    const own = plans.get(name);
    if (own !== undefined) return own.session_app_id;
    for (const featureName of arcs.get(name)?.plans ?? []) {
      const chat = plans.get(featureName)?.session_app_id ?? null;
      if (chat !== null) return chat;
    }
    return null;
  };
}

/** The chat a row names itself, or `null`: a row kept before the dispatcher's endings handed the chat, and an empty id, name none. */
function ownChatOf(row: NotificationHistoryRow): string | null {
  return row.session_id === null || row.session_id === '' ? null : row.session_id;
}

/** The chat a landing of `kind` came from, or `null` when it names none (see the file's head). */
function chatOfLanding(row: NotificationHistoryRow, kind: StationLandedKind, planChat: (plan: string) => string | null): string | null {
  switch (kind) {
    case 'shipped':
    case 'epic':
      return ownChatOf(row) ?? (row.plan === null ? null : planChat(row.plan));
    case 'landed':
      return row.session_id;
    case 'recovered':
      return null;
  }
}

/**
 * The id of a chat the house still holds, or `null`: `chatNameOf` answers its fallback "Untitled Session" for an id with no
 * `sessions` row, which would draw a chat that does not exist. An empty id is none too.
 */
function heldChatId(sessionId: string | null): string | null {
  if (sessionId === null || sessionId === '') return null;
  return sessionsDb.getSessionById(sessionId) ? sessionId : null;
}

/**
 * One kept row as a landing, or `null` for a row that is not one (its code is not in `LANDED_KIND_BY_CODE`). `planChat` answers
 * the chat of a dispatcher card by name (`planChatOf`). The entry's `title` is the row's own, as kept. Consumed by `stationLanded`
 * and by the station's landed feed.
 */
export function landedOf(row: NotificationHistoryRow, planChat: (plan: string) => string | null): StationLanded | null {
  const kind = LANDED_KIND_BY_CODE.get(row.code);
  if (kind === undefined) return null;
  const sessionId = heldChatId(chatOfLanding(row, kind, planChat));
  return {
    id: row.id,
    at: row.at,
    kind,
    title: row.title,
    plan: row.plan,
    sessionId,
    chat: sessionId === null ? null : chatNameOf(sessionId),
  };
}

/**
 * Whether naming a row's chat takes the lane's picture (`planChatOf`): a shipped feature or epic that names no chat of its own — a
 * landing kept before the dispatcher's endings handed the chat. A row that carries its chat never waits on the lane. The one place
 * the rule lives. Consumed by `stationLanded` here and by the station's landed feed.
 */
export function landsThroughLane(row: NotificationHistoryRow): boolean {
  const kind = LANDED_KIND_BY_CODE.get(row.code);
  return (kind === 'shipped' || kind === 'epic') && ownChatOf(row) === null && row.plan !== null;
}

/**
 * The picture of the dispatcher lane, or `null` when the lane did not answer: a landing then names no chat, and the strip is still
 * drawn. Consumed by `stationLanded` here and by the station's landed feed.
 */
export async function dispatcherPictureOrNull(house: CompanionHouse): Promise<DispatcherPicture | null> {
  try {
    return await house.dispatcher();
  } catch (error) {
    console.error("[Station] the dispatcher lane could not be read for the landings' chats", error);
    return null;
  }
}

/**
 * The account's landings of the last seven days, newest first, at most 300 (`LANDED_MAX`). The week is read by time, every row the
 * history keeps since seven days ago, and the rows keep the order they were written in, so this is the order he was told. The lane's
 * picture is read only when a dispatcher landing among them names no chat of its own. Consumed by `landed.routes.ts`, through the
 * companion service's verb that hands its house.
 */
export async function stationLanded(userId: number, house: CompanionHouse): Promise<StationLanded[]> {
  const sinceIso = new Date(Date.now() - NOTIFICATION_HISTORY_WINDOW_MS).toISOString();
  const rows = listNotificationHistorySince(userId, sinceIso)
    .filter((row) => LANDED_KIND_BY_CODE.has(row.code))
    .slice(0, LANDED_MAX);
  const planChat = planChatOf(rows.some((row) => landsThroughLane(row)) ? await dispatcherPictureOrNull(house) : null);
  return rows.flatMap((row) => landedOf(row, planChat) ?? []);
}
