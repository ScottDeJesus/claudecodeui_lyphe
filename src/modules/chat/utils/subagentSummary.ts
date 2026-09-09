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
   * The last thing the agent did — the closest honest reading of when it finished, and one
   * that survives a reload, since both providers stamp the timeline they store. Null when the
   * timeline arrived without stamps rather than a guessed time.
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

export function readSubagentSummary({
  toolInput,
  toolResult,
  subagent,
  activity,
}: {
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  subagent?: SubagentInfo;
  activity?: SubagentActivity[];
}): SubagentSummary {
  const parsedInput = parseSubagentToolInput(toolInput);
  const entries = activity ?? [];
  const status = subagent?.status ?? (toolResult ? 'completed' : 'running');

  let finishedAt: string | null = null;
  if (status !== 'running') {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.timestamp) {
        finishedAt = entries[index].timestamp as string;
        break;
      }
    }
  }

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
