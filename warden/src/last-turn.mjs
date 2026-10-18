// A host's last finished turn, as the warden lists it beside `lastTurnFinishedAt`.
//
// Center cannot read this node's journals: it is never handed this machine's home. What center needs of a re-adopted
// chat is what it reads of a LOCAL host's journal — when the turn ended, its `modelUsage`, and the context of its last
// main-thread request — so the compaction can arm the idle deadline a restart dropped. The walk is the registry's own
// `lastTurnRecord` (the file the API runs for its local hosts, so there is one reading of a journal), and the question
// of which assistant message counts as the turn's request is the registry's own too: `mainThreadRequestOf`, the one
// rule the API's runtime asks of a live stream's message and of a local journal. Nothing of that rule is written here.
//
// The request is sent as the message's own fields that rule reads (`type`, `parent_tool_use_id`, `message.model`,
// `message.usage`) and nothing of its content, so the listing stays small however long the answer was, and center
// applies `mainThreadRequestOf` to it again, as it does to a message of a live stream.

import { mainThreadRequestOf } from '../../server/modules/providers/list/claude/session-host/host-registry.js';

/**
 * The request fields center reads, or null when `mainThreadRequestOf` says this message is not the turn's request. The
 * fields kept are the ones the rule reads, so applying it to what is listed gives the answer it gave here.
 * @param {Record<string, unknown>} message
 * @returns {{ type: 'assistant', parent_tool_use_id: null, message: { model: string | null, usage: Record<string, unknown> } } | null}
 */
function requestFieldsOf(message) {
  const request = mainThreadRequestOf(message);
  if (request === null) return null;
  const { usage } = /** @type {{ message: { usage: Record<string, unknown> } }} */ (message).message;
  return { type: 'assistant', parent_tool_use_id: null, message: { model: request.model, usage } };
}

/**
 * The host's last finished turn for the listing, or null when its journal holds no `result`. `request` is null for a
 * turn that ran no request (a compaction's seed append).
 * @param {{ lastTurnRecord: (hostId: string, readBudget: (message: Record<string, unknown>) => unknown) => { endedAt: number, modelUsage: unknown, budget: unknown } | null }} registry
 * @param {string} hostId
 */
export function listedLastTurn(registry, hostId) {
  const record = registry.lastTurnRecord(hostId, requestFieldsOf);
  return record === null ? null : { endedAt: record.endedAt, modelUsage: record.modelUsage, request: record.budget };
}
