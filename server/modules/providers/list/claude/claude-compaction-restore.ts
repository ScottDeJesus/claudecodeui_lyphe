/**
 * The Claude runtime's report to the compaction of a turn it did not see end.
 *
 * A server restart drops every chat's idle deadline, because the deadline is a timer armed by a turn end.
 * The boot re-adopts the hosts that survived, and a host whose last turn was complete has no turn end left
 * to arm one: the end happened under the previous server. This reads that end off the host's journal — the
 * same frames, through the same extractor, the live stream reads — and hands it to the compaction as the
 * report a turn end would have made, with the moment it happened. Whether a deadline is owed, and when it
 * falls, is the compaction's (`idle-restore.ts`); this file only reports.
 *
 * consumer: claude-runtime.provider.js (at the adoption of a host whose turn is complete)
 */

import type { CerberusNodeHostLastTurn } from '@/shared/cerberus-types.js';
import type { AnyRecord, ChatTurnReport, IdleCheck, ProviderRuntimeContext } from '@/shared/types.js';

import {
  callHook,
  contextWindowFor,
  describeProcessActivity,
  sendOptionsOfTurn
} from './claude-compaction-seams.js';
import type { ProfileForSend } from './claude-compaction-seams.js';
import { lastTurnRecord, mainThreadRequestOf } from './session-host/index.js';

/**
 * A node host's last turn as `lastTurnRecord` would have returned it for a local one: the warden's record, with the
 * budget read out of its request. Null when the warden listed no turn.
 */
function turnOfListing<Budget>(
  listed: CerberusNodeHostLastTurn | null | undefined,
  readBudget: (message: AnyRecord) => Budget | null
): { endedAt: number; modelUsage: unknown; budget: Budget | null } | null {
  if (!listed) return null;
  return { endedAt: listed.endedAt, modelUsage: listed.modelUsage, budget: listed.request ? readBudget(listed.request) : null };
}

/**
 * Reports the re-adopted host's last finished turn to the compaction. Nothing is reported for a chat with no
 * app session id, for a host that never ended a turn (or, on a node, whose warden lists no last turn: one from
 * before the field), or when the compaction's hook fails (logged, never thrown: a compaction must not break the
 * adoption it follows).
 *
 * A local host's last turn is read off its journal here. A node's journal is the warden's own, at a path this
 * server is never handed, so its warden reads it with the same registry function and lists the record
 * (`reattach.lastTurn`); the one request in it goes through `mainThreadRequestOf`, the rule a live stream's message
 * and a local journal go through as well.
 *
 * `options` and `profile` are the adopted run's own, so the report's send options are what a live turn end of
 * this process would carry. The journal's lines are the stream's own messages and `mainThreadRequestOf` reads them as the
 * live loop does, so the restored context is the number the turn end would have reported.
 * `backgroundTasks` and `deferredCalls` are what the adopted process still waits for (the tasks its host's journal
 * shows running, the calls its meta holds), so the report's activity reads busy exactly when the process does.
 */
export function reportRestoredTurn(
  context: Pick<ProviderRuntimeContext, 'compaction'>,
  adopted: {
    sessionId: string | null | undefined;
    userId: string | number | null;
    reattach: { hostId: string; node: string | null; idleCheck?: IdleCheck | null; lastTurn?: CerberusNodeHostLastTurn | null };
    options: AnyRecord;
    profile: ProfileForSend | null;
    backgroundTasks: number;
    deferredCalls: number;
  }
): void {
  const appSessionId = adopted.sessionId;
  if (!appSessionId) return;
  callHook('turnRestored', () => {
    const turn =
      adopted.reattach.node === null
        ? lastTurnRecord(adopted.reattach.hostId, mainThreadRequestOf)
        : turnOfListing(adopted.reattach.lastTurn, mainThreadRequestOf);
    if (turn === null) return undefined;
    const report: ChatTurnReport = {
      appSessionId,
      userId: adopted.userId,
      contextTokens: turn.budget?.used ?? null,
      contextWindow: contextWindowFor(turn.modelUsage, turn.budget?.model ?? null),
      sendOptions: sendOptionsOfTurn(adopted.options, adopted.profile),
      answered: false,
      aborted: false,
      seed: false,
      activity: describeProcessActivity({
        closing: false,
        turnOpen: false,
        followUpDue: false,
        backgroundTasks: adopted.backgroundTasks,
        deferredCalls: adopted.deferredCalls
      })
    };
    // The idle check's record means something only against the turn end it followed: an older one is an earlier turn's.
    const check = adopted.reattach.idleCheck;
    const idleTries = check && check.at >= turn.endedAt ? check.tries : 0;
    return context.compaction.turnRestored(report, turn.endedAt, idleTries);
  });
}
