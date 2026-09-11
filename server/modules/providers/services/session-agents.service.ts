import fsp from 'node:fs/promises';
import path from 'node:path';

import type { AnyRecord, NormalizedMessage, SubagentActivity } from '@/shared/types.js';

/**
 * The agents of one conversation that its pinned strip must be able to show, read from the
 * WHOLE history rather than from the page a client asked for.
 *
 * The strip above the chat box (`src/modules/chat/transcript/PinnedSubagents.tsx`) keeps an
 * agent in view while it runs and after it finishes, until the reader dismisses it. It used to
 * take its agents from the transcript rows the page had loaded, and a page loads history from the
 * tail, twenty rows at a time — so an agent launched early in a long turn left the strip as soon
 * as the main thread had done twenty rows of work since, which is the exact moment it needs
 * pinning (measured 2026-09-10: a planner still running, sixty rows back, not pinned). This list
 * rides on every latest-page response so the strip no longer depends on what is loaded.
 *
 * Rows are COMPACT copies of the container rows: enough for the strip's reading
 * (`readSubagentSummary`, `describeLatestActivity`, the token figures) and nothing it does not
 * draw — no result text, no prompt, no tool results in the timeline.
 */

/** Mirrors `RUNNING_BELIEVED_FOR_MS` in PinnedSubagents.tsx: a "running" row older than this is not believed. */
const RUNNING_BELIEVED_FOR_MS = 4 * 60 * 60 * 1000;
/** Mirrors `FINISHED_SHOWN_FOR_MS` in PinnedSubagents.tsx: how long a finished agent stays offered. */
const FINISHED_SHOWN_FOR_MS = 2 * 60 * 60 * 1000;
/** A bound on the payload, newest first; a fan-out larger than this has scrolled out of any strip. */
const MAX_AGENTS = 30;

/** The receipt fields the strip reads: the backgrounded flag, the CLI's own total, the agent's id. */
const RECEIPT_KEYS = ['isAsync', 'totalTokens', 'agentId', 'status'];
/** The launch-input fields the strip reads. */
const INPUT_KEYS = ['description', 'subagent_type'];

const isContainer = (message: NormalizedMessage): boolean => (
  message.kind === 'tool_use'
  && Boolean(message.toolId)
  && (Boolean(message.subagent) || message.toolName === 'Agent' || message.toolName === 'Task')
);

const pick = (source: unknown, keys: string[]): AnyRecord | undefined => {
  // Codex writes a container's input as a JSON STRING (`spawn_agent`), Claude as an object.
  const parsed = typeof source === 'string' ? safeParse(source) : source;
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as AnyRecord;
  const picked: AnyRecord = {};
  for (const key of keys) {
    if (record[key] !== undefined) {
      picked[key] = record[key];
    }
  }
  return picked;
};

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readTime = (value: unknown): number => {
  const time = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : Number.NaN;
};

/**
 * Every entry keeps its kind and tool name, so the strip's tool count is the same number the full
 * timeline gives; only the newest tool call and the newest prose keep their content, because the
 * strip's latest-activity line reads nothing else.
 */
function compactActivity(entries: SubagentActivity[] | undefined): SubagentActivity[] | undefined {
  if (!entries || entries.length === 0) {
    return entries;
  }
  let lastTool = -1;
  let lastText = -1;
  for (let index = entries.length - 1; index >= 0 && (lastTool < 0 || lastText < 0); index -= 1) {
    if (lastTool < 0 && entries[index].kind === 'tool') lastTool = index;
    if (lastText < 0 && entries[index].kind === 'text') lastText = index;
  }
  return entries.map((entry, index) => {
    if (index === lastTool) {
      return { kind: entry.kind, toolName: entry.toolName, toolId: entry.toolId, toolInput: entry.toolInput, timestamp: entry.timestamp };
    }
    if (index === lastText) {
      return { kind: entry.kind, content: entry.content?.slice(0, 400), timestamp: entry.timestamp };
    }
    return { kind: entry.kind, toolName: entry.toolName };
  });
}

function compactContainer(message: NormalizedMessage): NormalizedMessage {
  const result = message.toolResult;
  return {
    id: message.id,
    sessionId: message.sessionId,
    timestamp: message.timestamp,
    provider: message.provider,
    kind: message.kind,
    toolName: message.toolName,
    toolId: message.toolId,
    toolInput: pick(message.toolInput, INPUT_KEYS) ?? {},
    ...(result
      ? {
        toolResult: {
          content: '',
          isError: Boolean(result.isError),
          toolUseResult: pick(result.toolUseResult, RECEIPT_KEYS),
          ...(result.timestamp ? { timestamp: result.timestamp } : {}),
        },
      }
      : {}),
    ...(message.subagent ? { subagent: message.subagent } : {}),
    ...(message.subagentTools ? { subagentTools: compactActivity(message.subagentTools) } : {}),
  } as NormalizedMessage;
}

/**
 * The conversation's agents that are running, or finished recently enough to still be offered,
 * newest launch first, compacted for the strip. The client applies the same windows again (and
 * the reader's dismissals); this filter only keeps a week-old conversation from shipping every
 * agent it ever ran.
 */
export function collectSessionAgents(messages: NormalizedMessage[], now: number = Date.now()): NormalizedMessage[] {
  const agents: NormalizedMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && agents.length < MAX_AGENTS; index -= 1) {
    const message = messages[index];
    if (!isContainer(message)) {
      continue;
    }
    const launchedAt = readTime(message.timestamp);
    const status = message.subagent?.status;
    const finished = status === 'completed' || status === 'failed' || status === 'stopped';
    if (finished) {
      const finishedAt = readTime(message.toolResult?.timestamp);
      const at = Number.isFinite(finishedAt) ? finishedAt : launchedAt;
      if (Number.isFinite(at) && now - at > FINISHED_SHOWN_FOR_MS) {
        continue;
      }
    } else if (Number.isFinite(launchedAt) && now - launchedAt > RUNNING_BELIEVED_FOR_MS) {
      continue;
    }
    agents.push(compactContainer(message));
  }
  return agents;
}

/**
 * How fresh the session's subagent sidechains are, as one comparable value: the newest write among
 * them, with the count so a removal counts as a change. The history cache folds this into its key
 * (`readCompanionStamp`), because those files are the other half of what a Claude history read
 * parses and they move while the parent transcript is quiet.
 *
 * Both layouts Claude has used are checked: `<projectDir>/<providerSessionId>/subagents/` today,
 * and loose `agent-*.jsonl` beside the parent transcript before that. Empty when there are none —
 * a session with no agents pays one failed `readdir` and nothing else.
 */
export async function readSubagentStamp(transcriptPath: string, providerSessionId: string): Promise<string> {
  const projectDirectory = path.dirname(transcriptPath);
  const directories = [
    path.join(projectDirectory, providerSessionId, 'subagents'),
    projectDirectory,
  ];

  let newestMs = 0;
  let count = 0;
  for (const directory of directories) {
    let names: string[];
    try {
      names = await fsp.readdir(directory);
    } catch {
      continue;
    }
    const sidechains = names.filter((name) => name.endsWith('.jsonl') && (directory === directories[0] || name.startsWith('agent-')));
    const stats = await Promise.all(sidechains.map(async (name) => {
      try {
        return (await fsp.stat(path.join(directory, name))).mtimeMs;
      } catch {
        return 0;
      }
    }));
    for (const mtimeMs of stats) {
      if (mtimeMs > newestMs) newestMs = mtimeMs;
    }
    count += sidechains.length;
  }

  return count === 0 ? '' : `${count}:${newestMs}`;
}
