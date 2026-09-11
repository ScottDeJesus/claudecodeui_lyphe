import type { SubagentActivity, SubagentInfo, SubagentUsage, ToolResult } from '@/shared/types';
import { formatTokenCount } from '@/modules/chat/utils/chatFormatting';

/**
 * One reading of a subagent container row, shared by the panel that renders it inline and the
 * pinned bar that follows it while it runs.
 *
 * It exists so those two cannot disagree about whether an agent is still going: the status is
 * derived here once, from the backend's own word where there is one and from the presence of a
 * tool result where there is not.
 */

export type SubagentSummary = {
  status: SubagentInfo['status'];
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
  /** What the agent has spent, when its provider records usage. Null for Codex and for a spawn with no request yet. */
  usage: SubagentUsage | null;
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
 * It reaches the LIVE path only because `transformMessage` in claude-runtime.provider.js maps the
 * SDK's `tool_use_result` onto `toolUseResult`; until 2026-09-10 it did not, and this check was
 * true only after a reload — measured, a live background agent was never pinned at all.
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
  usage,
}: {
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  /** When the result arrived, from the row the projection built. */
  toolResultAt?: string | number | Date;
  subagent?: SubagentInfo;
  activity?: SubagentActivity[];
  /** The projection's reading (`ChatMessage.subagentUsage`): the fresher of the server's and the live fold's. */
  usage?: SubagentUsage;
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
    usage: usage && usage.contextTokens > 0 ? usage : null,
  };
}

/**
 * The reading as one short chip — `28K tokens · 4.6K out` — with the long form for its
 * tooltip. The context figure is called plain "tokens" because it is the number the terminal
 * prints beside an agent (`totalTokens`), and a reader comparing the two must see them agree;
 * the reply count is the work the agent has actually done, which that figure hides behind a
 * large read-in prompt. Null when there is nothing to say yet.
 */
export function describeSubagentUsage(usage: SubagentUsage | null): { short: string; long: string } | null {
  if (!usage || usage.contextTokens <= 0) {
    return null;
  }
  const short = usage.outputTokens > 0
    ? `${formatTokenCount(usage.contextTokens)} tokens · ${formatTokenCount(usage.outputTokens)} out`
    : `${formatTokenCount(usage.contextTokens)} tokens`;
  const requests = `${usage.requests} ${usage.requests === 1 ? 'request' : 'requests'}`;
  // A live reading has no reply count (see `LiveUsageFold` in useChatMessages.ts); say so by
  // saying nothing, rather than "wrote 0 tokens" about an agent that plainly has. A finish
  // total alone has no request count either.
  const context = `Context ${usage.contextTokens.toLocaleString()} tokens as of its latest request`;
  const long = usage.outputTokens > 0
    ? `${context} · wrote ${usage.outputTokens.toLocaleString()} tokens over ${requests}`
    : usage.requests > 0
      ? `${context}, ${requests} so far`
      : context;
  return { short, long };
}

/** The input fields worth quoting when a tool call is read as one line, most telling first. */
const TOOL_INPUT_PREVIEW_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'description'];

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The newest thing the agent did or said, as one short line — a running tool with the argument
 * that names its target, or the first line of its latest prose. Empty while it is still
 * starting up. This is the "what is it doing right now" the pinned bar shows beside the status.
 */
export function describeLatestActivity(activity?: SubagentActivity[]): string {
  const entries = activity ?? [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === 'tool') {
      const input = entry.toolInput && typeof entry.toolInput === 'object' ? (entry.toolInput as Record<string, unknown>) : {};
      const key = TOOL_INPUT_PREVIEW_KEYS.find((candidate) => typeof input[candidate] === 'string' && (input[candidate] as string).trim());
      const preview = key ? oneLine(String(input[key]), 70) : '';
      return preview ? `${entry.toolName ?? 'Tool'} · ${preview}` : (entry.toolName ?? 'Tool');
    }
    if (entry.kind === 'text' && entry.content?.trim()) {
      return oneLine(entry.content, 90);
    }
  }
  return '';
}

/** Short and local — the bar has one line and a date on it would be noise. */
export const formatSubagentFinishTime = (finishedAt: string | null): string => {
  if (!finishedAt) return '';
  const parsed = new Date(finishedAt);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
