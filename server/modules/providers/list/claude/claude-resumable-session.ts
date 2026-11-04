import fsp from 'node:fs/promises';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { CLAUDE_PROJECTS_ROOT } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

/**
 * The check at the one door a Claude process is started through: a turn RESUMES a conversation only
 * when that conversation's transcript is on this machine's disk.
 *
 * The CLI's answer to `--resume <id>` for an id with no transcript is "No conversation found with
 * session ID" — an error result, then a thrown query error, and the page shows the typed message and
 * never a reply. Worse, nothing in the row says the id is dead, so every later turn resumes the same
 * id and fails the same way: the chat never recovers. The ids that reach this check dead are the ones
 * the row holds without a conversation behind them (a mapping stamped before any run, a process that
 * died before it wrote its first line, a transcript someone removed). "Start the conversation" is the
 * only turn that can answer for them, and it is exactly what a NULL mapping already means to every
 * runtime, so a dead id is answered by making the row say NULL again.
 *
 * CONSERVATIVE BY DESIGN: only a transcript that is provably ABSENT sends the turn down the start
 * path. A lookup that cannot say (an unreadable directory, an id that is not a plain file name) keeps
 * the id, so the worst a wrong guess costs is the error this check exists to remove — never a silent
 * loss of a conversation that was there.
 */

/** What a lookup of one path found: the file, nothing there, or a failure that proves neither. */
type FileState = 'present' | 'absent' | 'unknown';

/** What the CLI names its transcript files after: a plain id, never something to join into a path. */
const TRANSCRIPT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

async function fileState(filePath: string): Promise<FileState> {
  try {
    await fsp.stat(filePath);
    return 'present';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: a parent in the path is itself a file, so the transcript cannot be there either.
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unknown';
  }
}

/**
 * Whether the transcript of one provider session is on disk: the row's recorded path first (one stat,
 * the ordinary case), then `<id>.jsonl` under every project folder of the CLI's root — the same root the
 * synchronizer indexes, because the folder name is the CLI's own encoding of the working directory and
 * a name derived here would be a second copy of it. The scan (~30 ms over 1,300 folders) runs only
 * when no recorded path is there to prove the file, which is a chat's first turn after a restart of
 * its process or a chat whose mapping is dead.
 */
async function transcriptState(providerSessionId: string, recordedPath: string | null): Promise<FileState> {
  if (recordedPath) {
    const recorded = await fileState(recordedPath);
    if (recorded !== 'absent') return recorded;
  }
  if (!TRANSCRIPT_ID_PATTERN.test(providerSessionId)) return 'unknown';

  let folders: string[];
  try {
    folders = await fsp.readdir(CLAUDE_PROJECTS_ROOT);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown';
  }
  const states = await Promise.all(
    folders.map((folder) => fileState(path.join(CLAUDE_PROJECTS_ROOT, folder, `${providerSessionId}.jsonl`))),
  );
  if (states.includes('present')) return 'present';
  return states.includes('unknown') ? 'unknown' : 'absent';
}

/**
 * The provider session id this turn may resume, or `null` when its conversation does not exist and the
 * turn must start one. A dead id is also taken off the chat's row (`detachProviderSession`: the id and
 * the transcript path together), so the row reads as a chat that has not run — the state every other
 * reader of the column already understands — instead of resuming the same id on every later turn.
 *
 * The detach re-reads the row AFTER the lookup and acts only if it still holds the id that was
 * checked, in the same tick: a mapping some run recorded meanwhile is never taken off.
 *
 * `providerSessionId` is what `resolveProviderSessionId` answered for `appSessionId`. Not asked for a
 * process re-adopted after a restart (its conversation is live in a CLI that already holds it) or for
 * a Cerberus node's project (its transcript is on the node's disk) — the caller skips both.
 *
 * Consumer: claude-runtime.provider.js (`spawnProcess`, once per process start, before the launch
 * options are resolved).
 */
export async function confirmResumableProviderSession(input: {
  appSessionId: string | null;
  providerSessionId: string | null;
}): Promise<string | null> {
  const { appSessionId, providerSessionId } = input;
  if (!providerSessionId) return null;

  const recordedPath = appSessionId ? sessionsDb.getSessionById(appSessionId)?.jsonl_path ?? null : null;
  const state = await transcriptState(providerSessionId, recordedPath);
  if (state !== 'absent') return providerSessionId;

  console.warn(
    `[Claude SDK] Session ${appSessionId ?? providerSessionId} holds provider session ${providerSessionId}, but no transcript of it is on disk; this turn starts the conversation instead of resuming it`,
  );
  const row = appSessionId ? sessionsDb.getSessionById(appSessionId) : null;
  if (row && row.provider_session_id === providerSessionId) {
    sessionsDb.detachProviderSession(row.session_id);
  }
  return null;
}
