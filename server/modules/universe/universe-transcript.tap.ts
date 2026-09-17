import path from 'node:path';

import { expandHome } from '@/shared/utils.js';
import type { UniverseActivityInput } from '@/shared/types.js';

import type { UniverseMapService } from './universe-map.service.js';
import { createTranscriptTail } from './universe-transcript-tail.js';

/**
 * Tap 2: the Claude transcripts, read as edits and executions.
 *
 * A LIVE tail that never replays — the file mechanics live in `universe-transcript-tail.ts`, and
 * what belongs here is the MEANING: which tool calls count, and which star each one pulses.
 *
 * Read and Bash are dropped. There are thousands of them a day and they would bury the edits that
 * mean something; a read is not an edit, and a shell command is not a file.
 */

/**
 * The tool names this tap admits — ONE array, so the set is changed in one place.
 *
 * `Edit|Write|MultiEdit|NotebookEdit` name a file and become an edit; `Skill` and `Agent|Task`
 * name a tracked definition and become an execution. MCP tools are not listed here: they are
 * admitted by the shape of their name, below.
 */
export const ADMITTED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Skill', 'Agent', 'Task'] as const;

/** An MCP tool call: `mcp__<server>__<tool>`, whose server is an endpoint on the map. */
const MCP_TOOL = /^mcp__([a-z0-9-]+)__/;

/**
 * The roots a tool name points into, under the sun. The paths, and not the layout: which REPO a path
 * belongs to is `map.resolve`'s answer — the crawler's ordering, never a second one here.
 */
const SKILLS_ROOT = expandHome('~/.claude/skills');
const AGENTS_ROOT = expandHome('~/.claude/agents');
const TRANSCRIPTS_ROOT = expandHome('~/.claude/projects');

/** A row this tap produced, before the clock and the coalescer. */
export type ToolUseRow = { node: number; kind: 'edit' | 'exec'; source: 'session'; session: string };

/** What a tool call resolves THROUGH: the map's own answers, and nothing else. */
export type TranscriptResolver = {
  /** The node of a tracked file, by absolute path, or `-1`. */
  nodeForPath(absolutePath: string): number;
  /** The node of an endpoint id — `mcp:archpulse` — or `-1`. */
  nodeForEndpoint(id: string): number;
};

/** A non-empty string field, or `null` — a block missing a field is skipped, never thrown on. */
function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `-1` when there is no resolver at all, which is how the pure mapping is probed with no map. */
function resolvedNode(resolve: TranscriptResolver | undefined, lookup: (r: TranscriptResolver) => number): number {
  return resolve === undefined ? -1 : lookup(resolve);
}

/**
 * The rows one `tool_use` block is worth: none for a tool this tap does not admit, one otherwise.
 *
 * Consumed by the tap's own line handler, and by this phase's check as a probe — the whole of what
 * "read a tool call" means, with no file, no timer and no clock in it.
 */
export function rowsForToolUse(
  name: string,
  input: Record<string, unknown>,
  session: string,
  resolve?: TranscriptResolver,
): ToolUseRow | null {
  const mcp = MCP_TOOL.exec(name);
  // Not admitted and not an MCP call: `Read`, `Bash`, `Grep` and every other tool land here.
  if (mcp === null && !(ADMITTED_TOOLS as readonly string[]).includes(name)) return null;

  const row = { source: 'session', session } as const;
  if (mcp !== null) {
    return { ...row, node: resolvedNode(resolve, (r) => r.nodeForEndpoint(`mcp:${mcp[1]}`)), kind: 'exec' };
  }
  if (name === 'Skill') {
    const skill = stringField(input, 'skill');
    if (skill === null) return null;
    const file = path.join(SKILLS_ROOT, skill, 'SKILL.md');
    return { ...row, node: resolvedNode(resolve, (r) => r.nodeForPath(file)), kind: 'exec' };
  }
  if (name === 'Agent' || name === 'Task') {
    const agent = stringField(input, 'subagent_type');
    if (agent === null) return null;
    const file = path.join(AGENTS_ROOT, `${agent}.md`);
    return { ...row, node: resolvedNode(resolve, (r) => r.nodeForPath(file)), kind: 'exec' };
  }
  const filePath = stringField(input, 'file_path');
  if (filePath === null) return null;
  return { ...row, node: resolvedNode(resolve, (r) => r.nodeForPath(filePath)), kind: 'edit' };
}

export type TranscriptTapDependencies = {
  /** The held map, through the service: absolute paths and endpoints resolve there and nowhere else. */
  map: UniverseMapService;
  /** Where a resolved tool call goes. Called once per admitted block. */
  push: (row: UniverseActivityInput) => void;
  /** The server has no logger; a module that must say something takes a closure. */
  logError: (message: string) => void;
};

export type TranscriptTap = { start(): void; stop(): void };

/** Consumed by `universe.module.ts`, which starts it and stops it beside the journal tap. */
export function createTranscriptTap(dependencies: TranscriptTapDependencies): TranscriptTap {
  const resolver: TranscriptResolver = {
    nodeForPath: (absolutePath) => dependencies.map.nodeIndexForPath(absolutePath),
    nodeForEndpoint: (id) => dependencies.map.nodeIndexForEndpoint(id),
  };

  /** The rows of the tool-call blocks one transcript record holds, pushed as they resolve. */
  const emit = (file: string, body: string): void => {
    let record: unknown;
    try {
      record = JSON.parse(body);
    } catch {
      // A line that will not parse is skipped. A transcript is the CLI's file, and one bad line is
      // not a reason to stop following the rest of it.
      return;
    }
    if (typeof record !== 'object' || record === null) return;
    const message = (record as { message?: unknown }).message;
    if (typeof message !== 'object' || message === null) return;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;

    // The file's stem is the session: `<sid>.jsonl` for a conversation, and `agent-<id>` for a
    // subagent, which is the thread that owns it and the name a reader can find it by.
    const session = path.basename(file, '.jsonl');
    // Read time, not the record's own `timestamp`: this tap only ever sees bytes written after it
    // started, so the clock at read time IS the event time to within one poll interval.
    const at = Date.now();
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const typed = block as { type?: unknown; name?: unknown; input?: unknown };
      if (typed.type !== 'tool_use' || typeof typed.name !== 'string') continue;
      const input =
        typeof typed.input === 'object' && typed.input !== null ? (typed.input as Record<string, unknown>) : {};
      const row = rowsForToolUse(typed.name, input, session, resolver);
      if (row !== null) dependencies.push({ ...row, at });
    }
  };

  const tail = createTranscriptTail({
    root: TRANSCRIPTS_ROOT,
    onLine: emit,
    logError: dependencies.logError,
  });

  return {
    start: () => tail.start(),
    stop: () => tail.stop(),
  };
}
