import type { SubagentActivity, SubagentInfo, ToolResult } from '@/shared/types';

/**
 * One reading of a subagent container row, shared by the panel that renders it inline and the
 * pinned bar that follows it while it runs.
 *
 * It exists so those two cannot disagree about whether an agent is still going: the status is
 * derived here once, from the backend's own word where there is one and from the presence of a
 * tool result where there is not.
 */

export type SubagentSummary = {
  status: 'running' | 'completed' | 'failed';
  /** The agent preset (Claude names them; Codex does not, so this can be empty). */
  label: string;
  description: string;
  /** Only when it says something the label does not. */
  nickname: string;
  toolCount: number;
  /**
   * When the agent's result landed. Null when nothing reliable says.
   *
   * NOT the last activity entry, which was the first cut and was wrong three ways: the stored
   * timeline is truncated from the HEAD at 200 entries (so a long run reports entry #200's
   * time), the live and server timelines are stamped from different rows so the value moved
   * after the agent had already finished, and even untruncated the last tool precedes the
   * closing reply.
   */
  finishedAt: string | null;
};

export function parseSubagentToolInput(toolInput: unknown): Record<string, unknown> {
  if (typeof toolInput !== 'string') {
    return (toolInput as Record<string, unknown>) || {};
  }
  try {
    return JSON.parse(toolInput) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * A BACKGROUNDED agent answers its launch call at once, with a receipt — "Async agent launched
 * successfully", carrying an agentId. Its real answer arrives much later, as a separate
 * task-notification turn.
 *
 * So the presence of a tool result cannot mean "finished", and inferring that it did made the
 * common case exactly backwards: measured, a 70-second background agent was never pinned at all
 * and its row was stamped "4 tools · 2:46 PM" four seconds into the run. `isAsync` is the same
 * evidence the history reader uses for this (claude-sessions.provider.ts, `isAwaitingAsyncAgent`).
 */
const isAsyncLaunchReceipt = (toolResult?: ToolResult | null): boolean => (
  (toolResult as { toolUseResult?: { isAsync?: unknown } } | null | undefined)
    ?.toolUseResult?.isAsync === true
);

export function readSubagentSummary({
  toolInput,
  toolResult,
  toolResultAt,
  subagent,
  activity,
}: {
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  /** When the result arrived, from the row the projection built. */
  toolResultAt?: string | number | Date;
  subagent?: SubagentInfo;
  activity?: SubagentActivity[];
}): SubagentSummary {
  const parsedInput = parseSubagentToolInput(toolInput);
  const entries = activity ?? [];
  // The backend's own word wins wherever there is one — the history reader knows whether a
  // background agent's notification has arrived. Only the live path, which carries no subagent
  // metadata at all, falls through to the inference below.
  const status = subagent?.status
    ?? (toolResult && !isAsyncLaunchReceipt(toolResult) ? 'completed' : 'running');

  const finishedAt = status !== 'running' && toolResultAt
    ? new Date(toolResultAt).toISOString()
    : null;

  return {
    status,
    label: subagent?.type ?? String(parsedInput.subagent_type ?? ''),
    description: subagent?.description ?? String(parsedInput.description ?? ''),
    nickname: subagent?.name && subagent.name !== subagent.type ? subagent.name : '',
    toolCount: entries.filter((entry) => entry.kind === 'tool').length,
    finishedAt,
  };
}

/** Short and local — the bar has one line and a date on it would be noise. */
export const formatSubagentFinishTime = (finishedAt: string | null): string => {
  if (!finishedAt) return '';
  const parsed = new Date(finishedAt);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
