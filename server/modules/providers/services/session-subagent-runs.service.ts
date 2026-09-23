import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import {
  RUNNING_BELIEVED_FOR_MS,
  hasFreshSubagentSidechains,
  hasRunningSubagent,
  readSubagentStamp,
} from '@/modules/providers/services/session-agents.service.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Which conversations have a subagent running right now — the answer behind the sidebar's purple
 * dot.
 *
 * The sidebar's run marks could not say this before: they come from `listRunningSessions`, which
 * reads `chatRunRegistry`, and a run leaves that registry the moment its turn ends. A BACKGROUNDED
 * `Agent` call outlives the turn that launched it — the run is over, the agent is still out there —
 * and that is the ordinary case, not an edge one. Nothing client-side can answer it either: the
 * chat a dot belongs to is usually not open, so its transcript is not loaded anywhere. So the
 * server answers, from the only place the container rows and their agents' sidechains meet.
 *
 * The rule is `hasRunningSubagent`'s, which is the pinned strip's: same container selection, same
 * four-hour window. The two readings part in one place — the strip times a row from
 * `subagent.resume.at ?? message.timestamp`, this one from the launch — so a resume more than four
 * hours after its launch leaves the strip's row pinned while this answer stays dark.
 *
 * Cost is the reason this file has the shape it does. A poll every five seconds cannot read every
 * conversation, and it does not have to: the candidates are bounded to a window, and a transcript
 * read is skipped entirely unless something on disk says the session could hold a running agent
 * (`hasFreshSubagentSidechains`). What is left rides the same `sessionHistoryCache` the chat's own
 * history reads use, keyed on the same subagent stamp, so a session the reader has open is parsed
 * once for both.
 */

/** A ceiling on one pass, in sessions. Twice the busiest four hours this box has recorded. */
const MAX_CANDIDATES = 500;

/**
 * How long one answer is reused. Two reasons, and both are real: several open tabs poll the same
 * endpoint five seconds apart, and the tail of a pass is a transcript parse. Short enough that a
 * dot's appearance or disappearance is never the thing the reader waits on.
 */
const ANSWER_TTL_MS = 2_000;

type Candidate = {
  sessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  projectPath: string | null;
  transcriptPath: string;
};

/**
 * The sessions one pass may consider: every conversation touched inside the running window, plus
 * the live runs.
 *
 * The window is the honest bound, not a shortcut. An agent is only ever believed running for
 * `RUNNING_BELIEVED_FOR_MS` from its LAUNCH, and a turn cannot end before it launched its own
 * agents — so a session holding a running agent wrote to disk inside that same window and is
 * always in this set. The live runs are added rather than assumed: a run's row is not what the
 * registry holds, and a run admitted against a row the window has aged out must still be looked at.
 */
function candidateSessions(now: number): Candidate[] {
  const sinceIso = new Date(now - RUNNING_BELIEVED_FOR_MS).toISOString();
  const byId = new Map<string, Candidate>();

  const add = (row: ReturnType<typeof sessionsDb.getSessionById>): void => {
    if (!row?.session_id || !row.jsonl_path || byId.has(row.session_id)) {
      return;
    }
    byId.set(row.session_id, {
      sessionId: row.session_id,
      provider: row.provider as LLMProvider,
      providerSessionId: row.provider_session_id,
      projectPath: row.project_path,
      transcriptPath: row.jsonl_path,
    });
  };

  const rows = sessionsDb.getSessionsActiveSince(sinceIso, MAX_CANDIDATES);
  // The ceiling is a bound on one pass, and it truncates the OLDEST end of the window — the
  // sessions whose agents are nearest the edge of the belief window, which is to say the ones this
  // question is most likely to be about. Five times today's widest window, so it should never bite;
  // if it ever does, it says so rather than answering from a pass that quietly skipped rows.
  if (rows.length === MAX_CANDIDATES) {
    console.warn(
      `[SubagentRuns] The ${RUNNING_BELIEVED_FOR_MS / 3_600_000}h candidate window filled its ceiling of `
      + `${MAX_CANDIDATES} sessions; the oldest are not being scanned this pass.`,
    );
  }
  for (const row of rows) {
    add(row);
  }
  for (const run of chatRunRegistry.listRunningRuns()) {
    add(sessionsDb.getSessionById(run.sessionId));
  }

  return [...byId.values()];
}

/**
 * Whether one conversation holds a running agent, read through the history cache.
 *
 * `transcriptPath: null` is not a case here — the candidate set is built from rows that carry one —
 * but a transcript that has since been deleted is: the cache answers null for it and the session is
 * simply not a hit.
 */
async function sessionHasRunningSubagent(candidate: Candidate, now: number): Promise<boolean> {
  const providerSessions = providerRegistry.resolveProvider(candidate.provider).sessions;
  const providerSessionId = candidate.providerSessionId ?? candidate.sessionId;

  const fullHistory = await sessionHistoryCache.getFullHistory({
    sessionId: candidate.sessionId,
    transcriptPath: candidate.transcriptPath,
    // The same load, with the same options, as `sessionsService.fetchHistory` builds for a latest
    // page — deliberately, because it is the same cache entry: an open chat's own history read and
    // this poll must never be two parses of one transcript.
    loadFull: () => providerSessions.fetchHistory(candidate.sessionId, {
      limit: null,
      offset: 0,
      projectPath: candidate.projectPath ?? '',
      providerSessionId,
    }),
    readCompanionStamp: () => readSubagentStamp(candidate.transcriptPath, providerSessionId),
  });

  return fullHistory ? hasRunningSubagent(fullHistory.messages, now) : false;
}

/**
 * Narrows the candidates to the ones a transcript read is worth spending on.
 *
 * Claude records every spawned agent as a sidechain beside its parent transcript, and a running one
 * writes it continuously — so a session whose sidechains are all older than the window holds no
 * running agent (`hasFreshSubagentSidechains` carries the proof). That check is a `readdir` and a
 * handful of `stat`s, against the hundreds of milliseconds a parent parse costs.
 *
 * Codex has no such per-session footprint — its agents are rollouts filed by DATE, beside every
 * other session's that day, so there is nothing cheap to ask and it goes straight to the read. It
 * is also a rounding error of this estate; the day it is not, the footprint is what to add.
 */
async function needsTranscriptRead(candidate: Candidate, now: number): Promise<boolean> {
  if (candidate.provider !== 'claude') {
    return true;
  }
  try {
    return await hasFreshSubagentSidechains(
      candidate.transcriptPath,
      candidate.providerSessionId ?? candidate.sessionId,
      now,
    );
  } catch {
    // An unreadable sidechain directory is not evidence of absence: read the transcript rather
    // than drop a session whose agent may be running.
    return true;
  }
}

async function collectRunningSessionIds(now: number): Promise<string[]> {
  const candidates = candidateSessions(now);
  // The cheap narrowing runs together — it is all directory reads — and the parses behind it run
  // one at a time: they are CPU-bound, and a box with a dozen live agents should parse a dozen
  // transcripts in sequence rather than hold a dozen normalized histories in memory at once.
  const wanted = await Promise.all(candidates.map((candidate) => needsTranscriptRead(candidate, now)));

  const running: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (!wanted[index]) {
      continue;
    }
    const candidate = candidates[index];
    try {
      if (await sessionHasRunningSubagent(candidate, now)) {
        running.push(candidate.sessionId);
      }
    } catch (error) {
      // One unreadable conversation never takes the endpoint down with it: the dot is missing for
      // this session this pass, and the next pass tries again.
      console.error(`[SubagentRuns] Could not read session ${candidate.sessionId}:`, error);
    }
  }

  return running.sort();
}

let cachedAt = 0;
let cachedIds: readonly string[] = [];
let inFlight: Promise<readonly string[]> | null = null;

/**
 * The ids of the conversations with a subagent running right now, cached briefly and never
 * computed twice at once (`inFlight`) — the endpoint is polled by every open tab.
 *
 * Every caller gets its own array: the cached one is shared state, and a caller that sorted or
 * spliced it in place would be editing the answer the next poll reads.
 */
export async function listSubagentRunningSessionIds(now: number = Date.now()): Promise<string[]> {
  if (now - cachedAt < ANSWER_TTL_MS) {
    return [...cachedIds];
  }
  if (inFlight) {
    return [...await inFlight];
  }

  inFlight = collectRunningSessionIds(now)
    .then((ids) => {
      cachedIds = ids;
      cachedAt = Date.now();
      return ids;
    })
    .finally(() => {
      inFlight = null;
    });

  return [...await inFlight];
}
