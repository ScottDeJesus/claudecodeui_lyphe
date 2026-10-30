import { answerChatPermission, type ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { isRecord } from '@/shared/document-fields.js';
import type { StationAskAnswer, StationNeed } from '@/shared/station-types.js';

import type { CompanionHouse } from '../house.js';
import { answerFor, oldestPendingAsk, rememberAllowedTool } from '../tools/ask-decision.js';
import { chatNameOf, pendingAsksOf } from '../tools/house-reads.js';

import { chatAskNeeds, checkNeeds, followupNeeds, planNeeds } from './need-readers.js';

/**
 * EVERYTHING THAT NEEDS HIM, read whole on the server, and the answer of one chat's ask. The station's rail draws what
 * `stationNeeds` answers and fires nothing on its own: the words on each item (`say`) are hers, built by the same `sayOf` her check
 * of his word is built from, so the rail never teaches him a phrase she would refuse.
 *
 * IN HIS ORDER: the dispatcher's Accepts and questions rounds (the lane's order), the chats' waiting asks, the follow-ups the
 * chats filed, then Cerberus' red checks. One reader per family (`need-readers.ts`); a reader that throws is logged and costs its
 * kind and never the rail: the kind is left out and named in `faults`, so the page can say "could not read the checks" and not "no
 * checks need you".
 *
 * THE ANSWER of a chat's ask is the page's own decision, byte for byte (`ask-decision.ts`): the ask must still be waiting, `answerFor`
 * decides from his words, an "always" writes its rule first through `rememberAllowedTool`, and the runtime's own resolver settles
 * the ask (`answerChatPermission`) — the very three steps `answer_session` takes, so an answer from her and one from his hand settle an
 * ask alike. Only a chat's ask is answered here: an Accept and a round are answered on the dispatcher's own card, whole.
 *
 * Consumers: `companion.service.ts` (`stationNeeds`, `answerStationAsk`, which hand it the service's own house and runtime) and, through
 * it, `needs.routes.ts`.
 */

/** One reader of the list: the kinds it answers (what `faults` names when it throws) and the read. */
type Reader = { kinds: StationNeed['kind'][]; read: () => StationNeed[] | Promise<StationNeed[]> };

/**
 * Everything that needs him now, in his order, and the kinds that could not be read. Every reader runs, concurrently, and their
 * answers are joined in the order of the list. Consumed by `companion.service.ts` (`GET /api/companion/station/needs`).
 */
export async function stationNeeds(userId: number, house: CompanionHouse): Promise<{ needs: StationNeed[]; faults: StationNeed['kind'][] }> {
  const readers: Reader[] = [
    { kinds: ['accept', 'questions'], read: () => planNeeds(house) },
    { kinds: ['ask'], read: chatAskNeeds },
    { kinds: ['followups'], read: () => followupNeeds(userId) },
    { kinds: ['check'], read: () => checkNeeds(house) },
  ];
  // `async` turns a reader that throws before its first await into a rejection too.
  const outcomes = await Promise.allSettled(readers.map(async (reader) => reader.read()));
  const needs: StationNeed[] = [];
  const faults: StationNeed['kind'][] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      needs.push(...outcome.value);
      return;
    }
    console.error(`[Station] what needs him (${readers[index].kinds.join(', ')}) could not be read`, outcome.reason);
    faults.push(...readers[index].kinds);
  });
  return { needs, faults };
}

/** What the station's answer comes to: the sentence the page shows, or the status and sentence that refuse it. Consumed by `needs.routes.ts`. */
export type StationAskOutcome = { ok: true; told: string } | { ok: false; status: 400 | 409; sentence: string };

/** The answer of a request that was settled while the page still showed it: another page, the chat's own window or her hands got there first. */
const ANSWERED_ELSEWHERE = 'That ask was answered elsewhere.';

/**
 * Answers one chat's waiting ask as the page's own decision. The ask must still be waiting (its `requestId` among the chat's pending
 * asks), else a 409; `answerFor` decides from his words and a sentence it refuses ("allow" to a question) is a 400 that says what to
 * answer instead. An "always" writes its rule BEFORE it answers, so a write that fails leaves the ask waiting and the call can be made
 * again. Consumed by `companion.service.ts` (`POST /api/companion/station/asks`).
 */
export async function answerStationAsk(userId: number, answer: StationAskAnswer, runtime: ProviderRuntimeGateway): Promise<StationAskOutcome> {
  const { sessionId, requestId } = answer;
  // As the gateway lists them: `pendingAsksOf` types an entry by what the reader lines need, and the request id is a field it does not name.
  const pending: unknown[] = pendingAsksOf(sessionId);
  const named = oldestPendingAsk(pending.filter((entry) => isRecord(entry) && entry.requestId === requestId));
  if (named === null) return { ok: false, status: 409, sentence: ANSWERED_ELSEWHERE };

  const verdict = answerFor(named.ask, answer.answer, chatNameOf(sessionId));
  if (!verdict.ok) return { ok: false, status: 400, sentence: verdict.sentence };

  if (verdict.remember !== null) rememberAllowedTool(userId, verdict.remember);
  answerChatPermission(requestId, verdict.decision, { runtime });
  const behind = pending.length - 1;
  return { ok: true, told: behind === 0 ? verdict.told : `${verdict.told} ${behind} more ${behind === 1 ? 'ask is' : 'asks are'} still waiting there.` };
}
