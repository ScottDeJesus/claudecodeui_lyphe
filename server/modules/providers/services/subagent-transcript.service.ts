import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import {
  NOT_FOUND_TRANSCRIPT,
  findSubagentTranscriptByToolUse,
  readTranscriptActivity,
} from '@/modules/providers/list/claude/claude-transcript-activity.js';
import type { SubagentTranscriptResult } from '@/shared/types.js';

/**
 * One subagent's own transcript, addressed the way the chat addresses the row: the app session id
 * plus the Agent tool call's id.
 *
 * The provider route `GET /sessions/:sessionId/subagents/:toolUseId/transcript` is the only
 * consumer. Everything it cannot resolve — no row, another provider, no transcript path, no file —
 * is the not-found RESULT, because the widget asks for rows whose subagent may not have written
 * anything yet, and that is an answer rather than a failure.
 */
/**
 * The app session row, or `null`.
 *
 * Guarded like the provider-id lookup in `claude-transcript-activity.ts`: a database layer that
 * throws — a connection asked for before init, a handle that has gone away — is a miss here, not a
 * 500, because a 500 is the one answer this read's contract has no room for.
 */
function readSession(sessionId: string) {
  try {
    return sessionsDb.getSessionById(sessionId);
  } catch {
    return null;
  }
}

export const subagentTranscriptService = {
  async readByToolUse(sessionId: string, toolUseId: string): Promise<SubagentTranscriptResult> {
    const session = readSession(sessionId);
    if (!session || session.provider !== 'claude') {
      return NOT_FOUND_TRANSCRIPT;
    }

    const jsonlPath = session.jsonl_path;
    if (!jsonlPath) {
      return NOT_FOUND_TRANSCRIPT;
    }

    // The provider session id, not the app id, names the CLI's own directory; the fallback covers
    // a row that has not been mapped to a provider id yet.
    const transcriptPath = await findSubagentTranscriptByToolUse(
      path.dirname(jsonlPath),
      session.provider_session_id ?? sessionId,
      toolUseId,
    );
    if (!transcriptPath) {
      return NOT_FOUND_TRANSCRIPT;
    }

    return readTranscriptActivity(transcriptPath);
  },
};
