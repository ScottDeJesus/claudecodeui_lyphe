import fsp from 'node:fs/promises';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { CLAUDE_PROJECTS_ROOT } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { readClaudeSubagentTranscript } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { truncateSubagentActivity } from '@/shared/utils.js';
import type { SubagentActivity, SubagentTranscriptResult } from '@/shared/types.js';

/**
 * The three reads behind the chat's Subagents widget: one transcript file → activity, one Agent tool
 * call → its transcript file, one provider session id → the same (the only one that leaves the module).
 */

/**
 * How many of a transcript's newest steps the widget is sent. A long-running agent writes
 * thousands of records and the reader came for the end of them, so this is a TAIL slice — the
 * untruncated count travels as `total` alongside it.
 */
export const SUBAGENT_TRANSCRIPT_LIMIT = 1000;

/** The not-found timeline, frozen on its own: `Object.freeze` on the object below is shallow, and
 * the answer below is ONE process-wide singleton — an appended entry would corrupt every later miss. */
const EMPTY_ACTIVITY: SubagentActivity[] = [];
Object.freeze(EMPTY_ACTIVITY);

/** The answer every miss gets: no session, no file, no provider. A RESULT, never an error. */
export const NOT_FOUND_TRANSCRIPT: SubagentTranscriptResult = Object.freeze({
  found: false,
  activity: EMPTY_ACTIVITY,
  total: 0,
  inFlight: false,
  finishedAt: null,
});

/** Bounds on the two hit caches below: both hold only files that were found once. */
const TOOL_USE_HIT_CACHE_LIMIT = 500;
const SESSION_ID_HIT_CACHE_LIMIT = 200;

/** Hit caches, keyed by what the lookup was asked for. A miss is never stored — see the module doc. */
const toolUseHits = new Map<string, string>();
const sessionIdHits = new Map<string, string>();

/** A file this process can actually open: an existence check alone would pass an unreadable one. */
async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fsp.open(filePath, 'r');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * One transcript file, as the widget reads it. The tail slice and the per-entry truncation happen
 * here, and the readability check stands in front of the reader, which never says whether the file
 * was there. A miss is never a throw.
 */
export async function readTranscriptActivity(filePath: string): Promise<SubagentTranscriptResult> {
  if (!await isReadableFile(filePath)) {
    return NOT_FOUND_TRANSCRIPT;
  }

  try {
    const transcript = await readClaudeSubagentTranscript(filePath);
    return {
      found: true,
      activity: transcript.activity.slice(-SUBAGENT_TRANSCRIPT_LIMIT).map(truncateSubagentActivity),
      total: transcript.activity.length,
      inFlight: transcript.inFlight,
      finishedAt: transcript.finishedAt ?? null,
    };
  } catch {
    return NOT_FOUND_TRANSCRIPT;
  }
}

/**
 * The transcript file of the subagent one Agent tool call spawned, or `null`.
 *
 * Claude writes `<projectDirectory>/<providerSessionId>/subagents/agent-<agentId>.meta.json` whose
 * `toolUseId` is the parent's tool-call id, next to the sibling `.jsonl`. Only that layout is
 * searched: the older loose one cannot address a running agent, which is the case the widget is
 * for. The id comes off the client's own row, so the scan compares it and never joins it.
 */
export async function findSubagentTranscriptByToolUse(
  projectDirectory: string,
  providerSessionId: string,
  toolUseId: string,
): Promise<string | null> {
  const cacheKey = `${providerSessionId}:${toolUseId}`;
  const cached = toolUseHits.get(cacheKey);
  if (cached) {
    return cached;
  }

  const subagentsDir = path.join(projectDirectory, providerSessionId, 'subagents');
  let entries: string[];
  try {
    entries = await fsp.readdir(subagentsDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) {
      continue;
    }

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(await fsp.readFile(path.join(subagentsDir, entry), 'utf8')) as Record<string, unknown>;
    } catch {
      // A sidecar torn mid-write is skipped; the rest of the directory still counts.
      continue;
    }
    if (meta.toolUseId !== toolUseId) {
      continue;
    }

    const transcriptPath = path.join(subagentsDir, entry.replace(/\.meta\.json$/, '.jsonl'));
    if (!await isReadableFile(transcriptPath)) {
      continue;
    }

    if (toolUseHits.size >= TOOL_USE_HIT_CACHE_LIMIT) {
      toolUseHits.clear();
    }
    toolUseHits.set(cacheKey, transcriptPath);
    return transcriptPath;
  }

  return null;
}

/** The directories under the projects root, or none: a missing root is a miss, not a failure. */
async function scanProjectsRoot(providerSessionId: string): Promise<string | null> {
  try {
    const entries = await fsp.readdir(CLAUDE_PROJECTS_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(CLAUDE_PROJECTS_ROOT, entry.name, `${providerSessionId}.jsonl`);
      if (await isReadableFile(candidate)) {
        return candidate;
      }
    }
  } catch {
    // No projects root, or it is unreadable: nothing to scan.
  }

  return null;
}

/**
 * The transcript of one Claude session, by its provider session id — the read the dispatch-souls
 * lane makes, since a soul's launch knows only the session id off its `child.log` or receipt. The
 * database's `jsonl_path` is asked first and the projects root scanned only when the row is absent,
 * carries no path, or the file it names is gone: a soul's session is often current in the CLI's
 * directory before any synchronizer has written a row for it.
 */
export async function readClaudeTranscriptBySessionId(
  providerSessionId: string,
): Promise<SubagentTranscriptResult> {
  if (!/^[0-9a-f-]{36}$/.test(providerSessionId)) {
    return NOT_FOUND_TRANSCRIPT;
  }

  const cached = sessionIdHits.get(providerSessionId);
  if (cached) {
    return readTranscriptActivity(cached);
  }

  try {
    const row = sessionsDb.getSessionByProviderSessionId(providerSessionId);
    const jsonlPath = row?.jsonl_path;
    if (jsonlPath && await isReadableFile(jsonlPath)) {
      if (sessionIdHits.size >= SESSION_ID_HIT_CACHE_LIMIT) {
        sessionIdHits.clear();
      }
      sessionIdHits.set(providerSessionId, jsonlPath);
      return readTranscriptActivity(jsonlPath);
    }
  } catch {
    // A database failure falls through to the directory scan rather than becoming a 500.
  }

  const discovered = await scanProjectsRoot(providerSessionId);
  if (discovered) {
    if (sessionIdHits.size >= SESSION_ID_HIT_CACHE_LIMIT) {
      sessionIdHits.clear();
    }
    sessionIdHits.set(providerSessionId, discovered);
    return readTranscriptActivity(discovered);
  }

  return NOT_FOUND_TRANSCRIPT;
}
