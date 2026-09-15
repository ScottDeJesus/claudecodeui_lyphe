import fsp from 'node:fs/promises';
import path from 'node:path';

import { readClaudeTranscriptBySessionId } from '@/modules/providers/index.js';
import type { SubagentTranscriptResult } from '@/shared/types.js';

/**
 * A launched soul's own transcript, from the launch id the pin carries.
 *
 * A soul is addressed by its launch, and the providers module addresses a transcript by its Claude
 * session id, so the whole job here is the translation between the two: the receipt's `session_id`
 * once the soul ended, and the id `claude -p` announced on its own log while it is still out. The
 * provider read does the rest, and this file knows nothing about where a transcript is kept — the
 * launch root arrives as an argument, the same way `snapshotLaunches` takes it.
 */

/** The shape of a Claude session id, in the receipt and in the child's log alike. */
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/;

/** How much of the child's log is read when the receipt has no id yet: the id is on its first line. */
const CHILD_LOG_HEAD_BYTES = 65536;

/** The id as `claude -p`'s stream-json announces it. */
const CHILD_LOG_SESSION_ID = /"session_id":"([0-9a-f-]{36})"/;

/**
 * The not-found answer of this service's own: a launch directory with no readable id, or a session
 * the providers module could not resolve. A result, never an error.
 */
const NOT_FOUND_SOUL_TRANSCRIPT: SubagentTranscriptResult = Object.freeze({
  found: false,
  activity: [],
  total: 0,
  inFlight: false,
  finishedAt: null,
});

/** The id the launcher's receipt recorded, or `null` while the soul is still out. */
async function readSessionIdFromReceipt(launchDir: string): Promise<string | null> {
  try {
    const receipt = JSON.parse(await fsp.readFile(path.join(launchDir, 'result.json'), 'utf8')) as Record<string, unknown>;
    const sessionId = receipt.session_id;
    return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

/** The id the child announced on its log's first line, read from the head of that log only. */
async function readSessionIdFromChildLog(launchDir: string): Promise<string | null> {
  try {
    const handle = await fsp.open(path.join(launchDir, 'child.log'), 'r');
    try {
      const head = Buffer.alloc(CHILD_LOG_HEAD_BYTES);
      const { bytesRead } = await handle.read(head, 0, CHILD_LOG_HEAD_BYTES, 0);
      const match = CHILD_LOG_SESSION_ID.exec(head.subarray(0, bytesRead).toString('utf8'));
      return match ? match[1] : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * The transcript of one launch, as the chat's Subagents widget reads it. Never throws: a launch
 * directory that is gone, a receipt that names no session and a log that has not been written yet
 * all answer with the not-found result.
 *
 * `stateDir` is the launch root the composition root resolved, passed in rather than read off the
 * environment — see `createDispatchSoulsModule`, whose JSDoc says everything under that root takes
 * what it needs as an argument.
 */
export async function readSoulTranscript(stateDir: string, launchId: string): Promise<SubagentTranscriptResult> {
  try {
    const launchDir = path.join(stateDir, launchId);
    const sessionId = await readSessionIdFromReceipt(launchDir) ?? await readSessionIdFromChildLog(launchDir);
    if (!sessionId) {
      return NOT_FOUND_SOUL_TRANSCRIPT;
    }

    const result = await readClaudeTranscriptBySessionId(sessionId);
    return result.found ? result : NOT_FOUND_SOUL_TRANSCRIPT;
  } catch {
    return NOT_FOUND_SOUL_TRANSCRIPT;
  }
}
