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

import type { AnyRecord, ChatTurnReport, IdleCheck, ProviderRuntimeContext } from '@/shared/types.js';

import {
  callHook,
  contextWindowFor,
  describeProcessActivity,
  mainThreadBudgetOf,
  sendOptionsOfTurn
} from './claude-compaction-seams.js';
import type { ProfileForSend } from './claude-compaction-seams.js';
import { lastTurnRecord } from './session-host/index.js';

/**
 * Reports the re-adopted host's last finished turn to the compaction. Nothing is reported for a chat with no
 * app session id, for a host on a node (its journal lives on the node, and its chat runs the node's own copy of
 * the compaction), for a host that never ended a turn, or when the compaction's hook fails (logged, never thrown:
 * a compaction must not break the adoption it follows).
 *
 * `options` and `profile` are the adopted run's own, so the report's send options are what a live turn end of
 * this process would carry. `extractTokenBudget` is the runtime's reading of one stream message: the journal's
 * lines are those messages, so the restored context is the number the turn end would have reported.
 * `backgroundTasks` and `deferredCalls` are what the adopted process still waits for (the tasks its host's journal
 * shows running, the calls its meta holds), so the report's activity reads busy exactly when the process does.
 */
export function reportRestoredTurn(
  context: Pick<ProviderRuntimeContext, 'compaction'>,
  adopted: {
    sessionId: string | null | undefined;
    userId: string | number | null;
    reattach: { hostId: string; node: string | null; idleCheck?: IdleCheck | null };
    options: AnyRecord;
    profile: ProfileForSend | null;
    backgroundTasks: number;
    deferredCalls: number;
    extractTokenBudget: (message: AnyRecord) => { used: number } | null;
  }
): void {
  const appSessionId = adopted.sessionId;
  if (!appSessionId || adopted.reattach.node) return;
  callHook('turnRestored', () => {
    const turn = lastTurnRecord(adopted.reattach.hostId, (message) =>
      mainThreadBudgetOf(message as { type?: string; message?: { model?: unknown } }, adopted.extractTokenBudget(message))
    );
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
