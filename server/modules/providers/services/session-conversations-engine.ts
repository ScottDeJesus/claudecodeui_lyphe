/**
 * Chat search's Claude half: the job the transcript engine's `search` verb reads, and each file's
 * record turned into the results the walk in `session-conversations-search.service.ts` collects.
 * The engine gates each transcript, reads its rows and returns every hit's whole visible text; the
 * service's own matcher judges and cuts each one, so a snippet and its highlights have one author.
 */

import path from 'node:path';

import type { TranscriptSearchFileRecord, TranscriptSearchJob, TranscriptSearchMatch } from '@/modules/transcript-engine/index.js';
import type {
  SearchableSessionRow,
  SearchRuntime,
  SessionConversationMatch,
  SessionConversationResult,
} from '@/modules/providers/services/session-conversations-search.service.js';
import { TRANSPARENT_WRAPPER_COMMANDS } from '@/shared/local-commands.js';

export type ClaudeSearchJob = {
  job: TranscriptSearchJob;
  /** Each Claude transcript's place in `job.files`, by its comparable path. */
  indexByFileKey: Map<string, number>;
};

/** The service's rules for counting a judged hit and naming a session, handed in so they keep one home. */
export type ClaudeResultRules = {
  addSessionMatch: (matches: SessionConversationMatch[], match: SessionConversationMatch) => void;
  toSummaryText: (customName: string | null, fallback: string | null | undefined, emptyLabel: string) => string;
};

const CLAUDE_EMPTY_SUMMARY = 'New Session';

/** The searches that have already logged an engine/matcher disagreement: one line per search is enough to see it. */
const searchesThatLoggedADisagreement = new WeakSet<object>();

/**
 * Walks the project buckets in the walk's own order and lists each Claude transcript once, at its first
 * touch, with the provider session ids of every Claude row on that path. The walk then asks the run for
 * its files with rising indexes, which is what the run requires.
 */
export function buildClaudeSearchJob(input: {
  buckets: ReadonlyArray<{ sessions: SearchableSessionRow[] }>;
  sessionsByFileKey: ReadonlyMap<string, SearchableSessionRow[]>;
  fileKeyOf: (session: SearchableSessionRow) => string;
  words: string[];
  maxPerSession: number;
}): ClaudeSearchJob {
  const files: TranscriptSearchJob['files'] = [];
  const indexByFileKey = new Map<string, number>();
  for (const bucket of input.buckets) {
    for (const session of bucket.sessions) {
      if (session.provider !== 'claude') {
        continue;
      }
      const fileKey = input.fileKeyOf(session);
      if (!fileKey || indexByFileKey.has(fileKey)) {
        continue;
      }
      const fileSessions = input.sessionsByFileKey.get(fileKey) ?? [session];
      indexByFileKey.set(fileKey, files.length);
      files.push({
        path: path.resolve(session.jsonl_path),
        sessions: [...new Set(fileSessions.map(providerSessionIdOf))],
      });
    }
  }
  return {
    job: {
      words: input.words,
      maxPerSession: input.maxPerSession,
      transparentWrappers: [...TRANSPARENT_WRAPPER_COMMANDS],
      files,
    },
    indexByFileKey,
  };
}

/**
 * One file's record as that file's results, keyed by the app's `session_id`. Transcript rows carry the
 * provider session id, so hits are attributed by it and mapped back through the file's rows. A file
 * the engine could not read has no results, as an unreadable file always had.
 */
export function fileResultsFromRecord(
  record: TranscriptSearchFileRecord,
  fileSessions: SearchableSessionRow[],
  runtime: Pick<SearchRuntime, 'matchesQuery' | 'buildSnippet'>,
  rules: ClaudeResultRules,
): Map<string, SessionConversationResult> {
  const fileResults = new Map<string, SessionConversationResult>();
  if (!('matches' in record)) {
    return fileResults;
  }

  const internalIdByProviderId = new Map<string, string>();
  const customNameByProviderId = new Map<string, string | null>();
  for (const candidate of fileSessions) {
    const providerId = providerSessionIdOf(candidate);
    internalIdByProviderId.set(providerId, candidate.session_id);
    customNameByProviderId.set(providerId, candidate.custom_name ?? null);
  }

  const matchesByProviderId = new Map<string, SessionConversationMatch[]>();
  for (const match of record.matches) {
    if (!runtime.matchesQuery(match.text)) {
      logDisagreement(runtime, match);
      continue;
    }
    const { snippet, highlights } = runtime.buildSnippet(match.text);
    const sessionMatches = matchesByProviderId.get(match.session) ?? [];
    matchesByProviderId.set(match.session, sessionMatches);
    rules.addSessionMatch(sessionMatches, {
      role: match.role,
      snippet,
      highlights,
      timestamp: match.timestamp,
      provider: 'claude',
      messageUuid: match.uuid,
    });
  }

  for (const [providerId, matches] of matchesByProviderId) {
    if (matches.length === 0) {
      continue;
    }
    const internalSessionId = internalIdByProviderId.get(providerId) ?? providerId;
    fileResults.set(internalSessionId, {
      sessionId: internalSessionId,
      provider: 'claude',
      sessionSummary: rules.toSummaryText(
        customNameByProviderId.get(providerId) ?? null,
        record.summaries[providerId],
        CLAUDE_EMPTY_SUMMARY,
      ),
      matches,
    });
  }
  return fileResults;
}

function providerSessionIdOf(session: SearchableSessionRow): string {
  return session.provider_session_id || session.session_id;
}

/** The engine returned a text the matcher refuses: the two disagree, a defect to be seen, never a hit to show. */
function logDisagreement(search: object, match: TranscriptSearchMatch): void {
  if (searchesThatLoggedADisagreement.has(search)) {
    return;
  }
  searchesThatLoggedADisagreement.add(search);
  console.warn(
    `[transcript-engine] search: the engine returned a ${match.role} text of session ${match.session} `
      + '(message ' + String(match.uuid) + ') that createWordMatcher refuses; it is dropped. The engine and the matcher disagree.',
  );
}
