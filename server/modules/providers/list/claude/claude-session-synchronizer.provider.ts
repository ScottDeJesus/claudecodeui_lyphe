import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { readTitleRows } from '@/modules/transcript-engine/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readLastTranscriptTimestamp,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/** What the head of one transcript says, before its title is read. */
type SessionHead = {
  sessionId: string;
  projectPath: string;
  /** The name the database already holds; it wins over any title the transcript carries. */
  storedName?: string;
};

/**
 * The ONE home of the Claude transcript layout. This synchronizer's recursive scan below reads it,
 * and `claude-transcript-activity.ts` joins a provider session id under one of these directories
 * when the database holds no transcript path for it. Nothing else may spell the layout out.
 */
export const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

const UNTITLED_SESSION_NAME = 'Untitled Claude Session';

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * Returns true when a JSONL file is a subagent transcript or tool result
   * rather than a top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory and
   * tool results under a `tool-results/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them as
   * standalone sessions overwrites the parent row's `jsonl_path` and corrupts
   * the main session record. The recursive scan in `synchronize()` reaches
   * them, so both entry points must skip them.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Scans ~/.claude/projects and upserts discovered sessions into DB.
   *
   * Every head is read first, so the titles of all the files that need one come from one engine
   * run; the sessions are then named and upserted in the scan's own order.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      CLAUDE_PROJECTS_ROOT,
      '.jsonl',
      since ?? null
    );

    const sessionFiles: Array<{ filePath: string; head: SessionHead }> = [];
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }
      const head = await this.readSessionHead(filePath);
      if (head) {
        sessionFiles.push({ filePath, head });
      }
    }

    const titlesByPath = await this.readTitlesOf(
      sessionFiles.filter(({ head }) => head.storedName === undefined)
    );

    for (const { filePath, head } of sessionFiles) {
      const parsed = this.nameSession(head, titlesByPath.get(filePath), nameMap);
      const timestamps = await this.readSessionTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath
      );
    }

    return sessionFiles.length;
  }

  /**
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const head = await this.readSessionHead(filePath);
    if (!head) {
      return null;
    }
    const titlesByPath = await this.readTitlesOf(head.storedName === undefined ? [{ filePath, head }] : []);
    const parsed = this.nameSession(head, titlesByPath.get(filePath), nameMap);

    const timestamps = await this.readSessionTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  /**
   * Resolves the timestamps a session row is stamped with.
   *
   * `updated_at` is the last timestamped record in the transcript, not the
   * file's mtime: the CLI touches idle transcripts (see
   * `readLastTranscriptTimestamp`), and using mtime made idle sessions surface
   * as "active a minute ago". The mtime remains the fallback for a transcript
   * that holds no timestamped record yet. Codex and Cursor still stamp mtime;
   * their CLIs have not been observed touching idle transcripts.
   */
  private async readSessionTimestamps(
    filePath: string
  ): Promise<{ createdAt?: string; updatedAt?: string }> {
    const [fileTimestamps, lastRecordAt] = await Promise.all([
      readFileTimestamps(filePath),
      readLastTranscriptTimestamp(filePath),
    ]);
    return {
      createdAt: fileTimestamps.createdAt,
      updatedAt: lastRecordAt ?? fileTimestamps.updatedAt,
    };
  }

  /**
   * Reads what the head of one Claude JSONL session file says: its session id, its project path
   * and the name the database already holds. Null for a file that is not a sidebar chat.
   */
  private async readSessionHead(filePath: string): Promise<SessionHead | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
      };
    });

    if (!parsed) {
      return null;
    }

    // A transcript a chat has left behind — compacted away, or a compaction's seed that did not
    // take — is kept on disk on purpose and is nobody's conversation any more. Indexing it would
    // add a second sidebar chat for the part of a conversation the chat already carries in its
    // stitched history (the Codex synchronizer's rule, for the same reason).
    if (sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== UNTITLED_SESSION_NAME) {
      return { ...parsed, storedName: existingSessionName };
    }
    return parsed;
  }

  /**
   * The title each file gives its head's session, from one run of the engine's titles verb. Only
   * the picked title is kept: a full scan's rows run to hundreds of thousands of last-prompt rows,
   * and holding them until the upserts end costs ~100 MB of heap. A record carrying `error` has no
   * title; a rejected read is left to rise, so the sync fails instead of naming every session from
   * history.jsonl.
   */
  private async readTitlesOf(
    sessionFiles: Array<{ filePath: string; head: SessionHead }>
  ): Promise<Map<string, string | undefined>> {
    const results = await readTitleRows(sessionFiles.map(({ filePath }) => filePath));
    const titlesByPath = new Map<string, string | undefined>();
    sessionFiles.forEach(({ filePath, head }, index) => {
      const result = results[index];
      if (result && 'rows' in result) {
        titlesByPath.set(filePath, pickSessionTitle(result.rows, head.sessionId));
      }
    });
    return titlesByPath;
  }

  /**
   * Names one session: the name already stored, else the transcript's own title, else
   * history.jsonl's `display`. A file the engine could not read has no title, as an unreadable
   * file always had.
   */
  private nameSession(
    head: SessionHead,
    title: string | undefined,
    nameMap: Map<string, string>
  ): ParsedSession {
    const { sessionId, projectPath, storedName } = head;
    if (storedName !== undefined) {
      return { sessionId, projectPath, sessionName: normalizeSessionName(storedName, UNTITLED_SESSION_NAME) };
    }

    // The transcript's own titles come first: a `/rename` (custom-title) or the CLI's generated title
    // (ai-title) says more than history.jsonl's `display`, which is only the prompt that was typed.
    return {
      sessionId,
      projectPath,
      sessionName: normalizeSessionName(title || nameMap.get(sessionId), UNTITLED_SESSION_NAME),
    };
  }
}

/**
 * The title a transcript's rows give one session: its LAST non-blank `custom-title` (`/rename`),
 * else its last `ai-title`, else its last `last-prompt`, counting only rows of this session id.
 * why: the CLI writes `custom-title` just before `ai-title` and `last-prompt` last, so a reverse
 * scan returning its first hit lost the rename. The rows are the engine's `titles` record of the file.
 */
export function pickSessionTitle(rows: AnyRecord[], sessionId: string): string | undefined {
  let foundCustomTitle: string | undefined;
  let foundAiTitle: string | undefined;
  let foundLastPrompt: string | undefined;

  for (const data of rows) {
    const eventType = typeof data.type === 'string' ? data.type : undefined;
    const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
    if (eventSessionId !== sessionId) {
      continue;
    }

    if (eventType === 'custom-title') {
      const title = typeof data.customTitle === 'string' ? data.customTitle : undefined;
      if (title?.trim()) {
        foundCustomTitle = title;
      }
    } else if (eventType === 'ai-title') {
      const title = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
      if (title?.trim()) {
        foundAiTitle = title;
      }
    } else if (eventType === 'last-prompt') {
      const prompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
      if (prompt?.trim()) {
        foundLastPrompt = prompt;
      }
    }
  }

  return foundCustomTitle || foundAiTitle || foundLastPrompt;
}
