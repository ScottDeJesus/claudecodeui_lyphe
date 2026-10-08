import type { ChatProcessActivity } from '@/shared/types.js';

/**
 * The module's one decision line. Every decision — a trigger's, the decorator's, the procedure's — is ONE
 * line naming the chat, the trigger, the measure (`contextTokens`, `contextWindow`), the activity and what
 * was decided, so a log read cold says why a chat was or was not compacted.
 *
 * Consumers: auto-trigger.ts, compaction-runtime.ts and compaction-procedure.ts.
 */

/** What the process was doing, in the words a log line quotes. */
function describeActivity(activity: ChatProcessActivity): string {
  return !activity.live ? 'not live' : activity.busy ? `busy (${activity.why ?? 'working'})` : 'idle';
}

export function logDecision(
  sessionId: string,
  trigger: string,
  context: { contextTokens: number | null; contextWindow: number | null },
  activity: ChatProcessActivity,
  decision: string,
): void {
  console.log(
    `[compaction] session=${sessionId} trigger=${trigger} contextTokens=${context.contextTokens ?? 'unknown'} `
    + `contextWindow=${context.contextWindow ?? 'unknown'} activity=${describeActivity(activity)} decision=${decision}`,
  );
}
